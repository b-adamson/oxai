'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';

type Mode = 'sign_in' | 'sign_up';

export default function LoginPage() {
  // useSearchParams() requires a Suspense boundary at prerender time.
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = getSupabaseBrowserClient();

  const [mode, setMode] = useState<Mode>('sign_in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(
    searchParams.get('error') ? 'Sign-in link failed — please try again.' : ''
  );
  const [notice, setNotice] = useState('');

  if (!supabase) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f5f5f0] p-6">
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-lg font-bold text-slate-900">Accounts not configured</h1>
          <p className="mt-2 text-sm text-slate-500">
            Supabase environment variables are missing, so the app is running in
            guest mode. Progress is stored in this browser only.
          </p>
          <Link
            href="/"
            className="mt-6 inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Continue as guest
          </Link>
        </div>
      </main>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || loading) return;
    setLoading(true);
    setError('');
    setNotice('');

    try {
      if (mode === 'sign_up') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${location.origin}/auth/callback`,
            data: displayName ? { display_name: displayName } : undefined,
          },
        });
        if (error) throw error;
        if (data.session) {
          router.push('/');
        } else {
          setNotice('Check your email to confirm your account, then sign in.');
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push('/');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  }

  async function signInWithGoogle() {
    if (!supabase) return;
    setError('');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
    if (error) setError(error.message);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f5f0] p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-slate-900">oxAI</h1>
          <p className="mt-1 text-sm text-slate-500">
            {mode === 'sign_in' ? 'Sign in to sync your progress' : 'Create an account'}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <form onSubmit={submit} className="grid gap-3">
            {mode === 'sign_up' && (
              <input
                type="text"
                placeholder="Name (optional)"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            )}
            <input
              type="email"
              required
              placeholder="Email"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              type="password"
              required
              minLength={6}
              placeholder="Password"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            {error && <p className="text-xs text-red-500">{error}</p>}
            {notice && <p className="text-xs text-emerald-600">{notice}</p>}

            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Working…' : mode === 'sign_in' ? 'Sign in' : 'Sign up'}
            </button>
          </form>

          <div className="my-4 flex items-center gap-3 text-[10px] uppercase tracking-widest text-slate-400">
            <div className="h-px flex-1 bg-slate-200" />
            or
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          <button
            onClick={signInWithGoogle}
            className="w-full rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Continue with Google
          </button>

          <p className="mt-4 text-center text-xs text-slate-500">
            {mode === 'sign_in' ? (
              <>
                No account?{' '}
                <button className="font-semibold text-blue-600" onClick={() => setMode('sign_up')}>
                  Sign up
                </button>
              </>
            ) : (
              <>
                Already registered?{' '}
                <button className="font-semibold text-blue-600" onClick={() => setMode('sign_in')}>
                  Sign in
                </button>
              </>
            )}
          </p>
        </div>

        <p className="mt-4 text-center text-xs text-slate-400">
          <Link href="/" className="hover:text-slate-600">
            Continue as guest →
          </Link>
        </p>
      </div>
    </main>
  );
}
