import { LIMITS } from '../protocol/limits';
import type { ErrorCode } from '../protocol/errors';

// 看不見的控制字元與零寬字元:有人會用它們偽裝成別人的代號
const INVISIBLE = /[\p{Cc}\p{Cf}​-‏‪-‮⁠-⁤﻿]/gu;

/** 字數(以「字元」計,emoji 算 1 個) */
export function charCount(text: string): number {
  return Array.from(text).length;
}

/** 整理代號:全形轉一般字、去掉看不見的字元、去掉前後空白、連續空白變一個 */
export function cleanNickname(raw: string): string {
  return raw.normalize('NFKC').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
}

/** 比對用的 key:不分大小寫 */
export function nicknameKey(clean: string): string {
  return clean.toLocaleLowerCase();
}

export type NicknameCheck =
  | { ok: true; value: string; key: string }
  | { ok: false; code: ErrorCode };

export function checkNickname(raw: string): NicknameCheck {
  const value = cleanNickname(raw);
  const n = charCount(value);
  if (n < LIMITS.nicknameMin || n > LIMITS.nicknameMax) return { ok: false, code: 'NICKNAME_INVALID' };
  return { ok: true, value, key: nicknameKey(value) };
}

/** 判斷「重複內容」用:忽略空白、大小寫、標點 */
export function dupKey(text: string): string {
  const base = text.normalize('NFKC').toLocaleLowerCase();
  const stripped = base.replace(/[\s\p{P}]/gu, '');
  return stripped || base.trim();
}
