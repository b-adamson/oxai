import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

// Today's LLM usage counters for the signed-in user.
export async function GET() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: 'Accounts not configured' }, { status: 503 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('usage_counters')
    .select('generations, hints, solutions, tutor_messages')
    .eq('day', today)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    day: today,
    generations: data?.generations ?? 0,
    hints: data?.hints ?? 0,
    solutions: data?.solutions ?? 0,
    tutor_messages: data?.tutor_messages ?? 0,
  });
}
