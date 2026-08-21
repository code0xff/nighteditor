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
import { refuseWhileReplacing, type Replacement } from './replacement';

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
 * @param mine 이 물음이 딸린 갈아 끼우기 예약. 저장으로 답하면 **그 순간** 잠근다
 *   (spec §4) — 저장이 파일을 쓰는 사이의 편집도 이어질 설치 순간 갈 곳이 없다.
 *   여기서 잠그지 않으면 그 사이의 편집이 받아졌다가 설치에 조용히 쓸려 나간다.
 *   홀로 도는 저장과 다르다 — 그쪽 편집은 살아남으므로 잠그지 않는다.
 */
export async function keepEdits(why: Notice, mine?: Replacement): Promise<boolean> {
  const { unsaved, save } = useEditor.getState();
  // 이미 파일에 들어간 편집은 잃을 것이 없다. 저장한 뒤에도 되물으면 사람을 지치게 한다.
  if (!unsaved) return true;

  const choice = await useUnsaved.getState().ask(why);
  if (choice === 'cancel') return false;
  if (choice === 'save') {
    mine?.engage();
    return save();
  }
  return true;
}

/**
 * 저장 단축키(`Ctrl+S`)의 저장. **물음이 떠 있으면 그 물음의 "저장하고 계속" 이다**
 * (spec §4 · 저장하지 않은 편집을 지킨다).
 *
 * 물음 옆에서 그냥 `save()` 를 부르면 `unsaved` 만 풀린 채 물음이 남는다. 그 뒤에
 * 대화상자의 저장 버튼을 눌러도 `save()` 가 저장할 것이 없다며 false 를 돌려,
 * 하려던 일(열기·갈아타기)이 조용히 취소된다. 단축키를 물음의 답으로 돌리면
 * 저장도 되고 하려던 일도 이어진다.
 */
export function shortcutSave(): void {
  const { why, reply } = useUnsaved.getState();
  if (why === null) {
    // 갈아 끼우는 동안의 저장은 아직 화면에 떠 있는 **이전** 문서를 쓰는 일이다 —
    // 버리기로 답한 편집이 파일에 적힐 수 있다. 저장 버튼은 잠겨 있지만 단축키는
    // 언제든 눌리므로, 되돌리기(Ctrl+Z)와 같은 자리에서 거절하고 알린다 (spec §4).
    // 물음이 떠 있을 때의 "저장하고 계속" 은 다르다 — 그 저장은 갈아 끼우기의
    // 일부라 막지 않는다.
    if (refuseWhileReplacing('app.saveWhileReplacing')) return;
    void useEditor.getState().save();
    return;
  }
  // 대화상자의 저장 버튼과 같은 기준 — 저장이 도는 동안(saving)에는 겹쳐 답하지 않는다.
  if (useEditor.getState().saving) return;
  reply('save');
}
