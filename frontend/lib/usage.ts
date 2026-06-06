import { createSupabaseServerClient } from './supabase/server';
import { getSupabaseAdmin } from './supabase/admin';

export type UsageField = 'generations' | 'hints' | 'solutions' | 'tutor_messages';

/**
 * Count one LLM-backed call against today's usage for the signed-in user.
 * Counting only — no enforcement yet. Guests (no session) aren't counted.
 * Never throws; failures must not break the actual response.
 */
export async function recordUsage(field: UsageField, n = 1): Promise<void> {
  try {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const admin = getSupabaseAdmin();
    if (!admin) return;

    const { error } = await admin.rpc('increment_usage', {
      p_user_id: user.id,
      p_generations: field === 'generations' ? n : 0,
      p_hints: field === 'hints' ? n : 0,
      p_solutions: field === 'solutions' ? n : 0,
      p_tutor_messages: field === 'tutor_messages' ? n : 0,
    });
    if (error) console.error('Usage counting failed:', error.message);
  } catch (err) {
    console.error('Usage counting failed:', err);
  }
}
