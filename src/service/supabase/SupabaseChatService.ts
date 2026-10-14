// 階段二的通訊層:接上真正的 Supabase。符合 ChatService 介面,畫面完全不用改。
// - 身分:匿名登入(瀏覽器第一次進來時自動取得,存在 localStorage,重新整理後不變)
// - 指令:呼叫資料庫函式(RPC),所有規則在資料庫裡檢查(supabase/migrations/001_schema.sql)
// - 事件:Realtime 的資料庫變動(訊息、邀請、私聊,只收得到自己有權限的列)+ Presence(誰在線上)
// - 照片:Storage 兩個桶子,公開桶用網址、私聊桶用有時效的簽名網址
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import type { CommandParams } from '../../protocol/commands';
import { ChatError } from '../../protocol/errors';
import type { EventName, ServiceEvents } from '../../protocol/events';
import { LIMITS } from '../../protocol/limits';
import type {
  ConnectionStatus,
  Conversation,
  ImageRef,
  Invitation,
  Lang,
  User,
} from '../../protocol/types';
import type { ChatService, ImageBlobs, Unsubscribe } from '../ChatService';
import {
  type ConversationRow,
  type InvitationRow,
  type MessageRow,
  endReasonFor,
  fromRpcError,
  peerIdOf,
  rowToConversation,
  rowToInvitation,
  rowToMessage,
  splitImagePath,
} from './mapping';
import { type LiveUser, PresenceTracker } from './PresenceTracker';
import { parseConversationRow, parseImage, parseInvitationRow, parseList, parseMessageRow } from './validate';

/** 每個人多久更新一次自己的在線心跳,以及多久檢查一次別人的心跳有沒有中斷 */
const PRESENCE_BEAT_MS = 10_000;
const PRESENCE_CHECK_MS = 3_000;
const SNAPSHOT_TIMEOUT_MS = 10_000;
const PRESENCE_WAIT_MS = 5_000;
const SIGNED_URL_SEC = 3600;
const PUBLIC_BUCKET = 'chat-public';
const PRIVATE_BUCKET = 'chat-private';

type Handler = (payload: never) => void;
type Row = Record<string, unknown>;
type DbChange = { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; new: Row; old: Row };
type PresenceMeta = { userId?: string; nickname?: string; lang?: string; ts?: number };

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        window.clearTimeout(t);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(t);
        reject(e);
      },
    );
  });
}

export class SupabaseChatService implements ChatService {
  private client: SupabaseClient;
  private uid = '';
  private listeners = new Map<string, Set<Handler>>();
  private started = false;
  private entered = false;
  private me: { nickname: string; lang: Lang } | null = null;
  private lastStatus: ConnectionStatus | null = null;
  private sessionPromise: Promise<void> | null = null;

  private dbChannel: RealtimeChannel | null = null;
  private roomChannel: RealtimeChannel | null = null;
  private dbUp = false;
  private roomUp = false;
  private everUp = false;

  private heartbeatTimer: number | null = null;
  private presenceBeatTimer: number | null = null;
  private presenceCheckTimer: number | null = null;
  /** 進入的快照還沒送完之前,先把即時事件排隊,送完再放出去(畫面會用編號去掉重複的) */
  private ready = false;
  private queue: (() => void)[] = [];

  private convs = new Map<string, ConversationRow>();
  private pending = new Map<string, { inv: Invitation; timer: number }>();
  private lastMessageAt = '';
  private signedUrls = new Map<string, { url: string; expires: number }>();
  private firstSync: { promise: Promise<void>; resolve: () => void } | null = null;

  private tracker: PresenceTracker;

  constructor(url: string, key: string) {
    this.client = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    this.tracker = new PresenceTracker(() => this.uid, LIMITS.offlineAnnounceMs, {
      synced: () => this.firstSync?.resolve(),
      joined: (user) => {
        this.deliver(() => {
          this.dispatch('presence.joined', { user });
          this.peerStatus(user.userId, true);
        });
      },
      left: (user) => {
        this.deliver(() => {
          this.dispatch('presence.left', { user });
          this.peerStatus(user.userId, false);
        });
      },
    });
  }

  get userId(): string {
    return this.uid;
  }

  // ── 事件 ──

  on<K extends EventName>(type: K, handler: (payload: ServiceEvents[K]) => void): Unsubscribe {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(handler as Handler);
    return () => set!.delete(handler as Handler);
  }

  private dispatch<K extends EventName>(type: K, payload: ServiceEvents[K]): void {
    this.listeners.get(type)?.forEach((h) => (h as (p: ServiceEvents[K]) => void)(payload));
  }

  /** 快照送完之前先排隊 */
  private deliver(fn: () => void): void {
    if (this.ready) fn();
    else this.queue.push(fn);
  }

  private peerStatus(peerId: string, online: boolean): void {
    for (const c of this.convs.values()) {
      if (peerIdOf(c, this.uid) === peerId) {
        this.dispatch('conversation.peerStatus', { conversationId: c.id, online });
      }
    }
  }

  private updateStatus(): void {
    let status: ConnectionStatus = 'connected';
    if (!navigator.onLine) status = 'offline';
    else if (this.entered && this.everUp && !(this.dbUp && this.roomUp)) status = 'reconnecting';
    if (this.lastStatus === status) return;
    this.lastStatus = status;
    this.dispatch('connection.changed', { status });
  }

  // ── 啟動與停止 ──

  start(): void {
    if (this.started) return;
    this.started = true;
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    document.addEventListener('visibilitychange', this.onVisible);
    this.updateStatus();
    void this.ensureSession().catch(() => undefined);
  }

  stop(): void {
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    document.removeEventListener('visibilitychange', this.onVisible);
    void this.teardown();
    this.started = false;
  }

  private onOnline = () => {
    this.updateStatus();
    void this.beat();
  };
  private onOffline = () => this.updateStatus();
  private onVisible = () => {
    if (document.visibilityState === 'visible') void this.beat();
  };

  private async ensureSession(): Promise<void> {
    if (!this.sessionPromise) {
      this.sessionPromise = (async () => {
        const { data } = await this.client.auth.getSession();
        let session = data.session;
        if (!session) {
          const r = await this.client.auth.signInAnonymously();
          if (r.error || !r.data.session) throw r.error ?? new Error('no session');
          session = r.data.session;
        }
        this.uid = session.user.id;
      })().catch((e) => {
        this.sessionPromise = null;
        throw e;
      });
    }
    return this.sessionPromise;
  }

  private guard(): void {
    if (!navigator.onLine) throw new ChatError('UNKNOWN');
  }

  // ── 進入 ──

  async enter(p: CommandParams['session.enter']): Promise<void> {
    this.guard();
    try {
      await this.ensureSession();
    } catch {
      throw new ChatError('UNKNOWN');
    }
    await this.teardown();

    const { data, error } = await this.client.rpc('enter', { p_nickname: p.nickname, p_lang: p.lang });
    if (error) throw fromRpcError(error);
    this.me = { nickname: String(data), lang: p.lang };
    this.entered = true;

    try {
      this.firstSync = (() => {
        let resolve!: () => void;
        const promise = new Promise<void>((r) => (resolve = r));
        return { promise, resolve };
      })();
      await this.openChannels();
      await Promise.race([
        this.firstSync.promise,
        new Promise<void>((r) => window.setTimeout(r, PRESENCE_WAIT_MS)),
      ]);
      const snap = await withTimeout(this.loadSnapshot(), SNAPSHOT_TIMEOUT_MS);

      const self: User = { userId: this.uid, nickname: this.me.nickname, lang: this.me.lang };
      const others = this.tracker.users().filter((u) => u.userId !== this.uid);
      this.dispatch('presence.synced', { users: [self, ...others] });
      this.dispatch('history.loaded', { messages: snap.history });
      this.dispatch('session.restored', {
        conversations: snap.conversations,
        invitationsIn: snap.invitationsIn,
        invitationsOut: snap.invitationsOut,
      });
      this.ready = true;
      const queued = this.queue;
      this.queue = [];
      queued.forEach((fn) => fn());
    } catch (e) {
      await this.teardown();
      await this.client.rpc('leave'); // 登記了但進不去:把代號放掉
      throw e instanceof ChatError ? e : new ChatError('UNKNOWN');
    }

    this.heartbeatTimer = window.setInterval(() => void this.beat(), LIMITS.heartbeatMs);
    // 在線心跳:網路悄悄中斷時連線不會被關閉,別人只能靠「心跳停了」得知
    this.presenceBeatTimer = window.setInterval(() => {
      if (this.roomUp) void this.roomChannel?.track(this.presenceMeta());
    }, PRESENCE_BEAT_MS);
    this.presenceCheckTimer = window.setInterval(() => this.tracker.tick(), PRESENCE_CHECK_MS);
    this.updateStatus();
  }

  private presenceMeta(): PresenceMeta {
    return { userId: this.uid, nickname: this.me?.nickname, lang: this.me?.lang, ts: Date.now() };
  }

  private subscribe(channel: RealtimeChannel, onState: (up: boolean) => void): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let first = true;
      const timer = window.setTimeout(() => {
        if (first) {
          first = false;
          reject(new Error('subscribe timeout'));
        }
      }, SNAPSHOT_TIMEOUT_MS);
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          onState(true);
          if (first) {
            first = false;
            window.clearTimeout(timer);
            resolve();
          }
        } else {
          onState(false);
          if (first && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')) {
            first = false;
            window.clearTimeout(timer);
            reject(new Error(status));
          }
        }
      });
    });
  }

  private async openChannels(): Promise<void> {
    // 資料庫變動:訊息、邀請、私聊(只會收到自己有權限的列)
    const db = this.client.channel(`db-${this.uid}`);
    for (const table of ['public_messages', 'private_messages', 'invitations', 'conversations']) {
      db.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) =>
        this.onDbChange(table, payload as unknown as DbChange),
      );
    }
    this.dbChannel = db;
    await this.subscribe(db, (up) => {
      const wasDown = this.everUp && !this.dbUp;
      this.dbUp = up;
      if (up) {
        this.everUp = true;
        if (wasDown) void this.gapFill();
      }
      this.updateStatus();
    });

    // 誰在線上(Presence)和「我離開了」的廣播
    const room = this.client.channel('room', {
      config: { presence: { key: this.uid }, broadcast: { self: false } },
    });
    room.on('presence', { event: 'sync' }, () => this.onPresenceSync());
    room.on('broadcast', { event: 'left' }, ({ payload }) => {
      const id = (payload as { userId?: string } | undefined)?.userId;
      if (id && id !== this.uid) this.tracker.remove(id);
    });
    this.roomChannel = room;
    await this.subscribe(room, (up) => {
      this.roomUp = up;
      if (up) {
        this.everUp = true;
        void room.track(this.presenceMeta());
      }
      this.updateStatus();
    });
  }

  private onPresenceSync(): void {
    if (!this.roomChannel) return;
    const state = this.roomChannel.presenceState<PresenceMeta>();
    const users: LiveUser[] = [];
    for (const metas of Object.values(state)) {
      const m = metas[0];
      if (!m || typeof m.userId !== 'string' || typeof m.nickname !== 'string') continue;
      users.push({
        userId: m.userId,
        nickname: m.nickname.slice(0, 40),
        lang: (m.lang as Lang) ?? 'zh-TW',
        beat: typeof m.ts === 'number' ? m.ts : undefined,
      });
    }
    this.tracker.update(users);
  }

  // ── 進入時要讀的資料 ──

  private async loadSnapshot() {
    const nowIso = new Date().toISOString();
    const [hist, convs, invs] = await Promise.all([
      this.client.from('public_messages').select('*').order('created_at', { ascending: false }).limit(LIMITS.publicKeep),
      this.client.from('conversations').select('*').eq('status', 'active'),
      this.client.from('invitations').select('*').eq('status', 'pending').gt('expires_at', nowIso),
    ]);
    if (hist.error || convs.error || invs.error) throw new ChatError('UNKNOWN');

    const histRows = parseList(hist.data, parseMessageRow).reverse();
    const convRows = parseList(convs.data, parseConversationRow);
    this.convs = new Map(convRows.map((c) => [c.id, c]));

    let privRows: MessageRow[] = [];
    if (convRows.length > 0) {
      const pm = await this.client
        .from('private_messages')
        .select('*')
        .in('conversation_id', convRows.map((c) => c.id))
        .order('created_at', { ascending: true });
      if (pm.error) throw new ChatError('UNKNOWN');
      privRows = parseList(pm.data, parseMessageRow);
    }

    const all = [...histRows, ...privRows].map((m) => m.created_at).sort();
    this.lastMessageAt = all.length > 0 ? all[all.length - 1] : nowIso;

    const invRows = parseList(invs.data, parseInvitationRow);
    for (const row of invRows) this.trackInvite(rowToInvitation(row));

    return {
      history: histRows.map((m) => rowToMessage(m, 'public')),
      conversations: convRows.map((c) => ({
        conversation: rowToConversation(c, this.uid, (id) => this.tracker.isOnline(id)),
        messages: privRows.filter((m) => m.conversation_id === c.id).map((m) => rowToMessage(m, 'private')),
      })),
      invitationsIn: invRows.filter((r) => r.to_id === this.uid).map(rowToInvitation),
      invitationsOut: invRows.filter((r) => r.from_id === this.uid).map(rowToInvitation),
    };
  }

  // ── 即時事件 ──

  private onDbChange(table: string, c: DbChange): void {
    this.deliver(() => {
      const row = c.new as unknown;
      switch (table) {
        case 'public_messages': {
          const r = parseMessageRow(row);
          if (!r) break;
          if (c.eventType === 'INSERT') {
            this.seen(r.created_at);
            this.dispatch('message.received', { message: rowToMessage(r, 'public') });
          } else if (c.eventType === 'UPDATE' && r.recalled) {
            this.dispatch('message.recalled', { scope: 'public', messageId: r.id, conversationId: null });
          }
          break;
        }
        case 'private_messages': {
          const r = parseMessageRow(row);
          if (!r) break;
          if (c.eventType === 'INSERT') {
            this.seen(r.created_at);
            this.dispatch('message.received', { message: rowToMessage(r, 'private') });
          } else if (c.eventType === 'UPDATE' && r.recalled) {
            this.dispatch('message.recalled', {
              scope: 'private',
              messageId: r.id,
              conversationId: r.conversation_id ?? null,
            });
          }
          break;
        }
        case 'invitations': {
          const r = parseInvitationRow(row);
          if (!r) break;
          if (c.eventType === 'INSERT' && r.status === 'pending') {
            const inv = rowToInvitation(r);
            const known = this.pending.has(inv.id);
            this.trackInvite(inv);
            if (!known && r.to_id === this.uid) this.dispatch('invite.received', { invitation: inv });
          } else if (c.eventType === 'UPDATE' && r.status !== 'pending') {
            this.settleInvite(r);
          }
          break;
        }
        case 'conversations': {
          const r = parseConversationRow(row);
          if (!r) break;
          if (c.eventType === 'INSERT' && r.status === 'active') {
            if (this.convs.has(r.id)) break;
            this.convs.set(r.id, r);
            this.dispatch('conversation.started', {
              conversation: rowToConversation(r, this.uid, (id) => this.tracker.isOnline(id)),
            });
          } else if (c.eventType === 'UPDATE' && r.status === 'ended') {
            if (!this.convs.has(r.id)) break;
            this.convs.delete(r.id);
            this.dispatch('conversation.ended', { conversationId: r.id, reason: endReasonFor(r, this.uid) });
          }
          break;
        }
      }
    });
  }

  private seen(createdAt: string): void {
    if (createdAt > this.lastMessageAt) this.lastMessageAt = createdAt;
  }

  // ── 邀請的倒數:到時間畫面就自己收掉,不用等資料庫的巡邏 ──

  private trackInvite(inv: Invitation): void {
    if (this.pending.has(inv.id)) return;
    const ms = Math.max(0, Date.parse(inv.expiresAt) - Date.now());
    const timer = window.setTimeout(() => {
      if (!this.pending.delete(inv.id)) return;
      this.dispatch('invite.updated', { invitation: { ...inv, status: 'expired' } });
    }, ms);
    this.pending.set(inv.id, { inv, timer });
  }

  private untrackInvite(id: string): void {
    const p = this.pending.get(id);
    if (!p) return;
    window.clearTimeout(p.timer);
    this.pending.delete(id);
  }

  private settleInvite(row: InvitationRow): void {
    if (!this.pending.has(row.id)) return; // 已經處理過(自己回應的、或畫面已經逾時收掉)
    this.untrackInvite(row.id);
    this.dispatch('invite.updated', { invitation: rowToInvitation(row) });
  }

  // ── 心跳與重新連線 ──

  private async beat(): Promise<void> {
    if (!this.entered || !navigator.onLine) return;
    const { data, error } = await this.client.rpc('heartbeat');
    if (error) return; // 網路問題,下次再試
    if (data === false) {
      await this.teardown();
      this.dispatch('session.ended', { reason: 'expired' });
      return;
    }
    // 瀏覽器剛從背景回來時,重新登記在線
    if (this.roomUp) void this.roomChannel?.track(this.presenceMeta());
  }

  /** 斷線期間漏掉的東西補回來 */
  private async gapFill(): Promise<void> {
    if (!this.entered || !this.ready) return;
    const since = new Date(Date.parse(this.lastMessageAt || new Date().toISOString()) - 5000).toISOString();
    try {
      const pub = await this.client
        .from('public_messages').select('*').gt('created_at', since).order('created_at', { ascending: true });
      const convs = await this.client.from('conversations').select('*').eq('status', 'active');
      if (pub.error || convs.error) return;
      const active = parseList(convs.data, parseConversationRow);

      // 新的、已經結束的私聊
      const activeIds = new Set(active.map((c) => c.id));
      for (const c of active) {
        if (this.convs.has(c.id)) continue;
        this.convs.set(c.id, c);
        this.dispatch('conversation.started', {
          conversation: rowToConversation(c, this.uid, (id) => this.tracker.isOnline(id)),
        });
      }
      const gone = [...this.convs.keys()].filter((id) => !activeIds.has(id));
      if (gone.length > 0) {
        const ended = await this.client.from('conversations').select('*').in('id', gone);
        const byId = new Map(parseList(ended.data, parseConversationRow).map((c) => [c.id, c]));
        for (const id of gone) {
          const row = byId.get(id);
          this.convs.delete(id);
          this.dispatch('conversation.ended', {
            conversationId: id,
            reason: row ? endReasonFor(row, this.uid) : 'endedByPeer',
          });
        }
      }

      for (const m of parseList(pub.data, parseMessageRow)) {
        this.seen(m.created_at);
        this.dispatch('message.received', { message: rowToMessage(m, 'public') });
      }
      if (activeIds.size > 0) {
        const pm = await this.client
          .from('private_messages').select('*').in('conversation_id', [...activeIds])
          .gt('created_at', since).order('created_at', { ascending: true });
        for (const m of parseList(pm.data, parseMessageRow)) {
          this.seen(m.created_at);
          this.dispatch('message.received', { message: rowToMessage(m, 'private') });
        }
      }

      const invs = await this.client
        .from('invitations').select('*').eq('status', 'pending').gt('expires_at', new Date().toISOString());
      for (const r of parseList(invs.data, parseInvitationRow)) {
        const inv = rowToInvitation(r);
        const known = this.pending.has(inv.id);
        this.trackInvite(inv);
        if (!known && r.to_id === this.uid) this.dispatch('invite.received', { invitation: inv });
      }
    } catch {
      /* 補不回來就算了,之後的即時事件照常 */
    }
  }

  private async teardown(): Promise<void> {
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    if (this.presenceBeatTimer !== null) window.clearInterval(this.presenceBeatTimer);
    if (this.presenceCheckTimer !== null) window.clearInterval(this.presenceCheckTimer);
    this.presenceBeatTimer = null;
    this.presenceCheckTimer = null;
    for (const p of this.pending.values()) window.clearTimeout(p.timer);
    this.pending.clear();
    this.convs.clear();
    this.tracker.reset();
    this.entered = false;
    this.ready = false;
    this.queue = [];
    this.dbUp = false;
    this.roomUp = false;
    this.everUp = false;
    const chans = [this.dbChannel, this.roomChannel];
    this.dbChannel = null;
    this.roomChannel = null;
    await Promise.all(chans.map((c) => (c ? this.client.removeChannel(c).catch(() => undefined) : undefined)));
    this.updateStatus();
  }

  // ── 指令 ──

  async leave(): Promise<void> {
    this.guard();
    const folders = [...this.convs.keys()];
    const { error } = await this.client.rpc('leave');
    if (error) throw fromRpcError(error);
    // 先退出 Presence(別人的名單開始 15 秒倒數),再廣播「我離開了」讓大家馬上移除。
    // 兩步都設時間上限:就算網路卡住,也一定會往下收尾(關掉頻道,連線自然斷開,別人 15 秒後也會看到)。
    const room = this.roomChannel;
    if (room) {
      const announce = (async () => {
        await room.untrack();
        await room.send({ type: 'broadcast', event: 'left', payload: { userId: this.uid } });
      })().catch(() => undefined);
      await Promise.race([announce, new Promise<void>((r) => window.setTimeout(r, 1500))]);
    }
    for (const id of folders) void this.removeOwnPrivateFiles(id);
    await this.teardown();
    this.me = null;
  }

  async sendPublic(p: CommandParams['message.sendPublic']): Promise<void> {
    this.guard();
    const { error } = await this.client.rpc('send_public', { p_text: p.text, p_image: p.image ?? null });
    if (error) throw fromRpcError(error);
  }

  async sendPrivate(p: CommandParams['message.sendPrivate']): Promise<void> {
    this.guard();
    const { error } = await this.client.rpc('send_private', {
      p_conversation: p.conversationId,
      p_text: p.text,
      p_image: p.image ?? null,
    });
    if (error) throw fromRpcError(error);
  }

  async recall(p: CommandParams['message.recall']): Promise<void> {
    this.guard();
    const { data, error } = await this.client.rpc('recall', { p_scope: p.scope, p_message: p.messageId });
    if (error) throw fromRpcError(error);
    // 資料庫已經把內容清掉了;把自己上傳的照片檔也刪掉
    const image = parseImage(data);
    if (image) void this.removeFiles([image.thumbPath, image.fullPath]);
  }

  async invite(p: CommandParams['invite.send']): Promise<Invitation> {
    this.guard();
    const { data, error } = await this.client.rpc('invite', { p_to: p.toUserId });
    if (error) throw fromRpcError(error);
    const invRow = parseInvitationRow(data);
    if (!invRow) throw new ChatError('UNKNOWN');
    const inv = rowToInvitation(invRow);
    this.trackInvite(inv);
    return inv;
  }

  async respondInvite(p: CommandParams['invite.respond']): Promise<Conversation | null> {
    this.guard();
    this.untrackInvite(p.invitationId);
    const { data, error } = await this.client.rpc('respond_invite', {
      p_invitation: p.invitationId,
      p_accept: p.accept,
    });
    if (error) throw fromRpcError(error);
    if (!data) return null;
    const row = parseConversationRow(data);
    if (!row) throw new ChatError('UNKNOWN');
    // 畫面接著就要切到這個私聊,所以先在這裡通知「私聊開始了」,不等即時事件
    this.convs.set(row.id, row);
    const conversation = rowToConversation(row, this.uid, (id) => this.tracker.isOnline(id));
    this.dispatch('conversation.started', { conversation });
    return conversation;
  }

  async cancelInvite(p: CommandParams['invite.cancel']): Promise<void> {
    this.guard();
    const { error } = await this.client.rpc('cancel_invite', { p_invitation: p.invitationId });
    if (error) throw fromRpcError(error);
    this.untrackInvite(p.invitationId);
  }

  async endConversation(p: CommandParams['conversation.end']): Promise<void> {
    this.guard();
    const { error } = await this.client.rpc('end_conversation', { p_conversation: p.conversationId });
    if (error) throw fromRpcError(error);
    if (this.convs.delete(p.conversationId)) {
      this.dispatch('conversation.ended', { conversationId: p.conversationId, reason: 'endedByMe' });
    }
    void this.removeOwnPrivateFiles(p.conversationId);
  }

  async setLang(p: CommandParams['profile.setLang']): Promise<void> {
    if (!this.entered || !this.me) return;
    this.me = { ...this.me, lang: p.lang };
    void this.client.rpc('set_lang', { p_lang: p.lang });
    if (this.roomUp) void this.roomChannel?.track(this.presenceMeta());
  }

  // ── 照片 ──

  async uploadImage(
    scope: 'public' | 'private',
    blobs: ImageBlobs,
    onProgress: (percent: number) => void,
    conversationId?: string,
  ): Promise<ImageRef> {
    this.guard();
    if (blobs.full.size > LIMITS.imageMaxBytes) throw new ChatError('IMAGE_TOO_LARGE');
    if (scope === 'private' && !conversationId) throw new ChatError('NOT_ALLOWED');
    try {
      await this.ensureSession();
    } catch {
      throw new ChatError('UNKNOWN');
    }
    const bucket = scope === 'public' ? PUBLIC_BUCKET : PRIVATE_BUCKET;
    const folder = scope === 'public' ? this.uid : `${conversationId}/${this.uid}`;
    const id = crypto.randomUUID();
    const thumbObj = `${folder}/${id}_thumb.webp`;
    const fullObj = `${folder}/${id}.webp`;

    const put = async (object: string, blob: Blob) => {
      const { error } = await this.client.storage
        .from(bucket)
        .upload(object, blob, { contentType: blob.type || 'image/webp', upsert: false });
      if (error) throw uploadError(error.message);
    };
    onProgress(10);
    await put(thumbObj, blobs.thumb);
    onProgress(45);
    try {
      await put(fullObj, blobs.full);
    } catch (e) {
      void this.client.storage.from(bucket).remove([thumbObj]);
      throw e;
    }
    onProgress(100);
    return {
      thumbPath: `${bucket}/${thumbObj}`,
      fullPath: `${bucket}/${fullObj}`,
      width: blobs.width,
      height: blobs.height,
    };
  }

  async getImageUrl(path: string): Promise<string> {
    const { bucket, object } = splitImagePath(path);
    if (bucket === PUBLIC_BUCKET) {
      return this.client.storage.from(bucket).getPublicUrl(object).data.publicUrl;
    }
    const cached = this.signedUrls.get(path);
    if (cached && cached.expires > Date.now()) return cached.url;
    const { data, error } = await this.client.storage.from(bucket).createSignedUrl(object, SIGNED_URL_SEC);
    if (error || !data) throw new Error('signed url failed');
    this.signedUrls.set(path, { url: data.signedUrl, expires: Date.now() + (SIGNED_URL_SEC - 300) * 1000 });
    return data.signedUrl;
  }

  /** 刪掉照片檔(只能刪自己的;失敗不影響其他動作) */
  private async removeFiles(paths: string[]): Promise<void> {
    const byBucket = new Map<string, string[]>();
    for (const path of paths) {
      const { bucket, object } = splitImagePath(path);
      byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), object]);
    }
    for (const [bucket, objects] of byBucket) {
      await this.client.storage.from(bucket).remove(objects).catch(() => undefined);
    }
  }

  /** 私聊結束時,把自己在這個私聊上傳的照片檔刪掉 */
  private async removeOwnPrivateFiles(conversationId: string): Promise<void> {
    try {
      const folder = `${conversationId}/${this.uid}`;
      const { data } = await this.client.storage.from(PRIVATE_BUCKET).list(folder);
      if (data && data.length > 0) {
        await this.client.storage.from(PRIVATE_BUCKET).remove(data.map((f) => `${folder}/${f.name}`));
      }
    } catch {
      /* 刪不掉就算了 */
    }
  }
}

function uploadError(message: string): ChatError {
  if (/mime|type/i.test(message)) return new ChatError('IMAGE_TYPE');
  if (/size|too large|exceed/i.test(message)) return new ChatError('IMAGE_TOO_LARGE');
  if (/row-level security|policy|not allowed|unauthorized/i.test(message)) return new ChatError('NOT_ALLOWED');
  return new ChatError('UNKNOWN');
}

export function createSupabaseChatService(): ChatService {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      'VITE_BACKEND=supabase 需要設定 VITE_SUPABASE_URL 和 VITE_SUPABASE_PUBLISHABLE_KEY(見 .env.example)。',
    );
  }
  return new SupabaseChatService(url, key);
}
