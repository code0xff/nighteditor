/**
 * 파일 열기/저장. File System Access API 를 쓰고, 없으면 내려받기로 폴백한다 (ADR-006).
 *
 * 원본 파일을 그대로 덮어쓰려면 핸들이 필요하다. Chromium 계열만 지원하므로
 * 그 외 브라우저에서는 "열었던 파일에 저장"이 성립하지 않는다.
 */

interface FileHandle {
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}

/** 폴더 안을 훑기 위한 최소한의 모양 (lib.dom 에 아직 없다) */
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

/** File Handling API — 설치된 PWA 가 OS 에서 파일과 함께 실행될 때 넘어온다 */
interface LaunchQueue {
  setConsumer(consumer: (params: { files: FileHandle[] }) => void): void;
}

export interface OpenedFile {
  name: string;
  text: string;
  /** null 이면 덮어쓰기가 불가능해 내려받기로만 저장한다 */
  handle: FileHandle | null;
  /**
   * 묶음(폴더·zip) 안에서의 경로. 자원의 상대 경로를 이 자리 기준으로 푼다.
   * 파일 하나만 열었으면 없다 — 그때는 이름이 곧 경로다.
   */
  path?: string;
}

export type SaveResult = 'overwritten' | 'downloaded';

const picker = (): PickerWindow['showOpenFilePicker'] =>
  (window as unknown as PickerWindow).showOpenFilePicker;

export function canOverwrite(): boolean {
  return typeof picker() === 'function';
}

/**
 * 폴더 하나를 통째로 읽는 데 두는 한도.
 *
 * 사용자가 실수로 홈 디렉터리를 고를 수 있다. 한도가 없으면 탭이 굳는다.
 * 넘치면 조용히 자르지 않고 거기서 멈춘 사실을 부르는 쪽에 알린다 (대원칙 3).
 */
export const FOLDER_LIMITS = { files: 500, bytes: 64 * 1024 * 1024, depth: 8 } as const;

export interface FolderRead {
  files: Map<string, File>;
  /** 한도에 걸려 다 읽지 못했다 */
  truncated: boolean;
}

/** 걸어가는 동안의 누계. 한도를 재귀 사이에서 이어 세려면 한 곳에 모아야 한다 */
interface Walk extends FolderRead {
  bytes: number;
}

export function canPickFolder(): boolean {
  return typeof (window as unknown as PickerWindow).showDirectoryPicker === 'function';
}

async function walk(dir: DirectoryHandle, prefix: string, into: Walk): Promise<void> {
  const depth = prefix ? prefix.split('/').length : 0;

  for await (const [name, handle] of dir.entries()) {
    // 숨김 폴더와 의존성 더미는 자원일 리 없고 파일 수만 폭발시킨다.
    if (name.startsWith('.') || name === 'node_modules') continue;
    if (into.files.size >= FOLDER_LIMITS.files || into.bytes >= FOLDER_LIMITS.bytes) {
      into.truncated = true;
      return;
    }

    const path = prefix ? `${prefix}/${name}` : name;
    if (isDirectory(handle)) {
      if (depth + 1 >= FOLDER_LIMITS.depth) {
        into.truncated = true;
        continue;
      }
      await walk(handle, path, into);
      continue;
    }
    const file = await handle.getFile();
    into.bytes += file.size;
    into.files.set(path, file);
  }
}

/**
 * 폴더를 열어 안의 파일을 전부 읽는다. 사용자가 취소하면 null.
 *
 * 파일 하나를 여는 것만으로는 형제 파일을 볼 권한이 없다 (spec §5.1).
 * 자원을 붙이려면 사용자가 폴더를 직접 내줘야 한다.
 *
 * @param startIn 이 파일이 있던 자리에서 대화상자를 연다 — 대개 그 폴더가 정답이다
 */
export async function pickFolder(startIn?: FileHandle | null): Promise<FolderRead | null> {
  const show = (window as unknown as PickerWindow).showDirectoryPicker;
  if (!show) return null;

  try {
    const dir = await show(startIn ? { mode: 'read', startIn } : { mode: 'read' });
    const read: Walk = { files: new Map(), truncated: false, bytes: 0 };
    await walk(dir, '', read);
    return { files: read.files, truncated: read.truncated };
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    throw e;
  }
}

/** 핸들에서 읽는다. 핸들이 있으므로 나중에 원본을 덮어쓸 수 있다. */
export async function fromHandle(handle: FileHandle): Promise<OpenedFile> {
  const file = await handle.getFile();
  return { name: handle.name, text: await file.text(), handle };
}

/**
 * OS 가 이 앱으로 파일을 열었을 때 받는다 (manifest 의 file_handlers).
 *
 * 파일 선택 대화상자를 거치지 않고도 핸들이 오므로 덮어쓰기 저장이 그대로 된다.
 * 지원하지 않는 환경에서는 아무 일도 하지 않는다.
 */
export function onFileLaunch(handler: (file: OpenedFile) => void): void {
  const queue = (window as unknown as { launchQueue?: LaunchQueue }).launchQueue;
  if (!queue) return;
  queue.setConsumer((params) => {
    const handle = params.files[0];
    if (handle) void fromHandle(handle).then(handler);
  });
}

/** 사용자가 취소하면 null 을 돌려준다 */
export async function openHtmlFile(): Promise<OpenedFile | null> {
  const show = picker();
  if (!show) return openViaInput();

  try {
    const [handle] = await show({
      types: [{ description: 'HTML', accept: { 'text/html': ['.html', '.htm'] } }],
      multiple: false,
    });
    if (!handle) return null;
    return fromHandle(handle);
  } catch (e) {
    // 사용자가 취소한 경우는 오류가 아니다.
    if (e instanceof DOMException && e.name === 'AbortError') return null;
    throw e;
  }
}

/** 드래그&드롭이나 <input type=file> 로 받은 파일 — 핸들이 없어 덮어쓸 수 없다 */
export async function readDroppedFile(file: File): Promise<OpenedFile> {
  return { name: file.name, text: await file.text(), handle: null };
}

function openViaInput(): Promise<OpenedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.html,.htm,text/html';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      void readDroppedFile(file).then(resolve);
    };
    // 취소를 처리하지 않으면 프라미스가 영영 안 풀려 busy 가 걸린 채 굳는다.
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

/** 브라우저 다운로드로 내려보낸다. 다운로드 폴더에만 쓸 수 있어 원본은 건드리지 않는다. */
export function downloadFile(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/html' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  // 문서에 붙이지 않거나 곧바로 revoke 하면 브라우저에 따라 내려받기가 취소된다.
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
