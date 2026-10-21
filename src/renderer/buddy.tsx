import { useContext, useEffect, useRef, useState } from "react";
import type { ContactView, SessionView, Status } from "../core/types.ts";
import { foldContactName as fold } from "../core/contact-search.ts";
import { Frame, useZoomItems, type Menu } from "./frame.tsx";
import { LANGS, useLang, useT, type Lang } from "./i18n.ts";
import { Rich, useEmoticons } from "./rich.tsx";
import { Combo, Icon, mediaUrl, playSound, PUSH_DEFAULT, SkinContext, skinUrl, Slice } from "./skin.tsx";

export const statusIcon = (s: Status) => `images/${s}.png`;
export const GroupIcon = ({ className = "" }: { className?: string }) => <svg className={className} aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="#81728f"><circle cx="10.5" cy="4" r="2.3" /><path d="M6.5 13v-3a4 4 0 0 1 8 0v3z" /><circle cx="5" cy="5.5" r="2.3" stroke="#f9f9f2" strokeWidth=".6" /><path d="M1 14v-3a4 4 0 0 1 8 0v3z" stroke="#f9f9f2" strokeWidth=".6" /></svg>;

// Phiên đăng nhập Messenger (main process giữ, renderer chỉ hiển thị).
export function useSession() {
  const [session, setSession] = useState<SessionView | null>(null);
  useEffect(() => {
    window.ym.session().then(setSession);
    return window.ym.onSession(setSession);
  }, []);
  return session;
}

// Avatar Facebook nếu có, không thì ảnh mặc định của skin.
export function useAvatar(url?: string) {
  const skin = useContext(SkinContext);
  return url ?? skinUrl(skin, "images/DefaultFriendIcon.png");
}

function MePanel({ name, avatar, status, onStatus, onRename }: { name: string; avatar?: string; status: Status; onStatus: (s: Status) => void; onRename: () => void }) {
  const skin = useContext(SkinContext);
  const picture = useAvatar(avatar);
  const t = useT();
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);
  return (
    // me_bg.png: resizemargin 2,59,160,1 → giữ nguyên 160px hoa văn bên phải
    <Slice src="FriendList/me_bg.png" m={[2, 0, 160, 0]} className="me-panel">
      <div className="me-avatar" title={t("me.profile")} onClick={() => window.ym.openProfile()}>
        <img src={picture} alt="" referrerPolicy="no-referrer" />
        <img className="overlay" src={skinUrl(skin, "FriendList/DisplayImgOverlay.png")} alt="" />
      </div>
      <div className="me-info">
        <div style={{ position: "relative" }}>
          <Slice
            src="images/btn-single-dropdown-small.png"
            n={4}
            states={[-1, 1, 2]}
            m={[2, 0, 12, 0]}
            className="btn me-name"
            onClick={() => setMenu(!menu)}
          >
            <Icon src={statusIcon(status === "idle" ? "online" : status)} w={10} h={10} />
            <span className="name">{name}</span>
            <Icon src="images/single_arrow_down.png" w={7} h={5} className="arrow" />
          </Slice>
          {menu && (
            <div className="menu-popup" style={{ top: 19 }} onMouseLeave={() => setMenu(false)}>
              {(["online", "busy", "offline"] as Status[]).map((s) => (
                <div
                  key={s}
                  className="menu-row"
                  onClick={() => {
                    onStatus(s);
                    setMenu(false);
                  }}
                >
                  <span className="menu-check">{status === s ? "✓" : ""}</span>
                  {t(s === "offline" ? "status.invisible" : `status.${s}`)}
                </div>
              ))}
              <div className="menu-sep" />
              <div
                className="menu-row"
                onClick={() => {
                  setMenu(false);
                  onRename();
                }}
              >
                <span className="menu-check" />
                {t("me.rename")}
              </div>
            </div>
          )}
        </div>
        <div className="me-status">
          {editing ? (
            <input
              autoFocus
              defaultValue={msg}
              maxLength={100}
              onBlur={(e) => {
                setMsg(e.currentTarget.value.trim());
                setEditing(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setEditing(false);
              }}
            />
          ) : (
            <Slice src="FriendList/btn-single-status.png" n={4} states={[0, 1, 2]} m={[2, 2, 2, 2]} className="btn me-status-text" onClick={() => setEditing(true)}>
              {msg ? <span>{msg}</span> : <span className="placeholder">{t("me.placeholder")}</span>}
            </Slice>
          )}
          <Slice src="images/btn-no-border-right.png" n={8} states={[0, 2, 1]} m={[2, 10, 3, 6]} className="btn me-status-drop" onClick={() => setEditing(true)}>
            <Icon src="images/single_arrow_down.png" w={7} h={5} />
          </Slice>
        </div>
      </div>
    </Slice>
  );
}

function Tabs({ tab, onTab }: { tab: "contacts" | "updates"; onTab: (t: "contacts" | "updates") => void }) {
  // TabLeft/TabRight.png: 8 trạng thái 28px, 0-3 chưa chọn, 4-7 đã chọn (thường/hover/nhấn/tắt)
  const states = (on: boolean) => (on ? [4, 6, 5] : [0, 2, 1]);
  const t = useT();
  return (
    <div className="fl-tabs">
      <div style={{ flex: 1, display: "flex", minWidth: 0 }}>
        <Slice
          src="FriendList/TabLeft.png"
          n={8}
          states={states(tab === "contacts")}
          m={[7, 11, 17, 9]}
          className={`btn fl-tab ${tab === "contacts" ? "checked" : ""}`}
          onClick={() => onTab("contacts")}
        >
          {t("tab.contacts")}
        </Slice>
        <Slice src="FriendList/TabMenuLeft.png" n={4} states={[0, 1, 2]} m={[1, 8, 16, 0]} className="btn fl-tab-menu" />
      </div>
      <Slice
        src="FriendList/TabRight.png"
        n={8}
        states={states(tab === "updates")}
        m={[7, 11, 17, 9]}
        className={`btn fl-tab ${tab === "updates" ? "checked" : ""}`}
        onClick={() => onTab("updates")}
      >
        <span className="tab-label">
          <Icon src="FriendList/new_updates.png" w={9} h={12} />
          {t("tab.updates")}
        </span>
      </Slice>
    </div>
  );
}

function SearchBar({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  const t = useT();
  return (
    <Slice src="FriendList/SearchBar.png" m={[40, 7, 10, 7]} className="search-area">
      <button className="add hot" title={t("menu.addContact")}>
        <Icon src="images/addbuddy.png" n={8} states={[0, 2, 1]} w={13} h={13} />
      </button>
      <div className="edit">
        <Icon src="FriendList/SearchOptions.png" n={4} w={16} h={13} />
        <input placeholder={t("search.placeholder")} maxLength={100} value={query} onChange={(e) => onQuery(e.target.value)} />
        {query && (
          <button className="hot" onClick={() => onQuery("")}>
            <Icon src="images/Clear.png" n={4} states={[0, 1, 2]} w={13} h={13} />
          </button>
        )}
      </div>
    </Slice>
  );
}

function ContactRow({ c, selected, onSelect, onOpen }: { c: ContactView; selected: boolean; onSelect: () => void; onOpen?: () => void }) {
  const emoticons = useEmoticons();
  const t = useT();
  const avatar = useAvatar(c.avatar);
  return (
    <div
      className={`fl-row ${c.status === "offline" && c.kind !== "group" ? "offline" : ""} ${c.unread ? "unread" : ""} ${selected ? "selected" : ""}`}
      onMouseDown={onSelect}
      onDoubleClick={() => onOpen ? onOpen() : window.ym.openIm(c.id)}
      title={`${c.name} — ${c.kind === "group" ? t("group.chat") : t(`status.${c.status}`)}`}
    >
      <Slice src="images/bg_hover.png" m={[2, 2, 2, 2]} className="bg hover" />
      <Slice src="images/bg_selected.png" m={[2, 2, 2, 2]} className="bg selected" />
      {c.kind === "group" ? <GroupIcon className="opi" /> : <Icon src={statusIcon(c.status)} w={10} h={10} className="opi" />}
      <img className="avatar" src={avatar} alt="" referrerPolicy="no-referrer" />
      <div className="name">{c.name}</div>
      {/* Messenger không có status message như Y!M → dòng thứ hai là tin gần nhất trong inbox. */}
      {c.preview && (
        <div className="msg">
          <Rich text={c.preview} emoticons={emoticons} />
        </div>
      )}
    </div>
  );
}

function ContactList({ contacts, query, loading }: { contacts: ContactView[]; query: string; loading: boolean }) {
  const skin = useContext(SkinContext);
  const t = useT();
  const [selected, setSelected] = useState<string>();
  const [open, setOpen] = useState(true);
  const [groupsOpen, setGroupsOpen] = useState(true);
  const [more, setMore] = useState(false);
  const moreBusy = useRef(false);
  const [moreError, setMoreError] = useState("");
  const [moreInfo, setMoreInfo] = useState("");
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState<{ query: string; loading: boolean; contacts: ContactView[]; error?: string }>({ query: "", loading: false, contacts: [] });
  const [opening, setOpening] = useState(false);
  const openingBusy = useRef(false);
  const [openError, setOpenError] = useState("");
  const trimmed = query.trim();
  useEffect(() => {
    let current = true;
    setOpenError("");
    setSearch({ query: trimmed, loading: !!trimmed, contacts: [] });
    if (trimmed) setOpen(true);
    const timer = trimmed ? setTimeout(() => {
      window.ym.searchContacts(trimmed).then(result => {
        if (current) setSearch({ query: trimmed, loading: false, contacts: result.contacts, error: result.ok ? undefined : result.error ?? t("search.failed") });
      }).catch(() => { if (current) setSearch({ query: trimmed, loading: false, contacts: [], error: t("search.failed") }); });
    }, 400) : undefined;
    return () => {
      current = false;
      clearTimeout(timer);
      // Cancels the page as soon as a query changes, including Clear/sign-out.
      void window.ym.searchContacts("").catch(() => {});
    };
  }, [trimmed, retry]);
  const remote = search.query === trimmed ? search : { loading: !!trimmed, contacts: [] as ContactView[], error: undefined };
  const q = fold(query.trim());
  const local = contacts.filter((c) => fold(c.name).includes(q));
  const remoteNames = new Set(remote.contacts.map(c => c.name.normalize("NFC")));
  const list = q ? [...remote.contacts, ...local.filter(c => !remoteNames.has(c.name.normalize("NFC")))] : contacts;
  const friends = list.filter(c => c.kind !== "group"), groups = list.filter(c => c.kind === "group");
  const row = (c: ContactView) => <ContactRow key={c.id} c={c} selected={selected === c.id} onSelect={() => setSelected(c.id)} onOpen={() => void openContact(c)} />;
  const openContact = async (c: ContactView) => {
    if (!c.searchResult) { window.ym.openIm(c.id); return; }
    if (openingBusy.current) return;
    openingBusy.current = true;
    setOpening(true); setOpenError("");
    try { const result = await window.ym.openSearchContact(c.id); if (!result.ok) setOpenError(result.error ?? t("search.openFailed")); }
    catch { setOpenError(t("search.openFailed")); }
    finally { openingBusy.current = false; setOpening(false); }
  };
  // Cuộn gần đáy → nhờ main quét inbox sâu hơn (Facebook chỉ tải thêm hội thoại khi danh sách chạm đáy).
  const loadMore = async () => {
    if (moreBusy.current || q) return;
    moreBusy.current = true;
    setMore(true);
    setMoreError("");
    setMoreInfo("");
    try {
      const result = await window.ym.loadMore();
      if (!result.ok) setMoreError(result.error ?? t("contacts.loadFailed"));
      else if (!result.added) setMoreInfo(t("contacts.noMore"));
    } catch { setMoreError(t("contacts.loadFailed")); }
    finally { moreBusy.current = false; setMore(false); }
  };
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) void loadMore();
  };
  return (
    <div className="fl-box" onScroll={onScroll}>
      <div className="fl-group" onClick={() => setOpen(!open)}>
        <img src={skinUrl(skin, open ? "expanded.gif" : "collapsed.gif")} alt="" />
        {t("group.friends")} ({friends.filter(c => c.status !== "offline").length}/{friends.length})
      </div>
      {open && friends.map(row)}
      {!!groups.length && <>
        <div className="fl-group" onClick={() => setGroupsOpen(!groupsOpen)}><img src={skinUrl(skin, groupsOpen ? "expanded.gif" : "collapsed.gif")} alt="" />{t("group.chats")} ({groups.length})</div>
        {groupsOpen && groups.map(row)}
      </>}
      {open && q && remote.loading && <div className="fl-empty" role="status">{t("search.loading")}</div>}
      {open && q && remote.error && <div className="fl-empty" role="alert">{remote.error} <button onClick={() => setRetry(n => n + 1)}>{t("search.retry")}</button></div>}
      {opening && <div className="fl-empty" role="status">{t("search.opening")}</div>}
      {openError && <div className="fl-empty" role="alert">{openError}</div>}
      {open && !list.length && !remote.loading && !remote.error && <div className="fl-empty">{loading ? t("contacts.loading") : t("search.empty", { q: query })}</div>}
      {open && !q && !loading && <div className="fl-empty">
        <button className="load-more" disabled={more} onClick={() => void loadMore()}>{t(more ? "contacts.loadingMore" : "contacts.loadMore")}</button>
        {moreError && <div role="alert">{moreError}</div>}
        {moreInfo && <div role="status">{moreInfo}</div>}
      </div>}
    </div>
  );
}

// "Hoạt động": ai vừa nhắn (theo thứ tự inbox), chưa đọc in đậm.
function Updates({ contacts }: { contacts: ContactView[] }) {
  const emoticons = useEmoticons();
  const t = useT();
  return (
    <div className="fl-box">
      {contacts
        .filter((c) => c.preview)
        .slice(0, 30)
        .map((c) => (
          <UpdateRow key={c.id} c={c}>
            <b>{c.name}</b> {t("update.message")}: <Rich text={c.preview!} emoticons={emoticons} />
          </UpdateRow>
        ))}
    </div>
  );
}
function UpdateRow({ c, children }: { c: ContactView; children: React.ReactNode }) {
  const avatar = useAvatar(c.avatar);
  return (
    <div className={`update ${c.unread ? "unread" : ""}`} onDoubleClick={() => window.ym.openIm(c.id)}>
      <img src={avatar} alt="" referrerPolicy="no-referrer" />
      <div>{children}</div>
    </div>
  );
}

// Bố cục theo LoginWnd.xml: ô ID/mật khẩu rộng 150, 3 checkbox, nút Sign In 80×23, link trợ giúp ở đáy.
// Mật khẩu chỉ đi vào main process: lưu trong vault mã hóa (khi chọn Remember) và tự điền form Facebook.
function Login({ session, onInvisible, onPin }: { session: SessionView; onInvisible: (v: boolean) => void; onPin: () => void }) {
  const t = useT();
  const lang = useLang();
  const [id, setId] = useState(session.username);
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(session.remember);
  const [auto, setAuto] = useState(session.autoSignIn);
  const [invisible, setInvisible] = useState(false);
  const [empty, setEmpty] = useState(false);
  const connected = session.phase === "signedIn";
  const busy = session.phase === "signingIn" || connected;
  // Các khung của login.swf (scripts/swf_to_svg.py): mặt bạc ngủ → tỉnh → đang kết nối → mặt vàng cười.
  const [awake, setAwake] = useState(false);
  useEffect(() => {
    if (!busy) return setAwake(false);
    const timer = setTimeout(() => setAwake(true), 400);
    return () => clearTimeout(timer);
  }, [busy]);
  const phase = session.phase === "signedIn" ? "connected" : busy ? (awake ? "connecting" : "awaking") : "asleep";
  const submit = () => {
    if (busy) return;
    if (!id.trim() || !password) return setEmpty(true);
    setEmpty(false);
    onInvisible(invisible);
    window.ym.signIn({ username: id.trim(), password, remember, autoSignIn: auto });
  };
  const enter = (e: React.KeyboardEvent) => e.key === "Enter" && submit();
  const message = connected ? t("login.connected") : empty
    ? t("login.empty")
    : session.error
      ? t(`login.error.${session.error as "rejected" | "timeout" | "vault"}`)
      : session.status === "verify"
        ? t("login.verify")
        : busy
          ? t("login.connecting")
          : "";
  return (
    <div className="login">
      <div className="login-main">
      <img src={mediaUrl(`login/${phase}.svg`)} alt={connected ? t("login.connected") : "Buzz! Messenger"} className="login-logo" />
      <fieldset className="login-form" disabled={busy}>
        <label>
          {t("login.id")}
          <input autoFocus value={id} placeholder={t("login.idHint")} onChange={(e) => setId(e.target.value)} onKeyDown={enter} />
        </label>
        <label>
          {t("login.password")}
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={enter} />
        </label>
        <div className="login-checks">
          <label>
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> {t("login.remember")}
          </label>
          <label>
            <input type="checkbox" checked={auto && remember} disabled={!remember} onChange={(e) => setAuto(e.target.checked)} /> {t("login.auto")}
          </label>
          <label>
            <input type="checkbox" checked={invisible} onChange={(e) => setInvisible(e.target.checked)} /> {t("login.invisible")}
          </label>
        </div>
        <div className={`login-error ${!connected && (empty || session.error) ? "" : "info"}`} role={connected ? "status" : undefined}>{message}</div>
        {/* Như Y!M: đang đăng nhập thì nút thành "Hủy". Nút là <div> nên vẫn bấm được khi fieldset bị khóa. */}
        {connected ? (
          <div className="login-btn" aria-hidden="true" />
        ) : busy ? (
          <Slice src="theme/pushbuttons.png" n={6} states={[0, 1, 2]} m={[4, 4, 4, 11]} className="btn pushbutton login-btn" onClick={() => window.ym.cancelSignIn()}>
            {t("login.cancel")}
          </Slice>
        ) : (
          <Slice src="theme/pushbuttons.png" n={6} states={PUSH_DEFAULT} m={[4, 4, 4, 11]} className="btn pushbutton login-btn" onClick={submit}>
            {t("login.signIn")}
          </Slice>
        )}
        {session.status === "verify" && (
          <>
            <span className="login-link" onClick={() => window.ym.showMessenger()}>
              {t("login.openMessenger")}
            </span>
            <span className="login-link" onClick={onPin}>
              {t("menu.pin")}
            </span>
          </>
        )}
      </fieldset>
      {/* ngoài fieldset: vẫn đổi được ngôn ngữ khi form bị khóa lúc đang đăng nhập */}
      <label className="login-lang">
        {t("login.language")}
        <Combo value={lang} options={Object.entries(LANGS)} onChange={(v) => window.ym.setSettings({ lang: v as Lang })} />
      </label>
      </div>
      <div className="login-links">
        <span title={t("notYet")}>{t("login.signUp")}</span>
        <span title={t("notYet")}>{t("login.forgot")}</span>
      </div>
    </div>
  );
}

// Mã PIN khôi phục lịch sử Messenger (6 số). Lưu trong vault mã hóa; app tự nhập chậm 1 giây mỗi ô khi Messenger hỏi.
function PinDialog({ session, onClose }: { session: SessionView; onClose: () => void }) {
  const t = useT();
  const [pin, setPin] = useState("");
  const [auto, setAuto] = useState(session.hasPin ? session.autoPin : true);
  const [error, setError] = useState(false);
  // null = giữ PIN đã lưu, chỉ đổi lựa chọn tự nhập; "" = xóa PIN.
  const save = (value: string | null) => {
    if (value && !/^\d{6}$/.test(value)) return setError(true);
    window.ym.setPin(value, auto).then((r) => (r.ok ? onClose() : setError(true)));
  };
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog">
        <div className="dialog-title">{t("pin.title")}</div>
        <div className="dialog-hint">{t(session.hasPin ? "pin.saved" : "pin.hint")}</div>
        <input
          autoFocus
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={pin}
          placeholder="••••••"
          onChange={(e) => {
            setPin(e.target.value.replace(/\D/g, ""));
            setError(false);
          }}
          onKeyDown={(e) => e.key === "Enter" && save(pin || (session.hasPin ? null : pin))}
        />
        <label>
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> {t("pin.auto")}
        </label>
        {error && <div className="login-error">{t("pin.invalid")}</div>}
        <div className="dialog-buttons">
          {session.hasPin && (
            <Slice src="theme/pushbuttons.png" n={6} states={[0, 1, 2]} m={[4, 4, 4, 11]} className="btn pushbutton" onClick={() => save("")}>
              {t("pin.clear")}
            </Slice>
          )}
          <Slice src="theme/pushbuttons.png" n={6} states={[0, 1, 2]} m={[4, 4, 4, 11]} className="btn pushbutton" onClick={onClose}>
            {t("pin.cancel")}
          </Slice>
          <Slice
            src="theme/pushbuttons.png"
            n={6}
            states={PUSH_DEFAULT}
            m={[4, 4, 4, 11]}
            className="btn pushbutton"
            onClick={() => save(pin || (session.hasPin ? null : pin))}
          >
            {t("pin.save")}
          </Slice>
        </div>
      </div>
    </div>
  );
}

// Tên hiển thị của mình (Y!M cho đặt tên hiển thị khác với ID). Để trống = dùng ID đăng nhập.
function NameDialog({ session, onClose }: { session: SessionView; onClose: () => void }) {
  const t = useT();
  const [name, setName] = useState(session.displayName ?? "");
  const save = () => {
    window.ym.setDisplayName(name);
    onClose();
  };
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog">
        <div className="dialog-title">{t("me.rename")}</div>
        <div className="dialog-hint">{t("me.renameHint", { id: session.username })}</div>
        <input className="dialog-text" autoFocus maxLength={60} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
        <div className="dialog-buttons">
          <Slice src="theme/pushbuttons.png" n={6} states={[0, 1, 2]} m={[4, 4, 4, 11]} className="btn pushbutton" onClick={onClose}>
            {t("pin.cancel")}
          </Slice>
          <Slice src="theme/pushbuttons.png" n={6} states={PUSH_DEFAULT} m={[4, 4, 4, 11]} className="btn pushbutton" onClick={save}>
            {t("pin.save")}
          </Slice>
        </div>
      </div>
    </div>
  );
}

function SkinPicker({ skins, onClose }: { skins: string[]; onClose: () => void }) {
  const current = useContext(SkinContext);
  return (
    <div className="skin-picker" onMouseLeave={onClose}>
      {skins.map((s) => (
        <button key={s} className={s === current ? "on" : ""} title={s} onClick={() => window.ym.setSettings({ skin: s })}>
          <img src={skinUrl(s, "preview.png")} alt={s} />
        </button>
      ))}
    </div>
  );
}

function useContacts(signedIn: boolean) {
  const [contacts, setContacts] = useState<ContactView[] | null>(null);
  useEffect(() => {
    if (!signedIn) return setContacts(null);
    window.ym.contacts().then(setContacts);
    return window.ym.onContacts(setContacts);
  }, [signedIn]);
  return contacts;
}

export function BuddyWindow({ skins }: { skins: string[] }) {
  const session = useSession();
  const connected = session?.phase === "signedIn";
  const username = session?.username;
  const [readyFor, setReadyFor] = useState<string | null>(null);
  const signedIn = connected && readyFor === username;
  useEffect(() => {
    if (!connected || !username) { setReadyFor(null); return; }
    const timer = setTimeout(() => setReadyFor(username), 2000);
    return () => clearTimeout(timer);
  }, [connected, username]);
  const contacts = useContacts(signedIn);
  // Trạng thái của chính mình chỉ hiển thị trong app (Messenger không có Busy/Invisible tương ứng).
  const [status, setStatus] = useState<Status>("online");
  const invisible = useRef(false);
  const [tab, setTab] = useState<"contacts" | "updates">("contacts");
  const [query, setQuery] = useState("");
  const [picker, setPicker] = useState(false);
  const [pinDialog, setPinDialog] = useState(false);
  const [nameDialog, setNameDialog] = useState(false);
  const t = useT();
  const lang = useLang();
  const zoomItems = useZoomItems();
  const wasSignedIn = useRef(false);
  useEffect(() => {
    if (connected && !wasSignedIn.current) {
      setStatus(invisible.current ? "offline" : "online");
      playSound("online.wav");
    }
    wasSignedIn.current = connected;
  }, [connected]);
  const menus: Menu[] = [
    {
      label: t("menu.messenger"),
      items: [
        ...(signedIn ? [{ label: t("menu.signOut"), onClick: () => window.ym.signOut() }] : []),
        { label: t("menu.openMessenger"), disabled: !session || session.phase === "signedOut", onClick: () => window.ym.showMessenger() },
        { label: t("menu.pin"), disabled: !session?.username, onClick: () => setPinDialog(true) },
        "-",
        { label: t("menu.skin"), onClick: () => setPicker(true) },
        ...Object.entries(LANGS).map(([k, name]) => ({ label: name, checked: k === lang, onClick: () => window.ym.setSettings({ lang: k as Lang }) })),
        "-",
        { label: t("menu.exit"), onClick: () => window.ym.close() },
      ],
    },
    // Như Y!M gốc: chưa đăng nhập chỉ có Messenger và Trợ giúp.
    ...(signedIn
      ? [
          { label: t("menu.view"), items: zoomItems },
          { label: t("menu.contacts"), items: [{ label: t("menu.addContact"), disabled: true }, { label: t("menu.addGroup"), disabled: true }] },
          { label: t("menu.actions"), items: [{ label: t("menu.sendIm"), disabled: true }] },
        ]
      : []),
    { label: t("menu.help"), items: [{ label: t("app.about"), disabled: true }] },
  ];
  return (
    <Frame main menus={menus} onSkinButton={() => setPicker(!picker)}>
      {!session ? null : !signedIn ? (
        <Login session={session} onInvisible={(v) => (invisible.current = v)} onPin={() => setPinDialog(true)} />
      ) : (
        <>
          <MePanel name={session.displayName ?? session.username} avatar={session.avatar} status={status} onStatus={setStatus} onRename={() => setNameDialog(true)} />
          <Tabs tab={tab} onTab={setTab} />
          {tab === "contacts" && <SearchBar query={query} onQuery={setQuery} />}
          {tab === "contacts" ? <ContactList contacts={contacts ?? []} query={query} loading={!contacts} /> : <Updates contacts={contacts ?? []} />}
        </>
      )}
      {picker && <SkinPicker skins={skins} onClose={() => setPicker(false)} />}
      {pinDialog && session && <PinDialog session={session} onClose={() => setPinDialog(false)} />}
      {nameDialog && session && <NameDialog session={session} onClose={() => setNameDialog(false)} />}
    </Frame>
  );
}
