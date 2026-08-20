// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { onBeforeUnload } from './unsaved.js';

let dispose: (() => void) | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
});

/** 실제 탭 닫기처럼 cancelable 로 보낸다 — 막았는지 봐야 한다 */
function leave(): Event {
  const e = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(e);
  return e;
}

describe('onBeforeUnload', () => {
  it('저장하지 않은 변경이 있으면 떠나기를 막는다', () => {
    dispose = onBeforeUnload(() => true);

    expect(leave().defaultPrevented).toBe(true);
  });

  it('변경이 없으면 방해하지 않는다', () => {
    dispose = onBeforeUnload(() => false);

    expect(leave().defaultPrevented).toBe(false);
  });

  it('이벤트마다 다시 묻는다 — 저장 직후 닫기가 막히면 안 된다', () => {
    let dirty = true;
    dispose = onBeforeUnload(() => dirty);

    expect(leave().defaultPrevented).toBe(true);
    dirty = false;
    expect(leave().defaultPrevented).toBe(false);
  });

  it('떼면 더 이상 막지 않는다', () => {
    onBeforeUnload(() => true)();

    expect(leave().defaultPrevented).toBe(false);
  });
});
