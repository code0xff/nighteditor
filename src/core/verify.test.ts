import { describe, expect, it } from 'vitest';
import { parseBlocks } from './parse.js';
import { applyLiveLocks } from './verify.js';

const live = (entries: [number, string][]) => new Map(entries);

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

  it('입력 배열을 변형하지 않는다', () => {
    const blocks = parseBlocks('<p>x</p>');
    applyLiveLocks(blocks, live([]));
    expect(blocks[0]?.locked).toBeNull();
  });
});
