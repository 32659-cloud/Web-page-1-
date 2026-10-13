// 時間一律以標準時間(UTC)傳遞,顯示時才換成使用者自己的時區(瀏覽器的時區)。
export function formatTime(iso: string | number, lang: string): string {
  return new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}

/** 用來判斷「是不是同一天」 */
export function dayKey(iso: string | number): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** 日期分隔線的文字,例如「10月13日」或「October 13」 */
export function formatDay(iso: string | number, lang: string): string {
  return new Intl.DateTimeFormat(lang, { month: 'long', day: 'numeric' }).format(new Date(iso));
}
