// 讓畫面元件在需要時(例如顯示照片)取得通訊層。
// 一般的指令都經過 store;只有「取得照片網址」這類不需要存進狀態的事情會直接用它。
import type { ServiceBundle } from '../service';

let bundle: ServiceBundle | null = null;

export function setService(b: ServiceBundle): void {
  bundle = b;
}

export function getService() {
  if (!bundle) throw new Error('service not ready');
  return bundle.service;
}

/** 只有模擬層有;階段二是 null */
export function getDevTools() {
  return bundle?.devTools ?? null;
}
