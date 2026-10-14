/** 在游標位置(或選取範圍)插入文字,回傳新文字與新的游標位置。 */
export function insertAt(text: string, insert: string, start: number, end: number) {
  const s = Math.max(0, Math.min(start, text.length));
  const e = Math.max(s, Math.min(end, text.length));
  return { text: text.slice(0, s) + insert + text.slice(e), cursor: s + insert.length };
}
