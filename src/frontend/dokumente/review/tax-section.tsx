"use client";

import { TextField } from "@/frontend/ui/field";
import { Label } from "@/frontend/ui/label";
import { Select } from "@/frontend/ui/select";
import { suggestTaxCategoryForPropertyUsage } from "@/domain/properties/rental";
import { TAX_CATEGORIES, type TaxCategory } from "@/domain/documents/documents";
import { TAX_CATEGORY_LABELS } from "../labels";
import { type DocumentReviewState } from "./use-document-review";

/** Steuerliche Einordnung des Belegs. */
export function ReviewTaxSection({ ws }: { ws: DocumentReviewState }) {
  const {
    deductibleAmountInput, hasExplicitTaxCategory, isTaxRelevant, linkedPropertyId,
    properties, setDeductibleAmountInput, setHasExplicitTaxCategory, setIsTaxRelevant,
    setTaxCategory, setTaxYearInput, taxCategory, taxYearInput,
  } = ws;
  return (
    <>
      {/* Tax Tagging Section */}
      <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)]/40 p-3.5">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
          <input
            type="checkbox"
            checked={isTaxRelevant}
            onChange={(e) => {
              const checked = e.target.checked;
              setIsTaxRelevant(checked);
              if (checked && !hasExplicitTaxCategory) {
                const prop = properties.find(
                  (p) => p.id === linkedPropertyId,
                );
                const suggested = prop
                  ? suggestTaxCategoryForPropertyUsage(prop.usage)
                  : null;
                if (suggested) {
                  setTaxCategory(suggested);
                }
              }
            }}
            className="h-4 w-4 rounded border-[var(--border)] accent-[var(--accent)]"
          />
          <span>Steuerrelevant</span>
        </label>

        {isTaxRelevant ? (
          <div className="grid gap-3 @md:grid-cols-3">
            <TextField
              id="doc-tax-year"
              label="Steuerjahr"
              value={taxYearInput}
              onValueChange={setTaxYearInput}
              type="number"
              min={1900}
              max={2100}
            />

            <div className="space-y-1.5 @md:col-span-2">
              <Label htmlFor="doc-tax-category">Steuer-Kategorie</Label>
              <Select
                id="doc-tax-category"
                value={taxCategory}
                onChange={(e) => {
                  setHasExplicitTaxCategory(true);
                  setTaxCategory(e.target.value as TaxCategory);
                }}
              >
                {TAX_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {TAX_CATEGORY_LABELS[cat]}
                  </option>
                ))}
              </Select>
            </div>

            <TextField
              id="doc-deductible"
              label="Absetzbarer Betrag / Lohnanteil (€)"
              value={deductibleAmountInput}
              onValueChange={setDeductibleAmountInput}
              className="@md:col-span-3"
              placeholder="z. B. 840,00"
            />
          </div>
        ) : null}
      </div>
    </>
  );
}
