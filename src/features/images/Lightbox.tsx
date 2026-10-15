import { useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { useUi } from '../../state/ui';
import { formatTime } from '../../utils/time';
import { useImageUrl } from './useImageUrl';

const MAX_SCALE = 6;

/** 照片放大:點背景、✕、Esc 都能關閉;載入大圖時先顯示縮圖;不做下載與左右切換。
 *  縮放自己處理(不用瀏覽器的整頁縮放,iPhone 上整頁縮放會卡在左上角):兩指捏合、單指拖曳、連點兩下放大或還原、電腦滾輪。 */
export function Lightbox() {
  const { t, i18n } = useTranslation();
  const info = useUi((s) => s.lightbox);
  const close = useUi((s) => s.closeLightbox);
  const closeRef = useRef<HTMLButtonElement>(null);
  const fullUrl = useImageUrl(info?.image.fullPath ?? null);
  const thumbUrl = useImageUrl(info?.image.thumbPath ?? null);
  const imgRef = useRef<HTMLImageElement>(null);
  const view = useRef({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; scale: number; cx: number; cy: number; x: number; y: number } | null>(null);
  const lastTap = useRef(0);

  const apply = () => {
    const img = imgRef.current;
    if (!img) return;
    const v = view.current;
    const w = img.offsetWidth;
    const h = img.offsetHeight;
    if (v.scale <= 1) {
      v.x = 0;
      v.y = 0;
    } else {
      // 照片的邊緣最多拉到畫面中央,不會整張跑出去
      v.x = Math.max(-(w * v.scale) / 2, Math.min((w * v.scale) / 2, v.x));
      v.y = Math.max(-(h * v.scale) / 2, Math.min((h * v.scale) / 2, v.y));
    }
    img.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.scale})`;
  };
  const reset = () => {
    view.current = { scale: 1, x: 0, y: 0 };
    pointers.current.clear();
    gesture.current = null;
    apply();
  };
  const zoomAt = (scale: number, px: number, py: number) => {
    const img = imgRef.current;
    if (!img) return;
    const r = img.getBoundingClientRect();
    const v = view.current;
    const next = Math.max(1, Math.min(MAX_SCALE, scale));
    const k = next / v.scale;
    // 讓手指(或滑鼠)底下那一點留在原位
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    v.x += (px - cx) * (1 - k);
    v.y += (py - cy) * (1 - k);
    v.scale = next;
    apply();
  };
  const startGesture = () => {
    const pts = [...pointers.current.values()];
    const v = view.current;
    if (pts.length >= 2) {
      const [a, b] = pts;
      gesture.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale: v.scale, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, x: v.x, y: v.y };
    } else if (pts.length === 1) {
      gesture.current = { dist: 0, scale: v.scale, cx: pts[0].x, cy: pts[0].y, x: v.x, y: v.y };
    } else gesture.current = null;
  };
  const onPointerDown = (e: ReactPointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      const now = Date.now();
      if (now - lastTap.current < 300) {
        zoomAt(view.current.scale > 1 ? 1 : 2.5, e.clientX, e.clientY);
        lastTap.current = 0;
      } else lastTap.current = now;
    }
    startGesture();
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const pts = [...pointers.current.values()];
    const v = view.current;
    if (!g) return;
    if (pts.length >= 2 && g.dist > 0) {
      const [a, b] = pts;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      v.scale = Math.max(1, Math.min(MAX_SCALE, (g.scale * Math.hypot(a.x - b.x, a.y - b.y)) / g.dist));
      // 縮放中心跟著兩指中點;兩指移動就一起拖曳
      const k = v.scale / g.scale;
      const img = imgRef.current;
      const r = img?.getBoundingClientRect();
      const baseCx = r ? r.left + r.width / 2 - v.x : 0;
      const baseCy = r ? r.top + r.height / 2 - v.y : 0;
      v.x = mx - baseCx - (g.cx - baseCx - g.x) * k;
      v.y = my - baseCy - (g.cy - baseCy - g.y) * k;
      apply();
    } else if (pts.length === 1 && v.scale > 1) {
      v.x = g.x + (pts[0].x - g.cx);
      v.y = g.y + (pts[0].y - g.cy);
      apply();
    }
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (view.current.scale < 1.02) view.current = { scale: 1, x: 0, y: 0 };
    apply();
    startGesture(); // 剩一根手指時,從現在的位置繼續拖曳
  };

  useEffect(() => {
    if (!info) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    reset();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.(); // 關閉後焦點回到原本的縮圖
    };
  }, [info, close]);

  // 電腦滾輪縮放(需要 non-passive 才能擋掉頁面捲動)
  const stageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(view.current.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX, e.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  if (!info) return null;
  const shown = fullUrl ?? thumbUrl;
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={t('photo.preview')} onClick={close}>
      <button ref={closeRef} type="button" className="lightbox-close" aria-label={t('photo.close')} onClick={close}>
        <Icon name="x" size={22} strokeWidth={2.2} />
      </button>
      <div
        ref={stageRef}
        className="lightbox-stage"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {shown && <img ref={imgRef} src={shown} alt="" draggable={false} className={fullUrl ? '' : 'loading'} />}
        {!fullUrl && <span className="lightbox-loading">{t('photo.loadingFull')}</span>}
      </div>
      <span className="lightbox-caption" onClick={(e) => e.stopPropagation()}>
        {t('photo.caption', { name: info.who, time: formatTime(info.at, i18n.language) })}
      </span>
    </div>
  );
}
