create table question_hint_ladders (
  id uuid primary key default gen_random_uuid(),
  logical_id uuid not null default gen_random_uuid(),
  question_id uuid not null references questions(id) on delete cascade,
  revision_id uuid not null references course_revisions(id) on delete cascade,
  hints jsonb not null default '[]'::jsonb,
  review_status text not null default 'proposed' check (
    review_status in ('proposed', 'accepted', 'edited', 'dismissed')
  ),
  ai_proposal jsonb,
  instructor_revision jsonb,
  approved_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (revision_id, logical_id),
  unique (question_id),
  constraint question_hint_ladders_array check (jsonb_typeof(hints) = 'array')
);

create index question_hint_ladders_revision_status_idx
  on question_hint_ladders(revision_id, review_status, question_id);

create table learner_course_preferences (
  learner_id uuid not null references users(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  revision_id uuid not null references course_revisions(id) on delete cascade,
  orientation_status text not null default 'not_started' check (
    orientation_status in ('not_started', 'completed')
  ),
  entry_choice text check (
    entry_choice in ('recommended', 'placement', 'foundations')
  ),
  default_time_budget_minutes smallint,
  immediate_goal text,
  orientation_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (learner_id, course_id, revision_id),
  constraint learner_course_preferences_budget check (
    default_time_budget_minutes is null
    or default_time_budget_minutes between 5 and 120
  )
);

create table learner_placement_checks (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references users(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  revision_id uuid not null references course_revisions(id) on delete cascade,
  status text not null default 'in_progress' check (
    status in ('in_progress', 'completed', 'unavailable')
  ),
  idempotency_key text not null,
  policy_snapshot jsonb not null default '{}'::jsonb,
  unavailable_reason text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (learner_id, course_id, revision_id),
  unique (learner_id, course_id, revision_id, idempotency_key)
);

create table learner_placement_items (
  id uuid primary key default gen_random_uuid(),
  placement_check_id uuid not null references learner_placement_checks(id) on delete cascade,
  ordinal integer not null check (ordinal >= 0),
  concept_id uuid not null references concepts(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  status text not null default 'pending' check (
    status in ('pending', 'answered', 'skipped')
  ),
  outcome text check (outcome in ('mastered', 'practiced', 'retained')),
  attempt_id uuid references attempts(id) on delete set null,
  answered_at timestamptz,
  unique (placement_check_id, ordinal),
  unique (placement_check_id, question_id)
);

create table learner_study_sessions (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references users(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  revision_id uuid not null references course_revisions(id) on delete cascade,
  status text not null default 'planned' check (
    status in ('planned', 'active', 'reflecting', 'completed', 'superseded')
  ),
  goal text not null check (
    goal in ('continue', 'review', 'get_unstuck', 'custom')
  ),
  goal_note text,
  budget_minutes smallint not null check (budget_minutes between 5 and 120),
  idempotency_key text not null,
  plan_version integer not null default 1 check (plan_version >= 1),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (learner_id, course_id, revision_id, idempotency_key)
);

create unique index learner_study_sessions_one_open_idx
  on learner_study_sessions(learner_id, course_id, revision_id)
  where status in ('planned', 'active', 'reflecting');

create index learner_study_sessions_resume_idx
  on learner_study_sessions(learner_id, course_id, revision_id, updated_at desc);

alter table attempts
  add column purpose text not null default 'lesson' check (
    purpose in ('lesson', 'placement', 'review')
  ),
  add column study_session_id uuid references learner_study_sessions(id) on delete set null;

create index attempts_session_created_idx
  on attempts(study_session_id, created_at) where study_session_id is not null;

create table learner_session_steps (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references learner_study_sessions(id) on delete cascade,
  plan_version integer not null check (plan_version >= 1),
  ordinal integer not null check (ordinal >= 0),
  kind text not null check (kind in ('watch', 'question', 'resource', 'reflect')),
  purpose text not null check (
    purpose in ('foundation', 'learn', 'practice', 'reinforcement', 'remediation', 'review', 'reflect')
  ),
  concept_id uuid references concepts(id) on delete set null,
  clip_id uuid references clips(id) on delete set null,
  question_id uuid references questions(id) on delete set null,
  source_id uuid references course_sources(id) on delete set null,
  estimated_minutes smallint not null check (estimated_minutes between 1 and 120),
  reason_code text not null,
  evidence_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (
    status in ('pending', 'active', 'completed', 'skipped', 'replaced', 'unavailable')
  ),
  hint_level smallint not null default 0 check (hint_level >= 0),
  attempt_id uuid references attempts(id) on delete set null,
  route_event_id uuid references learner_route_events(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (session_id, plan_version, ordinal)
);

create index learner_session_steps_session_status_idx
  on learner_session_steps(session_id, plan_version, status, ordinal);

create table learner_reflections (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references learner_study_sessions(id) on delete cascade,
  learner_id uuid not null references users(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  revision_id uuid not null references course_revisions(id) on delete cascade,
  concept_id uuid references concepts(id) on delete set null,
  self_report text not null check (
    self_report in ('can_explain', 'with_example', 'still_unsure')
  ),
  note text,
  created_at timestamptz not null default now()
);

create table learner_review_schedules (
  learner_id uuid not null references users(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  revision_id uuid not null references course_revisions(id) on delete cascade,
  concept_id uuid not null references concepts(id) on delete cascade,
  stage smallint not null default 0 check (stage between 0 and 2),
  interval_days smallint not null check (interval_days between 1 and 60),
  due_at timestamptz not null,
  last_attempt_id uuid references attempts(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (learner_id, revision_id, concept_id)
);

create index learner_review_schedules_due_idx
  on learner_review_schedules(learner_id, course_id, revision_id, due_at);

create table learner_help_requests (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references users(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  revision_id uuid not null references course_revisions(id) on delete cascade,
  session_id uuid references learner_study_sessions(id) on delete set null,
  concept_id uuid references concepts(id) on delete set null,
  topic_id uuid references topics(id) on delete set null,
  learner_note text,
  evidence_snapshot jsonb not null,
  status text not null default 'open' check (
    status in ('open', 'acknowledged', 'resolved')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index learner_help_requests_course_status_idx
  on learner_help_requests(course_id, status, created_at desc);
create index learner_help_requests_learner_idx
  on learner_help_requests(learner_id, course_id, created_at desc);

alter table learner_route_events drop constraint learner_route_events_action_check;
alter table learner_route_events add constraint learner_route_events_action_check check (
  action in (
    'advance', 'reinforce', 'remediate', 'flag_instructor', 'complete',
    'content_unavailable', 'placement_skip', 'placement_retain'
  )
);
