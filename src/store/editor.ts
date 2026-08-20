import { create } from 'zustand';
import { applyPatches, PatchError } from '@/core/patch';
import { applyLiveLocks } from '@/core/verify';
import type { Block, LockReason } from '@/core/types';
import { patchNotice, type Notice } from '@/lib/messages';
import {
  canPickFolder,
  downloadFile,
  droppedFile,
  pickFile,
  readDroppedFolder,
  pickFolder,
  saveFile,
  type OpenedFile,
  type Picked,
} from '@/lib/fs';
import { EMPTY_BUNDLE, type AssetBundle } from '@/lib/assets';
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
  /**
   * 확정한 순서대로의 블록 id (마지막이 가장 최근). `patches` 는 Map 이라
   * 같은 블록을 다시 고치면 처음 넣은 자리에 머물러 "마지막 변경"을 알 수 없다.
   */
  editOrder: number[];
  scanned: boolean;
  busy: boolean;
  /** 완성된 문장이 아니라 메시지 키다 — 언어를 바꾸면 알림도 함께 바뀐다 (spec §1) */
  notice: Notice | null;

  /** 문서가 참조하는 외부 자원 (spec §5.1) */
  assetRefs: AssetRef[];
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

  openFile: () => Promise<void>;
  loadDropped: (file: File) => Promise<void>;
  /** 드롭한 것에 폴더가 있으면 그 안의 문서를 연다. 폴더가 없었으면 false */
  loadDroppedFolder: (items: DataTransferItemList) => Promise<boolean>;
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
  save: () => Promise<void>;
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
export function countAssets(state: Pick<EditorState, 'assetRefs' | 'assets'>): {
  linked: number;
  missing: number;
} {
  const linked = new Set<string>();
  const missing = new Set<string>();
  for (const ref of state.assetRefs) {
    (state.assets.urls.has(ref.path) ? linked : missing).add(ref.path);
  }
  return { linked: linked.size, missing: missing.size };
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

/** 오류 원문이 있으면 붙여서 보여준다. 없으면 짧은 문장만 */
function openFailedNotice(e: unknown): Notice {
  if (e instanceof BundleEmptyError) return { key: 'notice.bundleNoDocument' };
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
  files?: ReadonlyMap<string, Blob>
): Promise<Partial<EditorState>> {
  const [{ parseBlocks }, { buildPreviewDocument }, { dirOf, parseAssetRefs }, { buildAssets }] =
    await Promise.all([
      import('@/core/parse'),
      import('@/lib/preview'),
      import('@/core/assets'),
      import('@/lib/assets'),
    ]);
  const docPath = file.path ?? '';
  const docDir = dirOf(file.path ?? file.name);
  const blocks = parseBlocks(file.text);
  const refs = parseAssetRefs(file.text, docDir);
  const assets = files ? await buildAssets(files) : EMPTY_BUNDLE;
  return {
    file,
    source: file.text,
    blocks,
    assetRefs: refs,
    assets,
    docDir,
    docPath,
    bundle: files ?? null,
    candidates: files ? candidatesOf(files) : [],
    previewDoc: buildPreviewDocument(file.text, blocks, { refs, dir: docDir, urls: assets.urls }),
    patches: new Map(),
    selectedId: null,
    blockedId: null,
    revertQueue: [],
    editOrder: [],
    scanned: false,
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
  want?: string
): Promise<Partial<EditorState>> {
  const candidates = candidatesOf(files);
  const path = want && candidates.includes(want) ? want : candidates[0];
  const entry = path ? files.get(path) : undefined;
  if (!path || !entry) throw new BundleEmptyError();

  const next = await load(
    { name: path.split('/').pop() ?? path, text: await entry.text(), handle: null, path },
    files
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
  editOrder: [],
  scanned: false,
  busy: false,
  notice: null,
  assetRefs: [],
  assets: EMPTY_BUNDLE,
  docDir: '',
  docPath: '',
  bundle: null,
  candidates: [],

  openFile: async () => {
    set({ busy: true, notice: null });
    try {
      const picked = await pickFile();
      if (picked) set(await replace(get, openPicked(picked)));
    } catch (e) {
      // 브라우저가 던진 원문은 번역하지 않고 그대로 붙인다 (spec §1 · UI 언어).
      set({ notice: openFailedNotice(e) });
    } finally {
      set({ busy: false });
    }
  },

  // OS 가 열어준 파일(PWA file_handlers)을 그대로 받는다.
  // load 가 파서 청크를 받아오므로 여기도 실패할 수 있다 — 조용히 굳지 않게 감싼다 (ADR-008).
  adopt: async (file) => {
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
  loadDroppedFolder: async (items) => {
    set({ busy: true, notice: null });
    try {
      const read = await readDroppedFolder(items);
      if (!read) return false;
      set(await replace(get, openBundle(read.files)));
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
    set({ blocks, patches, editOrder, scanned: true });
  },

  onEdit: (id, html, pristine = false) => {
    const block = get().blocks.find((b) => b.id === id);
    if (!block || block.locked !== null) return;
    const patches = nextPatches(get().patches, block, html, pristine);
    // 다시 고친 블록은 맨 뒤로 옮긴다 — 그것이 가장 최근 변경이다.
    const editOrder = get().editOrder.filter((x) => x !== id);
    if (patches.has(id)) editOrder.push(id);
    set({ patches, editOrder });
  },

  onBlocked: (id) => set({ blockedId: id, selectedId: null }),
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
    });
  },

  revertAll: () => {
    const { patches, blocks, revertQueue } = get();
    const restored = [...patches.keys()].map((id) => ({
      id,
      html: blocks.find((b) => b.id === id)?.sourceInner ?? '',
    }));
    set({ patches: new Map(), editOrder: [], revertQueue: [...revertQueue, ...restored] });
  },

  // 편집 중이 아닐 때의 Ctrl+Z. 편집 중에는 브라우저의 네이티브 undo 가 담당한다 (spec §4).
  undoLast: () => {
    const { editOrder, revert } = get();
    const last = editOrder[editOrder.length - 1];
    if (last !== undefined) revert(last);
  },

  drainReverts: () => set({ revertQueue: [] }),

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

    set({ busy: true, notice: null });
    try {
      // 대화상자를 파일이 있던 자리에서 연다 — 대개 그 폴더가 정답이다.
      const read = await pickFolder(file.handle);
      if (!read) return;

      set(await replace(get, load(file, read.files)));
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

    set({ busy: true, notice: null });
    try {
      set(await replace(get, openBundle(bundle, path)));
    } catch (e) {
      set({ notice: openFailedNotice(e) });
    } finally {
      set({ busy: false });
    }
  },

  save: async () => {
    const { file, source, blocks, patches } = get();
    // 고친 것이 없으면 아무 일도 하지 않는다. 버튼은 이미 비활성이지만
    // 단축키는 언제든 눌리므로, 같은 내용을 다시 쓰는 헛일을 여기서 막는다.
    if (!file || patches.size === 0) return;
    set({ busy: true, notice: null });
    try {
      const list = [...patches].map(([id, newInnerHtml]) => ({ id, newInnerHtml }));
      const output = applyPatches(source, blocks, list);
      const how = await saveFile(file, output);
      set({
        notice: {
          key: how === 'overwritten' ? 'notice.saved' : 'notice.downloaded',
          params: { name: file.name, count: list.length },
        },
      });
    } catch (e) {
      set({
        notice:
          e instanceof PatchError
            ? { key: 'notice.saveRejected', params: { detail: patchNotice(e.code, e.params) } }
            : { key: 'notice.saveFailed' },
      });
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
