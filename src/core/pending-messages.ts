import type { Message } from "./types.ts";

export type PendingMessage = { key: number; text: string; knownIds: ReadonlySet<string>; error?: string };

// Confirm each pending send once, using only outgoing rows first seen after it
// was queued. A later echo also resolves a timeout/uncertain-send error.
export function confirmPendingMessages(pending: PendingMessage[], messages: Message[]): PendingMessage[] {
  const outgoing = messages.filter(m => m.direction === "outgoing" && !m.baseline);
  const consumed = new Set<string>();
  return pending.flatMap(item => {
    const echo = outgoing.find(m => !consumed.has(m.id) && !item.knownIds.has(m.id) &&
      !m.aliasIds?.some(id => item.knownIds.has(id)) && m.text.normalize("NFC") === item.text.normalize("NFC"));
    if (echo) { consumed.add(echo.id); return []; }
    // Do not let the same echo confirm a second identical send on the next poll.
    return [{ ...item, knownIds: new Set([...item.knownIds, ...outgoing.map(m => m.id)]) }];
  });
}
