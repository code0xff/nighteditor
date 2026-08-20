import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseBlocks } from './parse.js';
import { injectAgentScript, injectMarkers, MARKER_ATTR, MarkerError } from './markers.js';

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

describe('injectAgentScript (ADR-007)', () => {
  const agent = 'function agent(){ console.log("hi") }';

  it('에이전트가 아티팩트 스크립트보다 앞에 온다', () => {
    const out = injectAgentScript(source, agent);
    // 주입 위치가 곧 정확성 조건이다. 뒤에 오면 리스너 등록 순서가 뒤집혀
    // 아티팩트의 전역 핸들러를 막지 못한다.
    expect(out.indexOf('function agent()')).toBeLessThan(out.indexOf('addEventListener'));
  });

  it('<head> 바로 뒤에 넣는다', () => {
    const out = injectAgentScript(
      '<html><head><title>t</title></head><body>b</body></html>',
      agent
    );
    expect(out).toContain('<head><script>(function agent()');
  });

  it('head 가 없으면 <html> 뒤에 넣는다', () => {
    const out = injectAgentScript('<html><body>b</body></html>', agent);
    expect(out.indexOf('<script>')).toBeLessThan(out.indexOf('<body>'));
  });

  it('에이전트 안의 </script> 가 인라인 스크립트를 끊지 않는다', () => {
    const out = injectAgentScript(
      '<html><head></head></html>',
      'function a(){ var s = "</script>" }'
    );
    expect(out).toContain('<\\/script>');
    expect(out.match(/<\/script>/g)).toHaveLength(1);
  });

  it('마커 주입과 함께 써도 원본 offset 은 그대로다 (INV-3)', () => {
    const preview = injectAgentScript(injectMarkers(source, blocks), agent);
    expect(preview).toContain(`${MARKER_ATTR}="0"`);
    for (const b of blocks) {
      expect(source.slice(b.innerStart, b.innerEnd)).toBe(b.sourceInner);
    }
  });
});
