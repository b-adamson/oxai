'use client';
import katex from 'katex';
import 'katex/dist/katex.min.css';

interface MathTextProps {
  text: string;
  block?: boolean;
  className?: string;
  forceInline?: boolean; // render $$...$$ as inline math (good for chat bubbles)
}

export function MathText({ text, block = false, className = '', forceInline = false }: MathTextProps) {
  const html = forceInline ? renderMixedTextInline(text) : renderMixedText(text);

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

// Same as renderMixedText but forces $$...$$ to render inline (no centering/block)
function renderMixedTextInline(text: string): string {
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
    result += katex.renderToString(part.latex, { displayMode: false, throwOnError: false });
    pos = part.end;
  }

  result += renderInlineMath(text.slice(pos));
  return result;
}

function renderInlineMath(text: string): string {
  const INLINE_RE = /\$((?:[^$]|\\.)+?)\$|\\\((.+?)\\\)/g;

  let result = '';
  let pos = 0;
  let m: RegExpExecArray | null;

  INLINE_RE.lastIndex = 0;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (pos < m.index) result += renderPlainText(text.slice(pos, m.index));
    result += katex.renderToString(m[1] ?? m[2], {
      displayMode: false,
      throwOnError: false,
    });
    pos = m.index + m[0].length;
  }
  result += renderPlainText(text.slice(pos));
  return result;
}

function renderPlainText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/gs, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/gs, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}
