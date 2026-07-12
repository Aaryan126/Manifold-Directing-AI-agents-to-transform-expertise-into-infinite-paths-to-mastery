alter table questions
add column if not exists review_status text not null default 'proposed',
add column if not exists dismissed_at timestamptz,
add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'questions_review_status'
  ) then
    alter table questions
    add constraint questions_review_status
    check (review_status in ('proposed', 'accepted', 'edited', 'dismissed'));
  end if;
end $$;

create index if not exists questions_topic_review_status_idx
on questions(topic_id, review_status);
