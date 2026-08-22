/**
 * 호스트(에디터) ↔ 프리뷰(iframe) 메시지 계약.
 *
 * **타입 전용 모듈이다.** 값이나 함수를 여기에 두지 않는다 — 런타임 코드가 생기면
 * preview 와 ui 가 코드를 공유하게 되어 rules §4 를 어긴다.
 * 타입만 있으면 컴파일 후 아무것도 남지 않으므로 두 번들은 여전히 분리된다.
 */

/** 프리뷰 → 호스트. 모든 메시지에 문서의 표(token)가 실린다 — 아래 참조 */
export type FromPreview = {
  /**
   * 이 프리뷰 문서의 표. iframe 은 재사용되고 `srcDoc` 을 갈아 끼워도 `contentWindow`
   * 신원은 그대로라, 옛 문서의 메시지가 출처 검사를 통과한다 — 호스트는 지금 문서의
   * 표가 아닌 메시지를 버린다 (spec §5). 표 없는 에이전트(테스트)만 이 필드가 없다.
   */
  token?: string;
} & FromPreviewBody;

type FromPreviewBody =
  | { type: 'ready'; blocks: { id: number; text: string }[] }
  | { type: 'select'; id: number | null }
  /** pristine 이면 편집 결과가 원래 내용과 같다 — 호스트는 패치를 지운다 */
  | { type: 'edit'; id: number; html: string; pristine: boolean }
  | { type: 'blocked'; id: number }
  /** 대조가 끝나기 전에 블록을 눌렀다 — 편집은 열지 않았고, 호스트가 사정을 말한다 (spec §4) */
  | { type: 'notReady' }
  /**
   * 호스트의 flush 청에 대한 답 (spec §4) — 뜻은 "내보낼 확정을 전부 내보냈다" 다.
   * 열려 있던 편집의 확정(edit)을 **먼저** 보낸 뒤라, 이 답이 닿았다면 그 확정도
   * 이미 호스트에 닿아 있다 — 같은 통로는 순서를 지킨다. 조합 중이라 확정이
   * 미뤄졌으면 답도 함께 미뤄, 미룬 확정이 나가거나 편집이 버려진 뒤에 보낸다.
   */
  | { type: 'flushed'; seq: number }
  /** 프리뷰 안에서 Ctrl+S 를 눌렀다. iframe 의 키 이벤트는 호스트 창에 닿지 않는다 */
  | { type: 'save' }
  /** Ctrl+Shift+S — 원본은 그대로 두고 결과물만 내려받는다 */
  | { type: 'downloadCopy' }
  /** 편집 중이 아닐 때의 Ctrl+Z — 마지막으로 확정한 변경을 되돌린다 */
  | { type: 'undo' };

/** 호스트 → 프리뷰 */
export type ToPreview =
  /**
   * 대조가 끝났다. `ids` 는 잠긴 블록, `all` 은 실제 블록 id **전부**다.
   * 문서가 `data-ne-id` 를 흉내 낼 수 있어(spec §3), 에이전트는 명단에 없는
   * 표식을 블록으로 치지 않는다 — 없으면 가짜 요소에 편집이 열리고 그 확정은
   * 어느 블록의 것도 아니어서 조용히 사라진다.
   */
  | { type: 'locked'; ids: number[]; all: number[] }
  /**
   * 열려 있는 편집을 지금 확정하라 (spec §4). 편집을 잃을 일(닫기·열기·갈아타기)의
   * 물음 전에 보낸다 — 프리뷰의 확정(focusout)은 postMessage 라 호스트의 `unsaved`
   * 판정보다 늦게 닿을 수 있다. 에이전트는 확정을 보낸 뒤 같은 `seq` 로 flushed 를
   * 답한다.
   */
  | { type: 'flush'; seq: number }
  | { type: 'revert'; id: number; html: string }
  /** 변경 목록에서 고른 블록을 화면에 보여준다 (스크롤 + 잠깐 짚어주기) */
  | { type: 'reveal'; id: number }
  /**
   * 서식 막대에 붙일 문구. 에이전트는 언어팩을 불러올 수 없어(ADR-007) 호스트가 건넨다 —
   * 화면 문구의 출처는 언제나 언어팩 하나다 (spec §1).
   */
  | { type: 'labels'; labels: Record<string, string> };
