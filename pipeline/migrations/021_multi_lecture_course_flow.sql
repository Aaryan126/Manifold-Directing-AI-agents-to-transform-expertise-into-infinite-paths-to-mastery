create table course_modules (
  id uuid primary key default gen_random_uuid(),
  logical_id uuid not null default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  revision_id uuid not null references course_revisions(id) on delete cascade,
  title text not null,
  summary text not null default '',
  sequence_rank integer not null default 0 check (sequence_rank >= 0),
  review_status text not null default 'accepted' check (
    review_status in ('proposed', 'accepted', 'edited', 'dismissed')
  ),
  ai_proposal jsonb,
  instructor_revision jsonb,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (revision_id, logical_id)
);

create index course_modules_revision_sequence_idx
  on course_modules(revision_id, sequence_rank, title);

create table course_units (
  id uuid primary key default gen_random_uuid(),
  logical_id uuid not null default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  revision_id uuid not null references course_revisions(id) on delete cascade,
  module_id uuid references course_modules(id) on delete set null,
  kind text not null check (kind in ('lecture', 'quiz', 'assignment')),
  title text not null,
  summary text not null default '',
  instructions text not null default '',
  video_id uuid references videos(id) on delete restrict,
  sequence_rank integer not null default 0 check (sequence_rank >= 0),
  review_status text not null default 'accepted' check (
    review_status in ('proposed', 'accepted', 'edited', 'dismissed')
  ),
  ai_proposal jsonb,
  instructor_revision jsonb,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (revision_id, logical_id),
  constraint course_units_lecture_video check (
    (kind = 'lecture' and video_id is not null)
    or (kind <> 'lecture' and video_id is null)
  )
);

create unique index course_units_revision_video_idx
  on course_units(revision_id, video_id) where video_id is not null;
create index course_units_revision_sequence_idx
  on course_units(revision_id, sequence_rank, title);
create index course_units_module_sequence_idx
  on course_units(module_id, sequence_rank, title);

create table course_unit_edges (
  id uuid primary key default gen_random_uuid(),
  logical_id uuid not null default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  revision_id uuid not null references course_revisions(id) on delete cascade,
  source_unit_id uuid not null references course_units(id) on delete cascade,
  target_unit_id uuid not null references course_units(id) on delete cascade,
  relationship text not null check (relationship in ('next', 'requires', 'assesses')),
  review_status text not null default 'accepted' check (
    review_status in ('proposed', 'accepted', 'edited', 'dismissed')
  ),
  ai_proposal jsonb,
  instructor_revision jsonb,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (revision_id, logical_id),
  unique (revision_id, source_unit_id, target_unit_id, relationship),
  constraint course_unit_edges_no_self_loop check (source_unit_id <> target_unit_id)
);

create index course_unit_edges_revision_source_idx
  on course_unit_edges(revision_id, source_unit_id);
create index course_unit_edges_revision_target_idx
  on course_unit_edges(revision_id, target_unit_id);

create table course_unit_concepts (
  unit_id uuid not null references course_units(id) on delete cascade,
  concept_id uuid not null references concepts(id) on delete cascade,
  revision_id uuid not null references course_revisions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (unit_id, concept_id)
);

create index course_unit_concepts_revision_concept_idx
  on course_unit_concepts(revision_id, concept_id, unit_id);

create table course_unit_sources (
  unit_id uuid not null references course_units(id) on delete cascade,
  source_id uuid not null references course_sources(id) on delete cascade,
  revision_id uuid not null references course_revisions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (unit_id, source_id)
);

create table course_flow_layouts (
  revision_id uuid not null references course_revisions(id) on delete cascade,
  logical_artifact_id uuid not null,
  x double precision not null,
  y double precision not null,
  updated_at timestamptz not null default now(),
  primary key (revision_id, logical_artifact_id)
);

create table learner_unit_progress (
  learner_id uuid not null references users(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  revision_id uuid not null references course_revisions(id) on delete cascade,
  unit_id uuid not null references course_units(id) on delete cascade,
  status text not null default 'not_started' check (
    status in ('not_started', 'in_progress', 'completed')
  ),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (learner_id, unit_id)
);

create index learner_unit_progress_course_learner_idx
  on learner_unit_progress(course_id, learner_id, updated_at desc);

alter table questions alter column topic_id drop not null;
alter table questions
  add column course_unit_id uuid references course_units(id) on delete cascade;
alter table questions add constraint questions_exactly_one_owner check (
  (topic_id is not null and course_unit_id is null)
  or (topic_id is null and course_unit_id is not null)
);
create index questions_course_unit_idx
  on questions(course_unit_id) where course_unit_id is not null;

create function assign_question_owner_revision() returns trigger as $$
begin
  if new.revision_id is null then
    if new.topic_id is not null then
      select t.revision_id into new.revision_id from topics t where t.id = new.topic_id;
    else
      select u.revision_id into new.revision_id from course_units u
      where u.id = new.course_unit_id;
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger questions_assign_revision on questions;
create trigger questions_assign_revision before insert on questions
  for each row execute function assign_question_owner_revision();

insert into course_units (
  logical_id, course_id, revision_id, kind, title, summary, video_id,
  sequence_rank, review_status
)
select
  grouped.video_id,
  grouped.course_id,
  grouped.revision_id,
  'lecture',
  coalesce(
    nullif(grouped.source_title, ''),
    nullif(grouped.topic_title, ''),
    'Lecture ' || (grouped.sequence_rank + 1)::text
  ),
  '',
  grouped.video_id,
  grouped.sequence_rank,
  'accepted'
from (
  select
    t.course_id,
    t.revision_id,
    t.video_id,
    min(t.title) as topic_title,
    min(coalesce(v.source_metadata->>'title', v.source_metadata->>'filename')) as source_title,
    dense_rank() over (
      partition by t.revision_id order by min(v.created_at), t.video_id
    ) - 1 as sequence_rank
  from topics t
  join videos v on v.id = t.video_id
  group by t.course_id, t.revision_id, t.video_id
) grouped
on conflict (revision_id, video_id) where video_id is not null do nothing;

insert into course_unit_concepts (unit_id, concept_id, revision_id)
select distinct u.id, tc.concept_id, u.revision_id
from course_units u
join topics t
  on t.revision_id = u.revision_id
 and t.video_id = u.video_id
join topic_concepts tc
  on tc.revision_id = t.revision_id
 and tc.topic_id = t.id
on conflict do nothing;

insert into course_unit_edges (
  course_id, revision_id, source_unit_id, target_unit_id,
  relationship, review_status
)
select
  ordered.course_id,
  ordered.revision_id,
  ordered.id,
  ordered.next_id,
  'next',
  'accepted'
from (
  select
    u.*,
    lead(u.id) over (
      partition by u.revision_id order by u.sequence_rank, u.id
    ) as next_id
  from course_units u
  where u.kind = 'lecture'
    and u.review_status <> 'dismissed'
) ordered
where ordered.next_id is not null
on conflict do nothing;
