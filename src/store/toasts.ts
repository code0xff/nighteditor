/**
 * 화면 오른쪽 위에 뜨는 알림 목록 (spec §4).
 *
 * 문장이 아니라 **메시지 키**를 담는다. 언어를 바꾸면 이미 떠 있는 알림도 함께 바뀌어야
 * 한다 — 스토어가 문장을 만들어 두면 그때 언어가 굳는다 (spec §1 · UI 언어).
 */
import { create } from 'zustand';
import type { Notice } from '@/lib/messages';

/** `error` 는 스스로 사라지지 않는다. `locked` 는 잠긴 블록을 눌렀을 때다 */
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

/** 한 번에 이만큼만 쌓는다. 넘치면 오래된 것부터 밀어낸다 */
const MAX = 4;

/**
 * 넘친 만큼 오래된 것부터 비우되, **오류는 밀어내지 않는다** (spec §4).
 *
 * 오류는 사람이 닫기 전까지 화면에 있어야 한다 — 잠긴 블록 몇 번 눌렀다고 저장
 * 실패가 사라지면, 스스로 사라진 것과 다르지 않다. 전부 오류면 한도를 넘겨서라도 남긴다.
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
      // 같은 알림이 연달아 오면 새로 쌓지 않고 맨 위의 것을 갈아 끼운다.
      // 잠긴 블록을 여러 번 누르면 같은 문장이 화면을 덮는다.
      const last = state.toasts[state.toasts.length - 1];
      const same = last && last.notice.key === notice.key && last.tone === tone;
      const kept = same ? state.toasts.slice(0, -1) : state.toasts;
      return { toasts: evict([...kept, { key: nextKey++, notice, tone }]) };
    }),

  dismiss: (key) => set((state) => ({ toasts: state.toasts.filter((t) => t.key !== key) })),
  clear: () => set({ toasts: [] }),
}));
