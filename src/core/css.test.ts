import { describe, expect, it } from 'vitest';
import { cssAssetPaths, rewriteCssUrls } from './css.js';

/** Turns a path into a blob impostor as-is */
const fake = (path: string): string => `blob:${path}`;

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

describe('queries and fragments of asset references', () => {
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
