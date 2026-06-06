import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

let admin: SupabaseClient | null | undefined;

/**
 * Service-role Supabase client. Bypasses RLS — server-side use only
 * (route handlers writing shared data like the questions pool).
 * Returns null when not configured.
 */
export function getSupabaseAdmin(): SupabaseClient | null {
  if (admin !== undefined) return admin;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  admin =
    url && key
      ? createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;
  return admin;
}
