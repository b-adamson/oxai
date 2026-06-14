'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

export function NavAuth() {
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) { setReady(true); return; }

    function applyUser(user: { user_metadata?: Record<string, string>; email?: string } | null) {
      if (user) {
        setDisplayName(user.user_metadata?.display_name || user.email || null);
      } else {
        setDisplayName(null);
      }
    }

    supabase.auth.getUser().then(({ data }) => {
      applyUser(data.user);
      setReady(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_, session) => {
      applyUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Avoid flash of wrong state on first render
  if (!ready) return <div className="w-24" />;

  if (displayName) {
    const initial = displayName.charAt(0).toUpperCase();
    const label = displayName.includes('@') ? displayName.split('@')[0] : displayName;
    return (
      <Link
        href="/dashboard"
        className="flex items-center gap-2 hover:opacity-80 transition-opacity"
      >
        <span className="w-7 h-7 rounded-full bg-accent text-white text-xs font-bold flex items-center justify-center shrink-0 select-none">
          {initial}
        </span>
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300 hidden sm:block max-w-[120px] truncate">
          {label}
        </span>
      </Link>
    );
  }

  return (
    <>
      <Link
        href="/login"
        className="text-sm text-gray-600 dark:text-gray-400 hover:text-accent transition-colors hidden sm:block"
      >
        Sign in
      </Link>
      <Link
        href="/login"
        className="text-sm font-semibold bg-accent text-white px-4 py-1.5 rounded-full hover:bg-accent-light transition-colors shrink-0"
      >
        Get Started
      </Link>
    </>
  );
}
