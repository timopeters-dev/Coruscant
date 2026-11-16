import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  hasError?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, hasError = false, children, ...props }, ref) => {
    return (
      <div className="relative">
        <select
          ref={ref}
          aria-invalid={hasError || undefined}
          className={cn(
            "flex h-9 w-full appearance-none rounded-lg border bg-[var(--surface)] py-1.5 pl-3 pr-8 text-sm text-[var(--text-primary)] transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--bg)]",
            "disabled:cursor-not-allowed disabled:opacity-50",
            hasError
              ? "border-[var(--rose)] focus-visible:ring-[var(--rose)]"
              : "border-[var(--border)] hover:border-[var(--border-sub)]",
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-secondary)]"
          aria-hidden="true"
        />
      </div>
    );
  },
);
Select.displayName = "Select";
