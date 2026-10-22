import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { Bridge } from "../src/core/types.ts";

const on = <T>(channel: string, cb: (value: T) => void) => {
  const listener = (_e: unknown, value: T) => cb(value);
  ipcRenderer.on(channel, listener);
  return () => void ipcRenderer.removeListener(channel, listener);
};

const api: Bridge = {
  platform: process.platform,
  minimize: () => ipcRenderer.send("win:minimize"),
  maximize: () => ipcRenderer.send("win:maximize"),
  close: () => ipcRenderer.send("win:close"),
  buzz: () => ipcRenderer.send("win:buzz"),
  showAbout: () => ipcRenderer.send("app:about"),
  openIm: (contactId) => ipcRenderer.send("im:open", contactId),
  detachIm: (contactId) => ipcRenderer.send("im:detach", contactId),
  onImOpen: (cb) => {
    const listener = (_e: unknown, id: string, focus: boolean) => cb(id, focus !== false);
    ipcRenderer.on("im:open", listener);
    const off = () => void ipcRenderer.removeListener("im:open", listener);
    ipcRenderer.send("im:ready");
    return off;
  },
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (patch) => ipcRenderer.send("settings:set", patch),
  onSettings: (cb) => on("settings:changed", cb),
  session: () => ipcRenderer.invoke("ym:session"),
  onSession: (cb) => on("ym:session", cb),
  signIn: (input) => ipcRenderer.send("ym:signIn", input),
  signOut: () => ipcRenderer.send("ym:signOut"),
  cancelSignIn: () => ipcRenderer.send("ym:cancelSignIn"),
  setDisplayName: (name) => ipcRenderer.send("ym:setDisplayName", name),
  showMessenger: () => ipcRenderer.send("ym:showMessenger"),
  setPin: (pin, auto) => ipcRenderer.invoke("ym:setPin", pin, auto),
  contacts: () => ipcRenderer.invoke("ym:contacts"),
  searchContacts: (query) => ipcRenderer.invoke("ym:searchContacts", query),
  openSearchContact: (id) => ipcRenderer.invoke("ym:openSearchContact", id),
  loadMore: () => ipcRenderer.invoke("ym:loadMore"),
  loadHistory: (id) => ipcRenderer.invoke("ym:loadHistory", id),
  groupMembers: (id, cursor) => ipcRenderer.invoke("ym:groupMembers", id, cursor),
  openGroupMember: (id, memberId) => ipcRenderer.invoke("ym:openGroupMember", id, memberId),
  attachment: (id, messageId, attachmentId) => ipcRenderer.invoke("ym:attachment", id, messageId, attachmentId),
  openProfile: () => ipcRenderer.send("ym:openProfile"),
  openInMessenger: (id) => ipcRenderer.send("ym:openInMessenger", id),
  startCall: (id, kind) => ipcRenderer.invoke("ym:startCall", id, kind),
  onContacts: (cb) => on("ym:contacts", cb),
  watch: (ids) => ipcRenderer.send("ym:watch", ids),
  seen: (id) => ipcRenderer.send("ym:seen", id),
  conversation: (id) => ipcRenderer.invoke("ym:conversation", id),
  onConversation: (cb) => {
    const listener = (_e: unknown, id: string, view: Parameters<typeof cb>[1]) => cb(id, view);
    ipcRenderer.on("ym:conversation", listener);
    return () => void ipcRenderer.removeListener("ym:conversation", listener);
  },
  send: (id, text) => ipcRenderer.invoke("ym:send", id, text),
  stageFiles: (id, files) => {
    try { return ipcRenderer.invoke("ym:stageFiles", id, files.map(file => webUtils.getPathForFile(file))); }
    catch { return Promise.resolve({ error: "Không đọc được tệp kéo thả." }); }
  },
  stageAudible: (id, audible) => ipcRenderer.invoke("ym:stageAudible", id, audible),
  discardFiles: (ids) => ipcRenderer.send("ym:discardFiles", ids),
  sendFiles: (id, ids, text) => ipcRenderer.invoke("ym:sendFiles", id, ids, text),
};
contextBridge.exposeInMainWorld("ym", api);
