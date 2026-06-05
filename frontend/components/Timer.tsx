'use client';
import { useEffect, useRef, useState } from 'react';
import { formatTime } from '@/lib/questionUtils';

interface TimerProps {
  /** If true, counts down from initialSeconds */
  countdown?: boolean;
  initialSeconds?: number;
  running: boolean;
  onExpire?: () => void;
  className?: string;
}

export function Timer({ countdown = false, initialSeconds = 0, running, onExpire, className = '' }: TimerProps) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (running) {
      if (!startRef.current) startRef.current = Date.now() - elapsed * 1000;
      intervalRef.current = setInterval(() => {
        const newElapsed = Math.floor((Date.now() - startRef.current!) / 1000);
        setElapsed(newElapsed);
        if (countdown && initialSeconds > 0 && newElapsed >= initialSeconds) {
          onExpire?.();
          clearInterval(intervalRef.current!);
        }
      }, 500);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [running, countdown, initialSeconds, onExpire]);

  const display = countdown
    ? Math.max(0, initialSeconds - elapsed)
    : elapsed;

  const isWarning = countdown && initialSeconds > 0 && display < initialSeconds * 0.2;

  return (
    <span className={`font-mono text-sm ${isWarning ? 'text-red-500 font-bold' : 'text-gray-600'} ${className}`}>
      {formatTime(display)}
    </span>
  );
}

/** Hook to track elapsed time for a question */
export function useQuestionTimer(active: boolean) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;
    if (!startRef.current) startRef.current = Date.now();
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current!) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [active]);

  const reset = () => {
    startRef.current = null;
    setElapsed(0);
  };

  const stop = () => {
    const final = startRef.current ? Math.floor((Date.now() - startRef.current) / 1000) : elapsed;
    startRef.current = null;
    return final;
  };

  return { elapsed, reset, stop };
}
