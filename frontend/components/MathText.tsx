'use client';
import React, { useEffect, useRef } from 'react';

interface MathTextProps {
  text: string;
  block?: boolean;
  className?: string;
}

/**
 * Renders text containing LaTeX ($...$, $$...$$, \(...\), \[...\])
 * using KaTeX loaded from CDN. Falls back to plain text on error.
 */
export function MathText({ text, block = false, className = '' }: MathTextProps) {
  const ref = useRef<HTMLDivElement | HTMLSpanElement>(null);

  useEffect(() => {
    if (!ref.current || !text) return;
    const el = ref.current;

    function renderKatex() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const katex = (window as any).katex;
      if (!katex) return;

      // Split text into plain and math segments
      const html = renderMixedText(text, katex);
      el.innerHTML = html;
    }

    if (typeof window !== 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((window as any).katex) {
        renderKatex();
      } else {
        // Load KaTeX dynamically
        if (!document.getElementById('katex-css')) {
          const link = document.createElement('link');
          link.id = 'katex-css';
          link.rel = 'stylesheet';
          link.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.10/dist/katex.min.css';
          document.head.appendChild(link);
        }
        if (!document.getElementById('katex-script')) {
          const script = document.createElement('script');
          script.id = 'katex-script';
          script.src = 'https://cdn.jsdelivr.net/npm/katex@0.16.10/dist/katex.min.js';
          script.onload = renderKatex;
          document.head.appendChild(script);
        } else {
          // Script already loading, wait
          const timer = setInterval(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if ((window as any).katex) {
              clearInterval(timer);
              renderKatex();
            }
          }, 50);
          return () => clearInterval(timer);
        }
      }
    }
  }, [text]);

  // Initial render as plain text (will be replaced by effect)
  if (block) {
    return (
      <div ref={ref as React.RefObject<HTMLDivElement>} className={className}>
        {text}
      </div>
    );
  }
  return (
    <span ref={ref as React.RefObject<HTMLSpanElement>} className={className}>
      {text}
    </span>
  );
}

/** Split text into segments and render LaTeX with KaTeX */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderMixedText(text: string, katex: any): string {
  // Handle display math first, then inline
  const DISPLAY_RE = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g;
  const INLINE_RE = /\$((?:[^$]|\\.)+?)\$|\\\((.+?)\\\)/g;

  const segments: { content: string; isDisplay: boolean; isMath: boolean }[] = [];
  let lastIndex = 0;

  // Process display math
  const displayParts: { start: number; end: number; latex: string }[] = [];
  let m: RegExpExecArray | null;
  DISPLAY_RE.lastIndex = 0;
  while ((m = DISPLAY_RE.exec(text)) !== null) {
    displayParts.push({ start: m.index, end: m.index + m[0].length, latex: m[1] ?? m[2] });
  }

  let result = '';
  let pos = 0;
  for (const part of displayParts) {
    if (pos < part.start) {
      result += renderInlineMath(text.slice(pos, part.start), katex);
    }
    try {
      result += katex.renderToString(part.latex, { displayMode: true, throwOnError: false });
    } catch {
      result += `<span class="text-red-500">$$${part.latex}$$</span>`;
    }
    pos = part.end;
  }
  result += renderInlineMath(text.slice(pos), katex);
  void segments; void lastIndex;
  return result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderInlineMath(text: string, katex: any): string {
  const INLINE_RE = /\$((?:[^$]|\\.)+?)\$|\\\((.+?)\\\)/g;
  return text.replace(INLINE_RE, (_, g1, g2) => {
    const latex = g1 ?? g2;
    try {
      return katex.renderToString(latex, { displayMode: false, throwOnError: false });
    } catch {
      return `<span class="text-red-500">$${latex}$</span>`;
    }
  }).replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>');
}
