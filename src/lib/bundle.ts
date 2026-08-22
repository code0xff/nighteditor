/**
 * The **shape only** of an attached-asset bundle.
 *
 * The store needs an empty bundle before any file is opened. But importing it from
 * `lib/assets` would pull parse5 in through `core/assets`, putting the parser in the
 * initial bundle (ADR-008). Before a file is opened, not a single line of the parser
 * should be loaded.
 */

export interface AssetBundle {
  /** asset path → blob URL */
  urls: ReadonlyMap<string, string>;
  /**
   * Referenced by an attached stylesheet but absent from the bundle.
   *
   * The document's attributes alone cannot tell — fonts and backgrounds inside CSS
   * only show up once that file is opened.
   */
  missing: readonly string[];
  /** Must be called when done. Otherwise the blobs stay in memory until the tab closes */
  dispose: () => void;
}

export const EMPTY_BUNDLE: AssetBundle = { urls: new Map(), missing: [], dispose: () => {} };
