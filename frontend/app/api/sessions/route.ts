import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

// Practice sessions (paper + quick). The full client session object lives in
// the payload column; kind/status are columns for querying. Upserts are
// checkpoints — the client debounces, so rows are written occasionally,
// not on every slot update.

export async function GET() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: 'Accounts not configured' }, { status: 503 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { data, error } = await supabase
    .from('practice_sessions')
    .select('id, kind, status, payload, updated_at')
    .order('updated_at', { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sessions: data ?? [] });
}

export async function PUT(request: Request) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: 'Accounts not configured' }, { status: 503 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const { id, kind, status, payload, started_at, ended_at } = body ?? {};
  if (!id || !kind || !status || !payload) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 400 });
  }

  const { error } = await supabase.from('practice_sessions').upsert(
    {
      id,
      user_id: user.id,
      kind,
      status,
      payload,
      started_at: started_at ? new Date(started_at).toISOString() : null,
      ended_at: ended_at ? new Date(ended_at).toISOString() : null,
    },
    { onConflict: 'id' }
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
