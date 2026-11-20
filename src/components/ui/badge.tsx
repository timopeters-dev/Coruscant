import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-md border px-1.5 py-px text-xs font-medium leading-4 transition-colors",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-[var(--surface-elevated)] text-[var(--text-primary)]",
        secondary:
          "border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)]",
        outline:
          "border-[var(--border-sub)] bg-transparent text-[var(--text-secondary)]",
        accent:
          "border-[var(--text-primary)] bg-transparent text-[var(--text-primary)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { badgeVariants };
