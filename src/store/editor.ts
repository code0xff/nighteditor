import { create } from 'zustand';
import { applyPatches, PatchError } from '@/core/patch';
import { applyLiveLocks } from '@/core/verify';
import type { Block, LockReason } from '@/core/types';
import { patchNotice, type Notice } from '@/lib/messages';
import { openHtmlFile, readDroppedFile, saveFile, type OpenedFile } from '@/lib/fs';

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
  scanned: boolean;
  busy: boolean;
  /** 완성된 문장이 아니라 메시지 키다 — 언어를 바꾸면 알림도 함께 바뀐다 (spec §1) */
  notice: Notice | null;

  openFile: () => Promise<void>;
  loadDropped: (file: File) => Promise<void>;
  adopt: (file: OpenedFile) => Promise<void>;
  onReady: (live: { id: number; text: string }[]) => void;
  onEdit: (id: number, html: string, pristine?: boolean) => void;
  onBlocked: (id: number) => void;
  select: (id: number | null) => void;
  revert: (id: number) => void;
  revertAll: () => void;
  drainReverts: () => void;
  save: () => Promise<void>;
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

/** 오류 원문이 있으면 붙여서 보여준다. 없으면 짧은 문장만 */
function openFailedNotice(e: unknown): Notice {
  return e instanceof Error && e.message
    ? { key: 'notice.openFailedDetail', params: { detail: e.message } }
    : { key: 'notice.openFailed' };
}

/**
 * parse5 와 프리뷰 조립기는 **파일을 열 때 처음** 필요하다. 초기 화면은 드롭 영역뿐이라
 * 파서를 같이 실어 보낼 이유가 없다 — 그래서 여기서 동적으로 불러온다 (코드 분할).
 */
async function load(file: OpenedFile): Promise<Partial<EditorState>> {
  const [{ parseBlocks }, { buildPreviewDocument }] = await Promise.all([
    import('@/core/parse'),
    import('@/lib/preview'),
  ]);
  const blocks = parseBlocks(file.text);
  return {
    file,
    source: file.text,
    blocks,
    previewDoc: buildPreviewDocument(file.text, blocks),
    patches: new Map(),
    selectedId: null,
    blockedId: null,
    revertQueue: [],
    scanned: false,
    notice: null,
  };
}

export const useEditor = create<EditorState>((set, get) => ({
  file: null,
  source: '',
  blocks: [],
  previewDoc: '',
  patches: new Map(),
  selectedId: null,
  blockedId: null,
  revertQueue: [],
  scanned: false,
  busy: false,
  notice: null,

  openFile: async () => {
    set({ busy: true, notice: null });
    try {
      const file = await openHtmlFile();
      if (file) set(await load(file));
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
      set(await load(file));
    } catch (e) {
      set({ notice: openFailedNotice(e) });
    } finally {
      set({ busy: false });
    }
  },

  loadDropped: async (file) => {
    set({ busy: true, notice: null });
    try {
      set(await load(await readDroppedFile(file)));
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
    set({ blocks, patches, scanned: true });
  },

  onEdit: (id, html, pristine = false) => {
    const block = get().blocks.find((b) => b.id === id);
    if (!block || block.locked !== null) return;
    set({ patches: nextPatches(get().patches, block, html, pristine) });
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
      revertQueue: [...revertQueue, { id, html: block?.sourceInner ?? '' }],
    });
  },

  revertAll: () => {
    const { patches, blocks, revertQueue } = get();
    const restored = [...patches.keys()].map((id) => ({
      id,
      html: blocks.find((b) => b.id === id)?.sourceInner ?? '',
    }));
    set({ patches: new Map(), revertQueue: [...revertQueue, ...restored] });
  },

  drainReverts: () => set({ revertQueue: [] }),

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
