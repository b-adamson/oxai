-- OxAI initial schema: user accounts + server-side state
--
-- Tables mirror the client shapes in frontend/lib/types.ts:
--   attempts          <- AttemptRecord (append-only; analytics/mastery derive from it)
--   question_state    <- per-user hints / solution / tutor thread for one question
--   practice_sessions <- PaperSession & QuickModeSession (slots kept as jsonb)
--   questions         <- shared question content (bank + generated pool seed)
--   usage_counters    <- per-user per-day LLM usage (counting only, no enforcement yet)

-- ── profiles ────────────────────────────────────────────────────────────────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: read own"
  on public.profiles for select
  using (id = (select auth.uid()));

create policy "profiles: update own"
  on public.profiles for update
  using (id = (select auth.uid()));

-- Auto-create a profile row whenever a user signs up.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data ->> 'display_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── questions ───────────────────────────────────────────────────────────────
-- Shared across users. Bank ids look like "2016_A_08"; generated ids are
-- UUIDs — `origin` is authoritative, never infer from the id shape.
-- Written only by server routes (service role); readable by any signed-in user.

create table public.questions (
  question_id text primary key,
  payload jsonb not null,
  origin text not null check (origin in ('bank', 'generated')),
  subject text not null,
  topic text,
  difficulty integer check (difficulty between 1 and 5),
  created_at timestamptz not null default now()
);

create index questions_subject_topic_difficulty_idx
  on public.questions (subject, topic, difficulty);

alter table public.questions enable row level security;

create policy "questions: authenticated read"
  on public.questions for select
  to authenticated
  using (true);

-- ── attempts ────────────────────────────────────────────────────────────────
-- Append-only. Mirrors AttemptRecord; the analytics/mastery model is a pure
-- function over this table (computed client-side for now).

create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  question_id text not null,
  session_id uuid,
  mode text not null check (mode in ('training', 'quick', 'paper')),
  chosen_answer text,
  correct_answer text,
  is_correct boolean,
  time_taken_seconds integer not null default 0,
  hint_count integer not null default 0,
  tutor_used boolean not null default false,
  solution_revealed boolean not null default false,
  subject text not null,
  topic text,
  subtopic text,
  difficulty integer check (difficulty between 1 and 5),
  source_type text check (source_type in ('bank', 'fresh_ai', 'either')),
  attempted_at timestamptz not null default now()
);

create index attempts_user_recency_idx
  on public.attempts (user_id, attempted_at desc);
create index attempts_user_topic_idx
  on public.attempts (user_id, subject, topic);

alter table public.attempts enable row level security;

create policy "attempts: read own"
  on public.attempts for select
  using (user_id = (select auth.uid()));

create policy "attempts: insert own"
  on public.attempts for insert
  with check (user_id = (select auth.uid()));

-- ── question_state ──────────────────────────────────────────────────────────
-- One row per (user, question): earned hints, revealed solution, tutor thread.

create table public.question_state (
  user_id uuid not null references public.profiles (id) on delete cascade,
  question_id text not null,
  hints jsonb not null default '[]'::jsonb,
  solution jsonb,
  tutor_thread jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, question_id)
);

alter table public.question_state enable row level security;

create policy "question_state: read own"
  on public.question_state for select
  using (user_id = (select auth.uid()));

create policy "question_state: insert own"
  on public.question_state for insert
  with check (user_id = (select auth.uid()));

create policy "question_state: update own"
  on public.question_state for update
  using (user_id = (select auth.uid()));

create policy "question_state: delete own"
  on public.question_state for delete
  using (user_id = (select auth.uid()));

-- ── practice_sessions ───────────────────────────────────────────────────────
-- Covers both paper mode and quick mode. Blueprint/slots/stats stay jsonb to
-- match the client shapes 1:1; sessions are checkpointed, not streamed.

create table public.practice_sessions (
  id uuid primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('paper', 'quick')),
  status text not null,
  blueprint jsonb,
  slots jsonb not null default '[]'::jsonb,
  stats jsonb,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index practice_sessions_user_idx
  on public.practice_sessions (user_id, updated_at desc);

alter table public.practice_sessions enable row level security;

create policy "practice_sessions: read own"
  on public.practice_sessions for select
  using (user_id = (select auth.uid()));

create policy "practice_sessions: insert own"
  on public.practice_sessions for insert
  with check (user_id = (select auth.uid()));

create policy "practice_sessions: update own"
  on public.practice_sessions for update
  using (user_id = (select auth.uid()));

create policy "practice_sessions: delete own"
  on public.practice_sessions for delete
  using (user_id = (select auth.uid()));

-- ── usage_counters ──────────────────────────────────────────────────────────
-- Quota hooks: incremented by server routes on every LLM-backed call.
-- No enforcement in this milestone — data for future limits/pricing tiers.

create table public.usage_counters (
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null default current_date,
  generations integer not null default 0,
  hints integer not null default 0,
  solutions integer not null default 0,
  tutor_messages integer not null default 0,
  primary key (user_id, day)
);

alter table public.usage_counters enable row level security;

create policy "usage_counters: read own"
  on public.usage_counters for select
  using (user_id = (select auth.uid()));

-- Counters are written only by server routes (service role bypasses RLS),
-- so no insert/update policies for regular users.

-- Atomic increment helper for the server routes.
create function public.increment_usage(
  p_user_id uuid,
  p_generations integer default 0,
  p_hints integer default 0,
  p_solutions integer default 0,
  p_tutor_messages integer default 0
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.usage_counters (user_id, day, generations, hints, solutions, tutor_messages)
  values (p_user_id, current_date, p_generations, p_hints, p_solutions, p_tutor_messages)
  on conflict (user_id, day) do update set
    generations = public.usage_counters.generations + excluded.generations,
    hints = public.usage_counters.hints + excluded.hints,
    solutions = public.usage_counters.solutions + excluded.solutions,
    tutor_messages = public.usage_counters.tutor_messages + excluded.tutor_messages;
$$;

revoke execute on function public.increment_usage from public, anon, authenticated;

-- ── updated_at maintenance ──────────────────────────────────────────────────

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger question_state_set_updated_at
  before update on public.question_state
  for each row execute procedure public.set_updated_at();

create trigger practice_sessions_set_updated_at
  before update on public.practice_sessions
  for each row execute procedure public.set_updated_at();
