import { getSupabaseAdmin } from './supabase/admin';

/**
 * Persist a generated question into the shared questions pool (server-side,
 * service role). Best-effort: failures are logged, never block the response.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function upsertGeneratedQuestion(raw: Record<string, any> | null): Promise<void> {
  const admin = getSupabaseAdmin();
  if (!admin || !raw?.question_id) return;

  const content = raw.content ?? {};
  const difficulty = Number(content.difficulty);

  const { error } = await admin.from('questions').upsert(
    {
      question_id: String(raw.question_id),
      payload: raw,
      origin: 'generated',
      subject: String(content.subject ?? 'unknown'),
      topic: content.topic ?? null,
      difficulty: difficulty >= 1 && difficulty <= 5 ? difficulty : null,
    },
    { onConflict: 'question_id' }
  );
  if (error) console.error('Question pool upsert failed:', error.message);
}
