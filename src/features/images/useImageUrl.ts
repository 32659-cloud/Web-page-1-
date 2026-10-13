import { useEffect, useState } from 'react';
import { getService } from '../../state/serviceRef';

/** 取得照片的可顯示網址(階段一從瀏覽器的儲存空間取,階段二是有時效的簽名網址) */
export function useImageUrl(path: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (!path) return;
    getService()
      .getImageUrl(path)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setUrl(null));
    return () => {
      alive = false;
    };
  }, [path]);
  return url;
}
