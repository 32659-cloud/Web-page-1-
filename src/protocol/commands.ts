// 指令名稱與參數(畫面 → 通訊層,對應 docs/architecture.md 5.1)
import type { ImageRef, Lang } from './types';

export interface CommandParams {
  'session.enter': { nickname: string; lang: Lang };
  'session.leave': Record<string, never>;
  'message.sendPublic': { text: string; image?: ImageRef | null };
  'message.sendPrivate': { conversationId: string; text: string; image?: ImageRef | null };
  'message.recall': { scope: 'public' | 'private'; messageId: string };
  'invite.send': { toUserId: string };
  'invite.respond': { invitationId: string; accept: boolean };
  'invite.cancel': { invitationId: string };
  'conversation.end': { conversationId: string };
  'profile.setLang': { lang: Lang };
}

export type CommandName = keyof CommandParams;
