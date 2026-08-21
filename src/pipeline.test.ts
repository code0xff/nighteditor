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

/** 프리뷰 문서를 렌더하고 에이전트를 붙인다. 실제 호스트가 하는 일과 같다. */
function mountPreview(html: string): FromPreview[] {
  const sent: FromPreview[] = [];
  // 아티팩트 스크립트는 실행하지 않는다. 여기서 보려는 건 호스트↔프리뷰 배선이다.
  document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  vi.spyOn(window.parent, 'postMessage').mockImplementation(((msg: unknown) => {
    sent.push(msg as FromPreview);
  }) as typeof window.parent.postMessage);
  dispose = previewAgent();
  // 편집은 대조가 끝나 잠금 목록이 온 뒤에만 열린다 (spec §4). 호스트가 보내는
  // 그 신호까지가 "실제 호스트가 하는 일"이다 — 빈 목록이라도 보내야 한다.
  window.dispatchEvent(
    new MessageEvent('message', { data: { type: 'locked', ids: [] }, source: window.parent })
  );
  return sent;
}

describe('전체 파이프라인 · 합성 아티팩트', () => {
  it('파싱 → 프리뷰 → 편집 → 저장이 한 줄 diff 로 끝난다', () => {
    const blocks = parseBlocks(source);
    const sent = mountPreview(buildPreviewDocument(source, blocks));

    const target = blocks.find((b) => b.tag === 'h1');
    if (!target) throw new Error('h1 없음');

    const el = document.querySelector<HTMLElement>(`[${MARKER_ATTR}="${target.id}"]`);
    expect(el, '마커가 프리뷰에 살아 있어야 한다').not.toBeNull();

    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    el!.innerHTML = '고친 표지 <b>2026</b>';
    document.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

    const edit = sent.find((m): m is Extract<FromPreview, { type: 'edit' }> => m.type === 'edit');
    expect(edit?.id).toBe(target.id);

    const output = applyPatches(source, blocks, [{ id: edit!.id, newInnerHtml: edit!.html }]);
    expect(changedLines(source, output)).toBe(1);
    expect(output).toContain('<h1>고친 표지 <b>2026</b></h1>');
  });

  it('프리뷰가 보고한 라이브 텍스트로 대조하면 잠금이 확정된다', () => {
    const blocks = parseBlocks(source);
    const sent = mountPreview(buildPreviewDocument(source, blocks));

    window.dispatchEvent(new Event('load'));
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const ready = sent.find(
          (m): m is Extract<FromPreview, { type: 'ready' }> => m.type === 'ready'
        );
        expect(ready, 'ready 를 보고해야 한다').toBeDefined();

        const locked = applyLiveLocks(blocks, new Map(ready!.blocks.map((b) => [b.id, b.text])));
        // 스크립트를 걷어냈으므로 라이브 = 소스다. 파싱 때 정한 잠금만 남아야 한다.
        const reasons = new Set(locked.map((b) => b.locked).filter(Boolean));
        expect(reasons).toEqual(new Set(['CODE_BLOCK', 'EMPTY_IN_SOURCE']));
        resolve();
      }, 0);
    });
  });

  it('아무것도 고치지 않고 저장하면 원본과 바이트 단위로 같다', () => {
    const blocks = parseBlocks(source);
    expect(applyPatches(source, blocks, [])).toBe(source);
  });
});

describe('전체 파이프라인 · 외부 자원 (spec §5.1)', () => {
  const multi =
    '<html><head><link rel="stylesheet" href="deck.css">' +
    '<style>body{background:url(bg.png)}</style></head>' +
    '<body><h1>제목</h1><img src="img/logo.png"><a href="next.html">다음</a></body></html>';

  const urls = new Map([
    ['deck.css', 'blob:css'],
    ['bg.png', 'blob:bg'],
    ['img/logo.png', 'blob:logo'],
  ]);

  it('프리뷰에서만 자원 경로를 blob URL 로 바꾼다', () => {
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
    // 링크는 이동할 곳이지 붙일 자원이 아니다.
    expect(doc).toContain('href="next.html"');
    // 마커도 함께 들어간다 — 둘 다 같은 원본 offset 을 쓰므로 한 번에 적용해야 한다.
    expect(doc).toContain(`<h1 ${MARKER_ATTR}=`);
  });

  it('저장본에는 blob 이 한 글자도 들어가지 않는다 (ADR-009)', () => {
    const blocks = parseBlocks(multi);
    const target = blocks.find((b) => b.tag === 'h1');
    const out = applyPatches(multi, blocks, [{ id: target?.id ?? -1, newInnerHtml: '고친 제목' }]);

    expect(out).not.toContain('blob:');
    expect(out).toContain('href="deck.css"');
    expect(out).toContain('src="img/logo.png"');
    expect(changedLines(multi, out)).toBe(1);
  });

  it('자원이 없어도 문서는 그대로 열린다', () => {
    const blocks = parseBlocks(multi);
    const refs = parseAssetRefs(multi, '');
    // 못 붙인 참조는 치환 목록에 들지 않는다 — 문서는 그대로다.
    const doc = buildPreviewDocument(
      multi,
      blocks,
      assetSwaps(multi, refs, '', () => undefined)
    );

    // 없는 자원을 있는 척 바꾸지 않는다. 화면만 다르고 편집은 그대로 된다.
    expect(doc).toContain('href="deck.css"');
    expect(doc).toContain(`<h1 ${MARKER_ATTR}=`);
  });

  it('하위 폴더의 문서는 자기 자리를 기준으로 자원을 찾는다', () => {
    const refs = parseAssetRefs(multi, 'slides');

    expect(refs.map((r) => r.path)).toEqual(['slides/deck.css', 'slides/img/logo.png']);
  });
});

describe('전체 파이프라인 · 블록 안의 자원 (INV-9 · ADR-011)', () => {
  // 자원 참조가 **편집 가능한 블록 안**에 있는 문서 — 치환이 편집 범위 안쪽에서
  // 일어나, 경계 없이는 프리뷰의 blob URL 이 innerHTML 을 타고 저장본으로 샌다.
  const doc =
    '<html><body>\n<p>설명 <span>사진 <img src="logo.png"></span></p>\n' +
    '<h1>제목</h1>\n</body></html>';
  const urls = new Map([['logo.png', 'blob:logo']]);
  const swaps = () => assetSwaps(doc, parseAssetRefs(doc), '', (p) => urls.get(p));

  it('블록을 고쳐도 저장본에는 blob 이 없고 원문 표기가 남는다', () => {
    const blocks = parseBlocks(doc);
    const sent = mountPreview(buildPreviewDocument(doc, blocks, swaps()));
    const target = blocks.find((b) => b.tag === 'p');
    if (!target) throw new Error('p 없음');

    const el = document.querySelector<HTMLElement>(`[${MARKER_ATTR}="${target.id}"]`);
    // 프리뷰의 블록 안에는 blob URL 이 붙어 있다 — 편집 결과에도 그대로 실려 온다.
    expect(el?.querySelector('img')?.getAttribute('src')).toBe('blob:logo');

    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    el!.innerHTML = '고친 설명 <span>사진 <img src="blob:logo"></span>';
    document.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

    const edit = sent.find((m): m is Extract<FromPreview, { type: 'edit' }> => m.type === 'edit');
    expect(edit?.html).toContain('blob:'); // 프리뷰가 보내는 것은 프리뷰 표기다

    // 호스트는 경계로 되돌린 뒤에야 패치로 삼는다 (ADR-011).
    const restored = assetBoundary(swaps()).fromPreview(edit!.html);
    const out = applyPatches(doc, blocks, [{ id: edit!.id, newInnerHtml: restored }]);

    expect(out).not.toContain('blob:');
    expect(out).toContain('src="logo.png"');
    expect(changedLines(doc, out)).toBe(1);
  });

  it('되돌리기로 나가는 소스 조각은 blob 을 단 채로 가고, 되돌아오면 원문과 같다', () => {
    const blocks = parseBlocks(doc);
    const target = blocks.find((b) => b.tag === 'p');
    if (!target) throw new Error('p 없음');
    const boundary = assetBoundary(swaps());

    const outgoing = boundary.toPreview(target.sourceInner, target.innerStart);

    // 원문 그대로 보내면 프리뷰의 치환이 풀려 되돌린 블록의 그림만 깨진다.
    expect(outgoing).toContain('src="blob:logo"');
    // 왕복은 바이트 단위로 같다 (대원칙 1·2).
    expect(boundary.fromPreview(outgoing)).toBe(target.sourceInner);
  });
});
