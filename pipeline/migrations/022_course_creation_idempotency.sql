create unique index if not exists courses_instructor_creation_request_unique
on courses (instructor_id, (brief->>'creation_request_id'))
where nullif(brief->>'creation_request_id', '') is not null;
