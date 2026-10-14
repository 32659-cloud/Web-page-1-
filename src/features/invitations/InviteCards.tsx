import { useTranslation } from 'react-i18next';
import { Avatar } from '../../components/Avatar';
import { useChat } from '../../state/store';
import { InviteCountdown } from './InviteCountdown';

/** 收到邀請的卡片:不遮住整個畫面、不搶輸入框焦點;多個邀請時一次顯示一張。 */
export function InviteCards() {
  const { t } = useTranslation();
  const list = useChat((s) => s.invitationsIn);
  const respond = useChat((s) => s.respond);
  const first = list[0];
  if (!first) return null;
  return (
    <div className="invite-card" role="alert">
      <div className="invite-who">
        <Avatar name={first.from.nickname} size={44} />
        <div>
          <strong>{t('invite.from', { name: first.from.nickname })}</strong>
          <InviteCountdown expiresAt={first.expiresAt} />
          {list.length > 1 && <span className="muted-small">{t('invite.more', { count: list.length - 1 })}</span>}
        </div>
      </div>
      <div className="invite-actions">
        <button type="button" className="btn btn-ghost" onClick={() => void respond(first, false)}>
          {t('invite.decline')}
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void respond(first, true)}>
          {t('invite.accept')}
        </button>
      </div>
    </div>
  );
}
