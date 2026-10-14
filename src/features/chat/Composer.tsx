import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/Icon';
import { LIMITS } from '../../protocol/limits';
import { toChatError } from '../../protocol/errors';
import { getService } from '../../state/serviceRef';
import { useChat } from '../../state/store';
import { insertAt } from '../../utils/insertText';
import { charCount } from '../../utils/nickname';
import { EmojiPanel } from './EmojiPanel';
import { formatBytes, type ProcessedImage, processImage } from '../images/imageProcess';

interface Props {
  scope: 'public' | 'private';
  conversationId?: string;
  /** 私聊已結束:輸入停用 */
  ended?: boolean;
  onCloseWindow?: () => void;
}

// 切換對話時,各對話沒送出的草稿要留著
const drafts = new Map<string, string>();

type Pending =
  | null
  | { status: 'processing'; name: string }
  | { status: 'ready'; image: ProcessedImage }
  | { status: 'uploading'; image: ProcessedImage; percent: number };

function imageOf(p: Pending): ProcessedImage | null {
  return p && p.status !== 'processing' ? p.image : null;
}

const isTouch = () =>window.matchMedia?.('(pointer: coarse)').matches ?? false;

export function Composer({ scope, conversationId, ended, onCloseWindow }: Props) {
  const { t } = useTranslation();
  const connection = useChat((s) => s.connection);
  const sendPublic = useChat((s) => s.sendPublic);
  const sendPrivate = useChat((s) => s.sendPrivate);
  const errorToast = useChat((s) => s.errorToast);

  const draftKey = `${scope}:${conversationId ?? ''}`;
  const [text, setText] = useState(() => drafts.get(draftKey) ?? '');
  const [pending, setPending] = useState<Pending>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const textRef = useRef(text);
  textRef.current = text;
  const touch = isTouch();

  // 離開這個對話時,把草稿記起來
  useEffect(
    () => () => {
      drafts.set(draftKey, textRef.current);
    },
    [draftKey],
  );

  // 輸入框隨內容長高(最多約 5 行)
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = '24px';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [text]);

  const count = charCount(text);
  const over = count > LIMITS.textMax;
  const online = connection === 'connected';
  const busy = pending?.status === 'processing' || pending?.status === 'uploading';
  const hasContent = text.trim().length > 0 || pending?.status === 'ready';
  const canSend = !ended && online && !over && !busy && hasContent;

  async function submit() {
    if (!canSend) return;
    const started = pending;
    let image = null;
    if (pending?.status === 'ready') {
      const img = pending.image;
      try {
        setPending({ status: 'uploading', image: img, percent: 0 });
        image = await getService().uploadImage(
          scope,
          img,
          (percent) => setPending({ status: 'uploading', image: img, percent }),
          conversationId,
        );
      } catch (e) {
        setPending({ status: 'ready', image: img });
        errorToast(e);
        return;
      }
    }
    const ok =
      scope === 'public'
        ? await sendPublic(text, image)
        : await sendPrivate(conversationId!, text, image);
    const sentImage = imageOf(started);
    if (ok) {
      if (sentImage) URL.revokeObjectURL(sentImage.thumbUrl);
      setText('');
      drafts.delete(draftKey);
      setPending(null);
      area.current?.focus();
    } else if (sentImage) {
      setPending({ status: 'ready', image: sentImage });
    }
  }

  async function onPickFile(file: File | undefined) {
    if (!file) return;
    setPending({ status: 'processing', name: file.name });
    try {
      const image = await processImage(file);
      setPending({ status: 'ready', image });
    } catch (e) {
      setPending(null);
      errorToast(toChatError(e));
    }
  }

  function insertEmoji(s: string) {
    const el = area.current;
    const r = insertAt(text, s, el?.selectionStart ?? text.length, el?.selectionEnd ?? text.length);
    setText(r.text);
    // 重新渲染後把游標放在插入的字後面
    requestAnimationFrame(() => {
      const a = area.current;
      if (!a) return;
      if (!touch) a.focus();
      a.setSelectionRange(r.cursor, r.cursor);
    });
  }

  function cancelPhoto() {
    const img = imageOf(pending);
    if (img) URL.revokeObjectURL(img.thumbUrl);
    setPending(null);
  }

  if (ended) {
    return (
      <div className="composer">
        <div className="composer-row">
          <div className="input-box disabled">
            <span className="input-disabled-text">{t('chat.inputDisabled')}</span>
            <button type="button" className="btn btn-primary btn-sm" onClick={onCloseWindow}>
              {t('chat.closeWindow')}
            </button>
          </div>
        </div>
        <span className="composer-hint">{t('chat.inputDisabledHint')}</span>
      </div>
    );
  }

  return (
    <div className="composer">
      {pending && (
        <div className="photo-preview">
          {pending.status === 'processing' ? (
            <>
              <span className="spinner" aria-hidden="true" />
              <div className="photo-info">
                <span className="photo-title">{t('photo.processing')}</span>
              </div>
            </>
          ) : (
            <>
              <img src={pending.image.thumbUrl} alt={t('photo.preview')} />
              <div className="photo-info">
                <span className="photo-title">
                  {t('photo.ready', { name: pending.image.name, size: formatBytes(pending.image.size) })}
                </span>
                {pending.status === 'uploading' && (
                  <div className="progress-row">
                    <div className="progress" role="progressbar" aria-valuenow={pending.percent} aria-valuemin={0} aria-valuemax={100}>
                      <div style={{ width: `${pending.percent}%` }} />
                    </div>
                    <span>{t('photo.uploading', { percent: pending.percent })}</span>
                  </div>
                )}
              </div>
            </>
          )}
          {pending.status !== 'uploading' && (
            <button type="button" className="icon-btn" aria-label={t('photo.cancel')} onClick={cancelPhoto}>
              <Icon name="x" size={16} strokeWidth={2.2} />
            </button>
          )}
        </div>
      )}

      {showEmoji && <EmojiPanel onPick={insertEmoji} />}
      <div className="composer-row">
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={(e) => {
            void onPickFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className="photo-btn"
          aria-label={t('chat.photo')}
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          <Icon name="image" size={22} />
        </button>
        <button
          type="button"
          className="photo-btn emoji-btn"
          aria-label={t('chat.emojiPanel')}
          aria-expanded={showEmoji}
          onClick={() => setShowEmoji((v) => !v)}
        >
          <Icon name="smile" size={22} />
        </button>
        <div className={`input-box ${over ? 'over' : ''}`}>
          <textarea
            ref={area}
            rows={1}
            value={text}
            placeholder={t('chat.placeholder')}
            aria-label={t('chat.placeholder')}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // 電腦:Enter 送出、Shift+Enter 換行。手機:Enter 換行,按送出鈕才送。
              if (e.key !== 'Enter' || e.shiftKey || touch || e.nativeEvent.isComposing) return;
              e.preventDefault();
              void submit();
            }}
          />
          <span className={`counter ${over ? 'over' : ''}`}>
            {count}/{LIMITS.textMax}
          </span>
        </div>
        <button type="button" className="send-btn" disabled={!canSend} onClick={() => void submit()} aria-label={t('chat.send')}>
          <Icon name="send" size={18} />
          <span className="send-label">{t('chat.send')}</span>
        </button>
      </div>
      {!touch && <span className="composer-hint">{t('chat.hint')}</span>}
    </div>
  );
}
