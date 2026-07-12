create extension if not exists pgcrypto;

create type user_role as enum ('instructor', 'learner');
create type clip_type as enum (
  'definition',
  'worked_example',
  'explanation',
  'misconception_correction',
  'prerequisite_recap'
);
create type question_type as enum ('mcq', 'short_answer', 'worked_problem');
create type mastery_state as enum ('not_started', 'struggling', 'practiced', 'mastered');
create type dashboard_signal_type as enum (
  'stuck_cohort',
  'underperforming_content',
  'graph_drift'
);
create type dashboard_signal_status as enum ('open', 'accepted', 'edited', 'dismissed');

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  role user_role not null,
  created_at timestamptz not null default now()
);

create table courses (
  id uuid primary key default gen_random_uuid(),
  instructor_id uuid not null references users(id),
  title text not null,
  description text,
  created_at timestamptz not null default now()
);

create table videos (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  source_kind text not null,
  source_uri text not null,
  playback_provider text,
  playback_id text,
  duration_seconds numeric(12, 3),
  transcript jsonb,
  source_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table topics (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  video_id uuid not null references videos(id) on delete cascade,
  title text not null,
  summary text,
  start_seconds numeric(12, 3) not null,
  end_seconds numeric(12, 3) not null,
  ai_proposal jsonb,
  instructor_revision jsonb,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint topics_positive_range check (end_seconds > start_seconds)
);

create table concepts (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  name text not null,
  description text,
  ai_proposal jsonb,
  instructor_revision jsonb,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (course_id, name)
);

create table concept_edges (
  id uuid primary key default gen_random_uuid(),
  from_concept_id uuid not null references concepts(id) on delete cascade,
  to_concept_id uuid not null references concepts(id) on delete cascade,
  relationship text not null default 'requires',
  ai_proposal jsonb,
  instructor_revision jsonb,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint concept_edges_requires check (relationship = 'requires'),
  constraint concept_edges_no_self_loop check (from_concept_id <> to_concept_id),
  unique (from_concept_id, to_concept_id, relationship)
);

create index concept_edges_from_idx on concept_edges(from_concept_id);
create index concept_edges_to_idx on concept_edges(to_concept_id);

create table topic_concepts (
  topic_id uuid not null references topics(id) on delete cascade,
  concept_id uuid not null references concepts(id) on delete cascade,
  primary key (topic_id, concept_id)
);

create table clips (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references topics(id) on delete cascade,
  start_seconds numeric(12, 3) not null,
  end_seconds numeric(12, 3) not null,
  type clip_type not null,
  difficulty text,
  playback_provider text,
  playback_id text,
  ai_proposal jsonb,
  instructor_revision jsonb,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint clips_positive_range check (end_seconds > start_seconds)
);

create table clip_concepts (
  clip_id uuid not null references clips(id) on delete cascade,
  concept_id uuid not null references concepts(id) on delete cascade,
  primary key (clip_id, concept_id)
);

create table questions (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references topics(id) on delete cascade,
  body text not null,
  type question_type not null,
  correct_answer jsonb not null,
  confidence_prompt text not null,
  ai_proposal jsonb,
  instructor_revision jsonb,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table remediation_rules (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions(id) on delete cascade,
  wrong_answer_pattern text not null,
  target_clip_id uuid references clips(id),
  target_concept_id uuid references concepts(id),
  ai_proposal jsonb,
  instructor_revision jsonb,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint remediation_target_present check (
    target_clip_id is not null or target_concept_id is not null
  )
);

create table enrollments (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references users(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (learner_id, course_id)
);

create table learner_concept_mastery (
  learner_id uuid not null references users(id) on delete cascade,
  concept_id uuid not null references concepts(id) on delete cascade,
  state mastery_state not null default 'not_started',
  updated_at timestamptz not null default now(),
  primary key (learner_id, concept_id)
);

create table attempts (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references users(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  answer jsonb not null,
  correctness boolean not null,
  confidence smallint not null,
  created_at timestamptz not null default now(),
  constraint attempts_confidence_range check (confidence between 1 and 4)
);

create table dashboard_signals (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  type dashboard_signal_type not null,
  related_entity_type text not null,
  related_entity_id uuid not null,
  ai_diagnosis jsonb not null,
  status dashboard_signal_status not null default 'open',
  instructor_action jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table routing_policies (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  concept_id uuid references concepts(id) on delete cascade,
  policy jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, concept_id)
);
