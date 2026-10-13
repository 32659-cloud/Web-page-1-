// 每個人自己的小設定(語言、深色模式、上次用的代號),存在這個瀏覽器的 localStorage。
// 讀寫都包 try/catch:無痕視窗或被封鎖時可能失敗,失敗就當作沒有存,畫面照常運作。
import { LANGS, type Lang } from '../protocol/types';

const K = { lang: 'chat:lang', theme: 'chat:theme', nick: 'chat:nickname' } as const;

function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function set(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 沒存成也沒關係 */
  }
}

export type Theme = 'light' | 'dark';

export function loadLang(): Lang | null {
  const v = get(K.lang);
  return LANGS.some((l) => l.code === v) ? (v as Lang) : null;
}
export const saveLang = (l: Lang) => set(K.lang, l);

export function loadTheme(): Theme | null {
  const v = get(K.theme);
  return v === 'light' || v === 'dark' ? v : null;
}
export const saveTheme = (t: Theme) => set(K.theme, t);

export const loadNickname = () => get(K.nick);
export const saveNickname = (n: string) => set(K.nick, n);

/** 預設語言:依瀏覽器語言 */
export function detectBrowserLang(): Lang {
  const list = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : [];
  for (const raw of list) {
    const l = (raw || '').toLowerCase();
    if (l.startsWith('zh')) return 'zh-TW';
    if (l.startsWith('ja')) return 'ja';
    if (l.startsWith('ko')) return 'ko';
    if (l.startsWith('es')) return 'es';
    if (l.startsWith('fr')) return 'fr';
    if (l.startsWith('en')) return 'en';
  }
  return 'en';
}
