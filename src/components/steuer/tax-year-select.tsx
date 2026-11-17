"use client";

import { useRouter } from "next/navigation";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

interface TaxYearSelectProps {
  years: number[];
  selectedYear: number;
}

export function TaxYearSelect({ years, selectedYear }: TaxYearSelectProps) {
  const router = useRouter();
  const options = years.includes(selectedYear)
    ? years
    : [selectedYear, ...years].sort((a, b) => b - a);

  return (
    <div className="w-32 space-y-1 print:hidden">
      <Label htmlFor="tax-year-select">Steuerjahr</Label>
      <Select
        id="tax-year-select"
        value={String(selectedYear)}
        onChange={(e) => router.push(`/dokumente/steuer?jahr=${e.target.value}`)}
      >
        {options.map((year) => (
          <option key={year} value={String(year)}>
            {year}
          </option>
        ))}
      </Select>
    </div>
  );
}
