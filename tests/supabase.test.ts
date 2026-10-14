// 真實通訊層裡「不需要連線就能測」的部分:資料轉換、錯誤轉換、線上名單的進出判斷。
import { describe, expect, it } from 'vitest';
import { PresenceTracker } from '../src/service/supabase/PresenceTracker';
import {
  type ConversationRow,
  endReasonFor,
  fromRpcError,
  rowToConversation,
  rowToInvitation,
  rowToMessage,
  splitImagePath,
} from '../src/service/supabase/mapping';
import { parseConversationRow, parseImage, parseInvitationRow, parseList, parseMessageRow } from '../src/service/supabase/validate';
import type { User } from '../src/protocol/types';

const user = (id: string, nickname = id): User => ({ userId: id, nickname, lang: 'zh-TW' });

describe('錯誤轉換', () => {
  it('錯誤代碼和等待秒數', () => {
    const e = fromRpcError({ message: 'RATE_LIMITED', details: '3' });
    expect(e.code).toBe('RATE_LIMITED');
    expect(e.retryAfterSec).toBe(3);
  });
  it('不認得的錯誤變成 UNKNOWN', () => {
    expect(fromRpcError({ message: 'TypeError: Failed to fetch' }).code).toBe('UNKNOWN');
    expect(fromRpcError(null).code).toBe('UNKNOWN');
  });
  it('沒有等待秒數', () => {
    expect(fromRpcError({ message: 'NICKNAME_TAKEN', details: null }).retryAfterSec).toBeUndefined();
  });
});

describe('資料轉換', () => {
  it('被收回的訊息內容是 null', () => {
    const m = rowToMessage(
      { id: 'm', sender_id: 'u', sender_nick: 'A', body: 'x', image: null, recalled: true, created_at: '2026-10-14T00:00:00Z' },
      'public',
    );
    expect(m.text).toBeNull();
    expect(m.recalled).toBe(true);
    expect(m.conversationId).toBeNull();
  });
  it('私聊訊息帶私聊編號', () => {
    const m = rowToMessage(
      { id: 'm', conversation_id: 'c1', sender_id: 'u', sender_nick: 'A', body: 'x', image: null, recalled: false, created_at: '2026-10-14T00:00:00Z' },
      'private',
    );
    expect(m.conversationId).toBe('c1');
    expect(m.createdAt).toBe('2026-10-14T00:00:00.000Z');
  });
  it('邀請', () => {
    const i = rowToInvitation({
      id: 'i', from_id: 'a', to_id: 'b', from_nick: 'A', to_nick: 'B', status: 'pending',
      created_at: '2026-10-14T00:00:00+00:00', expires_at: '2026-10-14T00:01:00+00:00',
    });
    expect(i.from).toEqual({ userId: 'a', nickname: 'A' });
    expect(i.expiresAt).toBe('2026-10-14T00:01:00.000Z');
  });

  const row: ConversationRow = {
    id: 'c', user_a: 'a', user_b: 'b', nick_a: 'A', nick_b: 'B',
    started_at: '2026-10-14T00:00:00Z', status: 'active', ended_by: null, end_reason: null,
  };
  it('私聊:從兩邊看,對方不同', () => {
    expect(rowToConversation(row, 'a', () => true).peer).toEqual({ userId: 'b', nickname: 'B' });
    expect(rowToConversation(row, 'b', () => false)).toMatchObject({ peer: { userId: 'a', nickname: 'A' }, peerOnline: false });
  });
  it('私聊結束的原因,從自己的角度看', () => {
    expect(endReasonFor({ ...row, status: 'ended', ended_by: 'a', end_reason: 'ended' }, 'a')).toBe('endedByMe');
    expect(endReasonFor({ ...row, status: 'ended', ended_by: 'a', end_reason: 'ended' }, 'b')).toBe('endedByPeer');
    expect(endReasonFor({ ...row, status: 'ended', ended_by: 'a', end_reason: 'left' }, 'b')).toBe('peerLeft');
    expect(endReasonFor({ ...row, status: 'ended', ended_by: null, end_reason: 'timeout' }, 'b')).toBe('peerTimeout');
  });
  it('照片路徑第一段是桶子', () => {
    expect(splitImagePath('chat-private/c1/u1/x.webp')).toEqual({ bucket: 'chat-private', object: 'c1/u1/x.webp' });
  });
});

describe('線上名單的進出判斷', () => {
  function setup() {
    const log: string[] = [];
    const tasks: { fn: () => void; ms: number; done: boolean }[] = [];
    const tracker = new PresenceTracker(
      () => 'me',
      15_000,
      {
        synced: (us) => log.push('synced:' + us.map((u) => u.userId).join(',')),
        joined: (u) => log.push('joined:' + u.userId),
        left: (u) => log.push('left:' + u.userId),
      },
      {
        set: (fn, ms) => {
          const t = { fn, ms, done: false };
          tasks.push(t);
          return t;
        },
        clear: (h) => {
          (h as { done: boolean }).done = true;
        },
      },
    );
    const fire = () => tasks.filter((t) => !t.done).forEach((t) => ((t.done = true), t.fn()));
    return { tracker, log, fire };
  }

  it('第一次拿到完整名單', () => {
    const { tracker, log } = setup();
    tracker.update([user('me'), user('a')]);
    expect(log).toEqual(['synced:me,a']);
    expect(tracker.isOnline('a')).toBe(true);
  });

  it('有人進來', () => {
    const { tracker, log } = setup();
    tracker.update([user('me')]);
    tracker.update([user('me'), user('a')]);
    expect(log).toEqual(['synced:me', 'joined:a']);
  });

  it('消失後要等 15 秒才算離開', () => {
    const { tracker, log, fire } = setup();
    tracker.update([user('me'), user('a')]);
    tracker.update([user('me')]);
    expect(log).toEqual(['synced:me,a']); // 還沒宣布
    expect(tracker.isOnline('a')).toBe(true);
    fire();
    expect(log).toEqual(['synced:me,a', 'left:a']);
    expect(tracker.isOnline('a')).toBe(false);
  });

  it('15 秒內回來,不通知任何事', () => {
    const { tracker, log, fire } = setup();
    tracker.update([user('me'), user('a')]);
    tracker.update([user('me')]);
    tracker.update([user('me'), user('a')]);
    fire();
    expect(log).toEqual(['synced:me,a']);
    expect(tracker.isOnline('a')).toBe(true);
  });

  it('主動離開:馬上通知', () => {
    const { tracker, log } = setup();
    tracker.update([user('me'), user('a')]);
    tracker.remove('a');
    expect(log).toEqual(['synced:me,a', 'left:a']);
  });

  it('自己消失(正在重連)不會被當成「自己離開了」', () => {
    const { tracker, log, fire } = setup();
    tracker.update([user('me'), user('a')]);
    tracker.update([user('a')]);
    fire();
    expect(log).toEqual(['synced:me,a']);
  });

  it('改代號會再通知一次(畫面原地更新)', () => {
    const { tracker, log } = setup();
    tracker.update([user('me'), user('a', 'A')]);
    tracker.update([user('me'), user('a', 'AA')]);
    expect(log).toEqual(['synced:me,a', 'joined:a']);
  });
});

describe('網路悄悄中斷(心跳)', () => {
  function setup() {
    const log: string[] = [];
    let clock = 0;
    const tracker = new PresenceTracker(
      () => 'me',
      15_000,
      {
        synced: (us) => log.push('synced:' + us.map((u) => u.userId).join(',')),
        joined: (u) => log.push('joined:' + u.userId),
        left: (u) => log.push('left:' + u.userId),
      },
      { set: () => ({}), clear: () => undefined },
      28_000,
      () => clock,
    );
    const beat = (id: string, n: number) => ({ ...user(id), beat: n });
    return { tracker, log, at: (ms: number) => (clock = ms), beat };
  }

  it('心跳一直更新,不會被當成離線', () => {
    const { tracker, log, at, beat } = setup();
    tracker.update([beat('me', 1), beat('a', 1)]);
    for (let i = 1; i <= 10; i++) {
      at(i * 10_000);
      tracker.update([beat('me', i + 1), beat('a', i + 1)]);
      tracker.tick();
    }
    expect(log).toEqual(['synced:me,a']);
  });

  it('心跳停了超過 28 秒,視為離線,即使 Presence 裡還在', () => {
    const { tracker, log, at, beat } = setup();
    tracker.update([beat('me', 1), beat('a', 1)]);
    at(20_000);
    tracker.update([beat('me', 2), beat('a', 1)]); // a 的心跳編號沒變
    tracker.tick();
    expect(log).toEqual(['synced:me,a']); // 還沒到 28 秒
    at(29_000);
    tracker.tick();
    expect(log).toEqual(['synced:me,a', 'left:a']);
    expect(tracker.isOnline('a')).toBe(false);
  });

  it('被移除之後,同一份舊資料不會讓他又出現', () => {
    const { tracker, log, at, beat } = setup();
    tracker.update([beat('me', 1), beat('a', 1)]);
    at(30_000);
    tracker.tick();
    at(40_000);
    tracker.update([beat('me', 4), beat('a', 1)]);
    expect(log).toEqual(['synced:me,a', 'left:a']);
  });

  it('心跳恢復後,他會回來', () => {
    const { tracker, log, at, beat } = setup();
    tracker.update([beat('me', 1), beat('a', 1)]);
    at(30_000);
    tracker.tick();
    at(35_000);
    tracker.update([beat('me', 5), beat('a', 5)]);
    expect(log).toEqual(['synced:me,a', 'left:a', 'joined:a']);
    expect(tracker.isOnline('a')).toBe(true);
  });

  it('舊版沒有心跳資訊的人,不做逾時判斷', () => {
    const { tracker, log, at } = setup();
    tracker.update([user('me'), user('a')]);
    at(120_000);
    tracker.tick();
    expect(log).toEqual(['synced:me,a']);
  });

  it('自己不會因為心跳而被移除', () => {
    const { tracker, log, at, beat } = setup();
    tracker.update([beat('me', 1)]);
    at(120_000);
    tracker.tick();
    expect(log).toEqual(['synced:me']);
  });
});

describe('收到的資料先檢查才顯示', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const good = { id, sender_id: id, sender_nick: 'A', body: 'hi', image: null, recalled: false, created_at: '2026-10-14T00:00:00Z' };

  it('正常的訊息通過', () => {
    expect(parseMessageRow(good)?.body).toBe('hi');
    expect(parseMessageRow({ ...good, recalled: true, body: null })?.recalled).toBe(true);
  });
  it('HTML 字串是合法的文字(畫面當純文字顯示),但格式錯的欄位會被丟掉', () => {
    expect(parseMessageRow({ ...good, body: '<img src=x onerror=alert(1)>' })?.body).toContain('<img');
    expect(parseMessageRow({ ...good, id: 'not-a-uuid' })).toBeNull();
    expect(parseMessageRow({ ...good, sender_nick: 'x'.repeat(41) })).toBeNull();
    expect(parseMessageRow({ ...good, body: 'x'.repeat(1001) })).toBeNull();
    expect(parseMessageRow({ ...good, recalled: 'no' })).toBeNull();
    expect(parseMessageRow({ ...good, created_at: 'yesterday-ish' })).toBeNull();
    expect(parseMessageRow(null)).toBeNull();
    expect(parseMessageRow('hello')).toBeNull();
  });
  it('照片路徑一定要在兩個桶子裡,不能有 ..', () => {
    const ok = { thumbPath: 'chat-public/u/a_thumb.webp', fullPath: 'chat-public/u/a.webp', width: 10, height: 10 };
    expect(parseImage(ok)).toEqual(ok);
    expect(parseImage({ ...ok, fullPath: 'https://evil.example/x.png' })).toBeNull();
    expect(parseImage({ ...ok, fullPath: 'chat-public/../secret' })).toBeNull();
    expect(parseImage({ ...ok, width: 0 })).toBeNull();
    expect(parseImage({ ...ok, width: 1.5 })).toBeNull();
    expect(parseMessageRow({ ...good, image: { ...ok, thumbPath: 'javascript:alert(1)' } })).toBeNull();
  });
  it('邀請與私聊', () => {
    const inv = { id, from_id: id, to_id: id, from_nick: 'A', to_nick: 'B', status: 'pending', created_at: '2026-10-14T00:00:00Z', expires_at: '2026-10-14T00:01:00Z' };
    expect(parseInvitationRow(inv)?.status).toBe('pending');
    expect(parseInvitationRow({ ...inv, status: 'hacked' })).toBeNull();
    const conv = { id, user_a: id, user_b: id, nick_a: 'A', nick_b: 'B', started_at: '2026-10-14T00:00:00Z', status: 'active', ended_by: null, end_reason: null };
    expect(parseConversationRow(conv)?.status).toBe('active');
    expect(parseConversationRow({ ...conv, end_reason: 'because' })).toBeNull();
    expect(parseConversationRow({ ...conv, status: 'weird' })).toBeNull();
  });
  it('一整串資料裡,壞掉的那幾筆被丟掉,其餘照常', () => {
    expect(parseList([good, { nope: 1 }, { ...good, id: 'bad' }], parseMessageRow)).toHaveLength(1);
    expect(parseList('not a list', parseMessageRow)).toEqual([]);
  });
});

describe('主動離開的通知比 Presence 的消失通知早到', () => {
  function setup() {
    const log: string[] = [];
    let clock = 0;
    const tracker = new PresenceTracker(
      () => 'me',
      15_000,
      {
        synced: (us) => log.push('synced:' + us.map((u) => u.userId).join(',')),
        joined: (u) => log.push('joined:' + u.userId),
        left: (u) => log.push('left:' + u.userId),
      },
      { set: () => ({}), clear: () => undefined },
      28_000,
      () => clock,
    );
    const beat = (id: string, n: number) => ({ ...user(id), beat: n });
    return { tracker, log, at: (ms: number) => (clock = ms), beat };
  }

  it('離開後,Presence 裡的舊資料不會讓他又出現', () => {
    const { tracker, log, beat } = setup();
    tracker.update([beat('me', 1), beat('a', 7)]);
    tracker.remove('a'); // 收到「a 離開了」的廣播
    tracker.update([beat('me', 2), beat('a', 7)]); // 別人的心跳觸發同步,Presence 裡還留著 a 的舊資料
    expect(log).toEqual(['synced:me,a', 'left:a']);
    expect(tracker.isOnline('a')).toBe(false);
  });

  it('同一個人真的重新進來(新的心跳編號)就會回來', () => {
    const { tracker, log, beat } = setup();
    tracker.update([beat('me', 1), beat('a', 7)]);
    tracker.remove('a');
    tracker.update([beat('me', 2), beat('a', 99)]);
    expect(log).toEqual(['synced:me,a', 'left:a', 'joined:a']);
  });
});

