import {createHash,randomBytes} from 'node:crypto';
import {creatorEntitlements} from './creator-api.mjs';
import {ownsProduct,validId,validPrice,youtubeEmbed} from './shop.mjs';

export function codeHash(code) {
  return createHash('sha256').update(String(code).trim().toUpperCase()).digest('hex');
}
export function createGiftCode() {
  return randomBytes(9).toString('base64url').replace(/[^A-Za-z0-9]/g,'').toUpperCase().slice(0,12);
}
const safeName=value=>typeof value==='string'&&value.trim().length>0&&value.length<=160;
const expOk=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&Date.parse(value)>Date.now()&&Date.parse(value)<Date.now()+2*365*86400000;
export function validateGift(body) {
  if(!body||!validId(body.creatorId)||!validId(body.tierId)||!Number.isSafeInteger(body.durationDays)||body.durationDays<1||body.durationDays>365||!Number.isSafeInteger(body.maxRedemptions)||body.maxRedemptions<1||body.maxRedemptions>1000||!expOk(body.expiresAt)) throw Error('invalid_gift');
  return {creatorId:body.creatorId,tierId:body.tierId,durationDays:body.durationDays,maxRedemptions:body.maxRedemptions,expiresAt:body.expiresAt,redemptions:[],createdAt:new Date().toISOString(),revoked:false};
}
export function redeemGift(gift,patronId,now=Date.now()) {
  if(!gift||gift.revoked||!validId(patronId)||Date.parse(gift.expiresAt)<=now)return {ok:false,reason:'invalid_or_expired'};
  if(gift.redemptions.some(r=>r.patronId===patronId))return {ok:false,reason:'already_redeemed'};
  if(gift.redemptions.length>=gift.maxRedemptions)return {ok:false,reason:'fully_redeemed'};
  const redeemedAt=new Date(now).toISOString();
  return {ok:true,record:{patronId,redeemedAt,expiresAt:new Date(now+gift.durationDays*86400000).toISOString()}};
}
export function giftEntitlements(gifts,creatorId,patronId,now=Date.now()) {
  return Object.values(gifts||{}).filter(g=>g.creatorId===creatorId&&!g.revoked).flatMap(g=>(g.redemptions||[]).filter(r=>r.patronId===patronId&&Date.parse(r.expiresAt)>now).map(r=>({tierId:g.tierId,expiresAt:r.expiresAt})));
}
export function supporterEntitlements(invoices,gifts,creatorId,patronId,now=Date.now()) {
  const base=creatorEntitlements(invoices,creatorId,patronId);
  const grants=giftEntitlements(gifts,creatorId,patronId,now);
  return {...base,active:base.active||grants.length>0,tiers:[...new Set([...base.tiers,...grants.map(g=>g.tierId)])],expiresAt:[base.expiresAt,...grants.map(g=>g.expiresAt)].filter(Boolean).sort().at(-1)||null};
}
export function validateDiscount(body) {
  if(!body||!validId(body.creatorId)||!(body.productId===null||validId(body.productId))||!Number.isSafeInteger(body.percentOff)||body.percentOff<1||body.percentOff>90||!Number.isSafeInteger(body.maxUses)||body.maxUses<1||body.maxUses>10000||!expOk(body.expiresAt))throw Error('invalid_discount');
  return {creatorId:body.creatorId,productId:body.productId||null,percentOff:body.percentOff,maxUses:body.maxUses,expiresAt:body.expiresAt,revoked:false,createdAt:new Date().toISOString()};
}
export function discountPrice(discount,product,paidCount,now=Date.now()) {
  if(!discount||discount.revoked||discount.creatorId!==product.creatorId||(discount.productId&&discount.productId!==product.id)||Date.parse(discount.expiresAt)<=now||paidCount>=discount.maxUses) return null;
  const [whole,decimal='']=product.price.split('.');
  const cents=BigInt(whole)*100n+BigInt((decimal+'00').slice(0,2));
  const reduced=(cents*BigInt(100-discount.percentOff)+99n)/100n;
  const newCents=reduced>0n?reduced:1n;
  return (newCents/100n).toString()+'.'+(newCents%100n).toString().padStart(2,'0');
}
export function validatePost(body) {
  if(!body||!validId(body.id)||!validId(body.creatorId)||!safeName(body.title)||typeof body.content!=='string'||body.content.length>50000||typeof body.excerpt!=='string'||body.excerpt.length>400||!['free','members','one_time','members_or_purchase'].includes(body.access)||typeof body.published!=='boolean')throw Error('invalid_post');
  if(['members','members_or_purchase'].includes(body.access)&&!validId(body.tierId))throw Error('invalid_tier');
  if(['one_time','members_or_purchase'].includes(body.access)&&(!validPrice(body.price)||!/^[A-Z]{3}$/.test(body.currency||'')))throw Error('invalid_post_price');
  return {id:body.id,creatorId:body.creatorId,title:body.title.trim(),content:body.content,excerpt:body.excerpt,access:body.access,tierId:body.tierId||null,price:body.price||null,currency:body.currency||null,videoUrl:body.videoUrl?youtubeEmbed(body.videoUrl):null,published:body.published,createdAt:new Date().toISOString()};
}
export function canReadPost(post,patronId,invoices,gifts,now=Date.now()) {
  if(!post||!post.published)return false;
  if(post.access==='free')return true;
  if(!validId(patronId))return false;
  const membership=supporterEntitlements(invoices,gifts,post.creatorId,patronId,now);
  if(['members','members_or_purchase'].includes(post.access)&&membership.active&&membership.tiers.includes(post.tierId))return true;
  if(['one_time','members_or_purchase'].includes(post.access)) {
    const product={id:'post_'+post.id,creatorId:post.creatorId,price:post.price,currency:post.currency,billing:'one_time'};
    return ownsProduct(invoices,product,patronId,now);
  }
  return false;
}
export function publicPost(post,unlocked=false) {
  return {id:post.id,creatorId:post.creatorId,title:post.title,excerpt:post.excerpt,access:post.access,tierId:post.tierId,price:post.price,currency:post.currency,published:post.published,createdAt:post.createdAt,unlocked,...(unlocked?{content:post.content,videoUrl:post.videoUrl}: {})};
}
export function audienceSummary(invoices,gifts,creatorId,now=Date.now()) {
  const relevant=Object.values(invoices).filter(i=>i.creatorId===creatorId);
  const patrons=new Set(relevant.map(i=>i.patronId));
  for(const g of Object.values(gifts||{}))if(g.creatorId===creatorId)for(const r of g.redemptions||[])patrons.add(r.patronId);
  const members=[...patrons].filter(p=>supporterEntitlements(invoices,gifts,creatorId,p,now).active);
  const counts={};
  for(const i of relevant)counts[i.status]=(counts[i.status]||0)+1;
  return {creatorId,totalSupporters:patrons.size,activeMembers:members.length,paymentStatuses:counts,totalVerifiedPaid:relevant.filter(i=>i.status==='paid').length,generatedAt:new Date(now).toISOString()};
}
