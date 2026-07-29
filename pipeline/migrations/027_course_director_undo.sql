alter type course_proposal_status add value if not exists 'undone';

alter table course_proposals
  add column if not exists undo_state jsonb,
  add column if not exists undone_at timestamptz;
