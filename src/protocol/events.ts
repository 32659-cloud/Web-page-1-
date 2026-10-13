// 事件名稱與內容(通訊層 → 畫面,對應 docs/architecture.md 5.2)
import type {
  ConnectionStatus,
  Conversation,
  ConversationEndReason,
  Invitation,
  Message,
  User,
} from './types';

export interface ServiceEvents {
  /** 連線狀態改變 */
  'connection.changed': { status: ConnectionStatus };
  /** 進入後,還原這個人目前所有私聊與等待中的邀請 */
  'session.restored': {
    conversations: { conversation: Conversation; messages: Message[] }[];
    invitationsIn: Invitation[];
    invitationsOut: Invitation[];
  };
  /** 伺服器已經不認得這個人(離線太久、代號已釋放),要回到進入畫面 */
  'session.ended': { reason: 'expired' };
  /** 完整的線上名單 */
  'presence.synced': { users: User[] };
  /** 有人上線 */
  'presence.joined': { user: User };
  /** 有人離線超過 15 秒,或主動離開 */
  'presence.left': { user: User };
  /** 剛進來時,最近 100 則公開訊息 */
  'history.loaded': { messages: Message[] };
  /** 新訊息(公開或私聊) */
  'message.received': { message: Message };
  /** 某則訊息被收回 */
  'message.recalled': { scope: 'public' | 'private'; messageId: string; conversationId: string | null };
  /** 有人邀請你 */
  'invite.received': { invitation: Invitation };
  /** 邀請狀態變了 */
  'invite.updated': { invitation: Invitation };
  /** 私聊建立 */
  'conversation.started': { conversation: Conversation };
  /** 私聊結束 */
  'conversation.ended': { conversationId: string; reason: ConversationEndReason };
  /** 私聊對方上線或離線 */
  'conversation.peerStatus': { conversationId: string; online: boolean };
}

export type EventName = keyof ServiceEvents;
