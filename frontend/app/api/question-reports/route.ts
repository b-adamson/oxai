import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const { question_id, error_title, error_body, question_stem, worked_solution } = body ?? {};

  if (!question_id || !error_title) {
    return NextResponse.json({ error: 'question_id and error_title are required' }, { status: 400 });
  }

  // Get user id if authenticated (reports work for guests too)
  let userId: string | null = null;
  const supabase = await createSupabaseServerClient();
  if (supabase) {
    const { data: { user } } = await supabase.auth.getUser();
    userId = user?.id ?? null;
  }

  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

  const { error } = await admin.from('question_reports').insert({
    question_id,
    user_id: userId,
    error_title,
    error_body: error_body ?? null,
    question_stem: question_stem ?? null,
    worked_solution: worked_solution ?? null,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

  const { data, error } = await admin
    .from('question_reports')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reports: data ?? [] });
}
