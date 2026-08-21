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
  pickFile,
  pickFolder,
  saveFile,
  type FolderRead,
  type OpenedFile,
  type Picked,
} from '@/lib/fs';
import { EMPTY_BUNDLE, type AssetBundle } from '@/lib/bundle';
import { keepEdits } from './unsaved';
import type { AssetRef } from '@/core/assets';
import { documentCandidates } from '@/core/bundle';

export interface EditorState {
  file: OpenedFile | null;
  /** 로드한 원본. 세션 내내 바뀌지 않는다 (INV-1) */
  source: string;
  blocks: Block[];
  previewDoc: string;
  /** 블록 id → 편집된 innerHTML */
  patches: Map<number, string>;
  selectedId: number | null;
  /** 잠긴 블록을 눌렀을 때 이유를 보여주기 위한 표시 */
  blockedId: number | null;
  /** 프리뷰에 되돌리라고 보낼 목록. PreviewFrame 이 보내고 비운다 */
  revertQueue: { id: number; html: string }[];
  /** 프리뷰에 보여 달라고 부탁할 블록. 보내고 나면 비운다 */
  revealId: number | null;
  /**
   * 확정한 순서대로의 블록 id (마지막이 가장 최근). `patches` 는 Map 이라
   * 같은 블록을 다시 고치면 처음 넣은 자리에 머물러 "마지막 변경"을 알 수 없다.
   */
  editOrder: number[];
  scanned: boolean;
  busy: boolean;
  /**
   * 아직 파일에 없는 편집이 있다 — 지금 만들 결과물이 `savedText` 와 다르다 (spec §5).
   *
   * `patches` 로는 어느 방향으로도 알 수 없다 — 저장해도 `source` 는 원본 그대로라(INV-1)
   * 패치 목록이 그대로 남고(그걸 "저장 안 함" 으로 읽으면 저장한 뒤에도 계속 되묻는다),
   * 반대로 저장한 적 없는 편집을 되돌리면 패치가 없어져도 잃을 것 자체가 없다.
   */
  unsaved: boolean;
  /**
   * 파일이 들고 있는 내용 — 열 때 읽은 그대로였다가, 저장할 때마다 쓴 결과물로 갱신된다.
   * `unsaved` 는 언제나 이것과의 비교다. 저장 경로의 입력은 아니다 (그건 `source`, INV-1).
   */
  savedText: string;
  /** 완성된 문장이 아니라 메시지 키다 — 언어를 바꾸면 알림도 함께 바뀐다 (spec §1) */
  notice: Notice | null;

  /** 문서가 참조하는 외부 자원 (spec §5.1) */
  assetRefs: AssetRef[];
  /**
   * 세는 대상이 되는 자원 경로 전부.
   *
   * 문서의 속성만으로는 모자란다 — `<style>` 과 붙인 스타일시트 안의 `url()` 도
   * 못 붙으면 화면이 깨진다. 참조가 아니라 **파일** 단위로 센다.
   */
  assetPaths: string[];
  /** 붙인 자원. 파일을 바꿔 열면 이전 것을 반드시 놓아준다 */
  assets: AssetBundle;
  /** 묶음 안에서 문서가 놓인 디렉터리. 폴더·zip 으로 열었을 때만 루트가 아니다 */
  docDir: string;
  /** 지금 연 문서의 묶음 안 경로. 묶음이 아니면 빈 문자열 */
  docPath: string;
  /**
   * 묶음으로 받은 파일 전체. 다른 문서로 갈아탈 때 다시 풀지 않으려고 들고 있는다.
   * blob URL 이 어차피 이 파일들을 붙잡고 있으므로 추가로 드는 것은 없다.
   */
  bundle: ReadonlyMap<string, Blob> | null;
  /** 묶음 안의 HTML 후보들. 하나뿐이면 고를 것이 없다 */
  candidates: string[];
  /** 묶음 안에서 되쓸 수 있는 파일의 핸들. 폴더를 열어 받았을 때만 채워진다 */
  bundleHandles: ReadonlyMap<string, OpenedFile['handle']>;

  openFile: () => Promise<void>;
  loadDropped: (file: File) => Promise<void>;
  /** 읽어 둔 폴더가 있으면 그 안의 문서를 연다. 폴더가 아니었으면 false */
  loadFolder: (read: FolderRead | null) => Promise<boolean>;
  /** 폴더를 골라 그 안의 문서를 연다 (spec §5.1) */
  openFolder: () => Promise<void>;
  /** 여는 도중의 실패를 알림으로 돌린다 — 화면 쪽에서 잡은 오류가 들어온다 */
  failedToOpen: (e: unknown) => void;
  adopt: (file: OpenedFile) => Promise<void>;
  onReady: (live: { id: number; text: string }[]) => void;
  onEdit: (id: number, html: string, pristine?: boolean) => void;
  onBlocked: (id: number) => void;
  select: (id: number | null) => void;
  revert: (id: number) => void;
  revertAll: () => void;
  /** 마지막으로 확정한 변경을 되돌린다 (Ctrl+Z) */
  undoLast: () => void;
  drainReverts: () => void;
  /** 변경 목록에서 고른 블록을 프리뷰에서 보여준다 */
  reveal: (id: number) => void;
  drainReveal: () => void;
  /** 저장했으면 true. 실패했거나 저장할 것이 없으면 false */
  save: () => Promise<boolean>;
  downloadCopy: () => void;
  /** 폴더를 열어 외부 자원을 붙인다 (spec §5.1) */
  linkFolder: () => Promise<void>;
  /** 같은 묶음 안의 다른 문서로 갈아탄다 */
  openFromBundle: (path: string) => Promise<void>;
}

/**
 * 붙인 자원과 못 붙인 자원의 수. 같은 파일을 여러 번 참조해도 하나로 센다 —
 * 사용자가 세는 단위는 참조가 아니라 파일이다.
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
 * 파일과 다른가 — 지금 만들 결과물을 파일이 들고 있는 내용과 견준다 (spec §5).
 *
 * 저장 버튼·`Ctrl+S` 의 조기 반환·`beforeunload`·저장 대화상자가 전부 이 한 기준을
 * 본다. 결과물을 만들 수 없으면 같은지도 알 수 없다 — 잃을 수 있다고 보고 묻는 쪽이
 * 안전하다 (대원칙 3).
 */
function differsFromDisk(
  s: Pick<EditorState, 'source' | 'blocks' | 'patches' | 'savedText'>
): boolean {
  try {
    const list = [...s.patches].map(([id, newInnerHtml]) => ({ id, newInnerHtml }));
    return applyPatches(s.source, s.blocks, list) !== s.savedText;
  } catch {
    return true;
  }
}

/** 편집 결과가 원본과 같으면 패치로 치지 않는다 — 저장했을 때 diff 가 생기면 안 된다 */
function nextPatches(
  prev: Map<number, string>,
  block: Block,
  html: string,
  pristine: boolean
): Map<number, string> {
  const next = new Map(prev);
  // 프리뷰에서 온 편집은 pristine 판정을 그대로 믿는다. 브라우저가 직렬화한 값과
  // 소스 문자열은 <br/> → <br> 같은 정규화 차이가 있어 여기서 비교하면 안 된다.
  // 제목처럼 호스트에서 직접 고치는 평문은 sourceText 와 비교한다.
  const unchanged = block.rcdata ? html === block.sourceText : pristine;
  if (unchanged) next.delete(block.id);
  else next.set(block.id, html);
  return next;
}

/** <title> 은 프리뷰에 렌더되지 않아 클릭이 닿지 않는다. 별도 필드로 편집한다 (spec §2.1) */
export function titleBlock(blocks: readonly Block[]): Block | undefined {
  return blocks.find((b) => b.rcdata);
}

/**
 * 새로 연 문서로 갈아탄다. 이전 blob URL 을 여기서 놓아준다 —
 * 안 놓으면 파일을 여러 번 열수록 탭이 계속 무거워진다.
 *
 * 새 상태를 다 만든 **뒤에** 놓는다. 만들다 실패하면 지금 보고 있는 화면이
 * 그대로 살아 있어야 하고, 그 화면은 이전 blob 을 쓰고 있다.
 */
async function replace(
  get: () => EditorState,
  loading: Promise<Partial<EditorState>>
): Promise<Partial<EditorState>> {
  const next = await loading;
  get().assets.dispose();
  return next;
}

function candidatesOf(files: ReadonlyMap<string, Blob>): string[] {
  return documentCandidates(files.keys());
}

/**
 * 프리뷰를 다시 그리기 전에 파일을 **디스크에서 다시 읽는다**.
 *
 * 저장해도 `source` 는 열었을 때의 문자열 그대로다 (INV-1). 그 상태로 다시 그리면
 * 이미 저장한 편집이 화면에서 사라지고, 그 뒤에 저장하면 디스크의 내용을 옛 내용으로
 * 덮어써 **저장했던 것이 없어진다.** 핸들이 있으면 지금 파일에서 다시 읽어 맞춘다.
 */
async function reread(file: OpenedFile): Promise<OpenedFile> {
  if (!file.handle) return file;
  // 실패를 삼키지 않는다 (대원칙 3). 들고 있던 바이트로 계속 가면 묶음에서는 빈
  // 자리 표시가 그대로 열려 문서가 빈 화면이 되고, 폴더 연결에서는 옛 원본으로 다시
  // 그려 놓고 나중에 저장할 때 디스크의 새 내용을 옛 것으로 덮어쓴다.
  // 던지면 부르는 쪽의 catch 가 이유를 알림으로 돌리고, 보던 화면은 그대로 남는다.
  return { ...file, text: await (await file.handle.getFile()).text() };
}

/**
 * 묶음에서 온 문서 경로를 새로 고른 폴더 기준으로 옮긴다.
 *
 * 옛 경로는 옛 묶음의 뿌리 기준이라 새 폴더에는 그대로 없을 수 있다. 그렇다고 이름만
 * 남기면 `deck/slides/index.html` 을 `deck` 폴더에 연결했을 때 `slides/` 가 통째로
 * 사라져, 문서 옆(`slides/`)의 자원을 전부 못 찾는다. 앞에서부터 한 단계씩 걷어내며
 * 새 폴더에 실제로 있는 가장 긴 꼬리를 찾는다.
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
  // 어디에도 없으면 이름만 남겨 뿌리 기준으로 푼다 — 못 찾은 자원은 못 찾았다고 세면 된다.
  return parts[parts.length - 1];
}

/** 오류 원문이 있으면 붙여서 보여준다. 없으면 짧은 문장만 */
function openFailedNotice(e: unknown): Notice {
  if (e instanceof BundleEmptyError) return { key: 'notice.bundleNoDocument' };
  // zip 오류는 우리 것이라 코드로 온다 — 문장은 언어팩이 만든다 (spec §1 · INV-6).
  // 원문을 그대로 붙이는 것은 번역할 수 없는 브라우저 오류의 몫이다.
  if (e instanceof ZipError) {
    return { key: 'notice.openFailedDetail', params: { detail: zipNotice(e.code, e.params) } };
  }
  return e instanceof Error && e.message
    ? { key: 'notice.openFailedDetail', params: { detail: e.message } }
    : { key: 'notice.openFailed' };
}

/**
 * parse5 와 프리뷰 조립기는 **파일을 열 때 처음** 필요하다. 초기 화면은 드롭 영역뿐이라
 * 파서를 같이 실어 보낼 이유가 없다 — 그래서 여기서 동적으로 불러온다 (코드 분할).
 */
async function load(
  file: OpenedFile,
  files?: ReadonlyMap<string, Blob>,
  handles?: ReadonlyMap<string, OpenedFile['handle']>
): Promise<Partial<EditorState>> {
  const [
    { parseBlocks },
    { buildPreviewDocument },
    { cssAssetPaths, dirOf, parseAssetRefs, styleTexts },
    { buildAssets },
  ] = await Promise.all([
    import('@/core/parse'),
    import('@/lib/preview'),
    import('@/core/assets'),
    import('@/lib/assets'),
  ]);
  const docPath = file.path ?? '';
  const docDir = dirOf(file.path ?? file.name);
  const blocks = parseBlocks(file.text);
  const refs = parseAssetRefs(file.text, docDir);
  // 속성 · 문서에 박힌 <style> · 붙인 스타일시트가 부르는 것까지 한자리에 모은다.
  const inStyle = styleTexts(file.text).flatMap((css) => cssAssetPaths(css, docDir));
  const assets = files
    ? await buildAssets(files, [...refs.map((r) => r.path), ...inStyle])
    : EMPTY_BUNDLE;
  const assetPaths = [...new Set([...refs.map((r) => r.path), ...inStyle, ...assets.missing])];

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
    previewDoc: buildPreviewDocument(file.text, blocks, { refs, dir: docDir, urls: assets.urls }),
    patches: new Map(),
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
 * 고른 파일이 zip 이면 풀어서 그 안의 문서를 연다 (spec §5.1).
 *
 * zip 안의 HTML 에는 핸들이 없다 — 압축을 풀어 봐야 메모리 안의 바이트라
 * 되쓸 자리가 없다. 그래서 저장은 사본 내려받기로 간다.
 */
async function openPicked(picked: Picked): Promise<Partial<EditorState>> {
  if (/\.zip$/i.test(picked.name)) {
    const { unzip } = await import('@/lib/zip');
    return openBundle(await unzip(picked.blob));
  }

  const file: OpenedFile = {
    name: picked.name,
    text: await picked.blob.text(),
    handle: picked.handle,
  };
  return load(file);
}

/**
 * 여러 파일을 한꺼번에 받았을 때(폴더·zip) 그중 문서 하나를 연다 (spec §5.1).
 *
 * 묶음으로 온 문서에는 핸들이 없다 — 되쓸 자리가 없어 저장은 사본 내려받기로 간다.
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

  // 열기 대화상자로 고른 폴더에서만 핸들이 온다. 없으면 사본 내려받기로 간다.
  const handle = handles?.get(path) ?? null;
  // 묶음에 담긴 것은 **열었을 때의** 바이트다. 저장한 뒤 다른 문서로 갔다 돌아오면
  // 그 옛 바이트를 다시 읽어, 저장한 내용을 화면에서 지우고 나중에 덮어쓴다.
  const fresh = await reread({ name: '', text: '', handle });

  const next = await load(
    {
      name: path.split('/').pop() ?? path,
      text: handle ? fresh.text : await entry.text(),
      handle,
      path,
    },
    files,
    handles
  );
  // 후보가 여럿이면 어느 것을 열었는지 말한다. 조용히 하나 고르면 나머지는 없는 셈이 된다.
  return candidates.length > 1 && !want
    ? {
        ...next,
        notice: { key: 'notice.bundlePicked', params: { path, count: candidates.length } },
      }
    : next;
}

/** 묶음은 열렸는데 안에 문서가 없다 — 파일을 못 연 것과는 다른 사정이라 문구도 다르다 */
class BundleEmptyError extends Error {}

export const useEditor = create<EditorState>((set, get) => ({
  file: null,
  source: '',
  blocks: [],
  previewDoc: '',
  patches: new Map(),
  selectedId: null,
  blockedId: null,
  revertQueue: [],
  revealId: null,
  editOrder: [],
  scanned: false,
  busy: false,
  unsaved: false,
  savedText: '',
  notice: null,
  assetRefs: [],
  assetPaths: [],
  assets: EMPTY_BUNDLE,
  docDir: '',
  docPath: '',
  bundle: null,
  candidates: [],
  bundleHandles: new Map(),

  openFile: async () => {
    set({ notice: null });
    try {
      // 대화상자를 **먼저** 연다. 저장을 기다린 뒤에 열면 그 사이 사용자 제스처가
      // 만료돼 브라우저가 대화상자를 거절한다 (File System Access API 는 제스처를 요구한다).
      const picked = await pickFile();
      if (!picked) return;
      // 묻는 동안에는 busy 를 세우지 않는다. 세우면 대화상자의 "저장하고 계속하기" 가
      // 눌리지 않아 남는 선택지가 버리기와 취소뿐이 된다.
      if (!(await keepEdits({ key: 'confirm.whyOpen' }))) return;
      set({ busy: true });
      set(await replace(get, openPicked(picked)));
    } catch (e) {
      // 브라우저가 던진 원문은 번역하지 않고 그대로 붙인다 (spec §1 · UI 언어).
      set({ notice: openFailedNotice(e) });
    } finally {
      set({ busy: false });
    }
  },

  // OS 가 열어준 파일(PWA file_handlers)을 받는다.
  // load 가 파서 청크를 받아오므로 여기도 실패할 수 있다 — 조용히 굳지 않게 감싼다 (ADR-008).
  adopt: async (file) => {
    // OS 가 파일을 들려 보냈어도 다른 파일 열기다. 들어오는 길이 다르다고
    // 지금 고치던 것을 조용히 버릴 이유는 못 된다 (spec §4 · 저장하지 않은 편집).
    if (!(await keepEdits({ key: 'confirm.whyOpen' }))) return;
    set({ busy: true, notice: null });
    try {
      set(await replace(get, load(file)));
    } catch (e) {
      set({ notice: openFailedNotice(e) });
    } finally {
      set({ busy: false });
    }
  },

  // 폴더를 놓으면 그 안의 문서를 연다. 옛 드롭 API 는 쓰기 권한을 주지 않으므로
  // 저장은 사본 내려받기로 간다 — 자원을 붙여 보는 데는 그것으로 충분하다.
  loadFolder: async (read) => {
    if (!read) return false;
    set({ busy: true, notice: null });
    try {
      set(await replace(get, openBundle(read.files, undefined, read.handles)));
      if (read.truncated) {
        set({ notice: { key: 'notice.folderTruncated', params: { count: read.files.size } } });
      }
      return true;
    } catch (e) {
      set({ notice: openFailedNotice(e) });
      return true;
    } finally {
      set({ busy: false });
    }
  },

  loadDropped: async (file) => {
    set({ busy: true, notice: null });
    try {
      set(await replace(get, openPicked(droppedFile(file))));
    } catch (e) {
      // 파싱 실패를 삼키면 파일을 놓아도 아무 일도 안 일어나는 것처럼 보인다.
      set({ notice: openFailedNotice(e) });
    } finally {
      set({ busy: false });
    }
  },

  // 렌더 결과와 소스를 대조해 스크립트가 만든 블록을 잠근다 (ADR-005).
  onReady: (live) => {
    const liveText = new Map(live.map((b) => [b.id, b.text]));
    const blocks = applyLiveLocks(get().blocks, liveText);
    // 대조 전에 편집된 블록이 뒤늦게 잠길 수 있다. 그대로 두면 저장 때
    // applyPatches 가 목록 전체를 거부해 멀쩡한 편집까지 함께 죽는다 (INV-5).
    const lockedIds = new Set(blocks.filter((b) => b.locked !== null).map((b) => b.id));
    const patches = new Map([...get().patches].filter(([id]) => !lockedIds.has(id)));
    const editOrder = get().editOrder.filter((id) => patches.has(id));
    // 패치가 빠졌으면 결과물도 달라졌을 수 있다 — 기준은 언제나 하나다 (spec §5).
    set({
      blocks,
      patches,
      editOrder,
      scanned: true,
      unsaved: differsFromDisk({ ...get(), blocks, patches }),
    });
  },

  onEdit: (id, html, pristine = false) => {
    const block = get().blocks.find((b) => b.id === id);
    if (!block || block.locked !== null) return;
    const before = get().patches;
    const patches = nextPatches(before, block, html, pristine);
    // 다시 고친 블록은 맨 뒤로 옮긴다 — 그것이 가장 최근 변경이다.
    const editOrder = get().editOrder.filter((x) => x !== id);
    if (patches.has(id)) editOrder.push(id);
    // 눌렀다 그냥 빠져나온 것도, 고쳤다가 파일과 같은 내용으로 되돌아온 것도
    // 저장할 것이 아니다. 결과물과 파일을 견줘야 두 경우 모두 맞게 읽힌다 (spec §5).
    set({ patches, editOrder, unsaved: differsFromDisk({ ...get(), patches }) });
  },

  failedToOpen: (e) => set({ notice: openFailedNotice(e), busy: false }),

  // 잠긴 블록을 누르면 이유를 말한다 (대원칙 3). 누를 때마다 뜨는 것이라 여기서 띄운다 —
  // 화면 쪽에서 blockedId 변화를 보면 같은 블록을 다시 눌렀을 때 아무 일도 일어나지 않는다.
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

  // 패치만 지우면 프리뷰에는 고친 내용이 그대로 남는다. 그 블록을 다시 눌렀다
  // 빠져나오면 패치가 되살아나 프리뷰와 저장본이 영영 어긋난다.
  revert: (id) => {
    const { patches, blocks, revertQueue } = get();
    const next = new Map(patches);
    next.delete(id);
    const block = blocks.find((b) => b.id === id);
    set({
      patches: next,
      editOrder: get().editOrder.filter((x) => x !== id),
      revertQueue: [...revertQueue, { id, html: block?.sourceInner ?? '' }],
      // 되돌리기도 파일과 달라질 수 있는 일이다 — 이미 저장한 내용을 되돌린 것일 수
      // 있다. 반대로 저장한 적 없는 편집을 되돌렸으면 파일과 같아져 잃을 것이 없다.
      unsaved: differsFromDisk({ ...get(), patches: next }),
    });
  },

  revertAll: () => {
    const { patches, blocks, revertQueue } = get();
    const restored = [...patches.keys()].map((id) => ({
      id,
      html: blocks.find((b) => b.id === id)?.sourceInner ?? '',
    }));
    set({
      patches: new Map(),
      editOrder: [],
      revertQueue: [...revertQueue, ...restored],
      // 전부 되돌린 결과물은 원본 그대로다 — 파일도 원본 그대로면 잃을 것이 없다.
      unsaved: differsFromDisk({ ...get(), patches: new Map() }),
    });
  },

  // 편집 중이 아닐 때의 Ctrl+Z. 편집 중에는 브라우저의 네이티브 undo 가 담당한다 (spec §4).
  undoLast: () => {
    const { editOrder, revert } = get();
    const last = editOrder[editOrder.length - 1];
    if (last !== undefined) revert(last);
  },

  drainReverts: () => set({ revertQueue: [] }),

  // 고른 블록을 화면에서도 짚어준다. 목록만 보고는 문서 어디였는지 알기 어렵다.
  reveal: (id) => set({ revealId: id, selectedId: id, blockedId: null }),
  drainReveal: () => set({ revealId: null }),

  // 원본은 건드리지 않고 결과물만 파일로 받는다 (spec §4 · 사본 내려받기).
  // 패치가 없어도 동작한다 — 고치기 전 백업을 받는 용도로도 쓴다.
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
   * 폴더를 골라 그 안의 문서를 연다 (spec §5.1).
   *
   * 편집 권한까지 함께 받는다. 열기로 연 것은 덮어쓴다는 규칙을 폴더에서도 지키려면
   * 되쓸 핸들이 있어야 하고, 그 핸들은 대화상자에서만 나온다.
   * 사용자가 편집 허용을 거절하면 브라우저가 취소로 돌려주므로 아무 일도 일어나지 않는다.
   */
  openFolder: async () => {
    if (!canPickFolder()) {
      set({ notice: { key: 'notice.folderUnsupported' } });
      return;
    }
    set({ notice: null });
    try {
      // 파일 열기와 같은 이유로 대화상자가 먼저다.
      const read = await pickFolder(null, 'readwrite');
      if (!read) return;
      if (!(await keepEdits({ key: 'confirm.whyOpen' }))) return;
      set({ busy: true });
      set(await replace(get, openBundle(read.files, undefined, read.handles)));
      if (read.truncated) {
        set({ notice: { key: 'notice.folderTruncated', params: { count: read.files.size } } });
      }
    } catch (e) {
      set({ notice: openFailedNotice(e) });
    } finally {
      set({ busy: false });
    }
  },

  /**
   * 폴더를 열어 외부 자원을 붙인다 (spec §5.1).
   *
   * 파일 핸들은 그대로 두므로 **덮어쓰기 저장은 계속 된다.** 폴더는 읽기 전용으로만 받는다.
   * 프리뷰를 다시 그리므로 편집 상태는 사라진다 — 버려도 되는지는 부르는 쪽이 먼저 묻는다.
   */
  linkFolder: async () => {
    const { file } = get();
    if (!file) return;
    if (!canPickFolder()) {
      set({ notice: { key: 'notice.folderUnsupported' } });
      return;
    }

    set({ notice: null });
    try {
      // 대화상자를 파일이 있던 자리에서 연다 — 대개 그 폴더가 정답이다.
      const read = await pickFolder(file.handle);
      if (!read) return;
      if (!(await keepEdits({ key: 'confirm.whyAssets' }))) return;
      set({ busy: true });

      // 지금 문서가 묶음에서 왔다면 그 경로는 옛 묶음 기준이다. 새로 고른 폴더 기준으로
      // 옮겨 줘야 한다 — 안 그러면 제 폴더를 골라 주고도 자원을 못 찾는다.
      const fresh = await reread(get().file ?? file);
      const rebased = { ...fresh, path: rebasePath(fresh.path, read.files) };
      // 연결로 받은 핸들은 묶음에 남기지 않는다. 이 길은 읽기 전용이라(read) 그 핸들로는
      // 저장이 거부되는데, 묶음의 핸들로 남으면 다른 문서로 갈아탈 때 file.handle 자리에
      // 들어가 "덮어쓰기" 라던 저장이 그제서야 실패한다.
      set(await replace(get, load(rebased, read.files)));
      const attached = countAssets(get()).linked;
      set({
        notice: read.truncated
          ? { key: 'notice.folderTruncated', params: { count: read.files.size } }
          : attached > 0
            ? { key: 'notice.assetsLinked', params: { count: attached } }
            : { key: 'notice.assetsNotFound' },
      });
    } catch (e) {
      set({ notice: openFailedNotice(e) });
    } finally {
      set({ busy: false });
    }
  },

  /**
   * 같은 묶음 안의 다른 문서로 갈아탄다 (spec §5.1).
   *
   * 이미 풀어 둔 파일을 그대로 쓴다 — zip 을 다시 푸는 것은 헛일이다.
   * 프리뷰를 다시 그리므로 편집은 사라진다. 버려도 되는지는 부르는 쪽이 먼저 묻는다.
   */
  openFromBundle: async (path) => {
    const { bundle, docPath } = get();
    if (!bundle || path === docPath) return;

    set({ notice: null });
    try {
      if (!(await keepEdits({ key: 'confirm.whySwitch', params: { path } }))) return;
      set({ busy: true });
      set(await replace(get, openBundle(bundle, path, get().bundleHandles)));
    } catch (e) {
      set({ notice: openFailedNotice(e) });
    } finally {
      set({ busy: false });
    }
  },

  save: async () => {
    const { file, source, blocks, patches, unsaved } = get();
    // 파일과 다른 것이 없으면 아무 일도 하지 않는다. 버튼은 이미 비활성이지만
    // 단축키는 언제든 눌리므로, 같은 내용을 다시 쓰는 헛일을 여기서 막는다.
    //
    // 패치 개수로 거르면 안 된다 (spec §5). 이미 저장한 편집을 되돌리면 패치는 0개인데
    // 파일에는 옛 편집이 남아 있다 — 그때 여기서 false 로 나가면 "저장하고 계속하기" 가
    // 쓸 것이 없다며 멈춰, 대화상자에서 빠져나갈 길이 취소와 버리기뿐이 된다.
    // 패치 0개의 저장은 원본 그대로를 되써서 파일을 화면과 같게 만든다.
    if (!file || !unsaved) return false;
    set({ busy: true, notice: null });
    try {
      const list = [...patches].map(([id, newInnerHtml]) => ({ id, newInnerHtml }));
      const output = applyPatches(source, blocks, list);
      const how = await saveFile(file, output);
      set((s) => ({
        // 파일은 이제 방금 쓴 결과물을 들고 있다. 쓰는 동안에도 프리뷰는 편집할 수
        // 있으므로, 지금 상태를 그 결과물과 다시 견준다 — 그 사이 확정된 편집은
        // 파일에 없으니 더러운 채로 남고, 아무 일도 없었으면 깨끗해진다.
        savedText: output,
        unsaved: differsFromDisk({ ...s, savedText: output }),
        notice: {
          key: how === 'overwritten' ? 'notice.saved' : 'notice.downloaded',
          params: { name: file.name, count: list.length },
        },
      }));
      return true;
    } catch (e) {
      set({
        notice:
          e instanceof PatchError
            ? { key: 'notice.saveRejected', params: { detail: patchNotice(e.code, e.params) } }
            : { key: 'notice.saveFailed' },
      });
      return false;
    } finally {
      set({ busy: false });
    }
  },
}));

/** 잠금 사유별 개수 — UI 가 "왜 못 고치는지"를 보여주기 위한 집계 */
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
