// 依設定 VITE_BACKEND 選用通訊層:mock(階段一,預設)或 supabase(階段二)。
// 這是整個專案唯一知道「現在用的是哪一個實作」的地方。
import { getLimits } from '../protocol/limits';
import type { ChatService, MockDevTools } from './ChatService';
import { MockChatService } from './mock/MockChatService';
import { createSupabaseChatService } from './supabase/SupabaseChatService';

export type Backend = 'mock' | 'supabase';

export const BACKEND: Backend = import.meta.env.VITE_BACKEND === 'supabase' ? 'supabase' : 'mock';

export interface ServiceBundle {
  service: ChatService;
  /** 只有模擬層才有 */
  devTools: MockDevTools | null;
}

/** 網址加 ?profile=2 可以在同一個瀏覽器扮演另一個人(測試用) */
function profileName(): string {
  return new URLSearchParams(window.location.search).get('profile') ?? '1';
}

export function createService(): ServiceBundle {
  if (BACKEND === 'supabase') {
    return { service: createSupabaseChatService(), devTools: null };
  }
  const svc = new MockChatService({ profile: profileName(), limits: getLimits(window.location.search) });
  return { service: svc, devTools: svc };
}
