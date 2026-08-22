// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEditor } from './editor.js';
import { reserveReplacement, useReplacement } from './replacement.js';
import { useToasts } from './toasts.js';
import {
  FLUSH_TIMEOUT,
  keepEdits,
  registerPreviewFlush,
  shortcutSave,
  useUnsaved,
} from './unsaved.js';

/**
 * Waits for the dialog to appear and answers in the user's stead — this is where
 * a person would press a button.
 *
 * It never waits forever. If a question was due but never asked, failing right
 * here shows what went wrong. Spinning indefinitely only looks like a hung test.
 */
async function answerWith(choice: 'save' | 'discard' | 'cancel'): Promise<void> {
  for (let tries = 0; useUnsaved.getState().why === null; tries++) {
    if (tries > 1000) throw new Error('대화상자가 뜨지 않았다');
    await Promise.resolve();
  }
  useUnsaved.getState().reply(choice);
}

/** A state with edits not yet in the file */
function edited(extra: Record<string, unknown> = {}): void {
  useEditor.setState({ patches: new Map([[0, '고친 값']]), unsaved: true, ...extra });
}

beforeEach(() => {
  useUnsaved.setState({ why: null, answer: null });
  useEditor.setState({ patches: new Map(), file: null, unsaved: false, saving: false });
  useReplacement.setState({ replacing: false });
  useToasts.getState().clear();
});

describe('keepEdits', () => {
  it('does not ask when nothing was edited', async () => {
    // A dialog with nothing to ask is nothing but an obstruction.
    const go = await keepEdits({ key: 'confirm.whyOpen' });

    expect(go).toBe(true);
    expect(useUnsaved.getState().why).toBeNull();
  });

  it('does not ask when already saved — there is nothing to lose', async () => {
    // patches survive a save (INV-1). Read as "not saved", it would keep asking even after saving.
    useEditor.setState({ patches: new Map([[0, '고친 값']]), unsaved: false });

    expect(await keepEdits({ key: 'confirm.whyOpen' })).toBe(true);
    expect(useUnsaved.getState().why).toBeNull();
  });

  it('cancelling stays right where the user was', async () => {
    edited();

    const asked = keepEdits({ key: 'confirm.whyOpen' });
    await answerWith('cancel');

    expect(await asked).toBe(false);
    expect(useEditor.getState().patches.size).toBe(1);
  });

  it('choosing discard continues', async () => {
    edited();

    const asked = keepEdits({ key: 'confirm.whyOpen' });
    await answerWith('discard');

    expect(await asked).toBe(true);
  });

  it('choosing save continues after saving', async () => {
    const save = vi.fn().mockResolvedValue(true);
    edited({ save });

    const asked = keepEdits({ key: 'confirm.whySwitch', params: { path: 'deck/b.html' } });
    await answerWith('save');

    expect(await asked).toBe(true);
    expect(save).toHaveBeenCalledOnce();
  });

  it('does not continue when the save fails', async () => {
    // Going ahead would lose edits the user believed were saved.
    const save = vi.fn().mockResolvedValue(false);
    edited({ save });

    const asked = keepEdits({ key: 'confirm.whyOpen' });
    await answerWith('save');

    expect(await asked).toBe(false);
  });

  it('counts a document that became clean while the question was up as saved and continues', async () => {
    // A shortcut save may have finished in the meantime, or the last edit was
    // reverted. Reading save()'s "nothing to write" false as failure would then
    // silently cancel what the user was doing (spec §4).
    const save = vi.fn().mockResolvedValue(false);
    edited({ save });

    const asked = keepEdits({ key: 'confirm.whyOpen' });
    for (let tries = 0; useUnsaved.getState().why === null; tries++) {
      if (tries > 1000) throw new Error('대화상자가 뜨지 않았다');
      await Promise.resolve();
    }
    // The document became clean while the question was up.
    useEditor.setState({ unsaved: false });
    useUnsaved.getState().reply('save');

    expect(await asked).toBe(true);
    // The requested save is already satisfied — no pointless rewrite.
    expect(save).not.toHaveBeenCalled();
  });

  it('carries what the edits would be lost to, untouched', async () => {
    edited();

    const asked = keepEdits({ key: 'confirm.whySwitch', params: { path: 'deck/b.html' } });
    await answerWith('cancel');

    expect(await asked).toBe(false);
  });

  it('asking again while asking closes the earlier question as cancelled', async () => {
    // Leaving the pending answer promise alone would leave its caller waiting forever.
    edited();

    const first = keepEdits({ key: 'confirm.whyOpen' });
    const second = keepEdits({ key: 'confirm.whyAssets' });
    await answerWith('discard');

    expect(await first).toBe(false);
    expect(await second).toBe(true);
  });
});

describe('shortcutSave · Ctrl+S while the question is up (spec §4)', () => {
  it('without a question it is a plain save', () => {
    const save = vi.fn().mockResolvedValue(true);
    useEditor.setState({ save });

    shortcutSave();

    expect(save).toHaveBeenCalledOnce();
  });

  it('Ctrl+S during a replacement is refused with a notice — it would write the previous document', () => {
    // Edits answered with discard are still on screen. Saving here writes the
    // just-discarded content to the file — the save button is locked, and the
    // shortcut must follow the same rule.
    const save = vi.fn().mockResolvedValue(true);
    useEditor.setState({ save, unsaved: true });
    useReplacement.setState({ replacing: true });

    shortcutSave();

    expect(save).not.toHaveBeenCalled();
    expect(useToasts.getState().toasts.some((t) => t.notice.key === 'app.saveWhileReplacing')).toBe(
      true
    );
  });

  it('with the question up it flows into "save and continue", so the pending action goes on', async () => {
    // A plain save here clears unsaved while the question stays up, and the save
    // button afterwards returns false with nothing to save, cancelling what the
    // user was doing (opening, switching).
    const save = vi.fn().mockResolvedValue(true);
    edited({ save });
    const asked = keepEdits({ key: 'confirm.whyOpen' });
    for (let tries = 0; useUnsaved.getState().why === null; tries++) {
      if (tries > 1000) throw new Error('대화상자가 뜨지 않았다');
      await Promise.resolve();
    }

    shortcutSave();

    expect(await asked).toBe(true);
    expect(save).toHaveBeenCalledOnce();
    expect(useUnsaved.getState().why).toBeNull();
  });

  it('still does not continue when the save fails', async () => {
    const save = vi.fn().mockResolvedValue(false);
    edited({ save });
    const asked = keepEdits({ key: 'confirm.whyOpen' });
    for (let tries = 0; useUnsaved.getState().why === null; tries++) {
      if (tries > 1000) throw new Error('대화상자가 뜨지 않았다');
      await Promise.resolve();
    }

    shortcutSave();

    expect(await asked).toBe(false);
  });

  it('does not answer while a save is running (saving) — same rule as the dialog save button', async () => {
    const save = vi.fn().mockResolvedValue(true);
    edited({ save, saving: true });
    const asked = keepEdits({ key: 'confirm.whyOpen' });
    for (let tries = 0; useUnsaved.getState().why === null; tries++) {
      if (tries > 1000) throw new Error('대화상자가 뜨지 않았다');
      await Promise.resolve();
    }

    shortcutSave();

    expect(save).not.toHaveBeenCalled();
    expect(useUnsaved.getState().why).not.toBeNull();
    useUnsaved.getState().reply('cancel');
    expect(await asked).toBe(false);
  });
});

describe('keepEdits · waits for the preview commit (spec §4)', () => {
  let unregister: (() => void) | null = null;

  afterEach(() => {
    unregister?.();
    unregister = null;
    vi.useRealTimers();
  });

  it('waits for a commit still in flight before asking', async () => {
    // The focusout commit rides postMessage and can arrive after the unsaved
    // check — judging without asking would replace without a question, and the
    // edit in progress would vanish silently (Principle 3).
    unregister = registerPreviewFlush(async () => {
      // The commit reaches the store only after the request — in reality the edit message arrives in between.
      edited();
    });

    const asked = keepEdits({ key: 'confirm.whyOpen' });
    await answerWith('cancel');

    expect(await asked).toBe(false);
  });

  it('does not judge before the request settles', async () => {
    let release: () => void = () => {};
    unregister = registerPreviewFlush(() => new Promise((r) => (release = r)));

    const asked = keepEdits({ key: 'confirm.whyOpen' });
    // Before the answer — nothing asked, nothing progressed yet.
    await Promise.resolve();
    await Promise.resolve();
    expect(useUnsaved.getState().why).toBeNull();

    edited();
    release();
    await answerWith('discard');

    expect(await asked).toBe(true);
  });

  it('with no answer from the preview, waits only to the limit and proceeds on what is known', async () => {
    // A preview that cannot answer cannot send commits either — waiting longer
    // brings no edits worth protecting, and only holds the user's click hostage (spec §4).
    vi.useFakeTimers();
    unregister = registerPreviewFlush(() => new Promise(() => {}));

    const asked = keepEdits({ key: 'confirm.whyOpen' });
    await vi.advanceTimersByTimeAsync(FLUSH_TIMEOUT);

    expect(await asked).toBe(true);
    expect(useUnsaved.getState().why).toBeNull();
  });

  it('retreats without asking when a newer flow reserved during the commit wait (spec §5)', async () => {
    // Asking while displaced would cancel the newest flow's question, and answered
    // with save the displaced flow would call save(), losing the user's last choice.
    edited();
    const mine = reserveReplacement();
    unregister = registerPreviewFlush(async () => {
      // While waiting for the answer the user dropped another file — a newer reservation stands.
      reserveReplacement();
    });

    expect(await keepEdits({ key: 'confirm.whyOpen' }, mine)).toBe(false);
    // No question appeared — a displaced flow's question would cancel the newest flow's.
    expect(useUnsaved.getState().why).toBeNull();
  });

  it('displaced while awaiting the answer, even a save answer does not call save() (spec §5)', async () => {
    // The reservation is re-checked the moment the answer returns — otherwise the
    // displaced flow's "save" answer would call save(), writing the old flow's
    // output to the file over the user's last choice.
    const save = vi.fn().mockResolvedValue(true);
    edited({ save });
    const mine = reserveReplacement();

    const asked = keepEdits({ key: 'confirm.whyOpen' }, mine);
    for (let tries = 0; useUnsaved.getState().why === null; tries++) {
      if (tries > 1000) throw new Error('대화상자가 뜨지 않았다');
      await Promise.resolve();
    }
    // While the question was up the user dropped another file — a newer reservation stands.
    reserveReplacement();
    useUnsaved.getState().reply('save');

    expect(await asked).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it('displaced while waiting on the save, it does not continue (spec §5)', async () => {
    // The file was written and that belongs to the file — but the install that
    // follows belongs to the newest flow; returning true here would have the
    // displaced flow try to install the old document.
    const save = vi.fn().mockImplementation(async () => {
      // While writing, the user dropped another file — a newer reservation stands.
      reserveReplacement();
      return true;
    });
    edited({ save });
    const mine = reserveReplacement();

    const asked = keepEdits({ key: 'confirm.whyOpen' }, mine);
    await answerWith('save');

    expect(await asked).toBe(false);
    expect(save).toHaveBeenCalledOnce();
  });

  it('does not ask once unregistered — without a preview there is no edit to commit', async () => {
    const flush = vi.fn().mockResolvedValue(undefined);
    registerPreviewFlush(flush)();

    expect(await keepEdits({ key: 'confirm.whyOpen' })).toBe(true);
    expect(flush).not.toHaveBeenCalled();
  });
});
