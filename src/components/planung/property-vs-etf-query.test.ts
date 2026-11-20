import { describe, expect, it } from "vitest";
import { CURRENT_PURCHASE_COST_RULE_SET } from "@/lib/domain/property-purchase-defaults";
import {
  calculatePurchaseCostsCents,
  PROPERTY_VS_ETF_LIMITS,
  PROPERTY_VS_ETF_TAX_LIMITS,
} from "@/lib/domain/property-vs-etf-defaults";
import {
  buildPropertyVsEtfHref,
  buildPropertyVsEtfHrefFromPurchase,
  mergePropertyVsEtfQuery,
  parsePropertyVsEtfQuery,
  PROPERTY_VS_ETF_QUERY_KEYS,
  serializePropertyVsEtfState,
} from "./property-vs-etf-query";
import {
  createPropertyVsEtfFormState,
  evaluatePropertyVsEtf,
  resolveEquity,
  type PropertyVsEtfFormState,
} from "./property-vs-etf-state";

const OPEN = "dialog=immo-etf";

function parse(query: string) {
  return parsePropertyVsEtfQuery(new URLSearchParams(query));
}

function fullState(): PropertyVsEtfFormState {
  const s = createPropertyVsEtfFormState();
  return {
    ...s,
    purchasePriceCents: 35_000_000,
    livingAreaCentiSqm: 6_550,
    coldRentPerSqmCents: 1_250,
    purchaseCostsBps: 1_000,
    equityMode: "manual",
    manualEquityCents: 4_500_000,
    interestRateBps: 410,
    initialRepaymentBps: 250,
    rentGrowthBps: -100,
    valueGrowthBps: 150,
    costGrowthBps: 300,
    vacancyBps: 400,
    monthlyHoaCostsCents: 25_000,
    maintenanceReserveBps: 120,
    etfAnnualReturnBps: 700,
    horizonYears: 15,
    reinvestSurplus: true,
    tax: {
      taxesEnabled: false,
      marginalTaxRateBps: 4_200,
      depreciationRateBps: 300,
      buildingShareBps: 7_000,
      speculationPeriodYears: 8,
      saverAllowanceCents: 200_000,
      partialExemptionBps: 2_000,
      churchTaxBps: 900,
      brokerFeeBps: 350,
      otherSaleCostsBps: 20,
      reserveDeductionLagYears: 3,
    },
  };
}

describe("Roundtrip serialize → parse", () => {
  it("Standardzustand: leere Query, parse ergibt den Standard", () => {
    const s = createPropertyVsEtfFormState();
    expect(serializePropertyVsEtfState(s).toString()).toBe("");
    const parsed = parse(OPEN);
    expect(parsed.open).toBe(true);
    expect(parsed.state).toEqual(s);
    expect(parsed.origin).toBeNull();
  });

  it("vollständig gesetzter Zustand läuft exakt rund", () => {
    const s = fullState();
    const query = `${OPEN}&${serializePropertyVsEtfState(s).toString()}`;
    expect(parse(query).state).toEqual(s);
  });

  it("Grenzwerte (min und max) jedes Formularfelds laufen rund, inkl. Vorzeichen", () => {
    const fields = [
      "purchasePriceCents",
      "livingAreaCentiSqm",
      "coldRentPerSqmCents",
      "purchaseCostsBps",
      "interestRateBps",
      "initialRepaymentBps",
      "rentGrowthBps",
      "valueGrowthBps",
      "costGrowthBps",
      "vacancyBps",
      "monthlyHoaCostsCents",
      "maintenanceReserveBps",
      "etfAnnualReturnBps",
      "horizonYears",
    ] as const;
    for (const field of fields) {
      for (const bound of ["min", "max"] as const) {
        const s = createPropertyVsEtfFormState();
        const value = PROPERTY_VS_ETF_LIMITS[field][bound];
        (s as unknown as Record<string, number>)[field] = value;
        const parsed = parse(`${OPEN}&${serializePropertyVsEtfState(s)}`).state;
        expect(parsed[field], `${field} ${bound}`).toBe(value);
      }
    }
    expect(PROPERTY_VS_ETF_LIMITS.rentGrowthBps.min).toBeLessThan(0);
    const neg = createPropertyVsEtfFormState();
    neg.rentGrowthBps = -1_000;
    expect(serializePropertyVsEtfState(neg).get("mst")).toBe("-1000");
  });

  it("Grenzwerte der Steuerfelder laufen rund", () => {
    const fields = [
      "marginalTaxRateBps",
      "depreciationRateBps",
      "buildingShareBps",
      "speculationPeriodYears",
      "saverAllowanceCents",
      "partialExemptionBps",
      "brokerFeeBps",
      "otherSaleCostsBps",
      "reserveDeductionLagYears",
    ] as const;
    for (const field of fields) {
      for (const bound of ["min", "max"] as const) {
        const s = createPropertyVsEtfFormState();
        const value = PROPERTY_VS_ETF_TAX_LIMITS[field][bound];
        s.tax[field] = value;
        const parsed = parse(`${OPEN}&${serializePropertyVsEtfState(s)}`).state;
        expect(parsed.tax[field], `${field} ${bound}`).toBe(value);
      }
    }
  });

  it("auto-Modus schreibt kein ek, manueller Modus mit Wert = Nebenkosten schon", () => {
    const auto = createPropertyVsEtfFormState();
    auto.purchasePriceCents = 10_000_000;
    expect(serializePropertyVsEtfState(auto).has("ek")).toBe(false);

    const manual = { ...auto, equityMode: "manual" as const };
    manual.manualEquityCents = calculatePurchaseCostsCents(
      10_000_000,
      manual.purchaseCostsBps,
    );
    const query = serializePropertyVsEtfState(manual);
    expect(query.get("ek")).toBe(String(manual.manualEquityCents));
    const parsed = parse(`${OPEN}&${query}`).state;
    expect(parsed.equityMode).toBe("manual");
  });

  it("schreibt nur Abweichungen vom Standard", () => {
    const s = createPropertyVsEtfFormState();
    s.interestRateBps = 380;
    expect(serializePropertyVsEtfState(s).has("zins")).toBe(false);
    s.interestRateBps = 410;
    expect(serializePropertyVsEtfState(s).get("zins")).toBe("410");
  });

  it("schreibt Werte außerhalb der Grenzen nicht", () => {
    const s = createPropertyVsEtfFormState();
    s.purchasePriceCents = 0;
    s.interestRateBps = 99_999;
    s.tax.churchTaxBps = 500;
    expect(serializePropertyVsEtfState(s).toString()).toBe("");
  });

  it("Schlüsselreihenfolge ist stabil", () => {
    expect(serializePropertyVsEtfState(fullState()).toString()).toBe(
      "kp=35000000&wfl=6550&kmqm=1250&nk=1000&ek=4500000&zins=410&tilg=250&mst=-100&wst=150&kst=300&ausfall=400&weg=25000&ihr=120&etf=700&jahre=15&reinv=1&steuer=0&gst=4200&afa=300&geb=7000&frist=8&spb=200000&tf=2000&kist=900&makler=350&vks=20&ihrv=3",
    );
  });
});

describe("Kaputte Query-Strings", () => {
  it("leere Query und leeres Objekt: zu, Standard", () => {
    for (const p of [new URLSearchParams(""), {}]) {
      const r = parsePropertyVsEtfQuery(p);
      expect(r.open).toBe(false);
      expect(r.state).toEqual(createPropertyVsEtfFormState());
      expect(r.origin).toBeNull();
    }
  });

  it("ungültige Werte fallen feldweise auf den Standard", () => {
    const r = parse(
      `${OPEN}&kp=abc&wfl=-5&kmqm=1.5&zins=99999&jahre=0&steuer=ja&kist=500&ek=`,
    );
    const d = createPropertyVsEtfFormState();
    expect(r.open).toBe(true);
    expect(r.state).toEqual(d);
  });

  it("gemischt: gültige Felder bleiben, kaputte werden Standard", () => {
    const r = parse(`${OPEN}&kp=35000000&zins=kaputt&etf=700`);
    expect(r.state.purchasePriceCents).toBe(35_000_000);
    expect(r.state.etfAnnualReturnBps).toBe(700);
    expect(r.state.interestRateBps).toBe(
      createPropertyVsEtfFormState().interestRateBps,
    );
  });

  it("ignoriert unbekannte Parameter", () => {
    const r = parse(`${OPEN}&foo=1&utm_source=x`);
    expect(r.state).toEqual(createPropertyVsEtfFormState());
  });

  it("ohne dialog=immo-etf werden alle Felder ignoriert", () => {
    for (const q of ["dialog=andere&kp=35000000", "kp=35000000", "dialog="]) {
      const r = parse(q);
      expect(r.open).toBe(false);
      expect(r.state).toEqual(createPropertyVsEtfFormState());
    }
  });

  it("doppelte Schlüssel: erster Wert gilt", () => {
    expect(parse(`${OPEN}&kp=1&kp=2`).state.purchasePriceCents).toBe(1);
    const asRecord = parsePropertyVsEtfQuery({
      dialog: ["immo-etf", "x"],
      kp: ["7", "8"],
    });
    expect(asRecord.open).toBe(true);
    expect(asRecord.state.purchasePriceCents).toBe(7);
  });

  it("exotische Eingaben", () => {
    expect(parse(`${OPEN}&kp=%20123%20`).state.purchasePriceCents).toBe(123);
    expect(parse(`${OPEN}&kp=%E2%88%92100`).state.purchasePriceCents).toBeNull();
    expect(parse(`${OPEN}&kp=１２３`).state.purchasePriceCents).toBeNull();
    expect(
      parse(`${OPEN}&kp=${"9".repeat(10_000)}`).state.purchasePriceCents,
    ).toBeNull();
  });

  it("kaputte Prozent-Kodierung wirft nicht", () => {
    expect(() => parse("kp=%E0%A4%A")).not.toThrow();
    expect(() => parse(`${OPEN}&kp=%E0%A4%A`)).not.toThrow();
  });

  it("Fuzz: wirft nie, jedes Feld liegt in den Grenzen oder ist Standard", () => {
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    const alphabet = "0123456789-+.,e xX%abc";
    const randomString = () => {
      const len = Math.floor(rnd() * 14);
      let out = "";
      for (let i = 0; i < len; i += 1) {
        out += alphabet[Math.floor(rnd() * alphabet.length)];
      }
      return out;
    };
    const keys = PROPERTY_VS_ETF_QUERY_KEYS.filter(
      (k) => k !== "dialog" && k !== "von",
    );
    for (let i = 0; i < 200; i += 1) {
      const params = new URLSearchParams();
      params.set("dialog", "immo-etf");
      for (const key of keys) params.set(key, randomString());
      const { state } = parsePropertyVsEtfQuery(params);
      const again = parsePropertyVsEtfQuery(
        new URLSearchParams(`${OPEN}&${serializePropertyVsEtfState(state)}`),
      );
      expect(again.state).toEqual(state);
      const lim = PROPERTY_VS_ETF_LIMITS;
      expect(state.interestRateBps).toBeGreaterThanOrEqual(lim.interestRateBps.min);
      expect(state.interestRateBps).toBeLessThanOrEqual(lim.interestRateBps.max);
      expect(state.horizonYears).toBeGreaterThanOrEqual(lim.horizonYears.min);
      expect(state.horizonYears).toBeLessThanOrEqual(lim.horizonYears.max);
      expect([0, 800, 900]).toContain(state.tax.churchTaxBps);
    }
  });

  it("ek unter den Nebenkosten wird roh übernommen und vom Dialog angehoben", () => {
    const r = parse(`${OPEN}&kp=10000000&ek=1`);
    expect(r.state.equityMode).toBe("manual");
    expect(r.state.manualEquityCents).toBe(1);
    expect(resolveEquity(r.state)?.clamped).toBe("raised_to_costs");
  });

  it("von=kaufrechner nur mit dialog; andere Werte ergeben null", () => {
    expect(parse("von=kaufrechner").origin).toBeNull();
    expect(parse(`${OPEN}&von=anders`).origin).toBeNull();
    expect(parse(`${OPEN}&von=kaufrechner`).origin).toBe("kaufrechner");
  });

  it("Schlüssel kollidieren nicht mit frage/ansicht/kredit", () => {
    for (const k of ["frage", "ansicht", "kredit"]) {
      expect(PROPERTY_VS_ETF_QUERY_KEYS).not.toContain(k);
    }
  });
});

describe("mergePropertyVsEtfQuery", () => {
  const s = createPropertyVsEtfFormState();
  s.purchasePriceCents = 35_000_000;

  it("erhält fremde Parameter in Originalreihenfolge und hängt dialog an", () => {
    expect(
      mergePropertyVsEtfQuery(
        "frage=geld&ansicht=vergleich&kredit=k1",
        true,
        s,
      ),
    ).toBe("frage=geld&ansicht=vergleich&kredit=k1&dialog=immo-etf&kp=35000000");
  });

  it("ersetzt alte Immo-Schlüssel statt sie zu duplizieren", () => {
    const out = mergePropertyVsEtfQuery(
      "frage=geld&dialog=immo-etf&kp=1&zins=500",
      true,
      s,
    );
    expect(out).toBe("frage=geld&dialog=immo-etf&kp=35000000");
  });

  it("open=false entfernt alle Immo-Schlüssel inkl. von", () => {
    expect(
      mergePropertyVsEtfQuery(
        "frage=geld&dialog=immo-etf&von=kaufrechner&kp=1",
        false,
        s,
      ),
    ).toBe("frage=geld");
    expect(mergePropertyVsEtfQuery("", false, s)).toBe("");
  });

  it("behält fremde unbekannte Parameter und toleriert führendes ?", () => {
    expect(mergePropertyVsEtfQuery("?foo=bar&kp=1", true, s)).toBe(
      "foo=bar&dialog=immo-etf&kp=35000000",
    );
  });

  it("buildPropertyVsEtfHref", () => {
    expect(buildPropertyVsEtfHref("/planung", "")).toBe("/planung");
    expect(buildPropertyVsEtfHref("/planung", "a=1")).toBe("/planung?a=1");
  });
});

describe("buildPropertyVsEtfHrefFromPurchase", () => {
  const items = CURRENT_PURCHASE_COST_RULE_SET.items.map(
    ({ key, label, bps }) => ({ key, label, bps }),
  );
  const sumBps = items.reduce((sum, i) => sum + i.bps, 0);
  const base = {
    purchasePriceCents: 30_000_000,
    costItems: items,
    equityCents: calculatePurchaseCostsCents(30_000_000, sumBps),
    interestRateBps: 410,
    initialRepaymentBps: 200,
    monthlyNonRecoverableCostsCents: 4_500,
  };

  function queryOf(href: string): URLSearchParams {
    expect(href.startsWith("/planung?")).toBe(true);
    return new URLSearchParams(href.slice("/planung?".length));
  }

  it("übernimmt Kaufpreis, Zins, WEG-Kosten; kein ek bei EK = Nebenkosten, keine Objektfelder", () => {
    const href = buildPropertyVsEtfHrefFromPurchase(base);
    expect(href.startsWith("/planung?dialog=immo-etf&von=kaufrechner")).toBe(true);
    const q = queryOf(href);
    expect(q.get("kp")).toBe("30000000");
    expect(q.get("zins")).toBe("410");
    expect(q.get("weg")).toBe("4500");
    expect(q.has("ek")).toBe(false);
    expect(q.has("wfl")).toBe(false);
    expect(q.has("kmqm")).toBe(false);
    if (sumBps === createPropertyVsEtfFormState().purchaseCostsBps) {
      expect(q.has("nk")).toBe(false);
    }
  });

  it("EK ≠ Nebenkosten setzt ek; EK unter den Nebenkosten ebenfalls (roh)", () => {
    expect(
      queryOf(
        buildPropertyVsEtfHrefFromPurchase({ ...base, equityCents: 9_000_000 }),
      ).get("ek"),
    ).toBe("9000000");
    expect(
      queryOf(
        buildPropertyVsEtfHrefFromPurchase({ ...base, equityCents: 1 }),
      ).get("ek"),
    ).toBe("1");
  });

  it("Posten-Summe über 3.000 bps ergibt kein nk", () => {
    const q = queryOf(
      buildPropertyVsEtfHrefFromPurchase({
        ...base,
        costItems: [{ key: "x", label: "Muster", bps: 3_500 }],
      }),
    );
    expect(q.has("nk")).toBe(false);
  });

  it("Roundtrip: Objektfelder leer, origin kaufrechner, Auswertung empty", () => {
    const href = buildPropertyVsEtfHrefFromPurchase({
      ...base,
      equityCents: 9_000_000,
    });
    const parsed = parsePropertyVsEtfQuery(queryOf(href));
    expect(parsed.open).toBe(true);
    expect(parsed.origin).toBe("kaufrechner");
    expect(parsed.state.livingAreaCentiSqm).toBeNull();
    expect(parsed.state.coldRentPerSqmCents).toBeNull();
    expect(evaluatePropertyVsEtf(parsed.state).status).toBe("empty");
  });
});
