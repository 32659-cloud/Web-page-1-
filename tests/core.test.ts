// 模擬後端規則的測試。這些規則就是階段二要寫進 Supabase 的規則,所以同一組測試之後也能拿來驗證真實後端。
import { describe, expect, it } from 'vitest';
import { ChatError, type ErrorCode } from '../src/protocol/errors';
import { LIMITS } from '../src/protocol/limits';
import * as core from '../src/service/mock/core';
import { type Ctx, type Db, emptyDb } from '../src/service/mock/db';

const MIN = 60_000;

function setup() {
  const db: Db = emptyDb();
  let n = 0;
  const ctx: Ctx = { now: 1_000_000, limits: LIMITS, newId: (p) => `${p}${++n}`, blobsToDelete: [] };
  return { db, ctx };
}

function code(fn: () => unknown): ErrorCode | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof ChatError ? e.code : null;
  }
}

function two() {
  const s = setup();
  core.enter(s.db, s.ctx, 'a', '小明', 'zh-TW');
  core.enter(s.db, s.ctx, 'b', '小美', 'zh-TW');
  return s;
}

function befriend(s: ReturnType<typeof setup>, from: string, to: string) {
  const inv = core.invite(s.db, s.ctx, from, to);
  return core.respondInvite(s.db, s.ctx, to, inv.id, true)!;
}

describe('代號', () => {
  it('重複的代號不能進入(不分大小寫、全形半形)', () => {
    const { db, ctx } = setup();
    core.enter(db, ctx, 'a', 'Anna', 'en');
    expect(code(() => core.enter(db, ctx, 'b', 'anna', 'en'))).toBe('NICKNAME_TAKEN');
    expect(code(() => core.enter(db, ctx, 'b', 'ａｎｎａ', 'en'))).toBe('NICKNAME_TAKEN');
  });

  it('長度 1 到 20 字,前後空白會去掉,全空白不行', () => {
    const { db, ctx } = setup();
    expect(code(() => core.enter(db, ctx, 'a', '   ', 'en'))).toBe('NICKNAME_INVALID');
    expect(code(() => core.enter(db, ctx, 'a', 'x'.repeat(21), 'en'))).toBe('NICKNAME_INVALID');
    core.enter(db, ctx, 'a', '  小明  ', 'en');
    expect(db.users.a.nickname).toBe('小明');
  });

  it('同一個人重新進入(重新整理)可以拿回自己的代號', () => {
    const { db, ctx } = setup();
    core.enter(db, ctx, 'a', '小明', 'en');
    expect(code(() => core.enter(db, ctx, 'a', '小明', 'en'))).toBeNull();
  });
});

describe('公開訊息與防洗版', () => {
  it('每秒最多 3 則', () => {
    const { db, ctx } = two();
    for (const t of ['一', '二', '三']) core.sendPublic(db, ctx, 'a', t);
    expect(code(() => core.sendPublic(db, ctx, 'a', '四'))).toBe('RATE_LIMITED');
    ctx.now += 1100;
    expect(code(() => core.sendPublic(db, ctx, 'a', '四'))).toBeNull();
  });

  it('相同內容 1 分鐘內最多 3 次(忽略空白、大小寫、標點)', () => {
    const { db, ctx } = two();
    for (const t of ['hello', 'Hello!', ' hello ']) {
      core.sendPublic(db, ctx, 'a', t);
      ctx.now += 1100;
    }
    expect(code(() => core.sendPublic(db, ctx, 'a', 'HELLO'))).toBe('DUPLICATE_CONTENT');
    ctx.now += 61 * 1000;
    expect(code(() => core.sendPublic(db, ctx, 'a', 'HELLO'))).toBeNull();
  });

  it('超過 500 字被擋下,500 字剛好可以', () => {
    const { db, ctx } = two();
    expect(code(() => core.sendPublic(db, ctx, 'a', 'x'.repeat(501)))).toBe('TEXT_TOO_LONG');
    expect(code(() => core.sendPublic(db, ctx, 'a', 'x'.repeat(500)))).toBeNull();
  });

  it('公開訊息只保留最新 100 則', () => {
    const { db, ctx } = two();
    for (let i = 0; i < 120; i++) {
      core.sendPublic(db, ctx, 'a', `訊息 ${i}`);
      ctx.now += 1100;
    }
    expect(db.publicMessages).toHaveLength(100);
    expect(db.publicMessages[0].text).toBe('訊息 20');
  });

  it('照片每分鐘最多 3 張', () => {
    const { db, ctx } = two();
    const img = { thumbPath: 't', fullPath: 'f', width: 1, height: 1 };
    for (let i = 0; i < 3; i++) {
      core.sendPublic(db, ctx, 'a', '', img);
      ctx.now += 1100;
    }
    expect(code(() => core.sendPublic(db, ctx, 'a', '', img))).toBe('IMAGE_RATE_LIMITED');
  });

  it('收回:只能收回自己的,內容真的清掉,照片會被刪除', () => {
    const { db, ctx } = two();
    core.sendPublic(db, ctx, 'a', '秘密', { thumbPath: 't', fullPath: 'f', width: 1, height: 1 });
    const id = db.publicMessages[0].id;
    expect(code(() => core.recall(db, ctx, 'b', 'public', id))).toBe('NOT_ALLOWED');
    core.recall(db, ctx, 'a', 'public', id);
    expect(db.publicMessages[0]).toMatchObject({ recalled: true, text: null, image: null });
    expect(ctx.blobsToDelete).toEqual(['t', 'f']);
  });
});

describe('私聊邀請', () => {
  it('接受後建立私聊,雙方都收到事件', () => {
    const { db, ctx } = two();
    const conv = befriend({ db, ctx }, 'a', 'b');
    expect(conv.peer.nickname).toBe('小明');
    const started = db.events.filter((e) => e.type === 'conversation.started');
    expect(started.map((e) => e.audience)).toEqual([['a'], ['b']]);
  });

  it('拒絕後 30 分鐘內不能再邀請同一個人,之後可以', () => {
    const { db, ctx } = two();
    const inv = core.invite(db, ctx, 'a', 'b');
    core.respondInvite(db, ctx, 'b', inv.id, false);
    expect(code(() => core.invite(db, ctx, 'a', 'b'))).toBe('INVITE_COOLDOWN');
    const stay = () => ['a', 'b'].forEach((u) => core.heartbeat(db, ctx, u)); // 兩個人一直在線
    ctx.now += 29 * MIN;
    stay();
    expect(code(() => core.invite(db, ctx, 'a', 'b'))).toBe('INVITE_COOLDOWN');
    ctx.now += 2 * MIN;
    stay();
    expect(code(() => core.invite(db, ctx, 'a', 'b'))).toBeNull();
  });

  it('60 秒沒回應:自動結束(逾時),不算被拒絕,可以馬上再邀請', () => {
    const { db, ctx } = two();
    core.invite(db, ctx, 'a', 'b');
    const stay = () => ['a', 'b'].forEach((u) => core.heartbeat(db, ctx, u));
    ctx.now += 50 * 1000;
    stay();
    core.janitor(db, ctx);
    expect(db.invitations[0].status).toBe('pending');
    ctx.now += 20 * 1000;
    stay();
    core.janitor(db, ctx);
    const updates = db.events.filter((e) => e.type === 'invite.updated');
    expect(updates.pop()?.payload).toMatchObject({ invitation: { status: 'expired' } });
    expect(db.cooldowns).toHaveLength(0); // 逾時不算被拒絕,沒有冷卻
    expect(code(() => core.invite(db, ctx, 'a', 'b'))).toBeNull();
  });

  it('同時只能有一個等待中的邀請;對方沒回應前可以取消', () => {
    const { db, ctx } = two();
    const inv = core.invite(db, ctx, 'a', 'b');
    expect(code(() => core.invite(db, ctx, 'a', 'b'))).toBe('INVITE_PENDING');
    core.cancelInvite(db, ctx, 'a', inv.id);
    expect(db.invitations[0].status).toBe('cancelled');
  });

  it('同一個人對同一個對象 1 分鐘最多邀請 2 次', () => {
    const { db, ctx } = two();
    for (let i = 0; i < 2; i++) {
      const inv = core.invite(db, ctx, 'a', 'b');
      core.cancelInvite(db, ctx, 'a', inv.id);
    }
    expect(code(() => core.invite(db, ctx, 'a', 'b'))).toBe('INVITE_RATE_LIMITED');
    ctx.now += 61 * 1000;
    core.heartbeat(db, ctx, 'a');
    core.heartbeat(db, ctx, 'b');
    expect(code(() => core.invite(db, ctx, 'a', 'b'))).toBeNull();
  });

  it('已經有私聊的人不能重複邀請;對方離線不能邀請;不能邀請自己', () => {
    const { db, ctx } = two();
    befriend({ db, ctx }, 'a', 'b');
    expect(code(() => core.invite(db, ctx, 'a', 'b'))).toBe('ALREADY_CHATTING');
    expect(code(() => core.invite(db, ctx, 'a', 'a'))).toBe('NOT_ALLOWED');
    core.enter(db, ctx, 'c', '阿強', 'en');
    ctx.now += 20_000;
    core.heartbeat(db, ctx, 'a');
    core.janitor(db, ctx); // c 已經離線超過 15 秒
    expect(code(() => core.invite(db, ctx, 'a', 'c'))).toBe('PEER_OFFLINE');
  });

  it('同時最多 5 個私聊', () => {
    const s = setup();
    core.enter(s.db, s.ctx, 'me', '我', 'en');
    for (let i = 0; i < 5; i++) {
      core.enter(s.db, s.ctx, `p${i}`, `朋友${i}`, 'en');
      befriend(s, 'me', `p${i}`);
    }
    core.enter(s.db, s.ctx, 'p5', '朋友5', 'en');
    expect(code(() => core.invite(s.db, s.ctx, 'me', 'p5'))).toBe('SELF_CHAT_FULL');
    expect(code(() => core.invite(s.db, s.ctx, 'p5', 'me'))).toBe('PEER_CHAT_FULL');
  });
});

describe('私聊只有兩個人看得到', () => {
  it('私聊訊息的事件只送給兩位參與者', () => {
    const { db, ctx } = two();
    core.enter(db, ctx, 'c', '路人', 'en');
    const conv = befriend({ db, ctx }, 'a', 'b');
    core.sendPrivate(db, ctx, 'a', conv.id, '悄悄話');
    const ev = db.events.filter((e) => e.type === 'message.received').pop()!;
    expect(ev.audience).toEqual(['a', 'b']);
  });

  it('不是參與者不能送私聊訊息,也不能看到進入時的資料', () => {
    const { db, ctx } = two();
    core.enter(db, ctx, 'c', '路人', 'en');
    const conv = befriend({ db, ctx }, 'a', 'b');
    core.sendPrivate(db, ctx, 'a', conv.id, '悄悄話');
    expect(code(() => core.sendPrivate(db, ctx, 'c', conv.id, '偷看'))).toBe('CONVERSATION_ENDED');
    expect(core.snapshotFor(db, ctx, 'c').conversations).toHaveLength(0);
    expect(core.snapshotFor(db, ctx, 'b').conversations[0].messages).toHaveLength(1);
  });

  it('結束私聊:訊息與照片刪除,雙方收到結束原因', () => {
    const { db, ctx } = two();
    const conv = befriend({ db, ctx }, 'a', 'b');
    core.sendPrivate(db, ctx, 'a', conv.id, '照片', { thumbPath: 't', fullPath: 'f', width: 1, height: 1 });
    core.endConversation(db, ctx, 'a', conv.id);
    expect(db.privateMessages).toHaveLength(0);
    expect(ctx.blobsToDelete).toEqual(['t', 'f']);
    const ended = db.events.filter((e) => e.type === 'conversation.ended').map((e) => (e.payload as { reason: string }).reason);
    expect(ended).toEqual(['endedByMe', 'endedByPeer']);
  });

  it('按「離開」:所有私聊結束,代號釋放,對方看到「已離開」', () => {
    const { db, ctx } = two();
    befriend({ db, ctx }, 'a', 'b');
    core.leave(db, ctx, 'a');
    expect(db.conversations).toHaveLength(0);
    expect(db.users.a).toBeUndefined();
    const ev = db.events.filter((e) => e.type === 'conversation.ended').pop()!;
    expect(ev).toMatchObject({ audience: ['b'], payload: { reason: 'peerLeft' } });
    expect(code(() => core.enter(db, ctx, 'x', '小明', 'en'))).toBeNull();
  });
});

describe('離線', () => {
  it('離線超過 15 秒才宣布離開;15 秒內回來沒有任何提示', () => {
    const { db, ctx } = two();
    const before = db.events.length;
    ctx.now += 10_000;
    core.heartbeat(db, ctx, 'b');
    core.janitor(db, ctx); // a 離線 10 秒:不宣布
    expect(db.events.some((e) => e.type === 'presence.left')).toBe(false);
    core.heartbeat(db, ctx, 'a');
    expect(db.events.length).toBe(before); // 沒有新事件
    ctx.now += 16_000;
    core.heartbeat(db, ctx, 'b');
    core.janitor(db, ctx);
    expect(db.events.filter((e) => e.type === 'presence.left')).toHaveLength(1);
  });

  it('沒有私聊的人離線 2 分鐘後釋放代號', () => {
    const { db, ctx } = two();
    ctx.now += 2 * MIN + 1000;
    core.heartbeat(db, ctx, 'b');
    core.janitor(db, ctx);
    expect(db.users.a).toBeUndefined();
    expect(core.heartbeat(db, ctx, 'a')).toBe(false);
  });

  it('有私聊的人離線:30 分鐘內保留代號與私聊,超過就結束', () => {
    const { db, ctx } = two();
    befriend({ db, ctx }, 'a', 'b');
    ctx.now += 20 * MIN;
    core.heartbeat(db, ctx, 'b');
    core.janitor(db, ctx);
    expect(db.users.a).toBeDefined();
    expect(db.conversations).toHaveLength(1);
    ctx.now += 11 * MIN;
    core.heartbeat(db, ctx, 'b');
    core.janitor(db, ctx);
    expect(db.users.a).toBeUndefined();
    expect(db.conversations).toHaveLength(0);
    const ev = db.events.filter((e) => e.type === 'conversation.ended').pop()!;
    expect(ev).toMatchObject({ audience: ['b'], payload: { reason: 'peerTimeout' } });
  });
});
