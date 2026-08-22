import { normalizeText } from './entities.js';
import type { Block } from './types.js';

/**
 * Locks uneditable blocks by comparing the rendered preview's actual text against
 * the source (ADR-005).
 *
 * There is no general way to statically determine what text a script generates or
 * mutates. But "does the result differ from the source" can be answered reliably
 * with a single render. This is safe even for artifacts we have never seen — what
 * we don't understand, we simply lock (Principle 3).
 *
 * @param live { id, textContent } collected per marker from the rendered DOM —
 *   received **with duplicates intact**, not reduced to the last one. Two elements
 *   with the same id means the document (or a script) imitated our marker, and the
 *   render alone cannot tell which one is the original block — fixing by guess would
 *   ship the fake element's content into the save as that block's edit, so it is
 *   locked as `MARKER_CLASH` (spec §3 · Principle 3).
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

    // Lock even when the imitation's text happens (or is made) to match the source —
    // the problem is not the content but that we cannot trace which element is this block.
    if (clashed.has(block.id)) return { ...block, locked: 'MARKER_CLASH' };

    const text = liveText.get(block.id);
    // A missing marker means a script removed that node.
    if (text === undefined) return { ...block, locked: 'SCRIPT_GENERATED' };

    // INV-8 · Both sides are decoded text. sourceText was normalized at parse time,
    // and text is the DOM's textContent, which is already decoded.
    if (normalizeText(text) !== block.sourceText) {
      return { ...block, locked: 'SCRIPT_GENERATED' };
    }
    return block;
  });
}
