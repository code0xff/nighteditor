// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseBlocks } from './core/parse.js';
import { applyPatches } from './core/patch.js';
import { applyLiveLocks } from './core/verify.js';
import { MARKER_ATTR } from './core/markers.js';
import { buildPreviewDocument } from './lib/preview.js';
import { previewAgent } from './preview/agent.js';
import type { FromPreview } from './preview/protocol.js';

// happy-dom 환경에서는 import.meta.url 이 file: 스킴이 아니라 fileURLToPath 를 쓸 수 없다.
const REFERENCE = join(process.cwd(), 'agent_payments.html');
const source = readFileSync(REFERENCE, 'utf8');

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
  return sent;
}

describe('전체 파이프라인 · 레퍼런스 아티팩트', () => {
  it('파싱 → 프리뷰 → 편집 → 저장이 한 줄 diff 로 끝난다', () => {
    const blocks = parseBlocks(source);
    const sent = mountPreview(buildPreviewDocument(source, blocks));

    const target = blocks.find((b) => b.tag === 'h1');
    if (!target) throw new Error('h1 없음');

    const el = document.querySelector<HTMLElement>(`[${MARKER_ATTR}="${target.id}"]`);
    expect(el, '마커가 프리뷰에 살아 있어야 한다').not.toBeNull();

    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    el!.innerHTML = '에이전트 결제 <b>2026</b>';
    document.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

    const edit = sent.find((m): m is Extract<FromPreview, { type: 'edit' }> => m.type === 'edit');
    expect(edit?.id).toBe(target.id);

    const output = applyPatches(source, blocks, [{ id: edit!.id, newInnerHtml: edit!.html }]);
    expect(changedLines(source, output)).toBe(1);
    expect(output).toContain('<h1>에이전트 결제 <b>2026</b></h1>');
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
        // 스크립트를 걷어냈으므로 라이브 = 소스다. 사전 잠금(.code)만 남아야 한다.
        const reasons = new Set(locked.map((b) => b.locked).filter(Boolean));
        expect(reasons).toEqual(new Set(['CODE_BLOCK']));
        resolve();
      }, 0);
    });
  });

  it('아무것도 고치지 않고 저장하면 원본과 바이트 단위로 같다', () => {
    const blocks = parseBlocks(source);
    expect(applyPatches(source, blocks, [])).toBe(source);
  });
});
