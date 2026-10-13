import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { LANGS } from '../../protocol/types';
import { useChat } from '../../state/store';
import { useUi } from '../../state/ui';
import { useTheme } from '../../utils/theme';

export function ConnectionPill() {
  const { t } = useTranslation();
  const status = useChat((s) => s.connection);
  return (
    <span className={`conn-pill conn-${status}`} role="status">
      <span className="conn-dot" />
      {t(`conn.${status}`)}
    </span>
  );
}

export function ThemeButton() {
  const { t } = useTranslation();
  const { theme, toggle } = useTheme();
  return (
    <button type="button" className="icon-btn square" aria-label={t('top.theme')} onClick={toggle}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  );
}

/** 語言清單(進入後也能切換;系統訊息會跟著換,聊天內容不翻譯) */
export function LangList({ onPick }: { onPick?: () => void }) {
  const { i18n } = useTranslation();
  const setLang = useChat((s) => s.setLang);
  return (
    <div className="lang-list" role="group">
      {LANGS.map((l) => (
        <button
          key={l.code}
          type="button"
          className={`lang-opt ${i18n.language === l.code ? 'on' : ''}`}
          aria-pressed={i18n.language === l.code}
          onClick={() => {
            setLang(l.code);
            onPick?.();
          }}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return ref;
}

function LangPicker() {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const label = LANGS.find((l) => l.code === i18n.language)?.label ?? i18n.language;
  return (
    <div className="menu-anchor" ref={ref}>
      <button
        type="button"
        className="btn btn-outline lang-btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={t('top.language')}
        onClick={() => setOpen(!open)}
      >
        <Icon name="globe" />
        {label}
        <Icon name="chevronDown" size={16} />
      </button>
      {open && (
        <div className="dropdown">
          <LangList onPick={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

function LeaveButton() {
  const { t } = useTranslation();
  const setLeaveOpen = useUi((s) => s.setLeaveOpen);
  return (
    <button type="button" className="btn btn-danger-soft" onClick={() => setLeaveOpen(true)}>
      <Icon name="logout" />
      {t('top.leave')}
    </button>
  );
}

export function TopBar({ compact }: { compact: boolean }) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const setLeaveOpen = useUi((s) => s.setLeaveOpen);
  const { theme, toggle } = useTheme();
  const ref = useDismiss(menuOpen, () => setMenuOpen(false));

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">
          <Icon name="chat" size={compact ? 18 : 20} />
        </span>
        <span className="brand-name">{t('app.name')}</span>
      </div>
      <div className="topbar-right">
        <ConnectionPill />
        {compact ? (
          <div className="menu-anchor" ref={ref}>
            <button
              type="button"
              className="icon-btn square"
              aria-label={t('top.menu')}
              aria-haspopup="true"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <Icon name="dots" size={22} strokeWidth={3} />
            </button>
            {menuOpen && (
              <div className="dropdown dropdown-right">
                <LangList onPick={() => setMenuOpen(false)} />
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    toggle();
                    setMenuOpen(false);
                  }}
                >
                  <Icon name={theme === 'dark' ? 'sun' : 'moon'} /> {t('top.theme')}
                </button>
                <button
                  type="button"
                  className="menu-item danger"
                  onClick={() => {
                    setMenuOpen(false);
                    setLeaveOpen(true);
                  }}
                >
                  <Icon name="logout" /> {t('top.leave')}
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            <LangPicker />
            <ThemeButton />
            <LeaveButton />
          </>
        )}
      </div>
    </header>
  );
}
