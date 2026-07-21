alter table concepts drop constraint if exists concepts_course_id_name_key;
create unique index concepts_revision_name_idx on concepts(revision_id, name);

alter table routing_policies
  drop constraint if exists routing_policies_course_id_concept_id_key;
create unique index routing_policies_revision_concept_idx
  on routing_policies(revision_id, concept_id) nulls not distinct;
