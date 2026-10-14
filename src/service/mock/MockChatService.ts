// 階段一的通訊層:假裝自己是伺服器。
// - 規則在 core.ts(之後會變成資料庫函式)
// - 資料放在 localStorage,事件用 BroadcastChannel 通知同一個瀏覽器的其他分頁
// - 機器人在 bots.ts
import type { EventName, ServiceEvents } from '../../protocol/events';
import { ChatError } from '../../protocol/errors';
import type { Limits } from '../../protocol/limits';
import type { Conversation, ImageRef, Invitation } from '../../protocol/types';
import type { CommandParams } from '../../protocol/commands';
import type { ChatService, ImageBlobs, MockDevTools, Unsubscribe } from '../ChatService';
import { botInviteNow, botSayNow, tickBots } from './bots';
import * as core from './core';
import { type Ctx, type Db, emptyDb } from './db';
import { clearBlobs, deleteBlobs, getBlobUrl, putBlob } from './imageStore';

const KEY_PREFIX = 'chatmock:';
const DB_KEY = KEY_PREFIX + 'db';
const CHANNEL = 'chatmock';
const LEADER_STALE_MS = 6000;

type Handler = (payload: never) => void;

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export class MockChatService implements ChatService, MockDevTools {
  readonly userId: string;
  private limits: Limits;
  private tabId = rid('tab');
  private listeners = new Map<string, Set<Handler>>();
  private lastSeq = 0;
  private entered = false;
  private offlineUntil = 0;
  private channel: BroadcastChannel | null = null;
  private timers: number[] = [];
  private started = false;
  private lastStatus: ServiceEvents['connection.changed']['status'] | null = null;

  constructor(opts: { profile: string; limits: Limits }) {
    this.limits = opts.limits;
    const idKey = `${KEY_PREFIX}id:${opts.profile}`;
    let id = localStorage.getItem(idKey);
    if (!id) {
      id = rid('u');
      localStorage.setItem(idKey, id);
    }
    this.userId = id;
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

  private setStatus(status: ServiceEvents['connection.changed']['status']): void {
    if (this.lastStatus === status) return;
    this.lastStatus = status;
    this.dispatch('connection.changed', { status });
  }

  // ── 資料庫(localStorage) ──

  private load(): Db {
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (raw) return { ...emptyDb(), ...(JSON.parse(raw) as Db) };
    } catch {
      /* 資料壞掉就重來 */
    }
    return emptyDb();
  }

  private mutate<T>(fn: (db: Db, ctx: Ctx) => T): T {
    const db = this.load();
    const ctx: Ctx = { now: Date.now(), limits: this.limits, newId: rid, blobsToDelete: [] };
    const result = fn(db, ctx); // 丟出錯誤時,不存檔(等於這次指令沒有發生)
    localStorage.setItem(DB_KEY, JSON.stringify(db));
    if (ctx.blobsToDelete.length > 0) void deleteBlobs(ctx.blobsToDelete);
    this.channel?.postMessage('changed');
    this.processEvents();
    return result;
  }

  private processEvents(): void {
    if (Date.now() < this.offlineUntil) return; // 模擬斷線中:先不收,連回來再補
    const db = this.load();
    const fresh = db.events.filter((e) => e.seq > this.lastSeq);
    this.lastSeq = db.seq;
    if (!this.entered) return;
    for (const e of fresh) {
      if (e.audience !== '*' && !e.audience.includes(this.userId)) continue;
      // 自己上線、離線的事件不用通知自己
      if (e.type === 'presence.joined' || e.type === 'presence.left') {
        const user = (e.payload as { user: { userId: string } }).user;
        if (user.userId === this.userId) continue;
      }
      this.dispatch(e.type as EventName, e.payload as never);
    }
  }

  // ── 啟動與停止 ──

  start(): void {
    if (this.started) return;
    this.started = true;
    this.lastSeq = this.load().seq;
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(CHANNEL);
      this.channel.onmessage = () => this.processEvents();
    }
    window.addEventListener('storage', this.onStorage);
    window.addEventListener('offline', this.onOffline);
    window.addEventListener('online', this.onOnline);
    this.timers.push(window.setInterval(() => this.tick(), 1000));
    this.timers.push(window.setInterval(() => this.beat(), this.limits.mockHeartbeatMs));
    this.setStatus(navigator.onLine ? 'connected' : 'offline');
    this.tick();
  }

  stop(): void {
    this.timers.forEach((t) => window.clearInterval(t));
    this.timers = [];
    this.channel?.close();
    this.channel = null;
    window.removeEventListener('storage', this.onStorage);
    window.removeEventListener('offline', this.onOffline);
    window.removeEventListener('online', this.onOnline);
    this.started = false;
  }

  private onStorage = (e: StorageEvent) => {
    if (e.key === DB_KEY) this.processEvents();
  };
  private onOffline = () => this.setStatus('offline');
  private onOnline = () => this.setStatus('connected');

  private simulatingOffline(): boolean {
    return Date.now() < this.offlineUntil;
  }

  /** 每秒一次:巡邏(離線、逾時)、機器人、補收事件 */
  private tick(): void {
    if (this.offlineUntil && !this.simulatingOffline()) {
      // 模擬斷線結束:重新連線,補回漏掉的事件
      this.offlineUntil = 0;
      this.setStatus('connected');
      this.beat();
    }
    if (this.simulatingOffline()) return;
    try {
      this.mutate((db, ctx) => {
        core.janitor(db, ctx);
        const leader = db.botLeader;
        if (!leader || leader.id === this.tabId || ctx.now - leader.beat > LEADER_STALE_MS) {
          db.botLeader = { id: this.tabId, beat: ctx.now };
          tickBots(db, ctx);
        }
      });
    } catch {
      /* 巡邏失敗不影響使用 */
    }
  }

  private beat(): void {
    if (!this.entered || this.simulatingOffline()) return;
    const alive = this.mutate((db, ctx) => core.heartbeat(db, ctx, this.userId));
    if (!alive) {
      this.entered = false;
      this.dispatch('session.ended', { reason: 'expired' });
    }
  }

  private guard(): void {
    if (this.simulatingOffline() || this.lastStatus === 'offline') throw new ChatError('UNKNOWN');
  }

  // ── 指令 ──

  async enter(p: CommandParams['session.enter']): Promise<void> {
    this.guard();
    this.lastSeq = this.load().seq;
    this.entered = false;
    const snap = this.mutate((db, ctx) => {
      core.enter(db, ctx, this.userId, p.nickname, p.lang);
      return core.snapshotFor(db, ctx, this.userId);
    });
    this.entered = true;
    this.dispatch('presence.synced', { users: snap.users });
    this.dispatch('history.loaded', { messages: snap.history });
    this.dispatch('session.restored', {
      conversations: snap.conversations,
      invitationsIn: snap.invitationsIn,
      invitationsOut: snap.invitationsOut,
    });
  }

  async leave(): Promise<void> {
    this.guard();
    this.mutate((db, ctx) => core.leave(db, ctx, this.userId));
    this.entered = false;
  }

  async sendPublic(p: CommandParams['message.sendPublic']): Promise<void> {
    this.guard();
    this.mutate((db, ctx) => core.sendPublic(db, ctx, this.userId, p.text, p.image));
  }

  async sendPrivate(p: CommandParams['message.sendPrivate']): Promise<void> {
    this.guard();
    this.mutate((db, ctx) => core.sendPrivate(db, ctx, this.userId, p.conversationId, p.text, p.image));
  }

  async recall(p: CommandParams['message.recall']): Promise<void> {
    this.guard();
    this.mutate((db, ctx) => core.recall(db, ctx, this.userId, p.scope, p.messageId));
  }

  async invite(p: CommandParams['invite.send']): Promise<Invitation> {
    this.guard();
    return this.mutate((db, ctx) => core.invite(db, ctx, this.userId, p.toUserId));
  }

  async respondInvite(p: CommandParams['invite.respond']): Promise<Conversation | null> {
    this.guard();
    return this.mutate((db, ctx) => core.respondInvite(db, ctx, this.userId, p.invitationId, p.accept));
  }

  async cancelInvite(p: CommandParams['invite.cancel']): Promise<void> {
    this.guard();
    this.mutate((db, ctx) => core.cancelInvite(db, ctx, this.userId, p.invitationId));
  }

  async endConversation(p: CommandParams['conversation.end']): Promise<void> {
    this.guard();
    this.mutate((db, ctx) => core.endConversation(db, ctx, this.userId, p.conversationId));
  }

  async setLang(p: CommandParams['profile.setLang']): Promise<void> {
    if (!this.entered) return;
    this.mutate((db) => core.setLang(db, this.userId, p.lang));
  }

  // ── 照片 ──

  async uploadImage(
    scope: 'public' | 'private',
    blobs: ImageBlobs,
    onProgress: (percent: number) => void,
  ): Promise<ImageRef> {
    this.guard();
    if (blobs.full.size > this.limits.imageMaxBytes) throw new ChatError('IMAGE_TOO_LARGE');
    const base = `${scope}/${this.userId}/${rid('img')}`;
    const thumbPath = `${base}_thumb.webp`;
    const fullPath = `${base}.webp`;
    // 模擬上傳需要的時間,讓畫面的進度條看得到
    for (const pct of [10, 35, 60, 85]) {
      onProgress(pct);
      await new Promise((r) => setTimeout(r, 120));
    }
    await putBlob(thumbPath, blobs.thumb);
    await putBlob(fullPath, blobs.full);
    onProgress(100);
    return { thumbPath, fullPath, width: blobs.width, height: blobs.height };
  }

  getImageUrl(path: string): Promise<string> {
    return getBlobUrl(path);
  }

  // ── 測試工具(只有模擬層有) ──

  simulateOffline(seconds: number): void {
    this.offlineUntil = Date.now() + seconds * 1000;
    this.setStatus('reconnecting');
  }

  botInviteMe(): void {
    this.mutate((db, ctx) => botInviteNow(db, ctx, this.userId));
  }

  botSay(): void {
    this.mutate((db, ctx) => botSayNow(db, ctx));
  }

  async resetAll(): Promise<void> {
    this.stop();
    Object.keys(localStorage)
      .filter((k) => k.startsWith(KEY_PREFIX))
      .forEach((k) => localStorage.removeItem(k));
    await clearBlobs();
    window.location.reload();
  }
}
