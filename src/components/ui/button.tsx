import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium " +
    "transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out active:scale-[0.97] motion-reduce:active:scale-100 " +
    "outline-hidden focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_srgb,var(--accent)_32%,transparent)] " +
    "disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "border border-[color-mix(in_srgb,var(--accent)_70%,black)] bg-[var(--accent)] text-[var(--accent-foreground)] shadow-[inset_0_1px_0_rgb(255_255_255/0.14),var(--shadow-xs)] hover:border-[color-mix(in_srgb,var(--accent)_60%,black)] hover:bg-[color-mix(in_srgb,var(--accent)_88%,black)] dark:border-[color-mix(in_srgb,var(--accent)_75%,white)] dark:hover:bg-[color-mix(in_srgb,var(--accent)_88%,white)]",
        secondary:
          "border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-primary)] hover:border-[var(--border-sub)] hover:bg-[color-mix(in_srgb,var(--surface-elevated)_70%,var(--border-sub))]",
        outline:
          "border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)] shadow-[var(--shadow-xs)] hover:border-[var(--border-sub)] hover:bg-[var(--surface-elevated)]",
        ghost:
          "text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)]",
        soft:
          "bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] dark:text-[var(--accent-strong)]",
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
