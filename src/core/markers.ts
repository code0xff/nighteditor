import type { Block } from './types.js';

/** 프리뷰에서 DOM 노드를 원본 블록으로 되짚기 위한 표식 (ADR-003) */
export const MARKER_ATTR = 'data-ne-id';

export class MarkerError extends Error {}

/**
 * 프리뷰용 HTML 을 만든다. 각 블록의 여는 태그에 `data-ne-id` 를 넣는다.
 *
 * 라이브 DOM 에서 뽑은 구조 경로는 쓸 수 없다. 아티팩트 스크립트가 DOM 을
 * 재구성하기 때문이다(실측 아티팩트의 `wrapSheets()` 는 슬라이드의 자식 전체를
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

/**
 * 프리뷰 에이전트를 문서 맨 앞에 주입한다 (ADR-007).
 *
 * 주입 위치가 정확성 조건이다. 에이전트는 아티팩트 스크립트보다 **먼저** 리스너를
 * 걸어야 버블 단계에서 먼저 실행되고, 그래야 아티팩트의 전역 핸들러를 막을 수 있다.
 * 아티팩트 스크립트는 대개 `<body>` 끝에 있으므로 `<head>` 맨 앞이면 충분하다.
 */
export function injectAgentScript(html: string, agentSource: string): string {
  // 에이전트 소스 안의 `</script>` 는 인라인 스크립트를 조기 종료시킨다.
  const safe = agentSource.replace(/<\/script/gi, '<\\/script');
  const script = `<script>(${safe})();</script>`;

  const anchor = /<head[^>]*>/i.exec(html) ?? /<html[^>]*>/i.exec(html);
  if (!anchor) return script + html;

  const at = anchor.index + anchor[0].length;
  return html.slice(0, at) + script + html.slice(at);
}
