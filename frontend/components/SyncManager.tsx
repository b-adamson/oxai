'use client';

import { useEffect } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { setSyncAuthed, scheduleFlush } from '@/lib/sync';

/**
 * Invisible component mounted in the root layout. Tells the sync layer when
 * a user is signed in (which triggers hydration from the server + outbox
 * flush) and retries the outbox when the browser comes back online.
 */
export function SyncManager() {
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    supabase.auth.getUser().then(({ data }) => setSyncAuthed(Boolean(data.user)));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSyncAuthed(Boolean(session?.user));
    });

    const onOnline = () => scheduleFlush(0);
    window.addEventListener('online', onOnline);

    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener('online', onOnline);
    };
  }, []);

  return null;
}
