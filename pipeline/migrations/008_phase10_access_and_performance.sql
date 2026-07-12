create type course_publish_status as enum ('draft', 'published');

alter table users
  add column display_name text;

alter table courses
  add column status course_publish_status not null default 'draft',
  add column published_at timestamptz,
  add column updated_at timestamptz not null default now();

create table learner_watch_events (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references users(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  video_id uuid not null references videos(id) on delete cascade,
  clip_id uuid references clips(id) on delete set null,
  path_mode text not null,
  watched_seconds numeric(12, 3) not null,
  occurred_at timestamptz not null default now(),
  constraint learner_watch_events_nonnegative check (watched_seconds >= 0),
  constraint learner_watch_events_path_mode check (path_mode in ('adaptive', 'linear'))
);

create index enrollments_course_learner_idx on enrollments(course_id, learner_id);
create index attempts_question_created_idx on attempts(question_id, created_at);
create index attempts_learner_created_idx on attempts(learner_id, created_at);
create index learner_mastery_concept_state_idx
  on learner_concept_mastery(concept_id, state);
create index dashboard_signals_course_status_idx
  on dashboard_signals(course_id, status, created_at);
create index learner_watch_events_course_mode_idx
  on learner_watch_events(course_id, path_mode, occurred_at);
create index learner_watch_events_learner_idx
  on learner_watch_events(learner_id, occurred_at);
