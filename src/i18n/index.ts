import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { Lang } from '../protocol/types';
import { detectBrowserLang, loadLang, saveLang } from '../utils/prefs';
import es from './locales/es.json';
import en from './locales/en.json';
import fr from './locales/fr.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import zhTW from './locales/zh-TW.json';

export function initialLang(): Lang {
  return loadLang() ?? detectBrowserLang();
}

void i18n.use(initReactI18next).init({
  resources: {
    'zh-TW': { translation: zhTW },
    en: { translation: en },
    ja: { translation: ja },
    ko: { translation: ko },
    es: { translation: es },
    fr: { translation: fr },
  },
  lng: initialLang(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false }, // React 本來就會處理跳脫
});

document.documentElement.lang = i18n.language;

/** 切換語言:畫面文字、<html lang>、儲存的偏好一起換 */
export function applyLang(lang: Lang): void {
  void i18n.changeLanguage(lang);
  document.documentElement.lang = lang;
  saveLang(lang);
}

export default i18n;
