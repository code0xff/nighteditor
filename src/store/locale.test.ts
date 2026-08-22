// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { applyLang, initialLocale, useLocale } from './locale.js';

beforeEach(() => {
  localStorage.clear();
  useLocale.setState({ locale: 'ko' });
  document.documentElement.lang = '';
});

describe('locale · initial value', () => {
  it('follows the stored choice', () => {
    localStorage.setItem('app_locale', 'en');
    expect(initialLocale()).toBe('en');
  });

  it('ignores a corrupt value and falls back to the browser language', () => {
    localStorage.setItem('app_locale', 'jp');
    expect(initialLocale()).toBe(navigator.language.startsWith('ko') ? 'ko' : 'en');
  });
});

describe('locale · switching', () => {
  it('persists the chosen language in localStorage', () => {
    useLocale.getState().setLocale('en');
    expect(useLocale.getState().locale).toBe('en');
    expect(localStorage.getItem('app_locale')).toBe('en');

    useLocale.getState().setLocale('ko');
    expect(useLocale.getState().locale).toBe('ko');
    expect(localStorage.getItem('app_locale')).toBe('ko');
  });

  it('updates <html lang> alongside — screen readers read this value', () => {
    useLocale.getState().setLocale('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('applyLang is usable before first paint too', () => {
    applyLang('ko');
    expect(document.documentElement.lang).toBe('ko');
  });
});
