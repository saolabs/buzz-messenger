import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Attachment, CallKind, ConversationView, Message } from "../core/types.ts";
import { GroupIcon, statusIcon, useAvatar, useSession } from "./buddy.tsx";
import { Composer } from "./composer.tsx";
import { GroupMembers } from "./group-members.tsx";
import { Frame, useZoomItems, type Menu } from "./frame.tsx";
import { useLang, useT } from "./i18n.ts";
import { Rich, useEmoticons } from "./rich.tsx";
import { Icon, playSound, SkinContext, skinUrl, Slice } from "./skin.tsx";

// BUZZ! đi qua Messenger dưới dạng tin chữ; bên nào nhận được dòng này thì rung cửa sổ.
const BUZZ = "BUZZ!!!";
// Nhận cả "buzz!!!", "BUZZ!" gõ tay từ Messenger thường.
const isBuzz = (m: Pick<Message, "text">) => /^buzz!+$/i.test(m.text.trim());
// Thông báo hệ thống của Facebook (vd bật tin nhắn tự hủy) giữ mã người tham gia "$PARTICIPANT_FIRST_NAME(id)".
const PARTICIPANT = /\$PARTICIPANT_FIRST_NAME\((\d+)\)/g;
// (regex riêng, không cờ g: .test() với cờ g nhớ lastIndex và cho kết quả xen kẽ)
const isSystemText = (text: string) => /\$PARTICIPANT_FIRST_NAME\(\d+\)|tin nhắn tự hủy|disappearing messages/i.test(text);
const time = (at: number, lang: string) => new Date(at).toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" });

// Nút toolbar lớn: sprite 8 trạng thái có frame 1 = nhấn, 2 = hover; nền thường ẩn.
function ToolbarButton({ icon, w, h, label, onClick, disabled = false }: { icon: string; w: number; h: number; label: string; onClick?: () => void; disabled?: boolean }) {
  const t = useT();
  return (
    <Slice src="images/btn-single-toolbar.png" n={8} states={[-1, 2, 1]} m={[2, 11, 2, 9]} className="btn hot tb-btn"
      title={onClick ? label : `${label} ${t("notYet")}`} role={onClick ? "button" : undefined}
      tabIndex={onClick && !disabled ? 0 : undefined} aria-disabled={onClick ? disabled : undefined}
      onClick={disabled ? undefined : onClick}
      onKeyDown={(e) => {
        if (onClick && !disabled && !e.repeat && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault(); onClick();
        }
      }}>
      <Icon src={icon} n={8} states={[0, 2, 1]} w={w} h={h} />
      {label}
    </Slice>
  );
}

type Pending = { key: number; text: string; error?: string };

// Chữ thay thế bộ đọc tự tạo cho tin chỉ có ảnh/âm thanh — đã hiện tệp thì ẩn chữ này.
const PLACEHOLDER = /^(?:\[(?:Hình ảnh|Tin nhắn thoại)\]|Ảnh(?:\s+\d+)?|Photo(?:\s+\d+)?|Image(?:\s+\d+)?|Tin nhắn thoại|Voice message)$/iu;
// Hiện thẳng: ảnh fbcdn hoặc ảnh nhúng sẵn data:image/… (Messenger e2ee dùng kiểu này); blob: thì phải nhờ main.
const directSource = (a: Attachment) =>
  a.source && (/^https:\/\/[^/]*(fbcdn\.net|facebook\.com)\//.test(a.source) || /^data:image\/(png|jpe?g|gif|webp);/.test(a.source)) ? a.source : undefined;

// Ảnh: nguồn fbcdn thì hiện thẳng; nguồn blob:/ lỗi thì nhờ main lấy qua trang Messenger ẩn.
// Tin thoại: bấm ▶ mới tải (mỗi lần tải phải mở hội thoại trong trang ẩn).
function AttachmentView({ contactId, messageId, a, onView }: { contactId: string; messageId: string; a: Attachment; onView: (src: string) => void }) {
  const t = useT();
  const [src, setSrc] = useState(a.kind === "image" ? directSource(a) : undefined);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const load = () => {
    setState("loading");
    window.ym.attachment(contactId, messageId, a.id).then((m) => {
      if ("error" in m) {
        setError(m.error);
        return setState("error");
      }
      setSrc(`data:${m.mimeType};base64,${m.data}`);
      setState("idle");
    });
  };
  useEffect(() => {
    if (a.kind === "image" && !src) load();
  }, []);
  if (a.kind === "image")
    return src ? (
      <img
        className={a.sticker ? "att-sticker" : "att-image"}
        src={src}
        alt={a.label ?? ""}
        title={a.label}
        referrerPolicy="no-referrer"
        onClick={() => !a.sticker && onView(src)}
        onError={() => (src.startsWith("data:") ? setState("error") : load())}
      />
    ) : (
      <span className="att-note" title={error}>
        {state === "error" ? t("im.mediaError") : t("im.mediaLoading")}
      </span>
    );
  return src ? (
    <audio className="att-audio" src={src} controls autoPlay />
  ) : (
    <button className="att-play" disabled={state === "loading"} onClick={load} title={error}>
      ▶ {state === "loading" ? t("im.mediaLoading") : state === "error" ? t("im.mediaError") : t("im.voice.message")}
    </button>
  );
}

function Conversation({ view, pending, onSend }: { view: ConversationView | undefined; pending: Pending[]; onSend: (text: string) => void }) {
  const [viewing, setViewing] = useState<string>();
  useEffect(() => {
    if (!viewing) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setViewing(undefined);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [viewing]);
  const skin = useContext(SkinContext);
  const emoticons = useEmoticons();
  const t = useT();
  const lang = useLang();
  const session = useSession();
  const contact = view?.contact;
  const [calling, setCalling] = useState<CallKind>();
  const [callError, setCallError] = useState("");
  const callBusy = useRef(false);
  const currentContact = useRef(contact?.id);
  currentContact.current = contact?.id;
  useEffect(() => setCallError(""), [contact?.id]);
  const startCall = async (kind: CallKind) => {
    if (!contact || callBusy.current) return;
    const id = contact.id;
    callBusy.current = true;
    setCalling(kind);
    setCallError("");
    try {
      const result = await window.ym.startCall(id, kind);
      if (!result.ok && currentContact.current === id) setCallError(result.error ?? t("im.callUnavailable"));
    } catch {
      if (currentContact.current === id) setCallError(t("im.callUnavailable"));
    } finally {
      callBusy.current = false;
      setCalling(undefined);
    }
  };
  const messages = view?.messages ?? [];
  const avatar = useAvatar(contact?.avatar);
  const historyRef = useRef<HTMLDivElement>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyInfo, setHistoryInfo] = useState("");
  const historyBusy = useRef(false);
  const historyRun = useRef(0);
  const historyAtTop = useRef(false);
  const pinned = useRef(true);
  const layout = useRef<{ contact?: string; first?: string; last?: string; height: number; pending: number } | undefined>(undefined);

  useEffect(() => {
    historyRun.current++;
    historyBusy.current = false;
    setHistoryLoading(false);
    setHistoryInfo("");
  }, [contact?.id]);
  useLayoutEffect(() => {
    const el = historyRef.current;
    if (!el) return;
    const previous = layout.current;
    const first = messages[0]?.id, last = messages.at(-1)?.id;
    if (!previous || previous.contact !== contact?.id || !previous.first || pending.length > previous.pending) {
      el.scrollTop = el.scrollHeight;
      pinned.current = true;
    } else if (first !== previous.first && !pinned.current) {
      el.scrollTop += el.scrollHeight - previous.height;
    } else if (pinned.current) el.scrollTop = el.scrollHeight;
    layout.current = { contact: contact?.id, first, last, height: el.scrollHeight, pending: pending.length };
  }, [contact?.id, messages, pending.length, emoticons.length]);

  const loadOlder = async () => {
    if (!contact || historyBusy.current) return;
    historyBusy.current = true;
    const run = ++historyRun.current;
    setHistoryLoading(true);
    setHistoryInfo("");
    try {
      const result = await window.ym.loadHistory(contact.id);
      if (run === historyRun.current) setHistoryInfo(result.ok ? (result.added ? "" : t("im.historyEmpty")) : result.error ?? t("im.historyFailed"));
    } catch {
      if (run === historyRun.current) setHistoryInfo(t("im.historyFailed"));
    } finally {
      if (run === historyRun.current) { historyBusy.current = false; setHistoryLoading(false); }
    }
  };
  const scrollHistory = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    pinned.current = el.scrollHeight - el.clientHeight - el.scrollTop < 40;
    if (el.scrollTop > 80) historyAtTop.current = false;
    if (el.scrollTop <= 40 && el.scrollHeight > el.clientHeight + 40 && !historyAtTop.current) {
      historyAtTop.current = true;
      void loadOlder();
    }
  };

  const last = messages.findLast((m) => m.direction === "incoming");
  const me = session?.displayName ?? session?.username ?? "";
  const myAvatar = useAvatar(session?.avatar);
  const name = contact?.name ?? "";

  return (
    <>
      <div className="im-toolbar">
        <ToolbarButton icon="images/video.png" w={24} h={31} label={t(calling === "video" ? "im.callOpening" : "im.video")} disabled={!contact || Boolean(calling) || session?.phase !== "signedIn"} onClick={() => void startCall("video")} />
        <ToolbarButton icon="images/voice.png" w={21} h={32} label={t(calling === "voice" ? "im.callOpening" : "im.voice")} disabled={!contact || Boolean(calling) || session?.phase !== "signedIn"} onClick={() => void startCall("voice")} />
        <div className="tb-spacer" />
        <ToolbarButton icon="IMWindow/IMTheme.png" w={43} h={30} label={t("im.imvironment")} />
        <ToolbarButton icon="IMWindow/Activities.png" w={33} h={31} label={t("im.activities")} />
        <ToolbarButton icon="IMWindow/PhotoShare.png" w={32} h={28} label={t("im.photos")} />
      </div>

      <div className="im-friendbar">
        {contact && (contact.kind === "group" ? <GroupIcon /> : <Icon src={statusIcon(contact.status)} w={10} h={10} />)}
        <span>{name}</span>
        {contact?.kind === "group" && <span className="group-count">{t("group.chat")}{contact.memberCount !== undefined ? ` · ${contact.memberCount} ${t("group.members").toLocaleLowerCase()}` : ""}</span>}
        <span className="friend-msg" />
        <Slice src="IMWindow/btn_bkgnd_invis_on_normal.png" n={8} states={[-1, 2, 1]} m={[3, 3, 3, 3]} className="btn hot small-btn" title={t("notYet")}>
          <Icon src="images/addbuddy_clr.png" n={8} states={[0, 2, 1]} w={13} h={13} /> {t("im.addUser")}
        </Slice>
        <Slice src="IMWindow/btn_bkgnd_invis_on_normal.png" n={8} states={[-1, 2, 1]} m={[3, 3, 3, 3]} className="btn hot small-btn" title={t("notYet")}>
          <Icon src="images/ignorebuddy.png" n={8} states={[0, 2, 1]} w={13} h={13} /> {t("im.ignoreUser")}
        </Slice>
      </div>
      {callError && <div className="send-error call-error" role="alert">{t("im.callFailed", { error: callError })}</div>}

      <div className="im-toggle">
        <button className="hot">
          <Icon src="IMWindow/im_view_toggle.png" n={8} states={[0, 2, 1]} w={23} h={12} />
        </button>
        <div className="bevel" />
      </div>

      <div className="im-main">
        <div className="im-left">
          <div className="im-history" ref={historyRef} onScroll={scrollHistory}>
            {!view && <div className="stamp">{t("im.loading")}</div>}
            {view && <div className="history-more">
              <button className="load-more" disabled={historyLoading || session?.phase !== "signedIn"} onClick={() => void loadOlder()}>{t(historyLoading ? "im.loadingHistory" : "im.loadHistory")}</button>
              {historyInfo && <div role="status">{historyInfo}</div>}
            </div>}
            {messages.map((m) =>
              m.direction === "system" || isSystemText(m.text) ? (
                <div key={m.id} className="line system" data-message-id={m.id}>
                  {m.text.replace(PARTICIPANT, (_, id) => {
                    if (id === session?.userId) return t("im.you");
                    const member = view?.group?.members.find(p => p.id === id);
                    return member?.nickname || member?.name || (contact?.kind === "group" ? t("group.unknownSender") : name.split(" ").at(-1) ?? name);
                  })}
                </div>
              ) : (
                <div key={m.id} className="line" data-message-id={m.id}>
                  <span className={`who ${m.direction === "outgoing" ? "me" : "them"}`}>{contact?.kind === "group" ? m.sender?.nickname || (m.direction === "outgoing" ? me : m.sender?.name || t("group.unknownSender")) : m.direction === "outgoing" ? me : name}</span>:{" "}
                  {isBuzz(m) ? (
                    <span className="buzz">{BUZZ}</span>
                  ) : m.attachments?.length && PLACEHOLDER.test(m.text.trim()) ? null : (
                    <Rich text={m.text} emoticons={emoticons} />
                  )}
                  {m.attachments?.map((a) => (
                    <div key={a.id} className="att">
                      <AttachmentView contactId={contact!.id} messageId={m.id} a={a} onView={setViewing} />
                    </div>
                  ))}
                </div>
              ),
            )}
            {pending.map((p) => (
              <div key={p.key} className={`line pending ${p.error ? "failed" : ""}`}>
                <span className="who me">{me}</span>: {p.text === BUZZ ? <span className="buzz">{BUZZ}</span> : <Rich text={p.text} emoticons={emoticons} />}
                {p.error && <div className="send-error">{t("im.sendFailed", { error: p.error })}</div>}
              </div>
            ))}
          </div>

          <Composer contactId={contact?.id} disabled={session?.phase !== "signedIn"} onSend={onSend} />
        </div>

        <Slice src="IMWindow/im_tb_disp_img_toggle_bg.png" m={[4, 4, 4, 4]} className={`im-display ${contact?.kind === "group" ? "group-display" : ""}`}>
          {contact?.kind === "group" ? <GroupMembers key={contact.id} contactId={contact.id} initial={view?.group} /> : <><img src={avatar} width={96} height={96} alt="" referrerPolicy="no-referrer" /><img src={myAvatar} width={48} height={48} alt="" referrerPolicy="no-referrer" /></>}
        </Slice>
      </div>

      {viewing && (
        <div className="viewer" onClick={() => setViewing(undefined)} title={t("im.closeImage")}>
          <img src={viewing} alt="" referrerPolicy="no-referrer" />
        </div>
      )}

      <div className="im-statusbar">
        {view?.error ? (
          <span className="status-error" title={view.error}>
            {view.error}
          </span>
        ) : (
          last && <>{t("im.last", { t: time(last.timestamp ?? last.observedAt, lang) })}</>
        )}
        <span className="grow" />
        <Icon src="images/resize_ctrl.png" w={16} h={16} />
      </div>
    </>
  );
}

export function ImWindow() {
  const [tabs, setTabs] = useState<string[]>([]);
  const [active, setActive] = useState<string>();
  const [views, setViews] = useState<Record<string, ConversationView>>({});
  const [pending, setPending] = useState<Record<string, Pending[]>>({});
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [shaking, setShaking] = useState(false);
  const t = useT();
  const zoomItems = useZoomItems();
  const activeRef = useRef(active);
  activeRef.current = active;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const seen = useRef(new Map<string, Set<string>>());
  // Tab được mở vì có tin đến (không phải người dùng bấm) → lần nạp đầu vẫn rung/kêu cho tin vừa tới.
  const openedByIncoming = useRef(new Set<string>());

  const buzz = () => {
    playSound("buzz.wav");
    window.ym.buzz();
    setShaking(true);
    setTimeout(() => setShaking(false), 500);
  };
  const flashTab = (id: string) => setFlash((f) => new Set(f).add(id));

  // Nhận dữ liệu hội thoại; tin đến mới (so với lần trước) → âm báo / BUZZ! / nháy tab.
  const receive = (id: string, view: ConversationView) => {
    const known = seen.current.get(id);
    const recent = (m: Message) => (m.timestamp ?? m.observedAt) > Date.now() - 120_000;
    const fresh = known
      ? view.messages.filter((m) => m.direction === "incoming" && !m.baseline && !known.has(m.id))
      : openedByIncoming.current.has(id)
        ? view.messages.filter((m) => m.direction === "incoming" && recent(m))
        : [];
    openedByIncoming.current.delete(id);
    seen.current.set(id, new Set(view.messages.map((m) => m.id)));
    setViews((v) => ({ ...v, [id]: view }));
    // Tin mình gửi đã thấy trong Messenger → bỏ dòng "đang gửi" tương ứng.
    setPending((p) => {
      const list = p[id];
      if (!list?.length) return p;
      const sent = view.messages.filter((m) => m.direction === "outgoing").map((m) => m.text);
      return { ...p, [id]: list.filter((x) => x.error || !sent.includes(x.text)) };
    });
    if (!fresh.length) return;
    if (fresh.some(isBuzz)) buzz();
    else playSound("message.wav");
    if (activeRef.current !== id || !document.hasFocus()) flashTab(id);
  };

  useEffect(
    () =>
      window.ym.onImOpen((id, focus) => {
        if (!focus && !seen.current.has(id)) openedByIncoming.current.add(id);
        setTabs((t) => (t.includes(id) ? t : [...t, id]));
        if (focus || !activeRef.current) setActive(id);
        else flashTab(id);
        window.ym.conversation(id).then((view) => view && receive(id, view));
      }),
    [],
  );
  useEffect(() => window.ym.onConversation((id, view) => tabsRef.current.includes(id) && receive(id, view)), []);
  // Đang nhìn tab này (cửa sổ có focus) → báo đã xem; lặp lại khi tin mới tới lúc vẫn đang nhìn.
  const activeView = active ? views[active] : undefined;
  useEffect(() => {
    const report = () => document.hasFocus() && activeRef.current && window.ym.seen(activeRef.current);
    report();
    window.addEventListener("focus", report);
    return () => window.removeEventListener("focus", report);
  }, [active, activeView]);
  // Báo main những người đang hiển thị để đọc tin định kỳ.
  useEffect(() => window.ym.watch(tabs), [tabs]);

  const send = (id: string, text: string) => {
    const key = Date.now() + Math.random();
    setPending((p) => ({ ...p, [id]: [...(p[id] ?? []), { key, text }] }));
    if (text === BUZZ) buzz();
    window.ym.send(id, text).then((result) => {
      if (!result.ok)
        setPending((p) => ({ ...p, [id]: (p[id] ?? []).map((x) => (x.key === key ? { ...x, error: result.error ?? "?" } : x)) }));
    });
  };

  const close = (id: string) => {
    const rest = tabs.filter((t) => t !== id);
    if (!rest.length) return window.ym.close();
    setTabs(rest);
    if (active === id) setActive(rest[Math.max(0, tabs.indexOf(id) - 1)]);
  };

  // Tách tab ra cửa sổ riêng (như kéo tab ra ngoài ở Y!M).
  const detach = (id: string) => {
    if (tabs.length < 2) return;
    window.ym.detachIm(id);
    close(id);
  };

  const contact = active ? views[active]?.contact : undefined;
  const menus: Menu[] = [
    {
      label: t("menu.conversation"),
      items: [
        { label: t("menu.openInMessenger"), disabled: !active, onClick: () => active && window.ym.openInMessenger(active) },
        "-",
        { label: t("menu.detach"), disabled: tabs.length < 2, onClick: () => active && detach(active) },
        { label: t("menu.closeTab"), onClick: () => active && close(active) },
        { label: t("menu.closeWindow"), onClick: () => window.ym.close() },
      ],
    },
    { label: t("menu.edit"), items: [{ label: t("menu.copy"), onClick: () => document.execCommand("copy") }, { label: t("menu.selectAll"), onClick: () => document.execCommand("selectAll") }] },
    { label: t("menu.view"), items: [{ label: t("menu.showImages"), checked: true, disabled: true }, "-", ...zoomItems] },
    { label: t("menu.actions"), items: [{ label: t("menu.buzz"), onClick: () => active && send(active, BUZZ) }] },
    { label: t("menu.help"), items: [{ label: t("app.about"), disabled: true }] },
  ];

  return (
    <div className={shaking ? "shake" : ""} style={{ height: "100%" }}>
      <Frame
        title={contact ? `${contact.name} (${contact.kind === "group" ? t("group.chat") : t(`status.${contact.status}`)})` : "Buzz! Messenger"}
        icon={contact && (contact.kind === "group" ? <GroupIcon /> : <Icon src={statusIcon(contact.status)} w={10} h={10} style={{ margin: "auto" }} />)}
        menus={menus}
      >
        {tabs.length > 1 && (
          <div className="im-tabs">
            {tabs.map((id) => {
              const c = views[id]?.contact;
              return (
                <Slice
                  key={id}
                  src="theme/tabs.png"
                  n={5}
                  states={id === active ? [2] : [0, 1, 2]}
                  m={[5, 5, 5, 3]}
                  className={`btn im-tab ${id === active ? "active" : ""} ${flash.has(id) ? "flash" : ""}`}
                  onDoubleClick={() => detach(id)}
                  onMouseDown={() => {
                    setActive(id);
                    setFlash((f) => {
                      const n = new Set(f);
                      n.delete(id);
                      return n;
                    });
                  }}
                >
                  {c && <Icon src={statusIcon(c.status)} w={10} h={10} />}
                  <span className="label">{c?.name ?? "…"}</span>
                  <span
                    className="x"
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      close(id);
                    }}
                  >
                    ×
                  </span>
                </Slice>
              );
            })}
          </div>
        )}
        {active && <Conversation key={active} view={views[active]} pending={pending[active] ?? []} onSend={(text) => send(active, text)} />}
      </Frame>
    </div>
  );
}
