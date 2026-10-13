// 機器人使用者:階段一沒有真的別人,所以用機器人讓聊天室「有人」。
// 機器人是在模擬層裡,用和真人一模一樣的指令(core.ts)送訊息、回應邀請,規則對它們同樣有效。
import { type Ctx, type Db, isOnline } from './db';
import { enter, emit, invite, respondInvite, sendPrivate, sendPublic } from './core';
import { toUser } from './db';
import type { Lang } from '../../protocol/types';

interface BotDef {
  id: string;
  name: string;
  lang: Lang;
  /** 一開始就在線上 */
  alwaysOn: boolean;
  /** 會隨機進來、離開(用來測試進出提示) */
  toggles?: boolean;
  /** 收到邀請時的行為 */
  onInvite: 'accept' | 'decline' | 'ignore';
}

export const BOTS: BotDef[] = [
  { id: 'bot_xiaoming', name: '小明', lang: 'zh-TW', alwaysOn: true, onInvite: 'accept' },
  { id: 'bot_xiaomei', name: '小美', lang: 'zh-TW', alwaysOn: true, onInvite: 'accept' },
  { id: 'bot_aqiang', name: '阿強', lang: 'zh-TW', alwaysOn: true, onInvite: 'decline' },
  { id: 'bot_xiaohua', name: '小華', lang: 'zh-TW', alwaysOn: true, onInvite: 'ignore' },
  { id: 'bot_xiaoling', name: '小玲', lang: 'zh-TW', alwaysOn: true, onInvite: 'accept' },
  { id: 'bot_anna', name: 'Anna', lang: 'en', alwaysOn: true, onInvite: 'accept' },
  { id: 'bot_taro', name: '太郎', lang: 'ja', alwaysOn: true, onInvite: 'accept' },
  { id: 'bot_xiaojie', name: '小傑', lang: 'zh-TW', alwaysOn: true, toggles: true, onInvite: 'accept' },
  { id: 'bot_lea', name: 'Léa', lang: 'fr', alwaysOn: false, toggles: true, onInvite: 'accept' },
  { id: 'bot_minsu', name: '민수', lang: 'ko', alwaysOn: false, toggles: true, onInvite: 'accept' },
];

const CHATTER = [
  '大家好~今天有人在嗎?',
  '剛下課,好累喔',
  '有人看了昨天的比賽嗎?',
  'Anyone here like hiking?',
  'Good morning everyone!',
  'こんにちは!今日はいい天気ですね',
  '週末有什麼計畫嗎?',
  '我最近在學做甜點,有人有推薦的食譜嗎?',
  'Bonjour à tous !',
  '안녕하세요!',
  '哈哈哈這個太好笑了',
  '推薦一首歌給大家',
  '晚餐要吃什麼好煩惱',
  'I just found a great cafe nearby',
];

const REPLIES = [
  '哈哈對啊',
  '真的嗎?然後呢?',
  '我也這麼覺得',
  '有道理',
  '等一下,我去倒杯水',
  '好喔~',
  '你平常都做些什麼?',
  '今天天氣不錯',
];

const INVITE_DELAY_MS = 2500;
const DECLINE_DELAY_MS = 2000;
const REPLY_DELAY_MS = 1500;
const INVITE_HUMAN_AFTER_MS = 25_000;
const REINVITE_AFTER_MS = 10 * 60 * 1000;

function pick<T>(arr: T[], rand: () => number): T {
  return arr[Math.floor(rand() * arr.length) % arr.length];
}

function attempt(fn: () => void): void {
  try {
    fn();
  } catch {
    // 機器人被規則擋下(例如私聊已滿)就算了,不用處理
  }
}

export function ensureBots(db: Db, ctx: Ctx): void {
  for (const b of BOTS) {
    if (db.users[b.id]) continue;
    // 機器人的代號被真人占走時,換一個不會衝突的名字
    attempt(() => enter(db, ctx, b.id, b.name, b.lang, true));
    if (db.users[b.id] && !b.alwaysOn) {
      db.users[b.id].online = false;
    }
  }
}

function humansOnline(db: Db, ctx: Ctx) {
  return Object.values(db.users).filter((u) => !u.isBot && isOnline(u, ctx.limits, ctx.now));
}

export function tickBots(db: Db, ctx: Ctx, rand: () => number = Math.random): void {
  ensureBots(db, ctx);
  const { now } = ctx;
  const humans = humansOnline(db, ctx);
  const botIds = new Set(BOTS.map((b) => b.id));

  // 1. 回應收到的邀請
  for (const inv of db.invitations) {
    if (inv.status !== 'pending' || !botIds.has(inv.to)) continue;
    const def = BOTS.find((b) => b.id === inv.to);
    if (!def || def.onInvite === 'ignore') continue;
    const wait = def.onInvite === 'accept' ? INVITE_DELAY_MS : DECLINE_DELAY_MS;
    if (now - inv.createdAt < wait) continue;
    attempt(() => respondInvite(db, ctx, def.id, inv.id, def.onInvite === 'accept'));
  }

  // 2. 私聊回覆:機器人在私聊中,收到真人的最新訊息後過一下就回
  for (const conv of db.conversations) {
    const botId = botIds.has(conv.a) ? conv.a : botIds.has(conv.b) ? conv.b : null;
    if (!botId) continue;
    const msgs = db.privateMessages.filter((m) => m.conversationId === conv.id);
    const last = msgs[msgs.length - 1];
    if (!last || botIds.has(last.senderId) || last.recalled) continue;
    if (db.bot.replied.includes(last.id) || now - last.createdAt < REPLY_DELAY_MS) continue;
    db.bot.replied.push(last.id);
    db.bot.replied = db.bot.replied.slice(-100);
    const text = last.image ? '好漂亮!' : pick(REPLIES, rand);
    attempt(() => sendPrivate(db, ctx, botId, conv.id, text));
  }

  // 沒有真人在線時,機器人就安靜
  if (humans.length === 0) {
    db.bot.seenAt = {};
    return;
  }
  for (const h of humans) if (!db.bot.seenAt[h.userId]) db.bot.seenAt[h.userId] = now;
  for (const id of Object.keys(db.bot.seenAt)) if (!humans.some((h) => h.userId === id)) delete db.bot.seenAt[id];

  // 3. 公開聊天室偶爾說話
  if (now >= db.bot.nextChatAt) {
    db.bot.nextChatAt = now + 8000 + rand() * 12000;
    const talkers = BOTS.filter((b) => isOnline(db.users[b.id], ctx.limits, now));
    if (talkers.length > 0) {
      const b = pick(talkers, rand);
      attempt(() => sendPublic(db, ctx, b.id, pick(CHATTER, rand)));
    }
  }

  // 4. 偶爾有人進來、離開
  if (now >= db.bot.nextToggleAt) {
    db.bot.nextToggleAt = now + 20_000 + rand() * 20_000;
    const t = pick(BOTS.filter((b) => b.toggles), rand);
    const u = db.users[t.id];
    if (u) {
      u.online = !u.online;
      u.lastSeen = now;
      emit(db, u.online ? 'presence.joined' : 'presence.left', { user: toUser(u) }, '*');
    }
  }

  // 5. 小明會主動邀請真人一次,方便測試「收到邀請」
  const ming = BOTS[0];
  for (const h of humans) {
    const seen = db.bot.seenAt[h.userId] ?? now;
    const last = db.bot.invitedAt[h.userId];
    if (now - seen < INVITE_HUMAN_AFTER_MS) continue;
    if (last !== undefined && now - last < REINVITE_AFTER_MS) continue;
    db.bot.invitedAt[h.userId] = now;
    attempt(() => invite(db, ctx, ming.id, h.userId));
  }
}

/** 測試工具:立刻讓小明邀請某個真人(略過等待時間,但規則照常) */
export function botInviteNow(db: Db, ctx: Ctx, humanId: string): void {
  ensureBots(db, ctx);
  db.bot.invitedAt[humanId] = ctx.now;
  invite(db, ctx, BOTS[0].id, humanId);
}

/** 測試工具:立刻讓一個機器人在公開聊天室說話 */
export function botSayNow(db: Db, ctx: Ctx, rand: () => number = Math.random): void {
  ensureBots(db, ctx);
  const talkers = BOTS.filter((b) => isOnline(db.users[b.id], ctx.limits, ctx.now));
  if (talkers.length === 0) return;
  const b = pick(talkers, rand);
  sendPublic(db, ctx, b.id, pick(CHATTER, rand));
}
