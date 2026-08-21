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
  'app.emptyTitle': 'HTML 파일이나 zip, 폴더를 여기에 끌어다 놓으세요',
  'app.emptyHint': '글자를 눌러 고치면, 저장할 때 고친 부분만 바뀌어요',
  'app.blocked': '여기는 고칠 수 없어요 · {reason}',

  'toolbar.openFile': '파일 열기',
  'toolbar.openFileHint': 'HTML 파일 하나, 또는 zip 을 엽니다',
  'toolbar.openFolder': '폴더 열기',
  'toolbar.openFolderHint': '폴더를 통째로 열어 옆 파일까지 함께 읽어요',
  'toolbar.title': '제목',
  'toolbar.document': '문서가 {count}개예요. 열 문서를 고르세요',
  'toolbar.save': '저장',
  'toolbar.downloadCopy': '사본 내려받기',
  'toolbar.notEditable': '고칠 수 없어요 · {reason}',
  'toolbar.droppedNoOverwrite': '끌어다 놓은 파일은 덮어쓸 수 없어요',
  'toolbar.noOverwriteSupport': '이 브라우저는 덮어쓰기를 지원하지 않아요',

  'preview.title': '프리뷰',

  'confirm.title': '저장하지 않은 변경이 있어요',
  'confirm.body': '{count}곳을 고쳤어요. {why}',
  'confirm.whyOpen': '새 파일을 열면 고친 내용이 사라져요.',
  'confirm.whySwitch': '{path} 문서로 옮기면 고친 내용이 사라져요.',
  'confirm.whyAssets': '외부 파일을 붙이려면 프리뷰를 다시 그려야 해서, 고친 내용이 사라져요.',
  'confirm.save': '저장하고 계속하기',
  'confirm.saveCopy': '사본 받고 계속하기',
  'confirm.discard': '버리고 계속하기',
  'confirm.cancel': '취소',

  'changes.blocks': '블록',
  'changes.total': '전체 {count}개',
  'changes.editable': '고칠 수 있는 곳 {count}개',
  'changes.scanning': '살펴보는 중…',
  'changes.lockedReasons': '고칠 수 없는 이유',
  'changes.none': '없음',
  'changes.changed': '고친 곳 {count}개',
  'changes.revert': '되돌리기',
  'changes.revertAll': '전체 되돌리기',
  'changes.empty': '아직 고친 곳이 없어요. 프리뷰에서 글자를 눌러 보세요.',

  'lock.RAW_TEXT': '코드 영역',
  'lock.SCRIPT_GENERATED': '스크립트가 만든 글자',
  'lock.EMPTY_IN_SOURCE': '원본에는 비어 있는 자리',
  'lock.CODE_BLOCK': '코드 블록',
  'lock.AMBIGUOUS': '고칠 범위가 불분명',

  'notice.openFailed': '파일을 열지 못했어요',
  'notice.openFailedDetail': '파일을 열지 못했어요: {detail}',
  'notice.saved': '{name} 파일에 저장했어요 (고친 곳 {count}개)',
  'notice.downloaded': '{name} 파일로 내려받았어요. 이 브라우저는 원본 덮어쓰기를 지원하지 않아요',
  'notice.copyDownloaded': '{name} 사본을 내려받았어요 (고친 곳 {count}개 반영)',
  'notice.saveRejected': '저장하지 않았어요: {detail}',
  'notice.saveFailed': '저장하지 못했어요',
  'notice.assetsLinked': '외부 파일 {count}개를 붙였어요',
  'notice.assetsNotFound': '이 폴더에서는 찾는 파일이 없었어요',
  'notice.folderTruncated': '폴더가 커서 {count}개까지만 읽었어요',
  'notice.folderUnsupported': '이 브라우저는 폴더 열기를 지원하지 않아요',
  'notice.bundlePicked': '문서가 {count}개예요. 우선 {path}부터 열었어요',
  'notice.bundleNoDocument': '여기에서 HTML 문서를 찾지 못했어요',

  'assets.missing':
    '옆에 있어야 할 파일 {count}개를 못 찾았어요. 화면만 달라 보일 뿐, 고치고 저장하는 데는 문제없어요',
  'assets.link': '폴더 연결하기',
  'assets.linking': '읽는 중…',

  'patch.unknownId': '모르는 블록이에요 (id={id})',
  'patch.locked': '고칠 수 없는 블록이에요 (id={id}, {reason})',
  'patch.stale': '블록이 원본과 맞지 않아요 (id={id})',
  'patch.duplicate': '같은 블록에 변경이 두 번 들어 있어요 (id={id})',

  'theme.toLight': '밝은 테마로 바꾸기',
  'theme.toDark': '어두운 테마로 바꾸기',
  'locale.select': '언어',
} as const;

export type MessageKey = keyof typeof ko;

/** 사전 점검용 키 목록 — 테스트가 두 언어의 완전성과 자리표시자 짝을 대조한다 */
export const MESSAGE_KEYS = Object.keys(ko) as MessageKey[];

const en: Record<MessageKey, string> = {
  'app.emptyTitle': 'Drag an HTML file, a zip, or a folder here',
  'app.emptyHint': 'Click any text to edit it. Saving changes only what you edited.',
  'app.blocked': "You can't edit this one · {reason}",

  'toolbar.openFile': 'Open a file',
  'toolbar.openFileHint': 'Opens one HTML file, or a zip',
  'toolbar.openFolder': 'Open a folder',
  'toolbar.openFolderHint': 'Opens a whole folder, reading the files next to it too',
  'toolbar.title': 'Title',
  'toolbar.document': '{count} documents in here. Pick one to open',
  'toolbar.save': 'Save',
  'toolbar.downloadCopy': 'Download a copy',
  'toolbar.notEditable': "Can't be edited · {reason}",
  'toolbar.droppedNoOverwrite': "Dropped files can't be overwritten",
  'toolbar.noOverwriteSupport': "This browser can't overwrite files",

  'preview.title': 'Preview',

  'confirm.title': 'You have unsaved changes',
  'confirm.body': 'Unsaved edits: {count}. {why}',
  'confirm.whyOpen': 'Opening another file will lose them.',
  'confirm.whySwitch': 'Switching to {path} will lose them.',
  'confirm.whyAssets': 'Attaching files redraws the preview, which will lose them.',
  'confirm.save': 'Save and continue',
  'confirm.saveCopy': 'Download a copy and continue',
  'confirm.discard': 'Discard and continue',
  'confirm.cancel': 'Cancel',

  'changes.blocks': 'Blocks',
  'changes.total': '{count} total',
  'changes.editable': '{count} editable',
  'changes.scanning': 'Checking…',
  'changes.lockedReasons': "Why you can't edit these",
  'changes.none': 'None',
  'changes.changed': '{count} edited',
  'changes.revert': 'Revert',
  'changes.revertAll': 'Revert all',
  'changes.empty': 'Nothing yet. Click some text in the preview to start.',

  'lock.RAW_TEXT': 'Code area',
  'lock.SCRIPT_GENERATED': 'Written by a script',
  'lock.EMPTY_IN_SOURCE': 'Empty in the original',
  'lock.CODE_BLOCK': 'Code block',
  'lock.AMBIGUOUS': 'Unclear range',

  'notice.openFailed': "Couldn't open that file",
  'notice.openFailedDetail': "Couldn't open that file: {detail}",
  'notice.saved': 'Saved to {name} ({count} edited)',
  'notice.downloaded': "Downloaded {name}. This browser can't overwrite the original",
  'notice.copyDownloaded': 'Downloaded a copy of {name} ({count} edited)',
  'notice.saveRejected': "Didn't save: {detail}",
  'notice.saveFailed': "Couldn't save",
  'notice.assetsLinked': 'External files attached: {count}',
  'notice.assetsNotFound': "That folder didn't have the files this document asks for",
  'notice.folderTruncated': 'That folder is large, so only the first {count} files were read',
  'notice.folderUnsupported': "This browser can't open folders",
  'notice.bundlePicked': '{count} documents in here. Opened {path} first',
  'notice.bundleNoDocument': "Couldn't find an HTML document in here",

  'assets.missing':
    'Missing files this document expects next to it: {count}. Only the preview looks different; editing and saving are exact',
  'assets.link': 'Link a folder',
  'assets.linking': 'Reading…',

  'patch.unknownId': "Don't know that block (id={id})",
  'patch.locked': "That block can't be edited (id={id}, {reason})",
  'patch.stale': "That block doesn't match the original (id={id})",
  'patch.duplicate': 'Two changes for the same block (id={id})',

  'theme.toLight': 'Switch to the light theme',
  'theme.toDark': 'Switch to the dark theme',
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
