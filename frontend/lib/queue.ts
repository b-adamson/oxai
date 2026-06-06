/**
 * Shared slot/queue engine powering both Quick Mode and Paper Mode.
 *
 * Slots go through: planned → generating → ready → shown → answered (or failed)
 *
 * The engine:
 *  - Plans N slots based on config/blueprint
 *  - Generates questions concurrently up to concurrency limit
 *  - Retries failed slots
 *  - Signals callers via callbacks when slots become ready
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  PaperSlot,
  PaperBlueprint,
  QuickModeConfig,
  BankInventory,
  MasteryStats,
  Difficulty,
  DifficultyPreset,
  SourceType,
} from './types';
import { api } from './api';
import { normaliseQuestion } from './store';
import { computeAdaptivePolicy, blueprintDifficulty } from './adaptive';
import type { QuestionRecord } from './types';

const ESAT_DIFFICULTY_RANGES: Record<DifficultyPreset, [number, number]> = {
  easy: [1, 2],
  realistic: [2, 4],
  hard: [3, 5],
  olympiad: [4, 5],
  custom: [2, 4],
};

const QUESTIONS_PER_MODULE = 20;

const MAX_RETRIES = 2;

// ── ESAT 20/20/20 slot planner ────────────────────────────────

/**
 * Plan 60 slots for an ESAT paper: 20 questions per module.
 * bankFraction controls what proportion come from the question bank
 * (0.0 = all fresh AI, 1.0 = all bank). Bank slots are placed first
 * within each module so they generate quickly; AI slots follow.
 * Diagrams are capped at ~15% of questions per module to prevent
 * geometry from dominating the paper.
 */
export function planEsatPaperSlots(
  modules: string[],
  bankFraction: number,
  difficultyPreset: DifficultyPreset,
  excludedYears: number[] = [],
): PaperSlot[] {
  const range = ESAT_DIFFICULTY_RANGES[difficultyPreset] ?? [2, 4];
  const bankPerModule = Math.round(Math.max(0, Math.min(1, bankFraction)) * QUESTIONS_PER_MODULE);
  // ~15% of slots allow diagrams — model decides whether to include one for those slots
  const diagPerModule = Math.round(0.15 * QUESTIONS_PER_MODULE);

  const slots: PaperSlot[] = [];
  modules.forEach((module, moduleIdx) => {
    // Interleave bank and AI questions evenly via Fisher-Yates shuffle
    const sourceTypes: SourceType[] = [
      ...Array(bankPerModule).fill('bank' as SourceType),
      ...Array(QUESTIONS_PER_MODULE - bankPerModule).fill('fresh_ai' as SourceType),
    ];
    for (let k = sourceTypes.length - 1; k > 0; k--) {
      const j = Math.floor(Math.random() * (k + 1));
      [sourceTypes[k], sourceTypes[j]] = [sourceTypes[j], sourceTypes[k]];
    }

    // Assign diagram slots spaced evenly, not front-loaded
    const diagReqs: ('never' | 'allowed')[] = Array(QUESTIONS_PER_MODULE).fill('never');
    const step = QUESTIONS_PER_MODULE / (diagPerModule + 1);
    for (let d = 0; d < diagPerModule; d++) {
      const pos = Math.round(step * (d + 1)) % QUESTIONS_PER_MODULE;
      diagReqs[pos] = 'allowed';
    }

    for (let i = 0; i < QUESTIONS_PER_MODULE; i++) {
      const difficulty = blueprintDifficulty(i, QUESTIONS_PER_MODULE, range) as Difficulty;
      const sourceType: SourceType = sourceTypes[i];
      slots.push({
        slot_id: uuidv4(),
        position: moduleIdx * QUESTIONS_PER_MODULE + i,
        subject: module,
        topic: null,
        subtopic: null,
        difficulty,
        diagram_requirement: diagReqs[i],
        source_type: sourceType,
        status: 'planned',
        question_id: null,
        retry_count: 0,
        error: null,
        excluded_years: excludedYears.length > 0 ? excludedYears : undefined,
      });
    }
  });
  return slots;
}

// ── Slot planning ─────────────────────────────────────────────

export function planQuickSlots(
  config: QuickModeConfig,
  mastery: MasteryStats,
  inventory: BankInventory | null,
  count: number,
  startPosition = 0
): PaperSlot[] {
  return Array.from({ length: count }, (_, i) => {
    const policy = computeAdaptivePolicy(config, mastery, inventory);
    return {
      slot_id: uuidv4(),
      position: startPosition + i,
      subject: config.target_subject,
      topic: policy.topic,
      subtopic: policy.subtopic,
      difficulty: policy.difficulty as Difficulty,
      diagram_requirement: policy.diagram_policy === 'never' ? 'never' : 'allowed',
      source_type: 'either',
      status: 'planned',
      question_id: null,
      retry_count: 0,
      error: null,
    };
  });
}

export function planPaperSlots(blueprint: PaperBlueprint): PaperSlot[] {
  const topics = Object.keys(blueprint.topic_weights);
  const totalWeight = Object.values(blueprint.topic_weights).reduce((s, w) => s + w, 0);

  return Array.from({ length: blueprint.paper_length }, (_, i) => {
    const difficulty = blueprintDifficulty(i, blueprint.paper_length, blueprint.difficulty_range) as Difficulty;

    // Weighted topic selection
    let topic: string | null = null;
    if (topics.length > 0 && totalWeight > 0) {
      let r = Math.random() * totalWeight;
      for (const [t, w] of Object.entries(blueprint.topic_weights)) {
        r -= w;
        if (r <= 0) {
          topic = t;
          break;
        }
      }
      if (!topic) topic = topics[topics.length - 1];
    }

    const wantDiagram =
      blueprint.diagram_policy !== 'never' &&
      (i / blueprint.paper_length) < blueprint.diagram_fraction;

    return {
      slot_id: uuidv4(),
      position: i,
      subject: blueprint.target_subject,
      topic,
      subtopic: null,
      difficulty,
      diagram_requirement: wantDiagram ? 'allowed' : 'never',
      source_type: blueprint.source_policy === 'prefer_bank' ? 'bank' : 'fresh_ai',
      status: 'planned' as const,
      question_id: null,
      retry_count: 0,
      error: null,
    };
  });
}

// ── Question generation for a slot ────────────────────────────

export async function generateForSlot(
  slot: PaperSlot,
  usedBankIds?: Set<string>,
): Promise<{ slot: PaperSlot; question: QuestionRecord }> {
  // Try bank first for bank/either slots
  if (slot.source_type === 'bank' || slot.source_type === 'either') {
    try {
      const result = await api.bankQuestions({
        subject: slot.subject,
        topic: slot.topic,
        difficulty: slot.difficulty,
        limit: 30,
        exclude_ids: usedBankIds ? Array.from(usedBankIds) : [],
        excluded_years: slot.excluded_years,
      });
      if (result.questions.length > 0) {
        const raw = result.questions[Math.floor(Math.random() * result.questions.length)];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const q = raw as Record<string, any>;
        const qid: string = q.question_id ?? q.id ?? '';
        if (qid) usedBankIds?.add(qid);
        const question = normaliseQuestion(raw, null, 'bank');
        return {
          slot: { ...slot, status: 'ready' as const, question_id: question.question_id, error: null },
          question,
        };
      }
    } catch {
      // bank unavailable — fall through to AI generation
    }
    // If slot was strictly 'bank' but nothing found, generate fresh AI as fallback
  }

  // 'required' → must have diagram; 'allowed' → model decides; 'never' → no diagram.
  const want_diagram = slot.diagram_requirement !== 'never';
  const raw = await api.generateQuestion({
    subject: slot.subject,
    topic: slot.topic,
    difficulty: slot.difficulty,
    examples: 3,
    want_solution: true,
    want_diagram,
    force_diagram: slot.diagram_requirement === 'required',
  });

  const question = normaliseQuestion(raw, null, 'fresh_ai');
  return {
    slot: { ...slot, status: 'ready' as const, question_id: question.question_id, error: null },
    question,
  };
}

// ── Background generation runner ──────────────────────────────

export interface GenerationCallbacks {
  onSlotReady: (slot: PaperSlot, question: QuestionRecord) => void;
  onSlotFailed: (slot: PaperSlot, error: string) => void;
  onSlotGenerating: (slot: PaperSlot) => void;
}

/**
 * Launch background generation for a batch of planned slots.
 * Concurrency is capped; returns a cancel function.
 */
export function startBackgroundGeneration(
  slots: PaperSlot[],
  concurrency: number,
  callbacks: GenerationCallbacks
): () => void {
  let cancelled = false;
  const planned = slots.filter((s) => s.status === 'planned');
  // Shared set prevents duplicate bank questions across concurrent generations
  const usedBankIds = new Set<string>();
  let inFlight = 0;
  let index = 0;

  function tryLaunch() {
    while (inFlight < concurrency && index < planned.length && !cancelled) {
      const slot = planned[index++];
      inFlight++;
      callbacks.onSlotGenerating({ ...slot, status: 'generating' });

      const attempt = async (retries: number): Promise<void> => {
        if (cancelled) return;
        try {
          const { slot: readySlot, question } = await generateForSlot(slot, usedBankIds);
          if (!cancelled) callbacks.onSlotReady(readySlot, question);
        } catch (err) {
          if (retries > 0 && !cancelled) {
            await new Promise((r) => setTimeout(r, 1500));
            return attempt(retries - 1);
          }
          const failedSlot: PaperSlot = {
            ...slot,
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
            retry_count: MAX_RETRIES - retries,
          };
          if (!cancelled) callbacks.onSlotFailed(failedSlot, failedSlot.error ?? 'Unknown');
        } finally {
          inFlight--;
          tryLaunch();
        }
      };

      attempt(MAX_RETRIES).catch(() => {});
    }
  }

  tryLaunch();
  return () => { cancelled = true; };
}

// ── Queue refill logic ────────────────────────────────────────

/** How many more slots need to be planned to reach the min preload count */
export function slotsNeeded(slots: PaperSlot[], minReady: number): number {
  const ready = slots.filter((s) => s.status === 'ready').length;
  const generating = slots.filter((s) => s.status === 'generating').length;
  const pipeline = ready + generating;
  return Math.max(0, minReady - pipeline);
}

/** Get the next ready (unshown) slot */
export function nextReadySlot(slots: PaperSlot[]): PaperSlot | null {
  return slots.find((s) => s.status === 'ready') ?? null;
}

/** Count slots by status */
export function slotCounts(slots: PaperSlot[]) {
  const counts = { planned: 0, generating: 0, ready: 0, shown: 0, answered: 0, failed: 0 };
  for (const s of slots) counts[s.status] = (counts[s.status] ?? 0) + 1;
  return counts;
}
