/**
 * External assets the document keeps beside it and references (spec §5.1).
 *
 * The work here stops at **finding and building the substitution list**. Reading
 * files and creating blob URLs are browser-side jobs, so `lib/assets.ts` does them
 * (INV-6).
 *
 * Substitution results are **preview only**. The source string always stays as it
 * is, so not a single blob URL character reaches the saved file (Principle 1 ·
 * ADR-009).
 */
import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import { applyEdits, type Edit } from './edits.js';
import { encodeAttribute, encodeAttributeSerialized, requoteAttribute } from './entities.js';
import { baseDirFrom, blobSuffix, resolvePath, splitSuffix, type Resolve } from './paths.js';
import { rewriteCssUrls } from './css.js';

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;

/**
 * Only attributes that **point at** an asset are rewritten.
 * `<a href>` is absent — it is a place to navigate to, not an asset to attach.
 */
const ASSET_ATTRS: Record<string, readonly string[]> = {
  link: ['href'],
  script: ['src'],
  img: ['src'],
  source: ['src'],
  video: ['src', 'poster'],
  audio: ['src'],
  iframe: ['src'],
  embed: ['src'],
  object: ['data'],
  track: ['src'],
  input: ['src'],
  use: ['href', 'xlink:href'],
};

export interface AssetRef {
  /** exactly as written in the document */
  url: string;
  /** canonical path resolved against the document's location. The bundle key */
  path: string;
  /**
   * Query and fragment that trailed the path (`?v=3`, `#icon`).
   *
   * Stripped when looking up the file. When reattaching, only the **fragment**
   * goes back on — losing `#icon` in `<use href="sprite.svg#icon">` loses what to
   * pull from the sprite, so nothing draws. Reattaching the query loses everything
   * instead (see `blobSuffix`).
   */
  suffix: string;
  /** the range in the source covering **only the value** (quotes excluded) */
  valueStart: number;
  valueEnd: number;
}

function isElement(node: Node): node is Element {
  return 'tagName' in node;
}

function childrenOf(node: Node): Node[] {
  return 'childNodes' in node ? (node as ParentNode).childNodes : [];
}

/**
 * The effective base directory set by `<base href>` (spec §5.1).
 *
 * When the document moves the base, the browser resolves relative references
 * there. Looking only at the document's own location counts files that really sit
 * next to it as missing, and the preview skips what it should attach.
 * Only the **first** `<base>` with an href is effective — same as the HTML spec.
 *
 * @returns The base directory inside the bundle (the root is the empty string).
 *   null when base points outside (an absolute URL) — that document's relative
 *   references are not local files.
 */
export function documentBaseDir(source: string, docDir: string): string | null {
  const doc = parse(source);
  let href: string | undefined;

  const visit = (node: Node): void => {
    if (href !== undefined) return;
    if (isElement(node) && node.tagName === 'base') {
      href = node.attrs.find((a) => !a.prefix && a.name === 'href')?.value;
      if (href !== undefined) return;
    }
    for (const child of childrenOf(node)) visit(child);
  };
  visit(doc);

  return baseDirFrom(href, docDir);
}

/**
 * Carves **only the value** out of an attribute location.
 *
 * The range parse5 gives covers all of `href="deck.css"`. Replacing the quotes too
 * would fuse the value with the next attribute, so pick out just the inside of the
 * quotes after `=`. Unquoted values are accepted as well.
 */
function valueSpan(
  source: string,
  loc: { startOffset: number; endOffset: number }
): { start: number; end: number } | null {
  const raw = source.slice(loc.startOffset, loc.endOffset);
  const eq = raw.indexOf('=');
  if (eq < 0) return null;

  let at = eq + 1;
  while (at < raw.length && /\s/.test(raw[at] ?? '')) at++;

  const quote = raw[at];
  if (quote === '"' || quote === "'") {
    return { start: loc.startOffset + at + 1, end: loc.endOffset - 1 };
  }
  return { start: loc.startOffset + at, end: loc.endOffset };
}

/**
 * Collects the external assets the document references.
 *
 * @param baseDir The directory the document sits in (its path inside the bundle).
 *   Empty string at the root
 */
export function parseAssetRefs(source: string, baseDir = ''): AssetRef[] {
  const doc = parse(source, { sourceCodeLocationInfo: true });
  const refs: AssetRef[] = [];

  const visit = (node: Node): void => {
    if (isElement(node)) {
      const names = ASSET_ATTRS[node.tagName];
      const attrs = node.sourceCodeLocation?.attrs;
      if (names && attrs) {
        for (const attr of node.attrs) {
          // parse5 splits `xlink:href` into { name: 'href', prefix: 'xlink' } and
          // keeps the location only under the `xlink:href` key. Looking at the name
          // alone either misses xlink references or, in a document with both forms,
          // grabs the wrong one's value.
          const key = attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name;
          const loc = attrs[key];
          if (!names.includes(key) || !loc) continue;

          const path = resolvePath(baseDir, attr.value);
          const span = path === null ? null : valueSpan(source, loc);
          if (path !== null && span) {
            const { suffix } = splitSuffix(attr.value.trim());
            refs.push({
              url: attr.value,
              path,
              suffix,
              valueStart: span.start,
              valueEnd: span.end,
            });
          }
        }
      }
    }
    for (const child of childrenOf(node)) visit(child);
  };

  visit(doc);
  return refs;
}

/**
 * One reference's spelling in the preview. null when there is no asset to attach —
 * that spot stays as it is.
 *
 * Only the fragment is reattached. Without it, what to pull from the sprite is lost.
 * The fragment is a decoded value, so it is encoded before being written back
 * (INV-8) — a quote written as an entity, inserted back decoded, terminates the
 * attribute early and the rest of the fragment gets promoted to a new attribute
 * (onerror= etc.) in the preview.
 *
 * The outgoing substitution (assetEdits) and the reverse pair (assetSwaps) both use
 * **this one function** (ADR-011) — computed separately in two places, a mismatched
 * pair is guaranteed to appear.
 */
function previewValue(ref: AssetRef, resolve: Resolve): { url: string; text: string } | null {
  const url = resolve(ref.path);
  return url ? { url, text: url + encodeAttribute(blobSuffix(ref.suffix)) } : null;
}

/** Turns only the references with an attachable asset into a substitution list */
export function assetEdits(refs: readonly AssetRef[], resolve: Resolve): Edit[] {
  const edits: Edit[] = [];
  for (const ref of refs) {
    const value = previewValue(ref, resolve);
    if (value) edits.push({ start: ref.valueStart, end: ref.valueEnd, text: value.text });
  }
  return edits;
}

/**
 * One preview substitution's pair — `from`→`to` going out, `to`→`from` coming back
 * (ADR-011). All offsets are relative to the source string (INV-3).
 */
export interface AssetSwap {
  start: number;
  end: number;
  /** the spelling exactly as in the source (entities included) — reversal restores these bytes */
  from: string;
  /** the spelling that goes into the preview document */
  to: string;
  /**
   * The pair's spelling when the browser serializes via innerHTML. Omitted when
   * the source side (`serializedFrom`) also equals `from`/`to`.
   *
   * The conservative encoding we send out (`&#32;` etc.) comes back swapped for
   * the minimal encoding after a round trip through the browser — holding only
   * the outgoing spelling leaks the blob in that edit.
   */
  serializedTo?: string;
  /**
   * The source spelling to restore into the serialized context — `from` with only
   * `"` locked as `&quot;`. Re-encoding the decoded value would grind down the
   * source's entity spelling, creating a diff in an attribute the user never
   * touched (Principle 2).
   */
  serializedFrom?: string;
}

/**
 * The whole document's substitution pairs — attribute values and `<style>` bodies
 * (spec §5.1 · ADR-011).
 *
 * Both preview document assembly and the per-block two-way boundary
 * (assetBoundary) come from this one list. References with no attachable asset
 * never enter the list, so neither direction touches them.
 */
export function assetSwaps(
  source: string,
  refs: readonly AssetRef[],
  baseDir: string,
  resolve: Resolve
): AssetSwap[] {
  const swaps: AssetSwap[] = [];
  for (const ref of refs) {
    const value = previewValue(ref, resolve);
    if (value === null) continue;
    // The value to restore is the **source slice at that position**, not a
    // decoded-and-re-encoded value — substituting and reversing must be
    // byte-identical (Principles 1 and 2).
    const from = source.slice(ref.valueStart, ref.valueEnd);
    const serializedTo = value.url + encodeAttributeSerialized(blobSuffix(ref.suffix));
    // The serialized pair's source side follows the same principle — re-encoding
    // the decoded value (ref.url) grinds non-standard source entities (`&#32;`
    // etc.) into the minimal spelling, and the moment that block is edited, the
    // spelling of untouched attributes changes (Principle 2). Use the source
    // slice as-is, changing only the `"` that terminates a value early in the
    // serialized (double-quoted) context.
    const serializedFrom = requoteAttribute(from);
    const swap: AssetSwap = { start: ref.valueStart, end: ref.valueEnd, from, to: value.text };
    if (serializedTo !== value.text || serializedFrom !== from) {
      swap.serializedTo = serializedTo;
      swap.serializedFrom = serializedFrom;
    }
    swaps.push(swap);
  }
  // <style> bodies are rawtext, so serialization does not change their spelling —
  // one pair is enough.
  for (const edit of styleEdits(source, baseDir, resolve)) {
    swaps.push({
      start: edit.start,
      end: edit.end,
      from: source.slice(edit.start, edit.end),
      to: edit.text,
    });
  }
  return swaps;
}

/**
 * The two-way boundary between preview and save (ADR-011).
 *
 * Markers never land inside a block because blocks do not overlap, but asset
 * substitution does happen **inside** blocks. Outgoing fragments get substituted;
 * returning edits get restored to the source spelling.
 */
export interface AssetBoundary {
  /**
   * A source fragment (a block's `sourceInner` etc.) for the preview — substitutes
   * the references inside the fragment's range with the preview spelling.
   * @param textStart the offset where the fragment starts in the source (INV-3)
   */
  toPreview(text: string, textStart: number): string;
  /**
   * HTML returned from the preview, for saving — restores preview spellings to the
   * source spellings.
   *
   * @param textStart/textEnd the source range of the block this HTML came from
   *   (INV-3). When given, substitutions inside the range are restored **each to
   *   its own spelling**, in source order — references spelling the same file
   *   differently (`logo.png` and `./logo.png`) share one preview spelling, and
   *   restoring via a single table would grind an untouched reference's spelling
   *   into another position's (Principle 2). Spellings that cannot be tied to a
   *   position restore to the first source spelling seen (spec §5.1).
   */
  fromPreview(html: string, textStart?: number, textEnd?: number): string;
}

export function assetBoundary(swaps: readonly AssetSwap[]): AssetBoundary {
  // The restore table for spellings that cannot be tied to a position. When one
  // preview spelling has several source spellings (`logo.png` and `./logo.png`),
  // restore to the first one seen — either way it names the same file. Spellings
  // whose position is known are restored directly from the swap list in
  // fromPreview below.
  const back = new Map<string, string>();
  for (const swap of swaps) {
    // The serialized pair goes first — what fromPreview receives is HTML the
    // browser serialized, so when the two spellings coincide (to === serializedTo)
    // it must restore to the side that fits that context (serializedFrom, the
    // source slice with `"` locked as &quot;) or the attribute terminates early.
    if (swap.serializedTo !== undefined && swap.serializedFrom !== undefined) {
      if (!back.has(swap.serializedTo)) back.set(swap.serializedTo, swap.serializedFrom);
    }
    if (!back.has(swap.to)) back.set(swap.to, swap.from);
  }
  // Restore longer spellings first — a fragmentless spelling (`blob:u`) is a
  // prefix of a fragmented one (`blob:u#icon`), and replacing the short one first
  // means the long one never matches, leaving the fragment stuck to the blob name.
  const pairs = [...back].sort((a, b) => b[0].length - a[0].length);

  /** If this swap went out as preview spelling `spelled`, the source spelling to restore; otherwise null */
  const ownSpelling = (swap: AssetSwap, spelled: string): string | null => {
    // The serialized pair goes first — what fromPreview receives is HTML the
    // browser serialized, so when the two spellings coincide (to === serializedTo)
    // it must restore to the side that fits that context (serializedFrom, the
    // source slice with `"` locked as &quot;) or the attribute terminates early.
    if (swap.serializedTo !== undefined && spelled === swap.serializedTo) {
      return swap.serializedFrom ?? swap.from;
    }
    return spelled === swap.to ? swap.from : null;
  };

  return {
    toPreview(text, textStart) {
      const inside: Edit[] = [];
      for (const swap of swaps) {
        if (swap.start < textStart || swap.end > textStart + text.length) continue;
        // The content at the position must match the source spelling too — if it
        // differs, this fragment is not that spot in the source, so do not change
        // it on a guess (Principle 3).
        if (text.slice(swap.start - textStart, swap.end - textStart) !== swap.from) continue;
        inside.push({ start: swap.start - textStart, end: swap.end - textStart, text: swap.to });
      }
      return applyEdits(text, inside);
    },
    fromPreview(html, textStart, textEnd) {
      // The substitutions inside this block's range — restoration is anchored to
      // positions, not the table (spec §5.1).
      const local =
        textStart === undefined || textEnd === undefined
          ? []
          : swaps
              .filter((s) => s.start >= textStart && s.end <= textEnd)
              .sort((a, b) => a.start - b.start);
      if (local.length === 0) {
        // Position unknown (called without a range) or no substitutions in the
        // range — restore via the table. Blob URLs are random names newly minted
        // per tab, so they cannot collide with text originally in the document —
        // whole-string substitution is enough.
        let out = html;
        for (const [to, from] of pairs) if (to !== from) out = out.split(to).join(from);
        return out;
      }
      // Scan from the left for preview spellings, matching them in the order the
      // range's substitutions appear — the k-th occurrence of a spelling is this
      // block's k-th position with that spelling, so each restores to its own
      // source spelling (Principle 2). Only spellings orphaned by deletion or
      // reordering restore via the table (the first source spelling seen) —
      // either spelling names the same file.
      const used = local.map(() => false);
      let out = '';
      let i = 0;
      scan: while (i < html.length) {
        // Check longer spellings first — a fragmentless spelling is a prefix of a
        // fragmented one (the pairs ordering).
        for (const [to, fallback] of pairs) {
          if (!html.startsWith(to, i)) continue;
          let from = fallback;
          for (let j = 0; j < local.length; j++) {
            if (used[j]) continue;
            const own = ownSpelling(local[j] as AssetSwap, to);
            if (own !== null) {
              used[j] = true;
              from = own;
              break;
            }
          }
          out += from;
          i += to.length;
          continue scan;
        }
        out += html[i];
        i++;
      }
      return out;
    },
  };
}

/** The bodies of the `<style>` elements embedded in the document. Counting what they call needs the text */
export function styleTexts(source: string): string[] {
  const doc = parse(source, { sourceCodeLocationInfo: true });
  const texts: string[] = [];

  const visit = (node: Node): void => {
    if (isElement(node) && node.tagName === 'style') {
      for (const child of childrenOf(node)) {
        if (child.nodeName === '#text' && 'value' in child) texts.push(child.value);
      }
      return;
    }
    for (const child of childrenOf(node)) visit(child);
  };

  visit(doc);
  return texts;
}

/** `url(...)` inside the document's embedded `<style>` gets rewritten by the same rules */
export function styleEdits(source: string, baseDir: string, resolve: Resolve): Edit[] {
  const doc = parse(source, { sourceCodeLocationInfo: true });
  const edits: Edit[] = [];

  const visit = (node: Node): void => {
    if (isElement(node) && node.tagName === 'style') {
      for (const child of childrenOf(node)) {
        const loc = child.sourceCodeLocation;
        if (child.nodeName !== '#text' || !loc || !('value' in child)) continue;
        const next = rewriteCssUrls(child.value, baseDir, resolve);
        if (next !== child.value) {
          edits.push({ start: loc.startOffset, end: loc.endOffset, text: next });
        }
      }
      return;
    }
    for (const child of childrenOf(node)) visit(child);
  };

  visit(doc);
  return edits;
}
