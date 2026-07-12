create index remediation_rules_target_clip_idx
  on remediation_rules(target_clip_id) where target_clip_id is not null;
create index remediation_rules_target_concept_idx
  on remediation_rules(target_concept_id) where target_concept_id is not null;
create index topic_concepts_concept_topic_idx on topic_concepts(concept_id, topic_id);
create index questions_topic_review_idx on questions(topic_id, review_status);
