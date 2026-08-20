import { describe, expect, it } from 'vitest';
import {
  assetEdits,
  dirOf,
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
