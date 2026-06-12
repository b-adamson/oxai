'use client';
import { useMemo } from 'react';
import Link from 'next/link';
import { useStore } from '@/lib/store';
import { computeMastery } from '@/lib/analytics';
import { AnalyticsDashboard } from '@/components/AnalyticsDashboard';

export default function AnalyticsPage() {
  const attempts = useStore((s) => s.attempts);
  const mastery = useMemo(() => computeMastery(attempts), [attempts]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="max-w-3xl mx-auto p-4 pb-12">
        <div className="flex items-center gap-3 mt-6 mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Analytics</h1>
          {attempts.length > 0 && (
            <span className="text-xs text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
              {attempts.length} attempts
            </span>
          )}
        </div>

        {attempts.length === 0 ? (
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-12 text-center">
            <div className="text-4xl mb-4">&#128202;</div>
            <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">No data yet</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              Answer questions in Quick Mode or Paper Mode to see your progress here.
            </p>
            <div className="flex gap-3 justify-center">
              <Link
                href="/quick"
                className="bg-accent hover:bg-accent-light text-white font-medium py-2 px-5 rounded-lg text-sm transition-colors"
              >
                Quick Mode
              </Link>
              <Link
                href="/paper"
                className="border border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500 text-gray-700 dark:text-gray-300 font-medium py-2 px-5 rounded-lg text-sm transition-colors"
              >
                Paper Mode
              </Link>
            </div>
          </div>
        ) : (
          <AnalyticsDashboard stats={mastery} />
        )}
      </div>
    </div>
  );
}
