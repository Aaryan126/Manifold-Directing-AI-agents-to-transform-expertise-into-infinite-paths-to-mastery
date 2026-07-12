alter table users
  add column is_simulated boolean not null default false;

update users
set is_simulated = true
where email like 'demo-learner-%@coursefoundry.local';
