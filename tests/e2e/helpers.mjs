// 端對端測試的共用小工具。
import { deflateSync } from 'node:zlib';

/** 產生一張小的 PNG(不需要準備圖檔) */
export function makePng(w = 600, h = 400) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * (w * 3 + 1) + 1 + x * 3;
      raw[i] = x % 256;
      raw[i + 1] = y % 256;
      raw[i + 2] = 180;
    }
  }
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  const crc = (buf) => {
    let r = -1;
    for (const b of buf) r = table[(r ^ b) & 255] ^ (r >>> 8);
    return (r ^ -1) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0);
  head.writeUInt32BE(h, 4);
  head[8] = 8;
  head[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', head),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 檢查設定:需要 .env.local 的 Supabase 網址與 Publishable key */
export function requireEnv() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    console.error('缺少 VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY。請用 npm run test:e2e 或 npm run test:security 執行(會讀 .env.local)。');
    process.exit(2);
  }
  return { url, key };
}

export function makeChecker() {
  let pass = 0;
  let fail = 0;
  return {
    ok(name, cond, extra = '') {
      if (cond) pass++;
      else {
        fail++;
        console.log('  FAIL', name, extra);
      }
    },
    done() {
      console.log(`\n通過 ${pass},失敗 ${fail}`);
      process.exit(fail ? 1 : 0);
    },
  };
}
