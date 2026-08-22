import { normalizeText } from './entities.js';
import type { Block } from './types.js';

/**
 * 렌더된 프리뷰의 실제 텍스트와 소스를 대조해 편집 불가 블록을 잠근다 (ADR-005).
 *
 * 스크립트가 어떤 텍스트를 생성·변조하는지 정적으로 알아내는 일반해는 없다.
 * 하지만 "결과가 소스와 다른가"는 렌더 한 번으로 확실히 알 수 있다.
 * 처음 보는 아티팩트에도 안전하다 — 이해하지 못하면 잠글 뿐이다 (대원칙 3).
 *
 * @param live 렌더 후 DOM 에서 마커별로 모은 { id, textContent } — 마지막 것만
 *   추리지 않고 **겹침째로** 받는다. 같은 id 가 둘 보이면 문서(또는 스크립트)가
 *   우리 표식을 흉내 낸 것이고, 어느 쪽이 원본 블록인지 렌더만으로는 가릴 수 없다 —
 *   추측으로 고치면 가짜 요소의 내용이 그 블록의 편집으로 저장에 실리므로
 *   `MARKER_CLASH` 로 잠근다 (spec §3 · 대원칙 3).
 */
export function applyLiveLocks(
  blocks: readonly Block[],
  live: readonly { id: number; text: string }[]
): Block[] {
  const liveText = new Map<number, string>();
  const clashed = new Set<number>();
  for (const { id, text } of live) {
    if (liveText.has(id)) clashed.add(id);
    else liveText.set(id, text);
  }
  return blocks.map((block) => {
    if (block.locked !== null) return block;

    // 흉내의 텍스트가 우연히(또는 일부러) 소스와 같아도 잠근다 — 문제는 내용이
    // 아니라 어느 요소가 이 블록인지 되짚을 수 없다는 것이다.
    if (clashed.has(block.id)) return { ...block, locked: 'MARKER_CLASH' };

    const text = liveText.get(block.id);
    // 마커가 사라졌다면 스크립트가 그 노드를 들어냈다는 뜻이다.
    if (text === undefined) return { ...block, locked: 'SCRIPT_GENERATED' };

    // INV-8 · 양쪽 모두 디코딩된 텍스트다. sourceText 는 파싱 시점에 정규화되어 있고
    // text 는 DOM 의 textContent 라 이미 디코딩된 값이다.
    if (normalizeText(text) !== block.sourceText) {
      return { ...block, locked: 'SCRIPT_GENERATED' };
    }
    return block;
  });
}
