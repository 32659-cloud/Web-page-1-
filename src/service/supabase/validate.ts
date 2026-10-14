// 收到的資料,先檢查才交給畫面。
// 即時推送、查詢結果、函式回傳的資料,在轉成畫面用的格式之前,都先檢查欄位型別、長度與路徑。
// 格式不對就丟棄(回傳 null),不會顯示。資料庫本身已有檢查,這裡是第二道防線。
import type { ImageRef } from '../../protocol/types';
import type { ConversationRow, InvitationRow, MessageRow } from './mapping';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
const isTime = (v: unknown): v is string => typeof v === 'string' && v.length < 40 && !Number.isNaN(Date.parse(v));
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && Array.from(v).length <= max;

export function parseImage(v: unknown): ImageRef | null {
  if (!isRecord(v)) return null;
  const { thumbPath, fullPath, width, height } = v;
  const okPath = (p: unknown): p is string =>
    typeof p === 'string' &&
    p.length <= 300 &&
    !p.includes('..') &&
    (p.startsWith('chat-public/') || p.startsWith('chat-private/'));
  const okSize = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 20000;
  if (!okPath(thumbPath) || !okPath(fullPath) || !okSize(width) || !okSize(height)) return null;
  return { thumbPath, fullPath, width, height };
}

export function parseMessageRow(v: unknown): MessageRow | null {
  if (!isRecord(v)) return null;
  if (!isUuid(v.id) || !isUuid(v.sender_id) || !isText(v.sender_nick, 40)) return null;
  if (typeof v.recalled !== 'boolean' || !isTime(v.created_at)) return null;
  if (!(v.body === null || v.body === undefined || isText(v.body, 1000))) return null;
  if (!(v.conversation_id === undefined || v.conversation_id === null || isUuid(v.conversation_id))) return null;
  let image: ImageRef | null = null;
  if (v.image !== null && v.image !== undefined) {
    image = parseImage(v.image);
    if (!image) return null;
  }
  return {
    id: v.id,
    conversation_id: (v.conversation_id as string | null | undefined) ?? null,
    sender_id: v.sender_id,
    sender_nick: v.sender_nick,
    body: (v.body as string | null | undefined) ?? null,
    image,
    recalled: v.recalled,
    created_at: v.created_at,
  };
}

const INVITATION_STATUS: readonly string[] = ['pending', 'accepted', 'declined', 'expired', 'cancelled'];

export function parseInvitationRow(v: unknown): InvitationRow | null {
  if (!isRecord(v)) return null;
  if (!isUuid(v.id) || !isUuid(v.from_id) || !isUuid(v.to_id)) return null;
  if (!isText(v.from_nick, 40) || !isText(v.to_nick, 40)) return null;
  if (typeof v.status !== 'string' || !INVITATION_STATUS.includes(v.status)) return null;
  if (!isTime(v.created_at) || !isTime(v.expires_at)) return null;
  return {
    id: v.id,
    from_id: v.from_id,
    to_id: v.to_id,
    from_nick: v.from_nick,
    to_nick: v.to_nick,
    status: v.status as InvitationRow['status'],
    created_at: v.created_at,
    expires_at: v.expires_at,
  };
}

export function parseConversationRow(v: unknown): ConversationRow | null {
  if (!isRecord(v)) return null;
  if (!isUuid(v.id) || !isUuid(v.user_a) || !isUuid(v.user_b)) return null;
  if (!isText(v.nick_a, 40) || !isText(v.nick_b, 40) || !isTime(v.started_at)) return null;
  if (v.status !== 'active' && v.status !== 'ended') return null;
  if (!(v.ended_by === null || v.ended_by === undefined || isUuid(v.ended_by))) return null;
  const reason = v.end_reason ?? null;
  if (reason !== null && reason !== 'ended' && reason !== 'left' && reason !== 'timeout') return null;
  return {
    id: v.id,
    user_a: v.user_a,
    user_b: v.user_b,
    nick_a: v.nick_a,
    nick_b: v.nick_b,
    started_at: v.started_at,
    status: v.status,
    ended_by: (v.ended_by as string | null | undefined) ?? null,
    end_reason: reason,
  };
}

/** 一整串資料:格式不對的那幾筆丟掉,其餘照常 */
export function parseList<T>(data: unknown, parse: (v: unknown) => T | null): T[] {
  if (!Array.isArray(data)) return [];
  const out: T[] = [];
  for (const item of data) {
    const p = parse(item);
    if (p) out.push(p);
  }
  return out;
}
