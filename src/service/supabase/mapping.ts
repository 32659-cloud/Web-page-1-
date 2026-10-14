// 資料庫的列 ↔ 通訊約定的資料格式,以及錯誤轉換。都是純函式,可以直接測試。
import { ChatError, ERROR_CODES, type ErrorCode } from '../../protocol/errors';
import type {
  Conversation,
  ConversationEndReason,
  ImageRef,
  Invitation,
  InvitationStatus,
  Message,
} from '../../protocol/types';

export interface MessageRow {
  id: string;
  conversation_id?: string | null;
  sender_id: string;
  sender_nick: string;
  body: string | null;
  image: ImageRef | null;
  recalled: boolean;
  created_at: string;
}

export interface InvitationRow {
  id: string;
  from_id: string;
  to_id: string;
  from_nick: string;
  to_nick: string;
  status: InvitationStatus;
  created_at: string;
  expires_at: string;
}

export interface ConversationRow {
  id: string;
  user_a: string;
  user_b: string;
  nick_a: string;
  nick_b: string;
  started_at: string;
  status: 'active' | 'ended';
  ended_by: string | null;
  end_reason: 'ended' | 'left' | 'timeout' | null;
}

const iso = (s: string) => new Date(s).toISOString();

export function rowToMessage(row: MessageRow, scope: 'public' | 'private'): Message {
  return {
    id: row.id,
    scope,
    conversationId: scope === 'private' ? (row.conversation_id ?? null) : null,
    sender: { userId: row.sender_id, nickname: row.sender_nick },
    text: row.recalled ? null : row.body,
    image: row.recalled ? null : row.image,
    recalled: row.recalled,
    createdAt: iso(row.created_at),
  };
}

export function rowToInvitation(row: InvitationRow): Invitation {
  return {
    id: row.id,
    from: { userId: row.from_id, nickname: row.from_nick },
    to: { userId: row.to_id, nickname: row.to_nick },
    status: row.status,
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
  };
}

export function rowToConversation(row: ConversationRow, me: string, isOnline: (userId: string) => boolean): Conversation {
  const mineIsA = row.user_a === me;
  const peerId = mineIsA ? row.user_b : row.user_a;
  return {
    id: row.id,
    peer: { userId: peerId, nickname: mineIsA ? row.nick_b : row.nick_a },
    peerOnline: isOnline(peerId),
    startedAt: iso(row.started_at),
  };
}

export function peerIdOf(row: ConversationRow, me: string): string {
  return row.user_a === me ? row.user_b : row.user_a;
}

/** 私聊結束的原因,從「我」的角度看 */
export function endReasonFor(row: ConversationRow, me: string): ConversationEndReason {
  if (row.ended_by === me) return 'endedByMe';
  if (row.end_reason === 'left') return 'peerLeft';
  if (row.end_reason === 'timeout') return 'peerTimeout';
  return 'endedByPeer';
}

/** 資料庫函式丟出的錯誤:message 是錯誤代碼,detail 是需要等待的秒數 */
export function fromRpcError(error: { message?: string; details?: string | null } | null | undefined): ChatError {
  const code = (ERROR_CODES as readonly string[]).includes(error?.message ?? '')
    ? (error!.message as ErrorCode)
    : 'UNKNOWN';
  const sec = Number(error?.details);
  return new ChatError(code, Number.isFinite(sec) && sec > 0 ? sec : undefined);
}

/** 照片路徑的第一段是桶子名稱:chat-public/… 或 chat-private/… */
export function splitImagePath(path: string): { bucket: string; object: string } {
  const i = path.indexOf('/');
  return { bucket: path.slice(0, i), object: path.slice(i + 1) };
}
