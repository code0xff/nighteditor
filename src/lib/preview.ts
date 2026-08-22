import { injectAgentScript, injectEditorStyle, markerEdits } from '@/core/markers';
import { applyEdits } from '@/core/edits';
import type { AssetSwap } from '@/core/assets';
import { previewAgent } from '@/preview/agent';
import type { Block } from '@/core/types';

/**
 * Builds the preview document for the iframe.
 *
 * It **stringifies `previewAgent` without calling it** (ADR-007). Execution happens
 * inside the iframe, so host and preview remain separate execution contexts and
 * postMessage is their only channel.
 *
 * Asset swaps arrive as a finished list (`assetSwaps`) (ADR-011) — computing them
 * here separately would create pairs that disagree with the notation the reverse
 * boundary (assetBoundary) uses. Without swaps the document is shown as-is (spec §5.1).
 *
 * Marker injection and asset swaps both use original-source offsets. Applied
 * separately, an earlier edit would shift later offsets and cut the wrong place,
 * so they are merged into one list and applied together (ADR-009).
 */
export function buildPreviewDocument(
  source: string,
  blocks: readonly Block[],
  swaps: readonly AssetSwap[] = [],
  /** This document's token — the agent attaches it to every message (spec §5 · replacement reservation) */
  token = ''
): string {
  const edits = [
    ...markerEdits(source, blocks),
    ...swaps.map(({ start, end, to }) => ({ start, end, text: to })),
  ];

  return injectAgentScript(
    injectEditorStyle(applyEdits(source, edits)),
    previewAgent.toString(),
    token
  );
}
