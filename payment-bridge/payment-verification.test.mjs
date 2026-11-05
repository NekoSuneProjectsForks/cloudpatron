import test from 'node:test';
import assert from 'node:assert/strict';
import {heleketSignature,verifyHeleket,normalizedMoney,transition} from './heleket-webhook.mjs';
import {tokenHash,authCreator,entitlement,creatorEntitlements} from './creator-api.mjs';

const order={orderId:'cp_123',amount:'15.00',currency:'USD',providerReference:'uuid-123',status:'pending',creatorId:'creator1',patronId:'patron1',tierId:'vip'};
function event(status='paid') {return {type:'payment',uuid:'uuid-123',order_id:'cp_123',amount:'15.00000000',currency:'USD',is_final:true,status};}
test('Heleket signature verifies signed payload and rejects tampering',()=>{
 const payload=event();
 payload.sign=heleketSignature(payload,'secret');
 assert.equal(verifyHeleket(payload,'secret'),true);
 assert.equal(verifyHeleket({...payload,amount:'1'},'secret'),false);
 assert.equal(verifyHeleket(payload,'wrong'),false);
 assert.equal(verifyHeleket({...payload,sign:'abc'},'secret'),false);
});
test('normalised amount comparison is exact to eight decimals',()=>{
 assert.equal(normalizedMoney('15'),normalizedMoney('15.00000000'));
 assert.equal(normalizedMoney('15.00'),normalizedMoney('15.00000000'));
 assert.notEqual(normalizedMoney('15.01'),normalizedMoney('15.00'));
});
test('paid requires final settlement and matching payment identity',()=>{
 assert.deepEqual(transition(order,event()).status,'paid');
 assert.equal(transition(order,{...event(),is_final:false}).ok,false);
 assert.equal(transition(order,{...event(),order_id:'other'}).ok,false);
 assert.equal(transition(order,{...event(),uuid:'wrong'}).ok,false);
 assert.equal(transition(order,{...event(),amount:'16.00'}).ok,false);
 assert.equal(transition(order,{...event(),currency:'EUR'}).ok,false);
});
test('failed and cancelled payments never grant access',()=>{
 for (const status of ['fail','system_fail','cancel','wrong_amount']) {
   const next=transition(order,event(status));
   assert.equal(next.ok,true);
   assert.notEqual(next.status,'paid');
 }
});
test('previously settled invoice cannot be downgraded by stale cancellation',()=>{
 assert.deepEqual(transition({...order,status:'paid'},event('cancel')).status,'paid');
 assert.equal(transition({...order,status:'paid'},event('refund_process')).status,'refund_pending');
 assert.equal(transition({...order,status:'refund_pending'},event('refund_paid')).status,'refunded');
 assert.equal(transition({...order,status:'refunded'},event('paid')).status,'refunded');
});
test('scoped creator tokens are matched by SHA256 and constant-time comparison',()=>{
 const config=[{keyHash:tokenHash('projectsecret'),creatorId:'creator1',scopes:['entitlements:read']}];
 assert.equal(authCreator('Bearer projectsecret',config)?.creatorId,'creator1');
 assert.equal(authCreator('Bearer wrong',config),null);
});
test('creator never sees another creators paid supporter',()=>{
 const now=Date.now();
 const invoices={
  a:{...order,status:'paid',paidAt:new Date(now-1000).toISOString()},
  b:{...order,creatorId:'creator2',status:'paid',paidAt:new Date(now-1000).toISOString()}
 };
 assert.equal(creatorEntitlements(invoices,'creator1','patron1').active,true);
 assert.equal(creatorEntitlements(invoices,'creator3','patron1').active,false);
 assert.equal(creatorEntitlements(invoices,'creator1','other').active,false);
 assert.equal(entitlement({...order,status:'refunded',paidAt:new Date(now).toISOString()}),null);
 assert.equal(entitlement({...order,status:'paid',paidAt:new Date(now-32*86400000).toISOString()}),null);
});
