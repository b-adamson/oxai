'use client';
// Write-through sync between the Zustand store and the server.
//
// Store actions enqueue tiny references ({kind, id}) into an outbox; the
// flush builds payloads from current store state and pushes them through the
// RLS-scoped API routes. Guests enqueue nothing — signing in turns syncing on.
// The outbox persists in localStorage so a closed tab doesn't lose writes.

import { useStore } from './store';
import type { AttemptRecord, PaperSession, QuickModeSession } from './types';

const OUTBOX_KEY = 'oxai-sync-outbox';
const FLUSH_DEBOUNCE_MS = 1500;
const RETRY_MS = 10000;

type SyncItem =
  | { kind: 'attempt'; id: string }
  | { kind: 'qstate'; id: string }
  | { kind: 'session'; id: string; sessionKind: 'paper' | 'quick' };

let authed = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

// ── Outbox persistence ───────────────────────────────────────────────────────

function loadOutbox(): SyncItem[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function saveOutbox(items: SyncItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(items));
  } catch {
    // quota exceeded — not fatal
  }
}

function enqueue(item: SyncItem): void {
  if (!authed) return; // guests don't sync
  const outbox = loadOutbox();
  const exists = outbox.some((i) => i.kind === item.kind && i.id === item.id);
  if (!exists) {
    outbox.push(item);
    saveOutbox(outbox);
  }
  scheduleFlush(FLUSH_DEBOUNCE_MS);
}

// ── Public enqueue API (called from store actions) ───────────────────────────

export function queueAttempt(attemptId: string): void {
  enqueue({ kind: 'attempt', id: attemptId });
}

export function queueQuestionState(questionId: string): void {
  enqueue({ kind: 'qstate', id: questionId });
}

export function queueSession(sessionKind: 'paper' | 'quick', sessionId: string): void {
  enqueue({ kind: 'session', id: sessionId, sessionKind });
}

// ── Flush ────────────────────────────────────────────────────────────────────

export function scheduleFlush(delayMs: number = FLUSH_DEBOUNCE_MS): void {
  if (typeof window === 'undefined') return;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, delayMs);
}

async function pushItem(item: SyncItem): Promise<boolean> {
  const s = useStore.getState();

  if (item.kind === 'attempt') {
    const attempt = s.attempts.find((a) => a.attempt_id === item.id);
    if (!attempt) return true; // gone locally — nothing to push
    const subject = s.questions[attempt.question_id]?.subject ?? s.lastSubject ?? 'unknown';
    const res = await fetch('/api/attempts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attempt: { ...attempt, subject } }),
    });
    return res.ok;
  }

  if (item.kind === 'qstate') {
    const res = await fetch(`/api/question-state/${encodeURIComponent(item.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hints: s.hints[item.id] ?? [],
        solution: s.solutions[item.id] ?? null,
        tutor_thread: s.tutorThreads[item.id]?.messages ?? [],
      }),
    });
    return res.ok;
  }

  // session
  let payload: PaperSession | QuickModeSession | undefined;
  let status: string | undefined;
  let started_at: number | null = null;
  let ended_at: number | null = null;

  if (item.sessionKind === 'paper') {
    const p = s.paperSessions.find((x) => x.session_id === item.id);
    if (!p) return true;
    payload = p;
    status = p.status;
    started_at = p.start_time;
    ended_at = p.end_time;
  } else {
    const q = s.quickSession;
    if (!q || q.session_id !== item.id) return true;
    payload = q;
    status = q.status;
    started_at = q.created_at;
  }

  const res = await fetch('/api/sessions', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: item.id,
      kind: item.sessionKind,
      status,
      payload,
      started_at,
      ended_at,
    }),
  });
  return res.ok;
}

async function flush(): Promise<void> {
  if (!authed || flushing) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    scheduleFlush(RETRY_MS);
    return;
  }

  flushing = true;
  try {
    let outbox = loadOutbox();
    while (outbox.length > 0) {
      const item = outbox[0];
      let ok = false;
      try {
        ok = await pushItem(item);
      } catch {
        ok = false;
      }
      if (!ok) {
        scheduleFlush(RETRY_MS);
        return;
      }
      outbox = loadOutbox().filter((i) => !(i.kind === item.kind && i.id === item.id));
      saveOutbox(outbox);
    }
  } finally {
    flushing = false;
  }
}

// ── Hydration (server → store, on sign-in) ───────────────────────────────────

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function hydrateFromServer(): Promise<void> {
  const [attemptsData, statesData, sessionsData] = await Promise.all([
    fetchJson<{ attempts: AttemptRecord[] }>('/api/attempts'),
    fetchJson<{
      states: {
        question_id: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        hints: any[];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        solution: any | null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tutor_thread: any[];
      }[];
    }>('/api/question-state'),
    fetchJson<{
      sessions: {
        id: string;
        kind: 'paper' | 'quick';
        status: string;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        payload: any;
        updated_at: string;
      }[];
    }>('/api/sessions'),
  ]);

  useStore.setState((s) => {
    const update: Partial<typeof s> = {};

    // Attempts: union by attempt_id.
    if (attemptsData?.attempts?.length) {
      const known = new Set(s.attempts.map((a) => a.attempt_id));
      const fresh = attemptsData.attempts.filter((a) => !known.has(a.attempt_id));
      if (fresh.length) {
        update.attempts = [...s.attempts, ...fresh].sort(
          (a, b) => a.attempted_at - b.attempted_at
        );
      }
    }

    // Question state: fill gaps; local wins where both exist.
    if (statesData?.states?.length) {
      const hints = { ...s.hints };
      const solutions = { ...s.solutions };
      const tutorThreads = { ...s.tutorThreads };
      for (const row of statesData.states) {
        const qid = row.question_id;
        const localHints = hints[qid] ?? [];
        const serverHints = Array.isArray(row.hints) ? row.hints : [];
        const haveLevels = new Set(localHints.map((h) => h.level));
        const merged = [...localHints, ...serverHints.filter((h) => !haveLevels.has(h?.level))];
        if (merged.length) hints[qid] = merged;

        if (!solutions[qid] && row.solution) solutions[qid] = row.solution;

        const localThread = tutorThreads[qid]?.messages ?? [];
        const serverThread = Array.isArray(row.tutor_thread) ? row.tutor_thread : [];
        if (serverThread.length > localThread.length) {
          tutorThreads[qid] = { question_id: qid, messages: serverThread };
        }
      }
      update.hints = hints;
      update.solutions = solutions;
      update.tutorThreads = tutorThreads;
    }

    // Sessions: later updated_at wins per id; adopt server quick session if
    // there is no local one.
    if (sessionsData?.sessions?.length) {
      const paperRows = sessionsData.sessions.filter((r) => r.kind === 'paper');
      if (paperRows.length) {
        const byId = new Map(s.paperSessions.map((p) => [p.session_id, p]));
        for (const row of paperRows) {
          const server = row.payload as PaperSession;
          if (!server?.session_id) continue;
          const local = byId.get(server.session_id);
          const serverUpdated = new Date(row.updated_at).getTime();
          if (!local || serverUpdated > (local.updated_at ?? 0)) {
            byId.set(server.session_id, server);
          }
        }
        update.paperSessions = [...byId.values()];
      }

      if (!s.quickSession) {
        const quickRow = sessionsData.sessions.find(
          (r) => r.kind === 'quick' && (r.status === 'active' || r.status === 'paused')
        );
        if (quickRow?.payload?.session_id) {
          update.quickSession = quickRow.payload as QuickModeSession;
        }
      }
    }

    return update;
  });
}

// ── Auth wiring (called by SyncManager) ──────────────────────────────────────

export function setSyncAuthed(value: boolean): void {
  const wasAuthed = authed;
  authed = value;
  if (value && !wasAuthed) {
    void hydrateFromServer().then(() => scheduleFlush(0));
  }
}

export function isSyncAuthed(): boolean {
  return authed;
}
