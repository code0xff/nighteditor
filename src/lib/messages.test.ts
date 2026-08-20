import { describe, expect, it } from 'vitest';
import { PatchError } from '@/core/patch';
import {
  LOCALES,
  LOCALE_LABEL,
  isLocale,
  MESSAGE_KEYS,
  lockNotice,
  patchNotice,
  translate,
  type Locale,
} from './messages.js';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('언어팩 · 사전 완전성', () => {
  it('두 언어를 지원한다', () => {
    expect(LOCALES).toEqual(['ko', 'en']);
  });

  it('모든 키가 두 언어에서 비어 있지 않다 — 한 쪽이 새면 화면에 키가 뜬다', () => {
    for (const locale of LOCALES) {
      for (const key of MESSAGE_KEYS) {
        expect(translate(locale, key), `${locale}:${key}`).not.toBe('');
      }
    }
  });

  it('자리표시자가 언어끼리 짝을 이룬다 — 번역에서 {name} 이 빠지면 값이 사라진다', () => {
    for (const key of MESSAGE_KEYS) {
      expect(placeholders(translate('en', key)), key).toEqual(placeholders(translate('ko', key)));
    }
  });

  it('두 언어의 문구가 서로 다르다 — 복사만 해두면 번역이 아니다', () => {
    const untranslated = MESSAGE_KEYS.filter(
      (key) => translate('ko', key) === translate('en', key)
    );
    expect(untranslated).toEqual([]);
  });
});

describe('언어팩 · 언어 선택', () => {
  it('언어 이름은 그 언어로 적혀 있다 — 못 읽는 이름은 고를 수 없다', () => {
    expect(LOCALE_LABEL).toEqual({ ko: '한국어', en: 'English' });
  });

  it('셀렉트가 준 문자열을 가려낸다', () => {
    expect(LOCALES.every(isLocale)).toBe(true);
    expect(isLocale('jp')).toBe(false);
    expect(isLocale(null)).toBe(false);
  });
});

describe('언어팩 · 보간', () => {
  it('파라미터를 채운다', () => {
    expect(translate('ko', 'changes.total', { count: 3 })).toBe('전체 3');
    expect(translate('en', 'changes.total', { count: 3 })).toBe('3 total');
  });

  it('값이 없는 자리표시자는 그대로 남긴다 — 조용히 비우지 않는다 (대원칙 3)', () => {
    expect(translate('ko', 'notice.saved', { name: 'a.html' })).toContain('{count}');
  });

  it('중첩된 Notice 를 같은 언어로 펼친다', () => {
    const notice = { detail: patchNotice('locked', { id: 7, reason: 'CODE_BLOCK' }) };
    expect(translate('ko', 'notice.saveRejected', notice)).toBe(
      '저장 거부: 잠긴 블록은 수정할 수 없다: id=7 (코드 블록)'
    );
    expect(translate('en', 'notice.saveRejected', notice)).toBe(
      "Save rejected: Locked blocks can't be edited: id=7 (Code block)"
    );
  });
});

describe('언어팩 · core 코드 번역', () => {
  it('잠금 사유를 사람 말로 옮긴다', () => {
    expect(translate('ko', lockNotice('SCRIPT_GENERATED').key)).toBe('스크립트가 생성');
    expect(translate('en', lockNotice('SCRIPT_GENERATED').key)).toBe('Script-generated');
  });

  it('PatchError 의 코드와 파라미터만으로 문장을 만든다 — core 는 언어를 모른다 (INV-6)', () => {
    const e = new PatchError('stale', { id: 4 }, 'stale block: id=4');
    const notice = patchNotice(e.code, e.params);
    const rendered = LOCALES.map((l: Locale) => translate(l, notice.key, notice.params));
    expect(rendered[0]).toContain('id=4');
    expect(rendered[1]).toContain('id=4');
    expect(rendered[0]).not.toBe(rendered[1]);
  });
});
