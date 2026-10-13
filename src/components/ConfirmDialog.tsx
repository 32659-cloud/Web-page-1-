import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, type IconName } from './Icon';

interface Props {
  title: string;
  body: string;
  confirmLabel: string;
  icon?: IconName;
  onConfirm: () => void;
  onCancel: () => void;
}

/** 確認視窗(離開、收回、結束私聊)。按 Esc 或點背景 = 取消;關閉後焦點回到原本的按鈕。 */
export function ConfirmDialog({ title, body, confirmLabel, icon = 'alert', onConfirm, onCancel }: Props) {
  const { t } = useTranslation();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [onCancel]);

  return (
    <div className="scrim" onClick={onCancel}>
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dlg-title"
        aria-describedby="dlg-body"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="dialog-icon">
          <Icon name={icon} size={22} />
        </span>
        <h2 id="dlg-title">{title}</h2>
        <p id="dlg-body">{body}</p>
        <div className="dialog-actions">
          <button type="button" ref={cancelRef} className="btn btn-ghost" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
