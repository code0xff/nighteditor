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

interface PickerWindow {
  showOpenFilePicker?: (options: unknown) => Promise<FileHandle[]>;
}

export interface OpenedFile {
  name: string;
  text: string;
  /** null 이면 덮어쓰기가 불가능해 내려받기로만 저장한다 */
  handle: FileHandle | null;
}

export type SaveResult = 'overwritten' | 'downloaded';

const picker = (): PickerWindow['showOpenFilePicker'] =>
  (window as unknown as PickerWindow).showOpenFilePicker;

export function canOverwrite(): boolean {
  return typeof picker() === 'function';
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
    const file = await handle.getFile();
    return { name: handle.name, text: await file.text(), handle };
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
  download(file.name, text);
  return 'downloaded';
}

function download(name: string, text: string): void {
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
