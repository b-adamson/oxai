import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

// Server row <-> client AttemptRecord mapping. The client's attempt_id (a
// uuid) is the server primary key, which makes re-pushes idempotent.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToAttempt(row: Record<string, any>) {
  return {
    attempt_id: row.id,
    question_id: row.question_id,
    session_id: row.session_id ?? '',
    mode: row.mode,
    chosen_answer: row.chosen_answer,
    correct_answer: row.correct_answer,
    is_correct: row.is_correct,
    time_taken_seconds: row.time_taken_seconds,
    hint_count: row.hint_count,
    tutor_used: row.tutor_used,
    solution_revealed: row.solution_revealed,
    topic: row.topic,
    subtopic: row.subtopic,
    difficulty: row.difficulty,
    source_type: row.source_type,
    attempted_at: new Date(row.attempted_at).getTime(),
  };
}

export async function GET() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: 'Accounts not configured' }, { status: 503 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data, error } = await supabase
    .from('attempts')
    .select('*')
    .order('attempted_at', { ascending: false })
    .limit(10000);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ attempts: (data ?? []).map(rowToAttempt) });
}

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: 'Accounts not configured' }, { status: 503 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const a = body?.attempt;
  if (!a?.attempt_id || !a?.question_id || !a?.mode) {
    return NextResponse.json({ error: 'Invalid attempt' }, { status: 400 });
  }

  const { error } = await supabase.from('attempts').upsert(
    {
      id: a.attempt_id,
      user_id: user.id,
      question_id: a.question_id,
      session_id: a.session_id || null,
      mode: a.mode,
      chosen_answer: a.chosen_answer ?? null,
      correct_answer: a.correct_answer ?? null,
      is_correct: a.is_correct ?? null,
      time_taken_seconds: a.time_taken_seconds ?? 0,
      hint_count: a.hint_count ?? 0,
      tutor_used: a.tutor_used ?? false,
      solution_revealed: a.solution_revealed ?? false,
      subject: a.subject || 'unknown',
      topic: a.topic ?? null,
      subtopic: a.subtopic ?? null,
      difficulty: a.difficulty ?? null,
      source_type: a.source_type ?? null,
      attempted_at: new Date(a.attempted_at ?? Date.now()).toISOString(),
    },
    { onConflict: 'id', ignoreDuplicates: true }
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
