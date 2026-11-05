import test from 'node:test';
import assert from 'node:assert/strict';
import {validAmount, authorised} from './server.mjs';
import {PROVIDERS} from './providers.mjs';
test('invoice amount rejects zeros, negatives, exponent notation and excess precision',()=>{
  for(const v of ['0','-1','2e9','0.00','1.123','01.00','foo',42]) assert.equal(validAmount(v),false,String(v));
  for(const v of ['15.00','0.01','1','123456789.99']) assert.equal(validAmount(v),true,v);
});
test('admin bearer token exact match',()=>{
  assert.equal(authorised('Bearer abc','abc'),true);
  assert.equal(authorised('Bearer abC','abc'),false);
  assert.equal(authorised('Bearer abc',''),false);
  assert.equal(authorised(undefined,'abc'),false);
});
test('provider roadmap is not falsely advertised as production',()=>{
  assert.equal(PROVIDERS.find(x=>x.id==='heleket').status,'beta');
  assert.equal(PROVIDERS.find(x=>x.id==='cryptomus').status,'planned');
  assert.equal(PROVIDERS.find(x=>x.id==='hive').status,'planned');
});
