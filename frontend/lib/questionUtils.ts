import type { QuestionRecord, HintRecord, SolutionRecord } from './types';

/** Build the hint request payload for a question */
export function buildHintPayload(q: QuestionRecord, level: 1 | 2 | 3) {
  return {
    stem: q.stem,
    options: q.options,
    subject: q.subject,
    topic: q.topic,
    level,
  };
}

/** Build the solution request payload */
export function buildSolutionPayload(q: QuestionRecord) {
  return {
    question_id: q.question_id,
    stem: q.stem,
    options: q.options,
    subject: q.subject,
    topic: q.topic,
    subtopic: q.subtopic,
    verified_answer_label: q.answer_label ?? 'A',
    verified_answer_text: q.answer_text,
  };
}

/** Build the tutor request payload */
export function buildTutorPayload(
  q: QuestionRecord,
  chatHistory: { role: string; text: string }[],
  solution: SolutionRecord | undefined,
  hintsShown: HintRecord[]
) {
  return {
    stem: q.stem,
    options: q.options,
    subject: q.subject,
    topic: q.topic,
    subtopic: q.subtopic,
    difficulty: q.difficulty,
    chat_history: chatHistory,
    solution_available: Boolean(solution),
    worked_solution: solution?.worked_solution ?? null,
    hints_shown: hintsShown.length,
  };
}

/** Format elapsed time as mm:ss */
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Difficulty label */
export function difficultyLabel(d: number): string {
  return ['', 'Easy', 'Easy-Med', 'Medium', 'Med-Hard', 'Hard'][d] ?? 'Unknown';
}

/** Subject colour class */
export function subjectColor(subject: string): string {
  const s = subject.toLowerCase();
  if (s.startsWith('math')) return 'bg-blue-100 text-blue-800';
  if (s.startsWith('phys')) return 'bg-purple-100 text-purple-800';
  if (s.startsWith('chem')) return 'bg-yellow-100 text-yellow-800';
  if (s.startsWith('bio')) return 'bg-green-100 text-green-800';
  return 'bg-gray-100 text-gray-800';
}
