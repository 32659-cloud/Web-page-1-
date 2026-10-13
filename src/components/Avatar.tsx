import { avatarIndex, avatarInitial } from '../utils/avatarColor';

/** 代號第一個字放在圓裡,底色由代號算出(同一個代號永遠同一個顏色) */
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const i = avatarIndex(name);
  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.42),
        background: `var(--av${i}-bg)`,
        color: `var(--av${i}-fg)`,
      }}
    >
      {avatarInitial(name)}
    </span>
  );
}
