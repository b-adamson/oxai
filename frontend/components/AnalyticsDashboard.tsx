'use client';
import type { MasteryStats } from '@/lib/types';
import { formatTime } from '@/lib/questionUtils';

interface AnalyticsDashboardProps {
  stats: MasteryStats;
}

export function AnalyticsDashboard({ stats }: AnalyticsDashboardProps) {
  const topicsArr = Object.values(stats.topics).sort((a, b) => b.attempts - a.attempts);

  return (
    <div className="space-y-6">
      {/* Overview cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Overall accuracy" value={`${Math.round(stats.overall_accuracy * 100)}%`} sub={`${stats.overall_attempts} attempts`} color="blue" />
        <StatCard label="Avg time" value={formatTime(stats.avg_time_seconds)} sub="per question" color="purple" />
        <StatCard label="Current streak" value={String(stats.current_streak)} sub={`Best: ${stats.best_streak}`} color="emerald" />
        <StatCard label="Questions done" value={String(stats.overall_attempts)} sub="total" color="amber" />
      </div>

      {/* Weak topics */}
      {stats.weak_topics.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-red-700 mb-3">Topics needing work</h3>
          <div className="flex flex-wrap gap-2">
            {stats.weak_topics.slice(0, 8).map((t) => {
              const m = stats.topics[t];
              return (
                <div key={t} className="bg-white border border-red-200 rounded-md px-3 py-1.5 text-sm">
                  <span className="font-medium text-gray-800">{t}</span>
                  <span className="text-red-500 ml-2">{Math.round((m?.accuracy ?? 0) * 100)}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Strong topics */}
      {stats.strong_topics.length > 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-emerald-700 mb-3">Strong topics</h3>
          <div className="flex flex-wrap gap-2">
            {stats.strong_topics.slice(0, 8).map((t) => {
              const m = stats.topics[t];
              return (
                <div key={t} className="bg-white border border-emerald-200 rounded-md px-3 py-1.5 text-sm">
                  <span className="font-medium text-gray-800">{t}</span>
                  <span className="text-emerald-600 ml-2">{Math.round((m?.accuracy ?? 0) * 100)}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Per-topic table */}
      {topicsArr.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700">Topic breakdown</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Topic</th>
                  <th className="text-right px-4 py-2 font-medium">Attempts</th>
                  <th className="text-right px-4 py-2 font-medium">Accuracy</th>
                  <th className="text-right px-4 py-2 font-medium">Avg time</th>
                  <th className="text-right px-4 py-2 font-medium">Trend</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {topicsArr.slice(0, 20).map((m) => (
                  <tr key={m.topic} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium text-gray-800">{m.topic}</td>
                    <td className="px-4 py-2 text-right text-gray-600">{m.attempts}</td>
                    <td className="px-4 py-2 text-right">
                      <span className={`font-semibold ${
                        m.accuracy >= 0.8 ? 'text-emerald-600' :
                        m.accuracy < 0.6 ? 'text-red-500' : 'text-amber-600'
                      }`}>
                        {Math.round(m.accuracy * 100)}%
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right text-gray-500">{formatTime(m.avg_time_seconds)}</td>
                    <td className="px-4 py-2 text-right">
                      {m.recent_trend === 'improving' && <span className="text-emerald-500">↑</span>}
                      {m.recent_trend === 'declining' && <span className="text-red-500">↓</span>}
                      {m.recent_trend === 'stable' && <span className="text-gray-400">→</span>}
                      {m.recent_trend === 'unknown' && <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {topicsArr.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <div className="text-4xl mb-3">📊</div>
          <p className="text-sm">No attempts yet. Start practising to see your progress here.</p>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label, value, sub, color,
}: {
  label: string; value: string; sub: string; color: string;
}) {
  const colors: Record<string, string> = {
    blue: 'border-blue-200 bg-blue-50',
    purple: 'border-purple-200 bg-purple-50',
    emerald: 'border-emerald-200 bg-emerald-50',
    amber: 'border-amber-200 bg-amber-50',
  };
  const textColors: Record<string, string> = {
    blue: 'text-blue-800',
    purple: 'text-purple-800',
    emerald: 'text-emerald-800',
    amber: 'text-amber-800',
  };
  return (
    <div className={`rounded-lg border p-4 ${colors[color] ?? 'bg-gray-50 border-gray-200'}`}>
      <div className={`text-2xl font-bold ${textColors[color] ?? 'text-gray-800'}`}>{value}</div>
      <div className="text-xs font-medium text-gray-600 mt-1">{label}</div>
      <div className="text-xs text-gray-400 mt-0.5">{sub}</div>
    </div>
  );
}
