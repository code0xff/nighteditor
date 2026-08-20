// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { applyLang, initialLocale, useLocale } from './locale.js';

beforeEach(() => {
  localStorage.clear();
  useLocale.setState({ locale: 'ko' });
  document.documentElement.lang = '';
});

describe('locale · 초기값', () => {
  it('저장된 선택을 따른다', () => {
    localStorage.setItem('app_locale', 'en');
    expect(initialLocale()).toBe('en');
  });

  it('망가진 값은 무시하고 브라우저 언어로 떨어진다', () => {
    localStorage.setItem('app_locale', 'jp');
    expect(initialLocale()).toBe(navigator.language.startsWith('ko') ? 'ko' : 'en');
  });
});

describe('locale · 전환', () => {
  it('고른 언어가 localStorage 에 남는다', () => {
    useLocale.getState().setLocale('en');
    expect(useLocale.getState().locale).toBe('en');
    expect(localStorage.getItem('app_locale')).toBe('en');

    useLocale.getState().setLocale('ko');
    expect(useLocale.getState().locale).toBe('ko');
    expect(localStorage.getItem('app_locale')).toBe('ko');
  });

  it('<html lang> 을 함께 갱신한다 — 스크린리더가 이 값을 본다', () => {
    useLocale.getState().setLocale('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('applyLang 은 첫 페인트 전에도 쓸 수 있다', () => {
    applyLang('ko');
    expect(document.documentElement.lang).toBe('ko');
  });
});
