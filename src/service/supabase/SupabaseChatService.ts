// 階段二才會實作:SupabaseChatService,符合 ChatService 介面。
// 階段一不安裝、也不連接 Supabase,所以這裡只是占位,不引用任何 Supabase 套件。
import type { ChatService } from '../ChatService';

export function createSupabaseChatService(): ChatService {
  throw new Error(
    'VITE_BACKEND=supabase 要到階段二才能用。階段一請使用 VITE_BACKEND=mock(預設)。',
  );
}
