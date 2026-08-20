/**
 * 편집 블록 판정 규칙. (docs/spec.md §2)
 *
 * "텍스트를 담은 가장 바깥 요소이면서, 그 안이 인라인 마크업뿐인 것"이 블록이다.
 */

/** 블록 경계를 만들지 않는 태그 — 블록 안에 내용물로 보존된다 */
export const INLINE_TAGS: ReadonlySet<string> = new Set([
  'b',
  'strong',
  'span',
  'br',
  'small',
  'i',
  'em',
  'a',
  'code',
  'u',
  'sup',
  'sub',
]);

/** 내부가 텍스트가 아니라 코드인 태그 — 순회에서 통째로 제외 */
export const RAW_TEXT_TAGS: ReadonlySet<string> = new Set(['script', 'style', 'textarea']);

/** 내부에 태그를 넣을 수 없는 태그 — 평문 전용으로 편집 (spec §2.1) */
export const RCDATA_TAGS: ReadonlySet<string> = new Set(['title']);

/** 기본 잠금 대상 클래스 — 수동 하이라이팅된 코드/JSON 영역 (spec §3) */
export const CODE_BLOCK_CLASSES: readonly string[] = ['code', 'codebox'];

export function isInline(tag: string): boolean {
  return INLINE_TAGS.has(tag);
}

export function hasCodeBlockClass(classAttr: string | undefined): boolean {
  if (!classAttr) return false;
  const classes = classAttr.split(/\s+/);
  return CODE_BLOCK_CLASSES.some((c) => classes.includes(c));
}
