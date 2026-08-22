import type { Block } from './types.js';
import { applyEdits, type Edit } from './edits.js';

/** The mark used to trace a DOM node in the preview back to its source block (ADR-003) */
export const MARKER_ATTR = 'data-ne-id';

/** The mark attached to locked blocks. The agent attaches it after receiving the comparison result */
export const LOCKED_ATTR = 'data-ne-locked';

/** The mark attached to blocks on a dark background. The agent measures the rendered color and attaches it */
export const DARK_ATTR = 'data-ne-dark';

/** The mark attached to briefly point out a block picked from the change list */
export const REVEALED_ATTR = 'data-ne-revealed';

export class MarkerError extends Error {}

/**
 * Builds the preview HTML. Puts `data-ne-id` into each block's opening tag.
 *
 * Structural paths taken from the live DOM cannot be used, because artifact scripts
 * rebuild the DOM (the measured artifact's `wrapSheets()` moves every child of a slide
 * into a new wrapper). `appendChild` **moves** nodes, so attributes travel with them —
 * markers survive however the DOM is shuffled.
 *
 * The output is **preview only**. The save path always starts from the source string,
 * so markers can never leak into the saved file (INV-3).
 */
export function markerEdits(source: string, blocks: readonly Block[]): Edit[] {
  return blocks.map((block) => {
    // innerStart is just past the opening tag's '>'. Insert right before that '>'.
    const at = block.innerStart - 1;
    if (source[at] !== '>') {
      throw new MarkerError(
        `cannot find the end of the opening tag: id=${block.id} <${block.tag}>`
      );
    }
    return { start: at, end: at, text: ` ${MARKER_ATTR}="${block.id}"` };
  });
}

export function injectMarkers(source: string, blocks: readonly Block[]): string {
  return applyEdits(source, markerEdits(source, blocks));
}

/**
 * Injects the preview agent at the very front of the document (ADR-007).
 *
 * The injection point is a correctness condition. The agent must register its
 * listeners **before** the artifact scripts do, so it runs first in the bubble phase
 * and can block the artifact's global handlers. Artifact scripts usually sit at the
 * end of `<body>`, so the front of `<head>` is enough.
 */
export function injectAgentScript(html: string, agentSource: string, token = ''): string {
  // A `</script>` inside the agent source would terminate the inline script early.
  const safe = agentSource.replace(/<\/script/gi, '<\\/script');
  // A per-document token — the agent attaches it to every message so the host can
  // filter out messages arriving from an old preview after switching (spec §5).
  // `<` is escaped — a `</script` inside the token must not terminate the inline script.
  const arg = JSON.stringify(token).replace(/</g, '\\u003c');
  const script = `<script>(${safe})(${arg});</script>`;

  const anchor = /<head[^>]*>/i.exec(html) ?? /<html[^>]*>/i.exec(html);
  if (!anchor) return script + html;

  const at = anchor.index + anchor[0].length;
  return html.slice(0, at) + script + html.slice(at);
}

/**
 * Injects the style that shows editability on screen (spec §4).
 *
 * Without seeing what can be edited and what is locked, the user has to guess by
 * clicking around. What cannot be fixed is **shown** as unfixable (Principle 3).
 *
 * Not disturbing the artifact's layout is a requirement.
 * - `outline` only. `border` changes box size and shifts the document
 * - colors, fonts, spacing stay untouched
 * - The marks must not vanish under winning artifact CSS, so only these few lines
 *   are `!important` — including the `--ne-*` variable definitions the marks read.
 *   This style is injected before the artifact CSS, so an unprotected variable can
 *   be wiped out, marks and all, by a single same-selector line
 *
 * The marks are monochrome. Every artifact has its own palette; a fixed color sinks
 * into the background in one document and clashes with the artifact's colors in
 * another. Which side to use differs per block (a light card on a dark background),
 * so the agent measures the rendered background and attaches `data-ne-dark`; here we
 * only read that mark.
 */
export function injectEditorStyle(html: string): string {
  const editable = `[${MARKER_ATTR}]:not([${LOCKED_ATTR}])`;
  const style =
    '<style>' +
    `[${MARKER_ATTR}]{--ne-mark:#101012!important;--ne-soft:rgba(16,16,18,.45)!important;` +
    '--ne-tint:rgba(16,16,18,.05)!important}' +
    `[${DARK_ATTR}]{--ne-mark:#fff!important;--ne-soft:rgba(255,255,255,.5)!important;` +
    '--ne-tint:rgba(255,255,255,.09)!important}' +
    `${editable}{cursor:text}` +
    `${editable}:hover{outline:2px solid var(--ne-soft)!important;outline-offset:2px!important}` +
    `[${MARKER_ATTR}][contenteditable="true"]{outline:2px solid var(--ne-mark)!important;` +
    'outline-offset:2px!important;background:var(--ne-tint)!important}' +
    `[${LOCKED_ATTR}]{cursor:not-allowed}` +
    `[${LOCKED_ATTR}]:hover{outline:2px dashed var(--ne-soft)!important;outline-offset:2px!important}` +
    // Point out the spot picked from the list. Scrolling alone cannot say which block it is.
    `[${REVEALED_ATTR}]{outline:2px solid var(--ne-mark)!important;outline-offset:2px!important;` +
    'background:var(--ne-tint)!important}' +
    '</style>';

  const anchor = /<head[^>]*>/i.exec(html) ?? /<html[^>]*>/i.exec(html);
  if (!anchor) return style + html;

  const at = anchor.index + anchor[0].length;
  return html.slice(0, at) + style + html.slice(at);
}
