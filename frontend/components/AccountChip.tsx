'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * Compact auth status for the dark sidebar: a sign-in link when logged out,
 * the user's email + sign-out when logged in. Renders nothing when Supabase
 * is not configured (guest-only mode).
 */
export function AccountChip() {
  const supabase = getSupabaseBrowserClient();
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [supabase]);

  if (!supabase || !ready) return null;

  if (!email) {
    return (
      <Link
        href="/login"
        className="mt-3 block rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-center text-xs font-semibold text-slate-300 hover:bg-slate-700"
      >
        Sign in to sync progress
      </Link>
    );
  }

  return (
    <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-slate-700 bg-slate-800 px-3 py-2">
      <span className="truncate text-xs text-slate-300" title={email}>
        {email}
      </span>
      <button
        className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-300"
        onClick={() => supabase.auth.signOut()}
      >
        Sign out
      </button>
    </div>
  );
}
