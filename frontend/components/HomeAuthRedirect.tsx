'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

/** Silently redirects authenticated users from the home page to the dashboard. */
export function HomeAuthRedirect() {
  const router = useRouter();
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) router.replace('/dashboard');
    });
  }, [router]);
  return null;
}
