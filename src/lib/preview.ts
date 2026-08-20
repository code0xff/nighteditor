import { injectAgentScript, injectMarkers } from '@/core/markers';
import { previewAgent } from '@/preview/agent';
import type { Block } from '@/core/types';

/**
 * iframe 에 넣을 프리뷰 문서를 만든다.
 *
 * `previewAgent` 를 **호출하지 않고 문자열화만** 한다 (ADR-007). 실행은 iframe 안에서
 * 일어나므로 호스트와 프리뷰는 여전히 별개 실행 컨텍스트이고, 통신은 postMessage 뿐이다.
 */
export function buildPreviewDocument(source: string, blocks: readonly Block[]): string {
  return injectAgentScript(injectMarkers(source, blocks), previewAgent.toString());
}
