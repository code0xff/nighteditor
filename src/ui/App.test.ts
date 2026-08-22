// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useEditor } from '@/store/editor';
import { useUnsaved } from '@/store/unsaved';
import { App } from './App';

// React's act only accepts this as a test environment, and runs without warnings, when this flag is set.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

beforeEach(() => {
  useEditor.setState({ file: null, patches: new Map(), unsaved: false, notice: null });
  useUnsaved.setState({ why: null, answer: null });
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

/** Sent cancelable like a real tab close — we must see whether it was blocked */
function leave(): Event {
  const e = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(e);
  return e;
}

describe('App · the leave confirmation asks on "differs from the file" (spec §4)', () => {
  it('does not hold the user after a save, even with patches remaining', () => {
    // Patches survive a save (INV-1). Asking on them would hold even someone
    // who saved, every time they leave.
    act(() => {
      root = createRoot(host!);
      root.render(createElement(App));
    });

    act(() => {
      useEditor.setState({ patches: new Map([[0, '고친 값']]), unsaved: false });
    });

    expect(leave().defaultPrevented).toBe(false);
  });

  it('holds the user when edits are missing from the file', () => {
    act(() => {
      root = createRoot(host!);
      root.render(createElement(App));
    });

    act(() => {
      useEditor.setState({ patches: new Map([[0, '고친 값']]), unsaved: true });
    });

    expect(leave().defaultPrevented).toBe(true);
  });
});

describe('App · Ctrl+S while the prompt is up (spec §4)', () => {
  it('does not save and leave the prompt behind — it answers the prompt with "save and continue"', () => {
    // Saving alone leaves the prompt up with unsaved cleared; pressing save
    // afterwards finds nothing to save and the pending action (open, switch)
    // gets cancelled.
    act(() => {
      root = createRoot(host!);
      root.render(createElement(App));
    });
    const save = vi.fn().mockResolvedValue(true);
    const answer = vi.fn();
    act(() => {
      useEditor.setState({ unsaved: true, saving: false, save });
      useUnsaved.setState({ why: { key: 'confirm.whyOpen' }, answer });
    });

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true })
      );
    });

    // save() is not called directly — the answer flows into keepEdits and the save continues there.
    expect(answer).toHaveBeenCalledWith('save');
    expect(save).not.toHaveBeenCalled();
  });
});

describe('App · a folder walk that fails while the prompt is up (spec §5.1)', () => {
  it('reports the walk failure even on cancel — a failure no one awaits must not vanish', async () => {
    // The walk starts before the question (entries vanish when the event
    // ends). Catching the failure only after the answer means that on cancel
    // no one awaits the promise, and the failure vanishes without notice as an
    // unhandled rejection (Principle 3).
    act(() => {
      root = createRoot(host!);
      root.render(createElement(App));
    });
    act(() => {
      useEditor.setState({ unsaved: true });
    });

    // A folder entry that dies mid-walk — readEntries failing on access denial and the like.
    const entry = {
      isDirectory: true,
      name: 'deck',
      createReader: () => ({
        readEntries: (_ok: unknown, err: (e: Error) => void) =>
          err(new Error('폴더를 읽을 수 없어요')),
      }),
    };
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', {
      value: { files: [], items: [{ webkitGetAsEntry: () => entry }] },
    });

    await act(async () => {
      host!.firstElementChild!.dispatchEvent(drop);
      // The walk failure and the prompt arrive as microtasks — step until the prompt shows.
      for (let tries = 0; useUnsaved.getState().why === null && tries < 1000; tries++) {
        await Promise.resolve();
      }
      useUnsaved.getState().reply('cancel');
      // The failure notice must still stand after cancelling — let a few more tasks pass.
      for (let tries = 0; tries < 10; tries++) await Promise.resolve();
    });

    expect(useUnsaved.getState().why).toBeNull();
    expect(useEditor.getState().notice).toEqual({
      key: 'notice.openFailedDetail',
      params: { detail: '폴더를 읽을 수 없어요' },
    });
  });
});
