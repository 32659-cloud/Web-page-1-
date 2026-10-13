# 匿名聊天室

一個不用登入的匿名聊天室(公開聊天加雙方同意的私聊),前端放在 GitHub Pages,即時傳訊用 Supabase。

- 開始任何工作前,先讀 `docs/architecture.md`(需求在 `docs/requirements.md`)。
- 做畫面、前端時,還要讀 `docs/design.md`(顏色、尺寸、文字、版面以它為準)。
- 進度與待辦在 `docs/progress.md`,接手前先讀。
- 目前在「階段一」:只做前端,通訊層用模擬版(`MockChatService`),還沒有接 Supabase。
- 不可以把金鑰檔案 commit 進 git(`.env`、`.env.*`,只有 `.env.example` 例外;Secret key、資料庫密碼、Access token 一律不進 repo)。
