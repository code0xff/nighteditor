import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseBlocks } from './parse.js';
import { decode, encode, normalizeText } from './entities.js';

const REFERENCE = fileURLToPath(new URL('../../agent_payments.html', import.meta.url));
const source = readFileSync(REFERENCE, 'utf8');
const blocks = parseBlocks(source);

describe('parseBlocks · 레퍼런스 아티팩트 회귀', () => {
  it('블록 867개를 인식한다 (docs/spec.md §6)', () => {
    expect(blocks).toHaveLength(867);
  });

  it('태그별 분포가 사양과 일치한다', () => {
    const counts: Record<string, number> = {};
    for (const b of blocks) counts[b.tag] = (counts[b.tag] ?? 0) + 1;
    expect(counts).toEqual({
      div: 256,
      td: 241,
      p: 103,
      li: 72,
      span: 70,
      h2: 43,
      th: 42,
      h3: 36,
      button: 2,
      title: 1,
      h1: 1,
    });
  });

  it('모든 블록의 offset 이 원본과 정확히 일치한다 (INV-3)', () => {
    for (const b of blocks) {
      expect(source.slice(b.innerStart, b.innerEnd)).toBe(b.sourceInner);
    }
  });

  it('블록 범위가 서로 겹치지 않는다', () => {
    const sorted = [...blocks].sort((a, b) => a.innerStart - b.innerStart);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (!prev || !cur) throw new Error('unreachable');
      expect(cur.innerStart).toBeGreaterThanOrEqual(prev.innerEnd);
    }
  });
});

describe('parseBlocks · 잠금과 특례', () => {
  it('<title> 을 블록으로 인식하고 rcdata 로 표시한다 (spec §2.1)', () => {
    const title = blocks.find((b) => b.tag === 'title');
    expect(title?.sourceText).toBe('Agent Payments 세미나');
    expect(title?.rcdata).toBe(true);
    expect(title?.locked).toBeNull();
  });

  it('.code 블록 9개를 CODE_BLOCK 으로 잠근다 (spec §3)', () => {
    const locked = blocks.filter((b) => b.locked === 'CODE_BLOCK');
    expect(locked).toHaveLength(9);
  });

  it('소스에서 비어 있는 .pg span 40개는 블록이 되지 않는다', () => {
    expect(source.match(/class="pg"/g)).toHaveLength(40);
    for (const b of blocks) expect(b.sourceText).not.toBe('');
  });

  it('script / style 내부는 블록이 되지 않는다', () => {
    for (const b of blocks) {
      expect(b.sourceInner).not.toContain('addEventListener');
      expect(b.sourceInner).not.toContain('box-sizing');
    }
  });

  it('합성 <tbody> 13개에서 순회가 죽지 않는다 (INV-7)', () => {
    // 테이블 13개가 있고, 그 안의 td/th 가 전부 블록으로 잡혔다면
    // 위치 정보 없는 tbody 를 통과해 내려갔다는 뜻이다.
    expect(source.match(/<table/g)).toHaveLength(13);
    expect(blocks.filter((b) => b.tag === 'td' || b.tag === 'th').length).toBe(283);
  });
});

describe('엔티티 (INV-8)', () => {
  it('sourceText 는 디코딩된 값이라 라이브 텍스트와 비교할 수 있다', () => {
    const withEntity = blocks.find((b) => b.sourceInner.includes('&amp;'));
    expect(withEntity).toBeDefined();
    expect(withEntity?.sourceInner).toContain('&amp;');
    expect(withEntity?.sourceText).toContain(' & ');
    expect(withEntity?.sourceText).not.toContain('&amp;');
  });

  it('원시 슬라이스로 비교하면 오탐이 난다 — 디코딩이 필요한 이유', () => {
    const withEntity = blocks.find((b) => b.sourceInner.includes('&amp;'));
    if (!withEntity) throw new Error('엔티티 블록 없음');
    const liveText = withEntity.sourceText;
    expect(normalizeText(withEntity.sourceInner)).not.toBe(liveText);
    expect(normalizeText(decode(withEntity.sourceInner))).toBe(liveText);
  });

  it('encode 는 & < > 를 엔티티화한다', () => {
    expect(encode('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
    expect(decode(encode('a & b'))).toBe('a & b');
  });
});

describe('parseBlocks · 리뷰 회귀 (합성 입력)', () => {
  const only = (html: string) => parseBlocks(html);

  it('parse5 가 이미 디코딩하므로 두 번 디코딩하지 않는다', () => {
    // 이중 디코딩하면 '& and <b>' 가 되어 라이브 textContent 와 어긋나고,
    // ADR-005 대조에서 멀쩡한 블록이 오탐 잠금된다.
    const [block] = only('<p>&amp;amp; and &amp;lt;b&amp;gt;</p>');
    expect(block?.sourceText).toBe('&amp; and &lt;b&gt;');
  });

  it('CODE_BLOCK 잠금이 자손까지 상속된다', () => {
    const blocks = only('<div class="code"><div>let x = 1;</div><div>y</div></div>');
    expect(blocks).toHaveLength(2);
    for (const b of blocks) expect(b.locked).toBe('CODE_BLOCK');
  });

  it('닫는 태그가 생략되면 버리지 않고 AMBIGUOUS 로 잠근다', () => {
    const blocks = only('<ul><li>one<li>two</ul>');
    expect(blocks).toHaveLength(2);
    for (const b of blocks) expect(b.locked).toBe('AMBIGUOUS');
    expect(blocks.map((b) => b.sourceText)).toEqual(['one', 'two']);
  });

  it('부모에 직접 텍스트가 있으면 인라인을 블록으로 승격하지 않는다', () => {
    const blocks = only('<div>직접 텍스트 <a href="#">링크</a><p>단락</p></div>');
    expect(blocks.map((b) => b.tag)).toEqual(['p']);
  });

  it('부모에 직접 텍스트가 없으면 인라인 라벨을 승격한다', () => {
    // 레퍼런스 파일의 .codelabel 구조. 승격하지 않으면 편집 불가가 된다.
    const blocks = only('<div><span class="codelabel">제목</span><ul><li>항목</li></ul></div>');
    expect(blocks.map((b) => b.tag)).toEqual(['span', 'li']);
  });

  it('textarea 내부는 블록이 되지 않는다 (RAW_TEXT)', () => {
    expect(only('<textarea>hello</textarea>')).toHaveLength(0);
  });
});
