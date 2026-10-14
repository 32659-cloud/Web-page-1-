import { useEffect, useState } from 'react';

/** 每隔一段時間回傳現在時間,讓畫面可以做倒數。active 為 false 時不跑計時器。 */
export function useNow(intervalMs: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs]);
  return now;
}
