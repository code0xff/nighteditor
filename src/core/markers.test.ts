import { describe, expect, it } from 'vitest';
import { parseBlocks } from './parse.js';
import {
  injectAgentScript,
  injectEditorStyle,
  injectMarkers,
  LOCKED_ATTR,
  MARKER_ATTR,
  MarkerError,
} from './markers.js';
import { fixtureSource } from '../__fixtures__/load.js';

const source = fixtureSource();
const blocks = parseBlocks(source);

describe('injectMarkers', () => {
  const injected = injectMarkers(source, blocks);

  it('모든 블록에 마커를 붙인다', () => {
    const found = injected.match(new RegExp(`${MARKER_ATTR}="\\d+"`, 'g'));
    expect(found).toHaveLength(blocks.length);
  });

  it('원본을 변형하지 않는다 (INV-1)', () => {
    expect(source).toBe(fixtureSource());
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

describe('injectEditorStyle', () => {
  const styled = injectEditorStyle(source);

  it('<head> 맨 앞에 한 덩어리만 넣는다 — 픽스처에도 <style> 이 있다', () => {
    const head = /<head[^>]*>/i.exec(source);
    expect(styled.indexOf('<style>')).toBe((head?.index ?? 0) + (head?.[0].length ?? 0));
    // 주입한 규칙은 딱 한 벌이어야 한다.
    expect(styled.match(new RegExp(`\\[${MARKER_ATTR}\\]:not`, 'g'))).toHaveLength(2);
  });

  it('마커와 잠금 표식을 선택자로 쓴다 — 이름이 어긋나면 표시가 안 된다', () => {
    const style = /<style>(.*?)<\/style>/s.exec(styled)?.[1] ?? '';
    expect(style).toContain(`[${MARKER_ATTR}]`);
    expect(style).toContain(`[${LOCKED_ATTR}]`);
  });

  it('잠긴 블록은 편집 가능 표시에서 빠진다', () => {
    const style = /<style>(.*?)<\/style>/s.exec(styled)?.[1] ?? '';
    expect(style).toContain(`[${MARKER_ATTR}]:not([${LOCKED_ATTR}]):hover`);
  });

  it('레이아웃을 흔드는 속성을 쓰지 않는다 — 문서가 밀리면 안 된다', () => {
    const style = /<style>(.*?)<\/style>/s.exec(styled)?.[1] ?? '';
    for (const forbidden of ['border', 'margin', 'padding', 'font', 'display', 'position']) {
      expect(style, forbidden).not.toContain(forbidden);
    }
  });

  it('head 가 없으면 문서 앞에 붙인다', () => {
    expect(injectEditorStyle('<p>본문</p>').startsWith('<style>')).toBe(true);
  });

  it('표시가 읽는 변수 정의도 아티팩트 CSS 에 지지 않는다', () => {
    // 이 스타일은 아티팩트 CSS 보다 먼저 주입된다. 변수 정의가 !important 가 아니면
    // [data-ne-id]{--ne-soft:transparent} 한 줄로 호버·편집·짚기 외곽선이 통째로
    // 사라진다 — !important 로 지킨 outline 이 그 변수의 값을 읽기 때문이다.
    const style = /<style>(.*?)<\/style>/s.exec(styled)?.[1] ?? '';
    for (const name of ['--ne-mark', '--ne-soft', '--ne-tint']) {
      const declarations = style.match(new RegExp(`${name}:[^;}]*`, 'g')) ?? [];
      // 밝은 바탕용·어두운 바탕용 두 벌 모두다.
      expect(declarations.length).toBeGreaterThanOrEqual(2);
      for (const declaration of declarations) expect(declaration).toContain('!important');
    }
  });

  it('원본 문자열의 블록 offset 을 건드리지 않는다 (INV-3)', () => {
    // 주입은 프리뷰 전용이다. 저장 경로는 언제나 원본에서 출발한다.
    const after = parseBlocks(injectEditorStyle(injectMarkers(source, blocks)));
    expect(after.map((b) => b.sourceText)).toEqual(blocks.map((b) => b.sourceText));
    expect(source).toBe(fixtureSource());
  });
});
