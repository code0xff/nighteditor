import { decodeHTML, escapeAttribute, escapeText } from 'entities';

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

/**
 * 디코딩된 값을 속성 자리에 되적을 수 있는 형태로.
 *
 * 파서가 준 속성 값은 엔티티가 이미 풀려 있다 (`&quot;` → `"`). 그대로 원본의 속성
 * 자리에 되적으면 따옴표가 값을 조기 종료시켜 뒤가 새 속성으로 풀린다. 그 자리가
 * 어느 따옴표로 싸였는지(혹은 안 싸였는지)는 여기서 알 수 없으므로, 어떤 표기에서도
 * 안전하게 양쪽 따옴표·공백류·`<>=\`` 을 전부 엔티티로 적는다 — 문자 참조는 세 표기
 * 모두에서 유효하고, 브라우저가 도로 풀어 같은 값이 된다.
 */
export function encodeAttribute(text: string): string {
  return escapeAttribute(text).replace(/['<>=`\t\n\f\r ]/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/**
 * 브라우저가 innerHTML 을 직렬화할 때 속성 값에 쓰는 **최소** 인코딩 — `&`·`"`·NBSP.
 *
 * `encodeAttribute` 로 내보낸 보수적 표기는 브라우저를 한 바퀴 돌면 이 표기로
 * 갈아 끼워져 돌아온다. 돌아온 값을 되돌리려면(ADR-011) 내보낸 표기만이 아니라
 * 이 표기의 짝도 함께 들고 있어야 한다.
 */
export function encodeAttributeSerialized(text: string): string {
  return escapeAttribute(text);
}

/**
 * **원문 표기**를 직렬화된 문맥(innerHTML 이 만든 큰따옴표 속성)에 되적을 수 있는 형태로.
 *
 * 디코딩된 값을 재인코딩(`encodeAttributeSerialized`)하면 표준이 아닌 원문 엔티티
 * (`&#32;` 등)가 최소 표기로 갈려, 손대지 않은 속성의 표기가 바뀐다 (대원칙 2).
 * 문자 참조 해석은 따옴표 종류와 무관하므로 원문 바이트를 그대로 두고, 큰따옴표
 * 문맥에서 값을 조기 종료시키는 `"` 하나만 엔티티로 바꾼다 — 홑따옴표·따옴표 없는
 * 원문에만 날 것으로 있을 수 있고, 파서를 지나면 같은 값으로 풀린다.
 */
export function requoteAttribute(raw: string): string {
  return raw.replace(/"/g, '&quot;');
}

/** 공백 차이를 무시한 텍스트 비교용 정규화 */
export function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
