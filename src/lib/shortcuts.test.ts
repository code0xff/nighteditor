// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onEditorShortcuts } from './shortcuts.js';

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

function mount() {
  const save = vi.fn();
  const downloadCopy = vi.fn();
  const undo = vi.fn();
  dispose = onEditorShortcuts({ save, downloadCopy, undo });
  return { save, downloadCopy, undo };
}

/** 입력 칸에 포커스가 있는 상황을 만든다 */
function field(tag: 'input' | 'textarea'): HTMLElement {
  const el = document.createElement(tag);
  document.body.append(el);
  return el;
}

describe('onEditorShortcuts · 저장', () => {
  it('Ctrl+S 와 ⌘S 를 잡고 브라우저 기본 저장을 막는다', () => {
    const { save, downloadCopy } = mount();

    expect(press({ key: 's', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(press({ key: 's', metaKey: true }).defaultPrevented).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
    expect(downloadCopy).not.toHaveBeenCalled();
  });

  it('대문자 S 도 같다 — CapsLock 이 켜져 있어도 저장돼야 한다', () => {
    const { save } = mount();

    press({ key: 'S', ctrlKey: true });

    expect(save).toHaveBeenCalledOnce();
  });
});

describe('onEditorShortcuts · 사본 내려받기', () => {
  it('Shift 가 끼면 사본 내려받기다 — 덮어쓰기와 갈라져야 한다', () => {
    const { save, downloadCopy } = mount();

    const e = press({ key: 's', ctrlKey: true, shiftKey: true });

    expect(downloadCopy).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
  });
});

describe('onEditorShortcuts · 건드리지 않는 것', () => {
  it('수식키 없는 s 와 Alt 조합은 흘려보낸다', () => {
    const { save, downloadCopy } = mount();

    const plain = press({ key: 's' });
    const alt = press({ key: 's', ctrlKey: true, altKey: true });

    expect(save).not.toHaveBeenCalled();
    expect(downloadCopy).not.toHaveBeenCalled();
    expect([plain.defaultPrevented, alt.defaultPrevented]).toEqual([false, false]);
  });

  it('떼면 더 이상 잡지 않는다', () => {
    const save = vi.fn();
    const downloadCopy = vi.fn();
    const undo = vi.fn();
    onEditorShortcuts({ save, downloadCopy, undo })();

    press({ key: 's', ctrlKey: true });

    expect(save).not.toHaveBeenCalled();
  });
});

describe('onEditorShortcuts · 되돌리기', () => {
  it('Ctrl+Z 는 마지막 변경을 되돌린다', () => {
    const { undo, save } = mount();

    const e = press({ key: 'z', ctrlKey: true });

    expect(undo).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
  });

  it('입력 칸 안에서는 비껴간다 — 제목을 고치다 누른 Ctrl+Z 는 그 칸의 undo 다', () => {
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

  it('Ctrl+Shift+Z(redo)는 잡지 않는다 — 다시 실행은 없다', () => {
    const { undo } = mount();

    const e = press({ key: 'z', ctrlKey: true, shiftKey: true });

    expect(undo).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });
});
