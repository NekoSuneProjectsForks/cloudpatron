import {createHash, timingSafeEqual} from 'node:crypto';

// Heleket documents md5(base64(JSON.stringify(payload WITHOUT sign)) + payment API key).
// PHP json_encode escapes forward slashes; ensure exact compatible string.
export function heleketSignature(payload, key) {
  const unsigned={...payload};
  delete unsigned.sign;
  const json=JSON.stringify(unsigned).replace(/\//g,'\\/');
  return createHash('md5').update(Buffer.from(json,'utf8').toString('base64')+key).digest('hex');
}
export function verifyHeleket(payload,key) {
  if(!key || !payload || typeof payload!=='object' || Array.isArray(payload) || !/^[a-f0-9]{32}$/i.test(payload.sign||'')) return false;
  const a=Buffer.from(payload.sign.toLowerCase(),'hex'), b=Buffer.from(heleketSignature(payload,key),'hex');
  return timingSafeEqual(a,b);
}
export function normalizedMoney(value) {
  if(!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(String(value))) return null;
  const [whole,frac='']=String(value).split('.');
  return (BigInt(whole)*100000000n+BigInt((frac+'00000000').slice(0,8))).toString();
}
const STATUS_MAP={
  process:'pending', check:'pending', confirm_check:'confirming', locked:'pending',
  paid:'paid', paid_over:'paid', fail:'declined', system_fail:'declined',
  wrong_amount:'underpaid', cancel:'cancelled',
  refund_process:'refund_pending', refund_fail:'paid', refund_paid:'refunded'
};
export function transition(invoice,event) {
  const status=STATUS_MAP[event.status];
  if(!status) return {ok:false,reason:'unknown_status'};
  if(event.type!=='payment' || event.order_id!==invoice.orderId) return {ok:false,reason:'order_mismatch'};
  if(String(event.currency).toUpperCase()!==invoice.currency || normalizedMoney(event.amount)!==normalizedMoney(invoice.amount)) return {ok:false,reason:'amount_or_currency_mismatch'};
  if(invoice.providerReference && event.uuid!==invoice.providerReference) return {ok:false,reason:'invoice_uuid_mismatch'};
  // A cancelled or failed webhook cannot un-pay a settled payment; only verified refund can revoke.
  if(['paid','refund_pending','refunded'].includes(invoice.status) && !['paid','refund_pending','refunded'].includes(status)) return {ok:true,status:invoice.status,ignored:true};
  if(invoice.status==='refunded' && status!=='refunded') return {ok:true,status:'refunded',ignored:true};
  // Refund failure returns to paid, but must not manufacture paid status from a pending invoice.
  if(event.status==='refund_fail' && invoice.status!=='refund_pending') return {ok:false,reason:'refund_without_payment'};
  if(status==='paid' && event.is_final!==true) return {ok:false,reason:'payment_not_final'};
  if(status==='refunded' && !['paid','refund_pending','refunded'].includes(invoice.status)) return {ok:false,reason:'refund_without_payment'};
  return {ok:true,status,ignored:invoice.status===status};
}
