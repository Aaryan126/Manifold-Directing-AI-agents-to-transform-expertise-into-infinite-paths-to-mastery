alter table clips
add column if not exists status text not null default 'active',
add column if not exists flagged_at timestamptz,
add column if not exists flag_note text,
add column if not exists superseded_by_clip_id uuid references clips(id),
add column if not exists source_clip_id uuid references clips(id),
add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'clips_status'
  ) then
    alter table clips
    add constraint clips_status
    check (status in ('active', 'flagged', 'superseded'));
  end if;
end $$;

create index if not exists clips_topic_status_idx on clips(topic_id, status);
create index if not exists clips_source_clip_idx on clips(source_clip_id);
