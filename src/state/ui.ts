// 純畫面的暫時狀態(照片放大、離開確認)。和聊天資料分開,免得互相干擾。
import { create } from 'zustand';
import type { ImageRef } from '../protocol/types';

export interface LightboxInfo {
  image: ImageRef;
  who: string;
  at: string;
}

interface Ui {
  lightbox: LightboxInfo | null;
  leaveOpen: boolean;
  openLightbox(info: LightboxInfo): void;
  closeLightbox(): void;
  setLeaveOpen(open: boolean): void;
}

export const useUi = create<Ui>((set) => ({
  lightbox: null,
  leaveOpen: false,
  openLightbox: (lightbox) => set({ lightbox }),
  closeLightbox: () => set({ lightbox: null }),
  setLeaveOpen: (leaveOpen) => set({ leaveOpen }),
}));
