/**
 * Whether the change list is showing on a narrow screen.
 *
 * From `lg` up the list stands beside the preview and this state is never read.
 * Below it the two cannot share the width — 288px of list inside a 500px window
 * leaves the document unreadable — so the list becomes a panel over the
 * preview, and this is its switch.
 */
import { create } from 'zustand';
import { useMediaQuery } from '@/lib/media';

interface PanelState {
  /** True only while the panel is over the preview. Ignored from `lg` up. */
  open: boolean;
  toggle: () => void;
  close: () => void;
}

export const usePanel = create<PanelState>((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  close: () => set({ open: false }),
}));

/** Tailwind's `lg` — the width from which the list fits beside the preview. */
const BESIDE = '(min-width: 1024px)';

/**
 * True while the list has room to stand beside the preview.
 *
 * The layout itself is CSS, not this hook. What needs the answer in JavaScript
 * is reach: below `lg` the panel sits off-screen when closed, and something
 * off-screen must not be reachable by tab. Beside the preview it always is.
 */
export function useListBeside(): boolean {
  return useMediaQuery(BESIDE);
}
