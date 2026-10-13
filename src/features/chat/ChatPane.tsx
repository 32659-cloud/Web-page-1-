import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../../components/Avatar';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Icon } from '../../components/Icon';
import { useChat } from '../../state/store';
import { Composer } from './Composer';
import { MessageList } from './MessageList';

/** 中欄 / 手機的對話畫面:公開聊天室或某一個私聊 */
export function ChatPane({ mobile }: { mobile: boolean }) {
  const { t } = useTranslation();
  const view = useChat((s) => s.view);
  const me = useChat((s) => s.me);
  const users = useChat((s) => s.users);
  const publicItems = useChat((s) => s.publicItems);
  const convs = useChat((s) => s.convs);
  const selectView = useChat((s) => s.selectView);
  const setMobileTab = useChat((s) => s.setMobileTab);
  const endConversation = useChat((s) => s.endConversation);
  const closeConversation = useChat((s) => s.closeConversation);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const meId = me?.userId ?? '';

  if (view.kind === 'private' && convs[view.id]) {
    const c = convs[view.id];
    const peer = c.conversation.peer;
    const goBack = () => {
      selectView({ kind: 'public' });
      setMobileTab('private');
    };
    return (
      <main className="chat-pane" key={c.conversation.id}>
        <header className="pane-head">
          {mobile && (
            <button type="button" className="icon-btn" aria-label={t('chat.back')} onClick={goBack}>
              <Icon name="arrowLeft" size={22} strokeWidth={2.2} />
            </button>
          )}
          <Avatar name={peer.nickname} size={mobile ? 38 : 40} />
          <div className="pane-title">
            <h1>{peer.nickname}</h1>
            <span className={`peer-status ${c.conversation.peerOnline && !c.ended ? 'on' : ''}`}>
              <i />
              {c.ended
                ? t('convs.ended')
                : c.conversation.peerOnline
                  ? t('chat.peerOnline')
                  : mobile
                    ? t('convs.peerOffline')
                    : t('chat.peerOfflineLong')}
            </span>
          </div>
          {!c.ended && (
            <button type="button" className="btn btn-danger-soft" onClick={() => setConfirmEnd(true)}>
              {!mobile && <Icon name="x" size={16} />}
              {t('chat.endPrivate')}
            </button>
          )}
        </header>

        <MessageList scope="private" items={c.items} meId={meId} />

        {c.ended && (
          <div className="ended-notice" role="status">
            <span>{t(`ended.${c.ended.reason}`, { name: peer.nickname })}</span>
          </div>
        )}

        <Composer
          scope="private"
          conversationId={c.conversation.id}
          ended={!!c.ended}
          onCloseWindow={() => closeConversation(c.conversation.id)}
        />

        {confirmEnd && (
          <ConfirmDialog
            icon="x"
            title={t('endDlg.title', { name: peer.nickname })}
            body={t('endDlg.body')}
            confirmLabel={t('endDlg.confirm')}
            onCancel={() => setConfirmEnd(false)}
            onConfirm={() => {
              setConfirmEnd(false);
              void endConversation(c.conversation.id);
            }}
          />
        )}
      </main>
    );
  }

  return (
    <main className="chat-pane" key="public">
      <header className="pane-head">
        <span className="pub-icon big">
          <Icon name="hash" size={20} />
        </span>
        <div className="pane-title">
          <h1>{t('convs.public')}</h1>
          <span className="pane-sub">{t('chat.publicSub', { count: users.length })}</span>
        </div>
      </header>
      <MessageList scope="public" items={publicItems} meId={meId} />
      <Composer scope="public" />
    </main>
  );
}
