/**
 * UI language state. Persisted in localStorage, updating `<html lang>` alongside
 * (spec §1 · UI language).
 *
 * Unlike the theme (`lib/theme.ts`), hook-local state is not enough. A language
 * change must redraw the toolbar, sidebar and notifications at once, so a shared
 * store is needed.
 *
 * To set <html lang> before first paint (in src/main.tsx, before createRoot):
 *   import { initialLocale, applyLang } from "@/store/locale";
 *   applyLang(initialLocale());
 */
import { useMemo } from 'react';
import { create } from 'zustand';
import { isLocale, translate, type Locale, type Notice, type Translate } from '@/lib/messages';

const STORAGE_KEY = 'app_locale';

function readStored(): Locale | null {
  const v = localStorage.getItem(STORAGE_KEY);
  return isLocale(v) ? v : null;
}

/** Without a stored choice, follow the browser language. English unless it is Korean */
export function initialLocale(): Locale {
  return readStored() ?? (navigator.language?.startsWith('ko') ? 'ko' : 'en');
}

/** Screen readers and spellcheckers read this value */
export function applyLang(locale: Locale): void {
  document.documentElement.lang = locale;
}

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useLocale = create<LocaleState>((set) => ({
  locale: initialLocale(),

  setLocale: (locale) => {
    localStorage.setItem(STORAGE_KEY, locale);
    applyLang(locale);
    set({ locale });
  },
}));

/**
 * The only path the screen takes to get its copy. A language change redraws every
 * component that uses it. `t` builds a sentence from a key, `tn` from a `Notice`
 * held by a store.
 */
export function useI18n(): {
  locale: Locale;
  t: Translate;
  tn: (notice: Notice) => string;
} {
  const locale = useLocale((s) => s.locale);
  return useMemo(
    () => ({
      locale,
      t: (key, params) => translate(locale, key, params),
      tn: (notice) => translate(locale, notice.key, notice.params),
    }),
    [locale]
  );
}
