create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  actor_type text not null default 'system',
  actor_id uuid references users(id),
  artifact_type text not null,
  artifact_id uuid not null,
  action text not null,
  source text not null,
  previous_state jsonb,
  new_state jsonb,
  ai_rationale text,
  instructor_note text,
  dashboard_signal_id uuid references dashboard_signals(id) on delete set null,
  scope text not null default 'artifact',
  created_at timestamptz not null default now()
);

create index if not exists audit_events_artifact_idx
  on audit_events (artifact_type, artifact_id, created_at);

create index if not exists audit_events_course_idx
  on audit_events (course_id, created_at);
