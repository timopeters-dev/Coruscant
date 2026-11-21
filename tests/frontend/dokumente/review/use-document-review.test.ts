import { describe, expect, it } from "vitest";
import { resolveInitialTaxCategory } from "@/frontend/dokumente/review/use-document-review";

describe("resolveInitialTaxCategory", () => {
  const properties = [
    { id: "prop-0", usage: "owner_occupied" as const },
    { id: "prop-1", usage: "rented" as const },
  ];

  it("preserves an explicit taxCategory even when a rented property is linked", () => {
    expect(
      resolveInitialTaxCategory(
        { taxCategory: "handwerker_35a", linkedPropertyId: "prop-1" },
        properties,
      ),
    ).toBe("handwerker_35a");
  });

  it("selects werbungskosten_vv when taxCategory is null and a rented property is linked", () => {
    expect(
      resolveInitialTaxCategory(
        { taxCategory: null, linkedPropertyId: "prop-1" },
        properties,
      ),
    ).toBe("werbungskosten_vv");
  });

  it("falls back to handwerker_35a for owner_occupied or unlinked documents without taxCategory", () => {
    expect(
      resolveInitialTaxCategory(
        { taxCategory: null, linkedPropertyId: "prop-0" },
        properties,
      ),
    ).toBe("handwerker_35a");

    expect(
      resolveInitialTaxCategory(
        { taxCategory: null, linkedPropertyId: null },
        properties,
      ),
    ).toBe("handwerker_35a");
  });
});
