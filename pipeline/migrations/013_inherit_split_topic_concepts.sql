with split_topic_concept_backfill as (
  select child.id as child_topic_id, source.id as source_topic_id
  from topics child
  join lateral (
    select candidate.id
    from topics candidate
    where candidate.course_id = child.course_id
      and candidate.video_id = child.video_id
      and candidate.id <> child.id
      and candidate.review_status = 'dismissed'
      and candidate.start_seconds <= child.start_seconds
      and candidate.end_seconds >= child.end_seconds
      and (
        child.instructor_revision ->> 'action' = 'split'
        or candidate.title = child.title
        or child.title in (candidate.title || ' (part 1)', candidate.title || ' (part 2)')
      )
      and exists (
        select 1 from topic_concepts linked where linked.topic_id = candidate.id
      )
    order by (candidate.end_seconds - candidate.start_seconds) asc
    limit 1
  ) source on true
  where child.review_status in ('accepted', 'edited')
    and not exists (
      select 1 from topic_concepts linked where linked.topic_id = child.id
    )
), inserted_links as (
insert into topic_concepts (topic_id, concept_id)
select backfill.child_topic_id, linked.concept_id
from split_topic_concept_backfill backfill
join topic_concepts linked on linked.topic_id = backfill.source_topic_id
on conflict do nothing
returning concept_id
)
update concepts concept
set instructor_revision = coalesce(concept.instructor_revision, '{}'::jsonb)
      || jsonb_build_object(
        'action', 'inherit_topic_links',
        'topic_ids', (
          select coalesce(jsonb_agg(next_link.topic_id order by next_link.topic_id), '[]'::jsonb)
          from (
            select linked.topic_id
            from topic_concepts linked
            where linked.concept_id = concept.id
              and linked.topic_id not in (
                select backfill.source_topic_id from split_topic_concept_backfill backfill
              )
            union
            select backfill.child_topic_id
            from split_topic_concept_backfill backfill
            join topic_concepts source_link
              on source_link.topic_id = backfill.source_topic_id
             and source_link.concept_id = concept.id
          ) next_link
        )
      ),
    updated_at = now()
where concept.id in (select concept_id from inserted_links);

with split_topic_concept_backfill as (
  select distinct source.id as source_topic_id
  from topics child
  join lateral (
    select candidate.id
    from topics candidate
    where candidate.course_id = child.course_id
      and candidate.video_id = child.video_id
      and candidate.id <> child.id
      and candidate.review_status = 'dismissed'
      and candidate.start_seconds <= child.start_seconds
      and candidate.end_seconds >= child.end_seconds
      and (
        child.instructor_revision ->> 'action' = 'split'
        or candidate.title = child.title
        or child.title in (candidate.title || ' (part 1)', candidate.title || ' (part 2)')
      )
      and exists (
        select 1 from topic_concepts linked where linked.topic_id = candidate.id
      )
    order by (candidate.end_seconds - candidate.start_seconds) asc
    limit 1
  ) source on true
  where child.review_status in ('accepted', 'edited')
)
delete from topic_concepts linked
using split_topic_concept_backfill backfill
where linked.topic_id = backfill.source_topic_id;
