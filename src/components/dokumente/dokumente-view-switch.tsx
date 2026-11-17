import Link from "next/link";
import { cn } from "@/lib/utils";

interface DokumenteViewSwitchProps {
  active: "inbox" | "steuer";
  taxYear?: number | null;
}

export function DokumenteViewSwitch({ active, taxYear }: DokumenteViewSwitchProps) {
  const items = [
    { key: "inbox" as const, label: "Inbox", href: "/dokumente" },
    {
      key: "steuer" as const,
      label: "Steuer-Übersicht",
      href: taxYear ? `/dokumente/steuer?jahr=${taxYear}` : "/dokumente/steuer",
    },
  ];

  return (
    <nav
      aria-label="Dokumente-Ansicht"
      className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5 print:hidden"
    >
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={active === item.key ? "page" : undefined}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            active === item.key
              ? "bg-[var(--accent)] text-[var(--accent-foreground)]"
              : "text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)]",
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
