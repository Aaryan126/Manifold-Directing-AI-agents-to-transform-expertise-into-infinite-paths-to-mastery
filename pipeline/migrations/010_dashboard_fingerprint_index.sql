create index dashboard_signals_open_fingerprint_idx
  on dashboard_signals(course_id, (ai_diagnosis->>'fingerprint'))
  where status = 'open';
