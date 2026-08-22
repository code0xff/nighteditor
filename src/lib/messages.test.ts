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

describe('language pack · dictionary completeness', () => {
  it('supports two languages', () => {
    expect(LOCALES).toEqual(['ko', 'en']);
  });

  it('every key is non-empty in both languages — a leak in one puts raw keys on screen', () => {
    for (const locale of LOCALES) {
      for (const key of MESSAGE_KEYS) {
        expect(translate(locale, key), `${locale}:${key}`).not.toBe('');
      }
    }
  });

  it('placeholders pair up across languages — a translation missing {name} drops the value', () => {
    for (const key of MESSAGE_KEYS) {
      expect(placeholders(translate('en', key)), key).toEqual(placeholders(translate('ko', key)));
    }
  });

  it('the two languages differ on every key — a copied-over entry is not a translation', () => {
    const untranslated = MESSAGE_KEYS.filter(
      (key) => translate('ko', key) === translate('en', key)
    );
    expect(untranslated).toEqual([]);
  });
});

describe('language pack · language selection', () => {
  it('language names are written in their own language — an unreadable name cannot be chosen', () => {
    expect(LOCALE_LABEL).toEqual({ ko: '한국어', en: 'English' });
  });

  it('screens the string a select hands over', () => {
    expect(LOCALES.every(isLocale)).toBe(true);
    expect(isLocale('jp')).toBe(false);
    expect(isLocale(null)).toBe(false);
  });
});

describe('language pack · interpolation', () => {
  it('fills in parameters', () => {
    // Checks **that it was filled**, not the wording. Wording gets polished, and
    // pinning it to the letter here breaks a healthy test every time the tone changes.
    for (const locale of LOCALES) {
      const filled = translate(locale, 'changes.total', { count: 3 });
      expect(filled).toContain('3');
      expect(filled).not.toContain('{count}');
    }
  });

  it('leaves a placeholder without a value as-is — never blanks it silently (Principle 3)', () => {
    expect(translate('ko', 'notice.saved', { name: 'a.html' })).toContain('{count}');
  });

  it('expands a nested Notice in the same language', () => {
    // The inner reason must be in the same language too. English inside a Korean
    // sentence reads like a half-finished translation.
    const notice = { detail: patchNotice('locked', { id: 7, reason: 'CODE_BLOCK' }) };
    for (const locale of LOCALES) {
      const rendered = translate(locale, 'notice.saveRejected', notice);
      expect(rendered).toContain('id=7');
      expect(rendered).toContain(translate(locale, 'lock.CODE_BLOCK'));
      expect(rendered).not.toContain('{');
    }
  });
});

describe('language pack · translating core codes', () => {
  it('renders lock reasons in human words', () => {
    // A reason code (SCRIPT_GENERATED) must never leak onto the screen as-is.
    for (const locale of LOCALES) {
      const rendered = translate(locale, lockNotice('SCRIPT_GENERATED').key);
      expect(rendered).not.toContain('SCRIPT_GENERATED');
      expect(rendered.length).toBeGreaterThan(2);
    }
  });

  it('builds the sentence from a PatchError code and params alone — core knows no language (INV-6)', () => {
    const e = new PatchError('stale', { id: 4 }, 'stale block: id=4');
    const notice = patchNotice(e.code, e.params);
    const rendered = LOCALES.map((l: Locale) => translate(l, notice.key, notice.params));
    expect(rendered[0]).toContain('id=4');
    expect(rendered[1]).toContain('id=4');
    expect(rendered[0]).not.toBe(rendered[1]);
  });

  it('builds the sentence from a ZipError code and params alone — Korean must not leak into the English UI', () => {
    const e = new ZipError('encrypted', { name: 'deck.html' }, 'encrypted entry: deck.html');
    const notice = zipNotice(e.code, e.params);
    const rendered = LOCALES.map((l: Locale) => translate(l, notice.key, notice.params));
    expect(rendered[0]).toContain('deck.html');
    expect(rendered[1]).toContain('deck.html');
    expect(rendered[0]).not.toBe(rendered[1]);
    // Hangul left in the English sentence defeats the point of the language pack.
    expect(rendered[1]).not.toMatch(/[가-힣]/);
  });
});

describe('language pack · error notices persist (spec §4)', () => {
  it('the reason a file failed to open never disappears on its own — including not-UTF-8 (Principle 3)', () => {
    // If notUtf8 drops out of this set it flows into an info toast and vanishes in
    // 4 seconds — the only explanation for why the file will not open is gone.
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
