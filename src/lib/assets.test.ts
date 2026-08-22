import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAssets } from './assets.js';

/** Holds on to created blobs, retrievable by URL — so their contents can be inspected too */
function stubObjectUrls(): Map<string, Blob> {
  const blobs = new Map<string, Blob>();
  let n = 0;
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: (blob: Blob) => {
      const url = `blob:${n++}`;
      blobs.set(url, blob);
      return url;
    },
    revokeObjectURL: vi.fn(),
  });
  return blobs;
}

afterEach(() => vi.unstubAllGlobals());

const css = (text: string): Blob => new Blob([text], { type: 'text/css' });

describe('buildAssets · stylesheets referencing stylesheets', () => {
  it('the blob URL of the callee goes in even when the caller comes first', async () => {
    // The old code built CSS in files order, so with main.css ahead of theme.css
    // the theme.css URL did not exist yet and the @import stayed relative — and
    // relative paths never resolve in a blob document, so the file sat there unapplied.
    const blobs = stubObjectUrls();
    const files = new Map<string, Blob>([
      ['main.css', css("@import url('theme.css');")],
      ['theme.css', css('p{color:red}')],
    ]);

    const bundle = await buildAssets(files);
    const main = blobs.get(bundle.urls.get('main.css') ?? '');
    const themeUrl = bundle.urls.get('theme.css');

    expect(themeUrl).toBeDefined();
    expect(await main?.text()).toBe(`@import url('${themeUrl}');`);
  });

  it('a stylesheet in a subfolder also links from its own place', async () => {
    const blobs = stubObjectUrls();
    const files = new Map<string, Blob>([
      ['deck.css', css('@import url(sub/fonts.css);')],
      ['sub/fonts.css', css('@font-face{src:url(f.woff2)}')],
      ['sub/f.woff2', new Blob(['x'])],
    ]);

    const bundle = await buildAssets(files);
    const deck = blobs.get(bundle.urls.get('deck.css') ?? '');
    const fonts = blobs.get(bundle.urls.get('sub/fonts.css') ?? '');

    expect(await deck?.text()).toBe(`@import url(${bundle.urls.get('sub/fonts.css')});`);
    expect(await fonts?.text()).toBe(`@font-face{src:url(${bundle.urls.get('sub/f.woff2')})}`);
  });

  it('a broken reference one hop away is also counted as missing', async () => {
    // Document → main.css → theme.css → a missing font. Looking only at sheets the
    // document reaches directly skips theme.css: the page is broken with no word
    // that anything failed to attach (Principle 3).
    stubObjectUrls();
    const files = new Map<string, Blob>([
      ['main.css', css("@import url('theme.css');")],
      ['theme.css', css('@font-face{src:url(fonts/f.woff2)}')],
    ]);

    const bundle = await buildAssets(files, ['main.css']);

    expect(bundle.missing).toContain('fonts/f.woff2');
  });

  it('broken references of a sheet unrelated to the document still go uncounted', async () => {
    // This widens the reachable set — it does not pick up stray sheets lying around the folder.
    stubObjectUrls();
    const files = new Map<string, Blob>([
      ['main.css', css('p{color:red}')],
      ['stray.css', css('@font-face{src:url(ghost.woff2)}')],
    ]);

    const bundle = await buildAssets(files, ['main.css']);

    expect(bundle.missing).toEqual([]);
  });

  it('builds everything without stalling even in a mutual-reference cycle', async () => {
    // A cycle blobs cannot link — waiting never produces a URL, so it is built as-is.
    stubObjectUrls();
    const files = new Map<string, Blob>([
      ['a.css', css('@import url(b.css);')],
      ['b.css', css('@import url(a.css);')],
    ]);

    const bundle = await buildAssets(files);

    expect(bundle.urls.has('a.css')).toBe(true);
    expect(bundle.urls.has('b.css')).toBe(true);
  });

  it('a sheet referencing the cycle from outside is built after the cycle', async () => {
    // entry.css references the mutual a.css/b.css cycle. When blocked on a cycle,
    // the old code built everything left at once, so entry.css was built before the
    // a.css URL existed — its @import stayed relative, forever unresolved in a blob
    // document.
    const blobs = stubObjectUrls();
    const files = new Map<string, Blob>([
      ['entry.css', css("@import url('a.css');")],
      ['a.css', css("@import url('b.css');")],
      ['b.css', css("@import url('a.css');p{color:red}")],
    ]);

    const bundle = await buildAssets(files, ['entry.css']);
    const entry = blobs.get(bundle.urls.get('entry.css') ?? '');

    expect(await entry?.text()).toBe(`@import url('${bundle.urls.get('a.css')}');`);
  });

  it('with several cycles, builds one component at a time — an @import into another cycle gets its URL too', async () => {
    // a⇄b and c⇄d are separate cycles, and a references c. Building every sheet in
    // any cycle at once built a before the c URL existed, leaving that @import
    // relative — the component with nothing to lean on (c⇄d) must come first (spec §5.1).
    const blobs = stubObjectUrls();
    const files = new Map<string, Blob>([
      ['a.css', css("@import url('b.css');@import url('c.css');")],
      ['b.css', css("@import url('a.css');")],
      ['c.css', css("@import url('d.css');")],
      ['d.css', css("@import url('c.css');")],
    ]);

    const bundle = await buildAssets(files);
    const a = blobs.get(bundle.urls.get('a.css') ?? '');

    // b, inside the same cycle, cannot be linked anyway and stays relative,
    // but c, in the other cycle, gets a URL because that cycle was built first.
    expect(await a?.text()).toBe(
      `@import url('b.css');@import url('${bundle.urls.get('c.css')}');`
    );
  });

  it('a sheet two hops from the cycle gets its URL in turn', async () => {
    // entry → mid → (a ⇄ b). With the cycle built first, mid picks up the a URL on
    // the next lap, and entry picks up the mid URL on the lap after that.
    const blobs = stubObjectUrls();
    const files = new Map<string, Blob>([
      ['entry.css', css("@import url('mid.css');")],
      ['mid.css', css("@import url('a.css');")],
      ['a.css', css("@import url('b.css');")],
      ['b.css', css("@import url('a.css');")],
    ]);

    const bundle = await buildAssets(files);
    const entry = blobs.get(bundle.urls.get('entry.css') ?? '');
    const mid = blobs.get(bundle.urls.get('mid.css') ?? '');

    expect(await mid?.text()).toBe(`@import url('${bundle.urls.get('a.css')}');`);
    expect(await entry?.text()).toBe(`@import url('${bundle.urls.get('mid.css')}');`);
  });
});

describe('buildAssets · blob types (spec §5.1)', () => {
  it('a known extension overrides the reported type — browsers reject text/plain scripts', async () => {
    // Some environments report .js from a folder or a drop as text/plain. Carried
    // onto the blob as-is, the linked script does not run even with the file right there.
    const blobs = stubObjectUrls();
    const files = new Map<string, Blob>([
      ['app.js', new Blob(['console.log(1)'], { type: 'text/plain' })],
    ]);

    const bundle = await buildAssets(files);

    expect(blobs.get(bundle.urls.get('app.js') ?? '')?.type).toBe('text/javascript');
  });

  it('uses the blob as-is when the type already matches', async () => {
    const blobs = stubObjectUrls();
    const png = new Blob(['x'], { type: 'image/png' });
    const files = new Map<string, Blob>([['logo.png', png]]);

    const bundle = await buildAssets(files);

    expect(blobs.get(bundle.urls.get('logo.png') ?? '')).toBe(png);
  });

  it('an unknown extension trusts the reported type, or octet-stream without one', async () => {
    const blobs = stubObjectUrls();
    const files = new Map<string, Blob>([
      ['data.custom', new Blob(['x'], { type: 'application/x-thing' })],
      ['bare.custom', new Blob(['x'])],
    ]);

    const bundle = await buildAssets(files);

    expect(blobs.get(bundle.urls.get('data.custom') ?? '')?.type).toBe('application/x-thing');
    expect(blobs.get(bundle.urls.get('bare.custom') ?? '')?.type).toBe('application/octet-stream');
  });

  it('a stylesheet is text/css regardless of the reported type', async () => {
    const blobs = stubObjectUrls();
    const files = new Map<string, Blob>([
      ['main.css', new Blob(['p{color:red}'], { type: 'text/plain' })],
    ]);

    const bundle = await buildAssets(files);

    expect(blobs.get(bundle.urls.get('main.css') ?? '')?.type).toBe('text/css');
  });
});
