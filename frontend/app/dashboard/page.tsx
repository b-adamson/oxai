'use client';
import { Suspense, useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useStore } from '@/lib/store';
import { computeMastery } from '@/lib/analytics';
import { AnalyticsDashboard } from '@/components/AnalyticsDashboard';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { MathText } from '@/components/MathText';
import type { MasteryStats, AttemptRecord, QuestionRecord, TutorChatThread } from '@/lib/types';

type Tab = 'home' | 'history' | 'progress';
const PAGE_SIZE = 25;

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 dark:bg-gray-950" />}>
      <Dashboard />
    </Suspense>
  );
}

function Dashboard() {
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get('tab') as Tab) ?? 'home';
  const [tab, setTab] = useState<Tab>(initialTab);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const attempts = useStore(s => s.attempts);
  const questions = useStore(s => s.questions);
  const tutorThreads = useStore(s => s.tutorThreads);
  const mastery = useMemo(() => computeMastery(attempts), [attempts]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) { setAuthReady(true); return; }
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email ?? null);
      setDisplayName(data.user?.user_metadata?.display_name ?? null);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_, session) => {
      setUserEmail(session?.user?.email ?? null);
      setDisplayName(session?.user?.user_metadata?.display_name ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const isGuest = authReady && !userEmail;

  const sortedAttempts = useMemo(
    () => [...attempts].sort((a, b) => b.attempted_at - a.attempted_at),
    [attempts],
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="max-w-4xl mx-auto px-4 pt-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-2">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {userEmail
                ? `Hello, ${displayName ?? userEmail.split('@')[0]}`
                : 'Dashboard'}
            </h1>
          </div>
          {isGuest && (
            <Link
              href="/login"
              className="text-sm font-semibold text-accent hover:text-accent-light transition-colors"
            >
              Sign in →
            </Link>
          )}
        </div>

        {/* Guest banner */}
        {isGuest && (
          <div className="flex items-center gap-3 mt-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-700 rounded-xl px-4 py-3 text-sm">
            <span className="text-amber-800 dark:text-amber-300 font-medium">Guest mode</span>
            <span className="text-amber-700 dark:text-amber-400">— progress is saved to this browser only and won't sync across devices.</span>
            <Link href="/login" className="ml-auto shrink-0 font-semibold text-amber-900 dark:text-amber-200 hover:underline">
              Create account →
            </Link>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-0 border-b border-gray-200 dark:border-gray-800 mt-6">
          {(['home', 'history', 'progress'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-2.5 text-sm font-medium capitalize border-b-2 -mb-px transition-colors ${
                tab === t
                  ? 'border-accent text-accent'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 pb-16">
        {tab === 'home' && (
          <HomeTab mastery={mastery} attempts={sortedAttempts} questions={questions} isGuest={isGuest} authReady={authReady} displayName={displayName} />
        )}
        {tab === 'history' && (
          <HistoryTab attempts={sortedAttempts} questions={questions} tutorThreads={tutorThreads} />
        )}
        {tab === 'progress' && (
          <AnalyticsDashboard stats={mastery} />
        )}
      </div>
    </div>
  );
}

// ── Home tab ───────────────────────────────────────────────────────────────────

function HomeTab({
  mastery, attempts, questions, isGuest, authReady, displayName,
}: {
  mastery: MasteryStats;
  attempts: AttemptRecord[];
  questions: Record<string, QuestionRecord>;
  isGuest: boolean;
  authReady: boolean;
  displayName: string | null;
}) {
  const router = useRouter();
  const recentlyMissed = useMemo(
    () => attempts.filter(a => a.is_correct === false).slice(0, 4),
    [attempts],
  );
  const hasAttempts = attempts.length > 0;

  return (
    <div className="space-y-6">
      {/* Stats bar */}
      {hasAttempts && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MiniStatCard label="Accuracy" value={`${Math.round(mastery.overall_accuracy * 100)}%`} accent="emerald" />
          <MiniStatCard label="Questions done" value={String(mastery.overall_attempts)} accent="blue" />
          <MiniStatCard label="Current streak" value={String(mastery.current_streak)} accent="purple" />
          <MiniStatCard
            label="Avg time"
            value={mastery.avg_time_seconds > 0 ? fmtTime(mastery.avg_time_seconds) : '—'}
            accent="amber"
          />
        </div>
      )}

      {/* Mode panels */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Quick Mode */}
        <Link
          href="/quick"
          className="group relative flex flex-col justify-between rounded-2xl border-2 border-accent/20 bg-white dark:bg-gray-900 p-6 shadow-sm hover:border-accent hover:shadow-md transition-all min-h-[200px]"
        >
          <div>
            <div className="text-3xl mb-3">⚡</div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">Quick Mode</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
              Drill any topic at your own pace. Questions adapt to your difficulty settings. No time pressure — just focused practice.
            </p>
          </div>
          <div className="mt-5 flex items-center gap-2 text-accent font-semibold text-sm group-hover:gap-3 transition-all">
            Start practising <span>→</span>
          </div>
        </Link>

        {/* Paper Mode — gated for guests */}
        {isGuest && authReady ? (
          <Link
            href="/login"
            className="group relative flex flex-col justify-between rounded-2xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-6 shadow-sm hover:border-gray-300 dark:hover:border-gray-600 hover:shadow-md transition-all min-h-[200px] opacity-80"
          >
            <div>
              <div className="text-3xl mb-3">📄</div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1 flex items-center gap-2">
                Paper Mode
                <span className="text-xs font-semibold bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded-full border border-gray-200 dark:border-gray-700">
                  Sign in required
                </span>
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                Simulate a full ESAT or TMUA paper under timed conditions. Full worked solutions and tutor support included.
              </p>
            </div>
            <div className="mt-5 flex items-center gap-2 text-gray-400 dark:text-gray-500 font-semibold text-sm">
              🔒 Sign in to access →
            </div>
          </Link>
        ) : (
          <Link
            href="/paper"
            className="group relative flex flex-col justify-between rounded-2xl border-2 border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-6 shadow-sm hover:border-gray-400 dark:hover:border-gray-500 hover:shadow-md transition-all min-h-[200px]"
          >
            <div>
              <div className="text-3xl mb-3">📄</div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">Paper Mode</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                Simulate a full ESAT or TMUA paper under timed conditions. Full worked solutions and tutor support included.
              </p>
            </div>
            <div className="mt-5 flex items-center gap-2 text-gray-700 dark:text-gray-300 font-semibold text-sm group-hover:gap-3 transition-all">
              Start a paper <span>→</span>
            </div>
          </Link>
        )}
      </div>

      {/* Recently missed */}
      {recentlyMissed.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Recently missed</h2>
          <div className="space-y-2">
            {recentlyMissed.map(a => {
              const q = questions[a.question_id];
              return (
                <button
                  key={a.attempt_id}
                  onClick={() => router.push(`/quick?review=${a.question_id}`)}
                  className="group w-full text-left flex items-start gap-3 bg-white dark:bg-gray-900 border border-red-100 dark:border-red-900/40 rounded-xl px-4 py-3 hover:border-red-300 dark:hover:border-red-700 hover:shadow-sm transition-all cursor-pointer"
                >
                  <span className="mt-0.5 w-5 h-5 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center shrink-0 text-xs text-red-600 dark:text-red-400 font-bold">✗</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-gray-700 dark:text-gray-300 line-clamp-2">
                      {q?.stem
                        ? <MathText text={q.stem} />
                        : 'Question no longer in session'}
                    </div>
                    <div className="flex items-center gap-3 mt-1.5">
                      {a.topic && <span className="text-xs text-gray-400">{a.topic}</span>}
                      <span className="text-xs text-gray-300 dark:text-gray-600">·</span>
                      <span className="text-xs text-gray-400">Answered {a.chosen_answer ?? '—'}, correct: {a.correct_answer ?? '—'}</span>
                      <span className="ml-auto text-xs text-accent opacity-0 group-hover:opacity-100 transition-opacity shrink-0">Review →</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!hasAttempts && (
        <div className="text-center py-12 text-gray-400 dark:text-gray-600">
          <div className="text-5xl mb-4">🎯</div>
          <p className="text-base font-medium text-gray-600 dark:text-gray-400 mb-1">No questions answered yet</p>
          <p className="text-sm">Pick a mode above to get started.</p>
        </div>
      )}
    </div>
  );
}

// ── History tab ────────────────────────────────────────────────────────────────

function HistoryTab({
  attempts, questions, tutorThreads,
}: {
  attempts: AttemptRecord[];
  questions: Record<string, QuestionRecord>;
  tutorThreads: Record<string, TutorChatThread>;
}) {
  const router = useRouter();
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const totalPages = Math.ceil(attempts.length / PAGE_SIZE);
  const pageData = attempts.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  if (attempts.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400 dark:text-gray-600">
        <div className="text-5xl mb-4">📋</div>
        <p className="text-sm">No history yet. Answer some questions to see them here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-gray-500 dark:text-gray-400">{attempts.length} questions answered</p>
        {totalPages > 1 && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-2 py-1 rounded border border-gray-200 dark:border-gray-700 disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              ←
            </button>
            <span className="text-xs">{page + 1} / {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page === totalPages - 1}
              className="px-2 py-1 rounded border border-gray-200 dark:border-gray-700 disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              →
            </button>
          </div>
        )}
      </div>

      {pageData.map(a => {
        const q = questions[a.question_id];
        const thread = tutorThreads[a.question_id];
        const isOpen = expanded === a.attempt_id;
        const correct = a.is_correct === true;
        const wrong = a.is_correct === false;

        return (
          <div
            key={a.attempt_id}
            className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden"
          >
            {/* Row */}
            <button
              onClick={() => setExpanded(isOpen ? null : a.attempt_id)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
            >
              <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                correct ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400'
                  : wrong ? 'bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-400'
              }`}>
                {correct ? '✓' : wrong ? '✗' : '?'}
              </span>

              <div className="flex-1 min-w-0">
                <div className="text-sm text-gray-800 dark:text-gray-200 truncate">
                  {q?.stem ? <MathText text={q.stem} /> : 'Unknown question'}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  {a.topic && <span className="text-xs text-gray-400 dark:text-gray-500 capitalize">{a.topic}</span>}
                  {a.topic && <span className="text-gray-200 dark:text-gray-700 text-xs">·</span>}
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    {fmtDate(a.attempted_at)}
                  </span>
                  {a.time_taken_seconds > 0 && (
                    <>
                      <span className="text-gray-200 dark:text-gray-700 text-xs">·</span>
                      <span className="text-xs text-gray-400 dark:text-gray-500">{fmtTime(a.time_taken_seconds)}</span>
                    </>
                  )}
                  {a.difficulty && (
                    <>
                      <span className="text-gray-200 dark:text-gray-700 text-xs">·</span>
                      <DifficultyDots d={a.difficulty} />
                    </>
                  )}
                  {thread && (
                    <>
                      <span className="text-gray-200 dark:text-gray-700 text-xs">·</span>
                      <span className="text-xs text-blue-400">💬 tutor</span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-gray-400 dark:text-gray-500 uppercase font-mono">
                  {a.chosen_answer ?? '—'}
                </span>
                <span className="text-gray-300 dark:text-gray-600 text-xs">▸</span>
                <span className={`text-xs font-mono font-semibold ${correct ? 'text-emerald-600' : 'text-red-500'}`}>
                  {a.correct_answer ?? '—'}
                </span>
                <span className="text-gray-300 dark:text-gray-600 ml-1 text-xs">{isOpen ? '▲' : '▼'}</span>
              </div>
            </button>

            {/* Expanded detail */}
            {isOpen && (
              <div className="border-t border-gray-100 dark:border-gray-800 px-4 py-4 space-y-4">
                {q && (
                  <div>
                    <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-1.5">Question</p>
                    <div className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed">
                      <MathText text={q.stem} />
                    </div>
                    <div className="mt-3 space-y-1">
                      {q.options.map(opt => {
                        const isChosen = opt.label === a.chosen_answer;
                        const isCorrect = opt.label === a.correct_answer;
                        return (
                          <div key={opt.label} className={`flex items-start gap-2 text-sm rounded-lg px-3 py-1.5 ${
                            isCorrect ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300'
                              : isChosen ? 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400'
                              : 'text-gray-600 dark:text-gray-400'
                          }`}>
                            <span className="font-bold shrink-0">{opt.label}.</span>
                            <span className="flex-1"><MathText text={opt.text} /></span>
                            {isCorrect && <span className="ml-auto shrink-0 text-emerald-600 font-semibold">✓</span>}
                            {isChosen && !isCorrect && <span className="ml-auto shrink-0 text-red-500 font-semibold">✗</span>}
                          </div>
                        );
                      })}
                    </div>
                    {q.worked_solution && (
                      <details className="mt-3">
                        <summary className="text-xs font-semibold text-gray-400 cursor-pointer hover:text-gray-600 dark:hover:text-gray-300 select-none">
                          Show worked solution
                        </summary>
                        <div className="mt-2 text-sm text-gray-700 dark:text-gray-300 leading-relaxed pl-2 border-l-2 border-gray-200 dark:border-gray-700">
                          <MathText text={q.worked_solution} block />
                        </div>
                      </details>
                    )}
                  </div>
                )}

                <button
                  onClick={() => router.push(`/quick?review=${a.question_id}`)}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent hover:text-accent-light transition-colors"
                >
                  Review this question →
                </button>

                {thread && thread.messages.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-2">Tutor conversation</p>
                    <div className="space-y-2">
                      {thread.messages.map((msg, i) => (
                        <div key={i} className={`text-sm rounded-xl px-3 py-2 ${
                          msg.role === 'user'
                            ? 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 ml-6'
                            : 'bg-blue-50 dark:bg-blue-950/30 text-blue-900 dark:text-blue-200 mr-6'
                        }`}>
                          <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 mr-2">
                            {msg.role === 'user' ? 'You' : 'Tutor'}
                          </span>
                          {msg.text}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {totalPages > 1 && (
        <div className="flex justify-center gap-2 pt-4">
          <button
            onClick={() => { setPage(p => Math.max(0, p - 1)); setExpanded(null); }}
            disabled={page === 0}
            className="px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            Previous
          </button>
          <span className="px-4 py-2 text-sm text-gray-500">{page + 1} of {totalPages}</span>
          <button
            onClick={() => { setPage(p => Math.min(totalPages - 1, p + 1)); setExpanded(null); }}
            disabled={page === totalPages - 1}
            className="px-4 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-30 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function MiniStatCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  const bg: Record<string, string> = {
    emerald: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800',
    blue: 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800',
    purple: 'bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800',
    amber: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800',
  };
  const text: Record<string, string> = {
    emerald: 'text-emerald-700 dark:text-emerald-300',
    blue: 'text-blue-700 dark:text-blue-300',
    purple: 'text-purple-700 dark:text-purple-300',
    amber: 'text-amber-700 dark:text-amber-300',
  };
  return (
    <div className={`rounded-xl border px-4 py-3 ${bg[accent]}`}>
      <div className={`text-2xl font-bold ${text[accent]}`}>{value}</div>
      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</div>
    </div>
  );
}

function DifficultyDots({ d }: { d: number }) {
  return (
    <span className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <span
          key={i}
          className={`w-1.5 h-1.5 rounded-full ${
            i <= d ? 'bg-accent' : 'bg-gray-200 dark:bg-gray-700'
          }`}
        />
      ))}
    </span>
  );
}

function fmtTime(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

function fmtDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
