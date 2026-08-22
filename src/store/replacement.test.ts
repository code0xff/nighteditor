import { describe, expect, it } from 'vitest';
import { reserveReplacement, Superseded } from './replacement.js';

describe('reserveReplacement · guarded (spec §5 · replacement reservation)', () => {
  it('returns the value untouched while still the newest', async () => {
    const mine = reserveReplacement();

    await expect(mine.guarded(Promise.resolve('값'))).resolves.toBe('값');
  });

  it('throws Superseded when displaced during the wait', async () => {
    // Writing the reservation check by hand after each await got the same spot
    // wrong nine times — long steps must go through this channel so the check
    // cannot be forgotten.
    const mine = reserveReplacement();
    const slow = Promise.resolve().then(() => {
      // While waiting, the user dropped another file — a newer reservation stands.
      reserveReplacement();
      return '늦은 값';
    });

    await expect(mine.guarded(slow)).rejects.toBeInstanceOf(Superseded);
  });

  it('passes genuine failures through instead of converting them to the marker', async () => {
    // Converting them would silently swallow the failure notices (Principle 3)
    // of a flow that ended in cancellation.
    const mine = reserveReplacement();

    await expect(mine.guarded(Promise.reject(new Error('원인')))).rejects.toThrow('원인');
  });
});
