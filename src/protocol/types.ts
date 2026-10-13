// 通訊約定:資料格式(對應 docs/architecture.md 5.3)
// 畫面、模擬層(MockChatService)、真實後端(SupabaseChatService)都依照這份格式。

export type Lang = 'zh-TW' | 'en' | 'ja' | 'ko' | 'es' | 'fr';

export const LANGS: { code: Lang; label: string }[] = [
  { code: 'zh-TW', label: '繁體中文' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
];

export interface User {
  userId: string;
  nickname: string;
  lang: Lang;
}

export interface ImageRef {
  thumbPath: string;
  fullPath: string;
  width: number;
  height: number;
}

export interface Sender {
  userId: string;
  nickname: string;
}

export interface Message {
  id: string;
  scope: 'public' | 'private';
  conversationId: string | null;
  sender: Sender;
  /** 被收回時是 null */
  text: string | null;
  /** 沒有照片或被收回時是 null */
  image: ImageRef | null;
  recalled: boolean;
  /** 標準時間(UTC) ISO 字串 */
  createdAt: string;
}

export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'expired' | 'cancelled';

export interface Invitation {
  id: string;
  from: Sender;
  to: Sender;
  status: InvitationStatus;
  createdAt: string;
  expiresAt: string;
}

export interface Conversation {
  id: string;
  peer: Sender;
  peerOnline: boolean;
  startedAt: string;
}

export type ConversationEndReason = 'endedByMe' | 'endedByPeer' | 'peerLeft' | 'peerTimeout';

export type ConnectionStatus = 'connected' | 'reconnecting' | 'offline';

export interface SendInput {
  text: string;
  image?: ImageRef | null;
}
