import type { Conversation, Message } from "./types.ts";
import { groupSender, sameSender } from "./groups.ts";

type Observation = Omit<Message, "baseline">;
const signature = (m: Observation, group = false) => JSON.stringify([
  m.direction, m.text.normalize("NFC"),
  (m.attachments ?? []).map(a => [a.kind, Boolean(a.sticker)]),
  group ? m.sender?.id ?? m.sender?.name.normalize("NFC") ?? null : null,
]);
const aliases = (primary: string, ...ids: (string[] | undefined)[]) =>
  [...new Set(ids.flatMap(x => x ?? []))].filter(id => id !== primary);

export function canonicalMessageId(c: Conversation, raw: Pick<Message, "id" | "platformMessageId">): string {
  const match = (raw.platformMessageId && c.messages.find(m => m.platformMessageId === raw.platformMessageId)) ||
    c.messages.find(m => (m.id === raw.id || m.aliasIds?.includes(raw.id)) &&
      !(raw.platformMessageId && m.platformMessageId && raw.platformMessageId !== m.platformMessageId));
  return match ? match.id : raw.id;
}

// Resolve changing DOM fingerprints through stable server IDs. Legacy repairs
// require an ordered verified run or a uniquely matched row between two server
// anchors. Plain text equality never removes a stand-alone cached message.
export function reconcileMessageIdentities(c: Conversation, input: Observation[]): Observation[] {
  const sig = (m: Observation) => signature(m, c.kind === "group");
  const removed = new Set<string>();
  const backup = () => {
    c.messageRepairBackup ??= { createdAt: Date.now(), messages: structuredClone(c.messages) };
  };
  const fold = (old: Message, target: Message) => {
    if (old.id === target.id || removed.has(old.id)) return;
    if (old.platformMessageId && old.platformMessageId !== target.platformMessageId) return;
    backup();
    target.aliasIds = aliases(target.id, target.aliasIds, [old.id], old.aliasIds);
    removed.add(old.id);
  };
  const compact = () => { c.messages = c.messages.filter(m => !removed.has(m.id)); };
  if (c.kind === "group") {
    const sender = (m: Observation) => groupSender(m.sender, m.direction, c.group?.members);
    const compatible = (a: Observation, b: Observation) => a.direction === b.direction && sameSender(sender(a), sender(b));
    const sameContent = (a: Observation, b: Observation) => a.timestamp !== null && b.timestamp !== null &&
      Math.floor(a.timestamp / 60_000) === Math.floor(b.timestamp / 60_000) && signature(a) === signature(b);
    const candidates = new Map<string, Observation[]>();
    for (const raw of input) if (raw.legacyFingerprintId) candidates.set(raw.legacyFingerprintId, [...(candidates.get(raw.legacyFingerprintId) ?? []), raw]);
    // A pre-group row and its sole sender-qualified successor have the SAME
    // original fingerprint, not just equal text. This also repairs cached
    // history outside the live DOM window. Ambiguous occurrences stay separate.
    const cached = new Map<string, Message[]>();
    for (const m of c.messages) if (m.legacyFingerprintId) cached.set(m.legacyFingerprintId, [...(cached.get(m.legacyFingerprintId) ?? []), m]);
    for (const [legacy, rows] of cached) if (!candidates.has(legacy) && rows.length === 1 && c.messages.some(m => m.id === legacy && !m.sender && !m.platformMessageId)) candidates.set(legacy, rows);
    for (const [legacy, rows] of candidates) {
      if (rows.length !== 1 || !rows[0].sender || rows[0].id.includes("#")) continue;
      const raw = rows[0];
      const related = c.messages.filter(m => !removed.has(m.id) && (m.id === legacy || m.legacyFingerprintId === legacy || m.aliasIds?.includes(raw.id)) && sameContent(m, raw));
      // Two authors or repeated occurrences can share the old sender-blind ID.
      if (related.some(m => !compatible(m, raw) || m.id.includes("#"))) continue;
      if (new Set([...related, raw].flatMap(m => m.platformMessageId ? [m.platformMessageId] : [])).size > 1) continue;
      const target = related.find(m => m.id === legacy) ?? related[0];
      if (!target) continue;
      const others = related.filter(m => m.id !== target.id);
      if (others.length || target.id !== raw.id) {
        c.groupIdentityBackup ??= { createdAt: Date.now(), messages: structuredClone(c.messages) };
        backup();
      }
      if (raw.platformMessageId) target.platformMessageId = raw.platformMessageId;
      target.sender = sender(raw);
      target.legacyFingerprintId = legacy;
      target.aliasIds = aliases(target.id, target.aliasIds, raw.aliasIds, raw.id !== target.id ? [raw.id] : []);
      for (const old of others) fold(old, target);
    }
    compact();
  }
  const byApi = new Map<string, Message>();
  for (const m of c.messages) if (m.platformMessageId) {
    const existing = byApi.get(m.platformMessageId);
    if (existing) fold(m, existing);
    else byApi.set(m.platformMessageId, m);
  }
  compact();
  const byId = new Map<string, Observation>();
  for (const m of c.messages) {
    byId.set(m.id, m);
    for (const id of m.aliasIds ?? []) if (!byId.has(id)) byId.set(id, m);
  }
  const observed = new Map<string, Observation>();
  for (const raw of input) {
    let match: Observation | undefined = raw.platformMessageId ? byApi.get(raw.platformMessageId) : undefined;
    match ??= byId.get(raw.id);
    if (c.kind === "group" && raw.platformMessageId && raw.legacyFingerprintId && raw.aliasIds?.includes(raw.legacyFingerprintId)) {
      const legacy = byId.get(raw.legacyFingerprintId);
      if (legacy && legacy.id !== match?.id && (!legacy.platformMessageId || legacy.platformMessageId === raw.platformMessageId) && sameSender(legacy.sender, raw.sender)) {
        if (match && (!match.platformMessageId || match.platformMessageId === raw.platformMessageId)) fold(match as Message, legacy as Message);
        match = legacy;
      }
    }
    if (!match && c.kind === "group" && raw.platformMessageId) {
      const candidates = [...new Set((raw.aliasIds ?? []).flatMap(id => byId.has(id) ? [byId.get(id)!] : []))];
      if (candidates.length === 1 && sameSender(candidates[0].sender, raw.sender)) match = candidates[0];
    }
    if (c.kind === "group" && match && !sameSender(match.sender, raw.sender) && !(raw.direction === "outgoing" && !raw.sender?.id)) match = undefined;
    if (raw.platformMessageId && match?.platformMessageId && raw.platformMessageId !== match.platformMessageId) match = undefined;
    const id = match?.id ?? (byId.has(raw.id) && raw.platformMessageId ? `api:${raw.platformMessageId}` : raw.id);
    const ids = aliases(id, match?.aliasIds, raw.aliasIds, raw.id !== id ? [raw.id] : []);
    const row = { ...raw, id, ...(ids.length ? { aliasIds: ids } : {}) };
    if (match) {
      if (raw.platformMessageId) match.platformMessageId = raw.platformMessageId;
      if (ids.length) match.aliasIds = ids;
    }
    if (raw.platformMessageId) byApi.set(raw.platformMessageId, (match ?? row) as Message);
    byId.set(id, match ?? row);
    observed.set(id, row);
  }
  compact();
  const source = [...observed.values()];
  if (c.kind === "group") {
    // A complete unchanged span between two server anchors can retain legacy
    // media IDs even when that media has no LS text. Never match a partial span
    // or a repeated legacy fingerprint from two different authors.
    const anchors = source.flatMap((m, i) => {
      const cached = c.messages.findIndex(old => m.platformMessageId && old.platformMessageId === m.platformMessageId);
      return cached < 0 ? [] : [{ source: i, cached }];
    });
    for (let n = 1; n < anchors.length; n++) {
      const left = anchors[n - 1], right = anchors[n];
      const old = c.messages.slice(left.cached + 1, right.cached), fresh = source.slice(left.source + 1, right.source);
      if (!old.length || old.length !== fresh.length || right.cached <= left.cached || old.length > 100) continue;
      if (!fresh.every((raw, i) => raw.id === old[i].id ||
        (!old[i].platformMessageId && raw.identity === "fingerprint" && raw.legacyFingerprintId === old[i].id &&
          source.filter(m => m.legacyFingerprintId === raw.legacyFingerprintId).length === 1 &&
          old[i].direction === raw.direction && old[i].text.normalize("NFC") === raw.text.normalize("NFC") &&
          sameSender(old[i].sender, raw.sender) && JSON.stringify((old[i].attachments ?? []).map(a => [a.kind, !!a.sticker])) === JSON.stringify((raw.attachments ?? []).map(a => [a.kind, !!a.sticker]))))) continue;
      fresh.forEach((raw, i) => {
        if (raw.id === old[i].id) return;
        backup();
        const ids = aliases(old[i].id, old[i].aliasIds, raw.aliasIds, [raw.id]);
        old[i].aliasIds = ids;
        source[left.source + 1 + i] = { ...raw, id: old[i].id, aliasIds: ids };
      });
    }
  }
  const sourceIds = new Set(source.map(m => m.id));
  const groups = new Map<string, number[]>();
  source.forEach((m, i) => groups.set(sig(m), [...(groups.get(sig(m)) ?? []), i]));
  const current = new Map(c.messages.map(m => [m.id, m]));
  if (c.kind === "group") {
    for (const old of c.messages) {
      if (sourceIds.has(old.id) || old.platformMessageId || !old.sender || !old.legacyFingerprintId || old.timestamp === null) continue;
      const matches = source.filter(raw => raw.platformMessageId && raw.legacyFingerprintId && (raw.id === raw.legacyFingerprintId || raw.aliasIds?.includes(raw.legacyFingerprintId)) &&
        raw.timestamp !== null && Math.floor(raw.timestamp / 60_000) === Math.floor(old.timestamp! / 60_000) &&
        raw.direction === old.direction && raw.text.normalize("NFC") === old.text.normalize("NFC") && sameSender(raw.sender, old.sender) &&
        JSON.stringify((raw.attachments ?? []).map(a => [a.kind, !!a.sticker])) === JSON.stringify((old.attachments ?? []).map(a => [a.kind, !!a.sticker])));
      if (matches.length === 1 && current.has(matches[0].id)) fold(old, current.get(matches[0].id)!);
    }
    compact();
  }

  // Repair old undated duplicate blocks left by the date-dependent fingerprint.
  // Five distinct, consecutive API-bound rows must agree, including direction,
  // order and capture batch. Ambiguous repeated text and real server IDs stay.
  let run: { old: Message; target: Message; index: number }[] = [];
  const flush = () => {
    if (run.length >= 5 && new Set(run.map(x => sig(x.old))).size >= 5 &&
      run.reduce((length, x) => length + x.old.text.length, 0) >= 120)
      for (const x of run) fold(x.old, x.target);
    run = [];
  };
  for (const old of c.messages) {
    const indexes = groups.get(sig(old));
    const index = indexes?.length === 1 ? indexes[0] : -1;
    const raw = source[index];
    const target = raw && current.get(raw.id);
    if (sourceIds.has(old.id) || old.platformMessageId || old.identity !== "fingerprint" || old.timestamp !== null ||
      !raw?.platformMessageId || raw.precision !== "exact" || !target) { flush(); continue; }
    const previous = run.at(-1);
    if (previous && (index !== previous.index + 1 || Math.abs(old.observedAt - previous.old.observedAt) > 1000)) flush();
    run.push({ old, target, index });
  }
  flush(); compact();

  // Between two server-identified rows the current rendered window supplies
  // the occurrence count. Never collapse repeated source rows or another ID.
  const anchors = source.flatMap((m, i) => {
    const position = c.messages.findIndex(saved => saved.id === m.id);
    return m.platformMessageId && position >= 0 ? [{ source: i, cached: position }] : [];
  });
  for (const [position, old] of c.messages.entries()) {
    if (sourceIds.has(old.id) || old.platformMessageId || old.identity !== "fingerprint") continue;
    const matches = groups.get(sig(old)) ?? [];
    if (matches.length > 2) continue;
    const targets = matches.filter(index => current.has(source[index].id) && anchors.some(left =>
      left.source < index && left.cached < position && anchors.some(right =>
        right.source > index && right.cached > position &&
        matches.filter(i => i > left.source && i < right.source).length === 1)));
    if (targets.length === 1) fold(old, current.get(source[targets[0]].id)!);
  }
  compact();
  return source.map(raw => {
    const saved = current.get(raw.id);
    const ids = aliases(raw.id, raw.aliasIds, saved?.aliasIds);
    return { ...raw, ...(ids.length ? { aliasIds: ids } : {}) };
  });
}

export function findObservedMessage<T extends Pick<Message, "id" | "platformMessageId">>(saved: Message | undefined, rows: T[], fallbackId: string): T | undefined {
  if (saved?.platformMessageId) {
    const exact = rows.filter(m => m.platformMessageId === saved.platformMessageId);
    if (exact.length) return exact.length === 1 ? exact[0] : undefined;
  }
  const ids = new Set([fallbackId, ...(saved?.aliasIds ?? [])]);
  const candidates = rows.filter(m => ids.has(m.id) &&
    !(saved?.platformMessageId && m.platformMessageId && saved.platformMessageId !== m.platformMessageId));
  return candidates.length === 1 ? candidates[0] : undefined;
}
