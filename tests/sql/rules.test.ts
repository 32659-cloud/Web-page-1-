// 資料庫規則測試:用 PGlite(在記憶體裡執行的真 Postgres)載入 supabase/migrations/,
// 模擬多個匿名使用者呼叫資料庫函式,驗證 RLS 與每一條規則。不需要網路、不需要 Supabase 帳號。
// 和真實專案的差別:Supabase 專屬的部分(auth、storage、realtime)用最小的替身。
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url);
const read = (name: string) => readFileSync(new URL(name, MIGRATIONS), 'utf8');

const STUBS = `
create role anon nologin; create role authenticated nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema public, auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
create publication supabase_realtime;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
`;

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
interface Res {
  ok: boolean;
  rows: Row[];
  value?: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  code?: string;
  detail?: string;
}

describe('資料庫規則(PGlite)', () => {
  it('migrations 可重複執行,所有規則都符合', async () => {
    const db = new PGlite();
    await db.exec(STUBS);
    await db.exec(read('001_schema.sql'));
    await db.exec(read('001_schema.sql')); // 可以重複執行
    await db.exec(read('002_storage.sql'));
    await db.exec(read('002_storage.sql'));

    const failures: string[] = [];
    const t = (name: string, cond: unknown, extra?: unknown) => {
      if (!cond) failures.push(extra === undefined ? name : `${name} → ${String(extra)}`);
    };
    const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

    async function as(n: number) {
      await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${n ? U(n) : ''}', false); set role authenticated;`);
    }
    async function admin(sql: string) {
      await db.exec('reset role;');
      return db.query<Row>(sql);
    }
    async function call(n: number, sql: string, params: unknown[] = []): Promise<Res> {
      await as(n);
      try {
        const r = await db.query<Row>(sql, params);
        return { ok: true, rows: r.rows, value: r.rows[0] ? Object.values(r.rows[0])[0] : undefined };
      } catch (e) {
        const err = e as { message: string; detail?: string };
        return { ok: false, rows: [], code: err.message, detail: err.detail };
      }
    }
    const rpc = (n: number, fn: string, ...args: unknown[]) =>
      call(n, `select public.${fn}(${args.map((_, i) => '$' + (i + 1)).join(',')})`, args);
    const enter = (n: number, nick: string) => rpc(n, 'enter', nick, 'zh-TW');
    const wipeRate = () => admin('delete from public.rate_events');
    const count = async (sql: string) => (await admin(sql)).rows[0].c as number;
    async function resetAll() {
      await admin(
        'truncate public.profiles, public.public_messages, public.conversations, public.invitations, public.invite_cooldowns, public.rate_events cascade',
      );
    }
    const denied = (r: Res) => !r.ok && String(r.code).includes('permission denied');

    // ── 進入 ──
    await resetAll();
    t('空白代號', (await enter(1, '   ')).code === 'NICKNAME_INVALID');
    t('超過 20 字', (await enter(1, 'a'.repeat(21))).code === 'NICKNAME_INVALID');
    t('剛好 20 個 emoji', (await enter(1, '😀'.repeat(20))).ok);
    t('21 個 emoji 太長', (await enter(2, '😀'.repeat(21))).code === 'NICKNAME_INVALID');
    t('前後空白去掉', (await enter(2, '  小明  ')).value === '小明');
    t('同一人再進入同代號可以', (await enter(2, '小明')).ok);
    t('別人用同代號被擋', (await enter(3, '小明')).code === 'NICKNAME_TAKEN');
    t('全形與大小寫視為相同', (await enter(3, 'ＡＢＣ')).ok && (await enter(4, 'abc')).code === 'NICKNAME_TAKEN');
    t('零寬字元偽裝被擋', (await enter(4, '小​明')).code === 'NICKNAME_TAKEN');
    t('換代號可以', (await enter(2, '小明明')).value === '小明明');
    t('未登入不能進入', (await call(0, 'select public.enter($1,$2)', ['x', 'en'])).code === 'NOT_ENTERED');

    // ── 權限 ──
    t('不能直接讀 profiles', denied(await call(1, 'select * from public.profiles')));
    t('不能直接讀 rate_events', denied(await call(1, 'select * from public.rate_events')));
    t('不能直接寫公開訊息', denied(await call(1, "insert into public.public_messages(sender_id,sender_nick,body) values ($1,'x','hi')", [U(1)])));
    t('不能直接改訊息', denied(await call(1, "update public.public_messages set body='x'")));
    t('不能呼叫 cleanup', denied(await call(1, 'select public.cleanup()')));
    t('不能呼叫內部 _end_conv', denied(await call(1, "select public._end_conv(gen_random_uuid(), null, 'x')")));
    await db.exec('reset role; set role anon;');
    let anon = 'allowed';
    try {
      await db.query("select public.enter('x','en')");
    } catch (e) {
      anon = (e as Error).message;
    }
    t('anon 不能呼叫函式', anon.includes('permission denied'), anon);

    // ── 公開訊息 ──
    await resetAll();
    await enter(1, 'A'); await enter(2, 'B'); await enter(3, 'C');
    t('送出成功', (await rpc(1, 'send_public', 'hello')).ok);
    await wipeRate();
    t('501 字被擋', (await rpc(1, 'send_public', 'x'.repeat(501))).code === 'TEXT_TOO_LONG');
    t('500 字可以', (await rpc(1, 'send_public', 'y'.repeat(500))).ok);
    await wipeRate();
    t('全空白被擋', (await rpc(1, 'send_public', '   ')).code === 'NOT_ALLOWED');
    t('沒進入的人不能送', (await rpc(9, 'send_public', 'hi')).code === 'NOT_ENTERED');
    await wipeRate();
    for (let i = 0; i < 3; i++) await rpc(1, 'send_public', 'm' + i);
    const fast = await rpc(1, 'send_public', 'm3');
    t('每秒第 4 則被擋', fast.code === 'RATE_LIMITED' && Number(fast.detail) >= 1, JSON.stringify(fast));
    await wipeRate();
    const back = () => admin("update public.rate_events set at = at - interval '2 seconds'");
    await rpc(1, 'send_public', 'Hello World'); await back();
    await rpc(1, 'send_public', 'hello, world!'); await back();
    await rpc(1, 'send_public', ' HELLO  WORLD '); await back();
    const dup = await rpc(1, 'send_public', 'hello world');
    t('相同內容第 4 次被擋(忽略標點空白大小寫)', dup.code === 'DUPLICATE_CONTENT' && Number(dup.detail) >= 1, JSON.stringify(dup));
    t('只有標點的訊息不會被誤判成同一則', (await rpc(1, 'send_public', '？？？')).ok);
    await wipeRate();
    await admin('delete from public.public_messages');
    for (let i = 0; i < 105; i++) {
      await wipeRate();
      await rpc(1, 'send_public', 'msg ' + i);
    }
    t('只保留 100 則', (await count('select count(*)::int c from public.public_messages')) === 100);
    t('最舊的被刪掉', (await count("select count(*)::int c from public.public_messages where body = 'msg 0'")) === 0);
    t('所有登入者讀得到公開訊息', (await call(3, 'select count(*)::int c from public.public_messages')).rows[0].c === 100);

    // ── 照片 ──
    await wipeRate();
    const img = (uid: number, name: string) => ({
      thumbPath: `chat-public/${U(uid)}/${name}_thumb.webp`,
      fullPath: `chat-public/${U(uid)}/${name}.webp`,
      width: 800,
      height: 600,
    });
    t('自己的路徑可以', (await rpc(1, 'send_public', '', img(1, 'a'))).ok);
    t('別人的路徑被擋', (await rpc(1, 'send_public', '', img(2, 'b'))).code === 'IMAGE_TYPE');
    t('路徑含 .. 被擋', (await rpc(1, 'send_public', '', { ...img(1, 'c'), fullPath: `chat-public/${U(1)}/../x.webp` })).code === 'IMAGE_TYPE');
    t('尺寸不合理被擋', (await rpc(1, 'send_public', '', { ...img(1, 'd'), width: 0 })).code === 'NOT_ALLOWED');
    t('缺欄位被擋', (await rpc(1, 'send_public', '', { thumbPath: 'x' })).code === 'NOT_ALLOWED');
    await wipeRate();
    for (let i = 0; i < 3; i++) {
      await back();
      await rpc(1, 'send_public', 'p' + i, img(1, 'i' + i));
    }
    await back();
    const im4 = await rpc(1, 'send_public', 'p4', img(1, 'i4'));
    t('每分鐘第 4 張照片被擋', im4.code === 'IMAGE_RATE_LIMITED', JSON.stringify(im4));
    await wipeRate();

    // ── 收回 ──
    const sent = await rpc(1, 'send_public', '要收回的', img(1, 'rc'));
    const mid = sent.value as string;
    t('別人不能收回', (await rpc(2, 'recall', 'public', mid)).code === 'NOT_ALLOWED');
    const rec = await rpc(1, 'recall', 'public', mid);
    t('自己可以收回,回傳照片路徑', rec.ok && String(rec.value?.fullPath).endsWith('rc.webp'), JSON.stringify(rec));
    const row = (await admin(`select body, image, recalled from public.public_messages where id = '${mid}'`)).rows[0];
    t('內容真的清掉', row.recalled === true && row.body === null && row.image === null);
    t('不存在的訊息', (await rpc(1, 'recall', 'public', U(999))).code === 'NOT_ALLOWED');

    // ── 邀請 ──
    await resetAll();
    await enter(1, 'A'); await enter(2, 'B'); await enter(3, 'C');
    t('不能邀請自己', (await rpc(1, 'invite', U(1))).code === 'NOT_ALLOWED');
    t('邀請不存在的人', (await rpc(1, 'invite', U(77))).code === 'PEER_OFFLINE');
    const inv1 = await rpc(1, 'invite', U(2));
    t('邀請成功', inv1.ok && inv1.value.status === 'pending' && inv1.value.to_nick === 'B');
    const secs = (Date.parse(inv1.value.expires_at) - Date.parse(inv1.value.created_at)) / 1000;
    t('邀請 60 秒後逾時', Math.round(secs) === 60, secs);
    t('重複邀請被擋', (await rpc(1, 'invite', U(2))).code === 'INVITE_PENDING');
    t('對方反過來邀請也被擋', (await rpc(2, 'invite', U(1))).code === 'INVITE_PENDING');
    t('邀請者看得到邀請', (await call(1, 'select count(*)::int c from public.invitations')).rows[0].c === 1);
    t('被邀請者看得到邀請', (await call(2, 'select count(*)::int c from public.invitations')).rows[0].c === 1);
    t('第三者看不到邀請', (await call(3, 'select count(*)::int c from public.invitations')).rows[0].c === 0);
    t('邀請者不能代替對方回應', (await rpc(1, 'respond_invite', inv1.value.id, true)).code === 'NOT_ALLOWED');
    t('第三者不能取消', (await rpc(3, 'cancel_invite', inv1.value.id)).code === 'NOT_ALLOWED');
    t('邀請者可以取消', (await rpc(1, 'cancel_invite', inv1.value.id)).ok);
    await wipeRate();
    const inv2 = await rpc(1, 'invite', U(2));
    t('拒絕回傳 null', (await rpc(2, 'respond_invite', inv2.value.id, false)).value === null);
    const cd = await rpc(1, 'invite', U(2));
    t('冷卻中不能再邀請', cd.code === 'INVITE_COOLDOWN' && Number(cd.detail) > 1700 && Number(cd.detail) <= 1800, JSON.stringify(cd));
    t('冷卻只針對這一個人', (await rpc(1, 'invite', U(3))).ok);
    t('B 反過來邀請 A 不受冷卻影響', (await rpc(2, 'invite', U(1))).ok);
    await resetAll(); await enter(1, 'A'); await enter(2, 'B');
    const a1 = await rpc(1, 'invite', U(2)); await rpc(1, 'cancel_invite', a1.value.id);
    const a2 = await rpc(1, 'invite', U(2)); await rpc(1, 'cancel_invite', a2.value.id);
    t('1 分鐘第 3 次邀請被擋', (await rpc(1, 'invite', U(2))).code === 'INVITE_RATE_LIMITED');
    await wipeRate();
    const a4 = await rpc(1, 'invite', U(2));
    await admin(`update public.invitations set expires_at = now() - interval '1 second' where id = '${a4.value.id}'`);
    const late = await rpc(2, 'respond_invite', a4.value.id, true);
    t('逾時後接受沒有效果', late.ok && late.value === null);
    t('逾時標記成 expired', (await admin(`select status from public.invitations where id = '${a4.value.id}'`)).rows[0].status === 'expired');
    t('逾時不算冷卻,可以馬上再邀請', (await rpc(1, 'invite', U(2))).ok);
    await resetAll(); await enter(1, 'A'); await enter(2, 'B');
    await admin(`update public.profiles set last_seen = now() - interval '1 minute' where user_id = '${U(2)}'`);
    t('對方離線不能邀請', (await rpc(1, 'invite', U(2))).code === 'PEER_OFFLINE');

    // ── 私聊 ──
    await resetAll(); await enter(1, 'A'); await enter(2, 'B'); await enter(3, 'C');
    const i = await rpc(1, 'invite', U(2));
    const conv = (await rpc(2, 'respond_invite', i.value.id, true)).value as Row;
    t('接受後建立私聊', conv && conv.status === 'active' && conv.nick_a === 'A' && conv.nick_b === 'B');
    t('已有私聊不能再邀請', (await rpc(1, 'invite', U(2))).code === 'ALREADY_CHATTING');
    t('參與者看得到私聊', (await call(1, 'select count(*)::int c from public.conversations')).rows[0].c === 1);
    t('第三者看不到私聊', (await call(3, 'select count(*)::int c from public.conversations')).rows[0].c === 0);
    t('A 送私聊', (await rpc(1, 'send_private', conv.id, '你好')).ok);
    await wipeRate();
    const pimg = { thumbPath: `chat-private/${conv.id}/${U(2)}/t.webp`, fullPath: `chat-private/${conv.id}/${U(2)}/f.webp`, width: 10, height: 10 };
    const pm = await rpc(2, 'send_private', conv.id, '', pimg);
    t('B 送私聊照片(自己的私聊路徑)', pm.ok, JSON.stringify(pm));
    t('私聊照片放在公開路徑被擋', (await rpc(2, 'send_private', conv.id, '', img(2, 'z'))).code === 'IMAGE_TYPE');
    t('私聊照片放在別人的資料夾被擋', (await rpc(2, 'send_private', conv.id, '', { ...pimg, thumbPath: `chat-private/${conv.id}/${U(1)}/t.webp` })).code === 'IMAGE_TYPE');
    await wipeRate();
    t('參與者讀得到私聊訊息', (await call(2, 'select count(*)::int c from public.private_messages')).rows[0].c === 2);
    t('第三者讀不到私聊訊息', (await call(3, 'select count(*)::int c from public.private_messages')).rows[0].c === 0);
    t('第三者不能送進別人的私聊', (await rpc(3, 'send_private', conv.id, 'hi')).code === 'CONVERSATION_ENDED');
    t('第三者不能收回別人的私聊訊息', (await rpc(3, 'recall', 'private', pm.value)).code === 'NOT_ALLOWED');
    t('A 不能收回 B 的私聊訊息', (await rpc(1, 'recall', 'private', pm.value)).code === 'NOT_ALLOWED');
    t('B 可以收回自己的', (await rpc(2, 'recall', 'private', pm.value)).ok);
    t('第三者不能結束別人的私聊', (await rpc(3, 'end_conversation', conv.id)).code === 'CONVERSATION_ENDED');
    t('A 結束私聊', (await rpc(1, 'end_conversation', conv.id)).ok);
    const ended = (await admin(`select status, ended_by, end_reason from public.conversations where id = '${conv.id}'`)).rows[0];
    t('標記為已結束,記錄誰結束', ended.status === 'ended' && ended.ended_by === U(1) && ended.end_reason === 'ended', JSON.stringify(ended));
    t('訊息刪光', (await count('select count(*)::int c from public.private_messages')) === 0);
    t('結束後不能再送', (await rpc(2, 'send_private', conv.id, 'x')).code === 'CONVERSATION_ENDED');
    t('結束後可以重新邀請', (await rpc(1, 'invite', U(2))).ok);

    // 5 個上限
    await resetAll();
    for (let n = 1; n <= 8; n++) await enter(n, 'U' + n);
    for (let n = 2; n <= 6; n++) {
      await wipeRate();
      const v = await rpc(1, 'invite', U(n));
      await rpc(n, 'respond_invite', v.value.id, true);
    }
    await wipeRate();
    t('自己滿 5 個不能再邀請', (await rpc(1, 'invite', U(7))).code === 'SELF_CHAT_FULL');
    t('對方滿 5 個不能邀請', (await rpc(7, 'invite', U(1))).code === 'PEER_CHAT_FULL');
    await wipeRate();
    const v1 = await rpc(7, 'invite', U(8));
    await admin(`insert into public.conversations(user_a,user_b,nick_a,nick_b) select '${U(8)}', gen_random_uuid(), 'U8','x' from generate_series(1,5)`);
    t('接受時自己已滿被擋', (await rpc(8, 'respond_invite', v1.value.id, true)).code === 'SELF_CHAT_FULL');

    // ── 離開 ──
    await resetAll(); await enter(1, 'A'); await enter(2, 'B'); await enter(3, 'C');
    const l1 = await rpc(1, 'invite', U(2));
    const lc = (await rpc(2, 'respond_invite', l1.value.id, true)).value as Row;
    await wipeRate();
    await rpc(1, 'send_private', lc.id, 'hi');
    const l2 = await rpc(1, 'invite', U(3));
    t('離開', (await rpc(1, 'leave')).ok);
    const lr = (await admin(`select status, ended_by, end_reason from public.conversations where id = '${lc.id}'`)).rows[0];
    t('私聊以「離開」結束', lr.status === 'ended' && lr.end_reason === 'left' && lr.ended_by === U(1));
    t('私聊訊息刪光', (await count('select count(*)::int c from public.private_messages')) === 0);
    t('等待中的邀請取消', (await admin(`select status from public.invitations where id = '${l2.value.id}'`)).rows[0].status === 'cancelled');
    t('代號釋放', (await enter(4, 'A')).ok);
    t('心跳回報已不認得', (await rpc(1, 'heartbeat')).value === false);
    t('在線的人心跳回 true', (await rpc(2, 'heartbeat')).value === true);

    // ── 定時巡邏 ──
    await resetAll();
    for (let n = 1; n <= 5; n++) await enter(n, 'P' + n);
    const c1 = await rpc(1, 'invite', U(2));
    const cc = (await rpc(2, 'respond_invite', c1.value.id, true)).value as Row;
    const pend = await rpc(3, 'invite', U(4));
    await admin(`update public.profiles set last_seen = now() - interval '3 minutes' where user_id in ('${U(3)}', '${U(5)}')`);
    await admin('select public.cleanup()');
    const left = (await admin('select nickname from public.profiles order by nickname')).rows.map((r) => r.nickname as string);
    t('沒私聊、離線超過 2 分鐘的被釋放', !left.includes('P3') && !left.includes('P5'), left.join());
    t('有私聊的人還在', left.includes('P1') && left.includes('P2') && left.includes('P4'));
    t('離開者發出的邀請取消', (await admin(`select status from public.invitations where id = '${pend.value.id}'`)).rows[0].status === 'cancelled');
    await admin(`update public.profiles set last_seen = now() - interval '3 minutes' where user_id = '${U(1)}'`);
    await admin('select public.cleanup()');
    t('有私聊離線 3 分鐘還保留', (await count(`select count(*)::int c from public.profiles where user_id = '${U(1)}'`)) === 1);
    await admin(`update public.profiles set last_seen = now() - interval '31 minutes' where user_id = '${U(1)}'`);
    await admin('select public.cleanup()');
    const to = (await admin(`select status, ended_by, end_reason from public.conversations where id = '${cc.id}'`)).rows[0];
    t('離線超過 30 分鐘:私聊以 timeout 結束', to.status === 'ended' && to.end_reason === 'timeout' && to.ended_by === null, JSON.stringify(to));
    t('離線超過 30 分鐘:代號釋放', (await count(`select count(*)::int c from public.profiles where user_id = '${U(1)}'`)) === 0);
    await resetAll(); await enter(1, 'A'); await enter(2, 'B');
    const ex = await rpc(1, 'invite', U(2));
    await admin(`update public.invitations set expires_at = now() - interval '1 second' where id = '${ex.value.id}'`);
    await admin('select public.cleanup()');
    t('巡邏把逾時邀請標成 expired', (await admin(`select status from public.invitations where id = '${ex.value.id}'`)).rows[0].status === 'expired');
    await admin(`update public.conversations set status='ended', ended_at = now() - interval '11 minutes'`);
    await admin(`update public.invitations set created_at = now() - interval '6 minutes'`);
    await admin(`insert into public.rate_events(user_id, kind, at) values ('${U(1)}','msg', now() - interval '6 minutes')`);
    await admin('select public.cleanup()');
    t('舊紀錄被清掉', (await count('select (select count(*) from public.invitations)::int + (select count(*) from public.rate_events)::int c')) <= 1);

    expect(failures).toEqual([]);
  }, 180_000);
});
