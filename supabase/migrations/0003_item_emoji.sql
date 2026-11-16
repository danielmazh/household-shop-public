-- A picture per product, chosen by the AI or the user (2026-11-03).
-- Null keeps the old rule: the app picks the emoji from the name.

alter table public.items add column if not exists emoji text;

alter table public.items
  drop constraint if exists items_emoji_check,
  add constraint items_emoji_check check (emoji is null or char_length(emoji) between 1 and 16);

grant insert (emoji) on table public.items to authenticated;
grant update (emoji) on table public.items to authenticated;
