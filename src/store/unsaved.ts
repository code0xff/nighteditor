/**
 * 저장하지 않은 편집이 있을 때 무엇을 할지 묻는다 (spec §4).
 *
 * 브라우저의 `confirm` 은 버튼이 둘뿐이라 "버릴래?" 밖에 못 묻는다. 사용자가 정작
 * 하고 싶은 것은 대개 **저장하고 계속**인데, 그 선택지가 없어 취소하고 저장하고
 * 다시 시도하는 세 걸음을 걷게 만든다.
 *
 * 부르는 쪽은 `ask()` 한 줄로 답을 기다린다. 화면에 대화상자를 그리는 것은
 * `UnsavedDialog` 하나뿐이고, 상태는 여기 한곳에 있다.
 */
import { create } from 'zustand';
import type { Notice } from '@/lib/messages';
import { useEditor } from './editor';

export type UnsavedChoice = 'save' | 'discard' | 'cancel';

interface UnsavedState {
  /** 무엇을 하려다 멈췄는지. null 이면 묻는 중이 아니다 */
  why: Notice | null;
  answer: ((choice: UnsavedChoice) => void) | null;
  ask: (why: Notice) => Promise<UnsavedChoice>;
  reply: (choice: UnsavedChoice) => void;
}

export const useUnsaved = create<UnsavedState>((set, get) => ({
  why: null,
  answer: null,

  ask: (why) =>
    new Promise<UnsavedChoice>((resolve) => {
      // 이미 묻고 있었다면 그 물음은 취소로 닫는다. 답을 기다리는 프라미스를
      // 그대로 두면 부른 쪽이 영영 풀리지 않는다.
      get().answer?.('cancel');
      set({ why, answer: resolve });
    }),

  reply: (choice) => {
    const { answer } = get();
    set({ why: null, answer: null });
    answer?.(choice);
  },
}));

/**
 * 편집을 잃을 수 있는 일을 하기 전에 부른다. 계속해도 되면 true.
 *
 * 고친 것이 없거나 이미 저장했으면 묻지 않는다 — 물을 것이 없는데 묻는 대화상자는 방해다.
 * 저장을 골랐는데 저장이 실패하면 **계속하지 않는다.** 그대로 넘어가면
 * 저장한 줄 알았던 편집이 사라진다.
 *
 * @param why 무엇 때문에 사라지는지 — 물음에 그대로 들어간다
 */
export async function keepEdits(why: Notice): Promise<boolean> {
  const { unsaved, save } = useEditor.getState();
  // 이미 파일에 들어간 편집은 잃을 것이 없다. 저장한 뒤에도 되물으면 사람을 지치게 한다.
  if (!unsaved) return true;

  const choice = await useUnsaved.getState().ask(why);
  if (choice === 'cancel') return false;
  if (choice === 'save') return save();
  return true;
}
