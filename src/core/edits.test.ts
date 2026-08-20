import { describe, expect, it } from 'vitest';
import { applyEdits, EditError } from './edits.js';

describe('applyEdits', () => {
  it('앞쪽 offset 이 밀리지 않는다', () => {
    // 순서대로 적용하면 두 번째 편집이 엉뚱한 자리를 자른다. 그래서 뒤에서부터 적용한다.
    const out = applyEdits('0123456789', [
      { start: 1, end: 3, text: '가나다라' },
      { start: 6, end: 8, text: 'X' },
    ]);

    expect(out).toBe('0가나다라345X89');
  });

  it('목록 순서와 무관하게 같은 결과를 낸다', () => {
    const edits = [
      { start: 6, end: 8, text: 'X' },
      { start: 1, end: 3, text: '가나다라' },
    ];

    expect(applyEdits('0123456789', edits)).toBe('0가나다라345X89');
  });

  it('삽입(start === end)을 지원한다', () => {
    expect(applyEdits('<p>글</p>', [{ start: 2, end: 2, text: ' id="1"' }])).toBe(
      '<p id="1">글</p>'
    );
  });

  it('맞닿은 편집은 겹친 것이 아니다', () => {
    // 속성 값이 태그 끝까지 닿아 있고 그 자리에 마커를 넣는 경우가 실제로 있다.
    const out = applyEdits('<img src=a.png>', [
      { start: 9, end: 14, text: 'blob:x' },
      { start: 14, end: 14, text: ' data-ne-id="0"' },
    ]);

    expect(out).toBe('<img src=blob:x data-ne-id="0">');
  });

  it('겹치는 편집은 거부한다', () => {
    // 어느 쪽을 골라도 틀린다. 조용히 덮어쓰지 않는다 (대원칙 3).
    expect(() =>
      applyEdits('0123456789', [
        { start: 1, end: 5, text: 'a' },
        { start: 3, end: 7, text: 'b' },
      ])
    ).toThrow(EditError);
  });

  it('원본 밖을 가리키면 거부한다', () => {
    expect(() => applyEdits('짧다', [{ start: 0, end: 99, text: 'x' }])).toThrow(EditError);
  });

  it('빈 목록은 원본 그대로다', () => {
    expect(applyEdits('그대로', [])).toBe('그대로');
  });
});
