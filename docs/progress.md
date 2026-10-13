# 進度與待辦

最後更新:2026-10-14
目前階段:**階段一(前端加模擬通訊層),程式已寫好,還沒完成驗證**

## 已完成
- 需求、架構、視覺設計文件(`requirements.md`、`architecture.md`、`design.md`)
- 前端:TypeScript + React + Vite + Zustand + i18next,資料夾照架構文件第 11 節
- 模擬通訊層 `MockChatService`(規則在 `src/service/mock/core.ts`,機器人在 `bots.ts`)
- 六種語言的介面文字、淺色與深色模式、電腦版三欄與手機版分頁
- 自動測試 28 個(`npm test`),`npm run build` 通過
- 部署設定:`vite.config.ts` 的 `base` 自動帶入 repo 名稱,`.github/workflows/deploy.yml`

## 怎麼在本機看
- `npm install`(第一次)、`npm run dev`,打開 http://127.0.0.1:5173/ ,用完按 Ctrl+C 關掉
- 加 `?profile=2` 在同一個瀏覽器扮演另一個人;加 `?fast=1` 縮短邀請逾時、冷卻、離線時間
- 左下角「測試工具」:讓小明邀請我、機器人說話、模擬斷線、清除資料

## 待辦(依建議順序)
1. **在瀏覽器逐項檢查畫面,和 `design.md` 比對**:手機版、深色模式、進入畫面、照片放大、照片上傳與壓縮。目前只實際看過電腦版公開聊天室與私聊。
2. **GitHub 網頁設定**:repo 的 Settings → Pages → Source 選「GitHub Actions」,之後重新執行失敗的 Action,確認正式網址能打開;再用手機實際開一次。
3. **更新架構文件 5.2**:實作上指令失敗是丟出帶錯誤代碼的錯誤(`ChatError`),沒有發出 `command.rejected` 事件。
4. **升級 `vite`、`vitest`**,清掉 `npm audit` 的開發工具安全警告(發布出去的網頁是 0 個漏洞),升級後重跑 `npm test` 與 `npm run build`。
5. **架構文件 13.1 的驗證清單全部通過**,才進階段二。可補 `tests/e2e`(Playwright 已裝成開發套件)與 `tests/contract`。
6. 六種語言的文字請母語使用者校對(不在這版範圍,但上線前建議做)。

## 已知與刻意的差異
- 手機的「收回」是點自己的訊息再按「收回」,不是長按。
- 「測試工具」面板與 `?fast=1` 是階段一額外加的,階段二接上真實後端後面板會自動消失。
- 代號保留時間:沒有私聊 2 分鐘(我的決定),有私聊 30 分鐘。

## 階段二(尚未開始)
照 `architecture.md` 4.2:新增 `SupabaseChatService`、`supabase/migrations/`、Edge Function、金鑰設定。階段一的測試(`tests/core.test.ts`)可原封不動拿來驗證真實後端。
