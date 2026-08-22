/**
 * The stack of notifications at the top right of the screen (spec §4).
 *
 * It holds **message keys**, not sentences. Switching the language must also
 * change notifications already on screen — if the store built the sentences, the
 * language would be frozen at that moment (spec §1 · UI language).
 */
import { create } from 'zustand';
import type { Notice } from '@/lib/messages';

/** `error` never disappears on its own. `locked` is for clicking a locked block */
export type ToastTone = 'info' | 'error' | 'locked';

export interface Toast {
  key: number;
  notice: Notice;
  tone: ToastTone;
}

interface ToastState {
  toasts: Toast[];
  show: (notice: Notice, tone?: ToastTone) => void;
  dismiss: (key: number) => void;
  clear: () => void;
}

/** Only this many stack at once. Overflow pushes out the oldest first */
const MAX = 4;

/**
 * Evicts the oldest past the limit, but **never evicts errors** (spec §4).
 *
 * An error must stay on screen until a person dismisses it — if a few clicks on a
 * locked block could push out a save failure, it might as well have vanished on
 * its own. If everything is an error, keep them all even past the limit.
 */
function evict(toasts: Toast[]): Toast[] {
  let over = toasts.length - MAX;
  if (over <= 0) return toasts;
  return toasts.filter((t) => {
    if (t.tone === 'error' || over <= 0) return true;
    over--;
    return false;
  });
}

let nextKey = 0;

export const useToasts = create<ToastState>((set) => ({
  toasts: [],

  show: (notice, tone = 'info') =>
    set((state) => {
      // Consecutive identical notifications replace the top one instead of stacking.
      // Clicking a locked block a few times would otherwise cover the screen with
      // the same sentence.
      const last = state.toasts[state.toasts.length - 1];
      const same = last && last.notice.key === notice.key && last.tone === tone;
      const kept = same ? state.toasts.slice(0, -1) : state.toasts;
      return { toasts: evict([...kept, { key: nextKey++, notice, tone }]) };
    }),

  dismiss: (key) => set((state) => ({ toasts: state.toasts.filter((t) => t.key !== key) })),
  clear: () => set({ toasts: [] }),
}));
