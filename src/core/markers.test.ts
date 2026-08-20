import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseBlocks } from './parse.js';
import { injectMarkers, MARKER_ATTR, MarkerError } from './markers.js';

const REFERENCE = fileURLToPath(new URL('../../agent_payments.html', import.meta.url));
const source = readFileSync(REFERENCE, 'utf8');
const blocks = parseBlocks(source);

describe('injectMarkers', () => {
  const injected = injectMarkers(source, blocks);

  it('모든 블록에 마커를 붙인다', () => {
    const found = injected.match(new RegExp(`${MARKER_ATTR}="\\d+"`, 'g'));
    expect(found).toHaveLength(blocks.length);
  });

  it('원본을 변형하지 않는다 (INV-1)', () => {
    expect(source).toBe(readFileSync(REFERENCE, 'utf8'));
  });

  it('마커를 넣어도 블록 구조와 텍스트가 그대로다', () => {
    const after = parseBlocks(injected);
    expect(after).toHaveLength(blocks.length);
    expect(after.map((b) => b.sourceText)).toEqual(blocks.map((b) => b.sourceText));
    expect(after.map((b) => b.tag)).toEqual(blocks.map((b) => b.tag));
  });

  it('마커 id 가 블록 id 와 일치한다', () => {
    for (const b of blocks) {
      expect(injected).toContain(`${MARKER_ATTR}="${b.id}"`);
    }
  });

  it('잠긴 블록에도 붙인다 — UI 가 잠금 이유를 보여줘야 한다', () => {
    const locked = blocks.filter((b) => b.locked !== null);
    expect(locked.length).toBeGreaterThan(0);
    for (const b of locked) expect(injected).toContain(`${MARKER_ATTR}="${b.id}"`);
  });

  it('여는 태그 끝을 찾지 못하면 조용히 넘어가지 않고 실패한다', () => {
    const bogus = [{ ...blocks[0]!, innerStart: 0 }];
    expect(() => injectMarkers(source, bogus)).toThrow(MarkerError);
  });

  it('마커는 프리뷰 전용이라 저장 경로의 offset 에 영향을 주지 않는다 (INV-3)', () => {
    // 주입본은 길어지지만, 원본 기준 offset 은 그대로 유효하다.
    expect(injected.length).toBeGreaterThan(source.length);
    for (const b of blocks) {
      expect(source.slice(b.innerStart, b.innerEnd)).toBe(b.sourceInner);
    }
  });
});
