/**
 * UI 언어 상태. localStorage 에 남기고 `<html lang>` 을 함께 갱신한다 (spec §1 · UI 언어).
 *
 * 테마(`lib/theme.ts`)와 달리 훅 로컬 상태로는 부족하다. 언어는 툴바·사이드바·알림이
 * 동시에 다시 그려져야 해서 공유 스토어가 필요하다.
 *
 * 첫 페인트 전에 <html lang> 을 맞추려면 (src/main.tsx, createRoot 앞에서):
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

/** 저장된 선택이 없으면 브라우저 언어를 따른다. 한국어가 아니면 영어 */
export function initialLocale(): Locale {
  return readStored() ?? (navigator.language?.startsWith('ko') ? 'ko' : 'en');
}

/** 스크린리더·맞춤법 검사가 이 값을 본다 */
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
 * 화면에서 문구를 꺼내는 유일한 경로. 언어가 바뀌면 쓰는 컴포넌트가 다시 그려진다.
 * `t` 는 키로, `tn` 은 스토어가 들고 있는 `Notice` 로 문장을 만든다.
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
