/**
 * 붙인 자원 묶음의 **모양만** 있는 곳.
 *
 * 스토어는 파일을 열기 전에도 빈 묶음이 필요하다. 그렇다고 `lib/assets` 에서 가져오면
 * 그 파일이 `core/assets` 를 거쳐 parse5 를 끌고 와, 파서가 초기 번들에 실린다 (ADR-008).
 * 파일을 열기 전에는 파서가 한 줄도 쓰이지 않아야 한다.
 */

export interface AssetBundle {
  /** 자원 경로 → blob URL */
  urls: ReadonlyMap<string, string>;
  /**
   * 붙인 스타일시트가 부르는데 묶음에 없던 것.
   *
   * 문서의 속성만 봐서는 알 수 없다 — CSS 안의 글꼴과 배경은 그 파일을 열어봐야 나온다.
   */
  missing: readonly string[];
  /** 다 쓰면 반드시 부른다. 안 부르면 blob 이 탭을 닫을 때까지 메모리에 남는다 */
  dispose: () => void;
}

export const EMPTY_BUNDLE: AssetBundle = { urls: new Map(), missing: [], dispose: () => {} };
