import type { AttemptRecord, MasteryStats, TopicMastery } from './types';

const WEAK_THRESHOLD = 0.6;
const STRONG_THRESHOLD = 0.8;
const RECENT_N = 10;

/** Compute mastery statistics from all stored attempts */
export function computeMastery(attempts: AttemptRecord[]): MasteryStats {
  if (attempts.length === 0) {
    return {
      overall_accuracy: 0,
      overall_attempts: 0,
      avg_time_seconds: 0,
      current_streak: 0,
      best_streak: 0,
      topics: {},
      weak_topics: [],
      strong_topics: [],
      last_updated: Date.now(),
    };
  }

  // Overall stats
  const answered = attempts.filter((a) => a.is_correct !== null);
  const correct = answered.filter((a) => a.is_correct).length;
  const overall_accuracy = answered.length > 0 ? correct / answered.length : 0;
  const avg_time_seconds =
    answered.length > 0
      ? answered.reduce((s, a) => s + a.time_taken_seconds, 0) / answered.length
      : 0;

  // Streaks (sorted by time)
  const sorted = [...answered].sort((a, b) => a.attempted_at - b.attempted_at);
  let current_streak = 0;
  let best_streak = 0;
  let run = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].is_correct) {
      run++;
      if (i === sorted.length - 1 - current_streak) current_streak = run;
    } else {
      if (current_streak === 0) break;
      run = 0;
    }
  }
  run = 0;
  for (const a of sorted) {
    if (a.is_correct) {
      run++;
      if (run > best_streak) best_streak = run;
    } else {
      run = 0;
    }
  }

  // Per-topic breakdown
  const topicMap: Record<string, AttemptRecord[]> = {};
  for (const a of answered) {
    const key = a.topic ?? '__unknown__';
    if (!topicMap[key]) topicMap[key] = [];
    topicMap[key].push(a);
  }

  const topics: Record<string, TopicMastery> = {};
  for (const [topic, topicAttempts] of Object.entries(topicMap)) {
    const tc = topicAttempts.filter((a) => a.is_correct).length;
    const accuracy = topicAttempts.length > 0 ? tc / topicAttempts.length : 0;
    const avgTime =
      topicAttempts.length > 0
        ? topicAttempts.reduce((s, a) => s + a.time_taken_seconds, 0) / topicAttempts.length
        : 0;
    const hint_dependence =
      topicAttempts.length > 0
        ? topicAttempts.filter((a) => a.hint_count > 0).length / topicAttempts.length
        : 0;
    const solution_dependence =
      topicAttempts.length > 0
        ? topicAttempts.filter((a) => a.solution_revealed).length / topicAttempts.length
        : 0;

    // Recent trend: compare last RECENT_N vs previous RECENT_N
    const recent = topicAttempts.slice(-RECENT_N);
    const prev = topicAttempts.slice(-RECENT_N * 2, -RECENT_N);
    let recent_trend: TopicMastery['recent_trend'] = 'unknown';
    if (recent.length >= 3 && prev.length >= 3) {
      const recentAcc = recent.filter((a) => a.is_correct).length / recent.length;
      const prevAcc = prev.filter((a) => a.is_correct).length / prev.length;
      if (recentAcc - prevAcc > 0.1) recent_trend = 'improving';
      else if (prevAcc - recentAcc > 0.1) recent_trend = 'declining';
      else recent_trend = 'stable';
    }

    topics[topic] = {
      topic,
      subject: 'math',
      attempts: topicAttempts.length,
      correct: tc,
      accuracy,
      avg_time_seconds: avgTime,
      hint_dependence,
      solution_dependence,
      recent_trend,
      last_attempt_at: Math.max(...topicAttempts.map((a) => a.attempted_at)),
    };
  }

  const weak_topics = Object.entries(topics)
    .filter(([, m]) => m.attempts >= 3 && m.accuracy < WEAK_THRESHOLD)
    .sort((a, b) => a[1].accuracy - b[1].accuracy)
    .map(([t]) => t);

  const strong_topics = Object.entries(topics)
    .filter(([, m]) => m.attempts >= 3 && m.accuracy >= STRONG_THRESHOLD)
    .sort((a, b) => b[1].accuracy - a[1].accuracy)
    .map(([t]) => t);

  return {
    overall_accuracy,
    overall_attempts: answered.length,
    avg_time_seconds,
    current_streak,
    best_streak,
    topics,
    weak_topics,
    strong_topics,
    last_updated: Date.now(),
  };
}
