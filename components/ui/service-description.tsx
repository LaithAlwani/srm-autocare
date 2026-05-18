import { CheckCircle2 } from "lucide-react";
import { clsx } from "clsx";

// Renders a service's description string, treating any line that begins with
// a bullet marker (`-`, `*`, `•`, `–`) as a checklist item with a green
// check icon. Consecutive bullet lines collapse into one <ul>; non-bullet
// lines render as paragraphs. Empty lines split blocks.
//
// Admin writes descriptions freeform in /admin/services — this keeps the
// public surface visually structured without forcing the admin to think in
// markdown or HTML. Example input:
//
//   Surgical multi-stage prep, machine polishing, and a layered ceramic coat.
//
//   - 5-year guarantee
//   - Hydrophobic finish
//   - UV + chemical resistance

const BULLET_RE = /^\s*[-*•–]\s+/;

type Block = { kind: "text"; lines: string[] } | { kind: "list"; items: string[] };

function parse(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) {
      // Blank line — end the current block so the next item starts fresh.
      if (blocks.length && blocks[blocks.length - 1]) {
        blocks.push({ kind: "text", lines: [] });
      }
      continue;
    }
    const isBullet = BULLET_RE.test(trimmed);
    const content = isBullet ? trimmed.replace(BULLET_RE, "") : trimmed;
    const last = blocks[blocks.length - 1];
    if (isBullet) {
      if (last && last.kind === "list") last.items.push(content);
      else blocks.push({ kind: "list", items: [content] });
    } else {
      if (last && last.kind === "text" && last.lines.length > 0) {
        last.lines.push(content);
      } else {
        blocks.push({ kind: "text", lines: [content] });
      }
    }
  }
  return blocks.filter(
    (b) => (b.kind === "list" && b.items.length > 0) || (b.kind === "text" && b.lines.length > 0),
  );
}

export function ServiceDescription({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const blocks = parse(text);
  return (
    <div className={clsx("space-y-3 text-body-md text-foreground-muted", className)}>
      {blocks.map((block, i) =>
        block.kind === "text" ? (
          <p key={i}>{block.lines.join(" ")}</p>
        ) : (
          <ul key={i} className="space-y-2">
            {block.items.map((item, j) => (
              <li key={j} className="flex items-start gap-2">
                <CheckCircle2
                  size={16}
                  className="text-success shrink-0 mt-[3px]"
                  strokeWidth={2}
                  aria-hidden="true"
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
