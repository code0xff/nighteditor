import type { Block } from './types.js';

/** 프리뷰에서 DOM 노드를 원본 블록으로 되짚기 위한 표식 (ADR-003) */
export const MARKER_ATTR = 'data-ne-id';

export class MarkerError extends Error {}

/**
 * 프리뷰용 HTML 을 만든다. 각 블록의 여는 태그에 `data-ne-id` 를 넣는다.
 *
 * 라이브 DOM 에서 뽑은 구조 경로는 쓸 수 없다. 아티팩트 스크립트가 DOM 을
 * 재구성하기 때문이다(레퍼런스 파일의 `wrapSheets()` 는 슬라이드의 자식 전체를
 * 새 wrapper 로 옮긴다). `appendChild` 는 노드를 **이동**시키므로 속성은 그대로
 * 따라간다 — 마커는 DOM 을 어떻게 휘저어도 살아남는다.
 *
 * 결과물은 **프리뷰 전용**이다. 저장 경로는 언제나 원본 문자열에서 출발하므로
 * 마커가 저장본에 섞일 수 없다 (INV-3).
 */
export function injectMarkers(source: string, blocks: readonly Block[]): string {
  // 뒤에서부터 넣어야 앞쪽 offset 이 밀리지 않는다 (INV-4 와 같은 이유).
  const ordered = [...blocks].sort((a, b) => b.innerStart - a.innerStart);

  let out = source;
  for (const block of ordered) {
    // innerStart 는 여는 태그의 '>' 다음이다. 그 '>' 바로 앞에 넣는다.
    const at = block.innerStart - 1;
    if (out[at] !== '>') {
      throw new MarkerError(`여는 태그 끝을 찾지 못했다: id=${block.id} <${block.tag}>`);
    }
    out = `${out.slice(0, at)} ${MARKER_ATTR}="${block.id}"${out.slice(at)}`;
  }
  return out;
}
