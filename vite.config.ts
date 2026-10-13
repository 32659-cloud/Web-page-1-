import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// GitHub Pages 的網址是 https://<帳號>.github.io/<repo 名稱>/,
// 所以打包時 base 要等於 /<repo 名稱>/。GitHub Actions 會自動提供 GITHUB_REPOSITORY(格式:帳號/repo 名稱)。
// 在自己的電腦上開發或預覽時沒有這個變數,base 就是 /。
const repo = process.env.GITHUB_REPOSITORY?.split('/')[1];

export default defineConfig({
  base: repo ? `/${repo}/` : '/',
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
