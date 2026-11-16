import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  hasError?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", hasError = false, ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        aria-invalid={hasError || undefined}
        className={cn(
          "flex h-9 w-full rounded-lg border bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text-primary)] transition-colors",
          "placeholder:text-[var(--text-secondary)]/60",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          hasError
            ? "border-[var(--rose)] focus-visible:ring-[var(--rose)]"
            : "border-[var(--border)] hover:border-[var(--border-sub)]",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
