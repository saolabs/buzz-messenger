import { contextBridge, ipcRenderer } from "electron";
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
  loadMore: () => ipcRenderer.invoke("ym:loadMore"),
  attachment: (id, messageId, attachmentId) => ipcRenderer.invoke("ym:attachment", id, messageId, attachmentId),
  openProfile: () => ipcRenderer.send("ym:openProfile"),
  openInMessenger: (id) => ipcRenderer.send("ym:openInMessenger", id),
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
};
contextBridge.exposeInMainWorld("ym", api);
