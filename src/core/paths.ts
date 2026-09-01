/**
 * Which file inside the bundle does this URL mean (spec §5.1).
 *
 * Pure string work — no parser, no browser. A document's reference is written
 * relative to wherever the document sits, and the bundle is keyed by the name on
 * disk; everything here exists to get from the first spelling to the second.
 *
 * `core/assets.ts` asks this of HTML attributes and `core/css.ts` of `url()`
 * tokens, so the two roads answer the same question the same way.
 */

/** Asset path → URL to attach. Returning undefined leaves that spot untouched */
export type Resolve = (path: string) => string | undefined;

/** `a/b/c.html` → `a/b`. Empty string when there is no directory */
export function dirOf(path: string): string {
  const at = path.lastIndexOf('/');
  return at < 0 ? '' : path.slice(0, at);
}

/**
 * Resolves a relative path against the document's location.
 *
 * References that leave the bundle (`https:`, `//cdn`, `data:`, `#anchor`) are
 * null — leaving them alone is correct. Either the browser can already fetch them
 * on its own, or they are not assets.
 */
export function splitSuffix(url: string): { path: string; suffix: string } {
  const at = url.search(/[?#]/);
  return at < 0 ? { path: url, suffix: '' } : { path: url.slice(0, at), suffix: url.slice(at) };
}

/** Is this a reference going outside — `scheme:` and protocol-relative URLs. Windows paths (`C:\`) match too */
function isExternal(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//');
}

/** Decode when possible. Invalid encodings stay written as-is */
function decodePart(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

/**
 * Decodes the percent-encoding of a single segment.
 *
 * `%2F` alone is left written as-is, not decoded (spec §5.1) — a file name on disk
 * cannot contain a slash, so the moment it decodes, part of the name turns into a
 * path separator and we look for a nonexistent `a/b.png` instead of the real file
 * `a%2Fb.png`. Its spelling (case) is kept too — the bundle key is the name on disk.
 */
function decodeSegment(segment: string): string {
  return segment
    .split(/(%2F)/i)
    .map((part) => (/^%2F$/i.test(part) ? part : decodePart(part)))
    .join('');
}

/** Canonical path with `.`/`..` collapsed and percent-encoding decoded. The root is the empty string */
function collapse(baseDir: string, path: string): string {
  // Absolute paths resolve against the bundle root, not the document — the top of
  // the folder/zip.
  const fromRoot = path.startsWith('/');
  const joined = fromRoot ? path.slice(1) : `${baseDir ? `${baseDir}/` : ''}${path}`;

  const out: string[] = [];
  for (const raw of joined.split('/')) {
    // Decode **before** collapsing (spec §5.1). The URL spec collapses %2e/%2e%2e
    // segments as dot segments too — decoding after collapsing leaves
    // `%2e%2e/logo.png` unable to climb one level, so the browser finds the file
    // while only we count it as missing. A file name's %20 becoming a real space
    // happens at the same spot. The bundle key is the name on disk, not the
    // document's spelling.
    const segment = decodeSegment(raw);
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      out.pop();
      continue;
    }
    out.push(segment);
  }

  return out.join('/');
}

export function resolvePath(baseDir: string, url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  if (isExternal(trimmed)) return null;

  const { path: clean } = splitSuffix(trimmed);
  if (!clean) return null;

  const path = collapse(baseDir, clean);
  return path === '' ? null : path;
}

/**
 * Of the suffix, only the **fragment** can go back onto the attached URL.
 *
 * The fragment (`#icon`) must be kept — losing it loses what to pull from the
 * sprite. The query (`?v=3`) must be dropped — the moment a query is appended, a
 * blob URL names a different object than the one created, and the browser cannot
 * open it at all. Cache busting means nothing for blobs anyway.
 */
export function blobSuffix(suffix: string): string {
  const hash = suffix.indexOf('#');
  return hash < 0 ? '' : suffix.slice(hash);
}

/**
 * The base directory a `<base href>` value moves the document to.
 *
 * Only the value is taken — finding it in the document is HTML work and stays in
 * `assets.ts`. Everything from here down is the URL rules, so it can be checked
 * without a document around it.
 *
 * @returns The base directory inside the bundle (the root is the empty string).
 *   `docDir` when the value does not move the location, and null when it points
 *   outside (an absolute URL) — that document's relative references are not
 *   local files.
 */
export function baseDirFrom(href: string | undefined, docDir: string): string | null {
  const trimmed = href?.trim();
  if (!trimmed) return docDir;
  if (isExternal(trimmed)) return null;

  const { path } = splitSuffix(trimmed);
  // A base with only a query or fragment (`?v=2`, `#top`) does not move the
  // location — in URL resolution it is the document's own address with the query
  // swapped, so the base directory stays the document's location.
  if (!path) return docDir;
  // base is a URL, not a directory. Ending in `/`, or with a last segment of `.`
  // or `..` (encoded forms included), it is itself a location marker, so collapse
  // it whole — stripping before decoding cuts off the last segment of `..` and
  // `foo/..` instead of collapsing it, leaving deck/sub's `..` at deck/sub
  // instead of deck (spec §5.1).
  const segments = path.split('/');
  const last = decodeSegment(segments[segments.length - 1] ?? '');
  if (path.endsWith('/') || last === '.' || last === '..') return collapse(docDir, path);
  // The last segment is a file name — strip it **as the encoded segment**. A %2F
  // inside the segment is part of the name, not a separator, so stripping after
  // decoding would cut at the slash inside the name.
  const dir = segments.slice(0, -1).join('/');
  if (dir) return collapse(docDir, `${dir}/`);
  // A single-segment base — only the name changed. Absolute means the root,
  // otherwise the document's location.
  return path.startsWith('/') ? '' : docDir;
}
