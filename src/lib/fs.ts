/**
 * File open/save. Uses the File System Access API, falling back to downloads
 * without it (ADR-006).
 *
 * Overwriting the original file in place requires a handle. Only Chromium-based
 * browsers support it, so elsewhere "save back to the opened file" does not exist.
 */

interface FileHandle {
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
  /** Whether this points at the same file. Used as proof before folder linking keeps a handle (spec §5.1) */
  isSameEntry?(other: FileHandle): Promise<boolean>;
}

/** The minimal shape needed to walk a folder (not in lib.dom yet) */
interface DirectoryHandle {
  readonly name: string;
  entries(): AsyncIterableIterator<[string, FileHandle | DirectoryHandle]>;
}

function isDirectory(handle: FileHandle | DirectoryHandle): handle is DirectoryHandle {
  return 'entries' in handle;
}

interface PickerWindow {
  showOpenFilePicker?: (options: unknown) => Promise<FileHandle[]>;
  showDirectoryPicker?: (options?: unknown) => Promise<DirectoryHandle>;
}

/** File Handling API — arrives when the installed PWA is launched by the OS with a file */
interface LaunchQueue {
  setConsumer(consumer: (params: { files: FileHandle[] }) => void): void;
}

export interface OpenedFile {
  name: string;
  text: string;
  /** null means overwriting is impossible; saving goes through downloads only */
  handle: FileHandle | null;
  /**
   * The path inside the bundle (folder or zip). Relative asset paths resolve from
   * here. Absent when a single file was opened — then the name is the path.
   */
  path?: string;
}

export type SaveResult = 'overwritten' | 'downloaded';

/** A non-UTF-8 document — not opened. The user-facing sentence comes from the language pack (spec §1) */
export class NotUtf8Error extends Error {}

/**
 * Reads document text from bytes (spec §1 · document encoding).
 *
 * `Blob.text()` is not used — its decoding silently strips a leading BOM (EF BB
 * BF), so the first byte of a document the user never touched would vanish from
 * the saved file (Principles 1 and 2). `ignoreBOM` means "do not treat the BOM
 * specially", so U+FEFF stays at the front of the string, and when saving writes
 * that string back as UTF-8 it becomes the same bytes again.
 *
 * Non-UTF-8 input is rejected right here (fatal) — opened with U+FFFD
 * substitutions, mojibake would pose as the document, and saving would write that
 * broken result back, quietly ruining the original (Principle 3).
 */
export async function readText(blob: Blob): Promise<string> {
  const bytes = await blob.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new NotUtf8Error('not valid utf-8');
  }
}

const picker = (): PickerWindow['showOpenFilePicker'] =>
  (window as unknown as PickerWindow).showOpenFilePicker;

export function canOverwrite(): boolean {
  return typeof picker() === 'function';
}

/**
 * The limits on reading one whole folder.
 *
 * The user can pick their home directory by accident. Without limits, the tab
 * freezes. On overflow, the caller is told the read stopped there instead of
 * being cut silently (Principle 3).
 *
 * `visits` caps **entries walked**, not entries kept. Watching only the kept
 * count (files), a folder full of over-limit files would be walked to the end
 * with nothing kept, freezing the tab — entries that are not kept still cost the
 * walk, so traversal gets its own budget (spec §5.1).
 */
export const FOLDER_LIMITS = {
  files: 500,
  bytes: 64 * 1024 * 1024,
  depth: 8,
  visits: 2000,
} as const;

export interface FolderRead {
  files: Map<string, File>;
  /**
   * Handles of files that can be written back.
   *
   * Filled only for folders chosen through the open dialog. A dropped folder
   * comes through the legacy API which grants no write permission, so this stays
   * empty and saving goes to download-a-copy.
   */
  handles: Map<string, FileHandle>;
  /** A limit was hit before everything could be read */
  truncated: boolean;
}

/** Running totals during the walk. Limits must accumulate across recursion, so they live in one place */
interface Walk extends FolderRead {
  bytes: number;
  /** Entries walked — counted whether kept or filtered. The criterion that cuts traversal off */
  visits: number;
}

function emptyWalk(): Walk {
  return { files: new Map(), handles: new Map(), truncated: false, bytes: 0, visits: 0 };
}

/**
 * May the walk continue. If not, records the truncation and cuts the whole
 * traversal off.
 *
 * When the budget runs out inside recursion, return only exits one level — but
 * the parent loop re-runs this check on every entry, so the exhausted budget
 * stops traversal level by level all the way up.
 */
function walkOn(into: Walk): boolean {
  if (into.files.size >= FOLDER_LIMITS.files || into.visits >= FOLDER_LIMITS.visits) {
    into.truncated = true;
    return false;
  }
  into.visits += 1;
  return true;
}

function done(read: Walk): FolderRead {
  return { files: read.files, handles: read.handles, truncated: read.truncated };
}

export function canPickFolder(): boolean {
  return typeof (window as unknown as PickerWindow).showDirectoryPicker === 'function';
}

/**
 * @param depth the current level, with the chosen folder as level 0. Re-deriving
 *   it from the prefix would disagree with the drop side — drop paths carry the
 *   root name, but that name is not depth (spec §5.1)
 */
async function walk(
  dir: DirectoryHandle,
  prefix: string,
  depth: number,
  into: Walk
): Promise<void> {
  for await (const [name, handle] of dir.entries()) {
    // Spend the budget **before** filtering. Filtering still costs the walk, and
    // uncounted skipped entries would let a folder of thousands of hidden entries
    // dodge the limit and never finish (spec §5.1).
    if (!walkOn(into)) return;
    // Hidden folders and dependency piles cannot be assets and only explode the file count.
    if (name.startsWith('.') || name === 'node_modules') continue;

    const path = prefix ? `${prefix}/${name}` : name;
    if (isDirectory(handle)) {
      // Descend as far as the eighth level (depth). Measured with >=, the limit
      // level would be cut off wholesale.
      if (depth + 1 > FOLDER_LIMITS.depth) {
        into.truncated = true;
        continue;
      }
      await walk(handle, path, depth + 1, into);
      continue;
    }
    keep(into, path, await handle.getFile(), handle);
  }
}

/**
 * Keeps the file if it fits the budget.
 *
 * **Size is checked before keeping.** Adding to the total after keeping would let
 * a single file larger than the limit straight in, and the last file could cross
 * the line without anyone knowing.
 */
function keep(into: Walk, path: string, file: File, handle?: FileHandle): void {
  if (into.bytes + file.size > FOLDER_LIMITS.bytes) {
    into.truncated = true;
    return;
  }
  into.bytes += file.size;
  into.files.set(path, file);
  if (handle) into.handles.set(path, handle);
}

/**
 * Opens a folder and reads every file inside. null if the user cancels.
 *
 * Opening one file grants no right to see its siblings (spec §5.1).
 * To attach assets, the user must hand over the folder themselves.
 *
 * @param startIn opens the dialog where this file lived — usually that folder is the answer
 * @param mode with `readwrite` the browser also asks to allow editing, and writable
 *   handles come back in exchange. Going in just to attach assets, leave it at
 *   `read` — never ask for permissions that are not needed
 */
export async function pickFolder(
  startIn?: FileHandle | null,
  mode: 'read' | 'readwrite' = 'read'
): Promise<FolderRead | null> {
  const show = (window as unknown as PickerWindow).showDirectoryPicker;
  if (!show) return null;

  try {
    const dir = await show(startIn ? { mode, startIn } : { mode });
    const read = emptyWalk();
    await walk(dir, '', 0, read);
    return done(read);
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    throw e;
  }
}

/** Reads from a handle. Having the handle means the original can be overwritten later. */
export async function fromHandle(handle: FileHandle): Promise<OpenedFile> {
  const file = await handle.getFile();
  return { name: handle.name, text: await readText(file), handle };
}

/**
 * Receives files the OS opened with this app (file_handlers in the manifest).
 *
 * The handle arrives without a file picker, so overwrite-save just works.
 * Does nothing in environments without support.
 */
export function onFileLaunch(handler: (file: Promise<OpenedFile>) => void): void {
  const queue = (window as unknown as { launchQueue?: LaunchQueue }).launchQueue;
  if (!queue) return;
  queue.setConsumer((params) => {
    const handle = params.files[0];
    // Hands the promise over without awaiting the read — the receiver must take
    // its replacement reservation **before** the read, so a newer flow the user
    // starts during the read is not displaced (spec §5).
    if (handle) handler(fromHandle(handle));
  });
}

/**
 * A picked file — not yet sorted into HTML or zip.
 *
 * Reading the content and deciding what it is belongs to the store. Only the file
 * and its handle are handed over here.
 */
export interface Picked {
  name: string;
  blob: Blob;
  /** null means it cannot be overwritten (drop, zip) */
  handle: FileHandle | null;
}

const ACCEPT = '.html,.htm,.zip';

/** Returns null when the user cancels */
export async function pickFile(): Promise<Picked | null> {
  const show = picker();
  if (!show) return pickViaInput();

  try {
    const [handle] = await show({
      types: [
        {
          description: 'HTML · zip',
          accept: { 'text/html': ['.html', '.htm'], 'application/zip': ['.zip'] },
        },
      ],
      multiple: false,
    });
    if (!handle) return null;
    return { name: handle.name, blob: await handle.getFile(), handle };
  } catch (e) {
    // The user cancelling is not an error.
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    throw e;
  }
}

/** A file from drag-and-drop or <input type=file> — no handle, so it cannot be overwritten */
export function droppedFile(file: File): Picked {
  return { name: file.name, blob: file, handle: null };
}

/**
 * Reads the **folders** among what was dropped. null if there were none (then it
 * is handled as a file).
 *
 * Drops hand folders over only through a legacy API, different from
 * `showDirectoryPicker`. It grants no write permission, so saving goes to
 * download-a-copy — plenty for attaching assets to look at.
 */
export async function readDroppedFolder(items: DataTransferItemList): Promise<FolderRead | null> {
  const roots: FileSystemDirectoryEntry[] = [];
  // items empties once the event ends, so pull everything out now.
  for (const item of items) {
    const entry = item.webkitGetAsEntry?.();
    if (entry?.isDirectory) roots.push(entry as FileSystemDirectoryEntry);
  }
  if (roots.length === 0) return null;

  const read = emptyWalk();
  for (const root of roots) await walkEntry(root, root.name, 0, read);
  return done(read);
}

/** The legacy API is callbacks only. It does not hand everything over at once, so read again until an empty batch */
function readEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

function fileOf(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

/**
 * @param depth the current level, with the dropped folder as level 0 — the same
 *   yardstick as walk above (spec §5.1). The prefix contains the root name, so it
 *   must not be re-derived — the same folder would fit when picked but be cut a
 *   level early when dropped
 */
async function walkEntry(
  dir: FileSystemDirectoryEntry,
  prefix: string,
  depth: number,
  into: Walk
): Promise<void> {
  const reader = dir.createReader();

  for (;;) {
    const batch = await readEntries(reader);
    if (batch.length === 0) return;

    for (const entry of batch) {
      // Budget before filtering — same reason as walk above (spec §5.1).
      if (!walkOn(into)) return;
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

      const path = `${prefix}/${entry.name}`;
      if (entry.isDirectory) {
        // Descend as far as the eighth level (depth). Measured with >=, the limit
        // level would be cut off wholesale.
        if (depth + 1 > FOLDER_LIMITS.depth) {
          into.truncated = true;
          continue;
        }
        await walkEntry(entry as FileSystemDirectoryEntry, path, depth + 1, into);
        continue;
      }
      keep(into, path, await fileOf(entry as FileSystemFileEntry));
    }
  }
}

function pickViaInput(): Promise<Picked | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPT;
    input.onchange = () => {
      const file = input.files?.[0];
      resolve(file ? droppedFile(file) : null);
    };
    // Without handling cancel, the promise never settles and the opening flow cannot end.
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export async function saveFile(file: OpenedFile, text: string): Promise<SaveResult> {
  if (file.handle) {
    const writable = await file.handle.createWritable();
    await writable.write(text);
    await writable.close();
    return 'overwritten';
  }
  downloadFile(file.name, text);
  return 'downloaded';
}

/** Sends the text out as a browser download. It can only write to the downloads folder, leaving the original untouched. */
export function downloadFile(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/html' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  // Not attaching to the document, or revoking immediately, cancels the download in some browsers.
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
