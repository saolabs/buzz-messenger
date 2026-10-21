import { useEffect, useRef, useState } from "react";
import type { GroupInfo, GroupMember } from "../core/types.ts";
import { useAvatar } from "./buddy.tsx";
import { useT } from "./i18n.ts";

function Member({ member, disabled, open }: { member: GroupMember; disabled: boolean; open: () => void }) {
  const avatar = useAvatar(member.avatar), t = useT();
  return <li><button type="button" className="group-member" disabled={disabled} onClick={open} title={t("group.openChat", { name: member.name })}>
    <img src={avatar} alt="" referrerPolicy="no-referrer" />
    <span className="member-details"><b>{member.nickname || member.name || t("group.unknownSender")}</b>{member.isSelf && <span> ({t("im.you")})</span>}
      {member.nickname && member.name && member.nickname !== member.name && <span className="member-name">{member.name}</span>}
      {member.role === "admin" && <span className="member-role">{t("group.admin")}</span>}
    </span>
  </button></li>;
}
export function GroupMembers({ contactId, initial }: { contactId: string; initial?: GroupInfo }) {
  const t = useT(), [group, setGroup] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const run = useRef(0), loading = useRef(false);
  const opening = useRef(false), openRun = useRef(0), [openingMember, setOpeningMember] = useState(false), [openError, setOpenError] = useState("");
  const open = async (member: GroupMember) => {
    if (opening.current) return;
    const current = ++openRun.current;
    opening.current = true; setOpeningMember(true); setOpenError("");
    try {
      const result = await window.ym.openGroupMember(contactId, member.id);
      if (openRun.current === current && !result.ok) setOpenError(result.error ?? t("search.openFailed"));
    } catch { if (openRun.current === current) setOpenError(t("search.openFailed")); }
    finally { if (openRun.current === current) { opening.current = false; setOpeningMember(false); } }
  };
  const load = async (cursor?: string) => {
    if (loading.current) return;
    const current = ++run.current;
    loading.current = true; setBusy(true); setError("");
    try {
      const result = await window.ym.groupMembers(contactId, cursor);
      if (run.current !== current) return;
      if (!result.ok || !result.group) { setError(result.error ?? t("group.failed")); return; }
      const page = result.group;
      setGroup(previous => {
        const members = cursor ? [...new Map([...(previous?.members ?? []), ...page.members].map(m => [m.id, m])).values()] : page.members;
        return { ...page, members, complete: page.complete && (page.memberCount === undefined || members.length >= page.memberCount) };
      });
    } catch { if (run.current === current) setError(t("group.failed")); }
    finally { if (run.current === current) { loading.current = false; setBusy(false); } }
  };
  useEffect(() => {
    setGroup(initial); loading.current = false; opening.current = false; setOpeningMember(false); setOpenError(""); void load();
    return () => { run.current++; openRun.current++; loading.current = false; opening.current = false; };
  }, [contactId]);
  return <section className="group-members" aria-label={t("group.members")}>
    <div className="group-members-heading"><b>{t("group.members")} ({group?.memberCount ?? group?.members.length ?? "…"})</b><button disabled={busy} onClick={() => void load()} title={t("group.refresh")} aria-label={t("group.refresh")}>↻</button></div>
    <ul>{group?.members.map(member => <Member key={member.id} member={member} disabled={openingMember} open={() => void open(member)} />)}</ul>
    {openingMember && <div role="status">{t("search.opening")}</div>}
    {openError && <div role="alert">{openError}</div>}
    {busy && <div role="status">{t("group.loading")}</div>}
    {error && <div role="alert">{error} <button disabled={busy} onClick={() => void load(group?.nextCursor)}>{t("search.retry")}</button></div>}
    {group?.nextCursor && <button disabled={busy} onClick={() => void load(group.nextCursor)}>{t("group.more")}</button>}
    {group && !group.complete && !group.nextCursor && !busy && <div role="status">{t("group.partial")}</div>}
  </section>;
}
