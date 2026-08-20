import { create } from 'zustand';
import { applyPatches, PatchError } from '@/core/patch';
import { parseBlocks } from '@/core/parse';
import { applyLiveLocks } from '@/core/verify';
import type { Block } from '@/core/types';
import { buildPreviewDocument } from '@/lib/preview';
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
  scanned: boolean;
  busy: boolean;
  message: string | null;

  openFile: () => Promise<void>;
  loadDropped: (file: File) => Promise<void>;
  onReady: (live: { id: number; text: string }[]) => void;
  onEdit: (id: number, html: string) => void;
  onBlocked: (id: number) => void;
  select: (id: number | null) => void;
  revert: (id: number) => void;
  revertAll: () => void;
  save: () => Promise<void>;
}

/** 편집 결과가 원본과 같으면 패치로 치지 않는다 — 저장했을 때 diff 가 생기면 안 된다 */
function nextPatches(prev: Map<number, string>, block: Block, html: string): Map<number, string> {
  const next = new Map(prev);
  // RCDATA 는 평문으로 다루므로 원본 비교도 디코딩된 텍스트와 해야 한다.
  // sourceInner 와 비교하면 엔티티가 든 제목이 늘 "변경됨"으로 잡힌다.
  const baseline = block.rcdata ? block.sourceText : block.sourceInner;
  if (html === baseline) next.delete(block.id);
  else next.set(block.id, html);
  return next;
}

/** <title> 은 프리뷰에 렌더되지 않아 클릭이 닿지 않는다. 별도 필드로 편집한다 (spec §2.1) */
export function titleBlock(blocks: readonly Block[]): Block | undefined {
  return blocks.find((b) => b.rcdata);
}

function load(file: OpenedFile): Partial<EditorState> {
  const blocks = parseBlocks(file.text);
  return {
    file,
    source: file.text,
    blocks,
    previewDoc: buildPreviewDocument(file.text, blocks),
    patches: new Map(),
    selectedId: null,
    blockedId: null,
    scanned: false,
    message: null,
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
  scanned: false,
  busy: false,
  message: null,

  openFile: async () => {
    set({ busy: true, message: null });
    try {
      const file = await openHtmlFile();
      if (file) set(load(file));
    } catch (e) {
      set({ message: e instanceof Error ? e.message : '파일을 열지 못했다' });
    } finally {
      set({ busy: false });
    }
  },

  loadDropped: async (file) => {
    set({ busy: true, message: null });
    try {
      set(load(await readDroppedFile(file)));
    } finally {
      set({ busy: false });
    }
  },

  // 렌더 결과와 소스를 대조해 스크립트가 만든 블록을 잠근다 (ADR-005).
  onReady: (live) => {
    const liveText = new Map(live.map((b) => [b.id, b.text]));
    set({ blocks: applyLiveLocks(get().blocks, liveText), scanned: true });
  },

  onEdit: (id, html) => {
    const block = get().blocks.find((b) => b.id === id);
    if (!block || block.locked !== null) return;
    set({ patches: nextPatches(get().patches, block, html) });
  },

  onBlocked: (id) => set({ blockedId: id, selectedId: null }),
  select: (id) => set({ selectedId: id, blockedId: null }),

  revert: (id) => {
    const next = new Map(get().patches);
    next.delete(id);
    set({ patches: next });
  },

  revertAll: () => set({ patches: new Map() }),

  save: async () => {
    const { file, source, blocks, patches } = get();
    if (!file) return;
    set({ busy: true, message: null });
    try {
      const list = [...patches].map(([id, newInnerHtml]) => ({ id, newInnerHtml }));
      const output = applyPatches(source, blocks, list);
      const how = await saveFile(file, output);
      set({
        message:
          how === 'overwritten'
            ? `${file.name} 에 저장했다 (${list.length}개 블록)`
            : `${file.name} 을 내려받았다 — 이 브라우저는 덮어쓰기를 지원하지 않는다`,
      });
    } catch (e) {
      set({
        message: e instanceof PatchError ? `저장 거부: ${e.message}` : '저장하지 못했다',
      });
    } finally {
      set({ busy: false });
    }
  },
}));

/** 잠금 사유별 개수 — UI 가 "왜 못 고치는지"를 보여주기 위한 집계 */
export function lockSummary(blocks: readonly Block[]): { reason: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const b of blocks) {
    if (b.locked === null) continue;
    counts.set(b.locked, (counts.get(b.locked) ?? 0) + 1);
  }
  return [...counts]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}
