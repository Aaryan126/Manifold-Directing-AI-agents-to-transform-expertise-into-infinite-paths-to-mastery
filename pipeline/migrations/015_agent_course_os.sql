create type course_revision_status as enum (
  'building',
  'review',
  'published',
  'superseded'
);

create type generation_run_status as enum (
  'queued',
  'running',
  'waiting_review',
  'complete',
  'failed',
  'cancelled'
);

create type generation_task_status as enum (
  'queued',
  'running',
  'complete',
  'failed',
  'cancelled'
);

create type review_bundle_status as enum ('pending', 'in_review', 'complete');
create type review_item_status as enum ('pending', 'accepted', 'edited', 'dismissed');
create type course_proposal_status as enum ('proposed', 'accepted', 'edited', 'dismissed');

create table course_revisions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  parent_revision_id uuid references course_revisions(id) on delete set null,
  revision_number integer not null,
  status course_revision_status not null default 'building',
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  unique (course_id, revision_number)
);

create unique index course_revisions_one_working_idx
  on course_revisions(course_id)
  where status in ('building', 'review');

alter table courses
  add column brief jsonb not null default '{}'::jsonb,
  add column active_revision_id uuid references course_revisions(id) on delete set null,
  add column working_revision_id uuid references course_revisions(id) on delete set null;

insert into course_revisions (
  course_id,
  revision_number,
  status,
  created_by,
  published_at
)
select
  c.id,
  1,
  case when c.status = 'published' then 'published'::course_revision_status
       else 'review'::course_revision_status end,
  c.instructor_id,
  c.published_at
from courses c;

update courses c
set active_revision_id = case when c.status = 'published' then r.id else null end,
    working_revision_id = case when c.status = 'draft' then r.id else null end
from course_revisions r
where r.course_id = c.id and r.revision_number = 1;

alter table topics add column revision_id uuid references course_revisions(id) on delete cascade;
alter table topics add column logical_id uuid default gen_random_uuid();
update topics t set revision_id = r.id, logical_id = t.id
from course_revisions r where r.course_id = t.course_id and r.revision_number = 1;
alter table topics alter column logical_id set not null;
create unique index topics_revision_logical_idx on topics(revision_id, logical_id);

alter table concepts add column revision_id uuid references course_revisions(id) on delete cascade;
alter table concepts add column logical_id uuid default gen_random_uuid();
update concepts c set revision_id = r.id, logical_id = c.id
from course_revisions r where r.course_id = c.course_id and r.revision_number = 1;
alter table concepts alter column logical_id set not null;
create unique index concepts_revision_logical_idx on concepts(revision_id, logical_id);

alter table concept_edges add column revision_id uuid references course_revisions(id) on delete cascade;
alter table concept_edges add column logical_id uuid default gen_random_uuid();
update concept_edges e set revision_id = c.revision_id, logical_id = e.id
from concepts c where c.id = e.from_concept_id;
alter table concept_edges alter column logical_id set not null;
create unique index concept_edges_revision_logical_idx on concept_edges(revision_id, logical_id);

alter table clips add column revision_id uuid references course_revisions(id) on delete cascade;
alter table clips add column logical_id uuid default gen_random_uuid();
update clips c set revision_id = t.revision_id, logical_id = c.id
from topics t where t.id = c.topic_id;
alter table clips alter column logical_id set not null;
create unique index clips_revision_logical_idx on clips(revision_id, logical_id);

alter table questions add column revision_id uuid references course_revisions(id) on delete cascade;
alter table questions add column logical_id uuid default gen_random_uuid();
update questions q set revision_id = t.revision_id, logical_id = q.id
from topics t where t.id = q.topic_id;
alter table questions alter column logical_id set not null;
create unique index questions_revision_logical_idx on questions(revision_id, logical_id);

alter table remediation_rules
  add column revision_id uuid references course_revisions(id) on delete cascade;
alter table remediation_rules add column logical_id uuid default gen_random_uuid();
update remediation_rules rr set revision_id = q.revision_id, logical_id = rr.id
from questions q where q.id = rr.question_id;
alter table remediation_rules alter column logical_id set not null;
create unique index remediation_rules_revision_logical_idx
  on remediation_rules(revision_id, logical_id);

alter table routing_policies
  add column revision_id uuid references course_revisions(id) on delete cascade;
alter table routing_policies add column logical_id uuid default gen_random_uuid();
update routing_policies rp set revision_id = r.id, logical_id = rp.id
from course_revisions r where r.course_id = rp.course_id and r.revision_number = 1;
alter table routing_policies alter column logical_id set not null;
create unique index routing_policies_revision_logical_idx
  on routing_policies(revision_id, logical_id);

alter table topic_concepts
  add column revision_id uuid references course_revisions(id) on delete cascade;
update topic_concepts tc set revision_id = t.revision_id
from topics t where t.id = tc.topic_id;
create index topic_concepts_revision_idx on topic_concepts(revision_id);

alter table clip_concepts
  add column revision_id uuid references course_revisions(id) on delete cascade;
update clip_concepts cc set revision_id = c.revision_id
from clips c where c.id = cc.clip_id;
create index clip_concepts_revision_idx on clip_concepts(revision_id);

alter table enrollments
  add column revision_id uuid references course_revisions(id) on delete restrict;
update enrollments e set revision_id = coalesce(c.active_revision_id, c.working_revision_id)
from courses c where c.id = e.course_id;
create index enrollments_revision_idx on enrollments(revision_id);

-- Keep the established repositories and rollback UI compatible while revision-aware
-- application services are introduced. New rows inherit the course's working revision
-- (or its active revision when no edit is in progress) at the database boundary.
create function assign_course_working_revision() returns trigger as $$
begin
  if new.revision_id is null then
    select coalesce(c.working_revision_id, c.active_revision_id)
    into new.revision_id
    from courses c
    where c.id = new.course_id;
  end if;
  return new;
end;
$$ language plpgsql;

create function assign_concept_edge_revision() returns trigger as $$
begin
  if new.revision_id is null then
    select c.revision_id into new.revision_id
    from concepts c where c.id = new.from_concept_id;
  end if;
  return new;
end;
$$ language plpgsql;

create function assign_topic_artifact_revision() returns trigger as $$
begin
  if new.revision_id is null then
    select t.revision_id into new.revision_id
    from topics t where t.id = new.topic_id;
  end if;
  return new;
end;
$$ language plpgsql;

create function assign_question_artifact_revision() returns trigger as $$
begin
  if new.revision_id is null then
    select q.revision_id into new.revision_id
    from questions q where q.id = new.question_id;
  end if;
  return new;
end;
$$ language plpgsql;

create function assign_clip_artifact_revision() returns trigger as $$
begin
  if new.revision_id is null then
    select c.revision_id into new.revision_id
    from clips c where c.id = new.clip_id;
  end if;
  return new;
end;
$$ language plpgsql;

create function assign_enrollment_revision() returns trigger as $$
begin
  if new.revision_id is null then
    select coalesce(c.active_revision_id, c.working_revision_id)
    into new.revision_id
    from courses c
    where c.id = new.course_id;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger topics_assign_revision before insert on topics
  for each row execute function assign_course_working_revision();
create trigger concepts_assign_revision before insert on concepts
  for each row execute function assign_course_working_revision();
create trigger routing_policies_assign_revision before insert on routing_policies
  for each row execute function assign_course_working_revision();
create trigger concept_edges_assign_revision before insert on concept_edges
  for each row execute function assign_concept_edge_revision();
create trigger clips_assign_revision before insert on clips
  for each row execute function assign_topic_artifact_revision();
create trigger questions_assign_revision before insert on questions
  for each row execute function assign_topic_artifact_revision();
create trigger remediation_rules_assign_revision before insert on remediation_rules
  for each row execute function assign_question_artifact_revision();
create trigger topic_concepts_assign_revision before insert on topic_concepts
  for each row execute function assign_topic_artifact_revision();
create trigger clip_concepts_assign_revision before insert on clip_concepts
  for each row execute function assign_clip_artifact_revision();
create trigger enrollments_assign_revision before insert on enrollments
  for each row execute function assign_enrollment_revision();

alter table topics alter column revision_id set not null;
alter table concepts alter column revision_id set not null;
alter table concept_edges alter column revision_id set not null;
alter table clips alter column revision_id set not null;
alter table questions alter column revision_id set not null;
alter table remediation_rules alter column revision_id set not null;
alter table routing_policies alter column revision_id set not null;
alter table topic_concepts alter column revision_id set not null;
alter table clip_concepts alter column revision_id set not null;
alter table enrollments alter column revision_id set not null;

create table generation_runs (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  revision_id uuid not null references course_revisions(id) on delete cascade,
  created_by uuid references users(id) on delete set null,
  status generation_run_status not null default 'queued',
  phase text not null default 'source',
  progress numeric(5, 2) not null default 0,
  brief jsonb not null default '{}'::jsonb,
  error_summary text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index generation_runs_course_created_idx
  on generation_runs(course_id, created_at desc);
create index generation_runs_status_idx on generation_runs(status, updated_at);

create table generation_tasks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references generation_runs(id) on delete cascade,
  task_type text not null,
  scope_key text not null default 'course',
  status generation_task_status not null default 'queued',
  depends_on uuid[] not null default '{}',
  idempotency_key text not null unique,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  next_attempt_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (run_id, task_type, scope_key)
);

create index generation_tasks_claim_idx
  on generation_tasks(status, next_attempt_at, lease_expires_at);
create index generation_tasks_run_idx on generation_tasks(run_id, created_at);

create table review_bundles (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  revision_id uuid not null references course_revisions(id) on delete cascade,
  kind text not null check (kind in ('course_structure', 'learner_experience', 'publish_setup')),
  title text not null,
  summary text not null,
  status review_bundle_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (revision_id, kind)
);

create table review_items (
  id uuid primary key default gen_random_uuid(),
  bundle_id uuid not null references review_bundles(id) on delete cascade,
  artifact_type text not null,
  artifact_id uuid not null,
  logical_artifact_id uuid not null,
  status review_item_status not null default 'pending',
  risk_level text not null default 'normal' check (risk_level in ('normal', 'high')),
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bundle_id, artifact_type, artifact_id)
);

create index review_items_bundle_status_idx on review_items(bundle_id, status);

create table course_conversations (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  revision_id uuid not null references course_revisions(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, revision_id)
);

create table course_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references course_conversations(id) on delete cascade,
  role text not null check (role in ('instructor', 'manifold', 'system')),
  content text not null,
  blocks jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index course_messages_conversation_created_idx
  on course_messages(conversation_id, created_at);

create table course_proposals (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  revision_id uuid not null references course_revisions(id) on delete cascade,
  message_id uuid references course_messages(id) on delete set null,
  proposal_type text not null,
  artifact_type text,
  logical_artifact_id uuid,
  before_state jsonb,
  proposed_state jsonb not null,
  rationale text not null,
  status course_proposal_status not null default 'proposed',
  instructor_revision jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index course_proposals_course_status_idx
  on course_proposals(course_id, status, created_at desc);

alter table audit_events add column revision_id uuid references course_revisions(id) on delete set null;
alter table audit_events add column generation_run_id uuid references generation_runs(id) on delete set null;
alter table audit_events add column course_proposal_id uuid references course_proposals(id) on delete set null;
