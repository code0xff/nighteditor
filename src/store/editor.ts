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
import {
  claimDocument,
  refuseWhileReplacing,
  reserveReplacement,
  useReplacement,
  type Replacement,
} from './replacement';
import { keepEdits } from './unsaved';
import type { AssetBoundary, AssetRef } from '@/core/assets';
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
  /**
   * 저장이 파일을 쓰는 중이다 — 저장 버튼·대화상자의 저장이 겹쳐 돌지 않게 하는
   * **저장만의** 표시다. 갈아 끼우기의 화면 잠금은 예약(replacement.ts)이 따로
   * 들고 있어, 앞선 저장이 끝나도 그 잠금은 풀리지 않는다 (spec §5 · ADR-010).
   */
  saving: boolean;
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
  /**
   * 저장이 지금 쓰고 있는 결과물. 쓰기가 끝나면 파일이 들 내용이 이것이라, 쓰는 동안의
   * "파일과 다른가" 는 옛 `savedText` 가 아니라 이것과 견준다 (spec §5) — 옛것과
   * 견주면 쓰는 사이에 편집을 되돌렸을 때 잃을 것이 없다고 읽혀, 그 창에서 탭을
   * 닫으면 경고 없이 닫히고 화면과 디스크가 어긋난다. 저장 중이 아니면 null 이다.
   */
  pendingText: string | null;
  /**
   * 마지막 저장 때 파일에 들어간 패치들 — `savedText` 의 블록별 대응물.
   * 물음의 "{count}곳" 이 지금 `patches` 와 이것의 차이를 센다 (spec §4 · `unsavedCount`).
   * 저장 경로의 입력이 아니다 — 그건 `patches` 와 `source` 다 (INV-1).
   */
  savedPatches: ReadonlyMap<number, string>;
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
  /**
   * 프리뷰와 저장 사이의 양방향 경계 (ADR-011). 자원 치환은 블록 안에서도 일어나므로,
   * 프리뷰에서 돌아온 편집은 여기서 원문 표기로 되돌린 뒤에야 패치가 되고(INV-9),
   * 되돌리기로 프리뷰에 밀어 넣는 원본 조각은 여기서 치환한 뒤에 나간다.
   * null 이면 치환된 자원이 없다 — 양방향 모두 원문 그대로다.
   */
  boundary: AssetBoundary | null;
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
  /**
   * 드롭 한 번 — 파일이든 폴더든 (spec §5 · 갈아 끼우기 예약).
   *
   * 폴더 항목은 이벤트가 끝나면 사라지므로 훑기는 화면 쪽에서 이미 시작된 채로
   * 온다. 예약은 여기서, 훑기를 **기다리기 전에** 받는다 — 늦게 받으면 먼저 놓았지만
   * 늦게 훑힌 폴더가 더 새 예약을 받아 나중에 놓은 폴더를 덮는다.
   */
  openDropped: (file: File | undefined, folder: Promise<FolderRead | null>) => Promise<void>;
  /** @param within 이어받을 예약. 없으면 이 호출이 곧 사용자 행동이라 새로 예약한다 */
  loadDropped: (file: File, within?: Replacement) => Promise<void>;
  /** 읽어 둔 폴더가 있으면 그 안의 문서를 연다. 폴더가 아니었으면 false */
  loadFolder: (read: FolderRead | null, within?: Replacement) => Promise<boolean>;
  /** 열어 둔 문서를 닫고 처음 화면으로 돌아간다 */
  closeFile: () => Promise<void>;
  /** 폴더를 골라 그 안의 문서를 연다 (spec §5.1) */
  openFolder: () => Promise<void>;
  /** 여는 도중의 실패를 알림으로 돌린다 — 화면 쪽에서 잡은 오류가 들어온다 */
  failedToOpen: (e: unknown) => void;
  /**
   * OS 가 열어준 파일(PWA file_handlers)을 받는다. 읽기가 끝나기를 기다리지 않고
   * 프라미스째 받는다 — 예약을 읽기 **전에** 잡아야, 읽는 사이 사용자가 연 더 새
   * 흐름을 이 흐름이 밀어내지 않는다 (spec §5 · 갈아 끼우기 예약).
   */
  adopt: (file: OpenedFile | Promise<OpenedFile>) => Promise<void>;
  onReady: (live: { id: number; text: string }[]) => void;
  onEdit: (id: number, html: string, pristine?: boolean) => void;
  onBlocked: (id: number) => void;
  /** 대조가 끝나기 전에 블록을 눌렀다 — 편집은 열리지 않았고, 사정을 말한다 (spec §4) */
  onNotReady: () => void;
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
  s: Pick<EditorState, 'source' | 'blocks' | 'patches' | 'savedText' | 'pendingText'>
): boolean {
  try {
    const list = [...s.patches].map(([id, newInnerHtml]) => ({ id, newInnerHtml }));
    // 저장이 쓰는 중이면 파일은 곧 그 결과물을 든다 — 견줄 기준도 그쪽이다 (spec §5).
    return applyPatches(s.source, s.blocks, list) !== (s.pendingText ?? s.savedText);
  } catch {
    return true;
  }
}

/**
 * 파일과 다른 블록 수 — 물음의 "{count}곳" (spec §4).
 *
 * 패치 총수로는 못 센다: 저장해도 패치는 남아(INV-1) 이미 저장한 곳까지 세고,
 * 저장한 편집을 되돌리면 패치가 없는데도 파일과 다르다(그 자리가 1곳이다).
 * 그래서 지금 패치를 마지막 저장 때의 패치와 블록별로 견준다 — 같은 블록의 패치가
 * 그대로면 파일의 그 자리도 그대로라, 이 차이가 곧 결과물과 파일이 다른 자리다.
 */
export function unsavedCount(s: Pick<EditorState, 'patches' | 'savedPatches'>): number {
  let count = 0;
  for (const [id, html] of s.patches) if (s.savedPatches.get(id) !== html) count++;
  for (const id of s.savedPatches.keys()) if (!s.patches.has(id)) count++;
  return count;
}

/**
 * 편집 결과가 원본과 같으면 패치로 치지 않는다 — 저장했을 때 diff 가 생기면 안 된다.
 *
 * 아무것도 바뀌지 않았으면 `prev` 를 **그대로** 돌려준다 — 부르는 쪽이 참조 비교로
 * "정말 아무 일도 없었다" 를 알 수 있어야 편집 순서(editOrder)를 헛되이 섞지 않는다.
 */
function nextPatches(
  prev: Map<number, string>,
  block: Block,
  html: string,
  pristine: boolean
): Map<number, string> {
  // 제목처럼 호스트에서 직접 고치는 평문은 sourceText 와 비교한다.
  if (block.rcdata) {
    const next = new Map(prev);
    if (html === block.sourceText) next.delete(block.id);
    else next.set(block.id, html);
    return next;
  }
  // 프리뷰의 pristine 은 "편집을 열 때의 화면과 같다"는 뜻이다. 화면은 원본에
  // 패치를 얹은 모습이므로, 그대로 나온 것은 패치 상태도 그대로여야 한다 —
  // 여기서 패치를 지우면 이미 확정(또는 저장)한 편집이 저장 경로에서만 사라져,
  // 화면에는 남은 내용이 다음 저장에서 원본으로 되돌아간다 (화면과 저장본의 분열).
  // 브라우저가 직렬화한 값과 소스 문자열은 <br/> → <br> 같은 정규화 차이가 있어
  // 여기서 sourceInner 와 비교해 지울 수도 없다 — pristine 판정을 그대로 믿는다.
  if (pristine) return prev;
  return new Map(prev).set(block.id, html);
}

/** <title> 은 프리뷰에 렌더되지 않아 클릭이 닿지 않는다. 별도 필드로 편집한다 (spec §2.1) */
export function titleBlock(blocks: readonly Block[]): Block | undefined {
  return blocks.find((b) => b.rcdata);
}

/**
 * 되돌리기로 프리뷰에 보낼 블록 내용 (ADR-011).
 *
 * 원본 조각(`sourceInner`)을 그대로 보내면 프리뷰의 자원 치환이 풀려, 되돌린 블록의
 * 참조가 앱 주소 기준으로 풀리며 그림만 깨진다 — 경계로 치환한 뒤에 내보낸다.
 */
function previewInner(s: Pick<EditorState, 'boundary'>, block: Block | undefined): string {
  if (!block) return '';
  return s.boundary?.toPreview(block.sourceInner, block.innerStart) ?? block.sourceInner;
}

/**
 * 문서를 바꾸는 일을 새로 시작하면 안 되는 동안 — 저장 중이거나 갈아 끼우는 중 (ADR-010).
 *
 * 열기·문서 고르기·폴더 연결·저장 버튼이 전부 이 하나를 본다. 화면마다 두 표시를
 * 제각기 조합하면 하나만 구독한 화면이 생겨, 흩어진 표시의 틈이 되살아난다.
 */
export function useEditorBusy(): boolean {
  const saving = useEditor((s) => s.saving);
  const replacing = useReplacement((s) => s.replacing);
  return saving || replacing;
}

/**
 * 확정된 갈아 끼우기 — 화면을 잠그고, 새 상태를 만들고, 아직 최신이면 설치한다.
 * 누가 이기고 무엇이 잠기는지는 예약(replacement.ts)이 정한다 (ADR-010).
 *
 * 이전 blob URL 은 설치 직전에 놓아준다 — 안 놓으면 파일을 여러 번 열수록 탭이
 * 무거워지고, 먼저 놓으면 만들다 실패했을 때 살아 있어야 할 화면이 그 blob 을 쓴다.
 *
 * 만드는 사이 더 새 예약이 들어왔으면 설치하지 않고 `null` 로 물러난다. 그때
 * 지금 상태의 자원은 보던 문서(또는 그 새 흐름이 세울 문서)의 것이라 놓아줄
 * 권리가 없다 — **제가 만든 것만** 놓아준다 (spec §5 · 갈아 끼우기 예약).
 *
 * 설치는 저장 중 표시도 함께 내린다 — 아직 쓰는 중인 저장은 이 순간부터 이전
 * 문서의 것이라(claim) 제 표시를 내릴 자격을 잃는다. 새 문서는 저장 중이 아니다.
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
  // 설치 세대를 올린다 — 이 순간부터 이전 문서 몫의 비동기 결과(뒤늦게 끝난
  // 저장 등)는 claim 의 판정에 걸려 버려진다 (spec §5).
  mine.install();
  set({ ...next, saving: false, pendingText: null });
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
  handles?: ReadonlyMap<string, OpenedFile['handle']>,
  /**
   * 이 파일이 묶음의 그 경로 **그 자체**인가. 폴더 연결의 자리 되찾기(rebasePath)는
   * 증명 없는 추측이라, 같은 파일임을 증명하지 못하면 false 로 온다 — 그때 경로는
   * 자원을 찾는 기준(docDir)으로만 쓰고 묶음 경로(docPath)로는 삼지 않는다. 삼으면
   * 저장이 그 경로의 묶음 내용을 이 문서의 결과물로 갈아 끼워 폴더의 **다른** 문서를
   * 바꿔치기하고, 목록에서 그 문서를 여는 길도 "이미 열려 있다" 며 막힌다 (spec §5.1).
   */
  member = true
): Promise<Partial<EditorState>> {
  const [
    { parseBlocks },
    { buildPreviewDocument },
    {
      assetBoundary,
      assetSwaps,
      cssAssetPaths,
      dirOf,
      documentBaseDir,
      parseAssetRefs,
      styleTexts,
    },
    { buildAssets },
  ] = await Promise.all([
    import('@/core/parse'),
    import('@/lib/preview'),
    import('@/core/assets'),
    import('@/lib/assets'),
  ]);
  const docPath = member ? (file.path ?? '') : '';
  const docDir = dirOf(file.path ?? file.name);
  const blocks = parseBlocks(file.text);
  // 문서가 <base href> 로 기준을 옮겨 두면 상대 참조는 문서 자리가 아니라 거기서
  // 풀린다 (spec §5.1). 바깥을 가리키면(null) 상대 참조는 로컬 파일이 아니라
  // 붙일 것도, 없다고 셀 것도 없다 — 프리뷰는 문서를 그대로 보여준다.
  const baseDir = documentBaseDir(file.text, docDir);
  const refs = baseDir === null ? [] : parseAssetRefs(file.text, baseDir);
  // 속성 · 문서에 박힌 <style> · 붙인 스타일시트가 부르는 것까지 한자리에 모은다.
  const inStyle =
    baseDir === null ? [] : styleTexts(file.text).flatMap((css) => cssAssetPaths(css, baseDir));
  const assets =
    files && baseDir !== null
      ? await buildAssets(files, [...refs.map((r) => r.path), ...inStyle])
      : EMPTY_BUNDLE;
  const assetPaths = [...new Set([...refs.map((r) => r.path), ...inStyle, ...assets.missing])];
  // 프리뷰 문서와 양방향 경계가 **같은 치환 목록**을 쓴다 (ADR-011) — 따로 계산하면
  // 나갈 때의 표기와 되돌릴 표기가 어긋나는 짝이 생긴다. base 가 바깥을 가리키면
  // 치환할 것이 없다 — <style> 의 url() 까지 문서 기준이라, 문서 자리 기준으로
  // 바꾸면 틀린 자원을 붙인다.
  const swaps =
    baseDir === null ? [] : assetSwaps(file.text, refs, baseDir, (p) => assets.urls.get(p));

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
    previewDoc: buildPreviewDocument(file.text, blocks, swaps),
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

/** 폴더 훑기가 실패했다는 표식 — null(폴더가 아니었다)과 구별해야 파일 열기로 새지 않는다 */
const scanFailed = Symbol('scan-failed');

/** OS 가 건넨 파일의 읽기가 실패했다는 표식 — 실패는 만들어진 자리에서 이미 알렸다 */
const readFailed = Symbol('read-failed');

/**
 * 폴더에서 문서를 못 찾았을 때 — 스캔이 잘렸으면 그 사정을 함께 말한다 (spec §5.1).
 * "문서가 없다" 라고만 하면 거짓말일 수 있다 — 문서는 한도 밖에 있었을 수 있다.
 */
function folderFailedNotice(e: unknown, read: FolderRead | null): Notice {
  if (e instanceof BundleEmptyError && read?.truncated) {
    return { key: 'notice.bundleNoDocumentTruncated', params: { count: read.files.size } };
  }
  return openFailedNotice(e);
}

/**
 * 문서가 없는 상태.
 *
 * 처음 화면과 **닫은 뒤**가 같아야 하므로 한 곳에서 만든다. 두 벌로 두면 새 상태가
 * 늘 때마다 한쪽만 고쳐져, 닫았는데 이전 문서의 무언가가 남는다.
 */
function emptyDocument(): Partial<EditorState> {
  return {
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
    // 예약은 사용자 행동의 순간에 — 대화상자·물음·저장을 기다리기 전에 (spec §5).
    const mine = reserveReplacement();
    try {
      // 대화상자를 **먼저** 연다. 저장을 기다린 뒤에 열면 그 사이 사용자 제스처가
      // 만료돼 브라우저가 대화상자를 거절한다 (File System Access API 는 제스처를 요구한다).
      const picked = await pickFile();
      if (!picked) return;
      // 대화상자가 열려 있는 사이에도 더 새 흐름(드롭·OS 열기)은 시작된다. 밀려난
      // 채 물으면 이 물음이 최신 흐름의 물음을 취소하고, 저장으로 답하면 밀려난
      // 흐름이 save() 를 불러 사용자의 마지막 선택이 사라진다 — 묻기 전에 물러난다 (spec §5).
      if (!mine.current()) return;
      // 묻는 동안에는 잠그지 않는다. 잠그면 대화상자의 "저장하고 계속하기" 가
      // 눌리지 않아 남는 선택지가 버리기와 취소뿐이 된다.
      if (!(await keepEdits({ key: 'confirm.whyOpen' }, mine))) return;
      // 대화상자·물음·저장을 기다리는 사이 더 새 흐름이 시작됐으면 물러난다.
      if (!mine.current()) return;
      await replace(get, set, mine, openPicked(picked));
    } catch (e) {
      // 브라우저가 던진 원문은 번역하지 않고 그대로 붙인다 (spec §1 · UI 언어).
      // 밀려난 흐름의 실패는 남(최신 흐름)의 화면에 대한 말이 된다 — 알리지 않는다.
      if (mine.current()) set({ notice: openFailedNotice(e) });
    } finally {
      mine.release();
    }
  },

  // OS 가 열어준 파일(PWA file_handlers)을 받는다.
  // load 가 파서 청크를 받아오므로 여기도 실패할 수 있다 — 조용히 굳지 않게 감싼다 (ADR-008).
  adopt: async (file) => {
    // 예약은 OS 가 파일을 건넨 순간에 — 읽기·물음·저장을 기다리기 전에 (spec §5).
    // 읽기가 끝난 뒤에 예약하면, 읽는 사이 사용자가 연 더 새 흐름을 이 흐름이
    // 밀어내 사용자의 마지막 선택이 조용히 버려진다.
    const mine = reserveReplacement();
    // 읽기 실패는 만들어진 자리에서 바로 받는다 — 물음을 취소하면 아무도 이 프라미스를
    // 기다리지 않아, 답을 기다린 뒤에 잡으면 실패가 알림 없이 사라진다 (unhandled
    // rejection). 밀려난 흐름의 실패는 알리지 않는다 — 남(최신 흐름)의 화면에 대한
    // 말이 된다 (spec §5 · 갈아 끼우기 예약).
    const reading: Promise<OpenedFile | typeof readFailed> = Promise.resolve(file).catch(
      (e: unknown) => {
        if (mine.current()) get().failedToOpen(e);
        return readFailed;
      }
    );
    try {
      // OS 가 파일을 들려 보냈어도 다른 파일 열기다. 들어오는 길이 다르다고
      // 지금 고치던 것을 조용히 버릴 이유는 못 된다 (spec §4 · 저장하지 않은 편집).
      if (!(await keepEdits({ key: 'confirm.whyOpen' }, mine))) return;
      // 물음·저장을 기다리는 사이 더 새 흐름이 시작됐으면 물러난다 (spec §5).
      if (!mine.current()) return;
      // 답한 순간부터 잠근다 — 읽기가 끝나기를 기다리는 사이의 편집도 새 상태가
      // 설치되는 순간 갈 곳이 없다 (spec §4 · 갈아 끼우는 동안은 편집을 받지 않는다).
      mine.engage();
      const opened = await reading;
      // 읽다 실패한 것은 위에서 이미 알렸다. 여기서 또 알리면 두 번 뜬다.
      if (opened === readFailed) return;
      // 읽기를 기다리는 사이도 마찬가지다 — 밀려났으면 설치도 알림도 남의 몫이다.
      if (!mine.current()) return;
      set({ notice: null });
      await replace(get, set, mine, load(opened));
    } catch (e) {
      if (mine.current()) set({ notice: openFailedNotice(e) });
    } finally {
      mine.release();
    }
  },

  openDropped: async (file, folder) => {
    // 예약은 놓은 순간에 — 훑기·물음·저장을 기다리기 전에 (spec §5 · 갈아 끼우기 예약).
    const mine = reserveReplacement();
    set({ notice: null });
    // 훑기 실패는 만들어진 자리에서 바로 받는다 — 물음을 취소하면 아무도 이 프라미스를
    // 기다리지 않아, 답을 기다린 뒤에 잡으면 실패가 알림 없이 사라진다 (unhandled
    // rejection). 취소했더라도 훑기가 실패한 사실은 알린다 (대원칙 3 · spec §5.1).
    // 단, 밀려난 드롭의 실패는 알리지 않는다 — 남(최신 흐름)이 멀쩡히 세운 문서
    // 위에 "못 열었다" 가 뜬다 (spec §5 · 갈아 끼우기 예약). 취소는 예약을 새로
    // 만들지 않으므로, 취소한 경우의 알림은 그대로 살아 있다.
    const scanned: Promise<FolderRead | null | typeof scanFailed> = folder.catch((e: unknown) => {
      if (mine.current()) get().failedToOpen(e);
      return scanFailed;
    });
    try {
      // 새 파일을 열면 지금 편집은 사라진다. 조용히 버리지 않는다.
      if (!(await keepEdits({ key: 'confirm.whyOpen' }, mine))) return;
      // 물음·저장을 기다리는 사이 더 새 흐름이 시작됐으면 이 드롭은 밀려났다.
      if (!mine.current()) return;
      // 답한 순간부터 잠근다 — 훑기가 끝나기를 기다리는 사이의 편집도 새 상태가
      // 설치되는 순간 갈 곳이 없다 (spec §4 · 갈아 끼우는 동안은 편집을 받지 않는다).
      mine.engage();
      const read = await scanned;
      // 훑다 실패한 것은 위에서 이미 알렸다. 파일 열기로 넘어가지 않는다 —
      // 놓은 것이 폴더였을 수 있고, 폴더를 문서로 여는 것은 오류를 덧씌우는 일이다.
      if (read === scanFailed) return;
      // 훑기를 기다리는 사이도 마찬가지다 — 밀려났으면 설치도 알림도 남의 몫이다.
      if (!mine.current()) return;
      // 폴더를 놓았는지는 스토어가 가린다. 폴더가 아니었으면 파일로 연다.
      // 같은 예약을 들려 보낸다 — 새로 예약하면 이 흐름이 저 자신을 밀어내는
      // 모양이 되고, 그 사이의 틈은 주석이 아니라 예약이 막아야 한다 (ADR-010).
      if (!(await get().loadFolder(read, mine)) && file) await get().loadDropped(file, mine);
    } finally {
      mine.release();
    }
  },

  // 폴더를 놓으면 그 안의 문서를 연다. 옛 드롭 API 는 쓰기 권한을 주지 않으므로
  // 저장은 사본 내려받기로 간다 — 자원을 붙여 보는 데는 그것으로 충분하다.
  loadFolder: async (read, within) => {
    if (!read) return false;
    const mine = within ?? reserveReplacement();
    set({ notice: null });
    try {
      const next = await replace(get, set, mine, openBundle(read.files, undefined, read.handles));
      // 물러난 흐름의 뒷말(잘림 알림)은 남이 세운 화면에 대한 말이 된다 — 설치한 쪽만 말한다.
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
      // 파싱 실패를 삼키면 파일을 놓아도 아무 일도 안 일어나는 것처럼 보인다.
      if (mine.current()) set({ notice: openFailedNotice(e) });
    } finally {
      mine.release();
    }
  },

  // 렌더 결과와 소스를 대조해 스크립트가 만든 블록을 잠근다 (ADR-005).
  onReady: (live) => {
    // Map 으로 추리지 않고 겹침째로 넘긴다 — 같은 id 의 표식이 둘이면 문서가
    // 마커를 흉내 낸 것이고, 그 판정(MARKER_CLASH)은 core 의 몫이다 (spec §3).
    const blocks = applyLiveLocks(get().blocks, live);
    // 뒤늦게 잠긴 블록의 패치를 그대로 두면 저장 때 applyPatches 가 목록 전체를
    // 거부해 멀쩡한 편집까지 함께 죽는다 (INV-5).
    const lockedIds = new Set(blocks.filter((b) => b.locked !== null).map((b) => b.id));
    const dropped = [...get().patches.keys()].filter((id) => lockedIds.has(id));
    const patches = new Map([...get().patches].filter(([id]) => !lockedIds.has(id)));
    const editOrder = get().editOrder.filter((id) => patches.has(id));
    // 정상 경로에서는 지울 패치가 없다 — 대조 전에는 편집이 열리지 않는다 (spec §4).
    // 그래도 지워야 한다면 조용히 지우지 않는다: 프리뷰도 소스 내용으로 되돌려
    // 화면과 저장본을 다시 맞추고, 되돌렸다는 사실을 알린다 (대원칙 3).
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
    // 패치가 빠졌으면 결과물도 달라졌을 수 있다 — 기준은 언제나 하나다 (spec §5).
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
    // 갈아 끼우는 동안의 편집은 새 상태가 설치되는 순간 갈 곳이 없다 (spec §4).
    // 제목 칸과 프리뷰는 이 동안 잠겨 있어, 여기 오는 것은 이미 열려 있던 블록의
    // 확정(blur·IME 마무리)뿐이다. 저장 중(saving)과 다르다 — 그 편집은 살아남는다.
    if (refuseWhileReplacing('app.editWhileReplacing')) return;
    const block = get().blocks.find((b) => b.id === id);
    if (!block || block.locked !== null) return;
    // 프리뷰에서 돌아온 내용은 경계를 지나 원문 표기로 돌아온다 (ADR-011 · INV-9) —
    // 블록 안에 치환된 자원이 있으면 innerHTML 에 blob URL 이 실려 있고, 그대로
    // 패치가 되면 탭을 닫는 순간 죽는 주소가 파일에 박힌다. 제목(rcdata)은 호스트
    // 입력 칸에서 오지만, 경계는 제 blob 표기만 만지므로 함께 지나도 그대로다.
    const restored = get().boundary?.fromPreview(html) ?? html;
    const before = get().patches;
    const patches = nextPatches(before, block, restored, pristine);
    // 눌렀다 그냥 빠져나온 것은 아무 일도 아니다 — 패치도, 편집 순서도, unsaved 도
    // 그대로 둔다. 여기서 뭐라도 만지면 "들어갔다 나오기" 가 상태를 바꾸는 일이 된다.
    if (patches === before) return;
    // 다시 고친 블록은 맨 뒤로 옮긴다 — 그것이 가장 최근 변경이다.
    const editOrder = get().editOrder.filter((x) => x !== id);
    if (patches.has(id)) editOrder.push(id);
    // 고쳤다가 파일과 같은 내용으로 되돌아온 것은 저장할 것이 아니다.
    // 결과물과 파일을 견줘야 맞게 읽힌다 (spec §5).
    set({ patches, editOrder, unsaved: differsFromDisk({ ...get(), patches }) });
  },

  // 갈아 끼우기 잠금은 예약의 release 가 내린다 — 여기서 내리면 겹쳐 도는 다른
  // 갈아 끼우기의 잠금을 남이 푸는 셈이다 (spec §5). 여기로 오는 실패(드롭한 폴더
  // 훑기 등)는 잠금을 세우기 전의 것이라 끌 것도 없다.
  failedToOpen: (e) => set({ notice: openFailedNotice(e) }),

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

  // 대조가 끝나기 전의 클릭 — 프리뷰는 편집을 열지 않았다. 왜 안 열리는지 말한다 (대원칙 3).
  onNotReady: () => {
    useToasts.getState().show({ key: 'app.editBeforeScan' }, 'locked');
  },

  // 패치만 지우면 프리뷰에는 고친 내용이 그대로 남는다. 그 블록을 다시 눌렀다
  // 빠져나오면 패치가 되살아나 프리뷰와 저장본이 영영 어긋난다.
  revert: (id) => {
    // 갈아 끼우는 동안의 되돌리기는 이전 문서를 고치는 일이다 — 바뀐 패치도, 프리뷰로
    // 보낼 되돌림도 설치 순간 갈 곳이 없다. 버튼은 잠겨 있지만 단축키(Ctrl+Z)는
    // 언제든 눌린다 (spec §4).
    if (refuseWhileReplacing('app.editWhileReplacing')) return;
    const { patches, blocks, revertQueue } = get();
    const next = new Map(patches);
    next.delete(id);
    const block = blocks.find((b) => b.id === id);
    set({
      patches: next,
      editOrder: get().editOrder.filter((x) => x !== id),
      // 소스 내용은 경계로 치환해 내보낸다 (ADR-011) — 원문 그대로 보내면 프리뷰의
      // blob 치환이 풀려 되돌린 블록의 그림만 깨진다.
      revertQueue: [...revertQueue, { id, html: previewInner(get(), block) }],
      // 되돌리기도 파일과 달라질 수 있는 일이다 — 이미 저장한 내용을 되돌린 것일 수
      // 있다. 반대로 저장한 적 없는 편집을 되돌렸으면 파일과 같아져 잃을 것이 없다.
      unsaved: differsFromDisk({ ...get(), patches: next }),
    });
  },

  revertAll: () => {
    // revert 와 같은 이유 — 갈아 끼우는 동안 이전 문서를 고치지 않는다 (spec §4).
    if (refuseWhileReplacing('app.editWhileReplacing')) return;
    const { patches, blocks, revertQueue } = get();
    const restored = [...patches.keys()].map((id) => ({
      id,
      // revert 와 같은 이유 — 프리뷰로 나가는 소스 내용은 경계로 치환한다 (ADR-011).
      html: previewInner(
        get(),
        blocks.find((b) => b.id === id)
      ),
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
    // 예약은 사용자 행동의 순간에 — 대화상자·훑기·물음을 기다리기 전에 (spec §5).
    const mine = reserveReplacement();
    // catch 에서도 스캔이 잘렸는지 봐야 한다 — 문서가 한도 밖에 있었을 수 있다.
    let read: FolderRead | null = null;
    try {
      // 파일 열기와 같은 이유로 대화상자가 먼저다.
      read = await pickFolder(null, 'readwrite');
      if (!read) return;
      // 대화상자에서 돌아오면 묻기 전에 최신인지부터 — 밀려난 물음은 최신 흐름의
      // 물음을 취소하고, 저장으로 답하면 밀려난 흐름이 save() 를 부른다 (spec §5).
      if (!mine.current()) return;
      if (!(await keepEdits({ key: 'confirm.whyOpen' }, mine))) return;
      // 대화상자·물음·저장을 기다리는 사이 더 새 흐름이 시작됐으면 물러난다.
      if (!mine.current()) return;
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
    // 예약은 사용자 행동의 순간에 — 대화상자·훑기·물음을 기다리기 전에 (spec §5).
    const mine = reserveReplacement();
    try {
      // 대화상자를 파일이 있던 자리에서 연다 — 대개 그 폴더가 정답이다.
      const read = await pickFolder(file.handle);
      if (!read) return;
      // 대화상자에서 돌아오면 묻기 전에 최신인지부터 — 밀려난 물음은 최신 흐름의
      // 물음을 취소하고, 저장으로 답하면 밀려난 흐름이 save() 를 부른다 (spec §5).
      if (!mine.current()) return;
      if (!(await keepEdits({ key: 'confirm.whyAssets' }, mine))) return;
      // 대화상자·물음·저장을 기다리는 사이 더 새 흐름이 시작됐으면 물러난다.
      if (!mine.current()) return;

      const loading = async (): Promise<Partial<EditorState>> => {
        // 지금 문서가 묶음에서 왔다면 그 경로는 옛 묶음 기준이다. 새로 고른 폴더 기준으로
        // 옮겨 줘야 한다 — 안 그러면 제 폴더를 골라 주고도 자원을 못 찾는다.
        // 파일 하나로 연 문서에는 묶음 경로가 아예 없다 — 그때는 이름이 곧 경로다
        // (OpenedFile.path 의 규칙 그대로). 경로 없이 두면 아래 keep 이 비어, 다른
        // 문서로 갔다 돌아올 때 핸들을 잃는다.
        const fresh = await reread(get().file ?? file);
        const rebased = { ...fresh, path: rebasePath(fresh.path ?? fresh.name, read.files) };
        // 연결로 받은 핸들은 묶음에 남기지 않는다. 이 길은 읽기 전용이라(read) 그 핸들로는
        // 저장이 거부되는데, 묶음의 핸들로 남으면 다른 문서로 갈아탈 때 file.handle 자리에
        // 들어가 "덮어쓰기" 라던 저장이 그제서야 실패한다.
        // 지금 문서의 핸들만은 남긴다 — 열 때 받은 쓰기 가능한 핸들이라, 버리면 다른
        // 문서로 갔다 돌아왔을 때 덮어쓰기가 조용히 사본 내려받기로 격하되고, 연결할 때
        // 읽어 둔 옛 바이트가 그 사이 저장한 내용을 덮는다 (spec §5.1 · 핸들 유지).
        // 단, **같은 파일임을 증명한 때에만** 남긴다. 경로가 겹친다고 같은 파일은 아니다 —
        // 기본명 폴백(rebasePath)이 고른 자리는 이름만 같은 남의 파일일 수 있고, 그 경로에
        // 이 쓰기 핸들을 걸면 갔다 돌아올 때 그 자리에서 이 파일이 대신 열리고 저장이
        // 남의 자리 내용을 덮는다. 증명할 수 없으면 남기지 않는 쪽이 낫다 (대원칙 3).
        const twin = rebased.path ? read.handles.get(rebased.path) : undefined;
        const proven =
          rebased.handle && twin ? ((await rebased.handle.isSameEntry?.(twin)) ?? false) : false;
        const keep =
          proven && rebased.path && rebased.handle
            ? new Map([[rebased.path, rebased.handle]])
            : undefined;
        // 증명 못 한 문서는 묶음의 일원도 아니다 — 되찾은 자리는 자원을 찾는 기준으로만
        // 쓴다. 묶음 경로로 삼으면 저장이 그 경로의 묶음 내용을 이 문서의 결과물로
        // 갈아 끼워, 폴더의 **다른** 문서를 바꿔치기한다 (spec §5.1).
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
   * 같은 묶음 안의 다른 문서로 갈아탄다 (spec §5.1).
   *
   * 이미 풀어 둔 파일을 그대로 쓴다 — zip 을 다시 푸는 것은 헛일이다.
   * 프리뷰를 다시 그리므로 편집은 사라진다. 버려도 되는지는 부르는 쪽이 먼저 묻는다.
   */
  /**
   * 열어 둔 문서를 닫고 처음 화면으로 돌아간다.
   *
   * 문서를 **바꾸는** 일이므로 여는 것과 같은 길을 지난다 — 사용자 행동의 순간에
   * 예약하고, 저장하지 않은 편집이 있으면 묻고, 자원을 놓아준다 (spec §5).
   * 닫기만 예외로 두면 그 자리에서 편집이 조용히 사라지고 blob 이 남는다.
   */
  closeFile: async () => {
    if (!get().file) return;

    set({ notice: null });
    const mine = reserveReplacement();
    try {
      if (!(await keepEdits({ key: 'confirm.whyClose' }, mine))) return;
      // 물음·저장을 기다리는 사이 더 새 흐름이 시작됐으면 물러난다.
      if (!mine.current()) return;
      await replace(get, set, mine, Promise.resolve(emptyDocument()));
    } catch (e) {
      if (mine.current()) set({ notice: openFailedNotice(e) });
    } finally {
      mine.release();
    }
  },

  openFromBundle: async (path) => {
    const { bundle, docPath } = get();
    if (!bundle || path === docPath) return;

    set({ notice: null });
    // 예약은 사용자 행동의 순간에 — 물음·저장을 기다리기 전에 (spec §5).
    const mine = reserveReplacement();
    try {
      if (!(await keepEdits({ key: 'confirm.whySwitch', params: { path } }, mine))) return;
      // 물음·저장을 기다리는 사이 더 새 흐름이 시작됐으면 물러난다.
      if (!mine.current()) return;
      // 물음에 저장으로 답했으면 묶음이 방금 그 결과물로 갈렸다 (내려받기 저장은
      // 묶음이 유일한 원천이다, spec §5). 멈추기 전에 받아 둔 묶음을 그대로 쓰면
      // 설치가 저장 전 바이트를 되살려, 돌아왔을 때 저장한 내용이 조용히 사라진다.
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
    // 파일과 다른 것이 없으면 아무 일도 하지 않는다. 버튼은 이미 비활성이지만
    // 단축키는 언제든 눌리므로, 같은 내용을 다시 쓰는 헛일을 여기서 막는다.
    //
    // 패치 개수로 거르면 안 된다 (spec §5). 이미 저장한 편집을 되돌리면 패치는 0개인데
    // 파일에는 옛 편집이 남아 있다 — 그때 여기서 false 로 나가면 "저장하고 계속하기" 가
    // 쓸 것이 없다며 멈춰, 대화상자에서 빠져나갈 길이 취소와 버리기뿐이 된다.
    // 패치 0개의 저장은 원본 그대로를 되써서 파일을 화면과 같게 만든다.
    //
    // 저장이 파일을 쓰는 동안의 저장은 시작하지 않는다 (spec §5). 쓰는 사이 편집하면
    // unsaved 가 다시 서서 Ctrl+S 가 여기까지 오는데, 겹쳐 돌면 두 저장이 서로 다른
    // 스냅샷을 나란히 쓰다 끝나는 순서에 따라 옛 결과물이 디스크에서 이긴다.
    // 잃는 것은 없다 — 도는 저장이 끝나면 그 편집은 저장 안 된 것으로 남는다.
    if (!file || !unsaved || saving) return false;
    // 쓰는 동안 다른 문서로 갈아탈 수 있다. 뒤늦게 도착한 결과가 새 문서의 상태에
    // 옛 결과물을 적지 않도록, 시작하기 전에 지금 문서의 세대를 받아 둔다 (spec §5).
    const mine = claimDocument();
    set({ saving: true, notice: null });
    try {
      const list = [...patches].map(([id, newInnerHtml]) => ({ id, newInnerHtml }));
      const output = applyPatches(source, blocks, list);
      // 이제부터 파일은 이 결과물을 향해 간다 — 쓰는 사이의 편집·되돌리기가
      // "파일과 다른가" 를 잴 때의 기준이다 (spec §5). 옛 savedText 로 재면 쓰는
      // 사이에 되돌린 편집이 잃을 것 없음으로 읽혀 경고 없이 탭이 닫힌다.
      set({ pendingText: output });
      const how = await saveFile(file, output);
      // 갈아탄 뒤 도착한 결과는 이전 문서의 것이다. 파일에는 이미 썼고 그것은 그
      // 파일의 몫이라 잃는 것이 없다 — 새 문서에 적을 것은 아무것도 없다.
      if (!mine()) return false;
      set((s) => ({
        // 파일은 이제 방금 쓴 결과물을 들고 있다. 쓰는 동안에도 프리뷰는 편집할 수
        // 있으므로, 지금 상태를 그 결과물과 다시 견준다 — 그 사이 확정된 편집은
        // 파일에 없으니 더러운 채로 남고, 아무 일도 없었으면 깨끗해진다.
        savedText: output,
        // 방금 쓴 결과물에 들어간 패치들 — 물음의 "{count}곳" 이 지금 패치와 이것의
        // 차이를 센다 (spec §4). 쓰는 동안 확정된 편집은 여기 없으니 다른 곳으로 남는다.
        savedPatches: new Map(patches),
        // 핸들 없는 문서는 내려받은 사본이 곧 파일의 내용이다 (spec §5). 메모리의
        // text 를 옛것으로 두면, 폴더 연결이 reread 로 그 옛 내용을 그대로 받아
        // 저장 전 화면으로 되돌아간다 — 핸들이 있으면 디스크에서 다시 읽어 맞춘다.
        file: s.file && !s.file.handle ? { ...s.file, text: output } : s.file,
        // 묶음에서 온 문서면 묶음의 바이트도 결과물로 갈아 끼운다. 열 때의 바이트를
        // 그대로 두면 다른 문서로 갔다 돌아올 때 그 옛 바이트가 다시 열려, 내려받기로
        // 저장한 편집이 화면에서 조용히 사라진다 — 핸들이 있으면 디스크에서 다시
        // 읽어(reread) 맞추지만, 내려받기 저장은 이 묶음이 유일한 원천이다.
        bundle: s.bundle?.has(s.docPath)
          ? new Map(s.bundle).set(s.docPath, new Blob([output], { type: 'text/html' }))
          : s.bundle,
        // 쓰기가 끝났다 — 기준은 이제 savedText(방금 쓴 결과물) 그 자체다.
        pendingText: null,
        unsaved: differsFromDisk({ ...s, savedText: output, pendingText: null }),
        notice: {
          key: how === 'overwritten' ? 'notice.saved' : 'notice.downloaded',
          params: { name: file.name, count: list.length },
        },
      }));
      return true;
    } catch (e) {
      // 실패도 이전 문서의 것이면 알리지 않는다 — 파일 이름도 없는 실패 알림은
      // 지금 문서의 일로 읽혀, 멀쩡한 새 문서를 두고 사용자를 헤매게 한다.
      if (mine()) {
        set((s) => ({
          // 쓰기가 실패했다 — 파일은 옛 내용 그대로다 (쓰기는 닫을 때 확정된다).
          // 쓰는 사이 결과물 기준으로 잰 unsaved 를 옛 기준으로 다시 잰다. 안 그러면
          // 쓰는 사이의 편집이 실패한 결과물과 같다는 이유로 저장된 척 남는다.
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
      // 저장이 내리는 것은 **제 표시(saving)뿐**이다. 갈아 끼우기 잠금(replacing)은
      // 예약이 들고 있어, 새 갈아 끼우기가 도는 사이에 앞선 저장이 끝나도 화면이
      // 풀리지 않는다 (spec §5 · 갈아 끼우기 예약). 갈아탄 뒤에 도착했으면(mine 이
      // 아니면) 이 saving 도 이전 문서의 것이다 — 설치가 이미 내렸으니 두고 간다.
      if (mine()) set({ saving: false });
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
