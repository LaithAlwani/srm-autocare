import { clsx } from "clsx";

export function Eyebrow({
  children,
  className,
  tone = "primary",
}: {
  children: React.ReactNode;
  className?: string;
  tone?: "primary" | "muted";
}) {
  return (
    <span
      className={clsx(
        "text-label-tech block",
        tone === "primary" ? "text-primary" : "text-foreground-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}
