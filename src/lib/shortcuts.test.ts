// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onSaveShortcut } from './shortcuts.js';

let dispose: (() => void) | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
});

/** 실제 브라우저 키처럼 cancelable 로 보낸다 — preventDefault 여부를 봐야 한다 */
function press(init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(e);
  return e;
}

describe('onSaveShortcut', () => {
  it('Ctrl+S 와 ⌘S 를 잡고 브라우저 기본 저장을 막는다', () => {
    const save = vi.fn();
    dispose = onSaveShortcut(save);

    expect(press({ key: 's', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(press({ key: 's', metaKey: true }).defaultPrevented).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('대문자 S 도 같다 — CapsLock 이 켜져 있어도 저장돼야 한다', () => {
    const save = vi.fn();
    dispose = onSaveShortcut(save);

    press({ key: 'S', ctrlKey: true });

    expect(save).toHaveBeenCalledOnce();
  });

  it('다른 조합은 건드리지 않는다 — 사본 내려받기 자리를 비워 둔다', () => {
    const save = vi.fn();
    dispose = onSaveShortcut(save);

    const plain = press({ key: 's' });
    const shift = press({ key: 's', ctrlKey: true, shiftKey: true });
    const alt = press({ key: 's', ctrlKey: true, altKey: true });

    expect(save).not.toHaveBeenCalled();
    expect([plain.defaultPrevented, shift.defaultPrevented, alt.defaultPrevented]).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('떼면 더 이상 잡지 않는다', () => {
    const save = vi.fn();
    onSaveShortcut(save)();

    press({ key: 's', ctrlKey: true });

    expect(save).not.toHaveBeenCalled();
  });
});
