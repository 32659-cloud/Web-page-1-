// 線上名單的進出判斷:
// - 剛進來時拿到完整名單(synced)
// - 有人出現在 Presence 就是「進來了」
// - 有人從 Presence 消失,要等 graceMs(15 秒)還沒回來,才算「離開了」;15 秒內回來就不通知
// 純邏輯,計時器可以換掉,方便測試。
import type { User } from '../../protocol/types';

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
  private live = new Map<string, User>();
  /** 已經告訴畫面「在線上」的人 */
  private shown = new Map<string, User>();
  private pending = new Map<string, unknown>();
  private first = true;

  constructor(
    private selfId: () => string,
    private graceMs: number,
    private cb: PresenceCallbacks,
    private timers: Timers = realTimers,
  ) {}

  update(users: User[]): void {
    this.live = new Map(users.map((u) => [u.userId, u]));
    if (this.first) {
      this.first = false;
      this.shown = new Map(this.live);
      this.cb.synced([...this.shown.values()]);
      return;
    }
    const me = this.selfId();
    for (const u of this.live.values()) {
      if (u.userId === me) {
        this.shown.set(u.userId, u);
        continue;
      }
      const t = this.pending.get(u.userId);
      if (t !== undefined) {
        this.timers.clear(t);
        this.pending.delete(u.userId);
      }
      const before = this.shown.get(u.userId);
      if (!before || before.nickname !== u.nickname || before.lang !== u.lang) {
        this.shown.set(u.userId, u);
        this.cb.joined(u);
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

  /** 對方主動離開(按「離開」):不用等 15 秒 */
  remove(userId: string): void {
    const t = this.pending.get(userId);
    if (t !== undefined) this.timers.clear(t);
    this.pending.delete(userId);
    this.live.delete(userId);
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
    this.first = true;
  }
}
