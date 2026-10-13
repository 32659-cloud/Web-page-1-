import { useTranslation } from 'react-i18next';
import { Avatar } from '../../components/Avatar';
import { Icon } from '../../components/Icon';
import { LIMITS } from '../../protocol/limits';
import { type ConvState, useChat } from '../../state/store';
import { formatTime } from '../../utils/time';

function previewOf(c: ConvState, t: (k: string) => string): string {
  if (c.ended) return t('convs.ended');
  const last = [...c.items].reverse().find((i) => i.kind === 'message');
  if (!last || last.kind !== 'message') return c.conversation.peerOnline ? '' : t('convs.peerOffline');
  const m = last.message;
  if (m.recalled) return t('convs.recalled');
  if (m.text) return m.text;
  if (m.image) return t('convs.photo');
  return '';
}

/** 右欄(電腦版)/「私聊」分頁(手機版):公開聊天室加所有私聊,有未讀就顯示數字 */
export function ConversationList({ showPublic }: { showPublic: boolean }) {
  const { t, i18n } = useTranslation();
  const convs = useChat((s) => s.convs);
  const view = useChat((s) => s.view);
  const out = useChat((s) => s.invitationsOut);
  const selectView = useChat((s) => s.selectView);
  const cancelInvite = useChat((s) => s.cancelInvite);
  const publicItems = useChat((s) => s.publicItems);

  const list = Object.values(convs).sort((a, b) => b.lastAt - a.lastAt);
  const lastPublic = [...publicItems].reverse().find((i) => i.kind === 'message');
  const publicPreview =
    lastPublic && lastPublic.kind === 'message'
      ? lastPublic.message.recalled
        ? t('convs.recalled')
        : `${lastPublic.message.sender.nickname}: ${lastPublic.message.text ?? t('convs.photo')}`
      : '';

  return (
    <section className="panel conv-panel" aria-label={t('convs.title')}>
      <header className="panel-head">
        <h2>{showPublic ? t('convs.title') : t('convs.private')}</h2>
        <span className="muted-small">{t('convs.quota', { n: list.length, max: LIMITS.maxConversations })}</span>
      </header>
      <ul className="conv-list">
        {showPublic && (
          <li>
            <button
              type="button"
              className={`conv-row ${view.kind === 'public' ? 'selected' : ''}`}
              onClick={() => selectView({ kind: 'public' })}
            >
              <span className="pub-icon">
                <Icon name="hash" size={19} />
              </span>
              <span className="conv-main">
                <strong>{t('convs.public')}</strong>
                <span className="conv-preview">{publicPreview}</span>
              </span>
            </button>
          </li>
        )}
        {list.map((c) => {
          const selected = view.kind === 'private' && view.id === c.conversation.id;
          const last = [...c.items].reverse().find((i) => i.kind === 'message');
          return (
            <li key={c.conversation.id}>
              <button
                type="button"
                className={`conv-row ${selected ? 'selected' : ''}`}
                onClick={() => selectView({ kind: 'private', id: c.conversation.id })}
              >
                <Avatar name={c.conversation.peer.nickname} size={38} />
                <span className="conv-main">
                  <strong>{c.conversation.peer.nickname}</strong>
                  <span className="conv-preview">{previewOf(c, t)}</span>
                </span>
                <span className="conv-side">
                  {last && last.kind === 'message' && (
                    <time className="muted-small">{formatTime(last.message.createdAt, i18n.language)}</time>
                  )}
                  {c.unread > 0 && (
                    <span className="badge" aria-label={`${c.unread}`}>
                      {c.unread}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
        {out.map((inv) => (
          <li key={inv.id}>
            <div className="conv-row pending">
              <Avatar name={inv.to.nickname} size={38} />
              <span className="conv-main">
                <strong>{inv.to.nickname}</strong>
                <span className="conv-preview">{t('convs.pending')}</span>
              </span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void cancelInvite(inv)}>
                {t('convs.cancelInvite')}
              </button>
            </div>
          </li>
        ))}
        {list.length === 0 && out.length === 0 && !showPublic && (
          <li className="empty-state">
            <strong>{t('convs.empty')}</strong>
            <span>{t('convs.emptyHint')}</span>
          </li>
        )}
      </ul>
    </section>
  );
}
