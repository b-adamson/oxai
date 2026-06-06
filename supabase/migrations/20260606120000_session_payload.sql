-- Practice sessions: store the full client session object (PaperSession /
-- QuickModeSession) as a single jsonb payload instead of per-field columns.
-- PaperSession has many top-level fields (submitted_answers,
-- current_slot_index, …) that a column mapping would silently drop.
-- kind/status stay as columns for querying. Table is empty at this point.

alter table public.practice_sessions
  drop column blueprint,
  drop column slots,
  drop column stats,
  add column payload jsonb not null default '{}'::jsonb;
