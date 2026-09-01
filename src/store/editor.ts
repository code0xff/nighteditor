import { create } from 'zustand';
import { applyPatches, PatchError } from '@/core/patch';
import { applyLiveLocks } from '@/core/verify';
import type { Block, LockReason } from '@/core/types';
import { lockNotice, patchNotice, zipNotice, type Notice } from '@/lib/messages';
import { ZipError } from '@/core/zip';
import { useToasts } from './toasts';
import {
  canPickFolder,
  downloadFile,
  droppedFile,
  NotUtf8Error,
  pickFile,
  pickFolder,
  readText,
  saveFile,
  type FolderRead,
  type OpenedFile,
  type Picked,
} from '@/lib/fs';
import { EMPTY_BUNDLE, type AssetBundle } from '@/lib/bundle';
import {
  claimDocument,
  refuseWhileReplacing,
  reserveReplacement,
  Superseded,
  useReplacement,
  type Replacement,
} from './replacement';
import { keepEdits } from './unsaved';
import type { AssetBoundary, AssetRef } from '@/core/assets';
import { documentCandidates } from '@/core/bundle';
import { dirOf } from '@/core/paths';

export interface EditorState {
  file: OpenedFile | null;
  /** The loaded original. Never changes for the whole session (INV-1) */
  source: string;
  blocks: Block[];
  previewDoc: string;
  /**
   * The current preview document's token (spec §5). The iframe is reused and
   * swapping `srcDoc` keeps the `contentWindow` identity, so a message the old
   * document's agent left in flight passes the origin check if it arrives after
   * the new document stands — and block ids restart at 0 per document, so old
   * content and locks would touch the new document. The agent attaches this token
   * to every message, and PreviewFrame drops messages with a different token.
   * The empty string when there is no document.
   */
  previewToken: string;
  /** block id → edited innerHTML */
  patches: Map<number, string>;
  selectedId: number | null;
  /** Marks the block whose lock reason is being shown after a click */
  blockedId: number | null;
  /** The list of reverts to send to the preview. PreviewFrame sends and drains it */
  revertQueue: { id: number; html: string }[];
  /** The block the preview is asked to reveal. Cleared once sent */
  revealId: number | null;
  /**
   * Block ids in commit order (the last is the most recent). `patches` is a Map,
   * so a block edited again stays where it was first inserted and "the last
   * change" cannot be read off it.
   */
  editOrder: number[];
  scanned: boolean;
  /**
   * A save is writing the file — an indicator **owned by saving alone**, keeping
   * the save button and the dialog's save from running on top of each other. The
   * replacement's screen lock is held separately by the reservation
   * (replacement.ts), so an earlier save finishing never lowers that lock
   * (spec §5 · ADR-010).
   */
  saving: boolean;
  /**
   * There are edits not yet in the file — the output built right now differs from
   * `savedText` (spec §5).
   *
   * `patches` cannot tell in either direction — after a save, `source` stays the
   * original (INV-1) so the patch list survives (read as "not saved" it would
   * keep asking after every save), and conversely reverting a never-saved edit
   * removes the patch while there was nothing to lose in the first place.
   */
  unsaved: boolean;
  /**
   * What the file holds — as read when opened, then updated to each save's
   * output. `unsaved` is always a comparison against this. It is not an input to
   * the save path (that is `source`, INV-1).
   */
  savedText: string;
  /**
   * The output a save is writing right now. Once the write finishes this is what
   * the file holds, so "does it differ from the file" during the write compares
   * against this, not the old `savedText` (spec §5) — compared to the old one, an
   * edit reverted mid-write would read as nothing-to-lose, the tab would close
   * without warning in that window, and screen and disk would disagree. null when
   * no save is running.
   */
  pendingText: string | null;
  /**
   * The patches that went into the file at the last save — `savedText`'s per-block
   * counterpart. The question's "{count} spots" counts the difference between the
   * current `patches` and this (spec §4 · `unsavedCount`). Not an input to the
   * save path — that is `patches` and `source` (INV-1).
   */
  savedPatches: ReadonlyMap<number, string>;
  /** A message key, not a finished sentence — switching the language changes the notice too (spec §1) */
  notice: Notice | null;

  /** External assets the document references (spec §5.1) */
  assetRefs: AssetRef[];
  /**
   * Every asset path that gets counted.
   *
   * The document's attributes are not enough — a `url()` inside `<style>` or an
   * attached stylesheet also breaks the page when it cannot attach. Counted per
   * **file**, not per reference.
   */
  assetPaths: string[];
  /** Attached assets. Opening another file must release the previous ones */
  assets: AssetBundle;
  /**
   * The two-way boundary between preview and save (ADR-011). Asset swaps happen
   * inside blocks too, so an edit returning from the preview becomes a patch only
   * after this restores the original notation (INV-9), and an original fragment
   * pushed to the preview by a revert leaves only after this swaps it. null means
   * no assets were swapped — both directions pass the original text untouched.
   */
  boundary: AssetBoundary | null;
  /** The directory the document sits in inside the bundle. Non-root only when opened from a folder or zip */
  docDir: string;
  /** The open document's path inside the bundle. Empty string outside a bundle */
  docPath: string;
  /**
   * Every file the bundle brought. Held so switching to another document needs no
   * re-unpacking. The blob URLs pin these files anyway, so it costs nothing extra.
   */
  bundle: ReadonlyMap<string, Blob> | null;
  /** The HTML candidates inside the bundle. With just one there is nothing to pick */
  candidates: string[];
  /** Handles of bundle files that can be written back. Filled only when a folder was opened */
  bundleHandles: ReadonlyMap<string, OpenedFile['handle']>;

  openFile: () => Promise<void>;
  /**
   * One drop — file or folder (spec §5 · replacement reservation).
   *
   * Folder items disappear when the event ends, so the scan arrives already
   * started by the screen side. The reservation is taken here, **before waiting**
   * on the scan — taken late, a folder dropped earlier but scanned later would
   * take a newer reservation and overwrite the folder dropped last.
   */
  openDropped: (file: File | undefined, folder: Promise<FolderRead | null>) => Promise<void>;
  /** @param within the reservation to inherit. Absent, this call itself is the user action and reserves anew */
  loadDropped: (file: File, within?: Replacement) => Promise<void>;
  /** Opens the document inside an already-read folder. false if it was not a folder */
  loadFolder: (read: FolderRead | null, within?: Replacement) => Promise<boolean>;
  /** Closes the open document and returns to the initial screen */
  closeFile: () => Promise<void>;
  /** Picks a folder and opens the document inside (spec §5.1) */
  openFolder: () => Promise<void>;
  /** Turns a mid-open failure into a notice — errors caught by the screen side come in here */
  failedToOpen: (e: unknown) => void;
  /**
   * Receives a file the OS opened (PWA file_handlers). Taken as a promise without
   * waiting for the read — the reservation must be taken **before** the read, so
   * this flow does not displace a newer flow the user opened during it
   * (spec §5 · replacement reservation).
   */
  adopt: (file: OpenedFile | Promise<OpenedFile>) => Promise<void>;
  onReady: (live: { id: number; text: string }[]) => void;
  onEdit: (id: number, html: string, pristine?: boolean) => void;
  onBlocked: (id: number) => void;
  /** A block was clicked before the cross-check finished — editing did not open, and the situation is explained (spec §4) */
  onNotReady: () => void;
  select: (id: number | null) => void;
  revert: (id: number) => void;
  revertAll: () => void;
  /** Reverts the most recently committed change (Ctrl+Z) */
  undoLast: () => void;
  drainReverts: () => void;
  /** Reveals a block chosen in the change list in the preview */
  reveal: (id: number) => void;
  drainReveal: () => void;
  /** true if saved. false on failure or with nothing to save */
  save: () => Promise<boolean>;
  downloadCopy: () => void;
  /** Opens a folder to attach external assets (spec §5.1) */
  linkFolder: () => Promise<void>;
  /** Switches to another document in the same bundle */
  openFromBundle: (path: string) => Promise<void>;
}

/**
 * The counts of attached and missing assets. A file referenced several times
 * counts once — the unit the user counts in is files, not references.
 */
export function countAssets(state: Pick<EditorState, 'assetPaths' | 'assets'>): {
  linked: number;
  missing: number;
} {
  const linked = new Set<string>();
  const missing = new Set<string>();
  for (const path of state.assetPaths) {
    (state.assets.urls.has(path) ? linked : missing).add(path);
  }
  return { linked: linked.size, missing: missing.size };
}

/**
 * Does it differ from the file — compares the output built right now against what
 * the file holds (spec §5).
 *
 * The save button, `Ctrl+S`'s early return, `beforeunload` and the save dialog
 * all read this one criterion. If the output cannot be built, sameness cannot be
 * known either — treating it as at-risk and asking is the safe side (Principle 3).
 */
function differsFromDisk(
  s: Pick<EditorState, 'source' | 'blocks' | 'patches' | 'savedText' | 'pendingText'>
): boolean {
  try {
    const list = [...s.patches].map(([id, newInnerHtml]) => ({ id, newInnerHtml }));
    // While a save is writing, the file is about to hold that output — so that is the baseline (spec §5).
    return applyPatches(s.source, s.blocks, list) !== (s.pendingText ?? s.savedText);
  } catch {
    return true;
  }
}

/**
 * The number of blocks that differ from the file — the question's "{count} spots"
 * (spec §4).
 *
 * The patch total cannot count this: patches survive a save (INV-1) so
 * already-saved spots would be counted, and reverting a saved edit leaves no
 * patch while the file still differs (that spot is one). So the current patches
 * are compared block by block against the patches of the last save — if a
 * block's patch is unchanged, that spot in the file is unchanged too, so this
 * difference is exactly where output and file diverge.
 *
 * An entry present on only one side is compared with that block's **original
 * content** standing in for the gap (spec §4). Counting mere presence, a spot
 * saved as the original (edited, then edited back to the original and saved)
 * would count one extra when reverted — output and file both hold the original
 * there and agree — because of the entry left in savedPatches.
 */
export function unsavedCount(s: Pick<EditorState, 'patches' | 'savedPatches' | 'blocks'>): number {
  // A spot without an entry holds the original — a title (rcdata) patch is plain text, so sourceText is its pair.
  const originalOf = (id: number): string | undefined => {
    const block = s.blocks.find((b) => b.id === id);
    return block ? (block.rcdata ? block.sourceText : block.sourceInner) : undefined;
  };
  let count = 0;
  for (const id of new Set([...s.patches.keys(), ...s.savedPatches.keys()])) {
    const original = originalOf(id);
    if ((s.patches.get(id) ?? original) !== (s.savedPatches.get(id) ?? original)) count++;
  }
  return count;
}

/**
 * An edit that equals the original does not count as a patch — saving it must not
 * produce a diff.
 *
 * When nothing changed, `prev` is returned **as-is** — the caller must be able to
 * tell "truly nothing happened" by reference comparison, or the edit order
 * (editOrder) gets shuffled for nothing.
 */
function nextPatches(
  prev: Map<number, string>,
  block: Block,
  html: string,
  pristine: boolean
): Map<number, string> {
  // Plain text edited directly in the host, like the title, is compared against sourceText.
  if (block.rcdata) {
    const next = new Map(prev);
    if (html === block.sourceText) next.delete(block.id);
    else next.set(block.id, html);
    return next;
  }
  // The preview's pristine means "same as the screen when editing opened". The
  // screen shows the original with patches applied, so leaving unchanged must
  // leave the patch state unchanged too — deleting the patch here would remove an
  // already-committed (or saved) edit from the save path alone, and the content
  // still on screen would fall back to the original at the next save (a split
  // between screen and saved file). The browser-serialized value and the source
  // string differ by normalization like <br/> → <br>, so comparing against
  // sourceInner to delete is not an option either — trust the pristine verdict.
  if (pristine) return prev;
  return new Map(prev).set(block.id, html);
}

/** <title> is not rendered in the preview, so clicks cannot reach it. Edited in a separate field (spec §2.1) */
export function titleBlock(blocks: readonly Block[]): Block | undefined {
  return blocks.find((b) => b.rcdata);
}

/**
 * The block content a revert sends to the preview (ADR-011).
 *
 * Sending the original fragment (`sourceInner`) as-is undoes the preview's asset
 * swap: the reverted block's references resolve against the app origin and its
 * images break — swap through the boundary before sending.
 */
function previewInner(s: Pick<EditorState, 'boundary'>, block: Block | undefined): string {
  if (!block) return '';
  return s.boundary?.toPreview(block.sourceInner, block.innerStart) ?? block.sourceInner;
}

/**
 * While no new document-changing work may start — a save or a replacement is
 * running (ADR-010).
 *
 * Open, the document picker, folder linking and the save button all read this
 * one value. If each screen combined the two indicators itself, some screen
 * would subscribe to only one, and the gaps between scattered indicators would
 * come back.
 */
export function useEditorBusy(): boolean {
  const saving = useEditor((s) => s.saving);
  const replacing = useReplacement((s) => s.replacing);
  return saving || replacing;
}

/**
 * A confirmed replacement — locks the screen, builds the new state, and installs
 * it if still the newest. Who wins and what is locked is decided by the
 * reservation (replacement.ts) (ADR-010).
 *
 * The previous blob URLs are released just before install — never released, the
 * tab grows heavier with every file opened; released earlier, a failed build
 * leaves the screen that must stay alive using those blobs.
 *
 * If a newer reservation arrived during the build, it does not install and
 * retreats with `null`. The assets in the current state then belong to the
 * document being viewed (or the one the newer flow will put up), and there is no
 * right to release them — release **only what this flow made** (spec §5 ·
 * replacement reservation).
 *
 * Install also lowers the saving indicator — from this moment a still-writing
 * save belongs to the previous document (claim) and loses the right to lower its
 * own indicator. The new document is not saving.
 */
async function replace(
  get: () => EditorState,
  set: (next: Partial<EditorState>) => void,
  mine: Replacement,
  loading: Promise<Partial<EditorState>>
): Promise<Partial<EditorState> | null> {
  mine.engage();
  const next = await loading;
  if (!mine.current()) {
    next.assets?.dispose();
    return null;
  }
  get().assets.dispose();
  // Bump the install generation — from this moment, async results owed to the
  // previous document (a save that finishes late, etc.) fail the claim check and
  // are discarded (spec §5).
  mine.install();
  set({ ...next, saving: false, pendingText: null });
  return next;
}

function candidatesOf(files: ReadonlyMap<string, Blob>): string[] {
  return documentCandidates(files.keys());
}

/**
 * **Re-reads the file from disk** before redrawing the preview.
 *
 * Even after saving, `source` is still the string from open time (INV-1).
 * Redrawing from it makes already-saved edits vanish from the screen, and a later
 * save overwrites the disk with the old content — **what was saved is gone.**
 * With a handle, re-read from the current file to stay aligned.
 */
async function reread(file: OpenedFile): Promise<OpenedFile> {
  if (!file.handle) return file;
  // Failures are not swallowed (Principle 3). Continuing with the held bytes, a
  // bundle would open its empty placeholder and the document would be a blank
  // screen, and folder linking would redraw from the old original only to
  // overwrite the disk's new content with it at the next save.
  // Thrown, the caller's catch turns the reason into a notice and the screen
  // being viewed stays as it was.
  return { ...file, text: await readText(await file.handle.getFile()) };
}

/**
 * Rebases a bundle document path onto the newly picked folder.
 *
 * The old path is relative to the old bundle's root and may not exist in the new
 * folder as-is. But keeping only the name would drop `slides/` wholesale when
 * `deck/slides/index.html` is linked to the `deck` folder, losing every asset
 * next to the document (`slides/`). Strip one segment at a time from the front
 * and find the longest tail that actually exists in the new folder.
 */
function rebasePath(
  path: string | undefined,
  files: ReadonlyMap<string, Blob>
): string | undefined {
  if (!path || files.has(path)) return path;
  const parts = path.split('/');
  for (let from = 1; from < parts.length; from++) {
    const tail = parts.slice(from).join('/');
    if (files.has(tail)) return tail;
  }
  // Found nowhere, keep just the name and resolve from the root — assets not found are simply counted as missing.
  return parts[parts.length - 1];
}

/** Shows the raw error text when there is one; otherwise just the short sentence */
function openFailedNotice(e: unknown): Notice {
  if (e instanceof BundleEmptyError) return { key: 'notice.bundleNoDocument' };
  // Opening a non-UTF-8 document would corrupt the original at save time — say why it will not open (spec §1 · Principle 3).
  if (e instanceof NotUtf8Error) return { key: 'notice.notUtf8' };
  // zip errors are ours and arrive as codes — the sentence comes from the language
  // pack (spec §1 · INV-6). Attaching raw text is reserved for untranslatable
  // browser errors.
  if (e instanceof ZipError) {
    return { key: 'notice.openFailedDetail', params: { detail: zipNotice(e.code, e.params) } };
  }
  return e instanceof Error && e.message
    ? { key: 'notice.openFailedDetail', params: { detail: e.message } }
    : { key: 'notice.openFailed' };
}

/** The preview document token — it only has to differ per document within a session. A serial is enough */
let previewSerial = 0;

/**
 * parse5 and the preview assembler are first needed **when a file is opened**.
 * The initial screen is just a drop zone, so there is no reason to ship the
 * parser with it — hence the dynamic imports here (code splitting).
 */
async function load(
  file: OpenedFile,
  files?: ReadonlyMap<string, Blob>,
  handles?: ReadonlyMap<string, OpenedFile['handle']>,
  /**
   * Is this file **the very file** at that bundle path. Folder linking's path
   * recovery (rebasePath) is an unproven guess, so without proof of being the
   * same file this comes in false — the path is then used only as the base for
   * finding assets (docDir), never adopted as the bundle path (docPath). Adopted,
   * a save would swap that path's bundle content for this document's output,
   * switching out a **different** document in the folder, and the way to open
   * that document from the list would be blocked as "already open" (spec §5.1).
   */
  member = true
): Promise<Partial<EditorState>> {
  const [
    { parseBlocks },
    { buildPreviewDocument },
    { assetBoundary, assetSwaps, documentBaseDir, parseAssetRefs, styleTexts },
    { cssAssetPaths },
    { buildAssets },
  ] = await Promise.all([
    import('@/core/parse'),
    import('@/lib/preview'),
    import('@/core/assets'),
    import('@/core/css'),
    import('@/lib/assets'),
  ]);
  const docPath = member ? (file.path ?? '') : '';
  const docDir = dirOf(file.path ?? file.name);
  const blocks = parseBlocks(file.text);
  // If the document moved its base with <base href>, relative references resolve
  // from there, not from the document's place (spec §5.1). Pointing outside
  // (null), relative references are not local files — nothing to attach, nothing
  // to count missing — and the preview shows the document as-is.
  const baseDir = documentBaseDir(file.text, docDir);
  const refs = baseDir === null ? [] : parseAssetRefs(file.text, baseDir);
  // Gathered in one place: attributes, inline <style>, and what attached stylesheets reference.
  const inStyle =
    baseDir === null ? [] : styleTexts(file.text).flatMap((css) => cssAssetPaths(css, baseDir));
  const assets =
    files && baseDir !== null
      ? await buildAssets(files, [...refs.map((r) => r.path), ...inStyle])
      : EMPTY_BUNDLE;
  const assetPaths = [...new Set([...refs.map((r) => r.path), ...inStyle, ...assets.missing])];
  // The preview document and the two-way boundary use **the same swap list**
  // (ADR-011) — computed separately, the outgoing notation and the restored
  // notation would form mismatched pairs. With base pointing outside there is
  // nothing to swap — even url() inside <style> is base-relative, and swapping
  // relative to the document's place would attach the wrong assets.
  const swaps =
    baseDir === null ? [] : assetSwaps(file.text, refs, baseDir, (p) => assets.urls.get(p));
  // The token that screens out old-preview messages arriving after a switch — differs per document (spec §5).
  const previewToken = `doc-${++previewSerial}`;

  return {
    file,
    source: file.text,
    savedText: file.text,
    blocks,
    assetRefs: refs,
    assetPaths,
    assets,
    docDir,
    docPath,
    bundle: files ?? null,
    candidates: files ? candidatesOf(files) : [],
    bundleHandles: handles ?? new Map(),
    boundary: swaps.length > 0 ? assetBoundary(swaps) : null,
    previewToken,
    previewDoc: buildPreviewDocument(file.text, blocks, swaps, previewToken),
    patches: new Map(),
    savedPatches: new Map(),
    selectedId: null,
    blockedId: null,
    revertQueue: [],
    revealId: null,
    editOrder: [],
    scanned: false,
    unsaved: false,
    notice: null,
  };
}

/**
 * If the picked file is a zip, unpacks it and opens the document inside (spec §5.1).
 *
 * HTML inside a zip has no handle — unpacked, it is still just bytes in memory
 * with nowhere to write back. So saving goes to download-a-copy.
 */
async function openPicked(picked: Picked): Promise<Partial<EditorState>> {
  if (/\.zip$/i.test(picked.name)) {
    const { unzip } = await import('@/lib/zip');
    return openBundle(await unzip(picked.blob));
  }

  const file: OpenedFile = {
    name: picked.name,
    // Read from bytes — Blob.text() strips a leading BOM (spec §1 · Principle 1).
    text: await readText(picked.blob),
    handle: picked.handle,
  };
  return load(file);
}

/**
 * Opens one document out of many files received at once (folder or zip) (spec §5.1).
 *
 * A document arriving in a bundle has no handle — nowhere to write back, so
 * saving goes to download-a-copy.
 */
async function openBundle(
  files: ReadonlyMap<string, Blob>,
  want?: string,
  handles?: ReadonlyMap<string, OpenedFile['handle']>
): Promise<Partial<EditorState>> {
  const candidates = candidatesOf(files);
  const path = want && candidates.includes(want) ? want : candidates[0];
  const entry = path ? files.get(path) : undefined;
  if (!path || !entry) throw new BundleEmptyError();

  // Handles come only from folders picked through the open dialog. Without one, saving goes to download-a-copy.
  const handle = handles?.get(path) ?? null;
  // What the bundle holds are the bytes **from open time**. Coming back after a
  // save and a switch away would re-read those old bytes, erasing the saved
  // content from the screen and later overwriting it.
  const fresh = await reread({ name: '', text: '', handle });

  const next = await load(
    {
      name: path.split('/').pop() ?? path,
      // Read from bytes — Blob.text() strips a leading BOM (spec §1 · Principle 1).
      text: handle ? fresh.text : await readText(entry),
      handle,
      path,
    },
    files,
    handles
  );
  // With several candidates, say which one was opened. Picking silently makes the rest not exist.
  return candidates.length > 1 && !want
    ? {
        ...next,
        notice: { key: 'notice.bundlePicked', params: { path, count: candidates.length } },
      }
    : next;
}

/** The bundle opened but holds no document — a different situation from a failed open, so different wording */
class BundleEmptyError extends Error {}

/** The marker for a failed folder scan — distinct from null (not a folder) so it never leaks into opening as a file */
const scanFailed = Symbol('scan-failed');

/** The marker for a failed read of an OS-handed file — the failure was already reported where it was created */
const readFailed = Symbol('read-failed');

/**
 * When no document was found in a folder — if the scan was truncated, that
 * circumstance is told too (spec §5.1). Saying only "no document" could be a lie —
 * the document may have been beyond the limit.
 */
function folderFailedNotice(e: unknown, read: FolderRead | null): Notice {
  if (e instanceof BundleEmptyError && read?.truncated) {
    return { key: 'notice.bundleNoDocumentTruncated', params: { count: read.files.size } };
  }
  return openFailedNotice(e);
}

/**
 * The no-document state.
 *
 * The initial screen and the screen **after closing** must be identical, so it is
 * built in one place. Kept as two copies, each new state field would get added to
 * only one, and something of the previous document would survive a close.
 */
function emptyDocument(): Partial<EditorState> {
  return {
    file: null,
    source: '',
    blocks: [],
    previewDoc: '',
    previewToken: '',
    patches: new Map(),
    selectedId: null,
    blockedId: null,
    revertQueue: [],
    revealId: null,
    editOrder: [],
    scanned: false,
    unsaved: false,
    savedText: '',
    savedPatches: new Map(),
    assetRefs: [],
    assetPaths: [],
    assets: EMPTY_BUNDLE,
    boundary: null,
    docDir: '',
    docPath: '',
    bundle: null,
    candidates: [],
    bundleHandles: new Map(),
  };
}

export const useEditor = create<EditorState>((set, get) => ({
  ...(emptyDocument() as EditorState),
  saving: false,
  pendingText: null,
  notice: null,

  openFile: async () => {
    set({ notice: null });
    // Reserve at the moment of the user action — before waiting on the dialog, the question, the save (spec §5).
    const mine = reserveReplacement();
    try {
      // Open the dialog **first**. Opened after waiting on a save, the user gesture
      // has expired and the browser refuses the dialog (the File System Access API
      // demands a gesture). Newer flows (drop, OS launch) can start while it is
      // open — if displaced by the time guarded returns, it retreats with
      // Superseded and never asks while displaced (spec §5).
      const picked = await mine.guarded(pickFile());
      if (!picked) return;
      // No lock while asking. Locked, the dialog's "save and continue" could not
      // be pressed, leaving discard and cancel as the only choices.
      if (!(await keepEdits({ key: 'confirm.whyOpen' }, mine))) return;
      await replace(get, set, mine, openPicked(picked));
    } catch (e) {
      // Raw text a browser threw is attached untranslated (spec §1 · UI language).
      // A displaced flow's failure would be words about someone else's (the newest
      // flow's) screen — do not notify.
      if (mine.current()) set({ notice: openFailedNotice(e) });
    } finally {
      mine.release();
    }
  },

  // Receives a file the OS opened (PWA file_handlers).
  // load fetches the parser chunk, so this can fail too — wrapped so it never freezes silently (ADR-008).
  adopt: async (file) => {
    // Reserve the moment the OS hands the file over — before waiting on the read,
    // the question, the save (spec §5). Reserved after the read, this flow would
    // displace a newer flow the user opened during it, silently discarding the
    // user's last choice.
    const mine = reserveReplacement();
    // Read failures are caught right where the promise is made — after a cancelled
    // question nobody awaits this promise, so catching after the answer would let
    // the failure vanish without a notice (unhandled rejection). A displaced
    // flow's failure is not notified — it would be words about someone else's
    // (the newest flow's) screen (spec §5 · replacement reservation).
    const reading: Promise<OpenedFile | typeof readFailed> = Promise.resolve(file).catch(
      (e: unknown) => {
        if (mine.current()) get().failedToOpen(e);
        return readFailed;
      }
    );
    try {
      // Even handed over by the OS, this is opening another file. A different way
      // in is no reason to silently discard what was being edited (spec §4 ·
      // unsaved edits).
      if (!(await keepEdits({ key: 'confirm.whyOpen' }, mine))) return;
      // Lock from the moment of the answer — edits made while waiting for the read
      // to finish also have nowhere to go once the new state installs (spec §4 ·
      // no edits accepted during a replacement).
      mine.engage();
      // Displaced while waiting on the read, guarded retreats with Superseded —
      // install and notices alike belong to the other (newest) flow (spec §5).
      const opened = await mine.guarded(reading);
      // A failed read was already reported above. Reporting here would show it twice.
      if (opened === readFailed) return;
      set({ notice: null });
      await replace(get, set, mine, load(opened));
    } catch (e) {
      if (mine.current()) set({ notice: openFailedNotice(e) });
    } finally {
      mine.release();
    }
  },

  openDropped: async (file, folder) => {
    // Reserve at the moment of the drop — before waiting on the scan, the question, the save (spec §5 · replacement reservation).
    const mine = reserveReplacement();
    set({ notice: null });
    // Scan failures are caught right where the promise is made — after a cancelled
    // question nobody awaits this promise, so catching after the answer would let
    // the failure vanish without a notice (unhandled rejection). Even after a
    // cancel, the scan failure is reported (Principle 3 · spec §5.1). But a
    // displaced drop's failure is not — "could not open" would appear over a
    // document the other (newest) flow put up perfectly well (spec §5 ·
    // replacement reservation). Cancelling creates no new reservation, so the
    // notice for the cancelled case stays alive.
    const scanned: Promise<FolderRead | null | typeof scanFailed> = folder.catch((e: unknown) => {
      if (mine.current()) get().failedToOpen(e);
      return scanFailed;
    });
    try {
      // Opening a new file loses the current edits. They are not discarded silently.
      if (!(await keepEdits({ key: 'confirm.whyOpen' }, mine))) return;
      // Lock from the moment of the answer — edits made while waiting for the scan
      // to finish also have nowhere to go once the new state installs (spec §4 ·
      // no edits accepted during a replacement).
      mine.engage();
      // Displaced while waiting on the scan, guarded retreats with Superseded —
      // install and notices alike belong to the other (newest) flow (spec §5).
      const read = await mine.guarded(scanned);
      // A failed scan was already reported above. It does not fall through to
      // opening as a file — what was dropped may have been a folder, and opening a
      // folder as a document piles error upon error.
      if (read === scanFailed) return;
      // The store decides whether a folder was dropped. If not, it opens as a
      // file. The same reservation is passed along — reserving anew would have
      // this flow displace itself, and the gap in between must be closed by the
      // reservation, not by a comment (ADR-010).
      if (!(await get().loadFolder(read, mine)) && file) await get().loadDropped(file, mine);
    } catch (e) {
      // A displaced flow's marker means a quiet retreat (spec §5) — uncaught here
      // it leaks past the entry point (unhandled rejection). Other failures flow to
      // the caller as before.
      if (!(e instanceof Superseded)) throw e;
    } finally {
      mine.release();
    }
  },

  // A dropped folder opens the document inside it. The legacy drop API grants no
  // write permission, so saving goes to download-a-copy — plenty for attaching
  // assets to look at.
  loadFolder: async (read, within) => {
    if (!read) return false;
    const mine = within ?? reserveReplacement();
    set({ notice: null });
    try {
      const next = await replace(get, set, mine, openBundle(read.files, undefined, read.handles));
      // A retreated flow's afterword (the truncation notice) would be about a screen someone else put up — only the installer speaks.
      if (next && read.truncated) {
        set({ notice: { key: 'notice.folderTruncated', params: { count: read.files.size } } });
      }
      return true;
    } catch (e) {
      if (mine.current()) set({ notice: folderFailedNotice(e, read) });
      return true;
    } finally {
      mine.release();
    }
  },

  loadDropped: async (file, within) => {
    const mine = within ?? reserveReplacement();
    set({ notice: null });
    try {
      await replace(get, set, mine, openPicked(droppedFile(file)));
    } catch (e) {
      // Swallowing a parse failure makes dropping a file look like nothing happened.
      if (mine.current()) set({ notice: openFailedNotice(e) });
    } finally {
      mine.release();
    }
  },

  // Cross-checks render result against source and locks script-generated blocks (ADR-005).
  onReady: (live) => {
    // Passed on with duplicates intact, not distilled into a Map — two markers
    // with the same id mean the document mimicked our markers, and that verdict
    // (MARKER_CLASH) belongs to core (spec §3).
    const blocks = applyLiveLocks(get().blocks, live);
    // Leaving patches on late-locked blocks would have applyPatches reject the
    // whole list at save time, killing healthy edits along with them (INV-5).
    const lockedIds = new Set(blocks.filter((b) => b.locked !== null).map((b) => b.id));
    const dropped = [...get().patches.keys()].filter((id) => lockedIds.has(id));
    const patches = new Map([...get().patches].filter(([id]) => !lockedIds.has(id)));
    const editOrder = get().editOrder.filter((id) => patches.has(id));
    // On the normal path there are no patches to delete — editing does not open
    // before the cross-check (spec §4). If deletion is needed anyway, it is not
    // silent: the preview is also reverted to the source content to realign screen
    // and saved file, and the revert is announced (Principle 3).
    const revertQueue = [
      ...get().revertQueue,
      ...dropped.map((id) => ({
        id,
        html: previewInner(
          get(),
          blocks.find((b) => b.id === id)
        ),
      })),
    ];
    if (dropped.length > 0) {
      useToasts
        .getState()
        .show({ key: 'app.editsReverted', params: { count: dropped.length } }, 'locked');
    }
    // With patches dropped, the output may have changed too — there is always exactly one criterion (spec §5).
    set({
      blocks,
      patches,
      editOrder,
      revertQueue,
      scanned: true,
      unsaved: differsFromDisk({ ...get(), blocks, patches }),
    });
  },

  onEdit: (id, html, pristine = false) => {
    // Edits during a replacement have nowhere to go the moment the new state
    // installs (spec §4). Title field and preview are locked meanwhile, so what
    // arrives here is only the commit (blur, IME finishing) of a block that was
    // already open. Different from saving — those edits survive.
    if (refuseWhileReplacing('app.editWhileReplacing')) return;
    const block = get().blocks.find((b) => b.id === id);
    if (!block || block.locked !== null) return;
    // Content returning from the preview passes the boundary back to the original
    // notation (ADR-011 · INV-9) — with swapped assets inside the block, the
    // innerHTML carries blob URLs, and patched as-is the file would hold addresses
    // that die the moment the tab closes. The title (rcdata) comes from the host
    // input field, but the boundary touches only its own blob notation, so passing
    // it through leaves it untouched. The block range goes along too — references
    // spelling the same file differently return to their own notation per spot
    // instead of collapsing into one (spec §5.1 · Principle 2).
    const restored = get().boundary?.fromPreview(html, block.innerStart, block.innerEnd) ?? html;
    const before = get().patches;
    const patches = nextPatches(before, block, restored, pristine);
    // Clicking in and leaving is a non-event — patches, edit order and unsaved
    // all stay put. Touching anything here would make "in and out" a state change.
    if (patches === before) return;
    // A re-edited block moves to the back — it is the most recent change.
    const editOrder = get().editOrder.filter((x) => x !== id);
    if (patches.has(id)) editOrder.push(id);
    // Edited and then back to the file's content, there is nothing to save.
    // Only comparing output against file reads this correctly (spec §5).
    set({ patches, editOrder, unsaved: differsFromDisk({ ...get(), patches }) });
  },

  // The replacement lock is lowered by the reservation's release — lowered here,
  // someone else would be unlocking an overlapping replacement (spec §5).
  // Failures arriving here (a dropped folder's scan, etc.) predate the lock, so
  // there is nothing to switch off.
  failedToOpen: (e) => set({ notice: openFailedNotice(e) }),

  // Clicking a locked block tells the reason (Principle 3). It appears on every
  // click, so it is shown here — if the screen watched blockedId changes, a
  // second click on the same block would do nothing.
  onBlocked: (id) => {
    const block = get().blocks.find((b) => b.id === id);
    if (block?.locked) {
      useToasts
        .getState()
        .show({ key: 'app.blocked', params: { reason: lockNotice(block.locked) } }, 'locked');
    }
    set({ blockedId: id, selectedId: null });
  },
  select: (id) => set({ selectedId: id, blockedId: null }),

  // A click before the cross-check finished — the preview did not open editing. Say why it will not open (Principle 3).
  onNotReady: () => {
    useToasts.getState().show({ key: 'app.editBeforeScan' }, 'locked');
  },

  // Deleting only the patch leaves the edited content in the preview. Clicking
  // into that block and out revives the patch, and preview and saved file diverge
  // for good.
  revert: (id) => {
    // A revert during a replacement edits the previous document — the changed
    // patches and the revert bound for the preview alike have nowhere to go at
    // install. The button is locked, but the shortcut (Ctrl+Z) can fire any time
    // (spec §4).
    if (refuseWhileReplacing('app.editWhileReplacing')) return;
    const { patches, blocks, revertQueue } = get();
    const next = new Map(patches);
    next.delete(id);
    const block = blocks.find((b) => b.id === id);
    set({
      patches: next,
      editOrder: get().editOrder.filter((x) => x !== id),
      // Source content leaves swapped through the boundary (ADR-011) — sent raw,
      // the preview's blob swap comes undone and the reverted block's images break.
      revertQueue: [...revertQueue, { id, html: previewInner(get(), block) }],
      // A revert can also diverge from the file — it may undo already-saved
      // content. Conversely, reverting a never-saved edit matches the file again
      // and there is nothing to lose.
      unsaved: differsFromDisk({ ...get(), patches: next }),
    });
  },

  revertAll: () => {
    // Same reason as revert — never edit the previous document during a replacement (spec §4).
    if (refuseWhileReplacing('app.editWhileReplacing')) return;
    const { patches, blocks, revertQueue } = get();
    const restored = [...patches.keys()].map((id) => ({
      id,
      // Same reason as revert — source content bound for the preview is swapped through the boundary (ADR-011).
      html: previewInner(
        get(),
        blocks.find((b) => b.id === id)
      ),
    }));
    set({
      patches: new Map(),
      editOrder: [],
      revertQueue: [...revertQueue, ...restored],
      // The output with everything reverted is the pristine original — if the file is too, there is nothing to lose.
      unsaved: differsFromDisk({ ...get(), patches: new Map() }),
    });
  },

  // Ctrl+Z outside an active edit. During one, the browser's native undo is in charge (spec §4).
  undoLast: () => {
    const { editOrder, revert } = get();
    const last = editOrder[editOrder.length - 1];
    if (last !== undefined) revert(last);
  },

  drainReverts: () => set({ revertQueue: [] }),

  // Points out the chosen block on screen too. The list alone hardly says where in the document it was.
  reveal: (id) => set({ revealId: id, selectedId: id, blockedId: null }),
  drainReveal: () => set({ revealId: null }),

  // The original is untouched; only the output goes out as a file (spec §4 ·
  // download a copy). Works with zero patches too — also used to take a backup
  // before editing.
  downloadCopy: () => {
    const { file, source, blocks, patches } = get();
    if (!file) return;
    try {
      const list = [...patches].map(([id, newInnerHtml]) => ({ id, newInnerHtml }));
      downloadFile(file.name, applyPatches(source, blocks, list));
      set({
        notice: { key: 'notice.copyDownloaded', params: { name: file.name, count: list.length } },
      });
    } catch (e) {
      set({
        notice:
          e instanceof PatchError
            ? { key: 'notice.saveRejected', params: { detail: patchNotice(e.code, e.params) } }
            : { key: 'notice.saveFailed' },
      });
    }
  },

  /**
   * Picks a folder and opens the document inside (spec §5.1).
   *
   * Edit permission is requested along with it. Keeping the rule that what was
   * opened via the dialog gets overwritten requires writable handles, and those
   * come only from the dialog. If the user refuses to allow editing, the browser
   * returns a cancel and nothing happens.
   */
  openFolder: async () => {
    if (!canPickFolder()) {
      set({ notice: { key: 'notice.folderUnsupported' } });
      return;
    }
    set({ notice: null });
    // Reserve at the moment of the user action — before waiting on the dialog,
    // the scan, the question (spec §5).
    const mine = reserveReplacement();
    // The catch must also see whether the scan was truncated — the document may
    // have been beyond the limit.
    let read: FolderRead | null = null;
    try {
      // The dialog comes first, for the same reason as opening a file. Displaced
      // while it was open, guarded retreats with Superseded and never asks while
      // displaced (spec §5).
      read = await mine.guarded(pickFolder(null, 'readwrite'));
      if (!read) return;
      if (!(await keepEdits({ key: 'confirm.whyOpen' }, mine))) return;
      const next = await replace(get, set, mine, openBundle(read.files, undefined, read.handles));
      if (next && read.truncated) {
        set({ notice: { key: 'notice.folderTruncated', params: { count: read.files.size } } });
      }
    } catch (e) {
      if (mine.current()) set({ notice: folderFailedNotice(e, read) });
    } finally {
      mine.release();
    }
  },

  /**
   * Opens a folder to attach external assets (spec §5.1).
   *
   * The file handle is left alone, so **overwrite-save keeps working.** The
   * folder is taken read-only. The preview is redrawn, so the edit state is lost —
   * whether that is acceptable is asked by the caller first.
   */
  linkFolder: async () => {
    const { file } = get();
    if (!file) return;
    if (!canPickFolder()) {
      set({ notice: { key: 'notice.folderUnsupported' } });
      return;
    }

    set({ notice: null });
    // Reserve at the moment of the user action — before waiting on the dialog,
    // the scan, the question (spec §5).
    const mine = reserveReplacement();
    try {
      // The dialog opens where the file lived — usually that folder is the answer.
      // Displaced while it was open, guarded retreats with Superseded and never
      // asks while displaced (spec §5).
      const read = await mine.guarded(pickFolder(file.handle));
      if (!read) return;
      if (!(await keepEdits({ key: 'confirm.whyAssets' }, mine))) return;

      const loading = async (): Promise<Partial<EditorState>> => {
        // If the current document came from a bundle, its path is relative to the
        // old bundle. It must be rebased onto the newly picked folder — otherwise
        // assets go unfound even though the user picked the right folder. A
        // document opened as a single file has no bundle path at all — then the
        // name is the path (exactly OpenedFile.path's rule). Left pathless, keep
        // below would be empty and the handle would be lost on a round trip to
        // another document.
        const fresh = await reread(get().file ?? file);
        const rebased = { ...fresh, path: rebasePath(fresh.path ?? fresh.name, read.files) };
        // Handles received through linking are not kept in the bundle. This road is
        // read-only (read), so saving through such a handle is refused — kept as a
        // bundle handle, it would land in file.handle on a document switch and a
        // save that claimed to be "overwrite" would fail only then.
        // Only the current document's handle is kept — it is the writable handle
        // from open time; dropped, a round trip to another document silently
        // demotes overwrite to download-a-copy, and the old bytes read at link
        // time overwrite whatever was saved in between (spec §5.1 · keeping the
        // handle). But keep it **only when the same file is proven.** Overlapping
        // paths do not make the same file — the spot picked by the basename
        // fallback (rebasePath) may be someone else's file that merely shares the
        // name, and hanging this write handle on that path makes this file open
        // there on the round trip, with saves overwriting someone else's spot.
        // Without proof, not keeping it is the better side (Principle 3).
        const twin = rebased.path ? read.handles.get(rebased.path) : undefined;
        const proven =
          rebased.handle && twin ? ((await rebased.handle.isSameEntry?.(twin)) ?? false) : false;
        const keep =
          proven && rebased.path && rebased.handle
            ? new Map([[rebased.path, rebased.handle]])
            : undefined;
        // An unproven document is not a member of the bundle either — the recovered
        // spot is used only as the base for finding assets. Adopted as the bundle
        // path, a save would swap that path's bundle content for this document's
        // output, switching out a **different** document in the folder (spec §5.1).
        return load(rebased, read.files, keep, proven);
      };
      const next = await replace(get, set, mine, loading());
      if (next) {
        const attached = countAssets(get()).linked;
        set({
          notice: read.truncated
            ? { key: 'notice.folderTruncated', params: { count: read.files.size } }
            : attached > 0
              ? { key: 'notice.assetsLinked', params: { count: attached } }
              : { key: 'notice.assetsNotFound' },
        });
      }
    } catch (e) {
      if (mine.current()) set({ notice: openFailedNotice(e) });
    } finally {
      mine.release();
    }
  },

  /**
   * Closes the open document and returns to the initial screen.
   *
   * It **changes** the document, so it walks the same road as opening — reserve
   * at the moment of the user action, ask about unsaved edits, release the assets
   * (spec §5). Made an exception, closing would silently lose edits on the spot
   * and leave blobs behind.
   */
  closeFile: async () => {
    if (!get().file) return;

    set({ notice: null });
    const mine = reserveReplacement();
    try {
      if (!(await keepEdits({ key: 'confirm.whyClose' }, mine))) return;
      await replace(get, set, mine, Promise.resolve(emptyDocument()));
    } catch (e) {
      if (mine.current()) set({ notice: openFailedNotice(e) });
    } finally {
      mine.release();
    }
  },

  /**
   * Switches to another document in the same bundle (spec §5.1).
   *
   * Uses the already-unpacked files — re-unpacking the zip is wasted work.
   * The preview is redrawn, so edits are lost. Whether that is acceptable is
   * asked by the caller first.
   */
  openFromBundle: async (path) => {
    const { bundle, docPath } = get();
    if (!bundle || path === docPath) return;

    set({ notice: null });
    // Reserve at the moment of the user action — before waiting on the question, the save (spec §5).
    const mine = reserveReplacement();
    try {
      if (!(await keepEdits({ key: 'confirm.whySwitch', params: { path } }, mine))) return;
      // Answered with save, the bundle was just swapped for that output (for a
      // download save the bundle is the only source of truth, spec §5). Using the
      // bundle captured before the stop would have the install revive the
      // pre-save bytes, and the saved content would silently vanish on return.
      const fresh = get().bundle;
      if (!fresh) return;
      await replace(get, set, mine, openBundle(fresh, path, get().bundleHandles));
    } catch (e) {
      if (mine.current()) set({ notice: openFailedNotice(e) });
    } finally {
      mine.release();
    }
  },

  save: async () => {
    const { file, source, blocks, patches, unsaved, saving } = get();
    // With nothing differing from the file, do nothing. The button is already
    // disabled, but the shortcut can fire any time, so the wasted rewrite of
    // identical content is blocked here.
    //
    // Filtering by patch count is wrong (spec §5). Reverting an already-saved edit
    // leaves zero patches while the file still holds the old edit — returning
    // false here would stall "save and continue" with nothing to write, leaving
    // cancel and discard as the only ways out of the dialog. A zero-patch save
    // rewrites the pristine original, making the file match the screen.
    //
    // No save starts while a save is writing the file (spec §5). An edit made
    // during the write raises unsaved again and Ctrl+S gets this far, but run on
    // top of each other, two saves write different snapshots side by side and the
    // old output wins on disk depending on finish order. Nothing is lost — when
    // the running save ends, that edit remains unsaved.
    if (!file || !unsaved || saving) return false;
    // The document can be switched while writing. So a late-arriving result never
    // writes the old output into the new document's state, take the current
    // document's generation before starting (spec §5).
    const mine = claimDocument();
    set({ saving: true, notice: null });
    try {
      const list = [...patches].map(([id, newInnerHtml]) => ({ id, newInnerHtml }));
      const output = applyPatches(source, blocks, list);
      // From here the file heads toward this output — it is the baseline for
      // "does it differ from the file" while edits and reverts happen mid-write
      // (spec §5). Measured against the old savedText, an edit reverted during
      // the write reads as nothing-to-lose and the tab closes without warning.
      set({ pendingText: output });
      const how = await saveFile(file, output);
      // A result arriving after a switch belongs to the previous document. The
      // file was written and that belongs to the file, so nothing is lost — and
      // there is nothing to write into the new document.
      if (!mine()) return false;
      set((s) => ({
        // The file now holds the output just written. The preview stays editable
        // during the write, so the current state is compared against that output
        // again — edits committed in between are not in the file and stay dirty,
        // and with nothing in between it comes out clean.
        savedText: output,
        // The patches that went into the output just written — the question's
        // "{count} spots" counts the difference between these and the current
        // patches (spec §4). Edits committed during the write are not here, so
        // they remain as differing spots.
        savedPatches: new Map(patches),
        // For a handleless document the downloaded copy is what the file holds
        // (spec §5). With the in-memory text left old, folder linking would take
        // that old content straight from reread and fall back to the pre-save
        // screen — with a handle it re-reads from disk to stay aligned.
        file: s.file && !s.file.handle ? { ...s.file, text: output } : s.file,
        // For a bundle document, the bundle's bytes are swapped for the output
        // too. Left as the open-time bytes, a round trip to another document
        // reopens those old bytes and the edits saved via download silently vanish
        // from the screen — with a handle, reread realigns from disk, but for a
        // download save this bundle is the only source of truth.
        bundle: s.bundle?.has(s.docPath)
          ? new Map(s.bundle).set(s.docPath, new Blob([output], { type: 'text/html' }))
          : s.bundle,
        // The write finished — the baseline is now savedText (the output just written) itself.
        pendingText: null,
        unsaved: differsFromDisk({ ...s, savedText: output, pendingText: null }),
        notice: {
          key: how === 'overwritten' ? 'notice.saved' : 'notice.downloaded',
          params: { name: file.name, count: list.length },
        },
      }));
      return true;
    } catch (e) {
      // A failure belonging to the previous document is not notified either — a
      // failure notice without even a file name reads as the current document's,
      // sending the user hunting around a perfectly fine new document.
      if (mine()) {
        set((s) => ({
          // The write failed — the file still holds the old content (writes
          // finalize on close). unsaved, measured against the output during the
          // write, is re-measured against the old baseline. Otherwise an edit made
          // during the write would pose as saved just for matching the failed output.
          pendingText: null,
          unsaved: differsFromDisk({ ...s, pendingText: null }),
          notice:
            e instanceof PatchError
              ? { key: 'notice.saveRejected', params: { detail: patchNotice(e.code, e.params) } }
              : { key: 'notice.saveFailed' },
        }));
      }
      return false;
    } finally {
      // Saving lowers **only its own indicator (saving)**. The replacement lock
      // (replacing) is held by the reservation, so an earlier save finishing while
      // a new replacement runs does not unlock the screen (spec §5 · replacement
      // reservation). Arriving after a switch (not mine), this saving belongs to
      // the previous document too — the install already lowered it, so leave it be.
      if (mine()) set({ saving: false });
    }
  },
}));

/** Counts per lock reason — the tally the UI shows for "why these cannot be edited" */
export function lockSummary(blocks: readonly Block[]): { reason: LockReason; count: number }[] {
  const counts = new Map<LockReason, number>();
  for (const b of blocks) {
    if (b.locked === null) continue;
    counts.set(b.locked, (counts.get(b.locked) ?? 0) + 1);
  }
  return [...counts]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}
