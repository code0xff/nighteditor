import { describe, expect, it } from 'vitest';
import { PatchError } from '@/core/patch';
import { ZipError } from '@/core/zip';
import {
  ERROR_NOTICES,
  LOCALES,
  LOCALE_LABEL,
  isLocale,
  MESSAGE_KEYS,
  lockNotice,
  patchNotice,
  translate,
  zipNotice,
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
    // 문구 자체가 아니라 **채워졌는지**를 본다. 문구는 다듬는 것이고,
    // 여기서 한 글자까지 박아 두면 말투를 고칠 때마다 멀쩡한 테스트가 깨진다.
    for (const locale of LOCALES) {
      const filled = translate(locale, 'changes.total', { count: 3 });
      expect(filled).toContain('3');
      expect(filled).not.toContain('{count}');
    }
  });

  it('값이 없는 자리표시자는 그대로 남긴다 — 조용히 비우지 않는다 (대원칙 3)', () => {
    expect(translate('ko', 'notice.saved', { name: 'a.html' })).toContain('{count}');
  });

  it('중첩된 Notice 를 같은 언어로 펼친다', () => {
    // 안쪽 사유까지 같은 언어여야 한다. 한국어 문장에 영어 사유가 섞이면
    // 번역이 반만 된 것처럼 보인다.
    const notice = { detail: patchNotice('locked', { id: 7, reason: 'CODE_BLOCK' }) };
    for (const locale of LOCALES) {
      const rendered = translate(locale, 'notice.saveRejected', notice);
      expect(rendered).toContain('id=7');
      expect(rendered).toContain(translate(locale, 'lock.CODE_BLOCK'));
      expect(rendered).not.toContain('{');
    }
  });
});

describe('언어팩 · core 코드 번역', () => {
  it('잠금 사유를 사람 말로 옮긴다', () => {
    // 사유 코드(SCRIPT_GENERATED)가 화면에 그대로 새어 나오면 안 된다.
    for (const locale of LOCALES) {
      const rendered = translate(locale, lockNotice('SCRIPT_GENERATED').key);
      expect(rendered).not.toContain('SCRIPT_GENERATED');
      expect(rendered.length).toBeGreaterThan(2);
    }
  });

  it('PatchError 의 코드와 파라미터만으로 문장을 만든다 — core 는 언어를 모른다 (INV-6)', () => {
    const e = new PatchError('stale', { id: 4 }, 'stale block: id=4');
    const notice = patchNotice(e.code, e.params);
    const rendered = LOCALES.map((l: Locale) => translate(l, notice.key, notice.params));
    expect(rendered[0]).toContain('id=4');
    expect(rendered[1]).toContain('id=4');
    expect(rendered[0]).not.toBe(rendered[1]);
  });

  it('ZipError 의 코드와 파라미터만으로 문장을 만든다 — 영어 UI 에 한국어가 새면 안 된다', () => {
    const e = new ZipError('encrypted', { name: 'deck.html' }, 'encrypted entry: deck.html');
    const notice = zipNotice(e.code, e.params);
    const rendered = LOCALES.map((l: Locale) => translate(l, notice.key, notice.params));
    expect(rendered[0]).toContain('deck.html');
    expect(rendered[1]).toContain('deck.html');
    expect(rendered[0]).not.toBe(rendered[1]);
    // 영어 문장에 한글이 남아 있으면 언어팩으로 옮긴 의미가 없다.
    expect(rendered[1]).not.toMatch(/[가-힣]/);
  });
});

describe('언어팩 · 오류 알림의 잔류 (spec §4)', () => {
  it('파일을 못 연 이유는 스스로 사라지지 않는다 — UTF-8 아님 포함 (대원칙 3)', () => {
    // notUtf8 이 이 집합에서 빠지면 info 토스트로 흘러 4초 만에 사라진다 —
    // 못 여는 유일한 설명이 없어져, 왜 안 열리는지 알 길이 없다.
    for (const key of [
      'notice.openFailed',
      'notice.openFailedDetail',
      'notice.notUtf8',
      'notice.saveFailed',
      'notice.saveRejected',
    ] as const) {
      expect(ERROR_NOTICES.has(key)).toBe(true);
    }
  });
});
