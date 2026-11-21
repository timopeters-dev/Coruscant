export interface CopyLinkResult {
  copied: boolean;
  url: string;
}

/**
 * Kopiert den Link in die Zwischenablage. `clipboard` ist injizierbar; ohne
 * Clipboard-API (z. B. HTTP im LAN) oder bei Fehlern gilt `copied: false`.
 */
export async function copyPropertyVsEtfLink(
  url: string,
  clipboard?: { writeText: (v: string) => Promise<void> } | null,
): Promise<CopyLinkResult> {
  if (!clipboard) return { copied: false, url };
  try {
    await clipboard.writeText(url);
    return { copied: true, url };
  } catch {
    return { copied: false, url };
  }
}
