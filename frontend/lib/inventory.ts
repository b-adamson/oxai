import type { BankInventory } from './types';
import { api } from './api';

let cachedInventory: BankInventory | null = null;

/** Fetch and cache the question bank inventory from the backend */
export async function fetchInventory(): Promise<BankInventory> {
  if (cachedInventory) return cachedInventory;

  try {
    const raw = await api.inventory();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const subjects: BankInventory['subjects'] = {};
    for (const [key, val] of Object.entries(raw.subjects ?? {})) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const s = val as any;
      subjects[key] = {
        subject: key,
        total: s.total ?? 0,
        topics: Array.isArray(s.topics)
          ? s.topics.map(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (t: any) => ({
                topic: t.topic ?? '',
                subtopics: t.subtopics ?? {},
                count: t.count ?? 0,
                difficulty_counts: t.difficulty_counts ?? {},
                has_diagrams: Boolean(t.has_diagrams),
                archetypes: t.archetypes ?? [],
              })
            )
          : [],
        difficulty_distribution: s.difficulty_distribution ?? {},
      };
    }

    cachedInventory = { subjects, total: raw.total ?? 0, scanned_at: Date.now() };
    return cachedInventory;
  } catch {
    // Return empty inventory on failure — generation still works
    return { subjects: {}, total: 0, scanned_at: null };
  }
}

/** Get available topics for a subject from inventory */
export function getTopicsForSubject(inventory: BankInventory, subject: string): string[] {
  return (inventory.subjects[subject]?.topics ?? []).map((t) => t.topic);
}

/** Estimate how many bank questions are available for a given topic/difficulty */
export function estimateBankCount(
  inventory: BankInventory,
  subject: string,
  topic: string | null,
  difficulty: number | null
): number {
  const subj = inventory.subjects[subject];
  if (!subj) return 0;
  if (!topic) {
    if (!difficulty) return subj.total;
    return subj.difficulty_distribution[String(difficulty)] ?? 0;
  }
  const topicData = subj.topics.find((t) => t.topic === topic);
  if (!topicData) return 0;
  if (!difficulty) return topicData.count;
  return topicData.difficulty_counts[String(difficulty)] ?? 0;
}
