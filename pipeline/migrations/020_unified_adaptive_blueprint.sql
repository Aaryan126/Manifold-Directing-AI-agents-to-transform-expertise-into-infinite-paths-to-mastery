alter table concepts add column sequence_rank integer;

with ranked as (
  select
    c.id,
    row_number() over (
      partition by c.revision_id
      order by min(t.start_seconds) nulls last, c.name, c.id
    ) - 1 as rank
  from concepts c
  left join topic_concepts tc on tc.concept_id = c.id
  left join topics t on t.id = tc.topic_id
  group by c.id, c.revision_id, c.name
)
update concepts c
set sequence_rank = ranked.rank
from ranked
where ranked.id = c.id;

alter table concepts alter column sequence_rank set not null;
alter table concepts alter column sequence_rank set default 0;
alter table concepts add constraint concepts_sequence_rank_non_negative
  check (sequence_rank >= 0);
create index concepts_revision_sequence_idx
  on concepts(revision_id, sequence_rank, name);

create table question_concepts (
  question_id uuid not null references questions(id) on delete cascade,
  concept_id uuid not null references concepts(id) on delete cascade,
  revision_id uuid not null references course_revisions(id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (question_id, concept_id)
);

create unique index question_concepts_one_primary_idx
  on question_concepts(question_id) where is_primary;
create index question_concepts_revision_concept_idx
  on question_concepts(revision_id, concept_id, question_id);

insert into question_concepts (question_id, concept_id, revision_id, is_primary)
select q.id, selected.concept_id, q.revision_id, true
from questions q
join lateral (
  select tc.concept_id
  from topic_concepts tc
  join concepts c on c.id = tc.concept_id
  where tc.topic_id = q.topic_id
    and tc.revision_id = q.revision_id
  order by c.sequence_rank, c.name, c.id
  limit 1
) selected on true;

create table learner_route_events (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  revision_id uuid not null references course_revisions(id) on delete cascade,
  learner_id uuid not null references users(id) on delete cascade,
  attempt_id uuid not null unique references attempts(id) on delete cascade,
  concept_id uuid references concepts(id) on delete set null,
  mastery_before mastery_state not null,
  mastery_after mastery_state not null,
  action text not null check (action in (
    'advance', 'reinforce', 'remediate', 'flag_instructor', 'complete'
  )),
  target_concept_id uuid references concepts(id) on delete set null,
  target_clip_id uuid references clips(id) on delete set null,
  why text not null,
  evidence_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index learner_route_events_course_created_idx
  on learner_route_events(course_id, created_at desc);
create index learner_route_events_learner_course_idx
  on learner_route_events(learner_id, course_id, created_at desc);
create index learner_route_events_concept_idx
  on learner_route_events(concept_id, created_at desc);
