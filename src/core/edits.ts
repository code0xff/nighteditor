/**
 * 원본 offset 기준 편집을 한 번에 적용한다.
 *
 * 프리뷰 문서를 만들 때 마커 주입과 자원 URL 치환이 **둘 다** 원본 offset 을 쓴다.
 * 따로 적용하면 앞선 편집이 뒤쪽 offset 을 밀어 엉뚱한 자리를 자른다.
 * 그래서 목록을 한데 모아 내림차순으로 적용한다 (INV-4 와 같은 규칙).
 */

/** `[start, end)` 를 `text` 로 바꾼다. `start === end` 면 삽입이다. */
export interface Edit {
  start: number;
  end: number;
  text: string;
}

export class EditError extends Error {}

/**
 * 겹치는 편집은 조용히 덮어쓰지 않고 거부한다 (대원칙 3).
 * 겹친다는 건 같은 자리를 두 규칙이 다르게 해석했다는 뜻이라, 어느 쪽을 골라도 틀린다.
 */
export function applyEdits(source: string, edits: readonly Edit[]): string {
  const ordered = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);

  let out = source;
  // 방금 적용한 편집의 시작점. 다음(더 앞쪽) 편집은 여기를 넘어설 수 없다.
  let limit = source.length;
  for (const edit of ordered) {
    if (edit.start < 0 || edit.end > source.length || edit.start > edit.end) {
      throw new EditError(`편집 범위가 원본을 벗어난다: [${edit.start}, ${edit.end})`);
    }
    if (edit.end > limit) {
      throw new EditError(`편집이 겹친다: [${edit.start}, ${edit.end})`);
    }
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    limit = edit.start;
  }
  return out;
}
