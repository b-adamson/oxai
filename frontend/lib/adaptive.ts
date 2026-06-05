import type {
  MasteryStats,
  QuickModeConfig,
  AdaptivePolicy,
  DiagramPolicy,
  DifficultyPreset,
  BankInventory,
} from './types';

const DIFFICULTY_RANGES: Record<DifficultyPreset, [number, number]> = {
  easy: [1, 2],
  realistic: [2, 4],
  hard: [3, 5],
  olympiad: [4, 5],
  custom: [1, 5],
};

function clampDifficulty(d: number): number {
  return Math.max(1, Math.min(5, Math.round(d)));
}

function pickDifficulty(preset: DifficultyPreset, custom: number, mastery?: MasteryStats): number {
  if (preset === 'custom') return clampDifficulty(custom);
  const [lo, hi] = DIFFICULTY_RANGES[preset];
  if (!mastery || mastery.overall_attempts < 5) {
    return Math.round((lo + hi) / 2);
  }
  // Adapt: if recent accuracy is high, nudge up; if low, nudge down
  const acc = mastery.overall_accuracy;
  if (acc > 0.85) return clampDifficulty(hi);
  if (acc < 0.4) return clampDifficulty(lo);
  // Interpolate across the range based on accuracy
  return clampDifficulty(lo + Math.round((hi - lo) * acc));
}

/** Pick the next topic based on config + mastery */
function pickTopic(
  config: QuickModeConfig,
  mastery: MasteryStats,
  inventory: BankInventory | null
): string | null {
  switch (config.topic_mode) {
    case 'all_topics':
      return null; // Let backend pick randomly

    case 'weak_topics': {
      if (mastery.weak_topics.length > 0) {
        // Pick randomly among weak topics with some exploration
        const idx = Math.floor(Math.random() * Math.min(3, mastery.weak_topics.length));
        return mastery.weak_topics[idx] ?? null;
      }
      return null;
    }

    case 'custom_topic': {
      if (config.custom_topics.length === 0) return null;
      return config.custom_topics[Math.floor(Math.random() * config.custom_topics.length)];
    }

    case 'custom_mix': {
      const pool = buildWeightedPool(config, mastery, inventory);
      if (pool.length === 0) return null;
      return pool[Math.floor(Math.random() * pool.length)];
    }

    default:
      return null;
  }
}

/** Build a probability-weighted topic pool */
function buildWeightedPool(
  config: QuickModeConfig,
  mastery: MasteryStats,
  inventory: BankInventory | null
): string[] {
  const topics: string[] = [];

  // Explicit custom topics first
  for (const t of config.custom_topics) {
    topics.push(t, t); // weight 2
  }

  // Weak topics get extra weight
  for (const t of mastery.weak_topics.slice(0, 5)) {
    topics.push(t, t, t); // weight 3
  }

  // Strong topics once
  for (const t of mastery.strong_topics.slice(0, 3)) {
    topics.push(t);
  }

  // Inventory topics as padding
  if (inventory) {
    const subj = inventory.subjects[config.target_subject];
    if (subj) {
      for (const t of subj.topics) {
        if (!topics.includes(t.topic)) topics.push(t.topic);
      }
    }
  }

  return topics;
}

/** Decide diagram policy for a slot */
function shouldRequestDiagram(policy: DiagramPolicy): boolean {
  if (policy === 'never') return false;
  if (policy === 'often') return Math.random() < 0.4;
  return Math.random() < 0.15; // 'sometimes'
}

/** Main adaptive policy function */
export function computeAdaptivePolicy(
  config: QuickModeConfig,
  mastery: MasteryStats,
  inventory: BankInventory | null
): AdaptivePolicy {
  const topic = pickTopic(config, mastery, inventory);
  const difficulty = pickDifficulty(config.difficulty_preset, config.custom_difficulty, mastery);
  const wantDiagram = shouldRequestDiagram(config.diagram_policy);

  return {
    topic,
    subtopic: null,
    difficulty,
    diagram_policy: wantDiagram ? 'sometimes' : 'never',
    concept_or_calculation: 'either',
    source_type: 'either',
  };
}

/** Compute difficulty for a paper slot based on blueprint */
export function blueprintDifficulty(
  index: number,
  total: number,
  range: [number, number]
): number {
  const [lo, hi] = range;
  // Roughly uniform distribution across the range, no strict ordering
  const spread = hi - lo;
  if (spread === 0) return lo;
  const fraction = (index % (spread + 1)) / spread;
  return clampDifficulty(lo + Math.round(fraction * spread));
}
