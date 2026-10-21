import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { messengerMemberScript } from '../src/core/group-member.ts';

function fixture() {
 const state={user:'42',member:'1001',group:true,rows:['42','1001'],drift:false,reads:[] as string[]};
 const db = { table: (table: string) => ({
   get: async (key: any) => {
     state.reads.push(table); if (state.drift) state.user = '99';
     if (table === 'threads') return { threadKey: key, threadType: state.group ? 'group' : 'direct' };
     if (table === 'participants') return { threadKey: key[0], contactId: state.member, nickname: 'sealed:Nick' };
     if (table === 'contacts') return { name: 'sealed:Person' };
     throw new Error('Unexpected table');
   },
   entries: (_: unknown, _dir: string, bounds: any) => {
     assert.deepEqual(JSON.parse(JSON.stringify(bounds)), bounds.gte.length===2 ? {gte:['123','1001'],lte:['123','1001']} : { gte: ['123'], lte: ['123'] });
     state.reads.push(table); let i = 0; const rows = bounds.gte.length===2 ? [state.member] : state.rows;
     return { next: async () => {
       if (state.drift) state.user = '99';
       return i < rows.length ? { done: false, value: [[], { threadKey: '123', contactId: rows[i++], nickname:'sealed:Nick' }] } : { done: true };
     } };
   },
 }) };

 const ctx=vm.createContext({location:{protocol:'https:',hostname:'www.facebook.com',port:'',pathname:'/messages/e2ee/t/123/'},require:(name:string)=>({CurrentUser:{getID:()=>state.user},I64:{of_string:String,to_string:String},LSDatabaseSingleton:{getLSDatabaseSingletonPromiseOrValue:async()=>db},LSMessagingThreadTypeUtil:{isGroup:(type:string)=>type==='group'},MAWVault:{unvault:(s:string)=>s.startsWith('sealed:')?s.slice(7):s}} as any)[name],Date,Set});
 const run=(patch:object={})=>vm.runInContext(messengerMemberScript({mode:'member',threadId:'123',memberId:'1001',userId:'42',deadline:Date.now()+3000,...patch}),ctx);
 return {state,run,ctx};
}
test('member opening verifies a scoped group participant, then a direct thread with exactly self and that user',async()=>{
 const {state,run}=fixture();const member=await run();assert.equal(member.status,'ready');assert.equal(member.member.name,'Person');assert.equal(member.member.nickname,'Nick');assert.deepEqual(state.reads,['threads','participants','contacts']);
 state.group=false;assert.equal((await run({mode:'direct'})).status,'ready');assert.ok(!state.reads.includes('messages'));
 state.rows=['42'];assert.equal((await run({mode:'direct',memberId:'42'})).status,'ready');
});
test('member opening refuses swapped recipients, groups posing as direct chats, extra participants, wrong sessions, origins and deadlines',async()=>{
 for(const mode of ['member','group','extra','missing','user','origin','thread','deadline','drift']){const {state,run,ctx}=fixture();let patch:any={};if(mode==='member')state.member='1002';if(['group','extra','missing'].includes(mode))patch.mode='direct';if(mode==='extra'){state.group=false;state.rows.push('1002')}if(mode==='missing'){state.group=false;state.rows=['42']}if(mode==='user')state.user='99';if(mode==='origin')vm.runInContext("location.hostname='example.com'",ctx);if(mode==='thread')vm.runInContext("location.pathname='/messages/t/999/'",ctx);if(mode==='deadline')patch.deadline=0;if(mode==='drift')state.drift=true;assert.equal((await run(patch)).status,'unavailable',mode)}
});
