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

// 通訊層在這裡建立並交給 store。畫面只認 ChatService 介面,不知道後面是模擬還是 Supabase。
const bundle = createService();
setService(bundle);
useChat.getState().attach(bundle.service);
bundle.service.start();

createRoot(document.getElementById('root')!).render(<App />);
