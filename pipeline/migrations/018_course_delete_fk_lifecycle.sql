-- Course deletion removes an entire revision graph in one transaction. These
-- relationships intentionally protect individual targets from deletion, but
-- they must be checked after the owning course cascade has removed every child.

alter table remediation_rules
  drop constraint remediation_rules_target_clip_id_fkey,
  add constraint remediation_rules_target_clip_id_fkey
    foreign key (target_clip_id) references clips(id)
    deferrable initially deferred;

alter table remediation_rules
  drop constraint remediation_rules_target_concept_id_fkey,
  add constraint remediation_rules_target_concept_id_fkey
    foreign key (target_concept_id) references concepts(id)
    deferrable initially deferred;

alter table clips
  drop constraint clips_source_clip_id_fkey,
  add constraint clips_source_clip_id_fkey
    foreign key (source_clip_id) references clips(id)
    deferrable initially deferred;

alter table clips
  drop constraint clips_superseded_by_clip_id_fkey,
  add constraint clips_superseded_by_clip_id_fkey
    foreign key (superseded_by_clip_id) references clips(id)
    deferrable initially deferred;

alter table concepts
  drop constraint concepts_merged_into_concept_id_fkey,
  add constraint concepts_merged_into_concept_id_fkey
    foreign key (merged_into_concept_id) references concepts(id)
    deferrable initially deferred;

alter table enrollments
  drop constraint enrollments_revision_id_fkey,
  add constraint enrollments_revision_id_fkey
    foreign key (revision_id) references course_revisions(id)
    deferrable initially deferred;
