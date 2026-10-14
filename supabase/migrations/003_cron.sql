-- 每分鐘巡邏一次(邀請逾時、釋放代號、結束離線太久的私聊、清舊紀錄)。
-- 在 001 成功之後,貼到 SQL Editor 執行。如果出現 pg_cron 的錯誤,先到
-- 左邊選單 Integrations → 找到 Cron → 啟用,再重新執行這一份。
create extension if not exists pg_cron;

select cron.schedule('chat-cleanup', '* * * * *', $$select public.cleanup()$$);
