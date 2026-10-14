/** 離到期時間還有幾秒(最少 0,無條件進位,讓倒數最後一秒顯示 0:01 而不是 0:00) */
export function secondsLeft(expiresAt: string | number, now: number): number {
  const end = typeof expiresAt === 'number' ? expiresAt : Date.parse(expiresAt);
  return Math.max(0, Math.ceil((end - now) / 1000));
}
