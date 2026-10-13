import { useTranslation } from 'react-i18next';
import { useChat } from '../state/store';
import { Icon } from './Icon';

/** 短暫浮現的提示條(送出失敗、被限速、邀請結果……) */
export function Toasts() {
  const { t } = useTranslation();
  const toasts = useChat((s) => s.toasts);
  const dismiss = useChat((s) => s.dismissToast);
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((x) => (
        <div key={x.id} className={`toast toast-${x.tone}`}>
          {x.tone === 'error' && <Icon name="alert" size={16} />}
          <span className="toast-text">{t(x.key, x.params)}</span>
          <button type="button" className="icon-btn small" aria-label={t('common.close')} onClick={() => dismiss(x.id)}>
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
