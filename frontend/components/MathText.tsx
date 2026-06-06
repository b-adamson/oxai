'use client';
import React, { useEffect, useRef } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

interface MathTextProps {
  text: string;
  block?: boolean;
  className?: string;
}

/**
 * Renders text containing LaTeX ($...$, $$...$$, \(...\), \[...\])
 * using the locally-installed KaTeX package (fonts served from node_modules,
 * not CDN, so the radical glyph always loads).
 */
export function MathText({ text, block = false, className = '' }: MathTextProps) {
  const ref = useRef<HTMLDivElement | HTMLSpanElement>(null);

  useEffect(() => {
    if (!ref.current || !text) return;
    ref.current.innerHTML = renderMixedText(text);
  }, [text]);

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

function renderMixedText(text: string): string {
  const DISPLAY_RE = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g;

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
      result += renderInlineMath(text.slice(pos, part.start));
    }
    try {
      result += katex.renderToString(part.latex, { displayMode: true, throwOnError: false });
    } catch {
      result += `<span class="text-red-500">$$${part.latex}$$</span>`;
    }
    pos = part.end;
  }
  result += renderInlineMath(text.slice(pos));
  return result;
}

function renderInlineMath(text: string): string {
  const INLINE_RE = /\$((?:[^$]|\\.)+?)\$|\\\((.+?)\\\)/g;
  return text
    .replace(INLINE_RE, (_, g1, g2) => {
      const latex = g1 ?? g2;
      try {
        return katex.renderToString(latex, { displayMode: false, throwOnError: false });
      } catch {
        return `<span class="text-red-500">$${latex}$</span>`;
      }
    })
    .replace(/\n\n/g, '<br><br>')
    .replace(/\n/g, '<br>');
}
