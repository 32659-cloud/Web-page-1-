// 通訊層介面:畫面「永遠只透過它」和後端說話。
// 階段一:MockChatService(模擬);階段二:SupabaseChatService(真實)。
// 兩個實作都要符合這個介面,所以換掉通訊層時,畫面不用改。
import type { CommandParams } from '../protocol/commands';
import type { EventName, ServiceEvents } from '../protocol/events';
import type { Conversation, ImageRef, Invitation } from '../protocol/types';

export type Unsubscribe = () => void;

export interface ImageBlobs {
  thumb: Blob;
  full: Blob;
  width: number;
  height: number;
}

export interface ChatService {
  /** 這個瀏覽器的使用者編號(重新整理後不變) */
  readonly userId: string;

  /** 訂閱事件,回傳取消訂閱的函式 */
  on<K extends EventName>(type: K, handler: (payload: ServiceEvents[K]) => void): Unsubscribe;

  /** 開始連線並發出 connection.changed */
  start(): void;
  stop(): void;

  // ── 指令 ──
  // 失敗時丟出 ChatError(帶錯誤代碼),畫面依代碼顯示提示。
  enter(p: CommandParams['session.enter']): Promise<void>;
  leave(): Promise<void>;
  sendPublic(p: CommandParams['message.sendPublic']): Promise<void>;
  sendPrivate(p: CommandParams['message.sendPrivate']): Promise<void>;
  recall(p: CommandParams['message.recall']): Promise<void>;
  invite(p: CommandParams['invite.send']): Promise<Invitation>;
  respondInvite(p: CommandParams['invite.respond']): Promise<Conversation | null>;
  cancelInvite(p: CommandParams['invite.cancel']): Promise<void>;
  endConversation(p: CommandParams['conversation.end']): Promise<void>;
  setLang(p: CommandParams['profile.setLang']): Promise<void>;

  // ── 照片 ──
  /** 上傳壓縮好的照片(縮圖與大圖),回傳可放進訊息的照片資料。私聊照片要帶 conversationId */
  uploadImage(
    scope: 'public' | 'private',
    blobs: ImageBlobs,
    onProgress: (percent: number) => void,
    conversationId?: string,
  ): Promise<ImageRef>;
  /** 取得照片的可顯示網址(階段二是有時效的簽名網址) */
  getImageUrl(path: string): Promise<string>;
}

/** 只有模擬層才有的測試輔助(階段二的真實版本不會有) */
export interface MockDevTools {
  simulateOffline(seconds: number): void;
  botInviteMe(): void;
  botSay(): void;
  resetAll(): Promise<void>;
}
