import { describe, expect, it } from 'vitest';
import { parseBlocks } from './parse.js';
import { applyPatches } from './patch.js';
import { decode, encode, normalizeText } from './entities.js';
import { fixtureSource } from '../__fixtures__/load.js';

const source = fixtureSource();
const blocks = parseBlocks(source);

describe('parseBlocks · 픽스처 회귀', () => {
  it('블록 27개를 인식한다 (docs/spec.md §6)', () => {
    expect(blocks).toHaveLength(27);
  });

  it('태그별 분포가 사양과 일치한다', () => {
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
    expect(title?.sourceText).toBe('합성 아티팩트');
    expect(title?.rcdata).toBe(true);
    expect(title?.locked).toBeNull();
  });

  it('.code 블록을 CODE_BLOCK 으로 잠그고 자손까지 상속한다 (spec §3)', () => {
    const locked = blocks.filter((b) => b.locked === 'CODE_BLOCK');
    expect(locked).toHaveLength(2);
    // 하나는 .code 자신, 하나는 그 안에 중첩된 div 다.
    expect(locked.some((b) => b.sourceInner.includes('중첩된 요소'))).toBe(true);
  });

  it('소스에서 비어 있는 #cnt 를 잠긴 블록으로 잡는다 (spec §3)', () => {
    // 스크립트가 채우면 화면에는 글자가 보인다. 블록으로 잡지 않으면 눌러도 아무 일이 없어
    // 왜 못 고치는지 알 길이 없다.
    expect(source).toContain('<div id="cnt"></div>');
    const cnt = blocks.filter((b) => b.locked === 'EMPTY_IN_SOURCE');

    expect(cnt).toHaveLength(1);
    expect(cnt[0]?.tag).toBe('div');
    expect(cnt[0]?.sourceText).toBe('');
  });

  it('빈 <title> 은 잠그지 않는다 — 제목을 새로 지을 수 있어야 한다 (spec §2.1)', () => {
    // 빈 잎 요소 잠금은 "화면의 글자를 소스로 되짚을 수 없다" 는 프리뷰 클릭 편집의
    // 사정이다. 제목 칸은 소스에서 값을 얻으므로 그 사정이 없고, 여기서 잠그면
    // 제목이 빈 문서는 제목을 지을 길이 없다. 스크립트가 채운 제목은 대조가 잠근다.
    const list = parseBlocks(
      '<!doctype html><html><head><title></title></head><body><p>본문</p></body></html>'
    );
    const title = list.find((b) => b.tag === 'title');

    expect(title?.rcdata).toBe(true);
    expect(title?.locked).toBeNull();
  });

  it('.pg 는 부모가 직접 텍스트를 가져 블록이 되지 않는다', () => {
    // 인라인은 부모 문장의 일부라 내려가지 않는다 (spec §2). 여기서 마커를 붙이면
    // 부모 블록의 innerHTML 에 섞여 저장본까지 따라간다.
    // 대신 부모 .foot 이 대조에서 잠겨 이유를 대신 말한다.
    expect(source.match(/class="pg"/g)).toHaveLength(4);
    expect(blocks.some((b) => b.sourceInner === '' && b.tag === 'span')).toBe(false);
  });

  it('void 요소는 블록이 되지 않는다 — 안에 내용이 올 수 없다', () => {
    const empty = parseBlocks('<p>글</p><br><img src="a.png"><hr>');

    expect(empty.map((b) => b.tag)).toEqual(['p']);
  });

  it('주석만 든 요소는 비어 있지 않다', () => {
    // 지우면 사용자가 쓴 것이 사라진다.
    expect(parseBlocks('<div><!-- 여기 --></div>')).toHaveLength(0);
  });

  it('자식 요소가 있는 빈 컨테이너는 블록이 아니라 안으로 내려간다', () => {
    const nested = parseBlocks('<div class="wrap"><div class="pg"></div></div>');

    // 컨테이너까지 블록으로 잡으면 안쪽이 통째로 가려진다.
    expect(nested).toHaveLength(1);
    expect(nested[0]?.locked).toBe('EMPTY_IN_SOURCE');
    expect(nested[0]?.innerStart).toBe('<div class="wrap"><div class="pg">'.length);
  });

  it('빈 요소도 .code 안에서는 코드 영역으로 잠긴다', () => {
    const inCode = parseBlocks('<div class="code"><span></span></div>');

    expect(inCode[0]?.locked).toBe('CODE_BLOCK');
  });

  it('script / style 내부는 블록이 되지 않는다', () => {
    for (const b of blocks) {
      expect(b.sourceInner).not.toContain('addEventListener');
      expect(b.sourceInner).not.toContain('font-family');
    }
  });

  it('합성 <tbody> 를 통과해 td/th 를 찾는다 (INV-7)', () => {
    // parse5 는 소스에 없는 tbody 를 끼워 넣는다. 그 노드에는 위치 정보가 없다.
    // td/th 가 전부 잡혔다면 통과해 내려갔다는 뜻이다.
    expect(source.match(/<table/g)).toHaveLength(1);
    expect(source).not.toContain('<tbody');
    expect(blocks.filter((b) => b.tag === 'td' || b.tag === 'th')).toHaveLength(6);
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
    // 실측 아티팩트의 .codelabel 구조. 승격하지 않으면 편집 불가가 된다.
    const blocks = only('<div><span class="codelabel">제목</span><ul><li>항목</li></ul></div>');
    expect(blocks.map((b) => b.tag)).toEqual(['span', 'li']);
  });

  it('textarea 내부는 블록이 되지 않는다 (RAW_TEXT)', () => {
    expect(only('<textarea>hello</textarea>')).toHaveLength(0);
  });
});

describe('parseBlocks · 바이트 그대로의 원본 (대원칙 1 · spec §1 문서 인코딩)', () => {
  it('BOM 으로 시작해도 offset 은 원본 문자열 그대로를 가리킨다', () => {
    // 파서가 BOM 을 삼켜 offset 이 한 칸씩 밀리면 모든 패치가 한 글자씩 어긋난다.
    const src = '\ufeff<html><head><title>t</title></head><body><p>본문</p></body></html>';
    const blocks = parseBlocks(src);
    for (const b of blocks) {
      expect(src.slice(b.innerStart, b.innerEnd)).toBe(b.sourceInner);
    }

    const p = blocks.find((b) => b.tag === 'p');
    const out = applyPatches(src, blocks, [{ id: p?.id ?? -1, newInnerHtml: '고침' }]);
    expect(out).toBe('\ufeff<html><head><title>t</title></head><body><p>고침</p></body></html>');
  });

  it('CRLF 줄바꿈은 고친 블록 밖에서 바이트 그대로 남는다 (대원칙 2)', () => {
    const src = '<html><body>\r\n<p>줄1</p>\r\n<p>줄2</p>\r\n</body></html>';
    const blocks = parseBlocks(src);
    const p = blocks.find((b) => b.sourceInner === '줄1');
    const out = applyPatches(src, blocks, [{ id: p?.id ?? -1, newInnerHtml: '고침' }]);
    expect(out).toBe('<html><body>\r\n<p>고침</p>\r\n<p>줄2</p>\r\n</body></html>');
  });
});
