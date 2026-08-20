import { describe, expect, it } from 'vitest';
import { documentCandidates, pickDocument } from './bundle.js';

describe('pickDocument', () => {
  it('묶음 겉면에 있는 문서를 고른다', () => {
    // 깊이 묻힌 문서는 대개 부품이다. 겉면에 있는 것이 그 묶음의 얼굴이다.
    expect(pickDocument(['deck/parts/a.html', 'deck.html'])).toBe('deck.html');
  });

  it('같은 깊이면 index 를 먼저 본다', () => {
    expect(pickDocument(['deck/zzz.html', 'deck/index.html'])).toBe('deck/index.html');
  });

  it('HTML 이 아닌 파일은 후보가 아니다', () => {
    expect(pickDocument(['deck/style.css', 'deck/logo.svg'])).toBeNull();
  });

  it('숨김 폴더 안은 보지 않는다', () => {
    expect(pickDocument(['.git/x.html', 'deck.html'])).toBe('deck.html');
    expect(pickDocument(['.cache/x.html'])).toBeNull();
  });

  it('.htm 도 문서다', () => {
    expect(pickDocument(['old.htm'])).toBe('old.htm');
  });

  it('후보를 순서대로 모두 돌려준다 — 몇 개 중에 골랐는지 알려야 한다', () => {
    // 조용히 하나 고르고 마는 대신, 고른 사실을 말할 수 있어야 한다 (대원칙 3).
    expect(documentCandidates(['b/deep.html', 'a.html', 'z.html'])).toEqual([
      'a.html',
      'z.html',
      'b/deep.html',
    ]);
  });

  it('순서가 들어온 차례에 좌우되지 않는다', () => {
    const paths = ['deck/index.html', 'deck/appendix.html', 'readme.html'];

    expect(pickDocument(paths)).toBe(pickDocument([...paths].reverse()));
  });
});
