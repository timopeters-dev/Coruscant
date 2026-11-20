import { vi } from "vitest";
import { PUT as adjustmentsPUT } from "@/app/api/properties/[id]/valuation/adjustments/route";
import { POST as adoptPOST } from "@/app/api/properties/[id]/valuation/adopt/route";
import { DELETE as historyEntryDELETE } from "@/app/api/properties/[id]/valuation/history/[historyId]/route";
import { GET as historyGET } from "@/app/api/properties/[id]/valuation/history/route";
import { GET as previewGET, POST as estimatePOST } from "@/app/api/properties/[id]/valuation/route";
import { createDefaultPropertyValuator, type PropertyValuator } from "@/backend/integrations/property-valuator";

/**
 * Die Bewertungs-Routen mit fester Uhrzeit, optionalem Fake-Valuator und
 * Dev-Modus – jeweils zum Zeitpunkt des Aufrufs gesetzt.
 *
 * Voraussetzung im Test: `vi.mock("@/backend/integrations/property-valuator", …)`
 * mit `createDefaultPropertyValuator: vi.fn(actual.createDefaultPropertyValuator)`.
 */
function at<A extends unknown[]>(
  now: () => Date,
  handler: (...args: A) => Promise<Response>,
  setup: () => void = () => {},
): (...args: A) => Promise<Response> {
  return (...args) => {
    vi.useFakeTimers({ now: now(), toFake: ["Date"] });
    setup();
    return handler(...args);
  };
}

function devModeSetup(devMode?: () => boolean): () => void {
  return () => {
    if (devMode) vi.stubEnv("CORUSCANT_DEV_MODE", String(devMode()));
  };
}

export const previewRoute = (now: () => Date, devMode?: () => boolean) => at(now, previewGET, devModeSetup(devMode));

export const estimateRoute = (factory: (() => PropertyValuator) | undefined, now: () => Date, devMode?: () => boolean) =>
  at(now, estimatePOST, () => {
    const mock = vi.mocked(createDefaultPropertyValuator);
    if (factory) mock.mockImplementation(factory);
    else mock.mockReset();
    devModeSetup(devMode)();
  });

export const adoptRoute = (now: () => Date) => at(now, adoptPOST);
export const adjustmentsRoute = (now: () => Date) => at(now, adjustmentsPUT);
export const historyRoute = () => historyGET;
export const historyEntryDeleteRoute = () => historyEntryDELETE;
