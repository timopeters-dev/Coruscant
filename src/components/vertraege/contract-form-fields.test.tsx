import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ContractFormFields,
  createInitialContractFormValues,
  validateAndBuildContractPayload,
  type ContractFormValues,
} from "./contract-form-fields";

const TODAY = "2026-11-19";

function makeLoanValues(
  overrides: Partial<ContractFormValues> = {},
): ContractFormValues {
  return {
    ...createInitialContractFormValues(null, TODAY),
    name: "Hauskredit Musterstraße 1",
    provider: "Musterbank",
    category: "loan",
    currentBalanceEuro: "200000",
    balanceAsOfDate: "2026-11-01",
    monthlyRateEuro: "1100",
    interestRatePercent: "3,80",
    repaymentType: "annuity",
    fixedInterestUntil: "2036-11-01",
    originalPrincipalEuro: "250000",
    ...overrides,
  };
}

describe("ContractFormFields loan options section", () => {
  it("hides dependent fields when right is none and shows them + live Euro hint when allowed", () => {
    const noneValues = makeLoanValues({
      specialRepaymentRight: "none",
      rateChangeRight: "none",
    });
    const noneHtml = renderToStaticMarkup(
      <ContractFormFields
        idPrefix="test-none"
        values={noneValues}
        errors={{}}
        properties={[]}
        onChange={() => {}}
      />,
    );
    expect(noneHtml).not.toContain('id="test-none-sr-basis"');
    expect(noneHtml).not.toContain('id="test-none-rc-count"');

    const allowedValues = makeLoanValues({
      specialRepaymentRight: "allowed",
      specialRepaymentBasis: "percent_original",
      specialRepaymentPercent: "5",
      specialRepaymentUsedEuro: "2000",
      rateChangeRight: "allowed",
      rateChangeTotalCount: "2",
      rateChangeScope: "fixed_period",
      rateChangeUsedCount: "0",
      rateChangeMinRepaymentPercent: "1",
      rateChangeMaxRepaymentPercent: "5",
    });
    const allowedHtml = renderToStaticMarkup(
      <ContractFormFields
        idPrefix="test-allowed"
        values={allowedValues}
        errors={{}}
        properties={[]}
        onChange={() => {}}
      />,
    );
    expect(allowedHtml).toContain('id="test-allowed-sr-basis"');
    expect(allowedHtml).toContain('id="test-allowed-rc-count"');
    // Live hint from remainingSpecialRepaymentCents: 5% of 250.000 = 12.500 €/Jahr, 2.000 used -> 10.500 frei
    expect(allowedHtml).toContain("Entspricht 12.500 €/Jahr");
    expect(allowedHtml).toContain("frei 10.500 €");
  });

  it("reports empty corridor intersection error and renders it in the form", () => {
    const conflictingValues = makeLoanValues({
      rateChangeRight: "allowed",
      rateChangeTotalCount: "2",
      rateChangeScope: "fixed_period",
      rateChangeMinRepaymentPercent: "5", // ~1.833 €/Mo at 250k & 3,8%
      rateChangeMaxRepaymentPercent: "6", // ~2.042 €/Mo
      rateChangeMinMonthlyEuro: "900",
      rateChangeMaxMonthlyEuro: "1200", // disjoint from [1.833, 2.042]
    });

    const validation = validateAndBuildContractPayload(conflictingValues);
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      expect(validation.errors.rateChangeCorridor).toBeTruthy();

      const html = renderToStaticMarkup(
        <ContractFormFields
          idPrefix="test-conflict"
          values={conflictingValues}
          errors={validation.errors}
          properties={[]}
          onChange={() => {}}
        />,
      );
      expect(html).toContain(validation.errors.rateChangeCorridor!);
    }
  });
});
