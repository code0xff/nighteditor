import { injectAgentScript, injectEditorStyle, markerEdits } from '@/core/markers';
import { applyEdits } from '@/core/edits';
import type { AssetSwap } from '@/core/assets';
import { previewAgent } from '@/preview/agent';
import type { Block } from '@/core/types';

/**
 * iframe 에 넣을 프리뷰 문서를 만든다.
 *
 * `previewAgent` 를 **호출하지 않고 문자열화만** 한다 (ADR-007). 실행은 iframe 안에서
 * 일어나므로 호스트와 프리뷰는 여전히 별개 실행 컨텍스트이고, 통신은 postMessage 뿐이다.
 *
 * 자원 치환은 완성된 목록(`assetSwaps`)으로 받는다 (ADR-011) — 여기서 따로 계산하면
 * 되돌림 경계(assetBoundary)가 쓰는 표기와 어긋나는 짝이 생긴다. 없으면 문서를
 * 그대로 보여준다 (spec §5.1).
 *
 * 마커 주입과 자원 치환은 둘 다 원본 offset 을 쓴다. 따로 적용하면 앞선 편집이
 * 뒤쪽 offset 을 밀어 엉뚱한 자리를 자르므로 한 목록으로 모아 적용한다 (ADR-009).
 */
export function buildPreviewDocument(
  source: string,
  blocks: readonly Block[],
  swaps: readonly AssetSwap[] = []
): string {
  const edits = [
    ...markerEdits(source, blocks),
    ...swaps.map(({ start, end, to }) => ({ start, end, text: to })),
  ];

  return injectAgentScript(injectEditorStyle(applyEdits(source, edits)), previewAgent.toString());
}
