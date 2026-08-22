import { describe, expect, it } from 'vitest';
import { parseBlocks } from './parse.js';
import { applyLiveLocks } from './verify.js';

const live = (entries: [number, string][]) => entries.map(([id, text]) => ({ id, text }));

describe('applyLiveLocks (ADR-005)', () => {
  it('소스와 라이브가 같으면 잠그지 않는다', () => {
    const blocks = parseBlocks('<p>안녕</p>');
    const [b] = applyLiveLocks(blocks, live([[0, '안녕']]));
    expect(b?.locked).toBeNull();
  });

  it('공백 차이는 같은 것으로 본다', () => {
    const blocks = parseBlocks('<p>\n  안녕   세상\n</p>');
    const [b] = applyLiveLocks(blocks, live([[0, '안녕 세상']]));
    expect(b?.locked).toBeNull();
  });

  it('라이브가 다르면 SCRIPT_GENERATED 로 잠근다', () => {
    const blocks = parseBlocks('<span id="cnt">0 / 0</span>');
    const [b] = applyLiveLocks(blocks, live([[0, '3 / 45']]));
    expect(b?.locked).toBe('SCRIPT_GENERATED');
  });

  it('라이브에 없으면 잠근다 — 스크립트가 노드를 들어낸 경우', () => {
    const blocks = parseBlocks('<p>사라짐</p>');
    const [b] = applyLiveLocks(blocks, live([]));
    expect(b?.locked).toBe('SCRIPT_GENERATED');
  });

  it('이미 잠긴 블록의 사유를 덮어쓰지 않는다', () => {
    const blocks = parseBlocks('<div class="code">let x = 1;</div>');
    expect(blocks[0]?.locked).toBe('CODE_BLOCK');
    const [b] = applyLiveLocks(blocks, live([[0, '전혀 다른 텍스트']]));
    expect(b?.locked).toBe('CODE_BLOCK');
  });

  it('엔티티 블록을 오탐으로 잠그지 않는다 (INV-8)', () => {
    // 브라우저 textContent 는 &amp;amp; 를 '&amp;' 로 준다.
    // 파싱 때 이중 디코딩했다면 '&' 가 되어 여기서 오탐 잠금이 난다.
    const blocks = parseBlocks('<p>Protocols &amp;amp; Standards</p>');
    const [b] = applyLiveLocks(blocks, live([[0, 'Protocols &amp; Standards']]));
    expect(b?.locked).toBeNull();
  });

  it('같은 id 의 표식이 둘이면 MARKER_CLASH 로 잠근다 — 문서가 마커를 흉내 냈다 (spec §3)', () => {
    // 어느 쪽이 원본 블록인지 렌더만으로는 가릴 수 없다. 추측으로 고치면 가짜의
    // 내용이 이 블록의 편집으로 저장에 실린다.
    const blocks = parseBlocks('<p>안녕</p>');
    const [b] = applyLiveLocks(
      blocks,
      live([
        [0, '안녕'],
        [0, '안녕'],
      ])
    );
    expect(b?.locked).toBe('MARKER_CLASH');
  });

  it('흉내의 텍스트가 소스와 달라도 사유는 MARKER_CLASH 다 — 겹침이 먼저다', () => {
    // SCRIPT_GENERATED 로 잠겨도 안전하긴 하다. 하지만 사용자에게 보일 이유는
    // "스크립트가 만든 글자" 가 아니라 "표식이 겹쳐 되짚을 수 없다" 쪽이 사실이다.
    const blocks = parseBlocks('<p>안녕</p>');
    const [b] = applyLiveLocks(
      blocks,
      live([
        [0, '안녕'],
        [0, '전혀 다른 텍스트'],
      ])
    );
    expect(b?.locked).toBe('MARKER_CLASH');
  });

  it('입력 배열을 변형하지 않는다', () => {
    const blocks = parseBlocks('<p>x</p>');
    applyLiveLocks(blocks, live([]));
    expect(blocks[0]?.locked).toBeNull();
  });
});
