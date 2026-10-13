// 淺色 / 深色模式:預設跟隨系統;手動切換後記住選擇。
// 實際的顏色在 src/styles/tokens.css,這裡只負責在 <html> 上放 data-theme。
import { useCallback, useEffect, useState } from 'react';
import { loadTheme, saveTheme, type Theme } from './prefs';

function systemTheme(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** 一開始就套用,避免畫面先閃一下淺色 */
export function applySavedTheme(): void {
  const saved = loadTheme();
  if (saved) document.documentElement.dataset.theme = saved;
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [manual, setManual] = useState<Theme | null>(() => loadTheme());
  const [system, setSystem] = useState<Theme>(() => systemTheme());

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const on = () => setSystem(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const theme = manual ?? system;

  const toggle = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setManual(next);
    saveTheme(next);
    document.documentElement.dataset.theme = next;
  }, [theme]);

  return { theme, toggle };
}
