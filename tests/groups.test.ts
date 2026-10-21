import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { messengerGroupScript, enrichGroupRead, type GroupSnapshot } from '../src/core/groups.ts';
import { messengerScript, type MessengerRead } from '../src/core/messenger.ts';
import { ingest } from '../src/core/conversation.ts';
import type { Conversation } from '../src/core/types.ts';

function fixture(count=3) {
 const stamp=new Date().setHours(10,19,0,0),state={user:'42',badMember:false,flip:false,calls:[] as string[],reads:0};
 const rows=Array.from({length:count},(_,i)=>({threadKey:'123',contactId:String(1000+i),nickname:`sealed:Nick ${i}`,isAdmin:i===0}));
 const messages=[{threadKey:'123',messageId:'mid-a',senderId:'1000',text:'sealed:Hello',timestampMs:String(stamp)},{threadKey:'123',messageId:'mid-b',senderId:'1001',text:'sealed:Hello',timestampMs:String(stamp)}];
 const I={of_string:String,of_float:(n:number)=>String(Math.floor(n)),to_string:String};
 const db={table:(name:string)=>({
   get:async (key:string)=>{state.reads++;if(name==='threads')return {threadKey:key,threadType:'group',memberCount:String(count)};if(name==='contacts')return {name:`sealed:Person ${Number(key)-1000}`,profilePictureUrl:'https://static.xx.fbcdn.net/a.png'};throw new Error('unexpected table')},
   entries:(_unused:unknown,dir:string,bounds:any)=>{
    assert.ok(bounds?.lte?.[0]==='123','unbounded or wrong-thread iterator');assert.ok((bounds.gte??bounds.gt)?.[0]==='123');state.calls.push(name);
    let values:Array<Record<string,any>>=name==='participants'?rows:messages;
    if(name==='participants'&&bounds.gt)values=values.filter((r:any)=>BigInt(r.contactId)>BigInt(bounds.gt[1]));
    if(name==='participants'&&state.badMember)values=[{...rows[0],threadKey:'999'}];
    const ordered=dir==='desc'?[...values].reverse():values;let i=0;
    return {next:async()=>{if(state.flip)state.user='99';const row=ordered[i++];return row?{done:false,value:[[],row]}:{done:true}}};
   },
 })};
 const ctx=vm.createContext({location:{protocol:'https:',hostname:'www.facebook.com',port:'',pathname:'/messages/t/123/'},require:(name:string)=>({CurrentUser:{getID:()=>state.user},I64:I,MAWVault:{unvault:(text:string)=>text.startsWith('sealed:')?text.slice(7):text},LSDatabaseSingleton:{getLSDatabaseSingletonPromiseOrValue:async()=>db},LSMessagingThreadTypeUtil:{isGroup:()=>true}} as any)[name],URL,Date,Map,Set,BigInt});
 const run=(patch:object={})=>vm.runInContext(messengerGroupScript({threadId:'123',userId:'42',deadline:Date.now()+5000,...patch}),ctx) as Promise<GroupSnapshot>;
 return {state,run,ctx,stamp};
}
test('bounded group read joins only participants and their message authors, keeps nicknames and roles',async()=>{
 const {state,run}=fixture();const r=await run();assert.equal(r.status,'ready');if(r.status!=='ready')return;assert.equal(r.kind,'group');assert.equal(r.group?.members.length,3);assert.equal(r.group?.memberCount,3);assert.equal(r.group?.complete,true);assert.equal(r.group?.members[0].nickname,'Nick 0');assert.equal(r.group?.members[0].role,'admin');assert.equal(r.messages.length,2);assert.deepEqual(state.calls,['participants','messages']);
});
test('large groups use a stable cursor, detect partial cache, and never fetch more than one bounded page',async()=>{
 const {run}=fixture(105);const first=await run({limit:0});assert.equal(first.status,'ready');if(first.status!=='ready')return;assert.equal(first.group?.members.length,100);assert.equal(first.group?.complete,false);assert.equal(first.group?.nextCursor,'1099');const next=await run({cursor:first.group?.nextCursor,limit:0});if(next.status!=='ready')throw new Error('missing page');assert.equal(next.group?.members.length,5);assert.equal(next.group?.members[0].id,'1100');assert.equal(next.group?.complete,true);assert.equal(next.group?.nextCursor,undefined);
});
test('group reads fail closed on wrong account, origin, thread, deadline, and drift inside a query',async()=>{
 for(const mode of ['account','origin','thread','expired','drift','scope']){const {state,run,ctx}=fixture();if(mode==='account')state.user='99';if(mode==='origin')vm.runInContext("location.hostname='example.com'",ctx);if(mode==='thread')vm.runInContext("location.pathname='/messages/t/999/'",ctx);if(mode==='drift')state.flip=true;if(mode==='scope')state.badMember=true;const r=await run(mode==='expired'?{deadline:0}:{});assert.equal(r.status,'unavailable',mode);if(['account','origin','thread','expired'].includes(mode))assert.equal(state.reads,0,mode)}
});
function native(group:boolean) {
 const dom=new JSDOM(`<div role="grid" aria-label="Chats"><a aria-current="page" href="/messages/t/123/"><span dir="auto">Fixture group</span></a></div>${['Nick 0','Nick 1'].map(s=>`<div role="article"><div role="button" aria-label="Message sent by ${s} at 10:19: Hello"></div></div>`).join('')}<div role="textbox" contenteditable="true" aria-label="Message Fixture group"></div>`,{url:'https://www.facebook.com/messages/t/123/',runScripts:'outside-only'});
 Object.defineProperty(dom.window.Element.prototype,'getClientRects',{value:()=>[{}]});
 try{return JSON.parse(JSON.stringify(vm.runInContext(messengerScript('read',{group}),dom.getInternalVMContext()))) as MessengerRead}finally{dom.window.close()}
}
test('two group authors with the same text and minute retain separate identities through ingest',async()=>{
 const {run}=fixture(),snapshot=await run(),read=native(true),legacy=native(false);
 assert.equal(new Set(read.messages.map(m=>m.id)).size,2);assert.equal(new Set(legacy.messages.map(m=>m.id)).size,1);
 const enriched=enrichGroupRead(read,snapshot);assert.equal(enriched.messages[0].sender?.id,'1000');assert.equal(enriched.messages[1].sender?.id,'1001');assert.ok(enriched.messages.every(m=>!m.aliasIds?.includes(m.legacyFingerprintId!)),'shared legacy ID must not be borrowed by either author');
 const c:Conversation={id:'test',accountId:'fb',platformId:'123',url:'https://www.facebook.com/messages/t/123/',name:'Fixture group',kind:'group',initialized:false,messages:[]};
 ingest(c,enriched.messages.map(m=>({...m,observedAt:1})));ingest(c,enriched.messages.map(m=>({...m,observedAt:2})));assert.equal(c.messages.length,2);assert.equal(new Set(c.messages.map(m=>m.sender?.id)).size,2);
});
test('unknown legacy authors are backed up and never guessed or folded across two real authors',async()=>{
 const read=native(true),legacy=native(false),snapshot=await fixture().run();
 const c:Conversation={id:'test',accountId:'fb',platformId:'123',url:'https://www.facebook.com/messages/t/123/',name:'Fixture group',kind:'group',initialized:true,messages:[{...legacy.messages[0],sender:undefined,observedAt:0,baseline:false}]};
 ingest(c,enrichGroupRead(read,snapshot).messages.map(m=>({...m,observedAt:1})));assert.equal(c.messages.length,3);assert.equal(c.groupRepairBackup?.messages.length,1);assert.equal(c.groupRepairBackup?.messages[0].sender,undefined);assert.ok(c.messages.slice(1).every(m=>m.baseline));
});
test('a proved unique legacy row keeps its local ID and media aliases when enriched',async()=>{
 const read=native(true);read.messages=read.messages.slice(0,1);const r=await fixture().run();if(r.status!=='ready')throw new Error('no snapshot');r.messages=r.messages.filter(m=>m.senderId==='1000');
 const raw=enrichGroupRead(read,r).messages[0],oldId=read.messages[0].legacyFingerprintId!;
 assert.ok(raw.aliasIds?.includes(oldId));const c:Conversation={id:'test',accountId:'fb',platformId:'123',url:'https://www.facebook.com/messages/t/123/',name:'Fixture group',kind:'group',initialized:true,messages:[{...read.messages[0],id:oldId,sender:undefined,observedAt:0,baseline:true}]};
 ingest(c,[{...raw,observedAt:1}]);assert.equal(c.messages.length,1);assert.equal(c.messages[0].id,oldId);assert.equal(c.messages[0].sender?.id,'1000');
});
test('an incomplete API window cannot assign identities by text, and a single API row cannot be borrowed twice',async()=>{
 const read=native(true),r=await fixture().run();if(r.status!=='ready')throw new Error('no snapshot');r.messagesComplete=false;assert.ok(enrichGroupRead(read,r).messages.every(m=>!m.platformMessageId));
 r.messagesComplete=true;r.messages=r.messages.filter(m=>m.senderId==='1000');read.messages=[read.messages[0],{...read.messages[0],id:read.messages[0].id+'#2'}];assert.ok(enrichGroupRead(read,r).messages.every(m=>!m.platformMessageId));
});
test('DOM fallback keeps verified sender IDs and canonical local IDs after a successful group upgrade',async()=>{
 const read=native(true),r=await fixture().run();if(r.status!=='ready')throw new Error('no snapshot');const c:Conversation={id:'test',accountId:'fb',platformId:'123',url:'https://www.facebook.com/messages/t/123/',name:'Fixture group',kind:'group',initialized:false,messages:[]};
 ingest(c,enrichGroupRead(read,r).messages.map(m=>({...m,observedAt:1})));const ids=c.messages.map(m=>m.id);ingest(c,read.messages.map(m=>({...m,observedAt:2})));assert.deepEqual(c.messages.map(m=>m.id),ids);assert.deepEqual(c.messages.map(m=>m.sender?.id),['1000','1001']);
});
test('a proved legacy alias coalesces an earlier unverified group copy while retaining the original row and backup',async()=>{
 const read=native(true);read.messages=read.messages.slice(0,1);const r=await fixture().run();if(r.status!=='ready')throw new Error('no snapshot');r.messages=r.messages.filter(m=>m.senderId==='1000');const raw=enrichGroupRead(read,r).messages[0],oldId=raw.legacyFingerprintId!;
 const c:Conversation={id:'test',accountId:'fb',platformId:'123',url:'https://www.facebook.com/messages/t/123/',name:'Fixture group',kind:'group',initialized:true,messages:[{...read.messages[0],id:oldId,sender:undefined,observedAt:0,baseline:true},{...read.messages[0],observedAt:1,baseline:true}]};
 ingest(c,[{...raw,observedAt:2}]);assert.equal(c.messages.length,1);assert.equal(c.messages[0].id,oldId);assert.equal(c.messages[0].sender?.id,'1000');assert.equal(c.groupRepairBackup?.messages.length,2);assert.equal(c.messageRepairBackup?.messages.length,2);
});
test('a full unchanged media span keeps its legacy ID between two verified server anchors',()=>{
 const base={direction:'incoming' as const,timestamp:1,observedAt:1,baseline:true,identity:'fingerprint' as const,precision:'minute' as const};
 const c:Conversation={id:'t',accountId:'fb',platformId:'123',url:'https://www.facebook.com/messages/t/123/',name:'Group',kind:'group',initialized:true,messages:[{...base,id:'left',platformMessageId:'api-left',text:'Before'},{...base,id:'old-photo',text:'[Hình ảnh]',attachments:[{id:'photo',kind:'image'}]},{...base,id:'right',platformMessageId:'api-right',text:'After'}]};
 ingest(c,[{...c.messages[0],sender:{id:'1',name:'An'}},{...base,id:'group-photo',legacyFingerprintId:'old-photo',text:'[Hình ảnh]',sender:{name:'Bình'},attachments:[{id:'photo-new',kind:'image'}]},{...c.messages[2],sender:{id:'1',name:'An'}}]);
 assert.equal(c.messages.length,3);assert.equal(c.messages[1].id,'old-photo');assert.equal(c.messages[1].sender?.name,'Bình');assert.ok(c.messages[1].aliasIds?.includes('group-photo'));assert.equal(c.groupRepairBackup?.messages.length,3);
});
test('a dated sender-qualified stale copy folds only with a unique API and legacy proof',async()=>{
 const read=native(true);read.messages=read.messages.slice(0,1);const r=await fixture().run();if(r.status!=='ready')throw new Error('no snapshot');r.messages=r.messages.filter(m=>m.senderId==='1000');const raw=enrichGroupRead(read,r).messages[0];
 const c:Conversation={id:'t',accountId:'fb',platformId:'123',url:'https://www.facebook.com/messages/t/123/',name:'Group',kind:'group',initialized:true,messages:[{...raw,id:'canonical',observedAt:1,baseline:true},{...read.messages[0],id:'stale-date-label',observedAt:2,baseline:true}]};
 ingest(c,[{...raw,observedAt:3}]);assert.equal(c.messages.length,1);assert.equal(c.messages[0].id,'canonical');assert.equal(c.messageRepairBackup?.messages.length,2);
});
test('stale group copies also fold when the verified legacy ID is already canonical and absent from aliases',async()=>{
 const read=native(true);read.messages=read.messages.slice(0,1);const r=await fixture().run();if(r.status!=='ready')throw new Error('no snapshot');r.messages=r.messages.filter(m=>m.senderId==='1000');const raw=enrichGroupRead(read,r).messages[0],legacy=raw.legacyFingerprintId!;
 const c:Conversation={id:'t',accountId:'fb',platformId:'123',url:'https://www.facebook.com/messages/t/123/',name:'Group',kind:'group',initialized:true,messages:[{...raw,id:legacy,aliasIds:[raw.id],observedAt:1,baseline:true},{...read.messages[0],id:'stale-date-label',observedAt:2,baseline:true}]};
 ingest(c,[{...raw,observedAt:3}]);assert.equal(c.messages.length,1);assert.equal(c.messages[0].id,legacy);
});

test('cached unknown group rows merge with unique dated sender fingerprints even without LS coverage, preserving media and a full backup',()=>{
 const stamp=60_000,base={direction:'incoming' as const,timestamp:stamp,observedAt:1,baseline:true,identity:'fingerprint' as const,precision:'minute' as const};
 const old={...base,id:'old',text:'Earlier unique text'},oldPhoto={...base,id:'photo',text:'[Image]',attachments:[{id:'original-photo',kind:'image' as const}]};
 const copies=[{...old,id:'named',legacyFingerprintId:'old',sender:{name:'Nick'}},{...oldPhoto,id:'named-photo',legacyFingerprintId:'photo',sender:{name:'Nick'}}];
 const c:Conversation={id:'t',accountId:'fb',platformId:'123',name:'Group',url:'',kind:'group',initialized:true,messages:[old,...copies.slice(0,1),oldPhoto,...copies.slice(1)]};
 ingest(c,[]);assert.deepEqual(c.messages.map(m=>m.id),['old','photo']);assert.equal(c.messages[0].sender?.name,'Nick');assert.equal(c.messages[1].attachments?.[0].id,'original-photo');assert.equal(c.groupIdentityBackup?.messages.length,4);
 ingest(c,copies);assert.equal(c.messages.length,2);assert.ok(c.messages[0].aliasIds?.includes('named'));
});
test('verified member aliases merge profile/nickname variants but keep repeated occurrences and distinct platform IDs',()=>{
 const base={direction:'incoming' as const,timestamp:60_000,observedAt:1,baseline:true,identity:'fingerprint' as const,precision:'minute' as const,text:'A repeated phrase'};
 const group={members:[{id:'10',name:'Profile',nickname:'Nick',isSelf:false,role:'member' as const}],complete:true,updatedAt:1};
 const c:Conversation={id:'t',accountId:'fb',platformId:'123',name:'Group',url:'',kind:'group',group,initialized:true,messages:[{...base,id:'old'},{...base,id:'nickname',legacyFingerprintId:'old',sender:{name:'Nick'}},{...base,id:'profile',legacyFingerprintId:'old',sender:{name:'Profile'}}]};
 ingest(c,[{...base,id:'stable-member',legacyFingerprintId:'old',sender:{id:'10',name:'Profile',nickname:'Nick'}}]);assert.equal(c.messages.length,1);assert.equal(c.messages[0].id,'old');assert.equal(c.messages[0].sender?.id,'10');
 const repeated={...base,id:'stable-member#2',legacyFingerprintId:'old',sender:{id:'10',name:'Profile',nickname:'Nick'}};
 ingest(c,[{...repeated,id:'stable-member'},repeated]);assert.equal(c.messages.length,2);
 const separate:Conversation={...c,messages:[{...base,id:'first',platformMessageId:'api-one',legacyFingerprintId:'shared',sender:{id:'10',name:'Profile'}},{...base,id:'second',platformMessageId:'api-two',legacyFingerprintId:'shared',sender:{id:'10',name:'Profile'}}]};
 ingest(separate,[{...separate.messages[0],id:'new'}]);assert.equal(separate.messages.length,2);
});
test('legacy fingerprints never collapse messages across minutes or two qualified authors',()=>{
 const base={direction:'incoming' as const,timestamp:60_000,observedAt:1,baseline:true,identity:'fingerprint' as const,precision:'minute' as const,text:'ok'};
 const c:Conversation={id:'t',accountId:'fb',platformId:'123',name:'Group',url:'',kind:'group',initialized:true,messages:[{...base,id:'old'},{...base,id:'a',legacyFingerprintId:'old',sender:{name:'An'}},{...base,id:'b',legacyFingerprintId:'old',sender:{name:'Binh'}}]};
 ingest(c,[]);assert.equal(c.messages.length,3);ingest(c,[{...base,id:'different-date',timestamp:120_000,legacyFingerprintId:'old',sender:{name:'An'}}]);assert.equal(c.messages.length,4);
});
test('DOM group identities stay stable across a profile/nickname change and retain repeated rows',()=>{
 const members=[{id:'10',name:'Profile',nickname:'Nick',isSelf:false}];
 const read=(author:string)=>{const dom=new JSDOM(`<div role="article"><div role="button" aria-label="Message sent by ${author} at 10:19: Hello"></div></div>`,{url:'https://www.facebook.com/messages/t/123/',runScripts:'outside-only'});Object.defineProperty(dom.window.Element.prototype,'getClientRects',{value:()=>[{}]});try{return JSON.parse(JSON.stringify(vm.runInContext(messengerScript('read',{group:true,groupMembers:members}),dom.getInternalVMContext()))) as MessengerRead}finally{dom.window.close()}};
 const a=read('Nick').messages[0],b=read('Profile').messages[0];assert.equal(a.id,b.id);assert.equal(a.sender?.id,'10');assert.equal(a.legacyFingerprintId,b.legacyFingerprintId);
});
