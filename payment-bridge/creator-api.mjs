import {createHash,timingSafeEqual} from 'node:crypto';
export const tokenHash=token=>createHash('sha256').update(token).digest('hex');
export function creatorConfig() {
  try {
    const entries=JSON.parse(process.env.CREATOR_API_KEYS_JSON||'[]');
    return Array.isArray(entries)?entries.filter(e=>e && typeof e.keyHash==='string' && /^[a-f0-9]{64}$/i.test(e.keyHash) && typeof e.creatorId==='string' && Array.isArray(e.scopes)):[];
  }catch{return [];}
}
export function authCreator(authHeader,entries=creatorConfig()) {
  if(!authHeader?.startsWith('Bearer ')) return null;
  const supplied=Buffer.from(tokenHash(authHeader.slice(7)),'hex');
  return entries.find(e=>timingSafeEqual(supplied,Buffer.from(e.keyHash,'hex')))||null;
}
export function entitlement(invoice,now=Date.now()) {
  // One paid invoice grants 30 days of access; future work should derive billing periods from Go subscriptions.
  const paidAt=Date.parse(invoice.paidAt||'');
  if(invoice.productId || invoice.status!=='paid'||!Number.isFinite(paidAt)) return null;
  const expiresAt=paidAt+30*24*60*60*1000;
  if(now>=expiresAt) return null;
  return {tierId:invoice.tierId||null,creatorId:invoice.creatorId||null,active:true,expiresAt:new Date(expiresAt).toISOString()};
}
export function creatorEntitlements(invoices,creatorId,patronId) {
  const grants=Object.values(invoices).filter(i=>i.creatorId===creatorId && i.patronId===patronId).map(i=>entitlement(i)).filter(Boolean);
  const expiresAt=grants.map(g=>g.expiresAt).sort().at(-1)||null;
  return {patronId,creatorId,active:grants.length>0,tiers:[...new Set(grants.map(x=>x.tierId).filter(Boolean))],expiresAt};
}
