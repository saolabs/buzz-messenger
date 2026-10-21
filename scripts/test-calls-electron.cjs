const repo = require('node:path').resolve(__dirname, '..');
const requireFromRepo = require('node:module').createRequire(repo + '/package.json');
const { app, BrowserWindow } = requireFromRepo('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
requireFromRepo('tsx/cjs');
const { Browsers } = require(repo + '/electron/browser.ts');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'buzz-call-fixture-'));
app.setPath('userData', profile);
const timeout = setTimeout(() => { console.error('Integration timeout'); app.exit(1); }, 20000);
const waitFor = async (get) => {
  for (let i = 0; i < 100; i++) { const result = get(); if (result) return result; await new Promise(r => setTimeout(r, 50)); }
  throw new Error('Fixture did not become ready');
};
app.whenReady().then(async () => {
  const account = { id:'fb', name:'Fixture', platform:'messenger-personal', username:'fixture', password:'', facebookUserId:'1', cookies:[{domain:'.facebook.com',path:'/',name:'c_user',value:'1',secure:true,httpOnly:true,sameSite:'no_restriction'}] };
  const c = { id:'fixture-thread', accountId:'fb', platformId:'123', name:'Linh', url:'https://www.facebook.com/messages/t/123/', messages:[], initialized:true };
  const state = { version:1, accounts:[account], conversations:[c] };
  const vault = { read:()=>structuredClone(state), mutate:async fn=>fn(state) };
  const host = new BrowserWindow({ show:false });
  const browsers = new Browsers(host, vault, ()=>{}, ()=>{});
  // No hardware access or real network is exercised by this test.
  browsers.callWindows.requestDevices = async () => {};
  const session = await browsers.accountSession(account);
  await session.protocol.handle('https', request => new Response(new URL(request.url).pathname.startsWith('/messages/t/') ? `
    <div role="grid" aria-label="Chats"><a href="/messages/t/123/" aria-current="page"><span dir="auto">Linh</span></a></div>
    <main role="main">
      <button aria-label="Start an audio call" onclick="window.callClicks=(window.callClicks||0)+1;window.open('https://www.facebook.com/call/?fixture=1')">Call</button>
      <button aria-label="Start a video call">Video</button>
      <div role="textbox" contenteditable="true" aria-label="Message Linh"></div>
    </main>` : '<h1>Offline call fixture</h1>', { headers:{'content-type':'text/html'} }));
  session.webRequest.onBeforeRequest({urls:['http://*/*']}, (_details, cb)=>cb({cancel:true}));
  await Promise.all([browsers.startCall(c,'voice'), browsers.startCall(c,'voice')]);
  assert.equal(browsers.list().length,1,'duplicate click opened a second source window');
  const entry = browsers.entries.get(browsers.list()[0].id);
  const wc = entry.view.webContents;
  const popup = await waitFor(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('https://www.facebook.com/call/')));
  assert.equal(await wc.executeJavaScript('window.callClicks'),1);
  assert.equal(browsers.callWindows.mediaAllowed(popup.webContents,'https://www.facebook.com/',['audio']),true);
  assert.equal(browsers.callWindows.mediaAllowed(popup.webContents,'https://www.facebook.com/',['video']),false);
  assert.equal(browsers.callWindows.mediaAllowed(popup.webContents,'https://example.com/',['audio']),false);
  popup.hide();
  assert.equal(browsers.callWindows.mediaAllowed(popup.webContents,'https://www.facebook.com/',['audio']),false);
  popup.show();
  await browsers.startCall(c,'voice');
  assert.equal(await wc.executeJavaScript('window.callClicks'),1,'existing call was redialed');
  const count=BrowserWindow.getAllWindows().length;
  assert.equal(await wc.executeJavaScript("window.open('https://example.com/call/') === null", true),true);
  assert.equal(BrowserWindow.getAllWindows().length,count,'foreign popup was allowed');
  await assert.rejects(browsers.startCall({...c,id:'bad-url',url:'https://www.facebook.com/messages/t/999/'},'voice'));
  await browsers.signOut('fb');
  assert.equal(popup.isDestroyed(),true,'call popup survived sign-out');
  assert.equal(browsers.list().length,0);
  assert.equal(browsers.callWindows.pages.size,0);
  browsers.shutdown(); host.destroy(); clearTimeout(timeout);
  console.log('CALL_INTEGRATION_OK: offline Electron launch, popup, duplicate suppression, scoped permissions, sign-out cleanup');
  app.exit(0);
}).catch(error=>{ console.error(error.stack); clearTimeout(timeout); app.exit(1); });
