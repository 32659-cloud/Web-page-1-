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
