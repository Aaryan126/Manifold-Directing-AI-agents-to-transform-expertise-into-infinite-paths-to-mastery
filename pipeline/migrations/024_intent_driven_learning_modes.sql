alter table learner_study_sessions
  add column mode text,
  add column finish_requested boolean not null default false;

update learner_study_sessions
set mode = case goal
  when 'review' then 'review_learned'
  when 'get_unstuck' then 'strengthen_weak_areas'
  else 'continue_path'
end;

alter table learner_study_sessions
  alter column mode set not null,
  add constraint learner_study_sessions_mode_check check (
    mode in (
      'continue_path',
      'learn_new',
      'strengthen_weak_areas',
      'review_learned'
    )
  ),
  alter column goal drop not null,
  alter column budget_minutes drop not null;

alter table learner_session_steps
  alter column estimated_minutes drop not null;

create index learner_study_sessions_mode_idx
  on learner_study_sessions(learner_id, course_id, revision_id, mode, updated_at desc);
