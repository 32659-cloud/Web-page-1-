// 線上名單的進出判斷:
// - 剛進來時拿到完整名單(synced)
// - 有人出現在 Presence 就是「進來了」
// - 有人從 Presence 消失,要等 graceMs(15 秒)還沒回來,才算「離開了」;15 秒內回來就不通知
// - 網路悄悄中斷時,連線沒有被正常關閉,Presence 不會消失。所以每個人會定期更新自己的「心跳」(beat),
//   超過 staleMs 都沒有新的心跳,就視為已經離線(不再等 15 秒,因為已經等過了)。
// 純邏輯,計時器和時鐘可以換掉,方便測試。
import type { User } from '../../protocol/types';

/** Presence 裡的一個人。beat 是他最近一次更新的心跳編號(舊版沒有就是 undefined,不做逾時判斷) */
export type LiveUser = User & { beat?: number };

const plain = (u: LiveUser): User => ({ userId: u.userId, nickname: u.nickname, lang: u.lang });

export interface PresenceCallbacks {
  synced(users: User[]): void;
  joined(user: User): void;
  left(user: User): void;
}

interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class PresenceTracker {
  /** 目前 Presence 裡有的人 */
  private live = new Map<string, LiveUser>();
  /** 已經告訴畫面「在線上」的人 */
  private shown = new Map<string, User>();
  private pending = new Map<string, unknown>();
  private first = true;
  /** 每個人最近一次「心跳編號有變」的時間 */
  private beats = new Map<string, { value: number; at: number }>();
  /** 已經因為心跳中斷而移除的人(Presence 裡還在,但等到心跳恢復才會回來) */
  private stale = new Map<string, number>();

  constructor(
    private selfId: () => string,
    private graceMs: number,
    private cb: PresenceCallbacks,
    private timers: Timers = realTimers,
    private staleMs = 28_000,
    private now: () => number = () => Date.now(),
  ) {}

  update(users: LiveUser[]): void {
    const t = this.now();
    for (const u of users) {
      if (u.beat === undefined) continue;
      const prev = this.beats.get(u.userId);
      if (!prev || prev.value !== u.beat) this.beats.set(u.userId, { value: u.beat, at: t });
    }
    this.live = new Map(users.map((u) => [u.userId, u]));
    if (this.first) {
      this.first = false;
      this.shown = new Map([...this.live].map(([id, u]) => [id, plain(u)]));
      this.cb.synced([...this.shown.values()]);
      return;
    }
    const me = this.selfId();
    for (const u of this.live.values()) {
      if (u.userId === me) {
        this.shown.set(u.userId, plain(u));
        continue;
      }
      // 心跳中斷而被移除的人:要等到他的心跳編號又變了,才當成「回來了」
      const staleBeat = this.stale.get(u.userId);
      if (staleBeat !== undefined) {
        if (u.beat === staleBeat) continue;
        this.stale.delete(u.userId);
      }
      const pendingTimer = this.pending.get(u.userId);
      if (pendingTimer !== undefined) {
        this.timers.clear(pendingTimer);
        this.pending.delete(u.userId);
      }
      const before = this.shown.get(u.userId);
      if (!before || before.nickname !== u.nickname || before.lang !== u.lang) {
        this.shown.set(u.userId, plain(u));
        this.cb.joined(plain(u));
      }
    }
    for (const id of this.shown.keys()) {
      if (id === me || this.live.has(id) || this.pending.has(id)) continue;
      this.pending.set(
        id,
        this.timers.set(() => {
          this.pending.delete(id);
          if (this.live.has(id)) return;
          const user = this.shown.get(id);
          if (!user) return;
          this.shown.delete(id);
          this.cb.left(user);
        }, this.graceMs),
      );
    }
  }

  /** 定期呼叫:心跳中斷太久的人,視為離線(網路悄悄中斷的情況) */
  tick(): void {
    const t = this.now();
    const me = this.selfId();
    for (const [id, user] of [...this.shown]) {
      if (id === me) continue;
      const b = this.beats.get(id);
      if (!b || t - b.at <= this.staleMs) continue;
      const pendingTimer = this.pending.get(id);
      if (pendingTimer !== undefined) this.timers.clear(pendingTimer);
      this.pending.delete(id);
      this.stale.set(id, b.value);
      this.shown.delete(id);
      this.cb.left(user);
    }
  }

  /** 對方主動離開(按「離開」):不用等 15 秒 */
  remove(userId: string): void {
    const t = this.pending.get(userId);
    if (t !== undefined) this.timers.clear(t);
    this.pending.delete(userId);
    this.live.delete(userId);
    this.beats.delete(userId);
    this.stale.delete(userId);
    const user = this.shown.get(userId);
    if (!user) return;
    this.shown.delete(userId);
    this.cb.left(user);
  }

  /** 畫面上的線上名單(已經宣布過的人) */
  users(): User[] {
    return [...this.shown.values()];
  }

  isOnline(userId: string): boolean {
    return this.shown.has(userId);
  }

  reset(): void {
    for (const t of this.pending.values()) this.timers.clear(t);
    this.pending.clear();
    this.live.clear();
    this.shown.clear();
    this.beats.clear();
    this.stale.clear();
    this.first = true;
  }
}
