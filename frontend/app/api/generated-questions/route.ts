import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const subject = searchParams.get('subject');
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '200', 10), 500);

  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

  let query = admin
    .from('questions')
    .select('question_id, subject, topic, subtopic, archetype, difficulty, origin, created_at, payload')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (subject) query = query.eq('subject', subject);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ questions: data ?? [] });
}
