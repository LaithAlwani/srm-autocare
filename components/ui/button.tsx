import Link from "next/link";
import { tv, type VariantProps } from "tailwind-variants";
import { clsx } from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";

const button = tv({
  base: "inline-flex items-center justify-center gap-2 text-label-tech transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed border",
  variants: {
    variant: {
      primary:
        "bg-primary text-on-primary border-primary glow-blue hover:brightness-110",
      secondary:
        "bg-transparent text-chrome border-chrome hover:bg-white/5",
      ghost:
        "bg-transparent text-foreground-muted border-transparent hover:text-foreground hover:bg-white/5",
      danger:
        "bg-error-container text-foreground border-error-container hover:brightness-110",
    },
    size: {
      sm: "px-4 py-2 text-[11px]",
      md: "px-6 py-3 text-[12px]",
      lg: "px-10 py-4 text-[12px]",
    },
    block: { true: "w-full", false: "" },
  },
  defaultVariants: { variant: "primary", size: "md", block: false },
});

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof button> & { children: ReactNode };

export function Button({
  variant,
  size,
  block,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button className={clsx(button({ variant, size, block }), className)} {...rest}>
      {children}
    </button>
  );
}

type ButtonLinkProps = {
  href: string;
  children: ReactNode;
  className?: string;
} & VariantProps<typeof button>;

export function ButtonLink({ href, variant, size, block, className, children }: ButtonLinkProps) {
  return (
    <Link href={href} className={clsx(button({ variant, size, block }), className)}>
      {children}
    </Link>
  );
}
