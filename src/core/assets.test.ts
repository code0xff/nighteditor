import { describe, expect, it } from 'vitest';
import {
  assetEdits,
  cssAssetPaths,
  dirOf,
  documentBaseDir,
  parseAssetRefs,
  resolvePath,
  rewriteCssUrls,
  styleEdits,
} from './assets.js';
import { applyEdits } from './edits.js';

/** 경로를 그대로 blob 흉내로 바꾼다 */
const fake = (path: string): string => `blob:${path}`;

describe('resolvePath', () => {
  it('문서가 놓인 자리를 기준으로 푼다', () => {
    expect(resolvePath('', 'deck.css')).toBe('deck.css');
    expect(resolvePath('slides', 'deck.css')).toBe('slides/deck.css');
    expect(resolvePath('slides/2026', '../deck.css')).toBe('slides/deck.css');
    expect(resolvePath('slides', './img/logo.png')).toBe('slides/img/logo.png');
  });

  it('절대 경로는 묶음의 뿌리를 기준으로 본다', () => {
    expect(resolvePath('slides/2026', '/assets/deck.css')).toBe('assets/deck.css');
  });

  it('밖으로 나가는 참조는 건드리지 않는다', () => {
    // 이미 브라우저가 가져올 수 있거나, 애초에 자원이 아니다.
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

  it('질의 문자열과 앵커를 떼어낸다', () => {
    expect(resolvePath('', 'deck.css?v=3')).toBe('deck.css');
    expect(resolvePath('', 'sprite.svg#icon')).toBe('sprite.svg');
  });

  it('퍼센트 인코딩을 실제 파일 이름으로 되돌린다', () => {
    // 묶음의 키는 문서에 적힌 표기가 아니라 디스크에 있는 이름이다.
    expect(resolvePath('', 'my%20deck.css')).toBe('my deck.css');
  });

  it('뿌리 밖으로 나가려 해도 넘어가지 않는다', () => {
    expect(resolvePath('', '../../etc/passwd')).toBe('etc/passwd');
  });
});

describe('dirOf', () => {
  it('문서가 놓인 디렉터리를 준다', () => {
    expect(dirOf('slides/deck.html')).toBe('slides');
    expect(dirOf('deck.html')).toBe('');
  });
});

describe('parseAssetRefs', () => {
  it('자원을 가리키는 속성을 찾는다', () => {
    const refs = parseAssetRefs(
      '<link rel="stylesheet" href="deck.css">' +
        '<script src="app.js"></script>' +
        '<img src="logo.png"><video src="v.mp4" poster="p.jpg"></video>'
    );

    expect(refs.map((r) => r.path)).toEqual(['deck.css', 'app.js', 'logo.png', 'v.mp4', 'p.jpg']);
  });

  it('<a href> 는 자원이 아니다', () => {
    // 이동할 곳이다. blob 으로 바꾸면 링크가 엉뚱한 데로 간다.
    expect(parseAssetRefs('<a href="next.html">다음</a>')).toHaveLength(0);
  });

  it('바깥 URL 은 목록에 넣지 않는다', () => {
    const refs = parseAssetRefs(
      '<link href="https://cdn.example.com/a.css"><img src="data:image/gif;base64,R0lGOD">'
    );

    expect(refs).toHaveLength(0);
  });

  it('값 범위가 따옴표 안쪽만 가리킨다', () => {
    const source = '<img src="logo.png">';
    const [ref] = parseAssetRefs(source);

    expect(source.slice(ref?.valueStart, ref?.valueEnd)).toBe('logo.png');
  });

  it('따옴표 없는 값도 값만 가리킨다', () => {
    const source = '<img src=logo.png>';
    const [ref] = parseAssetRefs(source);

    expect(source.slice(ref?.valueStart, ref?.valueEnd)).toBe('logo.png');
  });

  it('작은따옴표도 받는다', () => {
    const source = "<img src='logo.png'>";
    const [ref] = parseAssetRefs(source);

    expect(source.slice(ref?.valueStart, ref?.valueEnd)).toBe('logo.png');
  });

  it('문서가 하위 폴더에 있으면 그 자리를 기준으로 푼다', () => {
    const refs = parseAssetRefs('<img src="img/logo.png">', 'slides');

    expect(refs[0]?.path).toBe('slides/img/logo.png');
    expect(refs[0]?.url).toBe('img/logo.png');
  });
});

describe('documentBaseDir (spec §5.1)', () => {
  it('<base href> 가 없으면 문서 자리가 기준이다', () => {
    expect(documentBaseDir('<html><body><p>글</p></body></html>', 'deck')).toBe('deck');
  });

  it('디렉터리 base 는 문서 자리에 이어 붙는다', () => {
    const source = '<html><head><base href="assets/"></head><body></body></html>';
    expect(documentBaseDir(source, '')).toBe('assets');
    expect(documentBaseDir(source, 'deck')).toBe('deck/assets');
  });

  it('파일이 붙은 base 는 마지막 조각을 떼어낸다 — base 는 디렉터리가 아니라 URL 이다', () => {
    const source = '<base href="assets/sub/page.html">';
    expect(documentBaseDir(source, '')).toBe('assets/sub');
  });

  it('상위로 올라가는 base 를 접는다', () => {
    expect(documentBaseDir('<base href="../shared/">', 'deck')).toBe('shared');
  });

  it('뿌리 base 는 묶음의 최상단이다', () => {
    expect(documentBaseDir('<base href="/">', 'deck')).toBe('');
    expect(documentBaseDir('<base href="/assets/">', 'deck')).toBe('assets');
  });

  it('바깥을 가리키는 base 는 null — 상대 참조가 로컬 파일이 아니다', () => {
    expect(documentBaseDir('<base href="https://cdn.example/">', '')).toBeNull();
    expect(documentBaseDir('<base href="//cdn.example/">', 'deck')).toBeNull();
  });

  it('href 있는 첫 <base> 만 유효하다 — HTML 사양과 같다', () => {
    const source = '<base target="_blank"><base href="a/"><base href="b/">';
    expect(documentBaseDir(source, '')).toBe('a');
  });

  it('그 기준으로 참조가 풀린다', () => {
    const source = '<base href="assets/"><link rel="stylesheet" href="style.css">';
    const refs = parseAssetRefs(source, documentBaseDir(source, '') ?? '');
    expect(refs.map((r) => r.path)).toEqual(['assets/style.css']);
  });
});

describe('assetEdits', () => {
  it('붙일 자원이 있는 자리만 바꾼다', () => {
    const source = '<link href="deck.css"><img src="없다.png">';
    const refs = parseAssetRefs(source);
    const out = applyEdits(
      source,
      assetEdits(refs, (path) => (path === 'deck.css' ? fake(path) : undefined))
    );

    // 못 붙인 자리는 원본 그대로 둔다 — 있지도 않은 URL 로 바꾸면 더 나쁘다.
    expect(out).toBe('<link href="blob:deck.css"><img src="없다.png">');
  });

  it('마커 주입과 한 목록에서 함께 적용된다', () => {
    // 따로 적용하면 앞선 삽입이 뒤쪽 offset 을 밀어 엉뚱한 자리를 자른다.
    const source = '<p>글</p><img src="logo.png">';
    const refs = parseAssetRefs(source);
    const out = applyEdits(source, [
      { start: 2, end: 2, text: ' data-ne-id="0"' },
      ...assetEdits(refs, fake),
    ]);

    expect(out).toBe('<p data-ne-id="0">글</p><img src="blob:logo.png">');
  });
});

describe('assetEdits · 디코딩된 조각의 인코딩 (INV-8)', () => {
  it('엔티티로 적힌 따옴표가 조각에 있어도 속성을 조기 종료시키지 않는다', () => {
    // parse5 는 &quot; 를 " 로 풀어 준다. 그대로 되적으면 값이 거기서 끝나고,
    // 조각의 나머지가 프리뷰에서 onerror= 같은 새 속성으로 승격된다.
    const source = '<img src="x.png#foo&quot; onerror=&quot;alert(1)">';
    const refs = parseAssetRefs(source);
    const edits = assetEdits(refs, () => 'blob:x');

    expect(edits[0]?.text).not.toContain('"');
    expect(edits[0]?.text).not.toContain(' ');
    const out = applyEdits(source, edits);
    // 치환된 값이 여전히 원래 따옴표 안에 통째로 담겨 있어야 한다.
    expect(out.startsWith('<img src="blob:x#foo')).toBe(true);
    expect(out.endsWith('">')).toBe(true);
  });

  it('평범한 조각은 그대로 남는다', () => {
    const source = '<use href="sprite.svg#icon"/>';
    const refs = parseAssetRefs(source);
    const edits = assetEdits(refs, () => 'blob:s');

    expect(edits[0]?.text).toBe('blob:s#icon');
  });
});

describe('rewriteCssUrls', () => {
  it('스타일시트 안의 상대 경로를 그 파일 위치 기준으로 푼다', () => {
    // blob URL 에는 디렉터리가 없다. 안 바꾸면 글꼴이 전부 깨진다.
    const css = "@font-face{src:url('fonts/x.woff2')}";

    expect(rewriteCssUrls(css, 'assets', fake)).toBe(
      "@font-face{src:url('blob:assets/fonts/x.woff2')}"
    );
  });

  it('따옴표 유무와 공백을 보존한다', () => {
    expect(rewriteCssUrls('a{background:url(bg.png)}', '', fake)).toBe(
      'a{background:url(blob:bg.png)}'
    );
    expect(rewriteCssUrls('a{background:url( "bg.png" )}', '', fake)).toBe(
      'a{background:url("blob:bg.png")}'
    );
  });

  it('바깥 URL 과 못 찾은 자원은 그대로 둔다', () => {
    const css = 'a{background:url(https://cdn.example.com/x.png)}b{background:url(없다.png)}';

    expect(rewriteCssUrls(css, '', () => undefined)).toBe(css);
  });

  it('식별자 한가운데의 url( 은 함수 이름의 일부라 바꾸지 않는다', () => {
    // `--icon: myurl(x)` 를 바꾸면 자원이 아닌 남의 함수가 `myurl(blob:...)` 이 된다.
    const css = ':root{--icon: myurl(icon.png)}a{background:url(icon.png)}';

    expect(rewriteCssUrls(css, '', fake)).toBe(
      ':root{--icon: myurl(icon.png)}a{background:url(blob:icon.png)}'
    );
  });

  it('여는 괄호·쉼표·공백 같은 토큰 경계 뒤의 url( 은 바꾼다', () => {
    expect(rewriteCssUrls('a{background:red url(bg.png),url(bg.png)}', '', fake)).toBe(
      'a{background:red url(blob:bg.png),url(blob:bg.png)}'
    );
  });
});

describe('styleEdits', () => {
  it('문서에 박힌 <style> 안도 바꾼다', () => {
    const source = '<style>body{background:url(bg.png)}</style><p>글</p>';
    const out = applyEdits(source, styleEdits(source, '', fake));

    expect(out).toBe('<style>body{background:url(blob:bg.png)}</style><p>글</p>');
  });

  it('바꿀 것이 없으면 편집을 만들지 않는다', () => {
    expect(styleEdits('<style>body{color:red}</style>', '', fake)).toHaveLength(0);
  });
});

describe('parseAssetRefs · 이름공간 속성', () => {
  it('xlink:href 를 찾는다', () => {
    // parse5 는 이걸 { name: 'href', prefix: 'xlink' } 로 쪼개 두고 위치만
    // 'xlink:href' 키로 남긴다. 이름만 보면 통째로 놓친다.
    const refs = parseAssetRefs('<svg><use xlink:href="sprite.svg#icon"/></svg>');

    expect(refs.map((r) => r.path)).toEqual(['sprite.svg']);
  });

  it('두 형태가 함께 있어도 각자 제 값을 집는다', () => {
    const source = '<svg><use xlink:href="old.svg#a"/><use href="new.svg#b"/></svg>';
    const refs = parseAssetRefs(source);

    expect(refs.map((r) => r.path)).toEqual(['old.svg', 'new.svg']);
    for (const ref of refs) {
      // 값 범위가 제 속성을 가리켜야 한다 — 어긋나면 엉뚱한 자리를 바꾼다.
      expect(source.slice(ref.valueStart, ref.valueEnd)).toBe(ref.url);
    }
  });
});

describe('자원 참조의 질의와 조각', () => {
  it('붙일 때 조각을 다시 단다', () => {
    // #icon 을 잃으면 스프라이트에서 무엇을 꺼낼지가 사라져 아무것도 그리지 않는다.
    const source = '<svg><use href="sprite.svg#icon"/></svg>';
    const out = applyEdits(source, assetEdits(parseAssetRefs(source), fake));

    expect(out).toContain('href="blob:sprite.svg#icon"');
  });

  it('질의는 떼고, 파일도 질의를 뺀 이름으로 찾는다', () => {
    // blob URL 은 질의가 붙는 순간 만들어 둔 객체와 다른 이름이 되어 아예 열리지 않는다.
    const source = '<link href="deck.css?v=3">';
    const [ref] = parseAssetRefs(source);
    const out = applyEdits(source, assetEdits(parseAssetRefs(source), fake));

    expect(ref?.path).toBe('deck.css');
    expect(out).toBe('<link href="blob:deck.css">');
  });

  it('질의와 조각이 함께 있으면 조각만 남긴다', () => {
    const source = '<svg><use href="sprite.svg?v=2#icon"/></svg>';
    const out = applyEdits(source, assetEdits(parseAssetRefs(source), fake));

    expect(out).toContain('href="blob:sprite.svg#icon"');
  });

  it('CSS 안에서도 조각을 지킨다', () => {
    expect(rewriteCssUrls('a{clip-path:url(shapes.svg#round)}', '', fake)).toBe(
      'a{clip-path:url(blob:shapes.svg#round)}'
    );
  });

  it('CSS 안에서도 질의는 뗀다', () => {
    expect(rewriteCssUrls('a{background:url("bg.png?v=3")}', '', fake)).toBe(
      'a{background:url("blob:bg.png")}'
    );
    expect(rewriteCssUrls('@font-face{src:url(f.woff2?v=1#iefix)}', '', fake)).toBe(
      '@font-face{src:url(blob:f.woff2#iefix)}'
    );
  });
});

describe('rewriteCssUrls · 문자열과 주석', () => {
  it('문자열 안의 url( 은 자원이 아니라 글자다', () => {
    // content 는 화면에 찍히는 값이다. 바꾸면 없던 글자가 생긴다.
    const css = `a::after{content:'url(icon.png)'}`;

    expect(rewriteCssUrls(css, '', fake)).toBe(css);
  });

  it('주석 안도 건드리지 않는다', () => {
    const css = '/* url(icon.png) 는 예시다 */ a{background:url(icon.png)}';

    expect(rewriteCssUrls(css, '', fake)).toBe(
      '/* url(icon.png) 는 예시다 */ a{background:url(blob:icon.png)}'
    );
  });

  it('따옴표에 싸인 값과 대문자 URL( 도 바꾼다', () => {
    expect(rewriteCssUrls('a{background:URL("bg.png")}', '', fake)).toBe(
      'a{background:url("blob:bg.png")}'
    );
  });

  it('닫히지 않은 url( 은 그대로 둔다', () => {
    expect(rewriteCssUrls('a{background:url(bg.png', '', fake)).toBe('a{background:url(bg.png');
  });
});

describe('cssAssetPaths', () => {
  it('CSS 가 가리키는 자원 경로를 모은다 — 못 붙인 것을 세려면 목록이 필요하다', () => {
    const css = '@font-face{src:url(fonts/x.woff2)}a{background:url("../img/bg.png")}';

    expect(cssAssetPaths(css, 'assets')).toEqual(['assets/fonts/x.woff2', 'img/bg.png']);
  });

  it('바깥 URL 은 세지 않는다', () => {
    expect(cssAssetPaths('a{background:url(https://cdn.example.com/x.png)}', '')).toEqual([]);
  });

  it('남의 함수 이름에 붙은 url( 은 세지 않는다', () => {
    // 세면 이 문서와 상관없는 파일을 찾으라고 조른다.
    expect(cssAssetPaths(':root{--icon: myurl(icon.png)}', '')).toEqual([]);
  });
});
