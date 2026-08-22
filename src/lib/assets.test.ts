import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAssets } from './assets.js';

/** 만든 blob 을 URL 로 되찾을 수 있게 붙잡아 둔다 — 내용까지 검사하기 위해서다 */
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

describe('buildAssets · 스타일시트가 스타일시트를 부른다', () => {
  it('부르는 쪽이 먼저 와도 불리는 쪽의 blob URL 이 들어간다', async () => {
    // 옛 코드는 files 순서대로 CSS 를 만들어서, main.css 가 theme.css 보다 앞이면
    // theme.css 의 URL 이 아직 없어 @import 가 상대 경로로 남았다 — blob 문서에서
    // 상대 경로는 풀리지 않으므로 파일이 있는데도 적용되지 않았다.
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

  it('하위 폴더의 스타일시트도 자기 자리를 기준으로 잇는다', async () => {
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

  it('한 다리 건넌 시트의 깨진 참조도 못 붙였다고 센다', async () => {
    // 문서 → main.css → theme.css → 없는 글꼴. 문서에서 바로 닿는 시트만 보면
    // theme.css 를 건너뛰어, 화면은 깨졌는데 못 붙였다는 말이 없다 (대원칙 3).
    stubObjectUrls();
    const files = new Map<string, Blob>([
      ['main.css', css("@import url('theme.css');")],
      ['theme.css', css('@font-face{src:url(fonts/f.woff2)}')],
    ]);

    const bundle = await buildAssets(files, ['main.css']);

    expect(bundle.missing).toContain('fonts/f.woff2');
  });

  it('문서와 무관한 시트의 깨진 참조는 여전히 세지 않는다', async () => {
    // 닿는 범위를 넓히는 것이지, 폴더에 굴러다니는 남의 시트까지 줍는 것이 아니다.
    stubObjectUrls();
    const files = new Map<string, Blob>([
      ['main.css', css('p{color:red}')],
      ['stray.css', css('@font-face{src:url(ghost.woff2)}')],
    ]);

    const bundle = await buildAssets(files, ['main.css']);

    expect(bundle.missing).toEqual([]);
  });

  it('서로를 부르는 순환에서도 멈추지 않고 전부 만든다', async () => {
    // blob 으로는 이을 수 없는 고리다 — 기다려도 URL 은 생기지 않으므로 그대로 만든다.
    stubObjectUrls();
    const files = new Map<string, Blob>([
      ['a.css', css('@import url(b.css);')],
      ['b.css', css('@import url(a.css);')],
    ]);

    const bundle = await buildAssets(files);

    expect(bundle.urls.has('a.css')).toBe(true);
    expect(bundle.urls.has('b.css')).toBe(true);
  });

  it('순환을 밖에서 부르는 시트는 고리가 만들어진 뒤에 만든다', async () => {
    // entry.css 가 서로 부르는 a.css·b.css 고리를 부른다. 옛 코드는 고리에 막히면
    // 남은 전부를 한꺼번에 만들어, entry.css 가 a.css 의 URL 이 생기기 전에
    // 만들어졌다 — @import 가 상대 경로로 남아 blob 문서에서 영영 풀리지 않았다.
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

  it('고리가 여럿이면 한 덩어리씩 만든다 — 다른 고리를 부르는 @import 도 URL 을 단다', async () => {
    // a⇄b 와 c⇄d 는 서로 다른 고리인데 a 가 c 를 부른다. 고리에 든 시트를 전부
    // 한꺼번에 만들면 a 가 c 의 URL 이 생기기 전에 만들어져, 그 @import 가 상대
    // 경로로 남았다 — 기대지 않는 덩어리(c⇄d)부터 만들어야 한다 (spec §5.1).
    const blobs = stubObjectUrls();
    const files = new Map<string, Blob>([
      ['a.css', css("@import url('b.css');@import url('c.css');")],
      ['b.css', css("@import url('a.css');")],
      ['c.css', css("@import url('d.css');")],
      ['d.css', css("@import url('c.css');")],
    ]);

    const bundle = await buildAssets(files);
    const a = blobs.get(bundle.urls.get('a.css') ?? '');

    // 같은 고리 안의 b 는 어차피 이을 수 없어 상대 경로로 남지만,
    // 다른 고리의 c 는 그 고리가 먼저 만들어졌으므로 URL 이 달린다.
    expect(await a?.text()).toBe(
      `@import url('b.css');@import url('${bundle.urls.get('c.css')}');`
    );
  });

  it('고리에서 두 다리 건넌 시트도 차례대로 URL 을 단다', async () => {
    // entry → mid → (a ⇄ b). 고리만 먼저 만들면 mid 가 다음 바퀴에서 a 의 URL 을
    // 달고, entry 는 그다음 바퀴에서 mid 의 URL 을 단다.
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

describe('buildAssets · blob 의 형식 (spec §5.1)', () => {
  it('아는 확장자는 보고된 형식을 덮는다 — text/plain 스크립트는 브라우저가 거절한다', async () => {
    // 폴더·드롭이 .js 를 text/plain 으로 보고하는 환경이 있다. 그대로 blob 에
    // 실으면 파일이 옆에 있는데도 링크된 스크립트가 돌지 않는다.
    const blobs = stubObjectUrls();
    const files = new Map<string, Blob>([
      ['app.js', new Blob(['console.log(1)'], { type: 'text/plain' })],
    ]);

    const bundle = await buildAssets(files);

    expect(blobs.get(bundle.urls.get('app.js') ?? '')?.type).toBe('text/javascript');
  });

  it('형식이 이미 맞으면 그대로 쓴다', async () => {
    const blobs = stubObjectUrls();
    const png = new Blob(['x'], { type: 'image/png' });
    const files = new Map<string, Blob>([['logo.png', png]]);

    const bundle = await buildAssets(files);

    expect(blobs.get(bundle.urls.get('logo.png') ?? '')).toBe(png);
  });

  it('모르는 확장자는 보고된 형식을 믿고, 그것도 없으면 octet-stream 이다', async () => {
    const blobs = stubObjectUrls();
    const files = new Map<string, Blob>([
      ['data.custom', new Blob(['x'], { type: 'application/x-thing' })],
      ['bare.custom', new Blob(['x'])],
    ]);

    const bundle = await buildAssets(files);

    expect(blobs.get(bundle.urls.get('data.custom') ?? '')?.type).toBe('application/x-thing');
    expect(blobs.get(bundle.urls.get('bare.custom') ?? '')?.type).toBe('application/octet-stream');
  });

  it('스타일시트는 보고된 형식과 무관하게 text/css 다', async () => {
    const blobs = stubObjectUrls();
    const files = new Map<string, Blob>([
      ['main.css', new Blob(['p{color:red}'], { type: 'text/plain' })],
    ]);

    const bundle = await buildAssets(files);

    expect(blobs.get(bundle.urls.get('main.css') ?? '')?.type).toBe('text/css');
  });
});
