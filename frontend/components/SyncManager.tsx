'use client';

import { useEffect, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import {
  setSyncAuthed,
  scheduleFlush,
  countImportableData,
  importLocalData,
  wasImportPrompted,
  markImportPrompted,
} from '@/lib/sync';

type ImportOffer = { userId: string; attempts: number; sessions: number };

/**
 * Mounted in the root layout. Tells the sync layer when a user is signed in
 * (triggering hydration + outbox flush), retries the outbox on reconnect,
 * and offers a one-time import of guest data into a fresh account.
 */
export function SyncManager() {
  const [offer, setOffer] = useState<ImportOffer | null>(null);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    function handleAuth(userId: string | null) {
      if (userId && !wasImportPrompted(userId)) {
        // Count BEFORE hydration merges server data into the local store,
        // so we only offer genuinely local (guest) progress.
        const counts = countImportableData();
        if (counts.attempts + counts.questionStates + counts.sessions > 0) {
          setOffer({ userId, attempts: counts.attempts, sessions: counts.sessions });
        } else {
          markImportPrompted(userId);
        }
      }
      setSyncAuthed(Boolean(userId));
    }

    supabase.auth.getUser().then(({ data }) => handleAuth(data.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      handleAuth(session?.user?.id ?? null);
    });

    const onOnline = () => scheduleFlush(0);
    window.addEventListener('online', onOnline);

    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener('online', onOnline);
    };
  }, []);

  if (!offer) return null;

  function dismiss(importFirst: boolean) {
    if (!offer) return;
    if (importFirst) importLocalData();
    markImportPrompted(offer.userId);
    setOffer(null);
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 rounded-xl border border-slate-200 bg-white p-4 shadow-lg">
      <p className="text-sm font-semibold text-slate-800">Sync your local progress?</p>
      <p className="mt-1 text-xs text-slate-500">
        This browser has {offer.attempts} attempt{offer.attempts === 1 ? '' : 's'}
        {offer.sessions > 0 && <> and {offer.sessions} session{offer.sessions === 1 ? '' : 's'}</>}{' '}
        from before you signed in. Import them into your account?
      </p>
      <div className="mt-3 flex gap-2">
        <button
          className="flex-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
          onClick={() => dismiss(true)}
        >
          Import
        </button>
        <button
          className="flex-1 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          onClick={() => dismiss(false)}
        >
          Not now
        </button>
      </div>
    </div>
  );
}
