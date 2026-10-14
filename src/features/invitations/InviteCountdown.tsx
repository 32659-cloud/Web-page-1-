import { useTranslation } from 'react-i18next';
import { formatDuration } from '../../state/store';
import { secondsLeft } from '../../utils/countdown';
import { useNow } from '../../utils/useNow';

/** 邀請剩餘時間。只有這個小元件每秒重畫。剩 10 秒內改用警示色(數字還在,不只靠顏色)。 */
export function InviteCountdown({ expiresAt, bare }: { expiresAt: string; bare?: boolean }) {
  const { t } = useTranslation();
  const now = useNow(1000, true);
  const left = secondsLeft(expiresAt, now);
  const time = formatDuration(left);
  return (
    <span className={`invite-countdown ${left <= 10 ? 'urgent' : ''}`}>
      {bare ? time : t('invite.timeLeft', { time })}
    </span>
  );
}
