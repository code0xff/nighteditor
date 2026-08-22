/**
 * Asks what to do when there are unsaved edits (spec §4).
 *
 * The browser's `confirm` has only two buttons, so it can only ask "discard?".
 * What the user usually wants is **save and continue** — without that choice they
 * are made to walk three steps: cancel, save, try again.
 *
 * Callers wait for the answer with a single `ask()` line. Only `UnsavedDialog`
 * draws the dialog on screen, and the state lives here in one place.
 */
import { create } from 'zustand';
import type { Notice } from '@/lib/messages';
import { useEditor } from './editor';
import { refuseWhileReplacing, Superseded, type Replacement } from './replacement';

export type UnsavedChoice = 'save' | 'discard' | 'cancel';

/**
 * The channel for asking the preview to "commit whatever is being edited and
 * report back" (spec §4).
 *
 * The screen that draws the preview (PreviewFrame) registers a function that asks
 * its own iframe — the store knows nothing of iframes. The returned promise
 * settles on the preview's answer (flushed).
 */
let flushPreview: (() => Promise<void>) | null = null;

/** @returns a function that unregisters — it never removes a newer registration over its own */
export function registerPreviewFlush(fn: () => Promise<void>): () => void {
  flushPreview = fn;
  return () => {
    if (flushPreview === fn) flushPreview = null;
  };
}

/**
 * The limit on waiting for the preview's commit answer (spec §4).
 *
 * A healthy preview answers within one event-loop turn (a few ms) — the limit
 * only fires when the preview is dead or an artifact script is hogging its event
 * loop. A preview in that state cannot send commits (focusout) either, so waiting
 * longer brings no edits worth protecting — the wait only holds the user's click
 * hostage. One second survives a heavy artifact script's occasional long task,
 * and is a tolerable stutter in front of a dead preview.
 */
export const FLUSH_TIMEOUT = 1000;

/**
 * Asks the preview to commit any open edit and waits (up to the limit) for its answer.
 *
 * The commit and the answer travel the same postMessage channel in order, so if
 * the answer arrived the commit has already reached the store — the `unsaved`
 * read after this knows about that edit.
 */
export async function flushPreviewEdits(): Promise<void> {
  const ask = flushPreview;
  if (!ask) return;
  await Promise.race([ask(), new Promise<void>((done) => setTimeout(done, FLUSH_TIMEOUT))]);
}

interface UnsavedState {
  /** What was about to happen when we stopped to ask. null means no question is up */
  why: Notice | null;
  answer: ((choice: UnsavedChoice) => void) | null;
  ask: (why: Notice) => Promise<UnsavedChoice>;
  reply: (choice: UnsavedChoice) => void;
}

export const useUnsaved = create<UnsavedState>((set, get) => ({
  why: null,
  answer: null,

  ask: (why) =>
    new Promise<UnsavedChoice>((resolve) => {
      // If a question was already up, it is closed as cancelled. Leaving its
      // promise pending would leave that caller waiting forever.
      get().answer?.('cancel');
      set({ why, answer: resolve });
    }),

  reply: (choice) => {
    const { answer } = get();
    set({ why: null, answer: null });
    answer?.(choice);
  },
}));

/**
 * Called before anything that could lose edits. Returns true if it is safe to continue.
 *
 * With nothing edited, or everything already saved, it does not ask — a dialog
 * with nothing to ask is an obstruction. If the user chose save and the save
 * fails, **it does not continue.** Going ahead would lose edits the user believed
 * were saved.
 *
 * @param why what the edits would be lost to — goes into the question as-is
 * @param mine the replacement reservation this question belongs to. Every long
 *   step (waiting for the commit, the question, the save) goes through guarded,
 *   so a true return means this reservation was still the newest through the last
 *   long step — the caller need not re-check right after returning (spec §5).
 *   Answering with save locks **at that moment** (spec §4) — edits made while the
 *   save writes the file have nowhere to go at the install that follows. Without
 *   locking here, they would be accepted and then silently swept away by the
 *   install. This differs from a standalone save — those edits survive, so it
 *   does not lock.
 */
export async function keepEdits(why: Notice, mine?: Replacement): Promise<boolean> {
  // Long steps of a flow with a reservation go through guarded (spec §5 ·
  // replacement reservation) — newer flows keep reserving during the wait, and a
  // displaced flow that asks anyway cancels the newest flow's question; answered
  // with save, the displaced flow would call save() and the user's last choice
  // would be lost. Called without a reservation there is nothing to judge, so it
  // just waits.
  const pass = <T>(p: Promise<T>): Promise<T> => (mine ? mine.guarded(p) : p);
  try {
    // The commit (focusout) of a block being edited in the preview may still be in
    // flight as a postMessage — reading unsaved as-is would replace without asking,
    // and the late commit would vanish silently as the preview goes down
    // (Principle 3). Ask for the commit before judging and wait for its answer.
    // Ask even when already unsaved — "save and continue" must include the edit
    // that was still open (spec §4).
    await pass(flushPreviewEdits());
    const { unsaved, save } = useEditor.getState();
    // Edits already in the file have nothing to lose. Asking again after saving wears people down.
    if (!unsaved) return true;

    // The question is a long step too — if a newer flow reserves while the answer
    // is pending, the displaced flow's "save" answer would call save() and write
    // the old flow's output to the file (spec §5). guarded re-checks the
    // reservation the moment the answer returns.
    const choice = await pass(useUnsaved.getState().ask(why));
    if (choice === 'cancel') return false;
    if (choice === 'save') {
      mine?.engage();
      // State moves while the question is up — a save started by the shortcut may
      // have finished, or the last edit was reverted and the document already
      // matches the file. Then save() returns false as "nothing to write", and
      // reading that as failure silently cancels the very thing the user asked to
      // continue, even though the requested save is already satisfied. A clean
      // document counts as saved; continue (spec §4).
      if (!useEditor.getState().unsaved) return true;
      // Displaced while waiting on the save: do not continue — the file was
      // written and that belongs to the file, but the install that follows belongs
      // to the newest flow (spec §5).
      return await pass(save());
    }
    return true;
  } catch (e) {
    // This function answers in booleans — rethrowing the displacement marker would
    // force even reservation-less callers to wrap in try. Fold it into "do not
    // continue" here (the quiet retreat).
    if (e instanceof Superseded) return false;
    throw e;
  }
}

/**
 * The save shortcut's (`Ctrl+S`) save. **While the question is up, it is that
 * question's "save and continue"** (spec §4 · protecting unsaved edits).
 *
 * Calling plain `save()` beside the question clears `unsaved` while the question
 * stays up. The dialog's save button then finds nothing to save, `save()` returns
 * false, and the thing the user was doing (opening, switching) is silently
 * cancelled. Routing the shortcut into the question's answer both saves and lets
 * the user's action continue.
 */
export function shortcutSave(): void {
  const { why, reply } = useUnsaved.getState();
  if (why === null) {
    // Saving during a replacement writes the **previous** document, the one still
    // on screen — edits the user chose to discard could land in the file. The save
    // button is locked, but the shortcut can fire any time, so refuse and notify
    // here, in the same place as undo (Ctrl+Z) (spec §4). "Save and continue"
    // while the question is up is different — that save is part of the
    // replacement, so it is not blocked.
    if (refuseWhileReplacing('app.saveWhileReplacing')) return;
    void useEditor.getState().save();
    return;
  }
  // Same rule as the dialog's save button — never answer on top of a running save (saving).
  if (useEditor.getState().saving) return;
  reply('save');
}
