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

  it('인코딩된 점 조각도 점으로 접는다 (spec §5.1)', () => {
    // URL 사양은 %2e 조각을 점 조각으로 접는다. 접은 뒤에 풀면 deck/sub 의
    // %2e%2e/logo.png 가 deck/sub/../logo.png 로 남아, 실제로 옆에 있는
    // deck/logo.png 를 없다고 센다.
    expect(resolvePath('deck/sub', '%2e%2e/logo.png')).toBe('deck/logo.png');
    expect(resolvePath('deck/sub', '%2E%2E/logo.png')).toBe('deck/logo.png');
    expect(resolvePath('deck/sub', '%2e/logo.png')).toBe('deck/sub/logo.png');
  });

  it('잘못된 인코딩의 조각은 적힌 그대로 두고, 나머지는 푼다', () => {
    // 통째로 풀다 실패하면 멀쩡한 조각까지 표기 그대로 남는다 — 조각마다 따로 푼다.
    expect(resolvePath('', '100%/my%20deck.css')).toBe('100%/my deck.css');
  });

  it('조각 안의 %2F 는 구분자로 풀지 않는다 (spec §5.1)', () => {
    // 디스크의 파일 이름에는 슬래시가 있을 수 없다 — 풀면 이름의 일부가 경로
    // 구분자로 변해, a%2Fb.png 라는 실제 파일 대신 a/b.png 라는 없는 자리를 찾는다.
    expect(resolvePath('', 'a%2Fb.png')).toBe('a%2Fb.png');
    // 표기(대소문자)는 적힌 그대로다 — 묶음의 키는 디스크의 이름이다.
    expect(resolvePath('', 'a%2fb.png')).toBe('a%2fb.png');
    // 같은 조각의 다른 인코딩은 여전히 풀린다.
    expect(resolvePath('', 'img/a%2Fb%20c.png')).toBe('img/a%2Fb c.png');
    // %252F 의 %25 는 % 로 풀린다 — %2F 그 자체가 아니다.
    expect(resolvePath('', 'a%252Fb.png')).toBe('a%2Fb.png');
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

  it('질의·조각만 있는 base 는 자리를 옮기지 않는다', () => {
    // URL 해석에서 `?v=2` 는 문서 제 주소에 질의만 갈아 끼운 것이다 — 기준은
    // 문서 자리 그대로여야지, 빈 경로를 접어 한 단계 올라가면 안 된다.
    expect(documentBaseDir('<base href="?v=2">', 'deck/sub')).toBe('deck/sub');
    expect(documentBaseDir('<base href="#top">', 'deck/sub')).toBe('deck/sub');
  });

  it('마지막 조각 속의 %2F 는 구분자가 아니라 이름의 일부다', () => {
    // 푼 뒤에 파일 이름을 떼면 이름 속 슬래시에서 잘려, dir 이 아니라 dir/a 가 된다.
    expect(documentBaseDir('<base href="dir/a%2Fb.css">', '')).toBe('dir');
  });

  it('마지막 조각이 점 조각이면 자리 표시다 — 파일 이름으로 떼지 않는다 (spec §5.1)', () => {
    // 풀기 전에 마지막 조각을 떼면 deck/sub 의 `..` 가 deck 이 아니라
    // deck/sub 로 남아, 상대 자원을 전부 엉뚱한 자리에서 찾는다.
    expect(documentBaseDir('<base href="..">', 'deck/sub')).toBe('deck');
    expect(documentBaseDir('<base href=".">', 'deck/sub')).toBe('deck/sub');
    expect(documentBaseDir('<base href="foo/..">', 'deck/sub')).toBe('deck/sub');
    expect(documentBaseDir('<base href="%2e%2e">', 'deck/sub')).toBe('deck');
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

  it('이스케이프된 괄호에서 값을 끊지 않는다 — 푼 값이 경로다', () => {
    // indexOf(')') 로 찾으면 `foo\` 까지만 읽어, 멀쩡한 CSS 의 자원이 영영 붙지 않는다.
    expect(rewriteCssUrls('a{background:url(foo\\)bar.png)}', '', fake)).toBe(
      'a{background:url(blob:foo)bar.png)}'
    );
  });

  it('이스케이프를 푼 뒤에 경로로 해석한다 — 묶음의 키는 디스크의 이름이다', () => {
    // 문자 이스케이프(`\ `)와 16진 이스케이프(`\61 `, 뒤 공백까지가 이스케이프) 모두.
    expect(rewriteCssUrls('a{background:url(my\\ file.png)}', '', fake)).toBe(
      'a{background:url(blob:my file.png)}'
    );
    expect(rewriteCssUrls('a{background:url(sp\\61 ce.png)}', '', fake)).toBe(
      'a{background:url(blob:space.png)}'
    );
  });

  it('따옴표 값 안의 이스케이프도 푼다', () => {
    expect(
      rewriteCssUrls('a{background:url("we\\"ird.png")}', '', (path) =>
        path === 'we"ird.png' ? 'blob:ok' : undefined
      )
    ).toBe('a{background:url("blob:ok")}');
  });

  it('되적는 조각은 토큰을 끊는 글자만 다시 잠근다', () => {
    // 풀린 조각의 `)` 를 그대로 적으면 url() 이 그 자리에서 닫힌다 — 16진으로 잠근다.
    expect(rewriteCssUrls('a{clip-path:url(s.svg\\#i\\)x)}', '', fake)).toBe(
      'a{clip-path:url(blob:s.svg#i\\29 x)}'
    );
    // 평범한 조각은 그대로 나간다.
    expect(rewriteCssUrls('a{clip-path:url(s.svg#round)}', '', fake)).toBe(
      'a{clip-path:url(blob:s.svg#round)}'
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

describe('assetSwaps · assetBoundary (ADR-011)', () => {
  /** 블록 안에 자원이 든 문서 — 치환이 편집 범위 안쪽에서 일어나는 경우다 */
  const source = '<p>설명 <span>사진 <img src="img/logo.png"></span></p><img src="없다.png">';
  const swaps = () => assetSwaps(source, parseAssetRefs(source), '', fake);
  const innerStart = source.indexOf('설명');
  const inner = source.slice(innerStart, source.indexOf('</p>'));

  it('나가는 조각의 참조를 프리뷰 표기로 치환한다', () => {
    const out = assetBoundary(swaps()).toPreview(inner, innerStart);

    expect(out).toContain('src="blob:img/logo.png"');
    // 조각의 나머지 바이트는 그대로다 — 치환은 값 범위만 바꾼다.
    expect(out.startsWith('설명 <span>사진 ')).toBe(true);
  });

  it('치환했다 되돌리면 바이트 단위로 같다 (대원칙 1·2)', () => {
    const boundary = assetBoundary(swaps());

    expect(boundary.fromPreview(boundary.toPreview(inner, innerStart))).toBe(inner);
  });

  it('돌아온 편집의 blob URL 을 원문 표기로 되돌린다', () => {
    const edited = '고친 설명 <span>사진 <img src="blob:img/logo.png"></span>';

    expect(assetBoundary(swaps()).fromPreview(edited)).toBe(
      '고친 설명 <span>사진 <img src="img/logo.png"></span>'
    );
  });

  it('치환하지 않은 참조와 원래부터 blob: 인 표기는 어느 방향으로도 건드리지 않는다', () => {
    // 없다.png 는 못 붙였고(resolve 가 undefined), 문서에 원래 적힌 blob: 은 외부
    // 참조라 치환 목록에 들지 않는다.
    const src = '<p><img src="없다.png"><img src="blob:이미있던것"></p>';
    const list = assetSwaps(src, parseAssetRefs(src), '', (p) =>
      p === '없다.png' ? undefined : fake(p)
    );
    const boundary = assetBoundary(list);
    const body = src.slice(3, src.indexOf('</p>'));

    expect(boundary.toPreview(body, 3)).toBe(body);
    expect(boundary.fromPreview(body)).toBe(body);
  });

  it('브라우저가 직렬화로 갈아 끼운 표기도 되돌린다', () => {
    // 조각의 공백은 &#32; 로 나가지만, 브라우저 innerHTML 은 공백을 인코딩하지
    // 않아 다른 표기로 돌아온다 — 그 표기의 짝도 들고 있어야 blob 이 안 샌다.
    const src = '<p><use href="sprite.svg#i con"/></p>';
    const boundary = assetBoundary(assetSwaps(src, parseAssetRefs(src), '', fake));

    expect(boundary.fromPreview('<use href="blob:sprite.svg#i con"></use>')).toBe(
      '<use href="sprite.svg#i con"></use>'
    );
  });

  it('직렬화 짝도 원문 엔티티 표기로 되돌린다 (대원칙 2)', () => {
    // parse5 가 준 값은 &#32; 가 이미 풀려 있다 — 디코딩된 값을 재인코딩해 짝을
    // 만들면, 그 블록을 고치는 순간 손대지 않은 속성의 표기가 바뀐다.
    // 원문 쪽도 원본 슬라이스가 기준이다.
    const src = '<p><use href="sprite.svg#i&#32;con"/></p>';
    const boundary = assetBoundary(assetSwaps(src, parseAssetRefs(src), '', fake));

    expect(boundary.fromPreview('<use href="blob:sprite.svg#i con"></use>')).toBe(
      '<use href="sprite.svg#i&#32;con"></use>'
    );
  });

  it('원문의 날 큰따옴표만은 직렬화 문맥에 맞게 &quot; 로 잠근다', () => {
    // 홑따옴표 원문에는 " 가 날 것으로 있을 수 있다. 직렬화 짝은 innerHTML 이
    // 만든 큰따옴표 속성 안에 들어가므로, 날 것 그대로면 값이 조기 종료되어
    // 뒤가 새 속성으로 풀린다. 파서를 지나면 같은 값이다.
    const src = "<p><use href='sprite.svg#i\"c'/></p>";
    const boundary = assetBoundary(assetSwaps(src, parseAssetRefs(src), '', fake));

    expect(boundary.fromPreview('<use href="blob:sprite.svg#i&quot;c"></use>')).toBe(
      '<use href="sprite.svg#i&quot;c"></use>'
    );
  });

  it('조각 없는 표기가 조각 있는 표기를 가로채지 않는다', () => {
    // blob:sprite.svg 는 blob:sprite.svg#icon 의 접두사다. 짧은 쪽을 먼저 되돌리면
    // 긴 쪽이 영영 안 잡혀 #icon 이 blob 이름 뒤에 남는다.
    const src = '<img src="sprite.svg"><use href="sprite.svg#icon"/>';
    const boundary = assetBoundary(assetSwaps(src, parseAssetRefs(src), '', fake));

    expect(boundary.fromPreview('<use href="blob:sprite.svg#icon"></use>')).toBe(
      '<use href="sprite.svg#icon"></use>'
    );
  });

  it('자리를 모르면 같은 프리뷰 표기의 원문 표기 중 먼저 나온 것으로 되돌린다', () => {
    // logo.png 와 ./logo.png 는 같은 파일이라 프리뷰 표기가 같다 — 블록 범위 없이
    // 불리면 자리에 맬 수 없으므로, 결정적으로 첫 표기를 쓴다. 자리를 알 때는
    // 아래 "자리마다 제 표기" 묶음이 각자 제 표기로 되돌린다 (spec §5.1).
    const src = '<img src="logo.png"><img src="./logo.png">';
    const boundary = assetBoundary(assetSwaps(src, parseAssetRefs(src), '', fake));

    expect(boundary.fromPreview('<img src="blob:logo.png">')).toBe('<img src="logo.png">');
  });

  it('<style> 본문의 치환도 짝에 든다', () => {
    const src = '<style>body{background:url(bg.png)}</style>';
    const list = assetSwaps(src, parseAssetRefs(src), '', fake);
    const boundary = assetBoundary(list);

    expect(list.some((s) => s.to.includes('url(blob:bg.png)'))).toBe(true);
    expect(boundary.fromPreview('body{background:url(blob:bg.png)}')).toBe(
      'body{background:url(bg.png)}'
    );
  });

  it('원문과 자리가 어긋난 조각은 추측으로 바꾸지 않는다 (대원칙 3)', () => {
    // 다른 블록의 offset 을 들고 부르면 범위가 겹쳐도 내용이 다르다 — 그대로 둔다.
    const boundary = assetBoundary(swaps());

    expect(
      boundary.toPreview('전혀 다른 내용의 조각이 같은 길이로 있다고 치자!!', innerStart)
    ).toBe('전혀 다른 내용의 조각이 같은 길이로 있다고 치자!!');
  });
});

describe('assetBoundary · 자리마다 제 표기 (spec §5.1)', () => {
  /** 같은 파일을 두 표기로 적은 블록 — 프리뷰 표기가 같아 표로는 못 가른다 */
  const src = '<p><img src="logo.png"> 사이 <img src="./logo.png"></p>';
  const start = 3;
  const end = src.indexOf('</p>');
  const inner = src.slice(start, end);
  const boundary = () => assetBoundary(assetSwaps(src, parseAssetRefs(src), '', fake));

  it('치환했다 되돌리면 두 표기가 각자 제자리로 돌아간다 (대원칙 1·2)', () => {
    const b = boundary();

    expect(b.fromPreview(b.toPreview(inner, start), start, end)).toBe(inner);
  });

  it('글자만 고쳐도 손대지 않은 참조의 표기는 그대로다 (대원칙 2)', () => {
    // 옛 코드는 표 하나로 되돌려 ./logo.png 가 logo.png 로 갈렸다 — 편집한 적 없는
    // 속성의 diff 가 생긴다.
    const edited = '<img src="blob:logo.png"> 고친 글 <img src="blob:logo.png">';

    expect(boundary().fromPreview(edited, start, end)).toBe(
      '<img src="logo.png"> 고친 글 <img src="./logo.png">'
    );
  });

  it('질의만 다른 두 참조도 제 표기로 돌아간다', () => {
    // 질의는 blob URL 에 붙이지 않아 프리뷰 표기가 같아진다 — 되돌릴 때는 각자다.
    const q = '<p><img src="logo.png?v=1"><img src="logo.png?v=2"></p>';
    const qEnd = q.indexOf('</p>');
    const qInner = q.slice(3, qEnd);
    const b = assetBoundary(assetSwaps(q, parseAssetRefs(q), '', fake));

    expect(b.fromPreview(b.toPreview(qInner, 3), 3, qEnd)).toBe(qInner);
  });

  it('직렬화 짝도 자리마다 제 표기다', () => {
    // 두 조각의 디코딩 값이 같아 브라우저 직렬화 표기도 같다 — 원문 엔티티 표기는
    // 자리마다 다르므로 각자 제 표기로 돌아가야 한다.
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

  it('지워서 수가 안 맞으면 먼저 나온 원문 표기로 되돌린다', () => {
    // 어느 자리의 것인지 증명할 수 없다 — 추측 대신 결정적인 첫 표기를 쓴다.
    // 어느 표기든 같은 파일을 가리키고, 그 블록은 사용자가 실제로 고친 범위다.
    expect(boundary().fromPreview('<img src="blob:logo.png">', start, end)).toBe(
      '<img src="logo.png">'
    );
  });

  it('다른 블록에서 복사해 온 blob 표기는 표로 되돌린다', () => {
    // 범위 안에 그 표기의 치환이 없어도 blob URL 을 남길 수는 없다 (INV-9).
    const two = '<p><img src="a.png"></p><p><img src="b.png"></p>';
    const firstEnd = two.indexOf('</p>');
    const b = assetBoundary(assetSwaps(two, parseAssetRefs(two), '', fake));

    expect(b.fromPreview('<img src="blob:a.png"><img src="blob:b.png">', 3, firstEnd)).toBe(
      '<img src="a.png"><img src="b.png">'
    );
  });
});
