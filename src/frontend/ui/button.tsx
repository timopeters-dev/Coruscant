import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./cn";

/**
 * Buttons im Eichamt-Look: halbschmale Schrift wie auf Geräte-Tasten, gedeckte
 * Flächen statt reinem Schwarz/Weiß und eine feine Unterkante, die beim Drücken
 * nachgibt.
 */
const buttonVariants = cva(
  "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg font-[family-name:var(--font-display)] font-semibold tracking-[0.01em] " +
    "transition-[background-color,border-color,color,box-shadow,translate] duration-150 ease-out active:translate-y-px motion-reduce:active:translate-y-0 " +
    "outline-hidden focus-visible:ring-[3px] focus-visible:ring-[var(--focus)] " +
    "disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border border-[var(--control-edge)] bg-[var(--control)] text-[var(--control-foreground)] shadow-[inset_0_1px_0_rgb(255_255_255/0.08),inset_0_-2px_0_rgb(0_0_0/0.18)] hover:bg-[var(--control-hover)] active:shadow-[inset_0_1px_0_rgb(255_255_255/0.06)]",
        destructive:
          "border border-[color-mix(in_srgb,var(--rose)_80%,black)] bg-[var(--rose)] text-[var(--surface)] shadow-[inset_0_-2px_0_rgb(0_0_0/0.18)] hover:bg-[color-mix(in_srgb,var(--rose)_88%,black)] active:shadow-none",
        secondary:
          "border border-transparent bg-[var(--surface-elevated)] text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--surface-elevated)_70%,var(--border-sub))]",
        outline:
          "border border-[var(--border-sub)] bg-[var(--surface)] text-[var(--text-primary)] shadow-[inset_0_-2px_0_var(--border)] hover:border-[var(--text-muted)] hover:bg-[color-mix(in_srgb,var(--surface)_55%,var(--surface-elevated))] active:shadow-none",
        ghost:
          "text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)]",
        soft:
          "bg-[var(--accent-soft)] text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--accent)_13%,transparent)]",
      },
      size: {
        default: "h-9 px-4 text-[0.9375rem]",
        sm: "h-8 px-3 text-sm [&_svg]:size-3.5",
        lg: "h-10 px-5 text-base",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
