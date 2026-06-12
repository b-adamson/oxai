'use client';
import type { ReactNode } from 'react';

interface Props {
  target: string;
  children: ReactNode;
  className?: string;
}

export function SmoothScrollLink({ target, children, className }: Props) {
  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    const el = document.querySelector(target);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <span onClick={handleClick} role="button" tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && handleClick(e as any)}
      className={className}
    >
      {children}
    </span>
  );
}
