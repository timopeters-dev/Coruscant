import * as React from "react";
import { cn } from "@/frontend/ui/cn";

export interface ChartDataColumn {
  key: string;
  header: string;
  align?: "left" | "right";
}

interface ChartDataTableProps {
  summary?: string;
  columns: ChartDataColumn[];
  rows: Array<Record<string, React.ReactNode>>;
}

export function ChartDataTable({
  summary = "Werte anzeigen",
  columns,
  rows,
}: ChartDataTableProps) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-xs font-medium text-[var(--text-secondary)]">
        {summary}
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-xs tabular-nums">
          <thead>
            <tr className="bg-[var(--surface-elevated)] text-left text-[var(--text-secondary)]">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    "px-2 py-1.5 font-medium",
                    c.align === "right" && "text-right",
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-[var(--border)]">
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "px-2 py-1.5",
                      c.align === "right" && "text-right",
                    )}
                  >
                    {row[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
