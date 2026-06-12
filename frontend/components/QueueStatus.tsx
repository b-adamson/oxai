'use client';
import type { PaperSlot } from '@/lib/types';
import { slotCounts } from '@/lib/queue';

interface QueueStatusProps {
  slots: PaperSlot[];
  label?: string;
  compact?: boolean;
}

export function QueueStatus({ slots, label, compact = false }: QueueStatusProps) {
  const counts = slotCounts(slots);
  const readyCount = counts.ready;
  const generatingCount = counts.generating;
  const total = slots.length;

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-500">
        {readyCount > 0 && (
          <span className="flex items-center gap-1 text-emerald-600">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
            {readyCount} ready
          </span>
        )}
        {generatingCount > 0 && (
          <span className="flex items-center gap-1 text-amber-600">
            <span className="w-2 h-2 rounded-full bg-amber-400 inline-block animate-pulse" />
            {generatingCount} generating
          </span>
        )}
        {readyCount === 0 && generatingCount === 0 && (
          <span className="text-gray-400">Loading queueâ€¦</span>
        )}
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3">
      {label && <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{label}</div>}
      <div className="flex flex-wrap gap-3 text-sm">
        <Stat label="Ready" value={readyCount} color="emerald" pulse={false} />
        {generatingCount > 0 && <Stat label="Generating" value={generatingCount} color="amber" pulse />}
        {counts.answered > 0 && <Stat label="Answered" value={counts.answered} color="gray" pulse={false} />}
        {counts.failed > 0 && <Stat label="Failed" value={counts.failed} color="red" pulse={false} />}
        <Stat label="Total" value={total} color="gray" pulse={false} />
      </div>
    </div>
  );
}

function Stat({ label, value, color, pulse }: { label: string; value: number; color: string; pulse: boolean }) {
  const colorMap: Record<string, string> = {
    emerald: 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30',
    amber: 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30',
    red: 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/30',
    gray: 'text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800',
  };
  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded ${colorMap[color] ?? colorMap.gray}`}>
      {pulse && <span className="w-1.5 h-1.5 rounded-full bg-current inline-block animate-pulse" />}
      <span className="font-semibold">{value}</span>
      <span className="text-xs opacity-70">{label}</span>
    </div>
  );
}
