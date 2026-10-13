import { useState } from 'react';
import { toChatError } from '../../protocol/errors';
import { getDevTools } from '../../state/serviceRef';
import { useChat } from '../../state/store';

/** 測試工具:只有階段一的模擬層才有。階段二接上真實後端後,這個面板會自動消失。 */
export function DevTools() {
  const dev = getDevTools();
  const [open, setOpen] = useState(false);
  const errorToast = useChat((s) => s.errorToast);
  if (!dev) return null;

  const run = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      errorToast(toChatError(e));
    }
  };

  return (
    <div className="dev-tools">
      {open && (
        <div className="dev-panel">
          <strong>測試工具(階段一)</strong>
          <button type="button" onClick={() => run(() => dev.botInviteMe())}>
            讓小明邀請我
          </button>
          <button type="button" onClick={() => run(() => dev.botSay())}>
            讓機器人說一句話
          </button>
          <button type="button" onClick={() => run(() => dev.simulateOffline(5))}>
            模擬斷線 5 秒(不會有提示)
          </button>
          <button type="button" onClick={() => run(() => dev.simulateOffline(20))}>
            模擬斷線 20 秒(別人會看到「離開了」)
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm('清除所有測試資料並重新整理?')) void dev.resetAll();
            }}
          >
            清除所有資料
          </button>
        </div>
      )}
      <button type="button" className="dev-toggle" onClick={() => setOpen(!open)}>
        測試工具
      </button>
    </div>
  );
}
