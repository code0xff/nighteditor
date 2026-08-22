import { describe, expect, it } from 'vitest';
import {
  assetBoundary,
  assetEdits,
  assetSwaps,
  cssAssetPaths,
  dirOf,
  documentBaseDir,
  parseAssetRefs,
  resolvePath,
  rewriteCssUrls,
  styleEdits,
} from './assets.js';
import { applyEdits } from './edits.js';

/** Turns a path into a blob impostor as-is */
const fake = (path: string): string => `blob:${path}`;

describe('resolvePath', () => {
  it('resolves against the document location', () => {
    expect(resolvePath('', 'deck.css')).toBe('deck.css');
    expect(resolvePath('slides', 'deck.css')).toBe('slides/deck.css');
    expect(resolvePath('slides/2026', '../deck.css')).toBe('slides/deck.css');
    expect(resolvePath('slides', './img/logo.png')).toBe('slides/img/logo.png');
  });

  it('absolute paths resolve against the bundle root', () => {
    expect(resolvePath('slides/2026', '/assets/deck.css')).toBe('assets/deck.css');
  });

  it('leaves outward references alone', () => {
    // Either the browser can already fetch them, or they are not assets at all.
    for (const url of [
      'https://cdn.example.com/a.css',
      '//cdn.example.com/a.css',
      'data:image/png;base64,AAAA',
      'blob:https://example.com/x',
      'mailto:um@kdccy.com',
      '#section',
      '',
      '   ',
    ]) {
      expect(resolvePath('', url)).toBeNull();
    }
  });

  it('strips query strings and anchors', () => {
    expect(resolvePath('', 'deck.css?v=3')).toBe('deck.css');
    expect(resolvePath('', 'sprite.svg#icon')).toBe('sprite.svg');
  });

  it('turns percent-encoding back into the real file name', () => {
    // The bundle key is the name on disk, not the spelling in the document.
    expect(resolvePath('', 'my%20deck.css')).toBe('my deck.css');
  });

  it('collapses encoded dot segments as dots too (spec §5.1)', () => {
    // The URL spec collapses %2e segments as dot segments. Decoding after collapsing
    // leaves deck/sub's %2e%2e/logo.png as deck/sub/../logo.png, counting the
    // deck/logo.png that really sits there as missing.
    expect(resolvePath('deck/sub', '%2e%2e/logo.png')).toBe('deck/logo.png');
    expect(resolvePath('deck/sub', '%2E%2E/logo.png')).toBe('deck/logo.png');
    expect(resolvePath('deck/sub', '%2e/logo.png')).toBe('deck/sub/logo.png');
  });

  it('leaves badly encoded segments written as-is and decodes the rest', () => {
    // Decoding the whole string and failing would leave even healthy segments in
    // their spelling — decode segment by segment.
    expect(resolvePath('', '100%/my%20deck.css')).toBe('100%/my deck.css');
  });

  it('does not decode %2F inside a segment into a separator (spec §5.1)', () => {
    // A file name on disk cannot contain a slash — decoded, part of the name turns
    // into a path separator, and the nonexistent a/b.png is looked up instead of the
    // real file a%2Fb.png.
    expect(resolvePath('', 'a%2Fb.png')).toBe('a%2Fb.png');
    // Its spelling (case) stays as written — the bundle key is the name on disk.
    expect(resolvePath('', 'a%2fb.png')).toBe('a%2fb.png');
    // Other encodings in the same segment still decode.
    expect(resolvePath('', 'img/a%2Fb%20c.png')).toBe('img/a%2Fb c.png');
    // The %25 of %252F decodes to % — not to %2F itself.
    expect(resolvePath('', 'a%252Fb.png')).toBe('a%2Fb.png');
  });

  it('does not escape past the root', () => {
    expect(resolvePath('', '../../etc/passwd')).toBe('etc/passwd');
  });
});

describe('dirOf', () => {
  it('gives the directory the document sits in', () => {
    expect(dirOf('slides/deck.html')).toBe('slides');
    expect(dirOf('deck.html')).toBe('');
  });
});

describe('parseAssetRefs', () => {
  it('finds attributes that point at assets', () => {
    const refs = parseAssetRefs(
      '<link rel="stylesheet" href="deck.css">' +
        '<script src="app.js"></script>' +
        '<img src="logo.png"><video src="v.mp4" poster="p.jpg"></video>'
    );

    expect(refs.map((r) => r.path)).toEqual(['deck.css', 'app.js', 'logo.png', 'v.mp4', 'p.jpg']);
  });

  it('<a href> is not an asset', () => {
    // It is a place to navigate to. Turned into a blob, the link goes somewhere wrong.
    expect(parseAssetRefs('<a href="next.html">다음</a>')).toHaveLength(0);
  });

  it('does not list external URLs', () => {
    const refs = parseAssetRefs(
      '<link href="https://cdn.example.com/a.css"><img src="data:image/gif;base64,R0lGOD">'
    );

    expect(refs).toHaveLength(0);
  });

  it('the value range covers only the inside of the quotes', () => {
    const source = '<img src="logo.png">';
    const [ref] = parseAssetRefs(source);

    expect(source.slice(ref?.valueStart, ref?.valueEnd)).toBe('logo.png');
  });

  it('unquoted values also point at just the value', () => {
    const source = '<img src=logo.png>';
    const [ref] = parseAssetRefs(source);

    expect(source.slice(ref?.valueStart, ref?.valueEnd)).toBe('logo.png');
  });

  it('accepts single quotes too', () => {
    const source = "<img src='logo.png'>";
    const [ref] = parseAssetRefs(source);

    expect(source.slice(ref?.valueStart, ref?.valueEnd)).toBe('logo.png');
  });

  it('resolves against the document location when it sits in a subfolder', () => {
    const refs = parseAssetRefs('<img src="img/logo.png">', 'slides');

    expect(refs[0]?.path).toBe('slides/img/logo.png');
    expect(refs[0]?.url).toBe('img/logo.png');
  });
});

describe('documentBaseDir (spec §5.1)', () => {
  it('the document location is the base when there is no <base href>', () => {
    expect(documentBaseDir('<html><body><p>글</p></body></html>', 'deck')).toBe('deck');
  });

  it('a directory base is appended to the document location', () => {
    const source = '<html><head><base href="assets/"></head><body></body></html>';
    expect(documentBaseDir(source, '')).toBe('assets');
    expect(documentBaseDir(source, 'deck')).toBe('deck/assets');
  });

  it('a base with a file strips the last segment — base is a URL, not a directory', () => {
    const source = '<base href="assets/sub/page.html">';
    expect(documentBaseDir(source, '')).toBe('assets/sub');
  });

  it('collapses a base that climbs upward', () => {
    expect(documentBaseDir('<base href="../shared/">', 'deck')).toBe('shared');
  });

  it('a query- or fragment-only base does not move the location', () => {
    // In URL resolution, `?v=2` is the document's own address with the query
    // swapped — the base must stay the document location, not collapse an empty
    // path and climb a level.
    expect(documentBaseDir('<base href="?v=2">', 'deck/sub')).toBe('deck/sub');
    expect(documentBaseDir('<base href="#top">', 'deck/sub')).toBe('deck/sub');
  });

  it('a %2F inside the last segment is part of the name, not a separator', () => {
    // Stripping the file name after decoding cuts at the slash inside the name,
    // giving dir/a instead of dir.
    expect(documentBaseDir('<base href="dir/a%2Fb.css">', '')).toBe('dir');
  });

  it('a dot-segment last segment is a location marker — not stripped as a file name (spec §5.1)', () => {
    // Stripping the last segment before decoding leaves deck/sub's `..` at
    // deck/sub instead of deck, so every relative asset is looked up in the wrong place.
    expect(documentBaseDir('<base href="..">', 'deck/sub')).toBe('deck');
    expect(documentBaseDir('<base href=".">', 'deck/sub')).toBe('deck/sub');
    expect(documentBaseDir('<base href="foo/..">', 'deck/sub')).toBe('deck/sub');
    expect(documentBaseDir('<base href="%2e%2e">', 'deck/sub')).toBe('deck');
  });

  it('a root base is the top of the bundle', () => {
    expect(documentBaseDir('<base href="/">', 'deck')).toBe('');
    expect(documentBaseDir('<base href="/assets/">', 'deck')).toBe('assets');
  });

  it('a base pointing outside is null — relative references are not local files', () => {
    expect(documentBaseDir('<base href="https://cdn.example/">', '')).toBeNull();
    expect(documentBaseDir('<base href="//cdn.example/">', 'deck')).toBeNull();
  });

  it('only the first <base> with an href is effective — same as the HTML spec', () => {
    const source = '<base target="_blank"><base href="a/"><base href="b/">';
    expect(documentBaseDir(source, '')).toBe('a');
  });

  it('references resolve against that base', () => {
    const source = '<base href="assets/"><link rel="stylesheet" href="style.css">';
    const refs = parseAssetRefs(source, documentBaseDir(source, '') ?? '');
    expect(refs.map((r) => r.path)).toEqual(['assets/style.css']);
  });
});

describe('assetEdits', () => {
  it('changes only the spots with an attachable asset', () => {
    const source = '<link href="deck.css"><img src="없다.png">';
    const refs = parseAssetRefs(source);
    const out = applyEdits(
      source,
      assetEdits(refs, (path) => (path === 'deck.css' ? fake(path) : undefined))
    );

    // Spots that could not be attached stay as the source — swapping in a
    // nonexistent URL would be worse.
    expect(out).toBe('<link href="blob:deck.css"><img src="없다.png">');
  });

  it('applies together with marker injection in one list', () => {
    // Applied separately, the earlier insertion shifts the later offsets and cuts
    // the wrong spot.
    const source = '<p>글</p><img src="logo.png">';
    const refs = parseAssetRefs(source);
    const out = applyEdits(source, [
      { start: 2, end: 2, text: ' data-ne-id="0"' },
      ...assetEdits(refs, fake),
    ]);

    expect(out).toBe('<p data-ne-id="0">글</p><img src="blob:logo.png">');
  });
});

describe('assetEdits · encoding the decoded fragment (INV-8)', () => {
  it('a quote written as an entity in the fragment does not terminate the attribute early', () => {
    // parse5 resolves &quot; to " for us. Written back as-is, the value ends there
    // and the rest of the fragment is promoted to a new attribute like onerror= in
    // the preview.
    const source = '<img src="x.png#foo&quot; onerror=&quot;alert(1)">';
    const refs = parseAssetRefs(source);
    const edits = assetEdits(refs, () => 'blob:x');

    expect(edits[0]?.text).not.toContain('"');
    expect(edits[0]?.text).not.toContain(' ');
    const out = applyEdits(source, edits);
    // The substituted value must still sit whole inside the original quotes.
    expect(out.startsWith('<img src="blob:x#foo')).toBe(true);
    expect(out.endsWith('">')).toBe(true);
  });

  it('an ordinary fragment stays as it is', () => {
    const source = '<use href="sprite.svg#icon"/>';
    const refs = parseAssetRefs(source);
    const edits = assetEdits(refs, () => 'blob:s');

    expect(edits[0]?.text).toBe('blob:s#icon');
  });
});

describe('rewriteCssUrls', () => {
  it('resolves relative paths inside a stylesheet against that file location', () => {
    // A blob URL has no directory. Left unchanged, every font breaks.
    const css = "@font-face{src:url('fonts/x.woff2')}";

    expect(rewriteCssUrls(css, 'assets', fake)).toBe(
      "@font-face{src:url('blob:assets/fonts/x.woff2')}"
    );
  });

  it('preserves quoting style and whitespace', () => {
    expect(rewriteCssUrls('a{background:url(bg.png)}', '', fake)).toBe(
      'a{background:url(blob:bg.png)}'
    );
    expect(rewriteCssUrls('a{background:url( "bg.png" )}', '', fake)).toBe(
      'a{background:url("blob:bg.png")}'
    );
  });

  it('leaves external URLs and unfound assets alone', () => {
    const css = 'a{background:url(https://cdn.example.com/x.png)}b{background:url(없다.png)}';

    expect(rewriteCssUrls(css, '', () => undefined)).toBe(css);
  });

  it('url( in the middle of an identifier is part of the function name; do not rewrite', () => {
    // Rewriting `--icon: myurl(x)` turns someone else's non-asset function into
    // `myurl(blob:...)`.
    const css = ':root{--icon: myurl(icon.png)}a{background:url(icon.png)}';

    expect(rewriteCssUrls(css, '', fake)).toBe(
      ':root{--icon: myurl(icon.png)}a{background:url(blob:icon.png)}'
    );
  });

  it('rewrites url( after token boundaries like open parens, commas, whitespace', () => {
    expect(rewriteCssUrls('a{background:red url(bg.png),url(bg.png)}', '', fake)).toBe(
      'a{background:red url(blob:bg.png),url(blob:bg.png)}'
    );
  });

  it('does not cut the value at an escaped paren — the decoded value is the path', () => {
    // Searching with indexOf(')') reads only up to `foo\`, and the healthy CSS's
    // asset never attaches.
    expect(rewriteCssUrls('a{background:url(foo\\)bar.png)}', '', fake)).toBe(
      'a{background:url(blob:foo)bar.png)}'
    );
  });

  it('interprets the path after decoding escapes — the bundle key is the name on disk', () => {
    // Both character escapes (`\ `) and hex escapes (`\61 `, the trailing space
    // being part of the escape).
    expect(rewriteCssUrls('a{background:url(my\\ file.png)}', '', fake)).toBe(
      'a{background:url(blob:my file.png)}'
    );
    expect(rewriteCssUrls('a{background:url(sp\\61 ce.png)}', '', fake)).toBe(
      'a{background:url(blob:space.png)}'
    );
  });

  it('decodes escapes inside quoted values too', () => {
    expect(
      rewriteCssUrls('a{background:url("we\\"ird.png")}', '', (path) =>
        path === 'we"ird.png' ? 'blob:ok' : undefined
      )
    ).toBe('a{background:url("blob:ok")}');
  });

  it('the written-back fragment re-locks only the token-breaking characters', () => {
    // Writing the decoded fragment's `)` as-is closes url() right there — lock it as hex.
    expect(rewriteCssUrls('a{clip-path:url(s.svg\\#i\\)x)}', '', fake)).toBe(
      'a{clip-path:url(blob:s.svg#i\\29 x)}'
    );
    // An ordinary fragment goes out as it is.
    expect(rewriteCssUrls('a{clip-path:url(s.svg#round)}', '', fake)).toBe(
      'a{clip-path:url(blob:s.svg#round)}'
    );
  });
});

describe('styleEdits', () => {
  it('rewrites inside the document-embedded <style> too', () => {
    const source = '<style>body{background:url(bg.png)}</style><p>글</p>';
    const out = applyEdits(source, styleEdits(source, '', fake));

    expect(out).toBe('<style>body{background:url(blob:bg.png)}</style><p>글</p>');
  });

  it('creates no edits when there is nothing to rewrite', () => {
    expect(styleEdits('<style>body{color:red}</style>', '', fake)).toHaveLength(0);
  });
});

describe('parseAssetRefs · namespaced attributes', () => {
  it('finds xlink:href', () => {
    // parse5 splits this into { name: 'href', prefix: 'xlink' } and keeps the
    // location only under the 'xlink:href' key. Looking at the name alone misses it entirely.
    const refs = parseAssetRefs('<svg><use xlink:href="sprite.svg#icon"/></svg>');

    expect(refs.map((r) => r.path)).toEqual(['sprite.svg']);
  });

  it('each form grabs its own value when both are present', () => {
    const source = '<svg><use xlink:href="old.svg#a"/><use href="new.svg#b"/></svg>';
    const refs = parseAssetRefs(source);

    expect(refs.map((r) => r.path)).toEqual(['old.svg', 'new.svg']);
    for (const ref of refs) {
      // The value range must point at its own attribute — misaligned, the wrong spot changes.
      expect(source.slice(ref.valueStart, ref.valueEnd)).toBe(ref.url);
    }
  });
});

describe('queries and fragments of asset references', () => {
  it('reattaches the fragment when attaching', () => {
    // Losing #icon loses what to pull from the sprite, so nothing draws.
    const source = '<svg><use href="sprite.svg#icon"/></svg>';
    const out = applyEdits(source, assetEdits(parseAssetRefs(source), fake));

    expect(out).toContain('href="blob:sprite.svg#icon"');
  });

  it('strips the query, and finds the file under the query-less name too', () => {
    // The moment a query is appended, a blob URL names a different object than the
    // one created and does not open at all.
    const source = '<link href="deck.css?v=3">';
    const [ref] = parseAssetRefs(source);
    const out = applyEdits(source, assetEdits(parseAssetRefs(source), fake));

    expect(ref?.path).toBe('deck.css');
    expect(out).toBe('<link href="blob:deck.css">');
  });

  it('keeps only the fragment when query and fragment are both present', () => {
    const source = '<svg><use href="sprite.svg?v=2#icon"/></svg>';
    const out = applyEdits(source, assetEdits(parseAssetRefs(source), fake));

    expect(out).toContain('href="blob:sprite.svg#icon"');
  });

  it('keeps fragments inside CSS too', () => {
    expect(rewriteCssUrls('a{clip-path:url(shapes.svg#round)}', '', fake)).toBe(
      'a{clip-path:url(blob:shapes.svg#round)}'
    );
  });

  it('strips queries inside CSS too', () => {
    expect(rewriteCssUrls('a{background:url("bg.png?v=3")}', '', fake)).toBe(
      'a{background:url("blob:bg.png")}'
    );
    expect(rewriteCssUrls('@font-face{src:url(f.woff2?v=1#iefix)}', '', fake)).toBe(
      '@font-face{src:url(blob:f.woff2#iefix)}'
    );
  });
});

describe('rewriteCssUrls · strings and comments', () => {
  it('url( inside a string is characters, not an asset', () => {
    // content is a value printed on screen. Changing it creates characters that
    // were never there.
    const css = `a::after{content:'url(icon.png)'}`;

    expect(rewriteCssUrls(css, '', fake)).toBe(css);
  });

  it('does not touch the inside of comments either', () => {
    const css = '/* url(icon.png) 는 예시다 */ a{background:url(icon.png)}';

    expect(rewriteCssUrls(css, '', fake)).toBe(
      '/* url(icon.png) 는 예시다 */ a{background:url(blob:icon.png)}'
    );
  });

  it('rewrites quoted values and uppercase URL( too', () => {
    expect(rewriteCssUrls('a{background:URL("bg.png")}', '', fake)).toBe(
      'a{background:url("blob:bg.png")}'
    );
  });

  it('leaves an unclosed url( alone', () => {
    expect(rewriteCssUrls('a{background:url(bg.png', '', fake)).toBe('a{background:url(bg.png');
  });
});

describe('cssAssetPaths', () => {
  it('collects the asset paths CSS points at — counting what failed to attach needs the list', () => {
    const css = '@font-face{src:url(fonts/x.woff2)}a{background:url("../img/bg.png")}';

    expect(cssAssetPaths(css, 'assets')).toEqual(['assets/fonts/x.woff2', 'img/bg.png']);
  });

  it('does not count external URLs', () => {
    expect(cssAssetPaths('a{background:url(https://cdn.example.com/x.png)}', '')).toEqual([]);
  });

  it("does not count url( attached to someone else's function name", () => {
    // Counting it nags the user for a file unrelated to this document.
    expect(cssAssetPaths(':root{--icon: myurl(icon.png)}', '')).toEqual([]);
  });
});

describe('assetSwaps · assetBoundary (ADR-011)', () => {
  /** A document with an asset inside a block — substitution happens inside the edit range */
  const source = '<p>설명 <span>사진 <img src="img/logo.png"></span></p><img src="없다.png">';
  const swaps = () => assetSwaps(source, parseAssetRefs(source), '', fake);
  const innerStart = source.indexOf('설명');
  const inner = source.slice(innerStart, source.indexOf('</p>'));

  it('substitutes references in an outgoing fragment with the preview spelling', () => {
    const out = assetBoundary(swaps()).toPreview(inner, innerStart);

    expect(out).toContain('src="blob:img/logo.png"');
    // The rest of the fragment's bytes stay — the substitution changes only the value range.
    expect(out.startsWith('설명 <span>사진 ')).toBe(true);
  });

  it('substituting and restoring is byte-identical (Principles 1 and 2)', () => {
    const boundary = assetBoundary(swaps());

    expect(boundary.fromPreview(boundary.toPreview(inner, innerStart))).toBe(inner);
  });

  it('restores blob URLs in a returning edit to the source spelling', () => {
    const edited = '고친 설명 <span>사진 <img src="blob:img/logo.png"></span>';

    expect(assetBoundary(swaps()).fromPreview(edited)).toBe(
      '고친 설명 <span>사진 <img src="img/logo.png"></span>'
    );
  });

  it('touches neither unsubstituted references nor spellings that were blob: to begin with', () => {
    // 없다.png could not be attached (resolve gave undefined), and a blob: originally
    // written in the document is an external reference, so it never enters the swap list.
    const src = '<p><img src="없다.png"><img src="blob:이미있던것"></p>';
    const list = assetSwaps(src, parseAssetRefs(src), '', (p) =>
      p === '없다.png' ? undefined : fake(p)
    );
    const boundary = assetBoundary(list);
    const body = src.slice(3, src.indexOf('</p>'));

    expect(boundary.toPreview(body, 3)).toBe(body);
    expect(boundary.fromPreview(body)).toBe(body);
  });

  it('restores the spelling the browser swapped in through serialization too', () => {
    // A space in the fragment goes out as &#32;, but the browser's innerHTML does
    // not encode spaces, so it comes back in a different spelling — the pair for
    // that spelling must be held too, or the blob leaks.
    const src = '<p><use href="sprite.svg#i con"/></p>';
    const boundary = assetBoundary(assetSwaps(src, parseAssetRefs(src), '', fake));

    expect(boundary.fromPreview('<use href="blob:sprite.svg#i con"></use>')).toBe(
      '<use href="sprite.svg#i con"></use>'
    );
  });

  it('the serialized pair also restores to the source entity spelling (Principle 2)', () => {
    // The value parse5 gave has &#32; already resolved — building the pair by
    // re-encoding the decoded value would change the spelling of untouched
    // attributes the moment that block is edited.
    // The source side is also anchored to the source slice.
    const src = '<p><use href="sprite.svg#i&#32;con"/></p>';
    const boundary = assetBoundary(assetSwaps(src, parseAssetRefs(src), '', fake));

    expect(boundary.fromPreview('<use href="blob:sprite.svg#i con"></use>')).toBe(
      '<use href="sprite.svg#i&#32;con"></use>'
    );
  });

  it('only a raw double quote in the source is locked as &quot; for the serialized context', () => {
    // A single-quoted source can hold a raw ". The serialized pair goes inside the
    // double-quoted attribute innerHTML makes, so left raw the value terminates
    // early and the rest parses as a new attribute. Through the parser it is the
    // same value.
    const src = "<p><use href='sprite.svg#i\"c'/></p>";
    const boundary = assetBoundary(assetSwaps(src, parseAssetRefs(src), '', fake));

    expect(boundary.fromPreview('<use href="blob:sprite.svg#i&quot;c"></use>')).toBe(
      '<use href="sprite.svg#i&quot;c"></use>'
    );
  });

  it('a fragmentless spelling does not hijack a fragmented one', () => {
    // blob:sprite.svg is a prefix of blob:sprite.svg#icon. Restoring the short one
    // first means the long one never matches, leaving #icon behind the blob name.
    const src = '<img src="sprite.svg"><use href="sprite.svg#icon"/>';
    const boundary = assetBoundary(assetSwaps(src, parseAssetRefs(src), '', fake));

    expect(boundary.fromPreview('<use href="blob:sprite.svg#icon"></use>')).toBe(
      '<use href="sprite.svg#icon"></use>'
    );
  });

  it('with no position known, restores to the first source spelling of that preview spelling', () => {
    // logo.png and ./logo.png are the same file, so they share one preview
    // spelling — called without a block range there is no position to tie to, so
    // the first spelling is used deterministically. With a position, the
    // "each position its own spelling" group below restores each to its own
    // (spec §5.1).
    const src = '<img src="logo.png"><img src="./logo.png">';
    const boundary = assetBoundary(assetSwaps(src, parseAssetRefs(src), '', fake));

    expect(boundary.fromPreview('<img src="blob:logo.png">')).toBe('<img src="logo.png">');
  });

  it('substitutions in <style> bodies enter the pairs too', () => {
    const src = '<style>body{background:url(bg.png)}</style>';
    const list = assetSwaps(src, parseAssetRefs(src), '', fake);
    const boundary = assetBoundary(list);

    expect(list.some((s) => s.to.includes('url(blob:bg.png)'))).toBe(true);
    expect(boundary.fromPreview('body{background:url(blob:bg.png)}')).toBe(
      'body{background:url(bg.png)}'
    );
  });

  it('does not change a fragment whose content disagrees with its position on a guess (Principle 3)', () => {
    // Called with another block's offset, the ranges overlap but the content
    // differs — leave it alone.
    const boundary = assetBoundary(swaps());

    expect(
      boundary.toPreview('전혀 다른 내용의 조각이 같은 길이로 있다고 치자!!', innerStart)
    ).toBe('전혀 다른 내용의 조각이 같은 길이로 있다고 치자!!');
  });
});

describe('assetBoundary · each position its own spelling (spec §5.1)', () => {
  /** A block spelling the same file two ways — the preview spellings coincide, so a table cannot tell them apart */
  const src = '<p><img src="logo.png"> 사이 <img src="./logo.png"></p>';
  const start = 3;
  const end = src.indexOf('</p>');
  const inner = src.slice(start, end);
  const boundary = () => assetBoundary(assetSwaps(src, parseAssetRefs(src), '', fake));

  it('substituting and restoring returns both spellings to their own places (Principles 1 and 2)', () => {
    const b = boundary();

    expect(b.fromPreview(b.toPreview(inner, start), start, end)).toBe(inner);
  });

  it('editing only the text keeps the spelling of untouched references (Principle 2)', () => {
    // The old code restored via a single table, grinding ./logo.png into logo.png —
    // a diff in an attribute never edited.
    const edited = '<img src="blob:logo.png"> 고친 글 <img src="blob:logo.png">';

    expect(boundary().fromPreview(edited, start, end)).toBe(
      '<img src="logo.png"> 고친 글 <img src="./logo.png">'
    );
  });

  it('two references differing only in the query also return to their own spellings', () => {
    // Queries are not appended to blob URLs, so the preview spellings coincide —
    // restoration keeps them apart.
    const q = '<p><img src="logo.png?v=1"><img src="logo.png?v=2"></p>';
    const qEnd = q.indexOf('</p>');
    const qInner = q.slice(3, qEnd);
    const b = assetBoundary(assetSwaps(q, parseAssetRefs(q), '', fake));

    expect(b.fromPreview(b.toPreview(qInner, 3), 3, qEnd)).toBe(qInner);
  });

  it('serialized pairs are also per-position spellings', () => {
    // The two fragments decode to the same value, so their browser-serialized
    // spellings coincide — the source entity spellings differ per position, so
    // each must return to its own.
    const e = '<p><use href="sprite.svg#i&#32;con"/><use href="sprite.svg#i con"/></p>';
    const eEnd = e.indexOf('</p>');
    const b = assetBoundary(assetSwaps(e, parseAssetRefs(e), '', fake));

    expect(
      b.fromPreview(
        '<use href="blob:sprite.svg#i con"></use><use href="blob:sprite.svg#i con"></use>',
        3,
        eEnd
      )
    ).toBe('<use href="sprite.svg#i&#32;con"></use><use href="sprite.svg#i con"></use>');
  });

  it('restores to the first source spelling when a deletion leaves the counts unequal', () => {
    // Which position it belonged to cannot be proven — use the deterministic first
    // spelling instead of a guess. Either spelling names the same file, and that
    // block is the range the user actually edited.
    expect(boundary().fromPreview('<img src="blob:logo.png">', start, end)).toBe(
      '<img src="logo.png">'
    );
  });

  it('a blob spelling copied in from another block restores via the table', () => {
    // Even with no substitution of that spelling inside the range, a blob URL
    // cannot be left behind (INV-9).
    const two = '<p><img src="a.png"></p><p><img src="b.png"></p>';
    const firstEnd = two.indexOf('</p>');
    const b = assetBoundary(assetSwaps(two, parseAssetRefs(two), '', fake));

    expect(b.fromPreview('<img src="blob:a.png"><img src="blob:b.png">', 3, firstEnd)).toBe(
      '<img src="a.png"><img src="b.png">'
    );
  });
});
