// 模擬資料庫的資料形狀。整份資料存在瀏覽器的 localStorage,所以同一個瀏覽器的不同分頁看到同一份資料,
// 就像大家連到同一個伺服器。
import type { Conversation, Invitation, Lang, Message, User } from '../../protocol/types';

export interface UserRec {
  userId: string;
  nickname: string;
  key: string;
  lang: Lang;
  lastSeen: number;
  online: boolean;
  isBot: boolean;
}

export interface InvRec {
  id: string;
  from: string;
  to: string;
  status: Invitation['status'];
  createdAt: number;
  expiresAt: number;
}

export interface ConvRec {
  id: string;
  a: string;
  b: string;
  startedAt: number;
}

export interface MsgRec {
  id: string;
  scope: 'public' | 'private';
  conversationId: string | null;
  senderId: string;
  text: string | null;
  image: Message['image'];
  recalled: boolean;
  createdAt: number;
}

export interface RateRec {
  uid: string;
  kind: 'msg' | 'img' | 'inv';
  target?: string;
  dup?: string;
  at: number;
}

export interface StoredEvent {
  seq: number;
  type: string;
  payload: unknown;
  /** '*' 代表所有人,否則是收件者的 userId 清單 */
  audience: '*' | string[];
}

export interface BotMeta {
  nextChatAt: number;
  nextToggleAt: number;
  /** 機器人已經回覆過的訊息編號,避免重複回覆 */
  replied: string[];
  /** 小明上次邀請某個真人的時間 */
  invitedAt: Record<string, number>;
  /** 真人第一次被機器人看到在線的時間 */
  seenAt: Record<string, number>;
}

export interface Db {
  seq: number;
  events: StoredEvent[];
  users: Record<string, UserRec>;
  /** 代號紀錄:人離開後,舊訊息仍然要顯示他當時的代號 */
  names: Record<string, string>;
  publicMessages: MsgRec[];
  privateMessages: MsgRec[];
  invitations: InvRec[];
  cooldowns: { from: string; to: string; until: number }[];
  conversations: ConvRec[];
  rate: RateRec[];
  botLeader: { id: string; beat: number } | null;
  bot: BotMeta;
}

export function emptyDb(): Db {
  return {
    seq: 0,
    events: [],
    users: {},
    names: {},
    publicMessages: [],
    privateMessages: [],
    invitations: [],
    cooldowns: [],
    conversations: [],
    rate: [],
    botLeader: null,
    bot: { nextChatAt: 0, nextToggleAt: 0, replied: [], invitedAt: {}, seenAt: {} },
  };
}

export interface Ctx {
  now: number;
  limits: import('../../protocol/limits').Limits;
  newId: (prefix: string) => string;
  /** 需要從照片儲存空間刪掉的檔案路徑(由通訊層負責真的刪除) */
  blobsToDelete: string[];
}

// ── 轉成通訊約定的格式 ──

export function toUser(u: UserRec): User {
  return { userId: u.userId, nickname: u.nickname, lang: u.lang };
}

export function senderOf(db: Db, userId: string): { userId: string; nickname: string } {
  return { userId, nickname: db.users[userId]?.nickname ?? db.names[userId] ?? '?' };
}

export function toMessage(db: Db, m: MsgRec): Message {
  return {
    id: m.id,
    scope: m.scope,
    conversationId: m.conversationId,
    sender: senderOf(db, m.senderId),
    text: m.recalled ? null : m.text,
    image: m.recalled ? null : m.image,
    recalled: m.recalled,
    createdAt: new Date(m.createdAt).toISOString(),
  };
}

export function toInvitation(db: Db, i: InvRec): Invitation {
  return {
    id: i.id,
    from: senderOf(db, i.from),
    to: senderOf(db, i.to),
    status: i.status,
    createdAt: new Date(i.createdAt).toISOString(),
    expiresAt: new Date(i.expiresAt).toISOString(),
  };
}

export function toConversation(db: Db, c: ConvRec, viewer: string, limits: Ctx['limits'], now: number): Conversation {
  const peerId = c.a === viewer ? c.b : c.a;
  return {
    id: c.id,
    peer: senderOf(db, peerId),
    peerOnline: isOnline(db.users[peerId], limits, now),
    startedAt: new Date(c.startedAt).toISOString(),
  };
}

/** 機器人永遠在線;真人要最近有心跳(15 秒內)才算在線 */
export function isOnline(u: UserRec | undefined, limits: Ctx['limits'], now: number): boolean {
  if (!u) return false;
  if (u.isBot) return u.online;
  return u.online && now - u.lastSeen <= limits.offlineAnnounceMs;
}
