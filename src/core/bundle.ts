/**
 * 여러 파일을 한꺼번에 받았을 때(폴더·zip) **무엇을 여는가** (spec §5.1).
 *
 * 고쳐서 저장하는 대상은 언제나 HTML 한 개다. 묶음 안에 후보가 여럿이면
 * 규칙을 정해 하나를 고르고, 고른 사실을 사용자에게 알린다 (대원칙 3).
 */

const DOCUMENT = /\.html?$/i;

function depthOf(path: string): number {
  return path.split('/').length;
}

/** 묶음 안의 HTML 후보. 얕은 것, `index`, 짧은 것 순으로 앞에 온다 */
export function documentCandidates(paths: Iterable<string>): string[] {
  const candidates = [...paths].filter(
    (path) => DOCUMENT.test(path) && !path.split('/').some((seg) => seg.startsWith('.'))
  );

  return candidates.sort((a, b) => {
    // 깊이 먼저 — 묶음의 겉면에 있는 문서가 그 묶음의 얼굴이다.
    if (depthOf(a) !== depthOf(b)) return depthOf(a) - depthOf(b);
    const indexA = /(^|\/)index\.html?$/i.test(a);
    const indexB = /(^|\/)index\.html?$/i.test(b);
    if (indexA !== indexB) return indexA ? -1 : 1;
    if (a.length !== b.length) return a.length - b.length;
    return a < b ? -1 : 1;
  });
}

/** 묶음에서 열 문서 하나. 후보가 없으면 null */
export function pickDocument(paths: Iterable<string>): string | null {
  return documentCandidates(paths)[0] ?? null;
}
