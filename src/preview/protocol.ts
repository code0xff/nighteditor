/**
 * 호스트(에디터) ↔ 프리뷰(iframe) 메시지 계약.
 *
 * **타입 전용 모듈이다.** 값이나 함수를 여기에 두지 않는다 — 런타임 코드가 생기면
 * preview 와 ui 가 코드를 공유하게 되어 rules §4 를 어긴다.
 * 타입만 있으면 컴파일 후 아무것도 남지 않으므로 두 번들은 여전히 분리된다.
 */

/** 프리뷰 → 호스트 */
export type FromPreview =
  | { type: 'ready'; blocks: { id: number; text: string }[] }
  | { type: 'select'; id: number | null }
  /** pristine 이면 편집 결과가 원래 내용과 같다 — 호스트는 패치를 지운다 */
  | { type: 'edit'; id: number; html: string; pristine: boolean }
  | { type: 'blocked'; id: number }
  /** 대조가 끝나기 전에 블록을 눌렀다 — 편집은 열지 않았고, 호스트가 사정을 말한다 (spec §4) */
  | { type: 'notReady' }
  /** 프리뷰 안에서 Ctrl+S 를 눌렀다. iframe 의 키 이벤트는 호스트 창에 닿지 않는다 */
  | { type: 'save' }
  /** Ctrl+Shift+S — 원본은 그대로 두고 결과물만 내려받는다 */
  | { type: 'downloadCopy' }
  /** 편집 중이 아닐 때의 Ctrl+Z — 마지막으로 확정한 변경을 되돌린다 */
  | { type: 'undo' };

/** 호스트 → 프리뷰 */
export type ToPreview =
  | { type: 'locked'; ids: number[] }
  | { type: 'revert'; id: number; html: string }
  /** 변경 목록에서 고른 블록을 화면에 보여준다 (스크롤 + 잠깐 짚어주기) */
  | { type: 'reveal'; id: number }
  /**
   * 서식 막대에 붙일 문구. 에이전트는 언어팩을 불러올 수 없어(ADR-007) 호스트가 건넨다 —
   * 화면 문구의 출처는 언제나 언어팩 하나다 (spec §1).
   */
  | { type: 'labels'; labels: Record<string, string> };
