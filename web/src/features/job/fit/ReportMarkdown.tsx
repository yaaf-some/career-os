/**
 * Renders a model-written report. The text is untrusted (the model read a job
 * posting), so it only ever becomes React text nodes: no raw HTML, and links are
 * shown as text with their address, never made clickable.
 */
import type { ReactNode } from 'react';

type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'list'; ordered: boolean; items: { text: string; depth: number }[] }
  | { type: 'table'; rows: string[][] }
  | { type: 'code'; text: string }
  | { type: 'quote'; text: string }
  | { type: 'rule' }
  | { type: 'paragraph'; text: string };

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^(\s*)(?:[-*+•]|(\d{1,3})[.)])\s+(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const FENCE = /^\s*```/;

const cells = (line: string) =>
  line
    .trim()
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const heading = HEADING.exec(line);
    const bullet = BULLET.exec(line);
    if (FENCE.test(line)) {
      flush();
      const code: string[] = [];
      while (++i < lines.length && !FENCE.test(lines[i]!)) code.push(lines[i]!);
      blocks.push({ type: 'code', text: code.join('\n') });
    } else if (!line.trim()) {
      flush();
    } else if (heading) {
      flush();
      blocks.push({ type: 'heading', level: heading[1]!.length, text: heading[2]!.trim() });
    } else if (RULE.test(line)) {
      flush();
      blocks.push({ type: 'rule' });
    } else if (TABLE_ROW.test(line)) {
      flush();
      const row = cells(line);
      const last = blocks.at(-1);
      // The `|---|---|` line only separates the header.
      if (row.every((cell) => /^:?-+:?$/.test(cell))) continue;
      if (last?.type === 'table' && TABLE_ROW.test(lines[i - 1] ?? '')) last.rows.push(row);
      else blocks.push({ type: 'table', rows: [row] });
    } else if (bullet) {
      flush();
      const ordered = bullet[2] !== undefined;
      const item = { text: bullet[3]!, depth: Math.min(3, Math.floor(bullet[1]!.length / 2)) };
      const last = blocks.at(-1);
      if (last?.type === 'list' && (item.depth > 0 || last.ordered === ordered)) {
        last.items.push(item);
      } else {
        blocks.push({ type: 'list', ordered, items: [item] });
      }
    } else if (line.startsWith('>')) {
      flush();
      blocks.push({ type: 'quote', text: line.replace(/^>\s?/, '') });
    } else {
      paragraph.push(line.trim());
    }
  }
  flush();
  return blocks;
}

const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\s](?:[^*\n]*[^*\s])?\*|!?\[[^\]\n]*\]\([^)\s]*\))/;

function inline(text: string): ReactNode[] {
  // Splitting on one capture group puts the matches at the odd positions.
  return text.split(INLINE).map((part, index) => {
    if (index % 2 === 0) return part;
    if (part.startsWith('`')) {
      return (
        <code key={index} className="font-mono-meta rounded bg-[var(--wp-raised)] px-1 text-[0.9em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith('**')) {
      return (
        <strong key={index} className="font-semibold text-[var(--wp-ink)]">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('*')) return <em key={index}>{part.slice(1, -1)}</em>;
    const link = /^!?\[([^\]]*)\]\(([^)]*)\)$/.exec(part)!;
    return `${link[1]} (${link[2]})`;
  });
}

function renderBlock(block: Block, key: number): ReactNode {
  switch (block.type) {
    case 'heading':
      return (
        <h4
          key={key}
          className={
            block.level <= 2
              ? 'font-serif-title pt-1 text-lg text-[var(--wp-ink)]'
              : 'pt-1 text-sm font-semibold text-[var(--wp-ink)]'
          }
        >
          {inline(block.text)}
        </h4>
      );
    case 'list': {
      const List = block.ordered ? 'ol' : 'ul';
      return (
        <List key={key} className={`space-y-1 pl-5 ${block.ordered ? 'list-decimal' : 'list-disc'}`}>
          {block.items.map((item, i) => (
            <li key={i} style={item.depth ? { marginLeft: `${item.depth}rem` } : undefined}>
              {inline(item.text)}
            </li>
          ))}
        </List>
      );
    }
    case 'table':
      return (
        <div key={key} className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className="border-b border-[var(--wp-hairline)]">
                  {row.map((cell, c) => (
                    <td
                      key={c}
                      className={`py-1.5 pr-3 align-top ${r === 0 ? 'font-semibold text-[var(--wp-ink)]' : ''}`}
                    >
                      {inline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'code':
      return (
        <pre
          key={key}
          className="font-mono-meta overflow-x-auto rounded-[10px] bg-[var(--wp-raised)] p-3 text-xs"
        >
          {block.text}
        </pre>
      );
    case 'quote':
      return (
        <blockquote key={key} className="border-l-2 border-[var(--wp-accent)] pl-3">
          {inline(block.text)}
        </blockquote>
      );
    case 'rule':
      return <hr key={key} className="border-[var(--wp-hairline)]" />;
    case 'paragraph':
      return <p key={key}>{inline(block.text)}</p>;
  }
}

export function ReportMarkdown({ source }: { source: string }) {
  return (
    <div
      data-testid="report-markdown"
      className="min-w-0 space-y-2.5 break-words text-sm leading-relaxed text-[var(--wp-secondary)]"
    >
      {parseMarkdown(source).map(renderBlock)}
    </div>
  );
}
