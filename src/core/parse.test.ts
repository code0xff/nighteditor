import { describe, expect, it } from 'vitest';
import { parseBlocks } from './parse.js';
import { applyPatches } from './patch.js';
import { decode, encode, normalizeText } from './entities.js';
import { fixtureSource } from '../__fixtures__/load.js';

const source = fixtureSource();
const blocks = parseBlocks(source);

describe('parseBlocks · fixture regression', () => {
  it('recognizes 27 blocks (docs/spec.md §6)', () => {
    expect(blocks).toHaveLength(27);
  });

  it('the per-tag distribution matches the spec', () => {
    const counts: Record<string, number> = {};
    for (const b of blocks) counts[b.tag] = (counts[b.tag] ?? 0) + 1;
    expect(counts).toEqual({
      div: 8,
      td: 4,
      p: 3,
      h2: 3,
      li: 2,
      span: 2,
      th: 2,
      h1: 1,
      h3: 1,
      title: 1,
    });
  });

  it('every block offset matches the source exactly (INV-3)', () => {
    for (const b of blocks) {
      expect(source.slice(b.innerStart, b.innerEnd)).toBe(b.sourceInner);
    }
  });

  it('block ranges do not overlap', () => {
    const sorted = [...blocks].sort((a, b) => a.innerStart - b.innerStart);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (!prev || !cur) throw new Error('unreachable');
      expect(cur.innerStart).toBeGreaterThanOrEqual(prev.innerEnd);
    }
  });
});

describe('parseBlocks · locks and special cases', () => {
  it('recognizes <title> as a block and marks it rcdata (spec §2.1)', () => {
    const title = blocks.find((b) => b.tag === 'title');
    expect(title?.sourceText).toBe('합성 아티팩트');
    expect(title?.rcdata).toBe(true);
    expect(title?.locked).toBeNull();
  });

  it('locks .code blocks as CODE_BLOCK and inherits down to descendants (spec §3)', () => {
    const locked = blocks.filter((b) => b.locked === 'CODE_BLOCK');
    expect(locked).toHaveLength(2);
    // One is .code itself, the other a div nested inside it.
    expect(locked.some((b) => b.sourceInner.includes('중첩된 요소'))).toBe(true);
  });

  it('captures the source-empty #cnt as a locked block (spec §3)', () => {
    // When a script fills it, characters show on screen. Without capturing it as a
    // block, clicks do nothing and there is no way to learn why it cannot be edited.
    expect(source).toContain('<div id="cnt"></div>');
    const cnt = blocks.filter((b) => b.locked === 'EMPTY_IN_SOURCE');

    expect(cnt).toHaveLength(1);
    expect(cnt[0]?.tag).toBe('div');
    expect(cnt[0]?.sourceText).toBe('');
  });

  it('does not lock an empty <title> — a new title must be possible (spec §2.1)', () => {
    // The empty-leaf lock exists because preview click editing cannot trace on-screen
    // characters back to the source. The title field takes its value from the source,
    // so that concern does not apply; locking here leaves a document with an empty
    // title no way to get one. A script-filled title is locked by the comparison.
    const list = parseBlocks(
      '<!doctype html><html><head><title></title></head><body><p>본문</p></body></html>'
    );
    const title = list.find((b) => b.tag === 'title');

    expect(title?.rcdata).toBe(true);
    expect(title?.locked).toBeNull();
  });

  it('.pg does not become a block because its parent has direct text', () => {
    // An inline is part of its parent's sentence, so we do not descend (spec §2).
    // A marker attached here would mix into the parent block's innerHTML and follow
    // it into the save. Instead the parent .foot gets locked by the comparison,
    // which states the reason on its behalf.
    expect(source.match(/class="pg"/g)).toHaveLength(4);
    expect(blocks.some((b) => b.sourceInner === '' && b.tag === 'span')).toBe(false);
  });

  it('void elements do not become blocks — no content can go inside', () => {
    const empty = parseBlocks('<p>글</p><br><img src="a.png"><hr>');

    expect(empty.map((b) => b.tag)).toEqual(['p']);
  });

  it('an element holding only a comment is not empty', () => {
    // Erasing it destroys something the user wrote.
    expect(parseBlocks('<div><!-- 여기 --></div>')).toHaveLength(0);
  });

  it('an empty container with element children is not a block; descend into it', () => {
    const nested = parseBlocks('<div class="wrap"><div class="pg"></div></div>');

    // Capturing the container as a block would hide everything inside.
    expect(nested).toHaveLength(1);
    expect(nested[0]?.locked).toBe('EMPTY_IN_SOURCE');
    expect(nested[0]?.innerStart).toBe('<div class="wrap"><div class="pg">'.length);
  });

  it('an empty element inside .code is still locked as a code area', () => {
    const inCode = parseBlocks('<div class="code"><span></span></div>');

    expect(inCode[0]?.locked).toBe('CODE_BLOCK');
  });

  it('the insides of script / style do not become blocks', () => {
    for (const b of blocks) {
      expect(b.sourceInner).not.toContain('addEventListener');
      expect(b.sourceInner).not.toContain('font-family');
    }
  });

  it('passes through the synthesized <tbody> to find td/th (INV-7)', () => {
    // parse5 inserts a tbody absent from the source. That node has no location info.
    // If every td/th was captured, the traversal passed through and descended.
    expect(source.match(/<table/g)).toHaveLength(1);
    expect(source).not.toContain('<tbody');
    expect(blocks.filter((b) => b.tag === 'td' || b.tag === 'th')).toHaveLength(6);
  });
});

describe('entities (INV-8)', () => {
  it('sourceText is decoded, so it can be compared with live text', () => {
    const withEntity = blocks.find((b) => b.sourceInner.includes('&amp;'));
    expect(withEntity).toBeDefined();
    expect(withEntity?.sourceInner).toContain('&amp;');
    expect(withEntity?.sourceText).toContain(' & ');
    expect(withEntity?.sourceText).not.toContain('&amp;');
  });

  it('comparing raw slices produces false positives — why decoding is needed', () => {
    const withEntity = blocks.find((b) => b.sourceInner.includes('&amp;'));
    if (!withEntity) throw new Error('엔티티 블록 없음');
    const liveText = withEntity.sourceText;
    expect(normalizeText(withEntity.sourceInner)).not.toBe(liveText);
    expect(normalizeText(decode(withEntity.sourceInner))).toBe(liveText);
  });

  it('encode turns & < > into entities', () => {
    expect(encode('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
    expect(decode(encode('a & b'))).toBe('a & b');
  });
});

describe('parseBlocks · review regressions (synthetic input)', () => {
  const only = (html: string) => parseBlocks(html);

  it('parse5 already decodes, so do not decode twice', () => {
    // Double-decoding would produce '& and <b>', diverging from the live
    // textContent, and the ADR-005 comparison would false-positive-lock a healthy block.
    const [block] = only('<p>&amp;amp; and &amp;lt;b&amp;gt;</p>');
    expect(block?.sourceText).toBe('&amp; and &lt;b&gt;');
  });

  it('the CODE_BLOCK lock inherits down to descendants', () => {
    const blocks = only('<div class="code"><div>let x = 1;</div><div>y</div></div>');
    expect(blocks).toHaveLength(2);
    for (const b of blocks) expect(b.locked).toBe('CODE_BLOCK');
  });

  it('locks as AMBIGUOUS instead of dropping when the closing tag is omitted', () => {
    const blocks = only('<ul><li>one<li>two</ul>');
    expect(blocks).toHaveLength(2);
    for (const b of blocks) expect(b.locked).toBe('AMBIGUOUS');
    expect(blocks.map((b) => b.sourceText)).toEqual(['one', 'two']);
  });

  it('does not promote an inline to a block when the parent has direct text', () => {
    const blocks = only('<div>직접 텍스트 <a href="#">링크</a><p>단락</p></div>');
    expect(blocks.map((b) => b.tag)).toEqual(['p']);
  });

  it('promotes an inline label when the parent has no direct text', () => {
    // The .codelabel structure from the measured artifact. Without promotion it
    // becomes uneditable.
    const blocks = only('<div><span class="codelabel">제목</span><ul><li>항목</li></ul></div>');
    expect(blocks.map((b) => b.tag)).toEqual(['span', 'li']);
  });

  it('the inside of textarea does not become a block (RAW_TEXT)', () => {
    expect(only('<textarea>hello</textarea>')).toHaveLength(0);
  });
});

describe('parseBlocks · the source byte for byte (Principle 1 · spec §1 document encoding)', () => {
  it('offsets still point into the source string when it starts with a BOM', () => {
    // If the parser swallowed the BOM, offsets would shift by one and every patch
    // would land one character off.
    const src = '\ufeff<html><head><title>t</title></head><body><p>본문</p></body></html>';
    const blocks = parseBlocks(src);
    for (const b of blocks) {
      expect(src.slice(b.innerStart, b.innerEnd)).toBe(b.sourceInner);
    }

    const p = blocks.find((b) => b.tag === 'p');
    const out = applyPatches(src, blocks, [{ id: p?.id ?? -1, newInnerHtml: '고침' }]);
    expect(out).toBe('\ufeff<html><head><title>t</title></head><body><p>고침</p></body></html>');
  });

  it('CRLF line endings outside the edited block stay byte for byte (Principle 2)', () => {
    const src = '<html><body>\r\n<p>줄1</p>\r\n<p>줄2</p>\r\n</body></html>';
    const blocks = parseBlocks(src);
    const p = blocks.find((b) => b.sourceInner === '줄1');
    const out = applyPatches(src, blocks, [{ id: p?.id ?? -1, newInnerHtml: '고침' }]);
    expect(out).toBe('<html><body>\r\n<p>고침</p>\r\n<p>줄2</p>\r\n</body></html>');
  });
});
