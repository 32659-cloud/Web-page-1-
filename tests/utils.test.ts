import { describe, expect, it } from 'vitest';
import { getLimits, LIMITS } from '../src/protocol/limits';
import { avatarIndex } from '../src/utils/avatarColor';
import { charCount, checkNickname, cleanNickname, dupKey } from '../src/utils/nickname';

describe('代號整理', () => {
  it('去掉看不見的字元與多餘空白,全形轉一般字', () => {
    expect(cleanNickname('  小​明   同學 ')).toBe('小明 同學');
    expect(cleanNickname('ＡＢＣ')).toBe('ABC');
  });

  it('emoji 算 1 個字', () => {
    expect(charCount('😀😀')).toBe(2);
    expect(checkNickname('😀'.repeat(20)).ok).toBe(true);
    expect(checkNickname('😀'.repeat(21)).ok).toBe(false);
  });

  it('重複內容的比對忽略空白、大小寫、標點', () => {
    expect(dupKey('Hello, World!')).toBe(dupKey(' hello world'));
    expect(dupKey('😀')).toBe('😀');
  });
});

describe('頭像顏色', () => {
  it('同一個代號永遠同一個顏色,且落在 0 到 5', () => {
    for (const n of ['小明', 'Anna', '太郎', '민수', '😀']) {
      expect(avatarIndex(n)).toBe(avatarIndex(n));
      expect(avatarIndex(n)).toBeGreaterThanOrEqual(0);
      expect(avatarIndex(n)).toBeLessThan(6);
    }
  });
});

describe('規則常數', () => {
  it('網址加 ?fast=1 會把長時間規則縮短', () => {
    expect(getLimits('').inviteExpiryMs).toBe(LIMITS.inviteExpiryMs);
    expect(getLimits('?fast=1').inviteExpiryMs).toBeLessThan(LIMITS.inviteExpiryMs);
  });
});
