/**
 * Turns the files that were read into a bundle of `blob:` URLs the preview can
 * attach (ADR-009).
 *
 * Files never leave this machine (Principle 5). A blob URL is just a name tag
 * valid inside this tab — nothing is uploaded anywhere.
 */
import { cssAssetPaths, dirOf, rewriteCssUrls } from '@/core/assets';
import type { AssetBundle } from './bundle';

/** MIME type inferred from the extension */
const MIME: Record<string, string> = {
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  json: 'application/json',
  html: 'text/html',
  htm: 'text/html',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
};

/**
 * Stylesheets must carry a type. A standards-mode browser refuses to use a
 * non-`text/css` response as a stylesheet, so a typeless blob attaches but never applies.
 */
export function mimeOf(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return MIME[ext] ?? 'application/octet-stream';
}

/**
 * The type for this file's blob — **a known extension wins** (spec §5.1).
 *
 * The type reported on a `File` from a folder or a drop cannot be trusted — some
 * environments report `.js` as `text/plain`, and carried onto the blob as-is the
 * browser rejects the linked script for its type, so the preview fails even though
 * the file is right there. The type a document expects for a file it references by
 * extension is the extension's type. Only unknown extensions trust the reported type.
 */
function typeFor(path: string, blob: Blob): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return MIME[ext] ?? (blob.type || 'application/octet-stream');
}

function isCss(path: string): boolean {
  return path.toLowerCase().endsWith('.css');
}

/**
 * Turns a file map into a blob-URL bundle.
 *
 * CSS is built last. The `url()` references inside it must be rewritten to the
 * other assets' blob URLs, which means those URLs have to exist first.
 */
export async function buildAssets(
  files: ReadonlyMap<string, Blob>,
  /** The paths the document actually references. Only stylesheets reachable from here are scanned */
  reachable?: readonly string[]
): Promise<AssetBundle> {
  const urls = new Map<string, string>();
  const made: string[] = [];
  const add = (path: string, blob: Blob): void => {
    const url = URL.createObjectURL(blob);
    urls.set(path, url);
    made.push(url);
  };

  for (const [path, blob] of files) {
    if (isCss(path)) continue;
    const type = typeFor(path, blob);
    add(path, blob.type === type ? blob : new Blob([blob], { type }));
  }

  // Stylesheets also reference each other (`@import url(…)`). Building the caller's
  // blob first leaves the callee's URL missing, so the reference stays relative —
  // and relative paths never resolve in a blob document. So read who references
  // whom first.
  const sheets = new Map<string, { text: string; wants: string[] }>();
  for (const [path, blob] of files) {
    if (isCss(path)) sheets.set(path, { text: await blob.text(), wants: [] });
  }
  for (const [path, sheet] of sheets) {
    // A stylesheet resolves the paths inside it relative to where it sits.
    sheet.wants = cssAssetPaths(sheet.text, dirOf(path)).filter((p) => p !== path && sheets.has(p));
  }

  // Build callees first. In a cycle, waiting longer never produces a URL, so the
  // cycle must be built as-is — but not by building **everything left**: a sheet
  // that references the cycle from outside (the document's entry sheet, say) would
  // be built before the cycle members' URLs exist, leaving its @import relative
  // and forever unresolved in a blob document. There can also be several cycles —
  // mutually entangled sheets (a strongly connected component) are one unit, and
  // building a cycle that leans on another cycle at the same time leaves that
  // @import relative for the same reason. So build only **one component** that no
  // longer leans on any remaining sheet; whatever leaned on it (cycle or single
  // sheet) is built on the next lap with the freshly minted URLs (spec §5.1).
  const left = new Map(sheets);
  /** Sheets reachable from start following only remaining sheets' @imports (may include start itself) */
  const reach = (start: string): Set<string> => {
    const seen = new Set<string>();
    const queue = [...(left.get(start)?.wants ?? [])];
    for (let at = 0; at < queue.length; at++) {
      const path = queue[at] as string;
      if (seen.has(path) || !left.has(path)) continue;
      seen.add(path);
      queue.push(...(left.get(path)?.wants ?? []));
    }
    return seen;
  };
  /**
   * One strongly connected component of the remaining sheets that no longer leans
   * on any other remaining sheet. Called only when ready is empty — at that point
   * everything left is waiting on a remaining sheet, so a cycle must exist, and
   * since dependencies between components are acyclic (otherwise they would be one
   * component) a component with nothing to lean on must exist too.
   */
  const sinkCycle = (): [string, { text: string; wants: string[] }][] => {
    for (const start of left.keys()) {
      const forward = reach(start);
      if (!forward.has(start)) continue; // not a member of a cycle
      const scc = new Set([start, ...[...forward].filter((p) => reach(p).has(start))]);
      const leans = [...scc].some((member) =>
        (left.get(member)?.wants ?? []).some((want) => left.has(want) && !scc.has(want))
      );
      if (!leans) return [...left].filter(([path]) => scc.has(path));
    }
    // Unreachable — but if we ever get here, build everything left so the loop at
    // least terminates (never freeze the tab).
    return [...left];
  };
  while (left.size > 0) {
    const ready = [...left].filter(([, sheet]) => !sheet.wants.some((p) => left.has(p)));
    // Every lap builds at least one sheet (a ready one or one component), so the loop ends.
    const batch = ready.length > 0 ? ready : sinkCycle();
    for (const [path, sheet] of batch) {
      const css = rewriteCssUrls(sheet.text, dirOf(path), (p) => urls.get(p));
      add(path, new Blob([css], { type: 'text/css' }));
      left.delete(path);
    }
  }

  // Missing assets are counted only from stylesheets **this document references**.
  // Counting fonts wanted by some stranded stylesheet lying around the folder would
  // nag the user to find files that have nothing to do with this document.
  const wanted = reachable ? new Set(reachable) : null;
  // "References" is not one hop — if a sheet the document references @imports
  // another sheet, what that sheet references belongs to this document too. Looking
  // only at directly referenced sheets lets a broken reference one hop away slip
  // through silently: the page is broken with no word about it (Principle 3).
  if (wanted) {
    const queue = [...wanted].filter((p) => sheets.has(p));
    for (let at = 0; at < queue.length; at++) {
      for (const want of sheets.get(queue[at] ?? '')?.wants ?? []) {
        if (!wanted.has(want)) {
          wanted.add(want);
          queue.push(want);
        }
      }
    }
  }
  const missing = new Set<string>();

  for (const [path, sheet] of sheets) {
    if (wanted && !wanted.has(path)) continue;
    for (const want of cssAssetPaths(sheet.text, dirOf(path))) {
      if (!files.has(want)) missing.add(want);
    }
  }

  return {
    urls,
    missing: [...missing],
    dispose: () => {
      for (const url of made) URL.revokeObjectURL(url);
    },
  };
}
