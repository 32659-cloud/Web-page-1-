-- 照片儲存空間:兩個桶子與存取規則。在 001 成功之後,貼到 SQL Editor 執行。可以重複執行。
-- 路徑約定(src/service/supabase 也照這個):
--   公開桶 chat-public : <我的 userId>/<檔名>
--   私聊桶 chat-private: <私聊 id>/<我的 userId>/<檔名>

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('chat-public',  'chat-public',  true,  2097152, array['image/webp', 'image/jpeg', 'image/png']),
  ('chat-private', 'chat-private', false, 2097152, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 公開桶:任何人用網址都看得到(桶子本身是公開的);只有自己的資料夾能上傳、刪除
drop policy if exists chat_public_insert on storage.objects;
create policy chat_public_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-public' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists chat_public_delete on storage.objects;
create policy chat_public_delete on storage.objects for delete to authenticated
  using (bucket_id = 'chat-public' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- 私聊桶:只有這個私聊的兩個人能看;只有進行中的私聊的參與者能上傳到自己的資料夾
drop policy if exists chat_private_insert on storage.objects;
create policy chat_private_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat-private'
    and (storage.foldername(name))[2] = (select auth.uid())::text
    and exists (
      select 1 from public.conversations c
      where c.id::text = (storage.foldername(name))[1] and c.status = 'active'
        and (select auth.uid()) in (c.user_a, c.user_b)
    )
  );

drop policy if exists chat_private_select on storage.objects;
create policy chat_private_select on storage.objects for select to authenticated
  using (
    bucket_id = 'chat-private'
    and exists (
      select 1 from public.conversations c
      where c.id::text = (storage.foldername(name))[1]
        and (select auth.uid()) in (c.user_a, c.user_b)
    )
  );

drop policy if exists chat_private_delete on storage.objects;
create policy chat_private_delete on storage.objects for delete to authenticated
  using (bucket_id = 'chat-private' and (storage.foldername(name))[2] = (select auth.uid())::text);
