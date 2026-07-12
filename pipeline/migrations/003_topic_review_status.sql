alter table topics
add column if not exists review_status text not null default 'proposed',
add column if not exists dismissed_at timestamptz,
add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'topics_review_status'
  ) then
    alter table topics
    add constraint topics_review_status
    check (review_status in ('proposed', 'accepted', 'edited', 'dismissed'));
  end if;
end $$;

create index if not exists topics_video_start_idx on topics(video_id, start_seconds);
create index if not exists topics_review_status_idx on topics(review_status);
