# 匿名聊天室

一個不用登入的匿名聊天室(公開聊天加雙方同意的私聊),前端放在 GitHub Pages,即時傳訊用 Supabase。

- 開始任何工作前,先讀 `docs/architecture.md`(需求在 `docs/requirements.md`)。
- 做畫面、前端時,還要讀 `docs/design.md`(顏色、尺寸、文字、版面以它為準)。
- 進度與待辦在 `docs/progress.md`,接手前先讀。
- 目前在「階段二」:前端已接上 Supabase(`SupabaseChatService`,`supabase/migrations/` 三份 SQL 在 SQL Editor 依序執行,不使用 Supabase CLI)。`VITE_BACKEND=mock` 仍可切回模擬層;正式網址要等手機實測後才把 `deploy.yml` 切成 `supabase`。
- 不可以把金鑰檔案 commit 進 git(`.env`、`.env.*`,只有 `.env.example` 例外;Secret key、資料庫密碼、Access token 一律不進 repo)。
