import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from './components/ConfirmDialog';
import { Icon, type IconName } from './components/Icon';
import { Toasts } from './components/Toasts';
import { ChatPane } from './features/chat/ChatPane';
import { ConversationList } from './features/conversations/ConversationList';
import { EntryScreen } from './features/entry/EntryScreen';
import { Lightbox } from './features/images/Lightbox';
import { InviteCards } from './features/invitations/InviteCards';
import { OnlineList } from './features/online/OnlineList';
import { DevTools } from './features/settings/DevTools';
import { TopBar } from './features/settings/TopBar';
import { type MobileTab, useChat } from './state/store';
import { useUi } from './state/ui';

/** 寬度到 900px 以上用電腦版三欄,以下用手機版(底部三個分頁) */
function useIsDesktop(): boolean {
  const query = '(min-width: 900px)';
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return match;
}

function DesktopLayout() {
  return (
    <div className="app desktop">
      <TopBar compact={false} />
      <div className="columns">
        <OnlineList sheet={false} />
        <ChatPane mobile={false} />
        <ConversationList showPublic />
      </div>
    </div>
  );
}

const TABS: { id: MobileTab; icon: IconName; label: string }[] = [
  { id: 'public', icon: 'hash', label: 'tabs.public' },
  { id: 'private', icon: 'chat', label: 'tabs.private' },
  { id: 'online', icon: 'users', label: 'tabs.online' },
];

function MobileLayout() {
  const { t } = useTranslation();
  const tab = useChat((s) => s.mobileTab);
  const view = useChat((s) => s.view);
  const convs = useChat((s) => s.convs);
  const setTab = useChat((s) => s.setMobileTab);
  const selectView = useChat((s) => s.selectView);
  const unread = Object.values(convs).reduce((n, c) => n + c.unread, 0);

  // 私聊視窗:整個畫面,沒有底部分頁,左上「←」返回
  if (view.kind === 'private' && convs[view.id]) {
    return (
      <div className="app mobile">
        <ChatPane mobile />
      </div>
    );
  }

  return (
    <div className="app mobile">
      <TopBar compact />
      <div className="mobile-body">
        {tab === 'public' && <ChatPane mobile />}
        {tab === 'private' && <ConversationList showPublic={false} />}
        {tab === 'online' && <OnlineList sheet />}
      </div>
      <nav className="tabbar" aria-label="tabs">
        {TABS.map((x) => (
          <button
            key={x.id}
            type="button"
            className={`tab ${tab === x.id ? 'on' : ''}`}
            aria-current={tab === x.id ? 'page' : undefined}
            onClick={() => {
              setTab(x.id);
              if (x.id === 'public') selectView({ kind: 'public' });
            }}
          >
            <span className="tab-icon">
              <Icon name={x.icon} size={22} />
              {x.id === 'private' && unread > 0 && <span className="badge tab-badge">{unread}</span>}
            </span>
            <span>{t(x.label)}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

export function App() {
  const { t, i18n } = useTranslation();
  const phase = useChat((s) => s.phase);
  const invitations = useChat((s) => s.invitationsIn.length);
  const leave = useChat((s) => s.leave);
  const leaveOpen = useUi((s) => s.leaveOpen);
  const setLeaveOpen = useUi((s) => s.setLeaveOpen);
  const desktop = useIsDesktop();

  // 在別的分頁時,瀏覽器分頁標題提示有新邀請
  useEffect(() => {
    const update = () => {
      document.title =
        invitations > 0 && document.hidden ? t('title.newInvite', { count: invitations }) : t('app.name');
    };
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, [invitations, t, i18n.language]);

  return (
    <>
      {phase === 'entry' ? <EntryScreen /> : desktop ? <DesktopLayout /> : <MobileLayout />}
      {phase === 'chat' && <InviteCards />}
      {leaveOpen && (
        <ConfirmDialog
          icon="logout"
          title={t('leaveDlg.title')}
          body={t('leaveDlg.body')}
          confirmLabel={t('leaveDlg.confirm')}
          onCancel={() => setLeaveOpen(false)}
          onConfirm={() => {
            setLeaveOpen(false);
            void leave();
          }}
        />
      )}
      <Lightbox />
      <Toasts />
      <DevTools />
    </>
  );
}
