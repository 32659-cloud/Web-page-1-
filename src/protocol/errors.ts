// 錯誤代碼(對應 docs/architecture.md 5.4)
// 畫面只認代碼,提示文字由多語言檔案決定,所以模擬層和真實後端丟出同樣的代碼,畫面就顯示同樣的提示。

export type ErrorCode =
  | 'NICKNAME_INVALID'
  | 'NICKNAME_TAKEN'
  | 'TEXT_TOO_LONG'
  | 'RATE_LIMITED'
  | 'DUPLICATE_CONTENT'
  | 'IMAGE_RATE_LIMITED'
  | 'IMAGE_TOO_LARGE'
  | 'IMAGE_TYPE'
  | 'INVITE_COOLDOWN'
  | 'INVITE_RATE_LIMITED'
  | 'INVITE_PENDING'
  | 'PEER_OFFLINE'
  | 'PEER_CHAT_FULL'
  | 'SELF_CHAT_FULL'
  | 'ALREADY_CHATTING'
  | 'NOT_ALLOWED'
  | 'CONVERSATION_ENDED'
  | 'NOT_ENTERED'
  | 'UNKNOWN';

export class ChatError extends Error {
  code: ErrorCode;
  retryAfterSec?: number;

  constructor(code: ErrorCode, retryAfterSec?: number) {
    super(code);
    this.name = 'ChatError';
    this.code = code;
    this.retryAfterSec = retryAfterSec;
  }
}

export function toChatError(e: unknown): ChatError {
  return e instanceof ChatError ? e : new ChatError('UNKNOWN');
}
