import { createEmailRegex, createIbanRegex, isIbanLike } from "./pii-patterns";

export const MAX_CHAT_TURNS = 10;

/**
 * Maskiert IBANs und E-Mail-Adressen in Nutzer-Chatnachrichten,
 * bevor sie an die KI gehen.
 */
export function redactFreeText(text: string): string {
  return text
    .replace(createEmailRegex(), "[E-Mail entfernt]")
    .replace(createIbanRegex(), (match) =>
      isIbanLike(match) ? "[IBAN entfernt]" : match,
    );
}

/**
 * Behält die letzten `maxTurns × 2` Nachrichten und beginnt immer mit einer `user`-Nachricht.
 */
export function trimChatHistory<T extends { role: "user" | "coach" }>(
  messages: readonly T[],
  maxTurns: number = MAX_CHAT_TURNS,
): T[] {
  const limit = Math.max(0, Math.trunc(maxTurns)) * 2;
  const tail = limit === 0 ? [] : messages.slice(-limit);
  const firstUser = tail.findIndex((m) => m.role === "user");
  return firstUser === -1 ? [] : tail.slice(firstUser);
}
