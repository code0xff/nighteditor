import { decodeHTML, escapeText } from 'entities';

/**
 * INV-8 · 비교는 디코딩 후, 저장은 인코딩 후.
 *
 * 엔티티 처리는 이 모듈에만 둔다. 직접 구현하지 않는다 — 명명 엔티티는
 * 2000개가 넘고, 손으로 만든 치환 테이블은 반드시 어딘가에서 틀린다.
 */

/** 소스 문자열의 엔티티를 실제 문자로 (대조 검사용) */
export function decode(html: string): string {
  return decodeHTML(html);
}

/** 사용자 입력을 소스에 기록할 수 있는 형태로 — `&`, `<`, `>` 를 엔티티화 */
export function encode(text: string): string {
  return escapeText(text);
}

/** 공백 차이를 무시한 텍스트 비교용 정규화 */
export function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
