/**
 * 언어팩 — 화면에 뜨는 모든 문구의 유일한 출처 (docs/spec.md §1 · UI 언어).
 *
 * `ko` 가 원본이고 `en` 은 `Record<MessageKey, string>` 이라, 키를 하나 빠뜨리면
 * 런타임에 한국어가 새는 대신 타입 검사에서 걸린다.
 *
 * 알림은 완성된 문장이 아니라 `Notice` (키 + 파라미터)로 옮긴다. 스토어가 문장을
 * 만들어 두면 언어를 바꿔도 이미 떠 있는 알림은 옛 언어로 남는다.
 */
import type { LockReason } from '@/core/types';
import type { PatchErrorCode } from '@/core/patch';

export type Locale = 'ko' | 'en';

export const LOCALES: readonly Locale[] = ['ko', 'en'];

/**
 * 언어 이름은 **그 언어로** 적는다. 못 읽는 언어로 적어두면 고를 수가 없다.
 * 그래서 사전(ko/en)이 아니라 언어와 무관한 상수다.
 */
export const LOCALE_LABEL: Record<Locale, string> = { ko: '한국어', en: 'English' };

export function isLocale(value: unknown): value is Locale {
  return value === 'ko' || value === 'en';
}

const ko = {
  'app.emptyTitle': '한 파일로 된 HTML 을 여기에 놓거나 열기를 누른다',
  'app.emptyHint': '글자를 클릭해 고치고, 저장하면 원본에서 고친 부분만 바뀐다',
  'app.blocked': '이 블록은 편집할 수 없다 — {reason}',

  'toolbar.open': '열기',
  'toolbar.title': '제목',
  'toolbar.save': '저장',
  'toolbar.downloadCopy': '사본 내려받기',
  'toolbar.notEditable': '편집할 수 없다 — {reason}',
  'toolbar.droppedNoOverwrite': '드롭한 파일은 덮어쓸 수 없다',
  'toolbar.noOverwriteSupport': '이 브라우저는 덮어쓰기 미지원',

  'preview.title': '프리뷰',

  'confirm.discard': '저장하지 않은 변경이 {count}개 있다. 버리고 새 파일을 열까?',
  'confirm.discardForAssets':
    '저장하지 않은 변경이 {count}개 있다. 자원을 붙이려면 프리뷰를 다시 그려야 해서 사라진다. 계속할까?',

  'changes.blocks': '블록',
  'changes.total': '전체 {count}',
  'changes.editable': '편집 가능 {count}',
  'changes.scanning': '대조 중…',
  'changes.lockedReasons': '잠긴 이유',
  'changes.none': '없음',
  'changes.changed': '변경 {count}',
  'changes.revert': '되돌리기',
  'changes.revertAll': '전체 되돌리기',
  'changes.empty': '아직 없다. 프리뷰에서 글자를 눌러 고칠 수 있다.',

  'lock.RAW_TEXT': '코드 영역',
  'lock.SCRIPT_GENERATED': '스크립트가 생성',
  'lock.EMPTY_IN_SOURCE': '소스에서 비어 있음',
  'lock.CODE_BLOCK': '코드 블록',
  'lock.AMBIGUOUS': '범위 불확정',

  'notice.openFailed': '파일을 열지 못했다',
  'notice.openFailedDetail': '열지 못했다: {detail}',
  'notice.saved': '{name} 에 저장했다 ({count}개 블록)',
  'notice.downloaded': '{name} 을 내려받았다 — 이 브라우저는 덮어쓰기를 지원하지 않는다',
  'notice.copyDownloaded': '{name} 사본을 내려받았다 ({count}개 블록 반영)',
  'notice.saveRejected': '저장 거부: {detail}',
  'notice.saveFailed': '저장하지 못했다',
  'notice.assetsLinked': '외부 파일 {count}개를 붙였다',
  'notice.assetsNotFound': '이 폴더에서 참조된 파일을 찾지 못했다',
  'notice.folderTruncated': '폴더가 너무 커서 {count}개까지만 읽었다',
  'notice.folderUnsupported': '이 브라우저는 폴더 열기를 지원하지 않는다',

  'assets.missing':
    '외부 파일 {count}개를 불러오지 못했다 — 화면만 다르게 보이고 편집·저장은 정확하다',
  'assets.link': '폴더 연결',
  'assets.linking': '읽는 중…',

  'patch.unknownId': '알 수 없는 블록 id: {id}',
  'patch.locked': '잠긴 블록은 수정할 수 없다: id={id} ({reason})',
  'patch.stale': '블록이 이 원본과 맞지 않는다 (stale): id={id}',
  'patch.duplicate': '같은 블록에 패치가 둘 이상 있다: id={id}',

  'theme.toLight': '밝은 테마로 바꾸기',
  'theme.toDark': '어두운 테마로 바꾸기',
  'locale.select': '언어',
} as const;

export type MessageKey = keyof typeof ko;

/** 사전 점검용 키 목록 — 테스트가 두 언어의 완전성과 자리표시자 짝을 대조한다 */
export const MESSAGE_KEYS = Object.keys(ko) as MessageKey[];

const en: Record<MessageKey, string> = {
  'app.emptyTitle': 'Drop a single-file HTML here, or click Open',
  'app.emptyHint': 'Click text to fix it — saving changes only what you edited',
  'app.blocked': "This block can't be edited — {reason}",

  'toolbar.open': 'Open',
  'toolbar.title': 'Title',
  'toolbar.save': 'Save',
  'toolbar.downloadCopy': 'Download a copy',
  'toolbar.notEditable': "Can't be edited — {reason}",
  'toolbar.droppedNoOverwrite': "Dropped files can't be overwritten",
  'toolbar.noOverwriteSupport': "This browser can't overwrite files",

  'preview.title': 'Preview',

  'confirm.discard': '{count} unsaved changes will be lost. Open another file anyway?',
  'confirm.discardForAssets':
    "{count} unsaved changes. Attaching assets redraws the preview, so they'll be lost. Continue?",

  'changes.blocks': 'Blocks',
  'changes.total': '{count} total',
  'changes.editable': '{count} editable',
  'changes.scanning': 'Checking…',
  'changes.lockedReasons': 'Why locked',
  'changes.none': 'None',
  'changes.changed': '{count} changed',
  'changes.revert': 'Revert',
  'changes.revertAll': 'Revert all',
  'changes.empty': 'Nothing yet. Click text in the preview to edit it.',

  'lock.RAW_TEXT': 'Raw text region',
  'lock.SCRIPT_GENERATED': 'Script-generated',
  'lock.EMPTY_IN_SOURCE': 'Empty in source',
  'lock.CODE_BLOCK': 'Code block',
  'lock.AMBIGUOUS': 'Ambiguous range',

  'notice.openFailed': "Couldn't open the file",
  'notice.openFailedDetail': "Couldn't open it: {detail}",
  'notice.saved': 'Saved to {name} ({count} blocks)',
  'notice.downloaded': "Downloaded {name} — this browser can't overwrite files",
  'notice.copyDownloaded': 'Downloaded a copy of {name} ({count} blocks applied)',
  'notice.saveRejected': 'Save rejected: {detail}',
  'notice.saveFailed': "Couldn't save",
  'notice.assetsLinked': 'Attached {count} external files',
  'notice.assetsNotFound': "Couldn't find the referenced files in that folder",
  'notice.folderTruncated': 'The folder is too large — read only the first {count} files',
  'notice.folderUnsupported': "This browser can't open folders",

  'assets.missing':
    "Couldn't load {count} external files — only the preview differs; editing and saving are exact",
  'assets.link': 'Link folder',
  'assets.linking': 'Reading…',

  'patch.unknownId': 'Unknown block id: {id}',
  'patch.locked': "Locked blocks can't be edited: id={id} ({reason})",
  'patch.stale': "Block doesn't match this source (stale): id={id}",
  'patch.duplicate': 'More than one patch for the same block: id={id}',

  'theme.toLight': 'Switch to light theme',
  'theme.toDark': 'Switch to dark theme',
  'locale.select': 'Language',
};

const DICT: Record<Locale, Record<MessageKey, string>> = { ko, en };

/** 파라미터 값은 중첩된 `Notice` 일 수 있다 — "저장 거부: {detail}" 처럼 사유가 또 문구일 때 */
export type Params = Record<string, string | number | Notice>;

/** 아직 번역되지 않은 알림. 스토어는 이걸 들고 있고, 문장은 그릴 때 만든다 */
export interface Notice {
  key: MessageKey;
  params?: Params;
}

/** 잠금 사유 → 메시지 키. 사유가 늘면 여기서 타입 오류가 난다 */
const LOCK_KEY: Record<LockReason, MessageKey> = {
  RAW_TEXT: 'lock.RAW_TEXT',
  SCRIPT_GENERATED: 'lock.SCRIPT_GENERATED',
  EMPTY_IN_SOURCE: 'lock.EMPTY_IN_SOURCE',
  CODE_BLOCK: 'lock.CODE_BLOCK',
  AMBIGUOUS: 'lock.AMBIGUOUS',
};

/** 패치 거부 코드 → 메시지 키. `core/` 는 언어를 모르므로 코드만 넘겨받는다 (INV-6) */
const PATCH_KEY: Record<PatchErrorCode, MessageKey> = {
  unknownId: 'patch.unknownId',
  locked: 'patch.locked',
  stale: 'patch.stale',
  duplicate: 'patch.duplicate',
};

export function lockNotice(reason: LockReason): Notice {
  return { key: LOCK_KEY[reason] };
}

function isLockReason(value: unknown): value is LockReason {
  return typeof value === 'string' && value in LOCK_KEY;
}

/** 잠금 사유가 섞여 있으면 코드(`CODE_BLOCK`)가 아니라 사람 말로 바꿔 끼운다 */
export function patchNotice(code: PatchErrorCode, params?: Params): Notice {
  const reason = params?.reason;
  if (isLockReason(reason))
    return { key: PATCH_KEY[code], params: { ...params, reason: lockNotice(reason) } };
  return { key: PATCH_KEY[code], params };
}

function fill(template: string, locale: Locale, params: Params): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    if (value === undefined) return whole;
    return typeof value === 'object' ? translate(locale, value.key, value.params) : String(value);
  });
}

/** 사전에 없는 키는 감추지 않고 키 그대로 보여준다 — 조용히 비는 것보다 낫다 (대원칙 3) */
export function translate(locale: Locale, key: MessageKey, params?: Params): string {
  const template = DICT[locale][key] ?? DICT.ko[key] ?? key;
  return params ? fill(template, locale, params) : template;
}

export type Translate = (key: MessageKey, params?: Params) => string;
