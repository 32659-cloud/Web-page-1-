import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '../../components/Avatar';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Icon } from '../../components/Icon';
import type { Message } from '../../protocol/types';
import { type TimelineItem, useChat } from '../../state/store';
import { useUi } from '../../state/ui';
import { dayKey, formatDay, formatTime } from '../../utils/time';
import { useImageUrl } from '../images/useImageUrl';

interface Props {
  items: TimelineItem[];
  meId: string;
  scope: 'public' | 'private';
}

function Thumb({ message }: { message: Message }) {
  const { t } = useTranslation();
  const image = message.image!;
  const url = useImageUrl(image.thumbPath);
  const open = useUi((s) => s.openLightbox);
  return (
    <button
      type="button"
      className="thumb"
      aria-label={t('chat.enlarge')}
      style={{ aspectRatio: `${image.width} / ${image.height}` }}
      onClick={(e) => {
        e.stopPropagation();
        open({ image, who: message.sender.nickname, at: message.createdAt });
      }}
    >
      {url ? <img src={url} alt="" /> : <span className="thumb-skeleton" />}
    </button>
  );
}

export function MessageList({ items, meId, scope }: Props) {
  const { t, i18n } = useTranslation();
  const recall = useChat((s) => s.recall);
  const scroller = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lastKey = useRef('');
  const [hasNew, setHasNew] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [recallId, setRecallId] = useState<string | null>(null);

  const toBottom = useCallback(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // 一進來就在最底部
  useLayoutEffect(() => {
    toBottom();
  }, [toBottom]);

  // 照片載入、版面變高時,如果原本就在底部,就跟著留在底部
  useEffect(() => {
    const el = inner.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (stick.current) toBottom();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [toBottom]);

  // 新訊息進來:在底部就跟著捲;正在看舊訊息就不強制捲動,改顯示「有新訊息」
  useEffect(() => {
    const last = items[items.length - 1];
    const key = last ? (last.kind === 'message' ? last.message.id : last.id) : '';
    const added = key !== lastKey.current && key !== '';
    lastKey.current = key;
    if (!added) return;
    const mine = last.kind === 'message' && last.message.sender.userId === meId;
    if (stick.current || mine) {
      stick.current = true;
      toBottom();
      setHasNew(false);
    } else if (last.kind === 'message') {
      setHasNew(true);
    }
  }, [items, meId, toBottom]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    stick.current = near;
    if (near) setHasNew(false);
  };

  const rows: JSX.Element[] = [];
  let prevDay = '';
  let prevSender: string | null = null;

  for (const it of items) {
    const at = it.kind === 'message' ? it.message.createdAt : it.at;
    const dk = dayKey(at);
    if (dk !== prevDay) {
      rows.push(
        <div className="day-divider" key={`d${dk}${rows.length}`}>
          <span />
          {formatDay(at, i18n.language)}
          <span />
        </div>,
      );
      prevDay = dk;
      prevSender = null;
    }

    if (it.kind === 'system') {
      rows.push(
        <div className="system-row" key={it.id}>
          <span>{t(`system.${it.key}`, { name: it.name })}</span>
        </div>,
      );
      prevSender = null;
      continue;
    }

    const m = it.message;
    const own = m.sender.userId === meId;
    const head = prevSender !== m.sender.userId;
    prevSender = m.sender.userId;
    const active = activeId === m.id;

    rows.push(
      <div className={`msg-row ${own ? 'own' : 'other'} ${head ? 'head' : ''}`} key={m.id}>
        {!own && (head ? <Avatar name={m.sender.nickname} size={34} /> : <span className="avatar-spacer" />)}
        <div className="msg-col">
          {!own && head && <span className="msg-name">{m.sender.nickname}</span>}
          <div className="msg-line">
            <div
              className={`bubble ${m.recalled ? 'recalled' : ''} ${m.image ? 'has-image' : ''}`}
              onClick={() => own && !m.recalled && setActiveId(active ? null : m.id)}
            >
              {m.recalled ? (
                <span>{t('chat.recalled')}</span>
              ) : (
                <>
                  {m.image && <Thumb message={m} />}
                  {m.text && <div className={`bubble-text ${m.image ? 'with-image' : ''}`}>{m.text}</div>}
                </>
              )}
            </div>
            <div className="msg-meta">
              {own && !m.recalled && (
                <button
                  type="button"
                  className={`recall-btn ${active ? 'show' : ''} ${m.image ? 'on-photo' : ''}`}
                  onClick={() => setRecallId(m.id)}
                >
                  <Icon name="undo" size={12} strokeWidth={2.4} />
                  {t('chat.recall')}
                </button>
              )}
              <time dateTime={m.createdAt}>{formatTime(m.createdAt, i18n.language)}</time>
            </div>
          </div>
        </div>
      </div>,
    );
  }

  return (
    <div className="msg-wrap">
      <div className="msg-scroll" ref={scroller} onScroll={onScroll} role="log" aria-live="polite">
        <div className="msg-inner" ref={inner}>
          {items.length === 0 && (
            <div className="empty-state">
              <strong>{t(scope === 'public' ? 'chat.emptyPublic' : 'convs.empty')}</strong>
              <span>{t(scope === 'public' ? 'chat.emptyPublicHint' : 'convs.emptyHint')}</span>
            </div>
          )}
          {rows}
        </div>
      </div>
      {hasNew && (
        <button
          type="button"
          className="new-msg-btn"
          onClick={() => {
            stick.current = true;
            toBottom();
            setHasNew(false);
          }}
        >
          <Icon name="arrowDown" size={16} strokeWidth={2.4} />
          {t('chat.newMessages')}
        </button>
      )}
      {recallId && (
        <ConfirmDialog
          icon="undo"
          title={t('recallDlg.title')}
          body={t('recallDlg.body')}
          confirmLabel={t('recallDlg.confirm')}
          onCancel={() => setRecallId(null)}
          onConfirm={() => {
            const id = recallId;
            setRecallId(null);
            setActiveId(null);
            void recall(scope, id);
          }}
        />
      )}
    </div>
  );
}
