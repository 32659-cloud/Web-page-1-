import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EMOJI, KAOMOJI } from './emojiData';

interface Props {
  onPick: (s: string) => void;
}

export function EmojiPanel({ onPick }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'kaomoji' | 'emoji'>('kaomoji');
  const items = tab === 'kaomoji' ? KAOMOJI : EMOJI;
  return (
    <div className="emoji-panel">
      <div className="emoji-tabs" role="tablist">
        {(['kaomoji', 'emoji'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            className={`emoji-tab ${tab === k ? 'on' : ''}`}
            onClick={() => setTab(k)}
          >
            {t(k === 'kaomoji' ? 'chat.tabKaomoji' : 'chat.tabEmoji')}
          </button>
        ))}
      </div>
      <div className={`emoji-grid ${tab}`} role="tabpanel">
        {items.map((s) => (
          <button
            key={s}
            type="button"
            className="emoji-item"
            // 不搶走輸入框焦點(電腦版)
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(s)}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}
