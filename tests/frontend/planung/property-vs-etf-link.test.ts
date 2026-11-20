import { describe, expect, it, vi } from "vitest";
import { copyPropertyVsEtfLink } from "@/frontend/planung/property-vs-etf-link";

const URL_SAMPLE = "http://localhost:3000/planung?dialog=immo-etf&kp=35000000";

describe("copyPropertyVsEtfLink", () => {
  it("meldet copied: true, wenn das Clipboard schreibt", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    await expect(
      copyPropertyVsEtfLink(URL_SAMPLE, { writeText }),
    ).resolves.toEqual({ copied: true, url: URL_SAMPLE });
    expect(writeText).toHaveBeenCalledWith(URL_SAMPLE);
  });

  it("meldet copied: false mit URL, wenn das Clipboard wirft", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    await expect(
      copyPropertyVsEtfLink(URL_SAMPLE, { writeText }),
    ).resolves.toEqual({ copied: false, url: URL_SAMPLE });
  });

  it("meldet copied: false ohne Clipboard (null/undefined)", async () => {
    await expect(copyPropertyVsEtfLink(URL_SAMPLE, null)).resolves.toEqual({
      copied: false,
      url: URL_SAMPLE,
    });
    await expect(copyPropertyVsEtfLink(URL_SAMPLE)).resolves.toEqual({
      copied: false,
      url: URL_SAMPLE,
    });
  });
});
