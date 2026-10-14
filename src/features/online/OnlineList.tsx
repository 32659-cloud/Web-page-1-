import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import type { User } from '../../protocol/types';
import { formatDuration, useChat } from '../../state/store';
import { useNow } from '../../utils/useNow';

/** 點一個人之後的選單:邀請私聊 / 前往私聊 / 冷卻中 / 等待回應(電腦是小浮窗,手機是底部面板) */
function UserMenu({ user, sheet, onClose }: { user: User; sheet: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const convs = useChat((s) => s.convs);
  const out = useChat((s) => s.invitationsOut);
  const cooldowns = useChat((s) => s.cooldowns);
  const invite = useChat((s) => s.invite);
  const selectView = useChat((s) => s.selectView);
  const setMobileTab = useChat((s) => s.setMobileTab);
  const now = useNow(1000, true);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const onDown = (e: MouseEvent) => {
      if (!sheet && ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose, sheet]);

  const conv = Object.values(convs).find((c) => c.conversation.peer.userId === user.userId && !c.ended);
  const pending = out.some((i) => i.to.userId === user.userId);
  const until = cooldowns[user.userId] ?? 0;
  const cooling = until > now;

  let action: JSX.Element;
  if (conv) {
    action = (
      <button
        type="button"
        className="btn btn-primary menu-action"
        onClick={() => {
          selectView({ kind: 'private', id: conv.conversation.id });
          setMobileTab('private');
          onClose();
        }}
      >
        <Icon name="chat" /> {t('online.goChat')}
      </button>
    );
  } else if (pending) {
    action = (
      <button type="button" className="btn btn-ghost menu-action" disabled>
        {t('convs.pending')}
      </button>
    );
  } else if (cooling) {
    action = (
      <button type="button" className="btn btn-ghost menu-action" disabled>
        <Icon name="chat" /> {t('online.invite')}
        <small>{t('online.cooldown', { time: formatDuration((until - now) / 1000) })}</small>
      </button>
    );
  } else {
    action = (
      <button
        type="button"
        className="btn btn-primary menu-action"
        onClick={() => {
          void invite(user);
          onClose();
        }}
      >
        <Icon name="chat" /> {t('online.invite')}
      </button>
    );
  }

  const body = (
    <div
      ref={ref}
      className={sheet ? 'sheet' : 'popover'}
      role="menu"
      aria-label={t('online.pickAction', { name: user.nickname })}
      onClick={(e) => e.stopPropagation()}
    >
      {sheet && <span className="sheet-grip" />}
      <div className="menu-head">
        {sheet && <Avatar name={user.nickname} size={44} />}
        <span>{user.nickname}</span>
      </div>
      {action}
      {sheet && (
        <button type="button" className="btn btn-ghost menu-action" onClick={onClose}>
          {t('common.cancel')}
        </button>
      )}
    </div>
  );
  return sheet ? (
    <div className="scrim sheet-scrim" onClick={onClose}>
      {body}
    </div>
  ) : (
    body
  );
}

export function OnlineList({ sheet }: { sheet: boolean }) {
  const { t } = useTranslation();
  const users = useChat((s) => s.users);
  const me = useChat((s) => s.me);
  const convs = useChat((s) => s.convs);
  const cooldowns = useChat((s) => s.cooldowns);
  const [openId, setOpenId] = useState<string | null>(null);
  const now = useNow(1000, Object.keys(cooldowns).length > 0);

  const sorted = [...users].sort((a, b) => {
    if (a.userId === me?.userId) return -1;
    if (b.userId === me?.userId) return 1;
    return 0;
  });

  return (
    <section className="panel online-panel" aria-label={t('online.title')}>
      <header className="panel-head">
        <h2>{t('online.title')}</h2>
        <span className="count-pill">{t('online.count', { count: users.length })}</span>
      </header>
      <ul className="user-list">
        {sorted.map((u) => {
          const isMe = u.userId === me?.userId;
          const chatting = Object.values(convs).some((c) => c.conversation.peer.userId === u.userId && !c.ended);
          const cooling = (cooldowns[u.userId] ?? 0) > now;
          return (
            <li key={u.userId} className="user-item">
              <button
                type="button"
                className="user-row"
                disabled={isMe}
                aria-haspopup={isMe ? undefined : 'menu'}
                aria-expanded={openId === u.userId}
                onClick={() => setOpenId(openId === u.userId ? null : u.userId)}
              >
                <Avatar name={u.nickname} size={36} />
                <span className="user-name">{u.nickname}</span>
                {isMe && <span className="tag-muted">{t('online.you')}</span>}
                {chatting && <span className="tag tag-lav">{t('online.chatting')}</span>}
                {cooling && !chatting && <span className="tag tag-pink">{t('online.cooling')}</span>}
              </button>
              {openId === u.userId && !isMe && <UserMenu user={u} sheet={sheet} onClose={() => setOpenId(null)} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
