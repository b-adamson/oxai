'use client';
// One-time migration of the legacy localStorage session store ("oxai_session_v1",
// formerly app/lib/session.ts) into the Zustand store. Safe to call on every
// mount: it no-ops once the legacy key is gone.

import { useStore, normaliseQuestion } from './store';
import type { HintRecord, SolutionRecord, TutorChatMessage } from './types';

const LEGACY_KEY = 'oxai_session_v1';

type LegacySession = {
  question_id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  question: Record<string, any>;
  hints?: { level: number; hint: string }[];
  solution?: {
    status: string;
    worked_solution: string;
    final_answer_label: string;
    requires_diagram: boolean;
    diagram_url: string | null;
  } | null;
  chat?: {
    role: 'user' | 'tutor';
    text: string;
    response_type?: TutorChatMessage['response_type'];
    timestamp: number;
  }[];
  created_at?: number;
  updated_at?: number;
};

export function migrateLegacySessions(): void {
  if (typeof window === 'undefined') return;

  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LEGACY_KEY);
  } catch {
    return;
  }
  if (!raw) return;

  try {
    const data = JSON.parse(raw) as { sessions?: Record<string, LegacySession> };
    const store = useStore.getState();

    for (const session of Object.values(data.sessions ?? {})) {
      if (!session?.question_id || !session.question) continue;
      const qid = session.question_id;

      // Past-paper questions carry a source year; everything else was generated.
      const sourceType = session.question.source?.year != null ? 'bank' : 'fresh_ai';

      if (!store.getQuestion(qid)) {
        const record = normaliseQuestion(session.question, null, sourceType);
        record.question_id = qid;
        record.created_at = session.created_at ?? record.created_at;
        store.addQuestion(record);
      }

      for (const h of session.hints ?? []) {
        if (h.level !== 1 && h.level !== 2 && h.level !== 3) continue;
        const hint: HintRecord = {
          question_id: qid,
          level: h.level,
          hint: h.hint,
          generated_at: session.updated_at ?? Date.now(),
        };
        store.addHint(hint); // addHint dedupes by level
      }

      if (session.solution && !store.getSolution(qid)) {
        const sol: SolutionRecord = {
          question_id: qid,
          status: session.solution.status,
          worked_solution: session.solution.worked_solution,
          final_answer_label: session.solution.final_answer_label,
          requires_diagram: session.solution.requires_diagram,
          diagram_url: session.solution.diagram_url,
          generated_at: session.updated_at ?? Date.now(),
        };
        store.addSolution(sol);
      }

      if (session.chat?.length && store.getTutorThread(qid).length === 0) {
        for (const m of session.chat) {
          store.addTutorMessage(qid, {
            role: m.role,
            text: m.text,
            response_type: m.response_type,
            timestamp: m.timestamp,
          });
        }
      }
    }
  } catch (err) {
    // Corrupt legacy data — drop it rather than retrying forever.
    console.error('Legacy session migration failed:', err);
  }

  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // ignore
  }
}
