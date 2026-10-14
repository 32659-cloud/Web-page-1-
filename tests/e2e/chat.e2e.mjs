// 端對端測試:用 3 個瀏覽器(3 個人)連真實的 Supabase,走過整個聊天室。
// 執行前:先在另一個終端機執行 `npm run dev`,並確認 .env.local 的 VITE_BACKEND=supabase。
// 執行:`npm run test:e2e`(網址預設 http://localhost:5173/,可用 BASE_URL 改)。
// 注意:會在真實專案留下幾則測試訊息(公開聊天室)。
import { chromium } from 'playwright';
import { makeChecker, makePng, requireEnv } from './helpers.mjs';

requireEnv();
const URL = process.env.BASE_URL ?? 'http://localhost:5173/';
const { ok, done } = makeChecker();
const rnd = Math.random().toString(36).slice(2, 6);
const NA = 'Al' + rnd, NB = 'Bo' + rnd, NC = 'Ca' + rnd;
const T = 15000;
const png = { name: 'test.png', mimeType: 'image/png', buffer: makePng() };

const browser = await chromium.launch();
async function person(nick) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  return { ctx, page, nick, errors };
}
async function enter(p) {
  await p.page.fill('input', p.nick);
  await p.page.click('button.btn-lg');
  await p.page.waitForSelector('.composer', { timeout: T });
}
const convRow = (p, nick) =>
  p.page
    .locator('.conv-panel .conv-row')
    .filter({ has: p.page.locator('strong', { hasText: new RegExp('^' + nick + '$') }) })
    .first();
const say = async (p, text) => {
  await p.page.fill('.composer textarea', text);
  await p.page.keyboard.press('Enter');
};
const sees = async (p, text, scope = 'body', t = T) =>
  p.page.locator(scope).getByText(text, { exact: false }).first().waitFor({ timeout: t }).then(() => true, () => false);
const gone = (p, text, ms = 10000) =>
  p.page.waitForFunction((x) => !document.querySelector('.msg-scroll').innerText.includes(x), text, { timeout: ms }).then(() => true, () => false);
const thumbLoaded = (p) =>
  p.page.waitForFunction(() => [...document.querySelectorAll('.thumb img')].some((i) => i.naturalWidth > 0), null, { timeout: T }).then(() => true, () => false);

const A = await person(NA), B = await person(NB), C = await person(NC);
await enter(A);
await enter(B);

console.log('進入');
ok('A 看到 B 在線上', await sees(A, NB, '.online-panel'));
ok('B 看到 A 在線上', await sees(B, NA, '.online-panel'));
await enter(C);
ok('A 看到 C 進來', await sees(A, NC, '.online-panel'));
ok('A 的畫面有「C 進來了」提示', await sees(A, NC, '.msg-scroll'));
{
  const D = await person('x');
  await D.page.fill('input', NA.toUpperCase());
  await D.page.click('button.btn-lg');
  ok('相同代號(大小寫不同)被擋', await D.page.locator('.field-error').waitFor({ timeout: 8000 }).then(() => true, () => false));
  await D.ctx.close();
}

console.log('公開聊天與收回');
const hello = 'hello-' + rnd;
await say(A, hello);
ok('B 收到 A 的訊息', await sees(B, hello, '.msg-scroll'));
ok('C 收到 A 的訊息', await sees(C, hello, '.msg-scroll'));
const rec = 'recall-' + rnd;
await say(A, rec);
await sees(A, rec, '.msg-scroll');
await sees(B, rec, '.msg-scroll');
const row = A.page.locator('.msg-row.own', { hasText: rec });
await row.hover();
await row.getByRole('button', { name: '收回' }).click();
await A.page.locator('.dialog').getByRole('button', { name: '收回' }).click();
ok('B 的畫面上原文消失(被收回)', await gone(B, rec));
ok('C 的畫面上原文消失', await gone(C, rec));
ok('A 自己的畫面上原文消失', await gone(A, rec));

console.log('邀請與私聊');
await A.page.locator('.online-panel').getByText(NB, { exact: true }).click();
await A.page.getByRole('button', { name: '邀請私聊' }).click();
ok('B 收到邀請卡片', await sees(B, NA, '.invite-card'));
const countdown = await B.page.locator('.invite-countdown').first().innerText().catch(() => '');
ok('卡片有倒數', /\d:\d\d/.test(countdown), countdown);
ok('A 的對話清單有「等待回應」列', (await A.page.locator('.conv-row.pending').count()) > 0);
await B.page.locator('.invite-card').getByRole('button', { name: '接受' }).click();
ok('B 進入私聊', await sees(B, NA, '.conv-panel'));
ok('A 的私聊開始', await sees(A, NB, '.conv-panel .conv-row:not(.pending)'));
await convRow(A, NB).click();
const secret = 'secret-' + rnd;
await say(A, secret);
await convRow(B, NA).click();
ok('B 收到私聊訊息', await sees(B, secret, '.msg-scroll'));
await C.page.waitForTimeout(500);
ok('C 完全看不到私聊內容', !(await C.page.locator('body').innerText()).includes(secret));
ok('C 的私聊清單是空的', (await C.page.locator('.conv-panel .conv-row').count()) <= 1);

console.log('照片');
await convRow(A, NB).click();
await A.page.setInputFiles('input[type=file]', png);
await A.page.waitForSelector('.photo-preview img', { timeout: T });
await A.page.click('.send-btn');
ok('A 看到自己傳的私聊照片', await thumbLoaded(A));
ok('B 看到私聊照片(簽名網址)', await thumbLoaded(B));
await B.page.locator('.thumb').first().click();
ok(
  'B 點開大圖',
  await B.page
    .waitForFunction(() => {
      const i = document.querySelector('.lightbox-stage img');
      return i && i.naturalWidth > 0;
    }, null, { timeout: T })
    .then(() => true, () => false),
);
await B.page.keyboard.press('Escape');
await A.page.locator('.conv-panel .conv-row').first().click(); // 公開聊天室
await A.page.setInputFiles('input[type=file]', png);
await A.page.waitForSelector('.photo-preview img', { timeout: T });
await A.page.click('.send-btn');
ok('C 看到公開照片', await thumbLoaded(C));

console.log('結束私聊');
await convRow(B, NA).click();
await B.page.getByRole('button', { name: '結束私聊' }).first().click();
await B.page.locator('.dialog').getByRole('button', { name: '結束私聊' }).click();
await convRow(A, NB).click();
ok('A 看到私聊已結束、輸入框停用', await A.page.locator('.input-disabled-text').waitFor({ timeout: 10000 }).then(() => true, () => false));

console.log('重新整理');
await C.page.reload();
await C.page.waitForSelector('input');
ok('重新整理後代號已預先填好', (await C.page.inputValue('input')) === NC);
await C.page.click('button.btn-lg');
await C.page.waitForSelector('.composer', { timeout: T });
ok('重新整理後看到歷史訊息', await sees(C, hello, '.msg-scroll'));

console.log('離開');
await A.page.getByRole('button', { name: '離開' }).first().click();
await A.page.locator('.dialog').getByRole('button', { name: '確定離開' }).click();
ok('A 回到進入畫面', await A.page.locator('input').waitFor({ timeout: T }).then(() => true, () => false));
ok(
  'B 的線上名單很快看不到 A',
  await B.page
    .waitForFunction((n) => !document.querySelector('.online-panel').innerText.includes(n), NA, { timeout: 8000 })
    .then(() => true, () => false),
);

console.log('突然關掉分頁');
await C.page.close();
const t1 = Date.now();
ok(
  'B 的線上名單裡 C 消失(60 秒內)',
  await B.page
    .waitForFunction((n) => !document.querySelector('.online-panel').innerText.includes(n), NC, { timeout: 60000 })
    .then(() => true, () => false),
  `${Date.now() - t1}ms`,
);

for (const p of [A, B, C]) if (p.errors.length) console.log('  頁面錯誤', p.nick, p.errors.slice(0, 3));
await B.page.getByRole('button', { name: '離開' }).first().click().catch(() => {});
await B.page.locator('.dialog').getByRole('button', { name: '確定離開' }).click().catch(() => {});
await browser.close();
done();
