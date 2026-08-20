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
  /** 프리뷰 안에서 Ctrl+S 를 눌렀다. iframe 의 키 이벤트는 호스트 창에 닿지 않는다 */
  | { type: 'save' };

/** 호스트 → 프리뷰 */
export type ToPreview =
  { type: 'locked'; ids: number[] } | { type: 'revert'; id: number; html: string };
