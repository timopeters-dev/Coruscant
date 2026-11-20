import * as React from "react";
import { cn } from "@/lib/utils";

/** Grundfläche jeder Karte: Bogen auf Kalkpapier, eine feine Linie, kein Schatten. */
export const CARD_SURFACE =
  "rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text-primary)]";

/** Zusatz für klickbare Karten: die Linie wird beim Hover zur Tintenlinie. */
export const CARD_INTERACTIVE =
  "cursor-pointer transition-[border-color,box-shadow] duration-150 ease-out hover:border-[var(--text-secondary)] hover:shadow-[inset_0_0_0_0.5px_var(--text-secondary)]";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, interactive = false, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(CARD_SURFACE, interactive && CARD_INTERACTIVE, className)}
      {...props}
    />
  ),
);
Card.displayName = "Card";

export const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col gap-1.5 p-5 pb-3", className)}
    {...props}
  />
));
CardHeader.displayName = "CardHeader";

export const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h2
    ref={ref}
    className={cn(
      "text-base font-semibold text-[var(--text-primary)]",
      className,
    )}
    {...props}
  />
));
CardTitle.displayName = "CardTitle";

export const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-[var(--text-secondary)]", className)}
    {...props}
  />
));
CardDescription.displayName = "CardDescription";

export const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-5 pt-0", className)} {...props} />
));
CardContent.displayName = "CardContent";
