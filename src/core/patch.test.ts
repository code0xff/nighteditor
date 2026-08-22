import { describe, expect, it } from 'vitest';
import { parseBlocks } from './parse.js';
import { applyPatches, PatchError } from './patch.js';
import { fixtureSource } from '../__fixtures__/load.js';

const source = fixtureSource();
const blocks = parseBlocks(source);
const editable = blocks.filter((b) => b.locked === null);

/** Count of lines that differ — for the minimal-diff checks */
function changedLines(a: string, b: string): number {
  const la = a.split('\n');
  const lb = b.split('\n');
  let n = 0;
  for (let i = 0; i < Math.max(la.length, lb.length); i++) if (la[i] !== lb[i]) n++;
  return n;
}

describe('applyPatches · no-edit identity (the top golden test)', () => {
  it('zero patches gives a byte-identical result', () => {
    expect(applyPatches(source, blocks, [])).toBe(source);
  });

  it('overwriting every block with its own source is still identical', () => {
    const noop = editable.map((b) => ({ id: b.id, newInnerHtml: b.sourceInner }));
    expect(applyPatches(source, blocks, noop)).toBe(source);
  });

  it('does not mutate source (INV-1)', () => {
    const before = source;
    applyPatches(source, blocks, [{ id: editable[0]!.id, newInnerHtml: 'x' }]);
    expect(source).toBe(before);
  });
});

describe('applyPatches · minimal diff', () => {
  it('editing one block changes only that line', () => {
    const target = blocks.find((b) => b.tag === 'h1');
    if (!target) throw new Error('h1 없음');
    const out = applyPatches(source, blocks, [
      { id: target.id, newInnerHtml: '고친 표지 <b>2026</b>' },
    ]);
    expect(changedLines(source, out)).toBe(1);
    expect(out).toContain('<h1>고친 표지 <b>2026</b></h1>');
  });

  it('inline markup is preserved', () => {
    const target = editable.find((b) => b.sourceInner.includes('<b>'));
    if (!target) throw new Error('인라인 블록 없음');
    const edited = target.sourceInner.replace('<b>', '<b>수정 ');
    const out = applyPatches(source, blocks, [{ id: target.id, newInnerHtml: edited }]);
    expect(out).toContain('<b>수정 ');
    expect(changedLines(source, out)).toBe(1);
  });

  it('editing <title> changes only that line (spec §2.1)', () => {
    const title = blocks.find((b) => b.tag === 'title');
    if (!title) throw new Error('title 없음');
    const out = applyPatches(source, blocks, [
      { id: title.id, newInnerHtml: '합성 아티팩트 2026' },
    ]);
    expect(changedLines(source, out)).toBe(1);
    expect(out).toContain('<title>합성 아티팩트 2026</title>');
  });
});

describe('applyPatches · multi-patch ordering (INV-4 regression)', () => {
  it('produces the same result regardless of input order', () => {
    const picked = editable.slice(0, 12).map((b) => ({
      id: b.id,
      newInnerHtml: `블록${b.id}`,
    }));
    const forward = applyPatches(source, blocks, picked);
    const reversed = applyPatches(source, blocks, [...picked].reverse());
    expect(forward).toBe(reversed);
  });

  it('every edited block lands in its own place', () => {
    const picked = editable.slice(0, 12);
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

  it('the case that breaks an incorrect ascending-order implementation', () => {
    // Deliberately pass the later block first.
    const [a, b] = [editable[5], editable[6]];
    if (!a || !b) throw new Error('블록 부족');
    const out = applyPatches(source, blocks, [
      { id: b.id, newInnerHtml: 'BBB' },
      { id: a.id, newInnerHtml: 'AAA' },
    ]);
    expect(out.indexOf('AAA')).toBeLessThan(out.indexOf('BBB'));
  });
});

describe('applyPatches · rejection rules', () => {
  it('rejects locked blocks (INV-5)', () => {
    const locked = blocks.find((b) => b.locked !== null);
    if (!locked) throw new Error('잠긴 블록 없음');
    expect(() => applyPatches(source, blocks, [{ id: locked.id, newInnerHtml: 'x' }])).toThrow(
      PatchError
    );
  });

  it('rejects unknown ids', () => {
    expect(() => applyPatches(source, blocks, [{ id: 99999, newInnerHtml: 'x' }])).toThrow(
      PatchError
    );
  });

  it('rejects two patches for the same block', () => {
    const id = editable[0]!.id;
    expect(() =>
      applyPatches(source, blocks, [
        { id, newInnerHtml: 'a' },
        { id, newInnerHtml: 'b' },
      ])
    ).toThrow(PatchError);
  });

  it('tags put into RCDATA are escaped to plain text instead of rejected (spec §2.1)', () => {
    const title = blocks.find((b) => b.rcdata);
    if (!title) throw new Error('rcdata 블록 없음');
    const out = applyPatches(source, blocks, [{ id: title.id, newInnerHtml: 'a <b>b</b>' }]);
    expect(out).toContain('<title>a &lt;b&gt;b&lt;/b&gt;</title>');
  });
});

describe('PatchError · language-independent codes', () => {
  it('reports the rejection as code plus params — the language pack makes the sentence (INV-6)', () => {
    const locked = blocks.find((b) => b.locked !== null);
    if (!locked) throw new Error('잠긴 블록 없음');
    try {
      applyPatches(source, blocks, [{ id: locked.id, newInnerHtml: 'x' }]);
      throw new Error('거부되지 않았다');
    } catch (e) {
      expect(e).toBeInstanceOf(PatchError);
      const err = e as PatchError;
      expect(err.code).toBe('locked');
      expect(err.params).toEqual({ id: locked.id, reason: locked.locked });
    }
  });

  it('reports an unknown id with the unknownId code', () => {
    try {
      applyPatches(source, blocks, [{ id: 99999, newInnerHtml: 'x' }]);
      throw new Error('거부되지 않았다');
    } catch (e) {
      expect((e as PatchError).code).toBe('unknownId');
    }
  });
});

describe('applyPatches · review regressions', () => {
  it('treats RCDATA as plain text and writes it entity-encoded (INV-8)', () => {
    const title = blocks.find((b) => b.rcdata);
    if (!title) throw new Error('rcdata 블록 없음');
    const out = applyPatches(source, blocks, [{ id: title.id, newInnerHtml: 'R&D & more < 5' }]);
    expect(out).toContain('<title>R&amp;D &amp; more &lt; 5</title>');
    // Reopened, the string the user typed comes back exactly
    expect(parseBlocks(out).find((b) => b.rcdata)?.sourceText).toBe('R&D & more < 5');
  });

  it('fails instead of silently corrupting when blocks do not match the source', () => {
    const target = editable.find((b) => b.tag === 'h1');
    if (!target) throw new Error('h1 없음');
    const saved = applyPatches(source, blocks, [
      { id: target.id, newInnerHtml: '길어진 제목 텍스트' },
    ]);
    // The mistake of reusing blocks on the new source without refreshing after a save
    expect(() => applyPatches(saved, blocks, [{ id: target.id, newInnerHtml: 'x' }])).toThrow(
      PatchError
    );
  });
});
