alter table course_revisions
  add column brief jsonb not null default '{}'::jsonb;

update course_revisions revision
set brief = course.brief
from courses course
where course.id = revision.course_id;
