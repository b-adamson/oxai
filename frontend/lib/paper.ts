import { v4 as uuidv4 } from 'uuid';
import type {
  PaperBlueprint,
  PaperSession,
  DifficultyPreset,
  Subject,
} from './types';

// ── Blueprint presets ─────────────────────────────────────────

export type PresetName = 'realistic' | 'olympiad' | 'hard' | 'practice' | 'custom';

interface PresetDefinition {
  name: string;
  description: string;
  paper_length: number;
  difficulty_range: [number, number];
  difficulty_preset: DifficultyPreset;
  diagram_fraction: number;
  bank_fraction: number;
  preload_count: number;
  background_concurrency_limit: number;
}

export const PRESETS: Record<PresetName, PresetDefinition> = {
  realistic: {
    name: 'Realistic ESAT',
    description: 'Mixed difficulty matching real ESAT/NSAA papers. Most questions at difficulty 2–3.',
    paper_length: 27,
    difficulty_range: [2, 4],
    difficulty_preset: 'realistic',
    diagram_fraction: 0.15,
    bank_fraction: 0.5,
    preload_count: 10,
    background_concurrency_limit: 3,
  },
  olympiad: {
    name: 'Olympiad',
    description: 'Hardest questions only. Multi-step reasoning, demanding distractors.',
    paper_length: 20,
    difficulty_range: [4, 5],
    difficulty_preset: 'olympiad',
    diagram_fraction: 0.1,
    bank_fraction: 0.2,
    preload_count: 8,
    background_concurrency_limit: 2,
  },
  hard: {
    name: 'Hard',
    description: 'Difficulty 3–5. Good exam prep for strong students.',
    paper_length: 25,
    difficulty_range: [3, 5],
    difficulty_preset: 'hard',
    diagram_fraction: 0.15,
    bank_fraction: 0.4,
    preload_count: 10,
    background_concurrency_limit: 3,
  },
  practice: {
    name: 'Practice',
    description: 'Easier and varied. Good for mixed topic revision.',
    paper_length: 20,
    difficulty_range: [1, 3],
    difficulty_preset: 'easy',
    diagram_fraction: 0.1,
    bank_fraction: 0.6,
    preload_count: 8,
    background_concurrency_limit: 3,
  },
  custom: {
    name: 'Custom',
    description: 'You control everything.',
    paper_length: 20,
    difficulty_range: [2, 4],
    difficulty_preset: 'custom',
    diagram_fraction: 0.1,
    bank_fraction: 0.5,
    preload_count: 8,
    background_concurrency_limit: 3,
  },
};

// ── Blueprint builder ─────────────────────────────────────────

export interface BlueprintOptions {
  preset: PresetName;
  subject: Subject;
  paper_length?: number;
  topic_weights?: Record<string, number>;
  must_include_topics?: string[];
  excluded_topics?: string[];
  custom_difficulty_range?: [number, number];
  custom_paper_length?: number;
}

export function buildBlueprint(opts: BlueprintOptions): PaperBlueprint {
  const preset = PRESETS[opts.preset];
  return {
    blueprint_id: uuidv4(),
    name: preset.name,
    paper_length: opts.custom_paper_length ?? opts.paper_length ?? preset.paper_length,
    difficulty_preset: preset.difficulty_preset,
    target_subject: opts.subject,
    topic_mode: Object.keys(opts.topic_weights ?? {}).length > 0 ? 'custom_mix' : 'all_topics',
    topic_weights: opts.topic_weights ?? {},
    bank_fraction: preset.bank_fraction,
    diagram_fraction: preset.diagram_fraction,
    diagram_policy: 'sometimes',
    source_policy: 'balanced',
    ordering_policy: 'fixed',
    preload_count: preset.preload_count,
    background_concurrency_limit: preset.background_concurrency_limit,
    must_include_topics: opts.must_include_topics ?? [],
    excluded_topics: opts.excluded_topics ?? [],
    difficulty_range: opts.custom_difficulty_range ?? preset.difficulty_range,
  };
}

// ── Session builder ───────────────────────────────────────────

export function buildPaperSession(blueprint: PaperBlueprint): PaperSession {
  return {
    session_id: uuidv4(),
    blueprint,
    modules: [],
    slots: [],
    status: 'planning',
    current_slot_index: 0,
    start_time: null,
    end_time: null,
    total_answered: 0,
    total_correct: 0,
    submitted_answers: {},
    revealed_solutions: [],
    timer_duration_seconds: null,
    live_solution: false,
    submitted: false,
    created_at: Date.now(),
    updated_at: Date.now(),
  };
}

// ── Paper progress helpers ────────────────────────────────────

export function paperProgress(session: PaperSession) {
  const total = session.blueprint.paper_length;
  const answered = session.total_answered;
  const ready = session.slots.filter((s) => s.status === 'ready').length;
  const generated = session.slots.filter(
    (s) => s.status === 'ready' || s.status === 'shown' || s.status === 'answered'
  ).length;
  const score =
    session.total_answered > 0
      ? Math.round((session.total_correct / session.total_answered) * 100)
      : null;

  return { total, answered, ready, generated, score };
}

export function firstTrancheReady(session: PaperSession): boolean {
  const readyCount = session.slots.filter((s) => s.status === 'ready').length;
  return readyCount >= Math.min(session.blueprint.preload_count, session.blueprint.paper_length);
}
