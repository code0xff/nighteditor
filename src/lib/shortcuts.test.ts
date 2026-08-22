// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onEditorShortcuts } from './shortcuts.js';

let dispose: (() => void) | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
});

/** Sent cancelable, like a real browser key — we must see whether preventDefault ran */
function press(init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(e);
  return e;
}

function mount() {
  const save = vi.fn();
  const downloadCopy = vi.fn();
  const undo = vi.fn();
  dispose = onEditorShortcuts({ save, downloadCopy, undo });
  return { save, downloadCopy, undo };
}

/** Puts focus inside a text field */
function field(tag: 'input' | 'textarea'): HTMLElement {
  const el = document.createElement(tag);
  document.body.append(el);
  return el;
}

describe('onEditorShortcuts · save', () => {
  it('captures Ctrl+S and ⌘S and blocks the browser default save', () => {
    const { save, downloadCopy } = mount();

    expect(press({ key: 's', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(press({ key: 's', metaKey: true }).defaultPrevented).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
    expect(downloadCopy).not.toHaveBeenCalled();
  });

  it('uppercase S works too — saving must work with CapsLock on', () => {
    const { save } = mount();

    press({ key: 'S', ctrlKey: true });

    expect(save).toHaveBeenCalledOnce();
  });
});

describe('onEditorShortcuts · download a copy', () => {
  it('with Shift it downloads a copy — it must diverge from overwriting', () => {
    const { save, downloadCopy } = mount();

    const e = press({ key: 's', ctrlKey: true, shiftKey: true });

    expect(downloadCopy).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
  });
});

describe('onEditorShortcuts · what it leaves alone', () => {
  it('lets plain s and Alt combos pass through', () => {
    const { save, downloadCopy } = mount();

    const plain = press({ key: 's' });
    const alt = press({ key: 's', ctrlKey: true, altKey: true });

    expect(save).not.toHaveBeenCalled();
    expect(downloadCopy).not.toHaveBeenCalled();
    expect([plain.defaultPrevented, alt.defaultPrevented]).toEqual([false, false]);
  });

  it('stops capturing once removed', () => {
    const save = vi.fn();
    const downloadCopy = vi.fn();
    const undo = vi.fn();
    onEditorShortcuts({ save, downloadCopy, undo })();

    press({ key: 's', ctrlKey: true });

    expect(save).not.toHaveBeenCalled();
  });
});

describe('onEditorShortcuts · undo', () => {
  it('Ctrl+Z reverts the last change', () => {
    const { undo, save } = mount();

    const e = press({ key: 'z', ctrlKey: true });

    expect(undo).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
  });

  it("steps aside inside text fields — Ctrl+Z while fixing the title is that field's undo", () => {
    const { undo } = mount();
    const input = field('input');

    const e = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(e);

    expect(undo).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
    input.remove();
  });

  it('does not capture Ctrl+Shift+Z (redo) — there is no redo', () => {
    const { undo } = mount();

    const e = press({ key: 'z', ctrlKey: true, shiftKey: true });

    expect(undo).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });
});
