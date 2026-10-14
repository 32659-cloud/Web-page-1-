-- 匿名聊天室:資料表、存取規則(RLS)、資料庫函式
-- 在 Supabase 網頁的 SQL Editor 貼上整份、按 Run。可以重複執行(不會重複建立、不會刪掉資料)。
-- 規則的數字要和 src/protocol/limits.ts 一致(docs/architecture.md 5.4)。
-- 錯誤用「例外訊息 = 錯誤代碼」回報(例如 RATE_LIMITED),需要等待的秒數放在 detail。

-- ═════════ 資料表 ═════════

-- 每個進入聊天室的人。前端不能直接讀寫,只能透過下面的函式。
create table if not exists public.profiles (
  user_id    uuid primary key,
  nickname   text not null,
  nick_key   text not null,
  lang       text not null default 'zh-TW',
  last_seen  timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index if not exists profiles_nick_key_idx on public.profiles (nick_key);

create table if not exists public.public_messages (
  id          uuid primary key default gen_random_uuid(),
  sender_id   uuid not null,
  sender_nick text not null,
  body        text,
  image       jsonb,
  recalled    boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists public_messages_created_idx on public.public_messages (created_at desc);

create table if not exists public.conversations (
  id         uuid primary key default gen_random_uuid(),
  user_a     uuid not null,
  user_b     uuid not null,
  nick_a     text not null,
  nick_b     text not null,
  started_at timestamptz not null default now(),
  status     text not null default 'active' check (status in ('active', 'ended')),
  ended_at   timestamptz,
  ended_by   uuid,
  end_reason text check (end_reason in ('ended', 'left', 'timeout'))
);
create index if not exists conversations_a_idx on public.conversations (user_a);
create index if not exists conversations_b_idx on public.conversations (user_b);

create table if not exists public.private_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null,
  sender_nick     text not null,
  body            text,
  image           jsonb,
  recalled        boolean not null default false,
  created_at      timestamptz not null default now()
);
create index if not exists private_messages_conv_idx on public.private_messages (conversation_id, created_at);

create table if not exists public.invitations (
  id         uuid primary key default gen_random_uuid(),
  from_id    uuid not null,
  to_id      uuid not null,
  from_nick  text not null,
  to_nick    text not null,
  status     text not null default 'pending'
             check (status in ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists invitations_from_idx on public.invitations (from_id);
create index if not exists invitations_to_idx on public.invitations (to_id);

-- 被拒絕後的冷卻(30 分鐘內不能再邀請同一個人)
create table if not exists public.invite_cooldowns (
  from_id uuid not null,
  to_id   uuid not null,
  until   timestamptz not null,
  primary key (from_id, to_id)
);

-- 防洗版紀錄:誰、做了什麼、對誰、內容雜湊值、時間
create table if not exists public.rate_events (
  id      bigint generated always as identity primary key,
  user_id uuid not null,
  kind    text not null check (kind in ('msg', 'img', 'inv')),
  target  uuid,
  dup     text,
  at      timestamptz not null default now()
);
create index if not exists rate_events_idx on public.rate_events (user_id, kind, at desc);

-- ═════════ 存取規則(RLS) ═════════
-- 前端只能「讀」下面四張表,而且只讀得到自己有權限的列;所有「寫」都要經過函式。

alter table public.profiles         enable row level security;
alter table public.public_messages  enable row level security;
alter table public.conversations    enable row level security;
alter table public.private_messages enable row level security;
alter table public.invitations      enable row level security;
alter table public.invite_cooldowns enable row level security;
alter table public.rate_events      enable row level security;

revoke all on all tables in schema public from anon, authenticated;
grant select on public.public_messages, public.conversations, public.private_messages, public.invitations
  to authenticated;

drop policy if exists public_messages_read on public.public_messages;
create policy public_messages_read on public.public_messages
  for select to authenticated using (true);

drop policy if exists conversations_read on public.conversations;
create policy conversations_read on public.conversations
  for select to authenticated
  using ((select auth.uid()) in (user_a, user_b));

drop policy if exists private_messages_read on public.private_messages;
create policy private_messages_read on public.private_messages
  for select to authenticated
  using (exists (
    select 1 from public.conversations c
    where c.id = private_messages.conversation_id and (select auth.uid()) in (c.user_a, c.user_b)
  ));

drop policy if exists invitations_read on public.invitations;
create policy invitations_read on public.invitations
  for select to authenticated
  using ((select auth.uid()) in (from_id, to_id));

-- ═════════ 即時推送 ═════════
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['public_messages', 'private_messages', 'invitations', 'conversations'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ═════════ 內部小工具(前端不能呼叫) ═════════

-- 整理代號:全形轉一般字、去掉看不見的字元、連續空白變一個、去掉前後空白
create or replace function public._clean_nick(p text) returns text
language sql set search_path = public as $$
  select btrim(regexp_replace(
    regexp_replace(normalize(coalesce(p, ''), NFKC),
      '[\u0001-\u001F\u007F-\u009F­​-‏‪-‮⁠-⁤﻿]', '', 'g'),
    '\s+', ' ', 'g'))
$$;

-- 判斷「重複內容」用:忽略空白、大小寫、標點
create or replace function public._dup_key(p text) returns text
language plpgsql set search_path = public as $$
declare v_base text; v_s text;
begin
  v_base := lower(normalize(coalesce(p, ''), NFKC));
  v_s := regexp_replace(v_base,
    $re$[\s!"#%&'()*,\-./:;?@\[\\\]_{}‐-‧、-〃〈-】〔-〟・]$re$, '', 'g');
  if v_s = '' then return btrim(v_base); end if;
  return v_s;
end $$;

create or replace function public._retry_sec(p_until timestamptz) returns text
language sql as $$
  select greatest(1, ceil(extract(epoch from (p_until - now()))))::int::text
$$;

create or replace function public._conv_count(p_uid uuid) returns int
language sql set search_path = public as $$
  select count(*)::int from conversations
  where status = 'active' and p_uid in (user_a, user_b)
$$;

-- 檢查照片資料:只接受自己上傳的路徑(公開桶 chat-public/<我>/…;私聊桶 chat-private/<私聊>/<我>/…)
create or replace function public._check_image(p_uid uuid, p_scope text, p_conv uuid, p_image jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare v_prefix text; v_thumb text; v_full text; v_w numeric; v_h numeric;
begin
  if p_image is null or p_image = 'null'::jsonb then return null; end if;
  if jsonb_typeof(p_image) <> 'object' then raise exception 'NOT_ALLOWED'; end if;
  v_thumb := p_image ->> 'thumbPath';
  v_full  := p_image ->> 'fullPath';
  if jsonb_typeof(p_image -> 'width') is distinct from 'number'
     or jsonb_typeof(p_image -> 'height') is distinct from 'number' then
    raise exception 'NOT_ALLOWED';
  end if;
  v_w := (p_image ->> 'width')::numeric;
  v_h := (p_image ->> 'height')::numeric;
  if v_thumb is null or v_full is null or v_w < 1 or v_w > 20000 or v_h < 1 or v_h > 20000 then
    raise exception 'NOT_ALLOWED';
  end if;
  if p_scope = 'public' then
    v_prefix := 'chat-public/' || p_uid::text || '/';
  else
    v_prefix := 'chat-private/' || p_conv::text || '/' || p_uid::text || '/';
  end if;
  if left(v_thumb, length(v_prefix)) <> v_prefix or left(v_full, length(v_prefix)) <> v_prefix
     or position('..' in v_thumb) > 0 or position('..' in v_full) > 0
     or length(v_thumb) > 300 or length(v_full) > 300 then
    raise exception 'IMAGE_TYPE';
  end if;
  return jsonb_build_object('thumbPath', v_thumb, 'fullPath', v_full, 'width', v_w::int, 'height', v_h::int);
end $$;

-- 送訊息前的共同檢查:長度、每秒 3 則、照片每分鐘 3 張、相同內容 1 分鐘 3 次。回傳整理過的文字
create or replace function public._check_content(p_uid uuid, p_text text, p_image jsonb)
returns text language plpgsql set search_path = public as $$
declare v_text text; v_n int; v_oldest timestamptz; v_dup text;
begin
  v_text := regexp_replace(coalesce(p_text, ''), '^\s+|\s+$', '', 'g');
  if char_length(v_text) > 500 then raise exception 'TEXT_TOO_LONG'; end if;
  if v_text = '' and p_image is null then raise exception 'NOT_ALLOWED'; end if;

  select count(*), min(at) into v_n, v_oldest from rate_events
   where user_id = p_uid and kind = 'msg' and at > now() - interval '1 second';
  if v_n >= 3 then
    raise exception 'RATE_LIMITED' using detail = _retry_sec(v_oldest + interval '1 second');
  end if;

  if p_image is not null then
    select count(*), min(at) into v_n, v_oldest from rate_events
     where user_id = p_uid and kind = 'img' and at > now() - interval '1 minute';
    if v_n >= 3 then
      raise exception 'IMAGE_RATE_LIMITED' using detail = _retry_sec(v_oldest + interval '1 minute');
    end if;
  end if;

  if v_text <> '' then
    v_dup := _dup_key(v_text);
    select count(*), min(r.at) into v_n, v_oldest from rate_events r
     where r.user_id = p_uid and r.kind = 'msg' and r.dup = v_dup and r.at > now() - interval '1 minute';
    if v_n >= 3 then
      raise exception 'DUPLICATE_CONTENT' using detail = _retry_sec(v_oldest + interval '1 minute');
    end if;
  end if;

  insert into rate_events (user_id, kind, dup) values (p_uid, 'msg', v_dup);
  if p_image is not null then insert into rate_events (user_id, kind) values (p_uid, 'img'); end if;
  return v_text;
end $$;

-- 結束一個私聊:標記結束並刪掉訊息
create or replace function public._end_conv(p_conv uuid, p_by uuid, p_reason text) returns void
language plpgsql set search_path = public as $$
begin
  update conversations
     set status = 'ended', ended_at = now(), ended_by = p_by, end_reason = p_reason
   where id = p_conv and status = 'active';
  delete from private_messages where conversation_id = p_conv;
end $$;

-- 這個人要有登記過(進入過)才能做事,回傳他的代號
create or replace function public._require_profile(p_uid uuid) returns text
language plpgsql set search_path = public as $$
declare v_nick text;
begin
  if p_uid is null then raise exception 'NOT_ENTERED'; end if;
  select nickname into v_nick from profiles where user_id = p_uid;
  if v_nick is null then raise exception 'NOT_ENTERED'; end if;
  return v_nick;
end $$;

-- ═════════ 前端呼叫的函式(RPC) ═════════

create or replace function public.enter(p_nickname text, p_lang text)
returns text language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_nick text; v_lang text;
begin
  if v_uid is null then raise exception 'NOT_ENTERED'; end if;
  v_nick := _clean_nick(p_nickname);
  if char_length(v_nick) < 1 or char_length(v_nick) > 20 then raise exception 'NICKNAME_INVALID'; end if;
  v_lang := case when p_lang in ('zh-TW', 'en', 'ja', 'ko', 'es', 'fr') then p_lang else 'zh-TW' end;
  begin
    insert into profiles (user_id, nickname, nick_key, lang, last_seen)
    values (v_uid, v_nick, lower(v_nick), v_lang, now())
    on conflict (user_id) do update
      set nickname = excluded.nickname, nick_key = excluded.nick_key, lang = excluded.lang, last_seen = now();
  exception when unique_violation then
    raise exception 'NICKNAME_TAKEN';
  end;
  return v_nick;
end $$;

-- 每 20 秒回報「我還在」。回傳 false 代表伺服器已經不認得這個人(代號已釋放)
create or replace function public.heartbeat() returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update profiles set last_seen = now() where user_id = auth.uid();
  return found;
end $$;

create or replace function public.set_lang(p_lang text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _require_profile(auth.uid());
  if p_lang in ('zh-TW', 'en', 'ja', 'ko', 'es', 'fr') then
    update profiles set lang = p_lang where user_id = auth.uid();
  end if;
end $$;

-- 離開:結束所有私聊、取消等待中的邀請、釋放代號
create or replace function public.leave() returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); r record;
begin
  if v_uid is null then return; end if;
  for r in select id from conversations where status = 'active' and v_uid in (user_a, user_b) loop
    perform _end_conv(r.id, v_uid, 'left');
  end loop;
  update invitations set status = 'cancelled'
   where status = 'pending' and v_uid in (from_id, to_id);
  delete from profiles where user_id = v_uid;
end $$;

create or replace function public.send_public(p_text text, p_image jsonb default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_nick text; v_img jsonb; v_text text; v_id uuid;
begin
  v_nick := _require_profile(v_uid);
  v_img := _check_image(v_uid, 'public', null, p_image);
  v_text := _check_content(v_uid, p_text, v_img);
  insert into public_messages (sender_id, sender_nick, body, image)
  values (v_uid, v_nick, nullif(v_text, ''), v_img) returning id into v_id;
  -- 永遠只留最新 100 則
  delete from public_messages
   where id in (select id from public_messages order by created_at desc, id offset 100);
  update profiles set last_seen = now() where user_id = v_uid;
  return v_id;
end $$;

create or replace function public.send_private(p_conversation uuid, p_text text, p_image jsonb default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_nick text; v_img jsonb; v_text text; v_id uuid; v_ok boolean;
begin
  v_nick := _require_profile(v_uid);
  select true into v_ok from conversations
   where id = p_conversation and status = 'active' and v_uid in (user_a, user_b);
  if v_ok is null then raise exception 'CONVERSATION_ENDED'; end if;
  v_img := _check_image(v_uid, 'private', p_conversation, p_image);
  v_text := _check_content(v_uid, p_text, v_img);
  insert into private_messages (conversation_id, sender_id, sender_nick, body, image)
  values (p_conversation, v_uid, v_nick, nullif(v_text, ''), v_img) returning id into v_id;
  update profiles set last_seen = now() where user_id = v_uid;
  return v_id;
end $$;

-- 收回自己的訊息:內容真的清掉。回傳原本的照片資料,讓瀏覽器把自己的照片檔刪掉
create or replace function public.recall(p_scope text, p_message uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_img jsonb; v_found boolean := false;
begin
  perform _require_profile(v_uid);
  if p_scope = 'public' then
    select image, true into v_img, v_found from public_messages where id = p_message and sender_id = v_uid;
    if v_found then
      update public_messages set recalled = true, body = null, image = null where id = p_message;
    end if;
  elsif p_scope = 'private' then
    select image, true into v_img, v_found from private_messages where id = p_message and sender_id = v_uid;
    if v_found then
      update private_messages set recalled = true, body = null, image = null where id = p_message;
    end if;
  end if;
  if not coalesce(v_found, false) then raise exception 'NOT_ALLOWED'; end if;
  return v_img;
end $$;

create or replace function public.invite(p_to uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_nick text; v_to_nick text; v_seen timestamptz;
  v_until timestamptz; v_n int; v_oldest timestamptz; v_inv invitations;
begin
  v_nick := _require_profile(v_uid);
  if p_to is null or p_to = v_uid then raise exception 'NOT_ALLOWED'; end if;

  -- 逾時的邀請先標記掉
  update invitations set status = 'expired'
   where status = 'pending' and expires_at <= now()
     and (v_uid in (from_id, to_id) or p_to in (from_id, to_id));

  select nickname, last_seen into v_to_nick, v_seen from profiles where user_id = p_to;
  if v_to_nick is null or v_seen < now() - interval '45 seconds' then raise exception 'PEER_OFFLINE'; end if;

  if exists (select 1 from conversations where status = 'active'
              and ((user_a = v_uid and user_b = p_to) or (user_a = p_to and user_b = v_uid))) then
    raise exception 'ALREADY_CHATTING';
  end if;
  if exists (select 1 from invitations where status = 'pending'
              and ((from_id = v_uid and to_id = p_to) or (from_id = p_to and to_id = v_uid))) then
    raise exception 'INVITE_PENDING';
  end if;

  select c.until into v_until from invite_cooldowns c
   where c.from_id = v_uid and c.to_id = p_to and c.until > now();
  if v_until is not null then raise exception 'INVITE_COOLDOWN' using detail = _retry_sec(v_until); end if;

  select count(*), min(r.at) into v_n, v_oldest from rate_events r
   where r.user_id = v_uid and r.kind = 'inv' and r.target = p_to and r.at > now() - interval '1 minute';
  if v_n >= 2 then
    raise exception 'INVITE_RATE_LIMITED' using detail = _retry_sec(v_oldest + interval '1 minute');
  end if;

  if _conv_count(v_uid) >= 5 then raise exception 'SELF_CHAT_FULL'; end if;
  if _conv_count(p_to) >= 5 then raise exception 'PEER_CHAT_FULL'; end if;

  insert into invitations (from_id, to_id, from_nick, to_nick, expires_at)
  values (v_uid, p_to, v_nick, v_to_nick, now() + interval '60 seconds') returning * into v_inv;
  insert into rate_events (user_id, kind, target) values (v_uid, 'inv', p_to);
  return to_jsonb(v_inv);
end $$;

-- 回應邀請。接受:回傳新的私聊;拒絕:回傳 null 並記下 30 分鐘冷卻
create or replace function public.respond_invite(p_invitation uuid, p_accept boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_nick text; v_inv invitations; v_from_nick text; v_conv conversations;
begin
  v_nick := _require_profile(v_uid);
  select * into v_inv from invitations
   where id = p_invitation and to_id = v_uid and status = 'pending' for update;
  if v_inv.id is null then raise exception 'NOT_ALLOWED'; end if;
  if v_inv.expires_at <= now() then
    update invitations set status = 'expired' where id = v_inv.id;
    return null;
  end if;

  if not p_accept then
    update invitations set status = 'declined' where id = v_inv.id;
    insert into invite_cooldowns (from_id, to_id, until)
    values (v_inv.from_id, v_inv.to_id, now() + interval '30 minutes')
    on conflict (from_id, to_id) do update set until = excluded.until;
    return null;
  end if;

  select nickname into v_from_nick from profiles where user_id = v_inv.from_id;
  if v_from_nick is null then raise exception 'PEER_OFFLINE'; end if;
  if _conv_count(v_uid) >= 5 then raise exception 'SELF_CHAT_FULL'; end if;
  if _conv_count(v_inv.from_id) >= 5 then raise exception 'PEER_CHAT_FULL'; end if;

  update invitations set status = 'accepted' where id = v_inv.id;
  insert into conversations (user_a, user_b, nick_a, nick_b)
  values (v_inv.from_id, v_uid, v_from_nick, v_nick) returning * into v_conv;
  return to_jsonb(v_conv);
end $$;

create or replace function public.cancel_invite(p_invitation uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  perform _require_profile(v_uid);
  update invitations set status = 'cancelled'
   where id = p_invitation and from_id = v_uid and status = 'pending';
  if not found then raise exception 'NOT_ALLOWED'; end if;
end $$;

create or replace function public.end_conversation(p_conversation uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_ok boolean;
begin
  perform _require_profile(v_uid);
  select true into v_ok from conversations
   where id = p_conversation and status = 'active' and v_uid in (user_a, user_b);
  if v_ok is null then raise exception 'CONVERSATION_ENDED'; end if;
  perform _end_conv(p_conversation, v_uid, 'ended');
end $$;

-- ═════════ 定時巡邏(由 003_cron.sql 每分鐘呼叫;前端不能呼叫) ═════════
create or replace function public.cleanup() returns void
language plpgsql security definer set search_path = public as $$
declare r record; c record;
begin
  update invitations set status = 'expired' where status = 'pending' and expires_at <= now();

  -- 有私聊、離線超過 30 分鐘:私聊結束,釋放代號
  for r in
    select p.user_id from profiles p
     where p.last_seen < now() - interval '30 minutes'
       and exists (select 1 from conversations x where x.status = 'active' and p.user_id in (x.user_a, x.user_b))
  loop
    for c in select id from conversations where status = 'active' and r.user_id in (user_a, user_b) loop
      perform _end_conv(c.id, null, 'timeout');
    end loop;
    update invitations set status = 'cancelled' where status = 'pending' and r.user_id in (from_id, to_id);
    delete from profiles where user_id = r.user_id;
  end loop;

  -- 沒有私聊、離線超過 2 分鐘:釋放代號
  for r in
    select p.user_id from profiles p
     where p.last_seen < now() - interval '2 minutes'
       and not exists (select 1 from conversations x where x.status = 'active' and p.user_id in (x.user_a, x.user_b))
  loop
    update invitations set status = 'cancelled' where status = 'pending' and r.user_id in (from_id, to_id);
    delete from profiles where user_id = r.user_id;
  end loop;

  delete from conversations where status = 'ended' and ended_at < now() - interval '10 minutes';
  delete from invitations where status <> 'pending' and created_at < now() - interval '5 minutes';
  delete from invite_cooldowns where until < now();
  delete from rate_events where at < now() - interval '5 minutes';
end $$;

-- ═════════ 誰能呼叫哪些函式 ═════════
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.enter(text, text), public.heartbeat(), public.set_lang(text), public.leave(),
  public.send_public(text, jsonb), public.send_private(uuid, text, jsonb), public.recall(text, uuid),
  public.invite(uuid), public.respond_invite(uuid, boolean), public.cancel_invite(uuid),
  public.end_conversation(uuid)
  to authenticated;
