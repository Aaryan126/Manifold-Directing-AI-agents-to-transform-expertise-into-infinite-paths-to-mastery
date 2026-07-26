create table learner_guide_messages (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references users(id) on delete cascade,
  course_id uuid not null references courses(id) on delete cascade,
  revision_id uuid not null references course_revisions(id) on delete cascade,
  role text not null check (role in ('learner', 'guide')),
  content text not null check (length(btrim(content)) between 1 and 4000),
  intent text,
  action text,
  evidence_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index learner_guide_messages_conversation_idx
  on learner_guide_messages(
    learner_id,
    course_id,
    revision_id,
    created_at,
    id
  );
