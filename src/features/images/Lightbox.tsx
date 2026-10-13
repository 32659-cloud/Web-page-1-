import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { useUi } from '../../state/ui';
import { formatTime } from '../../utils/time';
import { useImageUrl } from './useImageUrl';

/** 照片放大:點背景、✕、Esc 都能關閉;載入大圖時先顯示縮圖;不做下載與左右切換。 */
export function Lightbox() {
  const { t, i18n } = useTranslation();
  const info = useUi((s) => s.lightbox);
  const close = useUi((s) => s.closeLightbox);
  const closeRef = useRef<HTMLButtonElement>(null);
  const fullUrl = useImageUrl(info?.image.fullPath ?? null);
  const thumbUrl = useImageUrl(info?.image.thumbPath ?? null);

  useEffect(() => {
    if (!info) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.(); // 關閉後焦點回到原本的縮圖
    };
  }, [info, close]);

  if (!info) return null;
  const shown = fullUrl ?? thumbUrl;
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={t('photo.preview')} onClick={close}>
      <button ref={closeRef} type="button" className="lightbox-close" aria-label={t('photo.close')} onClick={close}>
        <Icon name="x" size={22} strokeWidth={2.2} />
      </button>
      <div className="lightbox-stage" onClick={(e) => e.stopPropagation()}>
        {shown && <img src={shown} alt="" className={fullUrl ? '' : 'loading'} />}
        {!fullUrl && <span className="lightbox-loading">{t('photo.loadingFull')}</span>}
      </div>
      <span className="lightbox-caption" onClick={(e) => e.stopPropagation()}>
        {t('photo.caption', { name: info.who, time: formatTime(info.at, i18n.language) })}
      </span>
    </div>
  );
}
