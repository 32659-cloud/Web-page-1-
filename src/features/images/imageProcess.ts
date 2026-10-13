// 傳照片前,在瀏覽器裡處理:檢查格式 → 壓縮 → 產生縮圖與大圖(docs/architecture.md 3.3)。
// 重新繪製、重新存檔的好處:照片裡的 GPS 位置等隱藏資料(EXIF)會被清掉,偽裝成圖片的其他檔案也會失敗。
import imageCompression from 'browser-image-compression';
import { ChatError } from '../../protocol/errors';
import { LIMITS } from '../../protocol/limits';

/** 原始檔案太大就不處理(避免瀏覽器被拖垮) */
const MAX_INPUT_BYTES = 30 * 1024 * 1024;
/** 照片邊長上限,超過就不解碼 */
const MAX_DIMENSION = 12000;

export interface ProcessedImage {
  thumb: Blob;
  full: Blob;
  width: number;
  height: number;
  thumbUrl: string;
  name: string;
  size: number;
}

/** 看檔案開頭的標記,不看副檔名:JPG、PNG、WebP 才放行 */
export async function sniffType(file: Blob): Promise<'jpeg' | 'png' | 'webp' | null> {
  const buf = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  const riff = String.fromCharCode(...buf.slice(0, 4));
  const webp = String.fromCharCode(...buf.slice(8, 12));
  if (riff === 'RIFF' && webp === 'WEBP') return 'webp';
  return null;
}

async function readSize(blob: Blob): Promise<{ width: number; height: number }> {
  const bmp = await createImageBitmap(blob);
  const size = { width: bmp.width, height: bmp.height };
  bmp.close();
  return size;
}

export async function processImage(file: File): Promise<ProcessedImage> {
  if (file.size > MAX_INPUT_BYTES) throw new ChatError('IMAGE_TOO_LARGE');
  if (!(await sniffType(file))) throw new ChatError('IMAGE_TYPE');

  let original: { width: number; height: number };
  try {
    original = await readSize(file);
  } catch {
    throw new ChatError('IMAGE_TYPE');
  }
  if (original.width > MAX_DIMENSION || original.height > MAX_DIMENSION) throw new ChatError('IMAGE_TOO_LARGE');

  const full = await imageCompression(file, {
    maxSizeMB: 1.9,
    maxWidthOrHeight: 1600,
    useWebWorker: false,
    fileType: 'image/webp',
    initialQuality: 0.85,
  });
  if (full.size > LIMITS.imageMaxBytes) throw new ChatError('IMAGE_TOO_LARGE');

  const thumb = await imageCompression(file, {
    maxSizeMB: 0.05,
    maxWidthOrHeight: 320,
    useWebWorker: false,
    fileType: 'image/webp',
  });

  const { width, height } = await readSize(full);
  return { thumb, full, width, height, thumbUrl: URL.createObjectURL(thumb), name: file.name, size: full.size };
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
