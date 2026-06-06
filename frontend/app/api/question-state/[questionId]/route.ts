import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

type Params = { params: Promise<{ questionId: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { questionId } = await params;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: 'Accounts not configured' }, { status: 503 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const { error } = await supabase.from('question_state').upsert(
    {
      user_id: user.id,
      question_id: questionId,
      hints: body.hints ?? [],
      solution: body.solution ?? null,
      tutor_thread: body.tutor_thread ?? [],
    },
    { onConflict: 'user_id,question_id' }
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
