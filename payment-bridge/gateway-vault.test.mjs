import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GatewayVault,validateGateway,safeGateway,definitions} from './gateway-vault.mjs';

test('gateway definitions include configured provider fields',()=>{
 const all=definitions();assert.ok(all.some(p=>p.id==='heleket'));
 assert.ok(all.some(p=>p.id==='stripe'&&p.fields.some(f=>f.name==='secretKey'&&f.secret)));
});
test('invalid provider names and arbitrary fields denied',()=>{
 assert.throws(()=>validateGateway('fake',{apiKey:'x'}));
 assert.throws(()=>validateGateway('heleket',{arbitrary:'x'}));
 assert.throws(()=>validateGateway('heleket',{paymentKey:5}));
 assert.throws(()=>validateGateway('heleket',{callbackUrl:'http://insecure.example/webhooks/heleket'}));
 assert.equal(validateGateway('heleket',{callbackUrl:'https://patron.example.com/webhooks/heleket'}).callbackUrl,'https://patron.example.com/webhooks/heleket');
 assert.throws(()=>validateGateway('hive',{rpcUrl:'http://insecure.example'}));
 assert.equal(validateGateway('hive',{receivingAccount:'creator-account'}).receivingAccount,'creator-account');
});
test('browser response never reveals secret values',()=>{
 const config=safeGateway('heleket',{merchantId:'merchant123',paymentKey:'topsecret'});
 assert.equal(JSON.stringify(config).includes('topsecret'),false);
 assert.equal(config.fields.find(f=>f.name==='merchantId').value,'merchant123');
 assert.equal(config.fields.find(f=>f.name==='paymentKey').configured,true);
});
test('encrypted credentials survive restart, rotate and remove safely',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'gateway-vault-'));const path=join(dir,'vault.json');
 try{
  const first=new GatewayVault(path);await first.init();
  const saved=await first.update('heleket',{merchantId:'merchant1',paymentKey:'secret123'});
  assert.equal(saved.fields.find(f=>f.name==='paymentKey').value,undefined);
  const raw=await readFile(path,'utf8');assert.equal(raw.includes('secret123'),false);
  const second=new GatewayVault(path);await second.init();
  assert.equal(second.get('heleket').paymentKey,'secret123');
  await second.update('heleket',{merchantId:'merchant2'});
  assert.equal(second.get('heleket').paymentKey,'secret123');
  await second.update('heleket',{},['paymentKey']);
  assert.equal(second.get('heleket').paymentKey,undefined);
  const third=new GatewayVault(path);await third.init();
  assert.equal(third.get('heleket').merchantId,'merchant2');
 } finally {await rm(dir,{recursive:true,force:true});}
});
test('tampering causes vault load failure, not silent data loss',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'gateway-tamper-'));const path=join(dir,'vault.json');
 try{
  const first=new GatewayVault(path);await first.init();await first.update('stripe',{secretKey:'secret'});
  const original=JSON.parse(await readFile(path,'utf8'));original.tag='AAAAAAAAAAAAAAAAAAAAAA==';
  await (await import('node:fs/promises')).writeFile(path,JSON.stringify(original));
  const second=new GatewayVault(path);await assert.rejects(()=>second.init());
 }finally{await rm(dir,{recursive:true,force:true});}
});
