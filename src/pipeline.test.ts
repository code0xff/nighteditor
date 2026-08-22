// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assetBoundary, assetSwaps, parseAssetRefs } from './core/assets.js';
import { parseBlocks } from './core/parse.js';
import { applyPatches } from './core/patch.js';
import { applyLiveLocks } from './core/verify.js';
import { MARKER_ATTR } from './core/markers.js';
import { buildPreviewDocument } from './lib/preview.js';
import { previewAgent } from './preview/agent.js';
import type { FromPreview } from './preview/protocol.js';
import { fixtureSource } from './__fixtures__/load.js';

const source = fixtureSource();

function changedLines(a: string, b: string): number {
  const la = a.split('\n');
  const lb = b.split('\n');
  let n = 0;
  for (let i = 0; i < Math.max(la.length, lb.length); i++) if (la[i] !== lb[i]) n++;
  return n;
}

let dispose: (() => void) | null = null;
afterEach(() => {
  dispose?.();
  dispose = null;
  vi.restoreAllMocks();
});

/** Renders the preview document and attaches the agent — what the real host does. */
function mountPreview(html: string): FromPreview[] {
  const sent: FromPreview[] = [];
  // Artifact scripts are not run. What matters here is the host↔preview wiring.
  document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  vi.spyOn(window.parent, 'postMessage').mockImplementation(((msg: unknown) => {
    sent.push(msg as FromPreview);
  }) as typeof window.parent.postMessage);
  dispose = previewAgent();
  // Editing only opens once verification lands the lock list (spec §4). Sending that
  // signal is part of "what the real host does" — even an empty list must go out.
  window.dispatchEvent(
    new MessageEvent('message', { data: { type: 'locked', ids: [] }, source: window.parent })
  );
  return sent;
}

describe('whole pipeline · synthetic artifact', () => {
  it('parse → preview → edit → save ends in a one-line diff', () => {
    const blocks = parseBlocks(source);
    const sent = mountPreview(buildPreviewDocument(source, blocks));

    const target = blocks.find((b) => b.tag === 'h1');
    if (!target) throw new Error('no h1');

    const el = document.querySelector<HTMLElement>(`[${MARKER_ATTR}="${target.id}"]`);
    expect(el, 'the marker must survive into the preview').not.toBeNull();

    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    el!.innerHTML = '고친 표지 <b>2026</b>';
    document.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

    const edit = sent.find((m): m is Extract<FromPreview, { type: 'edit' }> => m.type === 'edit');
    expect(edit?.id).toBe(target.id);

    const output = applyPatches(source, blocks, [{ id: edit!.id, newInnerHtml: edit!.html }]);
    expect(changedLines(source, output)).toBe(1);
    expect(output).toContain('<h1>고친 표지 <b>2026</b></h1>');
  });

  it('verifying against the live text the preview reports settles the locks', () => {
    const blocks = parseBlocks(source);
    const sent = mountPreview(buildPreviewDocument(source, blocks));

    window.dispatchEvent(new Event('load'));
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const ready = sent.find(
          (m): m is Extract<FromPreview, { type: 'ready' }> => m.type === 'ready'
        );
        expect(ready, 'it must report ready').toBeDefined();

        const locked = applyLiveLocks(blocks, ready!.blocks);
        // Scripts were stripped, so live equals source. Only parse-time locks may remain.
        const reasons = new Set(locked.map((b) => b.locked).filter(Boolean));
        expect(reasons).toEqual(new Set(['CODE_BLOCK', 'EMPTY_IN_SOURCE']));
        resolve();
      }, 0);
    });
  });

  it('saving without editing anything is byte-identical to the source', () => {
    const blocks = parseBlocks(source);
    expect(applyPatches(source, blocks, [])).toBe(source);
  });
});

describe('whole pipeline · external assets (spec §5.1)', () => {
  const multi =
    '<html><head><link rel="stylesheet" href="deck.css">' +
    '<style>body{background:url(bg.png)}</style></head>' +
    '<body><h1>제목</h1><img src="img/logo.png"><a href="next.html">다음</a></body></html>';

  const urls = new Map([
    ['deck.css', 'blob:css'],
    ['bg.png', 'blob:bg'],
    ['img/logo.png', 'blob:logo'],
  ]);

  it('rewrites asset paths to blob URLs in the preview only', () => {
    const blocks = parseBlocks(multi);
    const refs = parseAssetRefs(multi, '');
    const doc = buildPreviewDocument(
      multi,
      blocks,
      assetSwaps(multi, refs, '', (p) => urls.get(p))
    );

    expect(doc).toContain('href="blob:css"');
    expect(doc).toContain('src="blob:logo"');
    expect(doc).toContain('url(blob:bg)');
    // A link is somewhere to go, not an asset to attach.
    expect(doc).toContain('href="next.html"');
    // Markers go in too — both use the same source offsets, so they apply in one pass.
    expect(doc).toContain(`<h1 ${MARKER_ATTR}=`);
  });

  it('not one character of blob reaches the saved output (ADR-009)', () => {
    const blocks = parseBlocks(multi);
    const target = blocks.find((b) => b.tag === 'h1');
    const out = applyPatches(multi, blocks, [
      { id: target?.id ?? -1, newInnerHtml: 'edited title' },
    ]);

    expect(out).not.toContain('blob:');
    expect(out).toContain('href="deck.css"');
    expect(out).toContain('src="img/logo.png"');
    expect(changedLines(multi, out)).toBe(1);
  });

  it('the document still opens when no asset is attached', () => {
    const blocks = parseBlocks(multi);
    const refs = parseAssetRefs(multi, '');
    // References we could not attach never enter the swap list — the document stands.
    const doc = buildPreviewDocument(
      multi,
      blocks,
      assetSwaps(multi, refs, '', () => undefined)
    );

    // We never pretend a missing asset exists. Only the screen differs; editing is exact.
    expect(doc).toContain('href="deck.css"');
    expect(doc).toContain(`<h1 ${MARKER_ATTR}=`);
  });

  it('a document in a subfolder resolves assets from where it sits', () => {
    const refs = parseAssetRefs(multi, 'slides');

    expect(refs.map((r) => r.path)).toEqual(['slides/deck.css', 'slides/img/logo.png']);
  });
});

describe('whole pipeline · assets inside a block (INV-9 · ADR-011)', () => {
  // A document whose asset reference sits **inside an editable block** — the swap
  // happens within the edited range, so without the boundary the preview's blob URL
  // rides innerHTML straight into the saved output.
  const doc =
    '<html><body>\n<p>설명 <span>사진 <img src="logo.png"></span></p>\n' +
    '<h1>제목</h1>\n</body></html>';
  const urls = new Map([['logo.png', 'blob:logo']]);
  const swaps = () => assetSwaps(doc, parseAssetRefs(doc), '', (p) => urls.get(p));

  it('editing the block leaves no blob in the output and keeps the original spelling', () => {
    const blocks = parseBlocks(doc);
    const sent = mountPreview(buildPreviewDocument(doc, blocks, swaps()));
    const target = blocks.find((b) => b.tag === 'p');
    if (!target) throw new Error('no p');

    const el = document.querySelector<HTMLElement>(`[${MARKER_ATTR}="${target.id}"]`);
    // Inside the preview the block carries a blob URL — the edit brings it back as is.
    expect(el?.querySelector('img')?.getAttribute('src')).toBe('blob:logo');

    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    el!.innerHTML = '고친 설명 <span>사진 <img src="blob:logo"></span>';
    document.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

    const edit = sent.find((m): m is Extract<FromPreview, { type: 'edit' }> => m.type === 'edit');
    expect(edit?.html).toContain('blob:'); // what the preview sends is preview spelling

    // The host turns it back at the boundary before making it a patch (ADR-011).
    const restored = assetBoundary(swaps()).fromPreview(edit!.html);
    const out = applyPatches(doc, blocks, [{ id: edit!.id, newInnerHtml: restored }]);

    expect(out).not.toContain('blob:');
    expect(out).toContain('src="logo.png"');
    expect(changedLines(doc, out)).toBe(1);
  });

  it('source sent out for a revert carries the blob, and comes back identical', () => {
    const blocks = parseBlocks(doc);
    const target = blocks.find((b) => b.tag === 'p');
    if (!target) throw new Error('no p');
    const boundary = assetBoundary(swaps());

    const outgoing = boundary.toPreview(target.sourceInner, target.innerStart);

    // Sending raw source would undo the swap, breaking the image in that block alone.
    expect(outgoing).toContain('src="blob:logo"');
    // The round trip is byte-identical (Principles 1 and 2).
    expect(boundary.fromPreview(outgoing)).toBe(target.sourceInner);
  });
});
