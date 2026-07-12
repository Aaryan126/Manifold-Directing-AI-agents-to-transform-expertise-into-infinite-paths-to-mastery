create type ingestion_job_status as enum ('queued', 'processing', 'complete', 'failed');
create type ingestion_source_kind as enum ('upload', 'url');

create table ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  video_id uuid references videos(id) on delete set null,
  course_id uuid references courses(id) on delete cascade,
  source_kind ingestion_source_kind not null,
  source_uri text not null,
  status ingestion_job_status not null default 'queued',
  progress numeric(5, 2) not null default 0,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index ingestion_jobs_status_idx on ingestion_jobs(status);
create index ingestion_jobs_video_id_idx on ingestion_jobs(video_id);
