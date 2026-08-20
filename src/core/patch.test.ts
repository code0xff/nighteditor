import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseBlocks } from './parse.js';
import { applyPatches, PatchError } from './patch.js';

const REFERENCE = fileURLToPath(new URL('../../agent_payments.html', import.meta.url));
const source = readFileSync(REFERENCE, 'utf8');
const blocks = parseBlocks(source);
const editable = blocks.filter((b) => b.locked === null);

/** 줄 단위로 달라진 개수 — 최소 diff 검증용 */
function changedLines(a: string, b: string): number {
  const la = a.split('\n');
  const lb = b.split('\n');
  let n = 0;
  for (let i = 0; i < Math.max(la.length, lb.length); i++) if (la[i] !== lb[i]) n++;
  return n;
}

describe('applyPatches · 무편집 항등성 (최우선 골든 테스트)', () => {
  it('패치 0개면 원본과 바이트 단위로 동일하다', () => {
    expect(applyPatches(source, blocks, [])).toBe(source);
  });

  it('모든 블록을 자기 원본으로 덮어써도 원본과 동일하다', () => {
    const noop = editable.map((b) => ({ id: b.id, newInnerHtml: b.sourceInner }));
    expect(applyPatches(source, blocks, noop)).toBe(source);
  });

  it('source 를 변형하지 않는다 (INV-1)', () => {
    const before = source;
    applyPatches(source, blocks, [{ id: editable[0]!.id, newInnerHtml: 'x' }]);
    expect(source).toBe(before);
  });
});

describe('applyPatches · 최소 diff', () => {
  it('블록 1개 수정 → 해당 줄만 바뀐다', () => {
    const target = blocks.find((b) => b.tag === 'h1');
    if (!target) throw new Error('h1 없음');
    const out = applyPatches(source, blocks, [
      { id: target.id, newInnerHtml: '에이전트 결제 <b>2026</b>' },
    ]);
    expect(changedLines(source, out)).toBe(1);
    expect(out).toContain('<h1>에이전트 결제 <b>2026</b></h1>');
  });

  it('인라인 마크업이 보존된다', () => {
    const target = editable.find((b) => b.sourceInner.includes('<b>'));
    if (!target) throw new Error('인라인 블록 없음');
    const edited = target.sourceInner.replace('<b>', '<b>수정 ');
    const out = applyPatches(source, blocks, [{ id: target.id, newInnerHtml: edited }]);
    expect(out).toContain('<b>수정 ');
    expect(changedLines(source, out)).toBe(1);
  });

  it('<title> 수정 → 해당 줄만 바뀐다 (spec §2.1)', () => {
    const title = blocks.find((b) => b.tag === 'title');
    if (!title) throw new Error('title 없음');
    const out = applyPatches(source, blocks, [
      { id: title.id, newInnerHtml: 'Agent Payments 세미나 2026' },
    ]);
    expect(changedLines(source, out)).toBe(1);
    expect(out).toContain('<title>Agent Payments 세미나 2026</title>');
  });
});

describe('applyPatches · 다중 패치 순서 (INV-4 회귀)', () => {
  it('입력 순서와 무관하게 같은 결과를 낸다', () => {
    const picked = editable.slice(0, 40).map((b) => ({
      id: b.id,
      newInnerHtml: `블록${b.id}`,
    }));
    const forward = applyPatches(source, blocks, picked);
    const reversed = applyPatches(source, blocks, [...picked].reverse());
    expect(forward).toBe(reversed);
  });

  it('여러 블록을 고쳐도 각 내용이 제자리에 들어간다', () => {
    const picked = editable.slice(0, 40);
    const out = applyPatches(
      source,
      blocks,
      picked.map((b) => ({ id: b.id, newInnerHtml: `블록${b.id}` }))
    );
    const after = parseBlocks(out);
    for (const b of picked) {
      const moved = after.find((x) => x.sourceInner === `블록${b.id}`);
      expect(moved, `블록 ${b.id} 가 사라졌다`).toBeDefined();
    }
  });

  it('오름차순으로 적용하는 잘못된 구현이라면 깨지는 케이스', () => {
    // 뒤쪽 블록이 먼저 오도록 일부러 역순으로 넣는다.
    const [a, b] = [editable[5], editable[6]];
    if (!a || !b) throw new Error('블록 부족');
    const out = applyPatches(source, blocks, [
      { id: b.id, newInnerHtml: 'BBB' },
      { id: a.id, newInnerHtml: 'AAA' },
    ]);
    expect(out.indexOf('AAA')).toBeLessThan(out.indexOf('BBB'));
  });
});

describe('applyPatches · 거부 규칙', () => {
  it('잠긴 블록은 거부한다 (INV-5)', () => {
    const locked = blocks.find((b) => b.locked !== null);
    if (!locked) throw new Error('잠긴 블록 없음');
    expect(() => applyPatches(source, blocks, [{ id: locked.id, newInnerHtml: 'x' }])).toThrow(
      PatchError
    );
  });

  it('알 수 없는 id 를 거부한다', () => {
    expect(() => applyPatches(source, blocks, [{ id: 99999, newInnerHtml: 'x' }])).toThrow(
      PatchError
    );
  });

  it('같은 블록에 패치가 둘이면 거부한다', () => {
    const id = editable[0]!.id;
    expect(() =>
      applyPatches(source, blocks, [
        { id, newInnerHtml: 'a' },
        { id, newInnerHtml: 'b' },
      ])
    ).toThrow(PatchError);
  });

  it('RCDATA 에 넣은 태그는 거부 대신 평문으로 이스케이프된다 (spec §2.1)', () => {
    const title = blocks.find((b) => b.rcdata);
    if (!title) throw new Error('rcdata 블록 없음');
    const out = applyPatches(source, blocks, [{ id: title.id, newInnerHtml: 'a <b>b</b>' }]);
    expect(out).toContain('<title>a &lt;b&gt;b&lt;/b&gt;</title>');
  });
});

describe('applyPatches · 리뷰 회귀', () => {
  it('RCDATA 는 평문으로 보고 엔티티화해 기록한다 (INV-8)', () => {
    const title = blocks.find((b) => b.rcdata);
    if (!title) throw new Error('rcdata 블록 없음');
    const out = applyPatches(source, blocks, [{ id: title.id, newInnerHtml: 'R&D & more < 5' }]);
    expect(out).toContain('<title>R&amp;D &amp; more &lt; 5</title>');
    // 다시 열었을 때 사용자가 친 문자열 그대로 복원된다
    expect(parseBlocks(out).find((b) => b.rcdata)?.sourceText).toBe('R&D & more < 5');
  });

  it('원본과 맞지 않는 blocks 를 쓰면 조용히 망가뜨리지 않고 실패한다', () => {
    const target = editable.find((b) => b.tag === 'h1');
    if (!target) throw new Error('h1 없음');
    const saved = applyPatches(source, blocks, [
      { id: target.id, newInnerHtml: '길어진 제목 텍스트' },
    ]);
    // 저장 후 갱신하지 않은 blocks 를 새 원본에 재사용하는 실수
    expect(() => applyPatches(saved, blocks, [{ id: target.id, newInnerHtml: 'x' }])).toThrow(
      PatchError
    );
  });
});
