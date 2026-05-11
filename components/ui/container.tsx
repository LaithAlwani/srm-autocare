import { clsx } from "clsx";
import type { ReactNode, HTMLAttributes } from "react";

export function Container({
  children,
  className,
  ...rest
}: { children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={clsx("container-stitch", className)} {...rest}>
      {children}
    </div>
  );
}
