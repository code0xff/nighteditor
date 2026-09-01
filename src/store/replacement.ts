/**
 * Document replacement reservations — "what is locked while the document is being
 * replaced, and who wins" is decided entirely in this file (spec §5 · replacement
 * reservation, ADR-010).
 *
 * ## Who wins — the last reservation
 *
 * Every flow that replaces the document (open file, drop, open folder, switch
 * within a bundle, link a folder, OS launch) takes its reservation **at the moment
 * of the user's action** — before starting anything slow: scanning, dialogs, the
 * unsaved prompt, saving. Reserve late and a flow that started first but finished
 * preparing last takes a newer reservation and overwrites the user's last choice.
 *
 * When flows overlap, the last reservation wins — it is the user's last choice.
 * A superseded flow **cleans up only what it created and steps aside** — no
 * install, no notices, no unlocking. All of that belongs to the newest reservation.
 *
 * Every long step (dialog, scan, prompt, save, read) goes through `guarded`, so
 * the check cannot be forgotten — writing a manual `current()` check after each
 * step got the same spot wrong nine times (the missing check after an await).
 * `guarded` waits, then throws `Superseded` if this reservation was displaced,
 * and `withReplacement` (editor.ts), which wraps every one of those flows, turns
 * that into a quiet retreat — a displaced reservation's `current()` never becomes
 * true again, so it cannot reach any notification path gated on `current()`.
 *
 * ## What is locked — a single `replacing`
 *
 * From the moment the replacement is confirmed by answering the prompt (`engage`)
 * until install or failure (`release`), `replacing` is up. Every lock on screen
 * derives from this one value (spec §4).
 *
 * - Preview — pointer events blocked. Edit commits that get through anyway are
 *   refused by the store, with a notice
 * - Title field — disabled
 * - Change list — revert, revert-all and `Ctrl+Z` blocked (they would edit the
 *   previous document)
 * - Toolbar — open, document picker, link folder and save disabled
 *
 * The saving indicator (editor's `saving`) belongs to saving and is not here —
 * edits made during a save survive, so saving never locks the screen, and an
 * earlier save finishing mid-replacement only lowers its own indicator and cannot
 * touch this lock.
 *
 * ## Async that finishes late — the install generation
 *
 * `installed` rises every time a new document is installed. Async work that can
 * outlive a replacement (like saving) takes the generation at its start via
 * `claimDocument()`, and when it finishes with a different generation it discards
 * its results — state updates, notices, lowering its own indicator (spec §5).
 */
import { create } from 'zustand';
import { useToasts } from './toasts';

interface ReplacementState {
  /** A confirmed replacement is in progress — the sole basis for locking the screen */
  replacing: boolean;
  /** Generation of the installed document. The value itself is meaningless; only comparison is */
  installed: number;
}

export const useReplacement = create<ReplacementState>(() => ({
  replacing: false,
  installed: 0,
}));

/** The last reservation number handed out. The screen never reads it, so it lives outside the state */
let reserved = 0;

/**
 * The marker of a superseded flow — `guarded` throws it, and the entry point's
 * try/finally turns it into a quiet retreat. Never turn it into a notification
 * (notice or toast) — a superseded flow's words would be about a screen someone
 * else (the newest flow) put up (spec §5 · replacement reservation).
 */
export class Superseded extends Error {
  constructor() {
    super('superseded');
    this.name = 'Superseded';
  }
}

export interface Replacement {
  /** Is this reservation still the newest — the one check after every long step */
  current(): boolean;
  /**
   * Every long step goes through this — it waits, then throws `Superseded` if this
   * reservation was displaced. Writing the check by hand after each step means one
   * is inevitably forgotten — enforce it in the one place (this channel) where it
   * cannot be. Genuine failures pass through untouched — converting them to the
   * marker would also swallow the failure notices of a flow that ended in
   * cancellation (Principle 3).
   */
  guarded<T>(p: Promise<T>): Promise<T>;
  /** The replacement is confirmed (the prompt was passed) — locks the screen. A no-op for a superseded flow */
  engage(): void;
  /** New state was installed — bumps the generation, cutting off late async work owed to the previous document */
  install(): void;
  /**
   * The end of this flow — lowers the lock only if still the newest. If a
   * superseded flow lowered it, the newest flow's screen would unlock while it is
   * still reading, so the check is enforced here rather than left to callers.
   */
  release(): void;
}

/**
 * One replacement's reservation. An entry point takes it once and moves with the
 * same reservation to the end.
 *
 * Taking a reservation displaces every earlier one — even if this flow ends in
 * cancellation. Cancelling means "stay on the document being viewed", and a
 * displaced old flow installing in its place is not cancellation (spec §5 ·
 * replacement reservation).
 */
export function reserveReplacement(): Replacement {
  const gen = ++reserved;
  const current = (): boolean => gen === reserved;
  return {
    current,
    guarded: async (p) => {
      const value = await p;
      if (!current()) throw new Superseded();
      return value;
    },
    engage: () => {
      if (current()) useReplacement.setState({ replacing: true });
    },
    install: () => {
      if (current()) useReplacement.setState((s) => ({ installed: s.installed + 1 }));
    },
    release: () => {
      if (current()) useReplacement.setState({ replacing: false });
    },
  };
}

/**
 * Refuses a change attempted during a replacement, with a notice. Returns true if refused.
 *
 * The screen is locked, but shortcuts (Ctrl+S, Ctrl+Z) and the commit (blur) of an
 * already-open block can arrive at any time. Accepting them only to discard them
 * is the same as discarding silently, so the refusal policy lives in the same
 * place as the lock — this file (spec §4 · Principle 3).
 */
export function refuseWhileReplacing(
  key: 'app.editWhileReplacing' | 'app.saveWhileReplacing'
): boolean {
  if (!useReplacement.getState().replacing) return false;
  useToasts.getState().show({ key }, 'error');
  return true;
}

/**
 * Decides "does this result belong to the current document" in one place (spec §5).
 *
 * Call it before starting async work to get a check function — if the document was
 * replaced in the meantime it returns false, and the result belongs to the previous
 * document and is discarded.
 */
export function claimDocument(): () => boolean {
  const installed = useReplacement.getState().installed;
  return () => useReplacement.getState().installed === installed;
}
