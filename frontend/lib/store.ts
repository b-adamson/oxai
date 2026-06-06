'use client';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import { queueAttempt, queueQuestionState, queueSession } from './sync';
import type {
  AppState,
  QuestionRecord,
  HintRecord,
  SolutionRecord,
  TutorChatMessage,
  AttemptRecord,
  QuestionSession,
  QuickModeSession,
  PaperSession,
  BankInventory,
} from './types';

// ── Raw question from backend → QuestionRecord ────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normaliseQuestion(raw: Record<string, any>, mode: 'quick' | 'paper' | null, sourceType: 'bank' | 'fresh_ai'): QuestionRecord {
  const content = raw.content ?? {};
  const prompt = raw.prompt ?? {};
  const validation = raw.validation ?? {};
  const metadata = raw.metadata ?? {};
  const src = raw.source ?? {};
  const paperSource = (src.exam || src.year || src.question_number)
    ? { exam: src.exam, year: src.year, paper: src.paper, section: src.section, question_number: src.question_number }
    : undefined;
  return {
    question_id: raw.question_id ?? uuidv4(),
    source_type: sourceType,
    paper_source: paperSource,
    subject: content.subject ?? 'math',
    topic: content.topic ?? null,
    subtopic: content.subtopic ?? null,
    archetype: content.archetype ?? null,
    difficulty: content.difficulty ?? 2,
    stem: prompt.stem ?? '',
    options: prompt.options ?? [],
    figures: prompt.figures ?? [],
    answer_label: validation.answer_label ?? null,
    answer_text: validation.answer_text ?? null,
    has_diagram: Boolean(content.requires_diagram || metadata.diagram_required),
    diagram_url: (() => {
      const raw = metadata.diagram_url ?? null;
      if (!raw) return null;
      if (raw.startsWith('/diagrams/')) return raw.replace('/diagrams/', '/api/diagrams/');
      if (raw.startsWith('/images/')) return raw.replace('/images/', '/api/images/');
      return raw;
    })(),
    tags: metadata.tags ?? [],
    estimated_time_seconds: metadata.estimated_time_seconds ?? null,
    shown_in_mode: mode,
    created_at: Date.now(),
  };
}

// ── Store actions type ─────────────────────────────────────────

interface StoreActions {
  // Questions
  addQuestion: (q: QuestionRecord) => void;
  getQuestion: (id: string) => QuestionRecord | undefined;

  // Hints
  addHint: (h: HintRecord) => void;
  getHints: (questionId: string) => HintRecord[];

  // Solutions
  addSolution: (s: SolutionRecord) => void;
  getSolution: (questionId: string) => SolutionRecord | undefined;

  // Tutor
  addTutorMessage: (questionId: string, msg: TutorChatMessage) => void;
  getTutorThread: (questionId: string) => TutorChatMessage[];
  clearTutorThread: (questionId: string) => void;

  // Attempts
  recordAttempt: (a: AttemptRecord) => void;
  getAttempts: (questionId?: string) => AttemptRecord[];

  // Question sessions
  initQuestionSession: (session: QuestionSession) => void;
  updateQuestionSession: (questionId: string, update: Partial<QuestionSession>) => void;
  getQuestionSession: (questionId: string) => QuestionSession | undefined;

  // Quick mode
  setQuickSession: (s: QuickModeSession | null) => void;
  updateQuickSession: (update: Partial<QuickModeSession>) => void;

  // Paper sessions
  addPaperSession: (s: PaperSession) => void;
  updatePaperSession: (sessionId: string, update: Partial<PaperSession>) => void;
  setActivePaperSession: (id: string | null) => void;
  getActivePaperSession: () => PaperSession | undefined;

  // Inventory
  setInventory: (inv: BankInventory) => void;

  // Settings
  setLastSubject: (s: string) => void;
  setLastTopic: (t: string | null) => void;

  // Reset
  clearSession: () => void;
}

type Store = AppState & StoreActions;

const INITIAL_STATE: AppState = {
  questions: {},
  hints: {},
  solutions: {},
  tutorThreads: {},
  attempts: [],
  questionSessions: {},
  quickSession: null,
  paperSessions: [],
  activePaperSessionId: null,
  inventory: null,
  lastSubject: 'math',
  lastTopic: null,
};

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      ...INITIAL_STATE,

      addQuestion: (q) =>
        set((s) => ({ questions: { ...s.questions, [q.question_id]: q } })),

      getQuestion: (id) => get().questions[id],

      addHint: (h) => {
        set((s) => {
          const prev = s.hints[h.question_id] ?? [];
          const existing = prev.find((x) => x.level === h.level);
          if (existing) return s;
          return { hints: { ...s.hints, [h.question_id]: [...prev, h] } };
        });
        queueQuestionState(h.question_id);
      },

      getHints: (questionId) => get().hints[questionId] ?? [],

      addSolution: (sol) => {
        set((s) => ({ solutions: { ...s.solutions, [sol.question_id]: sol } }));
        queueQuestionState(sol.question_id);
      },

      getSolution: (questionId) => get().solutions[questionId],

      addTutorMessage: (questionId, msg) => {
        set((s) => {
          const thread = s.tutorThreads[questionId] ?? { question_id: questionId, messages: [] };
          return {
            tutorThreads: {
              ...s.tutorThreads,
              [questionId]: { ...thread, messages: [...thread.messages, msg] },
            },
          };
        });
        queueQuestionState(questionId);
      },

      getTutorThread: (questionId) =>
        (get().tutorThreads[questionId]?.messages ?? []),

      clearTutorThread: (questionId) => {
        set((s) => {
          const { [questionId]: _, ...rest } = s.tutorThreads;
          return { tutorThreads: rest };
        });
        queueQuestionState(questionId);
      },

      recordAttempt: (a) => {
        set((s) => ({ attempts: [...s.attempts, a] }));
        queueAttempt(a.attempt_id);
      },

      getAttempts: (questionId) => {
        const all = get().attempts;
        return questionId ? all.filter((a) => a.question_id === questionId) : all;
      },

      initQuestionSession: (session) =>
        set((s) => ({
          questionSessions: { ...s.questionSessions, [session.question_id]: session },
        })),

      updateQuestionSession: (questionId, update) =>
        set((s) => {
          const existing = s.questionSessions[questionId];
          if (!existing) return s;
          return {
            questionSessions: {
              ...s.questionSessions,
              [questionId]: { ...existing, ...update },
            },
          };
        }),

      getQuestionSession: (questionId) => get().questionSessions[questionId],

      setQuickSession: (session) => {
        set({ quickSession: session });
        if (session) queueSession('quick', session.session_id);
      },

      updateQuickSession: (update) => {
        set((s) => ({
          quickSession: s.quickSession ? { ...s.quickSession, ...update } : null,
        }));
        const q = get().quickSession;
        if (q) queueSession('quick', q.session_id);
      },

      addPaperSession: (session) => {
        set((s) => ({ paperSessions: [...s.paperSessions, session] }));
        queueSession('paper', session.session_id);
      },

      updatePaperSession: (sessionId, update) => {
        set((s) => ({
          paperSessions: s.paperSessions.map((p) =>
            p.session_id === sessionId ? { ...p, ...update, updated_at: Date.now() } : p
          ),
        }));
        queueSession('paper', sessionId);
      },

      setActivePaperSession: (id) => set({ activePaperSessionId: id }),

      getActivePaperSession: () => {
        const s = get();
        return s.paperSessions.find((p) => p.session_id === s.activePaperSessionId);
      },

      setInventory: (inv) => set({ inventory: inv }),

      setLastSubject: (subject) => set({ lastSubject: subject }),
      setLastTopic: (topic) => set({ lastTopic: topic }),

      clearSession: () =>
        set({ quickSession: null, questionSessions: {} }),
    }),
    {
      name: 'oxai-app-state',
      storage: createJSONStorage(() => {
        if (typeof window === 'undefined') {
          return {
            getItem: () => null,
            setItem: () => undefined,
            removeItem: () => undefined,
          };
        }
        return localStorage;
      }),
      // Only persist data that should survive page refresh
      partialize: (s) => ({
        questions: s.questions,
        hints: s.hints,
        solutions: s.solutions,
        tutorThreads: s.tutorThreads,
        attempts: s.attempts,
        questionSessions: s.questionSessions,
        quickSession: s.quickSession,
        paperSessions: s.paperSessions,
        activePaperSessionId: s.activePaperSessionId,
        inventory: s.inventory,
        lastSubject: s.lastSubject,
        lastTopic: s.lastTopic,
      }),
    }
  )
);
