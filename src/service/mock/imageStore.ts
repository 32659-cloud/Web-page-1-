// 模擬照片儲存空間(階段二換成 Supabase Storage)。
// 照片檔案比較大,放不進 localStorage,所以存在瀏覽器的 IndexedDB(瀏覽器內建的、能存大檔案的資料庫)。
// 同一個瀏覽器的不同分頁共用同一份,所以兩個分頁能互相看到對方傳的照片。

const DB_NAME = 'chat-mock-images';
const STORE = 'blobs';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(req ? (req.result as T) : undefined);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      }),
  );
}

const urlCache = new Map<string, string>();

export async function putBlob(path: string, blob: Blob): Promise<void> {
  await run('readwrite', (s) => s.put(blob, path));
}

export async function getBlobUrl(path: string): Promise<string> {
  const cached = urlCache.get(path);
  if (cached) return cached;
  const blob = (await run<Blob>('readonly', (s) => s.get(path) as IDBRequest<Blob>)) as Blob | undefined;
  if (!blob) throw new Error('image not found');
  const url = URL.createObjectURL(blob);
  urlCache.set(path, url);
  return url;
}

export async function deleteBlobs(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await run('readwrite', (s) => {
    for (const p of paths) s.delete(p);
  });
  for (const p of paths) {
    const u = urlCache.get(p);
    if (u) URL.revokeObjectURL(u);
    urlCache.delete(p);
  }
}

export async function clearBlobs(): Promise<void> {
  await run('readwrite', (s) => s.clear());
  urlCache.forEach((u) => URL.revokeObjectURL(u));
  urlCache.clear();
}
