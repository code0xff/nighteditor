import { normalizeText } from './entities.js';
import type { Block } from './types.js';

/**
 * 렌더된 프리뷰의 실제 텍스트와 소스를 대조해 편집 불가 블록을 잠근다 (ADR-005).
 *
 * 스크립트가 어떤 텍스트를 생성·변조하는지 정적으로 알아내는 일반해는 없다.
 * 하지만 "결과가 소스와 다른가"는 렌더 한 번으로 확실히 알 수 있다.
 * 처음 보는 아티팩트에도 안전하다 — 이해하지 못하면 잠글 뿐이다 (대원칙 3).
 *
 * @param liveText 블록 id → 렌더 후 DOM 의 textContent
 */
export function applyLiveLocks(
  blocks: readonly Block[],
  liveText: ReadonlyMap<number, string>
): Block[] {
  return blocks.map((block) => {
    if (block.locked !== null) return block;

    const live = liveText.get(block.id);
    // 마커가 사라졌다면 스크립트가 그 노드를 들어냈다는 뜻이다.
    if (live === undefined) return { ...block, locked: 'SCRIPT_GENERATED' };

    // INV-8 · 양쪽 모두 디코딩된 텍스트다. sourceText 는 파싱 시점에 정규화되어 있고
    // live 는 DOM 의 textContent 라 이미 디코딩된 값이다.
    if (normalizeText(live) !== block.sourceText) {
      return { ...block, locked: 'SCRIPT_GENERATED' };
    }
    return block;
  });
}
