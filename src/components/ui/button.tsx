import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium " +
    "transition-[background-color,border-color,color,box-shadow] duration-150 ease-out active:translate-y-px motion-reduce:active:translate-y-0 " +
    "outline-hidden focus-visible:ring-[3px] focus-visible:ring-[var(--focus)] " +
    "disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-foreground)] hover:bg-[color-mix(in_srgb,var(--accent)_84%,var(--surface))]",
        secondary:
          "border border-transparent bg-[var(--surface-elevated)] text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--surface-elevated)_70%,var(--border-sub))]",
        outline:
          "border border-[var(--border-sub)] bg-[var(--surface)] text-[var(--text-primary)] hover:border-[var(--text-secondary)]",
        ghost:
          "text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)]",
        soft:
          "bg-[var(--accent-soft)] text-[var(--text-primary)] hover:bg-[color-mix(in_srgb,var(--accent)_13%,transparent)]",
      },
      size: {
        default: "h-9 px-4",
        sm: "h-8 px-3 text-xs [&_svg]:size-3.5",
        lg: "h-10 px-5",
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
