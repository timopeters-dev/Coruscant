import { describe, expect, it } from "vitest";
import {
  nextInfoTipMode,
  type InfoTipEvent,
  type InfoTipMode,
} from "./info-tip";

describe("nextInfoTipMode", () => {
  const table: Array<[InfoTipMode, InfoTipEvent, InfoTipMode]> = [
    ["closed", "mouseEnter", "hover"],
    ["hover", "mouseEnter", "hover"],
    ["pinned", "mouseEnter", "pinned"],
    ["hover", "mouseLeave", "closed"],
    ["pinned", "mouseLeave", "pinned"],
    ["closed", "mouseLeave", "closed"],
    // Klick auf ein per Hover geöffnetes Panel fixiert es (Regression: Aufblitzen).
    ["hover", "click", "pinned"],
    ["pinned", "click", "closed"],
    ["closed", "click", "pinned"],
    ["hover", "escape", "closed"],
    ["pinned", "escape", "closed"],
    ["hover", "outsideClick", "closed"],
    ["pinned", "outsideClick", "closed"],
    ["hover", "focusOut", "closed"],
    ["pinned", "focusOut", "closed"],
  ];
  it.each(table)("%s + %s → %s", (mode, event, expected) => {
    expect(nextInfoTipMode(mode, event)).toBe(expected);
  });

  it("Maus: Enter, Klick, Leave lässt das Panel offen", () => {
    let m: InfoTipMode = "closed";
    for (const e of ["mouseEnter", "click", "mouseLeave"] as const) {
      m = nextInfoTipMode(m, e);
    }
    expect(m).toBe("pinned");
  });
});
