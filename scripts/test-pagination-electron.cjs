// Offline integration: real Electron scrolling, delayed pages, and service IPC operations.
const repo = require('node:path').resolve(__dirname, '..');
const fromRepo = require('node:module').createRequire(repo + '/package.json');
const { app, BrowserWindow } = fromRepo('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
fromRepo('tsx/cjs');
const { Browsers } = require(repo + '/electron/browser.ts');
const { MessengerService } = require(repo + '/electron/messenger-service.ts');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'buzz-pagination-fixture-')));
const timer = setTimeout(() => { console.error('Pagination integration timeout'); app.exit(1); }, 60000);
const inbox = `<!doctype html><div role="grid" aria-label="Chats" style="height:260px;overflow:hidden"><div id="viewport" style="height:260px;overflow-y:auto"></div></div><script>
  const viewport=document.querySelector('#viewport');let count=20,busy=false;
  const render=()=>{viewport.innerHTML=Array.from({length:count},(_,i)=>'<a style="display:block;height:40px" href="/messages/t/'+(i+1)+'/"><span dir="auto">Fixture '+i+'</span></a>').join('')};
  render();viewport.addEventListener('scroll',()=>{if(!busy&&count<400&&viewport.scrollTop+viewport.clientHeight>=viewport.scrollHeight-4){busy=true;setTimeout(()=>{count+=20;render();busy=false},900)}});
</script>`;
const chat = `<!doctype html><div role="grid" aria-label="Chats"><a aria-current="page" href="/messages/t/123/"><span dir="auto">Fixture</span></a></div>
  <section aria-label="Conversation with Fixture"><div id="history" style="height:260px;overflow-y:auto;overflow-anchor:none"></div><div role="textbox" contenteditable="true" aria-label="Message Fixture"></div><button aria-label="Press Enter to send"></button></section><script>
  const history=document.querySelector('#history');let start=281,busy=false;
  // Messenger fetches when a sentinel intersects the viewport. A synthetic
  // scroll event in a detached WebContentsView must not pass this fixture.
  const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)&&!busy&&start>1){busy=true;setTimeout(()=>{const height=history.scrollHeight;start=Math.max(1,start-20);render();history.scrollTop+=history.scrollHeight-height;busy=false},1100)}},{root:history});
  const render=()=>{observer.disconnect();history.innerHTML='<div id="sentinel" style="height:1px"></div>'+Array.from({length:301-start},(_,i)=>{const n=start+i;return '<div role="article" data-message-id="msg-'+n+'" style="height:30px"><div role="button" aria-label="Message sent by Fixture at 10:19: Synthetic '+n+'"></div>'+(n===300?'<img width="80" height="80" alt="Fixture image" src="https://www.facebook.com/fixture.png">':'')+'</div>'}).join('');observer.observe(document.querySelector('#sentinel'))};
  render();history.scrollTop=history.scrollHeight;
</script>`;
app.whenReady().then(async () => {
  const account={id:'fb',name:'Fixture',platform:'messenger-personal',facebookUserId:'1',cookies:[{domain:'.facebook.com',path:'/',name:'c_user',value:'1',secure:true,httpOnly:true,sameSite:'no_restriction'}]};
  const c={id:'fixture',accountId:'fb',platformId:'123',name:'Fixture',url:'https://www.facebook.com/messages/t/123/',initialized:true,messages:[{id:'msg-300',text:'Synthetic 300',direction:'incoming',timestamp:null,observedAt:0,baseline:false,identity:'platform',precision:'minute'}]};
  const state={version:1,accounts:[account],conversations:[c]};
  const vault={read:()=>structuredClone(state),mutate:async fn=>fn(state)};
  const host=new BrowserWindow({show:false});
  const browsers=new Browsers(host,vault,()=>{},()=>{});
  const session=await browsers.accountSession(account);
  await session.protocol.handle('https',req=>new URL(req.url).pathname==='/fixture.png'
    ?new Response(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5X8AAAAASUVORK5CYII=','base64'),{headers:{'content-type':'image/png'}})
    :new Response(new URL(req.url).pathname.startsWith('/messages/t/')?chat:inbox,{headers:{'content-type':'text/html'}}));
  session.webRequest.onBeforeRequest({urls:['http://*/*']},(_details,cb)=>cb({cancel:true}));
  const first=await browsers.scanInbox('fb');
  const second=await browsers.scanInbox('fb',true);
  const frontier=browsers.inboxOffsets.get('fb');
  const third=await browsers.scanInbox('fb',true);
  assert.ok(second.threads.length>first.threads.length,'inner viewport never fetched another inbox page');
  assert.ok(third.threads.length>second.threads.length,'second load-more repeated the first batch');
  assert.ok(browsers.inboxOffsets.get('fb')>frontier,'inbox cursor did not advance');
  let updates=0;
  const service=new MessengerService(vault,host,{session(){},contacts(){},incoming(){throw new Error('history triggered an incoming popup')},conversation(){updates++}});
  service.browsers=browsers;
  service.session.phase='signedIn';
  let calls=0;
  const original=browsers.readHistory.bind(browsers);
  browsers.readHistory=(...args)=>{calls++;return original(...args)};
  const [a,b]=await Promise.all([service.loadHistory(c.id),service.loadHistory(c.id)]);
  assert.equal(a.ok,true,JSON.stringify(a));assert.deepEqual(a,b);assert.equal(calls,1);
  assert.ok(a.added>=100,`delayed history stopped early: ${JSON.stringify(a)}`);
  assert.equal(browsers.historyWindows.size,0,'finished history left a hidden window running');
  assert.equal(updates,1);
  assert.equal(new Set(c.messages.map(m=>m.id)).size,c.messages.length);
  assert.equal(c.messages.at(-1).id,'msg-300');
  assert.ok(c.messages.filter(m=>m.id!=='msg-300').every(m=>m.baseline));
  // A normal poll must retain older pages beyond the former 500-message cap.
  c.messages.unshift(...Array.from({length:600},(_,i)=>({...c.messages[0],id:'saved-'+i})));
  await service.readOnce(c.id,'live');
  assert.ok(c.messages.length>500,'live polling discarded loaded history');
  const savedPhoto=c.messages.find(m=>m.id==='msg-300');
  assert.equal(savedPhoto.attachments?.length,1);
  savedPhoto.aliasIds=['msg-300-v2'];
  const live=browsers.liveViews.get(c.id).webContents;
  await live.executeJavaScript(`document.querySelector('[data-message-id="msg-300"]').setAttribute('data-message-id','msg-300-v2')`);
  const photo=await browsers.readAttachment(c,savedPhoto.id,savedPhoto.attachments[0].id);
  assert.equal(photo.kind,'image');assert.equal(photo.mimeType,'image/png');
  let release;
  service.reads.set(c.id,new Promise(resolve=>{release=resolve}));
  const cancelled=service.loadHistory(c.id);
  service.signInRun++;
  release(true);
  assert.equal((await cancelled).ok,false,'a history job survived a session change');
  assert.equal(calls,1,'cancelled history created another browser task');
  await browsers.signOut('fb');browsers.shutdown();host.destroy();clearTimeout(timer);
  console.log('PAGINATION_INTEGRATION_OK: inner inbox viewport, advancing cursor, IntersectionObserver history, window cleanup, retained backfill, media alias, session cancellation');
  app.exit(0);
}).catch(error=>{console.error(error.stack);clearTimeout(timer);app.exit(1)});
