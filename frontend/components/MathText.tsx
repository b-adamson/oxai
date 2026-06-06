'use client';
import katex from 'katex';
import 'katex/dist/katex.min.css';

interface MathTextProps {
  text: string;
  block?: boolean;
  className?: string;
}

export function MathText({ text, block = false, className = '' }: MathTextProps) {
  const html = renderMixedText(text);

  return block ? (
    <div className={className} dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <span className={className} dangerouslySetInnerHTML={{ __html: html }} />
  );
}

function renderMixedText(text: string): string {
  if (!text) return '';

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
    if (pos < part.start) result += renderInlineMath(text.slice(pos, part.start));
    result += katex.renderToString(part.latex, {
      displayMode: true,
      throwOnError: false,
    });
    pos = part.end;
  }

  result += renderInlineMath(text.slice(pos));
  return result;
}

function renderInlineMath(text: string): string {
  const INLINE_RE = /\$((?:[^$]|\\.)+?)\$|\\\((.+?)\\\)/g;

  return text.replace(INLINE_RE, (_, g1, g2) => {
    const latex = g1 ?? g2;
    return katex.renderToString(latex, {
      displayMode: false,
      throwOnError: false,
    });
  });
}