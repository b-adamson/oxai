// Local session store — persists questions, hints, solutions, and chat threads
// to localStorage. Keyed by question_id. Capped at MAX_SESSIONS entries.

const STORAGE_KEY = "oxai_session_v1";
const MAX_SESSIONS = 50;

// ── Shared types ────────────────────────────────────────────────────────────

export type ChatMessage = {
  id: string;
  role: "user" | "tutor";
  text: string;
  response_type?: "hint" | "explanation" | "walkthrough" | "redirect";
  timestamp: number;
};

export type HintRecord = {
  level: number;
  hint: string;
};

export type SolutionRecord = {
  status: string;
  worked_solution: string;
  final_answer_label: string;
  requires_diagram: boolean;
  diagram_url: string | null;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type QuestionRecord = Record<string, any>;

export type QuestionSession = {
  question_id: string;
  question: QuestionRecord;
  hints: HintRecord[];
  solution: SolutionRecord | null;
  chat: ChatMessage[];
  created_at: number;
  updated_at: number;
};

type Store = {
  version: 1;
  sessions: Record<string, QuestionSession>;
  order: string[]; // newest first, used to cap at MAX_SESSIONS
};

// ── Internal helpers ─────────────────────────────────────────────────────────

function empty(): Store {
  return { version: 1, sessions: {}, order: [] };
}

function load(): Store {
  if (typeof window === "undefined") return empty();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Store) : empty();
  } catch {
    return empty();
  }
}

function persist(store: Store): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // quota exceeded — not fatal
  }
}

function touch(store: Store, id: string): void {
  store.order = store.order.filter((x) => x !== id);
  store.order.unshift(id);
  if (store.order.length > MAX_SESSIONS) {
    const evicted = store.order.splice(MAX_SESSIONS);
    for (const eid of evicted) delete store.sessions[eid];
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export function getSession(questionId: string): QuestionSession | null {
  return load().sessions[questionId] ?? null;
}

export function upsertSession(
  patch: { question_id: string; question: QuestionRecord } & Partial<QuestionSession>
): void {
  const store = load();
  const existing = store.sessions[patch.question_id];
  const now = Date.now();

  store.sessions[patch.question_id] = {
    question_id: patch.question_id,
    question: patch.question ?? existing?.question ?? {},
    hints: patch.hints ?? existing?.hints ?? [],
    solution: patch.solution !== undefined ? patch.solution : (existing?.solution ?? null),
    chat: patch.chat ?? existing?.chat ?? [],
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };

  touch(store, patch.question_id);
  persist(store);
}

export function updateHints(questionId: string, hints: HintRecord[]): void {
  const store = load();
  const session = store.sessions[questionId];
  if (!session) return;
  session.hints = hints;
  session.updated_at = Date.now();
  persist(store);
}

export function updateSolution(questionId: string, solution: SolutionRecord): void {
  const store = load();
  const session = store.sessions[questionId];
  if (!session) return;
  session.solution = solution;
  session.updated_at = Date.now();
  persist(store);
}

export function appendChat(questionId: string, message: ChatMessage): void {
  const store = load();
  const session = store.sessions[questionId];
  if (!session) return;
  session.chat = [...session.chat, message];
  session.updated_at = Date.now();
  persist(store);
}

export function listSessions(): QuestionSession[] {
  const store = load();
  return store.order
    .map((id) => store.sessions[id])
    .filter(Boolean);
}

export function clearChat(questionId: string): void {
  const store = load();
  const session = store.sessions[questionId];
  if (!session) return;
  session.chat = [];
  session.updated_at = Date.now();
  persist(store);
}
