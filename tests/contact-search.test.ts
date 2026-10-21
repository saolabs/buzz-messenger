import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { contactSearchScript, foldContactName } from '../src/core/contact-search.ts';
import { messengerScript } from '../src/core/messenger.ts';
const fixture = (url='https://www.facebook.com/messages/') => {
  const dom=new JSDOM(`<input role="combobox" aria-label="Tìm kiếm trên Facebook" value="Cai" aria-controls="global"><ul role="listbox" id="global"><li role="option" id="999" aria-label="Wrong global result"></li></ul><div role="grid" aria-label="Chats"><a href="/messages/t/888/"><span dir="auto">Wrong inbox result</span></a></div><input role="combobox" aria-label="Tìm kiếm trên Messenger" value="Cai" aria-controls="results"><ul role="listbox" id="results"><li role="option" id="101" aria-label="Lê Ngọc Cai"><a href="/messages/"><img src="https://static.xx.fbcdn.net/avatar.png"><span dir="auto">Lê Ngọc Cai</span></a></li><li role="option" id="102" aria-label="Lê Ngọc Cai"><a href="/messages/"><img src="https://example.com/avatar.png"></a></li><li role="option" id="101" aria-label="Lê Ngọc Cai"></li><li role="option" id="0" aria-label="Tìm kiếm tin nhắn cho Cai"></li></ul>`,{url,runScripts:'outside-only'});
  Object.defineProperty(dom.window.Element.prototype,'getClientRects',{value:()=>[{}]});
  const run=(action:Parameters<typeof contactSearchScript>[0],query='Cai',hit?:Parameters<typeof contactSearchScript>[2])=>JSON.parse(JSON.stringify(vm.runInContext(contactSearchScript(action,query,hit),dom.getInternalVMContext())));
  return {dom,run};
};
test('name matching is case/accent insensitive, including Vietnamese Đ and NFD',()=>{
 assert.equal(foldContactName('LÊ NGỌC ĐOÃN'.normalize('NFD')),'le ngoc doan');
 assert.equal(foldContactName('con cái nhà').includes(foldContactName('Cai')),true);
});
test('search reads only its owned listbox, keeps equal names with different identities, deduplicates IDs',()=>{
 const {dom,run}=fixture();try{const result=run('read');assert.equal(result.ready,true);assert.deepEqual(result.hits.map((h:any)=>h.providerId),['101','102']);assert.equal(result.hits[0].avatar,'https://static.xx.fbcdn.net/avatar.png');assert.equal(result.hits[1].avatar,undefined);assert.deepEqual(run('read','Trang'),{ready:false,hits:[]});}finally{dom.window.close()}
});
test('missing or hidden result list is pending, never falls back to the inbox',()=>{
 const {dom,run}=fixture();try{dom.window.document.querySelector('#results')!.setAttribute('aria-hidden','true');assert.deepEqual(run('read'),{ready:false,hits:[]});}finally{dom.window.close()}
});
test('selection revalidates identity, name and destination before opening',()=>{
 const {dom,run}=fixture();try{assert.throws(()=>run('select','Cai',{providerId:'102',name:'Different name'}),/thay đổi/);dom.window.document.querySelector('#results [id="102"] a')!.setAttribute('href','https://example.com/messages/');assert.throws(()=>run('select','Cai',{providerId:'102',name:'Lê Ngọc Cai'}),/không hợp lệ/);}finally{dom.window.close()}
});
test('search refuses another origin',()=>{const {dom,run}=fixture('https://example.com/messages/');try{assert.throws(()=>run('read'),/không hợp lệ/)}finally{dom.window.close()}});
test('status guard waits through an unhydrated inbox and still detects login/PIN prompts',()=>{
 const {dom}=fixture();try{dom.window.document.body.replaceChildren();const status=()=>vm.runInContext(messengerScript('status'),dom.getInternalVMContext());assert.equal(status().blocked,false);const password=dom.window.document.createElement('input');password.type='password';dom.window.document.body.append(password);assert.equal(status().blocked,true);assert.equal(status().recoveryRequired,true);}finally{dom.window.close()}
});
