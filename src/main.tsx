import { createRoot } from 'react-dom/client';
import './i18n';
import { App } from './App';
import { createService } from './service';
import { setService } from './state/serviceRef';
import { useChat } from './state/store';
import { applySavedTheme } from './utils/theme';
import './styles/tokens.css';
import './styles/app.css';

applySavedTheme();

// 手機鍵盤彈出時,iOS 不會縮小版面高度。這裡讓 --vvh 跟著可視範圍,輸入區才會跟著上移、不被擋住。
const vv = window.visualViewport;
if (vv) {
  const sync = () => {
    document.documentElement.style.setProperty('--vvh', `${vv.height}px`);
    if (vv.offsetTop !== 0 || vv.offsetLeft !== 0) window.scrollTo(0, 0);
  };
  vv.addEventListener('resize', sync);
  vv.addEventListener('scroll', sync);
  sync();
}

// 通訊層在這裡建立並交給 store。畫面只認 ChatService 介面,不知道後面是模擬還是 Supabase。
const bundle = createService();
setService(bundle);
useChat.getState().attach(bundle.service);
bundle.service.start();

createRoot(document.getElementById('root')!).render(<App />);
