// 頭像顏色:由代號算出固定的一個顏色(docs/design.md 3.3)。
// 顏色本身放在 CSS(--av0 ~ --av5),這裡只負責算出編號。

export const AVATAR_COUNT = 6;

export function avatarIndex(nickname: string): number {
  let h = 0;
  for (const ch of Array.from(nickname)) {
    h = (h * 31 + (ch.codePointAt(0) ?? 0)) % 997;
  }
  return h % AVATAR_COUNT;
}

export function avatarInitial(nickname: string): string {
  return Array.from(nickname)[0] ?? '?';
}
