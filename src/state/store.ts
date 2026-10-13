// 畫面共用的資料(線上名單、訊息、私聊、未讀數、目前選到哪個對話……)。
// 所有資料都來自通訊層(ChatService)的事件;所有動作都透過通訊層的指令。
// 這個檔案不知道後端是模擬還是 Supabase。
import { create } from 'zustand';
import { applyLang } from '../i18n';
import { ChatError, toChatError } from '../protocol/errors';
import { getLimits } from '../protocol/limits';
import type {
  ConnectionStatus,
  Conversation,
  ConversationEndReason,
  ImageRef,
  Invitation,
  Lang,
  Message,
  User,
} from '../protocol/types';
import type { ChatService } from '../service/ChatService';
import { saveNickname, saveTheme, type Theme } from '../utils/prefs';

// ── 型別 ──

export interface SystemItem {
  kind: 'system';
  id: string;
  /** 對應多語言檔案 system.<key> */
  key: 'joined' | 'left' | 'chatStarted' | 'peerOffline' | 'peerOnline';
  name: string;
  at: number;
}
export interface MessageItem {
  kind: 'message';
  message: Message;
}
export type TimelineItem = SystemItem | MessageItem;

export interface ConvState {
  conversation: Conversation;
  items: TimelineItem[];
  unread: number;
  lastAt: number;
  ended: null | { reason: ConversationEndReason };
}

export type View = { kind: 'public' } | { kind: 'private'; id: string };
export type MobileTab = 'public' | 'private' | 'online';

export interface Toast {
  id: number;
  tone: 'info' | 'error';
  key: string;
  params?: Record<string, string | number>;
}

interface Data {
  phase: 'entry' | 'chat';
  connection: ConnectionStatus;
  me: User | null;
  users: User[];
  publicItems: TimelineItem[];
  convs: Record<string, ConvState>;
  invitationsIn: Invitation[];
  invitationsOut: Invitation[];
  /** 被拒絕後的冷卻:對象 userId → 可以再邀請的時間(毫秒) */
  cooldowns: Record<string, number>;
  view: View;
  mobileTab: MobileTab;
  toasts: Toast[];
  entryNoticeKey: string | null;
}

interface Actions {
  attach(service: ChatService): void;
  enter(nickname: string, lang: Lang): Promise<void>;
  leave(): Promise<void>;
  sendPublic(text: string, image?: ImageRef | null): Promise<boolean>;
  sendPrivate(conversationId: string, text: string, image?: ImageRef | null): Promise<boolean>;
  recall(scope: 'public' | 'private', messageId: string): Promise<void>;
  invite(user: User): Promise<void>;
  respond(invitation: Invitation, accept: boolean): Promise<void>;
  cancelInvite(invitation: Invitation): Promise<void>;
  endConversation(id: string): Promise<void>;
  closeConversation(id: string): void;
  selectView(view: View): void;
  setMobileTab(tab: MobileTab): void;
  setLang(lang: Lang): void;
  toast(key: string, params?: Toast['params'], tone?: Toast['tone']): void;
  errorToast(e: unknown): void;
  dismissToast(id: number): void;
}

export type State = Data & Actions;

// ── 小工具 ──

const TIMELINE_KEEP = 300;
let service: ChatService | null = null;
let sysSeq = 0;
let toastSeq = 0;

function sys(key: SystemItem['key'], name: string): SystemItem {
  sysSeq += 1;
  return { kind: 'system', id: `sys${sysSeq}`, key, name, at: Date.now() };
}

function msgItem(message: Message): MessageItem {
  return { kind: 'message', message };
}

function svc(): ChatService {
  if (!service) throw new ChatError('UNKNOWN');
  return service;
}

function limits() {
  return getLimits(window.location.search);
}

function recallIn(items: TimelineItem[], messageId: string): TimelineItem[] {
  return items.map((it) =>
    it.kind === 'message' && it.message.id === messageId
      ? { kind: 'message', message: { ...it.message, recalled: true, text: null, image: null } }
      : it,
  );
}

function initialData(): Data {
  return {
    phase: 'entry',
    connection: 'connected',
    me: null,
    users: [],
    publicItems: [],
    convs: {},
    invitationsIn: [],
    invitationsOut: [],
    cooldowns: {},
    view: { kind: 'public' },
    mobileTab: 'public',
    toasts: [],
    entryNoticeKey: null,
  };
}

function convFrom(conversation: Conversation, messages: Message[], withStart: boolean): ConvState {
  const items: TimelineItem[] = [];
  if (withStart) items.push(sys('chatStarted', conversation.peer.nickname));
  items.push(...messages.map(msgItem));
  const last = messages[messages.length - 1];
  return {
    conversation,
    items,
    unread: 0,
    lastAt: last ? Date.parse(last.createdAt) : Date.parse(conversation.startedAt),
    ended: null,
  };
}

function isViewing(view: View, convId: string): boolean {
  return view.kind === 'private' && view.id === convId;
}

// ── Store ──

export const useChat = create<State>((set, get) => ({
  ...initialData(),

  attach(s) {
    if (service) return;
    service = s;

    s.on('connection.changed', ({ status }) => set({ connection: status }));

    s.on('session.restored', ({ conversations, invitationsIn, invitationsOut }) => {
      const convs: Record<string, ConvState> = {};
      for (const { conversation, messages } of conversations) {
        convs[conversation.id] = convFrom(conversation, messages, messages.length === 0);
      }
      set({ convs, invitationsIn, invitationsOut });
    });

    s.on('session.ended', () => {
      saveNickname(get().me?.nickname ?? '');
      set({ ...initialData(), entryNoticeKey: 'notice.sessionExpired' });
    });

    s.on('presence.synced', ({ users }) => set({ users }));

    s.on('presence.joined', ({ user }) => {
      const st = get();
      const exists = st.users.some((u) => u.userId === user.userId);
      if (exists) {
        set({ users: st.users.map((u) => (u.userId === user.userId ? user : u)) });
        return;
      }
      set({
        users: [...st.users, user],
        publicItems: [...st.publicItems, sys('joined', user.nickname)].slice(-TIMELINE_KEEP),
      });
    });

    s.on('presence.left', ({ user }) => {
      const st = get();
      if (!st.users.some((u) => u.userId === user.userId)) return;
      set({
        users: st.users.filter((u) => u.userId !== user.userId),
        publicItems: [...st.publicItems, sys('left', user.nickname)].slice(-TIMELINE_KEEP),
      });
    });

    s.on('history.loaded', ({ messages }) => set({ publicItems: messages.map(msgItem) }));

    s.on('message.received', ({ message }) => {
      const st = get();
      if (message.scope === 'public') {
        if (st.publicItems.some((it) => it.kind === 'message' && it.message.id === message.id)) return;
        set({ publicItems: [...st.publicItems, msgItem(message)].slice(-TIMELINE_KEEP) });
        return;
      }
      const id = message.conversationId;
      const conv = id ? st.convs[id] : undefined;
      if (!id || !conv) return;
      if (conv.items.some((it) => it.kind === 'message' && it.message.id === message.id)) return;
      const mine = message.sender.userId === st.me?.userId;
      const watching = isViewing(st.view, id) && document.visibilityState === 'visible';
      set({
        convs: {
          ...st.convs,
          [id]: {
            ...conv,
            items: [...conv.items, msgItem(message)],
            unread: mine || watching ? conv.unread : conv.unread + 1,
            lastAt: Date.parse(message.createdAt),
          },
        },
      });
    });

    s.on('message.recalled', ({ scope, messageId, conversationId }) => {
      const st = get();
      if (scope === 'public') {
        set({ publicItems: recallIn(st.publicItems, messageId) });
      } else if (conversationId && st.convs[conversationId]) {
        const c = st.convs[conversationId];
        set({ convs: { ...st.convs, [conversationId]: { ...c, items: recallIn(c.items, messageId) } } });
      }
    });

    s.on('invite.received', ({ invitation }) => {
      const st = get();
      if (st.invitationsIn.some((i) => i.id === invitation.id)) return;
      set({ invitationsIn: [...st.invitationsIn, invitation] });
    });

    s.on('invite.updated', ({ invitation }) => {
      const st = get();
      const mineAsInviter = invitation.from.userId === st.me?.userId;
      if (invitation.status === 'pending') return;
      if (mineAsInviter) {
        set({ invitationsOut: st.invitationsOut.filter((i) => i.id !== invitation.id) });
        const name = invitation.to.nickname;
        if (invitation.status === 'declined') {
          set({ cooldowns: { ...get().cooldowns, [invitation.to.userId]: Date.now() + limits().declineCooldownMs } });
          get().toast('invite.declined', { name });
        } else if (invitation.status === 'expired') {
          get().toast('invite.busy', { name });
        } else if (invitation.status === 'accepted') {
          get().toast('invite.accepted', { name });
        }
      } else {
        const had = st.invitationsIn.some((i) => i.id === invitation.id);
        set({ invitationsIn: st.invitationsIn.filter((i) => i.id !== invitation.id) });
        if (had && invitation.status === 'cancelled') get().toast('invite.cancelledByPeer', { name: invitation.from.nickname });
      }
    });

    s.on('conversation.started', ({ conversation }) => {
      const st = get();
      if (st.convs[conversation.id]) return;
      set({ convs: { ...st.convs, [conversation.id]: convFrom(conversation, [], true) } });
    });

    s.on('conversation.ended', ({ conversationId, reason }) => {
      const st = get();
      const conv = st.convs[conversationId];
      if (!conv) return;
      if (reason === 'endedByMe') {
        get().closeConversation(conversationId);
        return;
      }
      const watching = isViewing(st.view, conversationId) && document.visibilityState === 'visible';
      set({
        convs: {
          ...st.convs,
          [conversationId]: {
            ...conv,
            ended: { reason },
            unread: watching ? conv.unread : conv.unread + 1,
            lastAt: Date.now(),
          },
        },
      });
    });

    s.on('conversation.peerStatus', ({ conversationId, online }) => {
      const st = get();
      const conv = st.convs[conversationId];
      if (!conv || conv.ended || conv.conversation.peerOnline === online) return;
      const name = conv.conversation.peer.nickname;
      set({
        convs: {
          ...st.convs,
          [conversationId]: {
            ...conv,
            conversation: { ...conv.conversation, peerOnline: online },
            items: [...conv.items, sys(online ? 'peerOnline' : 'peerOffline', name)],
          },
        },
      });
    });
  },

  async enter(nickname, lang) {
    const s = svc();
    set({ ...initialData(), connection: get().connection });
    applyLang(lang);
    await s.enter({ nickname, lang }); // 失敗時丟出 ChatError,進入畫面會顯示
    set({ phase: 'chat', me: { userId: s.userId, nickname: nickname.trim(), lang } });
    // 通訊層用整理過的代號登記,線上名單裡有自己,用那個當作自己的代號
    const self = get().users.find((u) => u.userId === s.userId);
    if (self) set({ me: self });
    saveNickname(get().me?.nickname ?? nickname);
  },

  async leave() {
    await svc().leave();
    set({ ...initialData(), connection: get().connection });
  },

  async sendPublic(text, image) {
    try {
      await svc().sendPublic({ text, image });
      return true;
    } catch (e) {
      get().errorToast(e);
      return false;
    }
  },

  async sendPrivate(conversationId, text, image) {
    try {
      await svc().sendPrivate({ conversationId, text, image });
      return true;
    } catch (e) {
      get().errorToast(e);
      return false;
    }
  },

  async recall(scope, messageId) {
    try {
      await svc().recall({ scope, messageId });
    } catch (e) {
      get().errorToast(e);
    }
  },

  async invite(user) {
    try {
      const inv = await svc().invite({ toUserId: user.userId });
      set({ invitationsOut: [...get().invitationsOut.filter((i) => i.id !== inv.id), inv] });
      get().toast('invite.sent', { name: user.nickname });
    } catch (e) {
      get().errorToast(e);
    }
  },

  async respond(invitation, accept) {
    try {
      const conv = await svc().respondInvite({ invitationId: invitation.id, accept });
      set({ invitationsIn: get().invitationsIn.filter((i) => i.id !== invitation.id) });
      if (accept && conv) {
        get().selectView({ kind: 'private', id: conv.id });
        set({ mobileTab: 'private' });
      }
    } catch (e) {
      set({ invitationsIn: get().invitationsIn.filter((i) => i.id !== invitation.id) });
      get().errorToast(e);
    }
  },

  async cancelInvite(invitation) {
    try {
      await svc().cancelInvite({ invitationId: invitation.id });
      set({ invitationsOut: get().invitationsOut.filter((i) => i.id !== invitation.id) });
    } catch (e) {
      get().errorToast(e);
    }
  },

  async endConversation(id) {
    try {
      await svc().endConversation({ conversationId: id });
    } catch (e) {
      // 其實已經結束了:直接關掉視窗
      if (e instanceof ChatError && e.code === 'CONVERSATION_ENDED') get().closeConversation(id);
      else get().errorToast(e);
    }
  },

  closeConversation(id) {
    const st = get();
    const { [id]: _removed, ...rest } = st.convs;
    void _removed;
    set({
      convs: rest,
      view: isViewing(st.view, id) ? { kind: 'public' } : st.view,
    });
  },

  selectView(view) {
    const st = get();
    if (view.kind === 'private') {
      const conv = st.convs[view.id];
      if (!conv) return;
      set({ view, convs: { ...st.convs, [view.id]: { ...conv, unread: 0 } } });
    } else {
      set({ view });
    }
  },

  setMobileTab(tab) {
    set({ mobileTab: tab });
  },

  setLang(lang) {
    applyLang(lang);
    void svc().setLang({ lang });
    const me = get().me;
    if (me) set({ me: { ...me, lang } });
  },

  toast(key, params, tone = 'info') {
    toastSeq += 1;
    const id = toastSeq;
    set({ toasts: [...get().toasts, { id, tone, key, params }].slice(-3) });
    window.setTimeout(() => get().dismissToast(id), tone === 'error' ? 5000 : 4500);
  },

  errorToast(e) {
    const err = toChatError(e);
    const sec = err.retryAfterSec ?? 1;
    get().toast(`errors.${err.code}`, { sec, time: formatDuration(sec) }, 'error');
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

/** 秒數轉成 分:秒,例如 29:12 */
export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function persistTheme(theme: Theme): void {
  saveTheme(theme);
}
