'use client';
import type { ReactNode } from 'react';
import type { MasteryStats } from '@/lib/types';
import { formatTime } from '@/lib/questionUtils';

interface AnalyticsDashboardProps {
  stats: MasteryStats;
}

type PieSlice = { value: number; color: string; label: string };

function buildPieSlices(
  slices: PieSlice[],
  total: number,
  cx: number,
  cy: number,
  r: number,
): ReactNode[] {
  let angle = -90;
  return slices.map((slice) => {
    if (slice.value === 0) return null;
    const sweep = (slice.value / total) * 360;
    const start = angle;
    const end = angle + sweep;
    angle = end;
    const x1 = cx + r * Math.cos((start * Math.PI) / 180);
    const y1 = cy + r * Math.sin((start * Math.PI) / 180);
    const x2 = cx + r * Math.cos((end * Math.PI) / 180);
    const y2 = cy + r * Math.sin((end * Math.PI) / 180);
    const large = sweep > 180 ? 1 : 0;
    return (
      <path
        key={slice.label}
        d={`M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${large},1 ${x2.toFixed(2)},${y2.toFixed(2)} Z`}
        fill={slice.color}
      />
    );
  });
}

function DonutChart({
  pct,
  label,
  sub,
  color,
  trackColor = '#d1d5db',
}: {
  pct: number;
  label: string;
  sub?: string;
  color: string;
  trackColor?: string;
}) {
  const r = 34;
  const circ = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(pct, 1)) * circ;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative w-20 h-20">
        <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
          <circle cx="40" cy="40" r={r} fill="none" stroke={trackColor} strokeWidth="10" className="dark:opacity-30" />
          <circle
            cx="40"
            cy="40"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="10"
            strokeDasharray={`${filled.toFixed(2)} ${circ.toFixed(2)}`}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs font-bold text-gray-800 dark:text-gray-200">
            {Math.round(pct * 100)}%
          </span>
        </div>
      </div>
      <div className="text-center">
        <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">{label}</div>
        {sub && <div className="text-xs text-gray-400 dark:text-gray-500">{sub}</div>}
      </div>
    </div>
  );
}

function PieChart({ slices, title }: { slices: PieSlice[]; title: string }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const hasData = total > 0;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative w-20 h-20">
        <svg viewBox="0 0 80 80" className="w-full h-full">
          {hasData ? (
            <>
              {buildPieSlices(slices, total, 40, 40, 34)}
              <circle cx="40" cy="40" r="20" className="fill-white dark:fill-gray-900" />
            </>
          ) : (
            <>
              <circle cx="40" cy="40" r="34" className="fill-gray-200 dark:fill-gray-700" />
              <circle cx="40" cy="40" r="20" className="fill-white dark:fill-gray-900" />
            </>
          )}
        </svg>
      </div>
      <div className="text-center">
        <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">{title}</div>
        <div className="flex flex-wrap justify-center gap-x-2 gap-y-0.5">
          {slices
            .filter((s) => s.value > 0)
            .map((s) => (
              <span
                key={s.label}
                className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400"
              >
                <span
                  className="w-2 h-2 rounded-full inline-block flex-shrink-0"
                  style={{ background: s.color }}
                />
                {s.label} ({s.value})
              </span>
            ))}
        </div>
      </div>
    </div>
  );
}

export function AnalyticsDashboard({ stats }: AnalyticsDashboardProps) {
  const topicsArr = Object.values(stats.topics).sort((a, b) => b.attempts - a.attempts);
  const hasData = stats.overall_attempts > 0;

  const weakCount = stats.weak_topics.length;
  const strongCount = stats.strong_topics.length;
  const neutralCount = topicsArr.filter(
    (t) =>
      t.attempts >= 3 &&
      !stats.weak_topics.includes(t.topic) &&
      !stats.strong_topics.includes(t.topic),
  ).length;

  const correct = Math.round(stats.overall_accuracy * stats.overall_attempts);

  return (
    <div className="space-y-6">
      {/* Overview cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard
          label="Overall accuracy"
          value={`${Math.round(stats.overall_accuracy * 100)}%`}
          sub={`${stats.overall_attempts} attempts`}
          color="blue"
        />
        <StatCard
          label="Avg time"
          value={hasData && stats.avg_time_seconds > 0 ? formatTime(stats.avg_time_seconds) : '—'}
          sub="per question"
          color="purple"
        />
        <StatCard
          label="Current streak"
          value={String(stats.current_streak)}
          sub={`Best: ${stats.best_streak}`}
          color="emerald"
        />
        <StatCard
          label="Questions done"
          value={String(stats.overall_attempts)}
          sub="total"
          color="amber"
        />
      </div>

      {/* Charts row */}
      {hasData && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-5">
            Performance overview
          </h3>
          <div className="flex justify-around flex-wrap gap-6">
            <DonutChart
              pct={stats.overall_accuracy}
              label="Accuracy"
              sub={`${correct} / ${stats.overall_attempts} correct`}
              color="#10b981"
              trackColor="#fecaca"
            />
            {weakCount + strongCount + neutralCount > 0 && (
              <PieChart
                title="Topic mastery"
                slices={[
                  { value: strongCount, color: '#10b981', label: 'Strong' },
                  { value: neutralCount, color: '#f59e0b', label: 'Neutral' },
                  { value: weakCount, color: '#ef4444', label: 'Weak' },
                ]}
              />
            )}
            {stats.best_streak > 0 && (
              <DonutChart
                pct={stats.current_streak / stats.best_streak}
                label="Streak"
                sub={`Best: ${stats.best_streak}`}
                color="#8b5cf6"
              />
            )}
          </div>
        </div>
      )}

      {/* Weak topics */}
      {stats.weak_topics.length > 0 && (
        <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-red-700 dark:text-red-400 mb-3">
            Topics needing work
          </h3>
          <div className="flex flex-wrap gap-2">
            {stats.weak_topics.slice(0, 8).map((t) => {
              const m = stats.topics[t];
              return (
                <div
                  key={t}
                  className="bg-white dark:bg-gray-900 border border-red-200 dark:border-red-800 rounded-md px-3 py-1.5 text-sm"
                >
                  <span className="font-medium text-gray-800 dark:text-gray-200">{t}</span>
                  <span className="text-red-500 ml-2">{Math.round((m?.accuracy ?? 0) * 100)}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Strong topics */}
      {stats.strong_topics.length > 0 && (
        <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-emerald-700 dark:text-emerald-400 mb-3">
            Strong topics
          </h3>
          <div className="flex flex-wrap gap-2">
            {stats.strong_topics.slice(0, 8).map((t) => {
              const m = stats.topics[t];
              return (
                <div
                  key={t}
                  className="bg-white dark:bg-gray-900 border border-emerald-200 dark:border-emerald-800 rounded-md px-3 py-1.5 text-sm"
                >
                  <span className="font-medium text-gray-800 dark:text-gray-200">{t}</span>
                  <span className="text-emerald-600 dark:text-emerald-400 ml-2">
                    {Math.round((m?.accuracy ?? 0) * 100)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Per-topic table */}
      {topicsArr.length > 0 && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
              Topic breakdown
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Topic</th>
                  <th className="text-right px-4 py-2 font-medium">Attempts</th>
                  <th className="text-right px-4 py-2 font-medium">Accuracy</th>
                  <th className="text-right px-4 py-2 font-medium">Avg time</th>
                  <th className="text-right px-4 py-2 font-medium">Trend</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {topicsArr.slice(0, 20).map((m) => (
                  <tr key={m.topic} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="px-4 py-2 font-medium text-gray-800 dark:text-gray-200">
                      {m.topic}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-600 dark:text-gray-400">
                      {m.attempts}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span
                        className={`font-semibold ${
                          m.accuracy >= 0.8
                            ? 'text-emerald-600'
                            : m.accuracy < 0.6
                              ? 'text-red-500'
                              : 'text-amber-600'
                        }`}
                      >
                        {Math.round(m.accuracy * 100)}%
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right text-gray-500 dark:text-gray-400">
                      {m.avg_time_seconds > 0 ? formatTime(m.avg_time_seconds) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {m.recent_trend === 'improving' && (
                        <span className="text-emerald-500">&#8593;</span>
                      )}
                      {m.recent_trend === 'declining' && (
                        <span className="text-red-500">&#8595;</span>
                      )}
                      {m.recent_trend === 'stable' && (
                        <span className="text-gray-400">&#8594;</span>
                      )}
                      {m.recent_trend === 'unknown' && (
                        <span className="text-gray-300 dark:text-gray-600">&#8212;</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {topicsArr.length === 0 && (
        <div className="text-center py-12 text-gray-400 dark:text-gray-600">
          <div className="text-4xl mb-3">&#128202;</div>
          <p className="text-sm">No attempts yet. Start practising to see your progress here.</p>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub: string;
  color: string;
}) {
  const colors: Record<string, string> = {
    blue: 'border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30',
    purple: 'border-purple-200 bg-purple-50 dark:border-purple-900 dark:bg-purple-950/30',
    emerald: 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30',
    amber: 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30',
  };
  const textColors: Record<string, string> = {
    blue: 'text-blue-800 dark:text-blue-300',
    purple: 'text-purple-800 dark:text-purple-300',
    emerald: 'text-emerald-800 dark:text-emerald-300',
    amber: 'text-amber-800 dark:text-amber-300',
  };
  return (
    <div
      className={`rounded-lg border p-4 ${
        colors[color] ?? 'bg-gray-50 border-gray-200 dark:bg-gray-800 dark:border-gray-700'
      }`}
    >
      <div
        className={`text-2xl font-bold ${textColors[color] ?? 'text-gray-800 dark:text-gray-200'}`}
      >
        {value}
      </div>
      <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mt-1">{label}</div>
      <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{sub}</div>
    </div>
  );
}
