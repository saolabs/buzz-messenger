import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AUDIBLES, validateUploadSizes, type StagedFile } from "../core/uploads.ts";
import { useT } from "./i18n.ts";
import { useEmoticons } from "./rich.tsx";
import { Icon, mediaUrl, PUSH_DEFAULT, Slice } from "./skin.tsx";

function Tool({ icon, w, title, hint, active, disabled, onClick }: { icon: string; w: number; title: string; hint?: string; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return <button type="button" className="hot composer-tool" title={hint ?? title} aria-label={title} aria-pressed={active} disabled={disabled} onClick={onClick}>
    <Slice src="IMWindow/btn_bkgnd_invis_on_normal.png" n={8} states={active ? [4, 6, 5] : [-1, 2, 1]} m={[4, 6, 4, 13]} className="tool" style={{ width: w + 10 }}>
      <Icon src={icon} n={8} states={active ? [4, 6, 5] : [0, 2, 1]} w={w} h={18} />
    </Slice>
  </button>;
}
type Queued = StagedFile & { preview?: string };
const defaultFont = { family: "Tahoma", size: 12, color: "#000000", bold: false, italic: false, underline: false };
function savedFont() {
  try { return { ...defaultFont, ...JSON.parse(localStorage.getItem("buzz.composerFont") ?? "{}") }; }
  catch { return defaultFont; }
}

export function Composer({ contactId, disabled, onSend }: { contactId?: string; disabled: boolean; onSend: (text: string) => void }) {
  const t = useT(), emoticons = useEmoticons();
  const [draft, setDraft] = useState("");
  const [panel, setPanel] = useState<"emoji" | "audibles" | "format">();
  const [files, setFiles] = useState<Queued[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [drag, setDrag] = useState(false);
  const [font, setFont] = useState(savedFont);
  const input = useRef<HTMLTextAreaElement>(null), picker = useRef<HTMLInputElement>(null);
  const alive = useRef(true), queue = useRef(files), staging = useRef(false), sending = useRef(false), dragDepth = useRef(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  queue.current = files;
  useEffect(() => {
    alive.current = true;
    input.current?.focus();
    const prevent = (e: DragEvent) => { if (e.dataTransfer?.types.includes("Files")) e.preventDefault(); };
    window.addEventListener("dragover", prevent); window.addEventListener("drop", prevent);
    return () => {
      alive.current = false; audio.current?.pause();
      window.removeEventListener("dragover", prevent); window.removeEventListener("drop", prevent);
      window.ym.discardFiles(queue.current.map(f => f.id));
      for (const f of queue.current) if (f.preview) URL.revokeObjectURL(f.preview);
    };
  }, []);
  useEffect(() => { localStorage.setItem("buzz.composerFont", JSON.stringify(font)); }, [font]);
  const remove = (id: string) => {
    const file = queue.current.find(f => f.id === id);
    if (file?.preview) URL.revokeObjectURL(file.preview);
    window.ym.discardFiles([id]); setFiles(f => f.filter(x => x.id !== id));
  };
  const add = async (incoming: File[]) => {
    if (!contactId || disabled || staging.current || sending.current || !incoming.length) return;
    staging.current = true; setBusy(true); setError("");
    try {
      validateUploadSizes([...queue.current, ...incoming]);
      const result = await window.ym.stageFiles(contactId, incoming);
      if (result.error || !result.files) throw new Error(result.error ?? t("im.fileError"));
      if (!alive.current) { window.ym.discardFiles(result.files.map(f => f.id)); return; }
      const selected = result.files.map((f, i) => ({ ...f, preview: f.image ? URL.createObjectURL(incoming[i]) : undefined }));
      setFiles(old => [...old, ...selected]); input.current?.focus();
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : t("im.fileError")); }
    finally { staging.current = false; if (alive.current) setBusy(false); }
  };
  const addAudible = async (id: string) => {
    if (!contactId || busy || disabled) return;
    setBusy(true); setError("");
    try {
      const result = await window.ym.stageAudible(contactId, id);
      if (!result.files || result.error) throw new Error(result.error ?? t("im.fileError"));
      if (!alive.current) { window.ym.discardFiles(result.files.map(f => f.id)); return; }
      try { validateUploadSizes([...queue.current, ...result.files]); }
      catch (e) { window.ym.discardFiles(result.files.map(f => f.id)); throw e; }
      setFiles(old => [...old, ...result.files!]); setPanel(undefined);
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : t("im.fileError")); }
    finally { if (alive.current) setBusy(false); }
  };
  const send = async () => {
    if (!contactId || disabled || busy || sending.current) return;
    const text = draft.trim(), selected = queue.current;
    if (!text && !selected.length) return;
    if (!selected.length) { onSend(text); setDraft(""); return; }
    sending.current = true; setBusy(true); setError("");
    try {
      const result = await window.ym.sendFiles(contactId, selected.map(f => f.id), text);
      if (!alive.current) return;
      if (result.ok || result.attempted) {
        for (const f of selected) if (f.preview) URL.revokeObjectURL(f.preview);
        setFiles([]); setDraft("");
      }
      if (!result.ok) setError(result.error ?? t("im.fileError"));
    } catch { if (alive.current) setError(t("im.fileError")); }
    finally { sending.current = false; if (alive.current) setBusy(false); }
  };
  const insert = (code: string) => {
    const el = input.current!; const start = el.selectionStart, end = el.selectionEnd;
    setDraft(draft.slice(0, start) + code + draft.slice(end)); setPanel(undefined);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + code.length, start + code.length); });
  };
  const style: CSSProperties = { fontFamily: font.family, fontSize: font.size, color: font.color,
    fontWeight: font.bold ? "bold" : "normal", fontStyle: font.italic ? "italic" : "normal", textDecoration: font.underline ? "underline" : "none" };
  const toggle = (next: typeof panel) => setPanel(p => p === next ? undefined : next);
  const unavailable = busy || disabled || !contactId;
  return <div className={`im-input-panel ${files.length || error ? "has-extras" : ""} ${drag ? "drag-over" : ""}`} onDragEnter={e => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); dragDepth.current++; setDrag(true); } }}
    onDragOver={e => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); e.dataTransfer.dropEffect = unavailable ? "none" : "copy"; } }}
    onDragLeave={e => { if (e.dataTransfer.types.includes("Files") && --dragDepth.current <= 0) setDrag(false); }}
    onDrop={e => { e.preventDefault(); dragDepth.current = 0; setDrag(false); void add([...e.dataTransfer.files]); }}>
    <div className="im-imtoolbar">
      <Tool icon="IMWindow/im_tb_emoticon.png" w={25} title={t("im.emoticons")} active={panel === "emoji"} disabled={unavailable} onClick={() => toggle("emoji")} />
      <Tool icon="IMWindow/im_tb_audibles.png" w={20} title={t("im.audibles")} active={panel === "audibles"} disabled={unavailable} onClick={() => toggle("audibles")} />
      <Tool icon="IMWindow/im_tb_format.png" w={13} title={t("im.format")} active={panel === "format"} disabled={unavailable} onClick={() => toggle("format")} />
      <Tool icon="IMWindow/im_tb_buzz.png" w={18} title={t("im.buzz")} disabled={unavailable} onClick={() => onSend("BUZZ!!!")} />
      <Tool icon="images/SendFile.png" w={17} title={t("im.sendFile")} hint={`${t("im.sendFile")} · ${t("im.fileHint")}`} disabled={unavailable} onClick={() => picker.current?.click()} />
      <input ref={picker} className="file-picker" type="file" multiple tabIndex={-1} aria-label={t("im.sendFile")} onChange={e => { void add([...e.target.files ?? []]); e.target.value = ""; }} />
      {panel === "emoji" && <div className="emo-picker" role="dialog" aria-label={t("im.emoticons")}>
        {emoticons.map(e => <button key={e.id} title={`${e.title} ${e.codes[0]}`} onClick={() => insert(e.codes[0])}><img src={mediaUrl(e.file)} alt={e.codes[0]} /></button>)}
      </div>}
      {panel === "audibles" && <div className="composer-popover audibles-picker" role="dialog" aria-label={t("im.audibles")}>
        <strong>{t("im.audibleHint")}</strong>
        {AUDIBLES.map(a => <div key={a.id}><span>{a.name}</span><button onClick={() => { audio.current?.pause(); audio.current = new Audio(mediaUrl(a.file)); void audio.current.play().catch(() => setError(t("im.audioError"))); }}>{t("im.previewSound")}</button><button disabled={busy} onClick={() => void addAudible(a.id)}>{t("im.chooseFile")}</button></div>)}
      </div>}
      {panel === "format" && <div className="composer-popover font-picker" role="dialog" aria-label={t("im.format")}>
        <label>{t("im.font")}<select aria-label={t("im.font")} value={font.family} onChange={e => setFont({ ...font, family: e.target.value })}>{["Tahoma", "Arial", "Verdana", "Georgia", "Courier New"].map(f => <option key={f}>{f}</option>)}</select></label>
        <label>{t("im.fontSize")}<select aria-label={t("im.fontSize")} value={font.size} onChange={e => setFont({ ...font, size: Number(e.target.value) })}>{[10, 12, 14, 16, 18, 24].map(n => <option key={n}>{n}</option>)}</select></label>
        <label>{t("im.fontColor")}<input aria-label={t("im.fontColor")} type="color" value={font.color} onChange={e => setFont({ ...font, color: e.target.value })} /></label>
        {(["bold", "italic", "underline"] as const).map((key, i) => <button key={key} aria-label={t(`im.${key}`)} aria-pressed={font[key]} style={{ fontWeight: i === 0 ? "bold" : undefined, fontStyle: i === 1 ? "italic" : undefined, textDecoration: i === 2 ? "underline" : undefined }} onClick={() => setFont({ ...font, [key]: !font[key] })}>{["B", "I", "U"][i]}</button>)}
        <p>{t("im.formatHint")}</p>
      </div>}
    </div>
    {files.length > 0 && <div className="queued-files" aria-label={t("im.queuedFiles")}>{files.map(f => <div className="queued-file" key={f.id}>
      {f.preview && <img src={f.preview} alt="" />}<span title={f.name}>{f.name}<small>{Math.max(1, Math.round(f.size / 1024))} KB</small></span>
      <button disabled={busy} aria-label={`${t("im.removeFile")} ${f.name}`} onClick={() => remove(f.id)}>×</button>
    </div>)}</div>}
    {error && <div className="composer-error" role="alert">{error}</div>}
    <div className="im-bevel" />
    <div className="im-input">
      <textarea ref={input} value={draft} style={style} maxLength={5000} disabled={unavailable} aria-label={t("im.messageInput")} placeholder={drag ? t("im.dropFiles") : undefined}
        onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Escape") setPanel(undefined); if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
      <button type="button" className="hot send-button" disabled={unavailable || (!draft.trim() && !files.length)} onClick={() => void send()}>
        <Slice src="theme/pushbuttons.png" n={6} states={PUSH_DEFAULT} m={[4, 4, 4, 11]} className="pushbutton send">{t(busy ? "im.sendingFiles" : "im.send")}</Slice>
      </button>
    </div>
    {drag && <div className="drop-hint" role="status">{t("im.dropFiles")}</div>}
  </div>;
}
