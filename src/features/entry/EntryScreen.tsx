import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { applyLang } from '../../i18n';
import { toChatError } from '../../protocol/errors';
import { LIMITS } from '../../protocol/limits';
import { LANGS, type Lang } from '../../protocol/types';
import { useChat } from '../../state/store';
import { charCount, cleanNickname } from '../../utils/nickname';
import { loadNickname } from '../../utils/prefs';
import { ThemeButton } from '../settings/TopBar';

export function EntryScreen() {
  const { t, i18n } = useTranslation();
  const enter = useChat((s) => s.enter);
  const noticeKey = useChat((s) => s.entryNoticeKey);
  const prefilled = loadNickname() ?? '';
  const [nickname, setNickname] = useState(prefilled);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const count = charCount(cleanNickname(nickname));
  const empty = count === 0;
  const lang = i18n.language as Lang;

  async function submit() {
    if (empty || busy) return;
    setBusy(true);
    setErrorKey(null);
    try {
      await enter(nickname, lang);
    } catch (e) {
      setErrorKey(`errors.${toChatError(e).code}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="entry-screen">
      <div className="entry-theme">
        <ThemeButton />
      </div>
      <form
        className="entry-card"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="entry-head">
          <span className="brand-mark big">
            <Icon name="chat" size={30} />
          </span>
          <h1>{t('app.name')}</h1>
          <p>{t('entry.tagline')}</p>
        </div>

        {noticeKey && (
          <p className="entry-notice" role="status">
            {t(noticeKey)}
          </p>
        )}

        <div className="field">
          <div className="field-top">
            <label htmlFor="nick">{t('entry.nicknameLabel')}</label>
            <span className={`counter ${count > LIMITS.nicknameMax ? 'over' : ''}`}>
              {count}/{LIMITS.nicknameMax}
            </span>
          </div>
          <input
            id="nick"
            type="text"
            className={`text-input ${errorKey ? 'error' : ''}`}
            value={nickname}
            autoComplete="off"
            autoFocus
            aria-invalid={!!errorKey}
            aria-describedby="nick-help"
            onChange={(e) => {
              setNickname(e.target.value);
              setErrorKey(null);
            }}
          />
          {errorKey ? (
            <span id="nick-help" className="field-error" role="alert">
              <Icon name="alert" size={15} />
              {t(errorKey)}
            </span>
          ) : (
            <span id="nick-help" className="field-help">
              {t(prefilled && nickname === prefilled ? 'entry.helperPrefilled' : 'entry.helper')}
            </span>
          )}
        </div>

        <div className="field">
          <span id="lang-label" className="field-label">
            {t('entry.langLabel')}
          </span>
          <div className="lang-grid" role="group" aria-labelledby="lang-label">
            {LANGS.map((l) => (
              <button
                key={l.code}
                type="button"
                className={`lang-opt ${lang === l.code ? 'on' : ''}`}
                aria-pressed={lang === l.code}
                onClick={() => applyLang(l.code)}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>

        <button type="submit" className="btn btn-primary btn-lg" disabled={empty || busy}>
          {t('entry.enter')}
          <Icon name="arrowRight" strokeWidth={2.2} />
        </button>
      </form>
    </div>
  );
}
