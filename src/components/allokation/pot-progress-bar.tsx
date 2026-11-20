import type { PotProgressBar as PotProgressBarData } from "@/lib/domain/surplus-flow";
import type { PotDeadlineStatus } from "@/lib/domain/pot-deadline";
import { cn } from "@/lib/utils";

interface PotProgressBarProps {
  bar: PotProgressBarData | null;
  deadlineStatus?: PotDeadlineStatus;
}

export function PotProgressBar({ bar, deadlineStatus }: PotProgressBarProps) {
  if (bar === null) return null;

  const previewBorder =
    deadlineStatus === "at_risk"
      ? "border-[var(--rose)]"
      : deadlineStatus === "tight"
        ? "border-[var(--amber)]"
        : "border-[var(--accent)]";
  const totalPct = Math.floor((bar.currentBps + bar.previewBps) / 100);
  const previewText =
    bar.previewBps > 0
      ? `Nach offenen Überweisungen und dem Vorschlag dieses Monats: ${totalPct} %`
      : undefined;

  return (
    <div
      className="flex h-1.5 w-full meter overflow-hidden rounded-full bg-[var(--surface-elevated)]"
      title={previewText}
    >
      <div
        className={cn(
          "h-full transition-all",
          bar.reached ? "bg-[var(--emerald)]" : "bg-[var(--accent)]",
        )}
        style={{ width: `${bar.currentBps / 100}%` }}
      />
      {bar.previewBps > 0 ? (
        <div
          className={cn(
            "h-full border border-dashed bg-[var(--accent)]/35 transition-all",
            previewBorder,
          )}
          style={{ width: `${bar.previewBps / 100}%` }}
        />
      ) : null}
      {previewText ? <span className="sr-only">{previewText}</span> : null}
    </div>
  );
}
