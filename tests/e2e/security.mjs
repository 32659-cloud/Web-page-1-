// 安全測試:用 3 個匿名使用者直接對真實的 Supabase 發請求(繞過我們的網頁),
// 驗證第三個人讀不到別人的私聊、照片、邀請,也不能偽造身分或繞過限制。(docs/architecture.md 13.2)
// 執行:`npm run test:security`(會讀 .env.local)。會在真實專案留下幾則測試訊息。
import { createClient } from '@supabase/supabase-js';
import { makeChecker, requireEnv } from './helpers.mjs';

const { url: URL, key: KEY } = requireEnv();
const { ok, done } = makeChecker();
const rnd = Math.random().toString(36).slice(2, 6);

async function user(nick) {
  const c = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await c.auth.signInAnonymously();
  if (error) throw error;
  const r = await c.rpc('enter', { p_nickname: nick, p_lang: 'en' });
  if (r.error) throw r.error;
  return { c, id: data.user.id };
}
const code = (r) => r.error?.message;

const U1 = await user('S1' + rnd), U2 = await user('S2' + rnd), U3 = await user('S3' + rnd);

const inv = await U1.c.rpc('invite', { p_to: U2.id });
const conv = (await U2.c.rpc('respond_invite', { p_invitation: inv.data.id, p_accept: true })).data;
ok('私聊建立', conv?.status === 'active');

// 第三者的即時監聽:不應該收到任何私聊事件
const seen = { u2: 0, u3: 0 };
const ch2 = U2.c.channel('t2').on('postgres_changes', { event: '*', schema: 'public', table: 'private_messages' }, () => seen.u2++);
const ch3 = U3.c.channel('t3').on('postgres_changes', { event: '*', schema: 'public', table: 'private_messages' }, () => seen.u3++);
await Promise.all([
  new Promise((r) => ch2.subscribe((s) => s === 'SUBSCRIBED' && r())),
  new Promise((r) => ch3.subscribe((s) => s === 'SUBSCRIBED' && r())),
]);

// 訂閱剛成功時,伺服器端還需要一點時間才會開始推送
await new Promise((r) => setTimeout(r, 2000));
const sent = await U1.c.rpc('send_private', { p_conversation: conv.id, p_text: 'top-secret-' + rnd });
ok('U1 送私聊', !sent.error, JSON.stringify(sent.error));

// 私聊照片
const webp = new Blob([new Uint8Array([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80])], { type: 'image/webp' });
const path = `${conv.id}/${U1.id}/a.webp`;
ok('U1 上傳私聊照片', !(await U1.c.storage.from('chat-private').upload(path, webp, { contentType: 'image/webp' })).error);
ok('U2 可以取得簽名網址', !(await U2.c.storage.from('chat-private').createSignedUrl(path, 60)).error);
const s3 = await U3.c.storage.from('chat-private').createSignedUrl(path, 60);
ok('U3 取不到簽名網址', !!s3.error || !s3.data?.signedUrl);
ok('U3 用公開網址讀私聊桶被拒', (await fetch(U3.c.storage.from('chat-private').getPublicUrl(path).data.publicUrl)).status >= 400);
ok('U3 下載被拒', !!(await U3.c.storage.from('chat-private').download(path)).error);
ok('U3 不能上傳到別人的私聊', !!(await U3.c.storage.from('chat-private').upload(`${conv.id}/${U3.id}/x.webp`, webp, { contentType: 'image/webp' })).error);
ok('U3 不能冒用別人的資料夾', !!(await U3.c.storage.from('chat-private').upload(`${conv.id}/${U1.id}/y.webp`, webp, { contentType: 'image/webp' })).error);
ok('U3 不能刪別人的照片', ((await U3.c.storage.from('chat-private').remove([path])).data ?? []).length === 0);

// 資料表
ok('U3 讀不到私聊訊息', ((await U3.c.from('private_messages').select('*')).data ?? []).length === 0);
ok('U3 讀不到私聊', ((await U3.c.from('conversations').select('*')).data ?? []).length === 0);
ok('U3 讀不到邀請', ((await U3.c.from('invitations').select('*')).data ?? []).length === 0);
ok('U2 讀得到私聊訊息', ((await U2.c.from('private_messages').select('*')).data ?? []).length === 1);
ok('不能直接讀 profiles', !!(await U3.c.from('profiles').select('*')).error);
ok('不能直接讀 rate_events', !!(await U3.c.from('rate_events').select('*')).error);
ok('不能直接寫公開訊息', !!(await U3.c.from('public_messages').insert({ sender_id: U1.id, sender_nick: 'fake', body: 'x' })).error);
ok('不能直接改別人的私聊訊息', !!(await U3.c.from('private_messages').update({ body: 'pwned' }).eq('conversation_id', conv.id)).error);
ok('不能直接刪私聊', !!(await U3.c.from('conversations').delete().eq('id', conv.id)).error);

// 函式
ok('U3 不能送進別人的私聊', code(await U3.c.rpc('send_private', { p_conversation: conv.id, p_text: 'hi' })) === 'CONVERSATION_ENDED');
ok('U3 不能結束別人的私聊', code(await U3.c.rpc('end_conversation', { p_conversation: conv.id })) === 'CONVERSATION_ENDED');
const pmid = (await U2.c.from('private_messages').select('id').limit(1)).data[0].id;
ok('U3 不能收回別人的私聊訊息', code(await U3.c.rpc('recall', { p_scope: 'private', p_message: pmid })) === 'NOT_ALLOWED');
ok('U2 不能收回 U1 的私聊訊息', code(await U2.c.rpc('recall', { p_scope: 'private', p_message: pmid })) === 'NOT_ALLOWED');
const pubm = (await U1.c.rpc('send_public', { p_text: 'pub-' + rnd })).data;
ok('U3 不能收回別人的公開訊息', code(await U3.c.rpc('recall', { p_scope: 'public', p_message: pubm })) === 'NOT_ALLOWED');
ok('U3 不能呼叫 cleanup', !!(await U3.c.rpc('cleanup')).error);
ok('U3 不能呼叫內部函式 _end_conv', !!(await U3.c.rpc('_end_conv', { p_conv: conv.id, p_by: null, p_reason: 'x' })).error);
ok('沒有登入的人不能送訊息', !!(await createClient(URL, KEY, { auth: { persistSession: false } }).rpc('send_public', { p_text: 'x' })).error);

// 偽造照片路徑、超限
const foreign = { thumbPath: `chat-public/${U1.id}/a.webp`, fullPath: `chat-public/${U1.id}/a.webp`, width: 5, height: 5 };
ok('不能引用別人的照片路徑', code(await U3.c.rpc('send_public', { p_text: '', p_image: foreign })) === 'IMAGE_TYPE');
ok('501 字被擋', code(await U3.c.rpc('send_public', { p_text: 'x'.repeat(501) })) === 'TEXT_TOO_LONG');
const burst = [];
for (let i = 0; i < 6; i++) burst.push(code(await U3.c.rpc('send_public', { p_text: 'b' + i + rnd })));
ok('超過每秒 3 則被擋', burst.includes('RATE_LIMITED'), burst.join());
ok('非圖片檔被擋', !!(await U1.c.storage.from('chat-public').upload(`${U1.id}/t.txt`, new Blob(['hello'], { type: 'text/plain' }), { contentType: 'text/plain' })).error);
const big = new Blob([new Uint8Array(3 * 1024 * 1024)], { type: 'image/webp' });
ok('超過 2MB 被擋', !!(await U1.c.storage.from('chat-public').upload(`${U1.id}/big.webp`, big, { contentType: 'image/webp' })).error);
ok('不能上傳到別人的公開資料夾', !!(await U3.c.storage.from('chat-public').upload(`${U1.id}/z.webp`, webp, { contentType: 'image/webp' })).error);
ok('自己的資料夾可以', !(await U1.c.storage.from('chat-public').upload(`${U1.id}/ok.webp`, webp, { contentType: 'image/webp' })).error);
await U1.c.storage.from('chat-public').remove([`${U1.id}/ok.webp`]);
await U1.c.storage.from('chat-private').remove([path]);

await new Promise((r) => setTimeout(r, 4000));
ok('U2(參與者)即時收到私聊事件', seen.u2 >= 1, JSON.stringify(seen));
ok('U3(第三者)沒有收到任何私聊即時事件', seen.u3 === 0, JSON.stringify(seen));

for (const u of [U1, U2, U3]) await u.c.rpc('leave');
done();
