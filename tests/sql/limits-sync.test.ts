// 規則常數對照:資料庫函式裡寫死的數字,必須和 src/protocol/limits.ts 一致(docs/architecture.md 5.4)。
// 改了其中一邊、忘了另一邊,這個測試會失敗。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LIMITS } from '../../src/protocol/limits';

const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url);
const sql = readFileSync(new URL('001_schema.sql', MIGRATIONS), 'utf8');
const storage = readFileSync(new URL('002_storage.sql', MIGRATIONS), 'utf8');

function num(re: RegExp, text = sql, group = 1): number {
  const m = re.exec(text);
  if (!m) throw new Error(`在 SQL 裡找不到:${re}`);
  return Number(m[group]);
}
const SEC = 1000;
const MIN = 60 * SEC;

describe('資料庫的數字和 limits.ts 一致', () => {
  it('字數與數量', () => {
    expect(num(/char_length\(v_text\) > (\d+)/)).toBe(LIMITS.textMax);
    expect(num(/char_length\(v_nick\) < (\d+)/)).toBe(LIMITS.nicknameMin);
    expect(num(/char_length\(v_nick\) > (\d+)/)).toBe(LIMITS.nicknameMax);
    expect(num(/order by created_at desc, id offset (\d+)/)).toBe(LIMITS.publicKeep);
    expect(num(/_conv_count\(v_uid\) >= (\d+)/)).toBe(LIMITS.maxConversations);
    expect(num(/_conv_count\(p_to\) >= (\d+)/)).toBe(LIMITS.maxConversations);
  });

  it('防洗版', () => {
    expect(num(/kind = 'msg' and at > now\(\) - interval '1 second'[\s\S]*?v_n >= (\d+)/)).toBe(LIMITS.msgPerSecond);
    expect(num(/kind = 'img' and at > now\(\) - interval '(\d+) minute'/) * MIN).toBe(LIMITS.imageWindowMs);
    expect(num(/kind = 'img'[\s\S]*?v_n >= (\d+)/)).toBe(LIMITS.imagePerWindow);
    expect(num(/r\.dup = v_dup and r\.at > now\(\) - interval '(\d+) minute'/) * MIN).toBe(LIMITS.dupWindowMs);
    expect(num(/r\.dup = v_dup[\s\S]*?v_n >= (\d+)/)).toBe(LIMITS.dupMax);
    expect(num(/r\.kind = 'inv'[\s\S]*?interval '(\d+) minute'/) * MIN).toBe(LIMITS.inviteWindowMs);
    expect(num(/r\.kind = 'inv'[\s\S]*?v_n >= (\d+)/)).toBe(LIMITS.invitePerTarget);
  });

  it('邀請與私聊的時間', () => {
    expect(num(/now\(\) \+ interval '(\d+) seconds'/) * SEC).toBe(LIMITS.inviteExpiryMs);
    expect(num(/now\(\) \+ interval '(\d+) minutes'/) * MIN).toBe(LIMITS.declineCooldownMs);
  });

  it('離線保留時間(巡邏)', () => {
    const cleanup = sql.slice(sql.indexOf('create or replace function public.cleanup()'));
    expect(num(/last_seen < now\(\) - interval '(\d+) minutes'/, cleanup) * MIN).toBe(LIMITS.privateOfflineMs);
    const second = /last_seen < now\(\) - interval '(\d+) minutes'[\s\S]*?last_seen < now\(\) - interval '(\d+) minutes'/.exec(cleanup);
    expect(Number(second?.[2]) * MIN).toBe(LIMITS.reserveMs);
  });

  it('照片大小', () => {
    expect(num(/file_size_limit[\s\S]*?true,\s+(\d+)/, storage)).toBe(LIMITS.imageMaxBytes);
  });
});
