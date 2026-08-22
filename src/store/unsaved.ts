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
import { refuseWhileReplacing, Superseded, type Replacement } from './replacement';

export type UnsavedChoice = 'save' | 'discard' | 'cancel';

/**
 * 프리뷰에 "지금 편집 중이면 확정하고 알려 달라" 청하는 통로 (spec §4).
 *
 * 프리뷰를 그리는 화면(PreviewFrame)이 자기 iframe 으로 청하는 함수를 걸어 둔다 —
 * 스토어는 iframe 을 모른다. 돌려주는 프라미스는 프리뷰의 답(flushed)에 풀린다.
 */
let flushPreview: (() => Promise<void>) | null = null;

/** @returns 걸어둔 함수를 떼는 함수 — 더 새 등록을 덮어 떼지는 않는다 */
export function registerPreviewFlush(fn: () => Promise<void>): () => void {
  flushPreview = fn;
  return () => {
    if (flushPreview === fn) flushPreview = null;
  };
}

/**
 * 프리뷰 확정 답을 기다리는 한도 (spec §4).
 *
 * 정상 프리뷰의 답은 한 순회(수 ms)에 온다 — 한도는 프리뷰가 죽었거나 아티팩트
 * 스크립트가 이벤트 루프를 붙들고 있을 때만 발동한다. 그 상태의 프리뷰는
 * 확정(focusout)도 보낼 수 없으므로 더 기다려도 지킬 편집이 새로 오지 않는다 —
 * 기다림은 사용자의 클릭만 붙든다. 1초는 무거운 아티팩트 스크립트의 긴 작업
 * 한 번쯤은 넘기고, 죽은 프리뷰 앞에서의 멈칫거림으로는 참을 만한 값이다.
 */
export const FLUSH_TIMEOUT = 1000;

/**
 * 프리뷰에 열려 있는 편집을 확정시키고 그 답을 (한도까지만) 기다린다.
 *
 * 확정과 답은 같은 postMessage 통로로 순서대로 오므로, 답이 왔다면 확정도 이미
 * 스토어에 닿아 있다 — 이 뒤에 읽는 `unsaved` 는 그 편집을 안다.
 */
export async function flushPreviewEdits(): Promise<void> {
  const ask = flushPreview;
  if (!ask) return;
  await Promise.race([ask(), new Promise<void>((done) => setTimeout(done, FLUSH_TIMEOUT))]);
}

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
  // 예약이 딸린 흐름의 긴 단계는 guarded 를 지난다 (spec §5 · 갈아 끼우기 예약) —
  // 기다리는 사이에도 더 새 흐름은 예약하고, 밀려난 채 물으면 이 물음이 최신 흐름의
  // 물음을 취소하고, 저장으로 답하면 밀려난 흐름이 save() 를 불러 사용자의 마지막
  // 선택이 사라진다. 예약 없이 부르면 판정할 것이 없어 그대로 기다린다.
  const pass = <T>(p: Promise<T>): Promise<T> => (mine ? mine.guarded(p) : p);
  try {
    // 프리뷰에서 편집 중이던 블록의 확정(focusout)은 postMessage 로 떠 있을 뿐이라
    // 아직 도착 전일 수 있다 — 그대로 unsaved 를 읽으면 묻지 않고 갈아 끼우고, 늦게
    // 온 확정은 프리뷰가 내려가며 조용히 사라진다 (대원칙 3). 판정 전에 확정을 청해
    // 그 답까지 기다린다. 이미 unsaved 여도 청한다 — "저장하고 계속" 이 열려 있던
    // 편집까지 담아야 하기 때문이다 (spec §4).
    await pass(flushPreviewEdits());
    const { unsaved, save } = useEditor.getState();
    // 이미 파일에 들어간 편집은 잃을 것이 없다. 저장한 뒤에도 되물으면 사람을 지치게 한다.
    if (!unsaved) return true;

    const choice = await useUnsaved.getState().ask(why);
    if (choice === 'cancel') return false;
    if (choice === 'save') {
      mine?.engage();
      // 물음이 떠 있는 사이에도 상태는 움직인다 — 단축키로 부른 저장이 그 사이 끝났거나,
      // 마지막 편집을 되돌려 이미 파일과 같아졌을 수 있다. 그때 save() 는 "쓸 것 없음"
      // 으로 false 를 돌려주는데, 그것을 실패로 읽으면 청한 저장이 이미 충족됐는데도
      // 하려던 일이 조용히 취소된다. 깨끗하면 저장된 것으로 치고 계속한다 (spec §4).
      if (!useEditor.getState().unsaved) return true;
      return await save();
    }
    return true;
  } catch (e) {
    // 이 함수의 답은 불리언이다 — 밀려남의 표식을 그대로 던지면 예약 없이 부르는
    // 쪽까지 try 를 갖춰야 한다. 여기서 "계속하지 않는다" 로 접는다 (조용한 물러남).
    if (e instanceof Superseded) return false;
    throw e;
  }
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
