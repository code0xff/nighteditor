import { injectAgentScript, injectEditorStyle, markerEdits } from '@/core/markers';
import { applyEdits } from '@/core/edits';
import { assetEdits, styleEdits, type AssetRef, type Resolve } from '@/core/assets';
import { previewAgent } from '@/preview/agent';
import type { Block } from '@/core/types';

/** 프리뷰에 붙일 외부 자원 (spec §5.1). 없으면 문서를 그대로 보여준다 */
export interface PreviewAssets {
  refs: readonly AssetRef[];
  /** 문서가 놓인 디렉터리 — `<style>` 안의 상대 경로도 여기서 푼다 */
  dir: string;
  urls: ReadonlyMap<string, string>;
}

/**
 * iframe 에 넣을 프리뷰 문서를 만든다.
 *
 * `previewAgent` 를 **호출하지 않고 문자열화만** 한다 (ADR-007). 실행은 iframe 안에서
 * 일어나므로 호스트와 프리뷰는 여전히 별개 실행 컨텍스트이고, 통신은 postMessage 뿐이다.
 *
 * 마커 주입과 자원 치환은 둘 다 원본 offset 을 쓴다. 따로 적용하면 앞선 편집이
 * 뒤쪽 offset 을 밀어 엉뚱한 자리를 자르므로 한 목록으로 모아 적용한다 (ADR-009).
 */
export function buildPreviewDocument(
  source: string,
  blocks: readonly Block[],
  assets?: PreviewAssets
): string {
  const resolve: Resolve = (path) => assets?.urls.get(path);
  const edits = [
    ...markerEdits(source, blocks),
    ...(assets ? assetEdits(assets.refs, resolve) : []),
    ...(assets ? styleEdits(source, assets.dir, resolve) : []),
  ];

  return injectAgentScript(injectEditorStyle(applyEdits(source, edits)), previewAgent.toString());
}
