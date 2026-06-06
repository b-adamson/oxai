# Supabase (accounts + server-side state)

Postgres schema and auth for OxAI user accounts. Migrations live in
`migrations/` and are the source of truth — never edit the hosted database
through the dashboard without writing a migration.

## Local development

Requires Docker. From the repo root:

```bash
npx supabase db start    # boots local Postgres and applies migrations/
npx supabase db reset    # re-applies all migrations from scratch
```

Local DB connection: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`

## Hosted project (one-time setup)

1. Create a project at https://supabase.com/dashboard
2. Link and push the schema:

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push
```

## Environment variables (frontend)

See `frontend/.env.example`. The service-role/secret key is server-only —
it bypasses RLS and must never be exposed to the browser (no `NEXT_PUBLIC_`
prefix, never committed).

## Schema overview

| Table | Purpose |
|---|---|
| `profiles` | One row per user, auto-created on signup (trigger on `auth.users`) |
| `questions` | Shared question content: bank + generated pool. `origin` is authoritative ('bank'/'generated') |
| `attempts` | Append-only attempt log (mirrors `AttemptRecord`); analytics derive from it |
| `question_state` | Per-(user, question): hints, solution, tutor thread |
| `practice_sessions` | Paper + quick sessions; blueprint/slots as jsonb, checkpointed not streamed |
| `usage_counters` | Per-user per-day LLM usage via `increment_usage()` — counting only for now |

RLS: users can only touch their own rows; `questions` is read-only for
authenticated users and written by server routes (service role).
`usage_counters` is written only via the `increment_usage()` function from
server routes.
