import * as React from "react";
import { cn } from "./cn";
import { Input, type InputProps } from "./input";
import { Label } from "./label";

export interface FieldProps {
  id: string;
  label: React.ReactNode;
  /** Fehlermeldung; verdrängt den Hinweis. */
  error?: string;
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

/** Ein Formularfeld: Beschriftung, Eingabe und darunter Fehler oder Hinweis. */
export function Field({ id, label, error, hint, className, children }: FieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p className="text-xs text-[var(--rose)]">{error}</p>
      ) : hint ? (
        <p className="text-xs text-[var(--text-secondary)]">{hint}</p>
      ) : null}
    </div>
  );
}

export interface TextFieldProps extends Omit<FieldProps, "children">, Omit<InputProps, "id" | "value" | "onChange" | "className"> {
  value: string;
  onValueChange: (value: string) => void;
  /** Zahlen-Eingabe mit Ziffernblock. */
  numeric?: "decimal" | "numeric";
}

export function TextField({ id, label, error, hint, className, value, onValueChange, numeric, ...inputProps }: TextFieldProps) {
  return (
    <Field id={id} label={label} error={error} hint={hint} className={className}>
      <Input
        id={id}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        hasError={Boolean(error)}
        inputMode={numeric}
        className="tabular-nums"
        {...inputProps}
      />
    </Field>
  );
}
