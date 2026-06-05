const BASE = process.env.NEXT_PUBLIC_API_BASE ?? '/api';

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path);
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

export interface GenerateQuestionParams {
  subject: string;
  topic?: string | null;
  difficulty?: number;
  examples?: number;
  want_solution?: boolean;
  want_diagram?: boolean;
  force_diagram?: boolean;
}

export interface GenerateSimilarParams {
  original_question_id: string;
  stem: string;
  options: { label: string; text: string }[];
  subject: string;
  topic?: string | null;
  subtopic?: string | null;
  difficulty?: number;
  want_solution?: boolean;
}

export interface HintParams {
  stem: string;
  options: { label: string; text: string }[];
  subject: string;
  topic?: string | null;
  level: 1 | 2 | 3;
}

export interface SolutionParams {
  question_id?: string | null;
  stem: string;
  options: { label: string; text: string }[];
  subject: string;
  topic?: string | null;
  subtopic?: string | null;
  verified_answer_label: string;
  verified_answer_text?: string | null;
}

export interface TutorParams {
  stem: string;
  options: { label: string; text: string }[];
  subject: string;
  topic?: string | null;
  subtopic?: string | null;
  difficulty?: number | null;
  chat_history: { role: string; text: string }[];
  solution_available: boolean;
  worked_solution?: string | null;
  hints_shown: number;
}

export interface BankQueryParams {
  subject?: string | null;
  topic?: string | null;
  difficulty?: number | null;
  limit?: number;
  exclude_ids?: string[];
  excluded_years?: number[];
}

export type SolutionResponse = {
  status: string;
  worked_solution: string;
  final_answer_label: string;
  requires_diagram: boolean;
  diagram_url: string | null;
};

export type TutorResponse = { response: string; response_type: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

export const api = {
  generateQuestion: (p: GenerateQuestionParams) =>
    post<AnyRecord>('/generate', p),

  generateSimilar: (p: GenerateSimilarParams) =>
    post<AnyRecord>('/generate-similar', p),

  getHint: (p: HintParams) =>
    post<{ level: number; hint: string }>('/hint', p),

  getSolution: (p: SolutionParams) =>
    post<SolutionResponse>('/solution', p),

  askTutor: (p: TutorParams) =>
    post<TutorResponse>('/ask-tutor', p),

  bankQuestions: (p: BankQueryParams) =>
    post<{ questions: AnyRecord[]; total: number }>('/bank-questions', p),

  inventory: () =>
    get<{ subjects: Record<string, unknown>; total: number; scanned_at: null }>('/inventory'),
};
