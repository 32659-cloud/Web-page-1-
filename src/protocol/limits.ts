// 規則常數(對應 docs/architecture.md 5.4)
// 畫面用它顯示字數、模擬層用它執行規則;階段二資料庫函式裡的數字要和這裡一致。

const SEC = 1000;
const MIN = 60 * SEC;

export interface Limits {
  nicknameMin: number;
  nicknameMax: number;
  textMax: number;
  publicKeep: number;
  maxConversations: number;
  /** 每秒最多幾則訊息 */
  msgPerSecond: number;
  /** 相同內容在 dupWindowMs 內最多幾次 */
  dupMax: number;
  dupWindowMs: number;
  imagePerWindow: number;
  imageWindowMs: number;
  imageMaxBytes: number;
  /** 同一個人對同一個對象,inviteWindowMs 內最多邀請幾次 */
  invitePerTarget: number;
  inviteWindowMs: number;
  inviteExpiryMs: number;
  declineCooldownMs: number;
  /** 離線超過這個時間才宣布「離開」 */
  offlineAnnounceMs: number;
  /** 有私聊的人離線超過這個時間,私聊自動結束 */
  privateOfflineMs: number;
  /** 沒有私聊的人離線超過這個時間,釋放代號 */
  reserveMs: number;
  heartbeatMs: number;
}

export const LIMITS: Limits = {
  nicknameMin: 1,
  nicknameMax: 20,
  textMax: 500,
  publicKeep: 100,
  maxConversations: 5,
  msgPerSecond: 3,
  dupMax: 3,
  dupWindowMs: MIN,
  imagePerWindow: 3,
  imageWindowMs: MIN,
  imageMaxBytes: 2 * 1024 * 1024,
  invitePerTarget: 2,
  inviteWindowMs: MIN,
  inviteExpiryMs: 60 * SEC,
  declineCooldownMs: 30 * MIN,
  offlineAnnounceMs: 15 * SEC,
  privateOfflineMs: 30 * MIN,
  reserveMs: 2 * MIN,
  heartbeatMs: 3 * SEC,
};

/** 測試用的「快速模式」:網址加 ?fast=1,把長時間的規則縮短,方便手動測試 */
export const FAST_LIMITS: Limits = {
  ...LIMITS,
  inviteExpiryMs: 15 * SEC,
  declineCooldownMs: 30 * SEC,
  privateOfflineMs: 45 * SEC,
  reserveMs: 30 * SEC,
};

export function getLimits(search: string): Limits {
  return new URLSearchParams(search).get('fast') === '1' ? FAST_LIMITS : LIMITS;
}
