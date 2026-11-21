import * as React from "react";
import { cn } from "./cn";
import { FIELD_BASE, FIELD_ERROR, FIELD_OK } from "./field-styles";

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
          FIELD_BASE,
          "py-1.5",
          hasError ? FIELD_ERROR : FIELD_OK,
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
