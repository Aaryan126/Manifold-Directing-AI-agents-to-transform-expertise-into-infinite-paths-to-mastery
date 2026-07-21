create table course_sources (
  id uuid primary key default gen_random_uuid(),
  logical_id uuid not null default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  filename text not null,
  source_type text not null check (source_type in (
    'lecture_video', 'lecture_audio', 'pdf', 'pptx'
  )),
  mime_type text not null,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  checksum_sha256 text,
  storage_uri text not null,
  extraction_status text not null default 'queued' check (extraction_status in (
    'queued', 'processing', 'ready', 'failed'
  )),
  extraction_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, logical_id)
);

create index course_sources_course_created_idx
  on course_sources(course_id, created_at desc);
create index course_sources_status_idx
  on course_sources(extraction_status, updated_at);

create table course_revision_sources (
  revision_id uuid not null references course_revisions(id) on delete cascade,
  source_id uuid not null references course_sources(id) on delete cascade,
  purpose text not null default 'ai_context' check (purpose in (
    'ai_context', 'learner_resource', 'both'
  )),
  review_status text not null default 'accepted' check (review_status in (
    'proposed', 'accepted', 'edited', 'dismissed'
  )),
  learner_visible boolean not null default false,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (revision_id, source_id),
  constraint revision_source_visibility_reviewed check (
    not learner_visible or (
      purpose in ('learner_resource', 'both')
      and review_status in ('accepted', 'edited')
      and removed_at is null
    )
  )
);

create index course_revision_sources_source_idx
  on course_revision_sources(source_id, revision_id);

create table source_sections (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references course_sources(id) on delete cascade,
  section_index integer not null check (section_index >= 0),
  page_number integer not null check (page_number >= 1),
  title text,
  native_text text not null default '',
  speaker_notes text not null default '',
  visual_summary text not null default '',
  search_document tsvector generated always as (
    to_tsvector(
      'english',
      coalesce(title, '') || ' ' || native_text || ' ' || speaker_notes || ' ' || visual_summary
    )
  ) stored,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_id, section_index)
);

create index source_sections_search_idx on source_sections using gin(search_document);
create index source_sections_source_page_idx on source_sections(source_id, page_number);

create table source_citations (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references course_revisions(id) on delete cascade,
  source_section_id uuid not null references source_sections(id) on delete cascade,
  artifact_type text,
  logical_artifact_id uuid,
  proposal_id uuid references course_proposals(id) on delete cascade,
  excerpt text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint citation_has_target check (
    proposal_id is not null or (artifact_type is not null and logical_artifact_id is not null)
  )
);

create index source_citations_revision_idx on source_citations(revision_id, created_at desc);
create index source_citations_artifact_idx
  on source_citations(revision_id, artifact_type, logical_artifact_id);

create table course_agent_tasks (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references courses(id) on delete cascade,
  revision_id uuid not null references course_revisions(id) on delete cascade,
  specialist_role text not null check (specialist_role in (
    'learning_analyst', 'curriculum_architect', 'clip_editor', 'assessment_designer'
  )),
  task_type text not null,
  target_artifact_type text,
  target_logical_artifact_id uuid,
  request_context jsonb not null default '{}'::jsonb,
  evidence_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in (
    'queued', 'running', 'waiting_review', 'complete', 'failed', 'cancelled'
  )),
  result jsonb,
  proposal_ids uuid[] not null default '{}',
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  next_attempt_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index course_agent_tasks_claim_idx
  on course_agent_tasks(status, next_attempt_at, lease_expires_at);
create index course_agent_tasks_course_created_idx
  on course_agent_tasks(course_id, created_at desc);

create table course_map_layouts (
  revision_id uuid not null references course_revisions(id) on delete cascade,
  logical_artifact_id uuid not null,
  x numeric(12, 3) not null,
  y numeric(12, 3) not null,
  updated_at timestamptz not null default now(),
  primary key (revision_id, logical_artifact_id)
);

-- Existing lectures become private generation context without changing the
-- learner-facing clip model or the initial-lecture admission rule.
insert into course_sources (
  logical_id, course_id, filename, source_type, mime_type, size_bytes,
  storage_uri, extraction_status, metadata
)
select
  v.id,
  v.course_id,
  coalesce(nullif(v.source_metadata ->> 'filename', ''), 'Lecture source'),
  case when coalesce(v.source_metadata ->> 'content_type', '') like 'audio/%'
       then 'lecture_audio' else 'lecture_video' end,
  coalesce(nullif(v.source_metadata ->> 'content_type', ''), 'video/mp4'),
  0,
  v.source_uri,
  case when v.transcript is null then 'processing' else 'ready' end,
  jsonb_build_object('video_id', v.id, 'backfilled', true)
from videos v
on conflict (course_id, logical_id) do nothing;

insert into course_revision_sources (
  revision_id, source_id, purpose, review_status, learner_visible
)
select r.id, s.id, 'ai_context', 'accepted', false
from course_revisions r
join course_sources s on s.course_id = r.course_id
where s.source_type in ('lecture_video', 'lecture_audio')
on conflict (revision_id, source_id) do nothing;
