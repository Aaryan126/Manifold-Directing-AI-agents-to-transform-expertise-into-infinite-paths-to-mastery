-- Initial generation now produces an editable private draft without a clerical
-- per-artifact approval queue. Publication remains the learner-facing boundary.

insert into audit_events (
  course_id,
  actor_type,
  artifact_type,
  artifact_id,
  action,
  source,
  previous_state,
  new_state,
  scope,
  revision_id
)
select
  revision.course_id,
  'ai',
  'course_revision',
  revision.id,
  'auto_accept_private_draft',
  'product_migration',
  jsonb_build_object(
    'revision_status', revision.status,
    'pending_review_items', (
      select count(*)
      from review_items item
      join review_bundles bundle on bundle.id = item.bundle_id
      where bundle.revision_id = revision.id and item.status = 'pending'
    )
  ),
  jsonb_build_object(
    'revision_status', 'review',
    'pending_review_items', 0,
    'learner_visible', false,
    'publication_required', true
  ),
  'revision',
  revision.id
from course_revisions revision
join courses course
  on course.id = revision.course_id
 and course.working_revision_id = revision.id
where course.status = 'draft'
  and (
    revision.status = 'review'
    or exists (
      select 1 from review_items item
      join review_bundles bundle on bundle.id = item.bundle_id
      where bundle.revision_id = revision.id and item.status = 'pending'
    )
    or exists (
      select 1 from topics
      where revision_id = revision.id and review_status = 'proposed'
    )
  );

insert into routing_policies (course_id, concept_id, revision_id, policy)
select
  course.id,
  concept.id,
  concept.revision_id,
  jsonb_build_object(
    'confidence_threshold', 3,
    'correct_attempts_for_mastery', 1,
    'advancement_mode', 'require_mastery',
    'max_remediation_attempts', 2,
    'recommendation', 'standard'
  )
from courses course
join concepts concept on concept.revision_id = course.working_revision_id
where course.status = 'draft'
  and concept.review_status <> 'dismissed'
on conflict (revision_id, concept_id) do nothing;

update topics artifact
set review_status = 'accepted',
    approved_at = coalesce(approved_at, now()),
    dismissed_at = null,
    updated_at = now()
from courses course
where course.status = 'draft'
  and course.working_revision_id = artifact.revision_id
  and artifact.review_status = 'proposed';

update concepts artifact
set review_status = 'accepted',
    approved_at = coalesce(approved_at, now()),
    dismissed_at = null,
    updated_at = now()
from courses course
where course.status = 'draft'
  and course.working_revision_id = artifact.revision_id
  and artifact.review_status = 'proposed';

update concept_edges artifact
set review_status = 'accepted',
    approved_at = coalesce(approved_at, now()),
    dismissed_at = null,
    updated_at = now()
from courses course
where course.status = 'draft'
  and course.working_revision_id = artifact.revision_id
  and artifact.review_status = 'proposed';

update questions artifact
set review_status = 'accepted',
    approved_at = coalesce(approved_at, now()),
    dismissed_at = null,
    updated_at = now()
from courses course
where course.status = 'draft'
  and course.working_revision_id = artifact.revision_id
  and artifact.review_status = 'proposed';

update question_hint_ladders artifact
set review_status = 'accepted',
    approved_at = coalesce(approved_at, now()),
    dismissed_at = null,
    updated_at = now()
from courses course
where course.status = 'draft'
  and course.working_revision_id = artifact.revision_id
  and artifact.review_status = 'proposed';

update course_modules artifact
set review_status = 'accepted',
    dismissed_at = null,
    updated_at = now()
from courses course
where course.status = 'draft'
  and course.working_revision_id = artifact.revision_id
  and artifact.review_status = 'proposed';

update course_units artifact
set review_status = 'accepted',
    dismissed_at = null,
    updated_at = now()
from courses course
where course.status = 'draft'
  and course.working_revision_id = artifact.revision_id
  and artifact.review_status = 'proposed';

update course_unit_edges artifact
set review_status = 'accepted',
    dismissed_at = null,
    updated_at = now()
from courses course
where course.status = 'draft'
  and course.working_revision_id = artifact.revision_id
  and artifact.review_status = 'proposed';

update clips artifact
set status = 'active',
    approved_at = coalesce(approved_at, now()),
    updated_at = now()
from courses course
where course.status = 'draft'
  and course.working_revision_id = artifact.revision_id
  and artifact.status <> 'superseded'
  and artifact.approved_at is null;

update remediation_rules artifact
set approved_at = coalesce(approved_at, now())
from courses course
where course.status = 'draft'
  and course.working_revision_id = artifact.revision_id
  and artifact.approved_at is null;

update course_revisions revision
set brief = jsonb_set(
      revision.brief,
      '{course_title}',
      (revision.brief -> 'course_title')
        || jsonb_build_object(
          'status', 'accepted',
          'accepted_automatically', true,
          'learner_visible', false
        ),
      true
    ),
    updated_at = now()
from courses course
where course.status = 'draft'
  and course.working_revision_id = revision.id
  and revision.brief ? 'course_title'
  and coalesce(revision.brief #>> '{course_title,status}', '') = 'pending';

update review_items item
set status = 'accepted', updated_at = now()
from review_bundles bundle, courses course
where item.bundle_id = bundle.id
  and course.status = 'draft'
  and course.working_revision_id = bundle.revision_id
  and item.status = 'pending';

update review_bundles bundle
set status = 'complete', updated_at = now()
from courses course
where course.status = 'draft'
  and course.working_revision_id = bundle.revision_id;

update generation_runs run
set status = 'complete',
    phase = 'draft_ready',
    progress = 100,
    completed_at = coalesce(completed_at, now()),
    updated_at = now()
from courses course
where course.status = 'draft'
  and course.working_revision_id = run.revision_id
  and run.status = 'waiting_review';
