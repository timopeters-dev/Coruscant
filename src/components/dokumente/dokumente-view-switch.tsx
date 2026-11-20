"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  SEGMENT_TRACK,
  SegmentGroup,
  SegmentLabel,
  SegmentPill,
  segmentItemClass,
} from "@/components/ui/segmented";

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
    <SegmentGroup>
      <nav aria-label="Dokumente-Ansicht" className={cn(SEGMENT_TRACK, "print:hidden")}>
        {items.map((item) => {
          const isActive = active === item.key;
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={segmentItemClass(isActive, "md")}
            >
              {isActive ? <SegmentPill /> : null}
              <SegmentLabel>{item.label}</SegmentLabel>
            </Link>
          );
        })}
      </nav>
    </SegmentGroup>
  );
}
