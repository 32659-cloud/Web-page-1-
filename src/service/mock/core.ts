// 模擬後端的「規則」:代號、限速、邀請、私聊……
// 這裡的規則,就是階段二要寫進 Supabase 資料庫函式裡的規則(docs/architecture.md 4.2)。
// 全部是純函式:輸入資料庫物件、時間、規則常數,直接修改資料庫並產生事件,不碰瀏覽器,所以可以用 Vitest 測試。
import { ChatError } from '../../protocol/errors';
import type { ConversationEndReason, ImageRef, Lang } from '../../protocol/types';
import { charCount, checkNickname, dupKey } from '../../utils/nickname';
import {
  type ConvRec,
  type Ctx,
  type Db,
  type InvRec,
  type MsgRec,
  isOnline,
  toConversation,
  toInvitation,
  toMessage,
  toUser,
} from './db';

const KEEP_EVENTS = 400;
const RATE_KEEP_MS = 5 * 60 * 1000;

// ── 小工具 ──

export function emit(db: Db, type: string, payload: unknown, audience: '*' | string[]): void {
  db.seq += 1;
  db.events.push({ seq: db.seq, type, payload, audience });
  if (db.events.length > KEEP_EVENTS) db.events.splice(0, db.events.length - KEEP_EVENTS);
}

function convsOf(db: Db, uid: string): ConvRec[] {
  return db.conversations.filter((c) => c.a === uid || c.b === uid);
}

function peerOf(c: ConvRec, uid: string): string {
  return c.a === uid ? c.b : c.a;
}

function requireUser(db: Db, uid: string) {
  const u = db.users[uid];
  if (!u) throw new ChatError('NOT_ENTERED');
  return u;
}

function retrySec(untilMs: number, now: number): number {
  return Math.max(1, Math.ceil((untilMs - now) / 1000));
}

function notifyPeers(db: Db, uid: string, online: boolean): void {
  for (const c of convsOf(db, uid)) {
    emit(db, 'conversation.peerStatus', { conversationId: c.id, online }, [peerOf(c, uid)]);
  }
}

function dropImage(ctx: Ctx, image: ImageRef | null): void {
  if (image) ctx.blobsToDelete.push(image.thumbPath, image.fullPath);
}

// ── 進入、心跳、離開 ──

export function enter(db: Db, ctx: Ctx, uid: string, nickname: string, lang: Lang, isBot = false): void {
  const chk = checkNickname(nickname);
  if (!chk.ok) throw new ChatError(chk.code);
  const taken = Object.values(db.users).some((u) => u.userId !== uid && u.key === chk.key);
  if (taken) throw new ChatError('NICKNAME_TAKEN');

  const prev = db.users[uid];
  const wasOnline = isOnline(prev, ctx.limits, ctx.now);
  db.users[uid] = {
    userId: uid,
    nickname: chk.value,
    key: chk.key,
    lang,
    lastSeen: ctx.now,
    online: true,
    isBot,
  };
  db.names[uid] = chk.value;
  if (!wasOnline || prev?.nickname !== chk.value) {
    emit(db, 'presence.joined', { user: toUser(db.users[uid]) }, '*');
  }
  if (!wasOnline) notifyPeers(db, uid, true);
}

/** 回傳 false 代表伺服器已經不認得這個人(代號已被釋放) */
export function heartbeat(db: Db, ctx: Ctx, uid: string): boolean {
  const u = db.users[uid];
  if (!u) return false;
  const was = isOnline(u, ctx.limits, ctx.now);
  u.lastSeen = ctx.now;
  if (!was) {
    u.online = true;
    emit(db, 'presence.joined', { user: toUser(u) }, '*');
    notifyPeers(db, uid, true);
  }
  return true;
}

export function setLang(db: Db, uid: string, lang: Lang): void {
  requireUser(db, uid).lang = lang;
}

function cancelPendingOf(db: Db, uid: string): void {
  for (const inv of db.invitations) {
    if (inv.status === 'pending' && (inv.from === uid || inv.to === uid)) {
      inv.status = 'cancelled';
      emit(db, 'invite.updated', { invitation: toInvitation(db, inv) }, [inv.from, inv.to]);
    }
  }
}

function closeConversation(
  db: Db,
  ctx: Ctx,
  conv: ConvRec,
  reasonFor: (uid: string) => ConversationEndReason | null,
): void {
  db.conversations = db.conversations.filter((c) => c.id !== conv.id);
  const gone = db.privateMessages.filter((m) => m.conversationId === conv.id);
  for (const m of gone) dropImage(ctx, m.image);
  db.privateMessages = db.privateMessages.filter((m) => m.conversationId !== conv.id);
  for (const uid of [conv.a, conv.b]) {
    const reason = reasonFor(uid);
    if (reason) emit(db, 'conversation.ended', { conversationId: conv.id, reason }, [uid]);
  }
}

/** 按「離開」:結束所有私聊、釋放代號 */
export function leave(db: Db, ctx: Ctx, uid: string): void {
  const u = db.users[uid];
  if (!u) return;
  for (const c of convsOf(db, uid)) {
    closeConversation(db, ctx, c, (who) => (who === uid ? null : 'peerLeft'));
  }
  cancelPendingOf(db, uid);
  const wasOnline = isOnline(u, ctx.limits, ctx.now);
  delete db.users[uid];
  if (wasOnline) emit(db, 'presence.left', { user: toUser(u) }, '*');
}

// ── 訊息 ──

function checkContent(db: Db, ctx: Ctx, uid: string, text: string, image: ImageRef | null | undefined) {
  const trimmed = text.trim();
  if (charCount(trimmed) > ctx.limits.textMax) throw new ChatError('TEXT_TOO_LONG');
  if (!trimmed && !image) throw new ChatError('NOT_ALLOWED');

  db.rate = db.rate.filter((r) => r.at > ctx.now - RATE_KEEP_MS);

  // 每秒最多 3 則
  const recent = db.rate.filter((r) => r.uid === uid && r.kind === 'msg' && r.at > ctx.now - 1000);
  if (recent.length >= ctx.limits.msgPerSecond) {
    const oldest = Math.min(...recent.map((r) => r.at));
    throw new ChatError('RATE_LIMITED', retrySec(oldest + 1000, ctx.now));
  }
  // 照片每分鐘最多 3 張
  if (image) {
    const imgs = db.rate.filter((r) => r.uid === uid && r.kind === 'img' && r.at > ctx.now - ctx.limits.imageWindowMs);
    if (imgs.length >= ctx.limits.imagePerWindow) {
      const oldest = Math.min(...imgs.map((r) => r.at));
      throw new ChatError('IMAGE_RATE_LIMITED', retrySec(oldest + ctx.limits.imageWindowMs, ctx.now));
    }
  }
  // 相同內容 1 分鐘內最多 3 次
  const dup = trimmed ? dupKey(trimmed) : undefined;
  if (dup) {
    const same = db.rate.filter((r) => r.uid === uid && r.kind === 'msg' && r.dup === dup && r.at > ctx.now - ctx.limits.dupWindowMs);
    if (same.length >= ctx.limits.dupMax) {
      const oldest = Math.min(...same.map((r) => r.at));
      throw new ChatError('DUPLICATE_CONTENT', retrySec(oldest + ctx.limits.dupWindowMs, ctx.now));
    }
  }
  db.rate.push({ uid, kind: 'msg', dup, at: ctx.now });
  if (image) db.rate.push({ uid, kind: 'img', at: ctx.now });
  return trimmed;
}

export function sendPublic(db: Db, ctx: Ctx, uid: string, text: string, image?: ImageRef | null): void {
  const u = requireUser(db, uid);
  const body = checkContent(db, ctx, uid, text, image);
  const m: MsgRec = {
    id: ctx.newId('m'),
    scope: 'public',
    conversationId: null,
    senderId: uid,
    text: body || null,
    image: image ?? null,
    recalled: false,
    createdAt: ctx.now,
  };
  db.names[uid] = u.nickname;
  db.publicMessages.push(m);
  while (db.publicMessages.length > ctx.limits.publicKeep) {
    const old = db.publicMessages.shift();
    if (old) dropImage(ctx, old.image);
  }
  emit(db, 'message.received', { message: toMessage(db, m) }, '*');
}

export function sendPrivate(db: Db, ctx: Ctx, uid: string, conversationId: string, text: string, image?: ImageRef | null): void {
  requireUser(db, uid);
  const conv = db.conversations.find((c) => c.id === conversationId);
  if (!conv || (conv.a !== uid && conv.b !== uid)) throw new ChatError('CONVERSATION_ENDED');
  const body = checkContent(db, ctx, uid, text, image);
  const m: MsgRec = {
    id: ctx.newId('m'),
    scope: 'private',
    conversationId,
    senderId: uid,
    text: body || null,
    image: image ?? null,
    recalled: false,
    createdAt: ctx.now,
  };
  db.privateMessages.push(m);
  emit(db, 'message.received', { message: toMessage(db, m) }, [conv.a, conv.b]);
}

export function recall(db: Db, ctx: Ctx, uid: string, scope: 'public' | 'private', messageId: string): void {
  requireUser(db, uid);
  const list = scope === 'public' ? db.publicMessages : db.privateMessages;
  const m = list.find((x) => x.id === messageId);
  if (!m) throw new ChatError('NOT_ALLOWED');
  if (m.senderId !== uid) throw new ChatError('NOT_ALLOWED');
  if (m.recalled) return;
  dropImage(ctx, m.image);
  m.recalled = true;
  m.text = null;
  m.image = null;
  const payload = { scope, messageId, conversationId: m.conversationId };
  if (scope === 'public') {
    emit(db, 'message.recalled', payload, '*');
  } else {
    const conv = db.conversations.find((c) => c.id === m.conversationId);
    if (conv) emit(db, 'message.recalled', payload, [conv.a, conv.b]);
  }
}

// ── 邀請 ──

export function invite(db: Db, ctx: Ctx, uid: string, toId: string) {
  requireUser(db, uid);
  const to = db.users[toId];
  if (toId === uid) throw new ChatError('NOT_ALLOWED');
  if (!to || !isOnline(to, ctx.limits, ctx.now)) throw new ChatError('PEER_OFFLINE');
  if (convsOf(db, uid).some((c) => peerOf(c, uid) === toId)) throw new ChatError('ALREADY_CHATTING');
  const pending = db.invitations.some(
    (i) => i.status === 'pending' && ((i.from === uid && i.to === toId) || (i.from === toId && i.to === uid)),
  );
  if (pending) throw new ChatError('INVITE_PENDING');

  db.cooldowns = db.cooldowns.filter((c) => c.until > ctx.now);
  const cd = db.cooldowns.find((c) => c.from === uid && c.to === toId);
  if (cd) throw new ChatError('INVITE_COOLDOWN', retrySec(cd.until, ctx.now));

  db.rate = db.rate.filter((r) => r.at > ctx.now - RATE_KEEP_MS);
  const recent = db.rate.filter((r) => r.uid === uid && r.kind === 'inv' && r.target === toId && r.at > ctx.now - ctx.limits.inviteWindowMs);
  if (recent.length >= ctx.limits.invitePerTarget) {
    const oldest = Math.min(...recent.map((r) => r.at));
    throw new ChatError('INVITE_RATE_LIMITED', retrySec(oldest + ctx.limits.inviteWindowMs, ctx.now));
  }
  if (convsOf(db, uid).length >= ctx.limits.maxConversations) throw new ChatError('SELF_CHAT_FULL');
  if (convsOf(db, toId).length >= ctx.limits.maxConversations) throw new ChatError('PEER_CHAT_FULL');

  const inv: InvRec = {
    id: ctx.newId('i'),
    from: uid,
    to: toId,
    status: 'pending',
    createdAt: ctx.now,
    expiresAt: ctx.now + ctx.limits.inviteExpiryMs,
  };
  db.invitations.push(inv);
  db.rate.push({ uid, kind: 'inv', target: toId, at: ctx.now });
  const wire = toInvitation(db, inv);
  emit(db, 'invite.received', { invitation: wire }, [toId]);
  return wire;
}

export function respondInvite(db: Db, ctx: Ctx, uid: string, invitationId: string, accept: boolean) {
  requireUser(db, uid);
  const inv = db.invitations.find((i) => i.id === invitationId);
  if (!inv || inv.to !== uid || inv.status !== 'pending') throw new ChatError('NOT_ALLOWED');

  if (!accept) {
    inv.status = 'declined';
    db.cooldowns.push({ from: inv.from, to: inv.to, until: ctx.now + ctx.limits.declineCooldownMs });
    emit(db, 'invite.updated', { invitation: toInvitation(db, inv) }, [inv.from, inv.to]);
    return null;
  }

  if (!db.users[inv.from]) throw new ChatError('PEER_OFFLINE');
  if (convsOf(db, uid).length >= ctx.limits.maxConversations) throw new ChatError('SELF_CHAT_FULL');
  if (convsOf(db, inv.from).length >= ctx.limits.maxConversations) throw new ChatError('PEER_CHAT_FULL');

  inv.status = 'accepted';
  const conv: ConvRec = { id: ctx.newId('c'), a: inv.from, b: inv.to, startedAt: ctx.now };
  db.conversations.push(conv);
  emit(db, 'invite.updated', { invitation: toInvitation(db, inv) }, [inv.from, inv.to]);
  for (const who of [conv.a, conv.b]) {
    emit(db, 'conversation.started', { conversation: toConversation(db, conv, who, ctx.limits, ctx.now) }, [who]);
  }
  return toConversation(db, conv, uid, ctx.limits, ctx.now);
}

export function cancelInvite(db: Db, ctx: Ctx, uid: string, invitationId: string): void {
  requireUser(db, uid);
  const inv = db.invitations.find((i) => i.id === invitationId);
  if (!inv || inv.from !== uid || inv.status !== 'pending') throw new ChatError('NOT_ALLOWED');
  inv.status = 'cancelled';
  emit(db, 'invite.updated', { invitation: toInvitation(db, inv) }, [inv.from, inv.to]);
  void ctx;
}

export function endConversation(db: Db, ctx: Ctx, uid: string, conversationId: string): void {
  requireUser(db, uid);
  const conv = db.conversations.find((c) => c.id === conversationId);
  if (!conv || (conv.a !== uid && conv.b !== uid)) throw new ChatError('CONVERSATION_ENDED');
  closeConversation(db, ctx, conv, (who) => (who === uid ? 'endedByMe' : 'endedByPeer'));
}

// ── 進入時的完整資料 ──

export function snapshotFor(db: Db, ctx: Ctx, uid: string) {
  const users = Object.values(db.users)
    .filter((u) => isOnline(u, ctx.limits, ctx.now))
    .map(toUser);
  const history = db.publicMessages.slice(-ctx.limits.publicKeep).map((m) => toMessage(db, m));
  const conversations = convsOf(db, uid).map((c) => ({
    conversation: toConversation(db, c, uid, ctx.limits, ctx.now),
    messages: db.privateMessages.filter((m) => m.conversationId === c.id).map((m) => toMessage(db, m)),
  }));
  const pending = db.invitations.filter((i) => i.status === 'pending');
  return {
    users,
    history,
    conversations,
    invitationsIn: pending.filter((i) => i.to === uid).map((i) => toInvitation(db, i)),
    invitationsOut: pending.filter((i) => i.from === uid).map((i) => toInvitation(db, i)),
  };
}

// ── 定時巡邏(階段二是資料庫定時工作加 Edge Function) ──

function removeUser(db: Db, uid: string): void {
  cancelPendingOf(db, uid);
  delete db.users[uid];
}

export function janitor(db: Db, ctx: Ctx): void {
  const { limits, now } = ctx;

  for (const u of Object.values(db.users)) {
    if (u.isBot) continue;
    // 離線超過 15 秒:宣布離開
    if (u.online && now - u.lastSeen > limits.offlineAnnounceMs) {
      u.online = false;
      emit(db, 'presence.left', { user: toUser(u) }, '*');
      notifyPeers(db, u.userId, false);
    }
    if (u.online) continue;
    const offFor = now - u.lastSeen;
    const convs = convsOf(db, u.userId);
    if (convs.length > 0) {
      // 有私聊:離線超過 30 分鐘,私聊結束、代號釋放
      if (offFor > limits.privateOfflineMs) {
        for (const c of convs) closeConversation(db, ctx, c, (who) => (who === u.userId ? null : 'peerTimeout'));
        removeUser(db, u.userId);
      }
    } else if (offFor > limits.reserveMs) {
      removeUser(db, u.userId);
    }
  }

  // 邀請 10 分鐘沒回應:自動拒絕(逾時,不算被拒絕,沒有冷卻)
  for (const inv of db.invitations) {
    if (inv.status === 'pending' && now >= inv.expiresAt) {
      inv.status = 'expired';
      emit(db, 'invite.updated', { invitation: toInvitation(db, inv) }, [inv.from, inv.to]);
    }
  }
  db.invitations = db.invitations.filter((i) => i.status === 'pending' || now - i.createdAt < 5 * 60 * 1000).slice(-100);
  db.cooldowns = db.cooldowns.filter((c) => c.until > now);
}
