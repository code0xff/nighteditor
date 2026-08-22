/**
 * **What to open** when many files arrive at once (folder or zip) (spec §5.1).
 *
 * The thing we edit and save is always a single HTML file. When a bundle holds
 * several candidates, a rule picks one, and the pick is reported to the user
 * (Principle 3).
 */

const DOCUMENT = /\.html?$/i;

function depthOf(path: string): number {
  return path.split('/').length;
}

/** HTML candidates in the bundle. Shallower first, then `index`, then shorter */
export function documentCandidates(paths: Iterable<string>): string[] {
  const candidates = [...paths].filter(
    (path) => DOCUMENT.test(path) && !path.split('/').some((seg) => seg.startsWith('.'))
  );

  return candidates.sort((a, b) => {
    // Depth first — the document on the surface of a bundle is that bundle's face.
    if (depthOf(a) !== depthOf(b)) return depthOf(a) - depthOf(b);
    const indexA = /(^|\/)index\.html?$/i.test(a);
    const indexB = /(^|\/)index\.html?$/i.test(b);
    if (indexA !== indexB) return indexA ? -1 : 1;
    if (a.length !== b.length) return a.length - b.length;
    return a < b ? -1 : 1;
  });
}

/** The one document to open from a bundle. null when there is no candidate */
export function pickDocument(paths: Iterable<string>): string | null {
  return documentCandidates(paths)[0] ?? null;
}
