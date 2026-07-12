alter table concepts
add column if not exists review_status text not null default 'proposed',
add column if not exists dismissed_at timestamptz,
add column if not exists updated_at timestamptz not null default now(),
add column if not exists merged_into_concept_id uuid references concepts(id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'concepts_review_status'
  ) then
    alter table concepts
    add constraint concepts_review_status
    check (review_status in ('proposed', 'accepted', 'edited', 'dismissed'));
  end if;
end $$;

alter table concept_edges
add column if not exists review_status text not null default 'proposed',
add column if not exists dismissed_at timestamptz,
add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'concept_edges_review_status'
  ) then
    alter table concept_edges
    add constraint concept_edges_review_status
    check (review_status in ('proposed', 'accepted', 'edited', 'dismissed'));
  end if;
end $$;

create index if not exists concepts_course_review_status_idx
on concepts(course_id, review_status);

create index if not exists concept_edges_review_status_idx
on concept_edges(review_status);
