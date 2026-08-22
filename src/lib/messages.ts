/**
 * The language pack — the single source of every phrase on screen (docs/spec.md §1 · UI language).
 *
 * `ko` is the original and `en` is a `Record<MessageKey, string>`, so a missing
 * key is caught by the type checker instead of leaking Korean at runtime.
 *
 * Notifications travel as a `Notice` (key + params), not as finished sentences.
 * If a store built the sentence, notifications already on screen would stay in
 * the old language after a switch.
 */
import type { LockReason } from '@/core/types';
import type { PatchErrorCode } from '@/core/patch';
import type { ZipErrorCode } from '@/core/zip';

export type Locale = 'ko' | 'en';

export const LOCALES: readonly Locale[] = ['ko', 'en'];

/**
 * Language names are written **in their own language**. Written in a language the
 * user cannot read, they cannot be chosen. That is why this is a locale-independent
 * constant, not a dictionary (ko/en) entry.
 */
export const LOCALE_LABEL: Record<Locale, string> = { ko: '한국어', en: 'English' };

export function isLocale(value: unknown): value is Locale {
  return value === 'ko' || value === 'en';
}

const ko = {
  'app.emptyTitle': 'HTML 파일이나 zip, 폴더를 여기에 끌어다 놓으세요',
  'app.emptyHint': '글자를 눌러 고치면, 저장할 때 고친 부분만 바뀌어요',
  'app.blocked': '여기는 고칠 수 없어요 · {reason}',
  'app.editWhileReplacing': '다른 문서를 여는 중이라 이 편집은 반영되지 않았어요',
  'app.saveWhileReplacing': '다른 문서를 여는 중이라 지금은 저장할 수 없어요',
  'app.editBeforeScan': '아직 문서를 살펴보는 중이에요. 잠시 뒤에 다시 눌러 주세요',
  'app.editsReverted': '살펴보니 고칠 수 없는 곳이라, 고친 {count}곳을 원래대로 되돌렸어요',

  'toolbar.close': '닫기',
  'toolbar.openFile': '파일 열기',
  'toolbar.openFileHint': 'HTML 파일 하나, 또는 zip 을 엽니다',
  'toolbar.openFolder': '폴더 열기',
  'toolbar.openFolderHint': '폴더를 통째로 열어 옆 파일까지 함께 읽어요',
  'toolbar.title': '제목',
  'toolbar.document': '문서가 {count}개예요. 열 문서를 고르세요',
  'toolbar.save': '저장',
  'toolbar.downloadCopy': '사본 내려받기',
  'toolbar.repo': '깃허브에서 소스 보기',
  'toolbar.notEditable': '고칠 수 없어요 · {reason}',
  'toolbar.droppedNoOverwrite': '끌어다 놓은 파일은 덮어쓸 수 없어요',
  'toolbar.noOverwriteSupport': '이 브라우저는 덮어쓰기를 지원하지 않아요',

  'preview.title': '프리뷰',
  'toast.dismiss': '알림 닫기',

  'format.bold': '굵게',
  'format.italic': '기울임',
  'format.underline': '밑줄',
  'format.smaller': '작게',
  'format.bigger': '크게',
  'format.color': '글자 색',
  'format.clear': '서식 지우기',

  'confirm.title': '저장하지 않은 변경이 있어요',
  'confirm.body': '{count}곳을 고쳤어요. {why}',
  'confirm.whyOpen': '새 파일을 열면 고친 내용이 사라져요.',
  'confirm.whyClose': '문서를 닫으면 고친 내용이 사라져요.',
  'confirm.whySwitch': '{path} 문서로 옮기면 고친 내용이 사라져요.',
  'confirm.whyAssets': '외부 파일을 붙이려면 프리뷰를 다시 그려야 해서, 고친 내용이 사라져요.',
  'confirm.save': '저장하고 계속',
  'confirm.saveCopy': '사본 받고 계속',
  'confirm.discard': '버리고 계속',
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
  'lock.MARKER_CLASH': '문서가 편집 표식을 흉내 냄',

  'notice.openFailed': '파일을 열지 못했어요',
  'notice.openFailedDetail': '파일을 열지 못했어요: {detail}',
  'notice.notUtf8': 'UTF-8 문서가 아니에요. 그대로 열면 저장할 때 원본이 깨져서, 열지 않았어요',
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
  'notice.bundleNoDocumentTruncated':
    '읽은 {count}개 파일에는 HTML 문서가 없었어요. 폴더가 커서 끝까지 읽지는 못했어요',

  'assets.missing':
    '옆에 있어야 할 파일 {count}개를 못 찾았어요. 화면만 달라 보일 뿐, 고치고 저장하는 데는 문제없어요',
  'assets.link': '폴더 연결하기',
  'assets.linking': '읽는 중…',

  'patch.unknownId': '모르는 블록이에요 (id={id})',
  'patch.locked': '고칠 수 없는 블록이에요 (id={id}, {reason})',
  'patch.stale': '블록이 원본과 맞지 않아요 (id={id})',
  'patch.duplicate': '같은 블록에 변경이 두 번 들어 있어요 (id={id})',

  'zip.notZip': 'zip 이 아니거나 끝이 잘렸어요',
  'zip.zip64': 'zip64 형식은 읽지 못해요',
  'zip.badCentral': 'zip 목차가 깨져 있어요',
  'zip.encrypted': '암호가 걸린 항목이 있어요 ({name})',
  'zip.badLocal': '항목의 자리를 찾지 못했어요 ({name})',
  'zip.dataTruncated': '데이터가 잘렸어요 ({name})',
  'zip.tooManyFiles': '파일이 너무 많아요 ({limit}개까지)',
  'zip.tooBig': '풀면 너무 커져요',
  'zip.unknownMethod': '처음 보는 압축 방식이에요 ({method} · {name})',
  'zip.sizeMismatch': '목차에 적힌 크기와 실제 크기가 달라요 ({name})',
  'zip.crcMismatch': '내용이 목차의 검사값과 달라요 — 파일이 깨졌어요 ({name})',

  'theme.toLight': '밝은 테마로 바꾸기',
  'theme.toDark': '어두운 테마로 바꾸기',
  'locale.select': '언어',
} as const;

export type MessageKey = keyof typeof ko;

/** Key list for dictionary audits — tests check both languages' completeness and placeholder pairing */
export const MESSAGE_KEYS = Object.keys(ko) as MessageKey[];

const en: Record<MessageKey, string> = {
  'app.emptyTitle': 'Drag an HTML file, a zip, or a folder here',
  'app.emptyHint': 'Click any text to edit it. Saving changes only what you edited.',
  'app.blocked': "You can't edit this one · {reason}",
  'app.editWhileReplacing': "Another document is being opened, so this edit wasn't applied",
  'app.saveWhileReplacing': "Another document is being opened, so saving isn't possible right now",
  'app.editBeforeScan': 'Still checking the document. Try again in a moment',
  'app.editsReverted':
    "Checking found {count} edited spot(s) that can't be edited, so they were put back",

  'toolbar.close': 'Close',
  'toolbar.openFile': 'Open a file',
  'toolbar.openFileHint': 'Opens one HTML file, or a zip',
  'toolbar.openFolder': 'Open a folder',
  'toolbar.openFolderHint': 'Opens a whole folder, reading the files next to it too',
  'toolbar.title': 'Title',
  'toolbar.document': '{count} documents in here. Pick one to open',
  'toolbar.save': 'Save',
  'toolbar.downloadCopy': 'Download a copy',
  'toolbar.repo': 'View the source on GitHub',
  'toolbar.notEditable': "Can't be edited · {reason}",
  'toolbar.droppedNoOverwrite': "Dropped files can't be overwritten",
  'toolbar.noOverwriteSupport': "This browser can't overwrite files",

  'preview.title': 'Preview',
  'toast.dismiss': 'Dismiss',

  'format.bold': 'Bold',
  'format.italic': 'Italic',
  'format.underline': 'Underline',
  'format.smaller': 'Smaller',
  'format.bigger': 'Bigger',
  'format.color': 'Text color',
  'format.clear': 'Clear formatting',

  'confirm.title': 'You have unsaved changes',
  'confirm.body': 'Unsaved edits: {count}. {why}',
  'confirm.whyOpen': 'Opening another file will lose them.',
  'confirm.whyClose': 'Closing the document will lose them.',
  'confirm.whySwitch': 'Switching to {path} will lose them.',
  'confirm.whyAssets': 'Attaching files redraws the preview, which will lose them.',
  'confirm.save': 'Save and continue',
  'confirm.saveCopy': 'Save a copy and continue',
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
  'lock.MARKER_CLASH': "Mimics the editor's markers",

  'notice.openFailed': "Couldn't open that file",
  'notice.openFailedDetail': "Couldn't open that file: {detail}",
  'notice.notUtf8':
    "Not a UTF-8 document. Opening it would corrupt the original on save, so it wasn't opened",
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
  'notice.bundleNoDocumentTruncated':
    "No HTML document in the {count} files read. That folder is large, so the scan didn't finish",

  'assets.missing':
    'Missing files this document expects next to it: {count}. Only the preview looks different; editing and saving are exact',
  'assets.link': 'Link a folder',
  'assets.linking': 'Reading…',

  'patch.unknownId': "Don't know that block (id={id})",
  'patch.locked': "That block can't be edited (id={id}, {reason})",
  'patch.stale': "That block doesn't match the original (id={id})",
  'patch.duplicate': 'Two changes for the same block (id={id})',

  'zip.notZip': 'Not a zip, or its end is cut off',
  'zip.zip64': "Can't read the zip64 format",
  'zip.badCentral': 'The zip index is broken',
  'zip.encrypted': 'An entry is password-protected ({name})',
  'zip.badLocal': "Couldn't locate an entry ({name})",
  'zip.dataTruncated': 'The data is cut off ({name})',
  'zip.tooManyFiles': 'Too many files (up to {limit})',
  'zip.tooBig': 'Inflates too large',
  'zip.unknownMethod': 'Unknown compression method ({method} · {name})',
  'zip.sizeMismatch': "The index size doesn't match the actual size ({name})",
  'zip.crcMismatch': "The data doesn't match the index checksum — the file is corrupted ({name})",

  'theme.toLight': 'Switch to the light theme',
  'theme.toDark': 'Switch to the dark theme',
  'locale.select': 'Language',
};

const DICT: Record<Locale, Record<MessageKey, string>> = { ko, en };

/** A param value may be a nested `Notice` — when the reason is itself a phrase, as in "save rejected: {detail}" */
export type Params = Record<string, string | number | Notice>;

/** A not-yet-translated notification. Stores hold this; the sentence is built at render time */
export interface Notice {
  key: MessageKey;
  params?: Params;
}

/** Lock reason → message key. A new reason becomes a type error here */
const LOCK_KEY: Record<LockReason, MessageKey> = {
  RAW_TEXT: 'lock.RAW_TEXT',
  SCRIPT_GENERATED: 'lock.SCRIPT_GENERATED',
  EMPTY_IN_SOURCE: 'lock.EMPTY_IN_SOURCE',
  CODE_BLOCK: 'lock.CODE_BLOCK',
  AMBIGUOUS: 'lock.AMBIGUOUS',
  MARKER_CLASH: 'lock.MARKER_CLASH',
};

/** Patch rejection code → message key. `core/` knows no language, so only codes cross over (INV-6) */
const PATCH_KEY: Record<PatchErrorCode, MessageKey> = {
  unknownId: 'patch.unknownId',
  locked: 'patch.locked',
  stale: 'patch.stale',
  duplicate: 'patch.duplicate',
};

/** zip rejection code → message key. Same road as `patchNotice` — `core/` knows no language (INV-6) */
const ZIP_KEY: Record<ZipErrorCode, MessageKey> = {
  notZip: 'zip.notZip',
  zip64: 'zip.zip64',
  badCentral: 'zip.badCentral',
  encrypted: 'zip.encrypted',
  badLocal: 'zip.badLocal',
  dataTruncated: 'zip.dataTruncated',
  tooManyFiles: 'zip.tooManyFiles',
  tooBig: 'zip.tooBig',
  unknownMethod: 'zip.unknownMethod',
  sizeMismatch: 'zip.sizeMismatch',
  crcMismatch: 'zip.crcMismatch',
};

export function lockNotice(reason: LockReason): Notice {
  return { key: LOCK_KEY[reason] };
}

export function zipNotice(code: ZipErrorCode, params?: Params): Notice {
  return { key: ZIP_KEY[code], params };
}

function isLockReason(value: unknown): value is LockReason {
  return typeof value === 'string' && value in LOCK_KEY;
}

/** If a lock reason is among the params, swap in human words rather than the code (`CODE_BLOCK`) */
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

/** Labels for the formatting bar inside the preview — the host collects and hands them over (ADR-007) */
export const FORMAT_LABELS = [
  'format.bold',
  'format.italic',
  'format.underline',
  'format.smaller',
  'format.bigger',
  'format.color',
  'format.clear',
] as const satisfies readonly MessageKey[];

/**
 * Notifications that must not disappear on their own.
 *
 * If a save failure vanishes after 3 seconds, whoever missed it believes the save
 * succeeded. Good news may drift by, but bad news must be dismissed by a person
 * (Principle 3).
 */
export const ERROR_NOTICES: ReadonlySet<MessageKey> = new Set<MessageKey>([
  'notice.openFailed',
  'notice.openFailedDetail',
  // The reason a file failed to open — gone in 4 seconds, there is no way to learn why (Principle 3).
  'notice.notUtf8',
  'notice.saveFailed',
  'notice.saveRejected',
  'notice.folderUnsupported',
  'notice.bundleNoDocument',
  'notice.bundleNoDocumentTruncated',
  'notice.assetsNotFound',
]);

/** A key missing from the dictionary is shown as the raw key, not hidden — better than a silent blank (Principle 3) */
export function translate(locale: Locale, key: MessageKey, params?: Params): string {
  const template = DICT[locale][key] ?? DICT.ko[key] ?? key;
  return params ? fill(template, locale, params) : template;
}

export type Translate = (key: MessageKey, params?: Params) => string;
