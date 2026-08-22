// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { onBeforeUnload } from './unsaved.js';

let dispose: (() => void) | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
});

/** Sent cancelable, like a real tab close — we must see whether it was blocked */
function leave(): Event {
  const e = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(e);
  return e;
}

describe('onBeforeUnload', () => {
  it('blocks leaving while there are unsaved changes', () => {
    dispose = onBeforeUnload(() => true);

    expect(leave().defaultPrevented).toBe(true);
  });

  it('does not interfere without changes', () => {
    dispose = onBeforeUnload(() => false);

    expect(leave().defaultPrevented).toBe(false);
  });

  it('asks anew on every event — closing right after saving must not be blocked', () => {
    let dirty = true;
    dispose = onBeforeUnload(() => dirty);

    expect(leave().defaultPrevented).toBe(true);
    dirty = false;
    expect(leave().defaultPrevented).toBe(false);
  });

  it('stops blocking once removed', () => {
    onBeforeUnload(() => true)();

    expect(leave().defaultPrevented).toBe(false);
  });
});
