alter table clips
add column if not exists materialization_status text not null default 'source_reference',
add column if not exists materialization_error text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'clips_materialization_status'
  ) then
    alter table clips
    add constraint clips_materialization_status
    check (materialization_status in ('source_reference', 'processing', 'ready', 'failed'));
  end if;
end $$;

create index if not exists clips_materialization_status_idx
on clips(materialization_status);
