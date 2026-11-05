import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';

const ID = /^[a-zA-Z0-9_-]{1,128}$/;
const AMOUNT = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/;
const KINDS = new Set(['download','video','post','bundle']);
const BILLING = new Set(['one_time','monthly']);
const HTTPS_YOUTUBE = new Set(['youtube.com','www.youtube.com','youtu.be','www.youtube-nocookie.com']);

export function validId(v) { return typeof v === 'string' && ID.test(v); }
export function validPrice(v) { return typeof v === 'string' && AMOUNT.test(v) && Number(v)>0; }
export function youtubeEmbed(value) {
  if (!value) return null;
  let url;
  try { url = new URL(value); } catch { throw new Error('invalid_youtube_url'); }
  if (url.protocol!=='https:' || !HTTPS_YOUTUBE.has(url.hostname)) throw new Error('invalid_youtube_url');
  let id;
  if (url.hostname==='youtu.be') id=url.pathname.slice(1);
  else if (url.pathname==='/watch') id=url.searchParams.get('v');
  else if (url.pathname.startsWith('/embed/')) id=url.pathname.slice('/embed/'.length);
  else if (url.pathname.startsWith('/shorts/')) id=url.pathname.slice('/shorts/'.length);
  if (!/^[a-zA-Z0-9_-]{11}$/.test(id||'')) throw new Error('invalid_youtube_url');
  return 'https://www.youtube-nocookie.com/embed/'+id;
}
export function validateProduct(body) {
  if (!body || !validId(body.id) || !validId(body.creatorId) || typeof body.title!=='string' || body.title.trim().length<1 || body.title.length>160) throw new Error('invalid_product');
  if (!KINDS.has(body.kind) || !BILLING.has(body.billing) || !validPrice(body.price) || !/^[A-Z]{3}$/.test(body.currency||'')) throw new Error('invalid_product');
  if (body.assetId!=null && !validId(body.assetId)) throw new Error('invalid_asset');
  if (body.requiredTierId!=null && !validId(body.requiredTierId)) throw new Error('invalid_tier');
  if (body.description!=null && (typeof body.description!=='string'||body.description.length>4000)) throw new Error('invalid_description');
  const previewUrl=youtubeEmbed(body.youtubeUrl||null);
  return {id:body.id,creatorId:body.creatorId,title:body.title.trim(),description:body.description||'',kind:body.kind,billing:body.billing,price:body.price,currency:body.currency,assetId:body.assetId||null,requiredTierId:body.requiredTierId||null,youtubeEmbedUrl:previewUrl,published:body.published===true};
}
export function publicProduct(p) {
  return {id:p.id,creatorId:p.creatorId,title:p.title,description:p.description,kind:p.kind,billing:p.billing,price:p.price,currency:p.currency,requiredTierId:p.requiredTierId,youtubeEmbedUrl:p.youtubeEmbedUrl,hasProtectedDownload:!!p.assetId,published:p.published};
}
export function ownsProduct(invoices,product,patronId,now=Date.now()) {
  if(!product||!validId(patronId)) return false;
  return Object.values(invoices).some(i=>{
    if(i.patronId!==patronId||i.creatorId!==product.creatorId||i.productId!==product.id||i.status!=='paid') return false;
    if(i.amount!==product.price || i.currency!==product.currency) return false;
    if(product.billing==='one_time') return true;
    const paidAt=Date.parse(i.paidAt||'');
    return Number.isFinite(paidAt) && now<paidAt+30*86400000;
  });
}
export function canDownload(invoices,products,assets,productId,patronId) {
  const p=products[productId];
  if(!p||!p.assetId||!assets[p.assetId]||!ownsProduct(invoices,p,patronId)) return false;
  return true;
}
export function signDownload(secret,payload) {
  if(!secret || secret.length<32) throw new Error('download_secret_required');
  const encoded=Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig=createHmac('sha256',secret).update(encoded).digest('base64url');
  return encoded+'.'+sig;
}
export function verifyDownload(secret,token,now=Date.now()) {
  if(!secret||!token||token.length>4096) return null;
  const parts=token.split('.');
  if(parts.length!==2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return null;
  const expected=createHmac('sha256',secret).update(parts[0]).digest();
  const actual=Buffer.from(parts[1],'base64url');
  if(expected.length!==actual.length||!timingSafeEqual(expected,actual)) return null;
  let payload;
  try {payload=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));} catch{return null;}
  if(!validId(payload.productId)||!validId(payload.patronId)||!Number.isFinite(payload.exp)||payload.exp<=now||payload.exp>now+10*60*1000) return null;
  return payload;
}
export function publicVRChatSupporters(links,invoices,creatorId,now=Date.now()) {
  return Object.values(links).filter(x=>x.creatorId===creatorId && x.publicOptIn===true && validId(x.patronId) && /^[a-zA-Z0-9 _.-]{2,64}$/.test(x.vrchatUsername||'')).map(x=>{
    const tiers=[...new Set(Object.values(invoices).filter(i=>i.creatorId===creatorId&&i.patronId===x.patronId&&i.status==='paid'&&i.tierId&&Number.isFinite(Date.parse(i.paidAt||''))&&now<Date.parse(i.paidAt)+30*86400000).map(i=>i.tierId))];
    return {username:x.vrchatUsername,tiers};
  }).filter(x=>x.tiers.length>0).sort((a,b)=>a.username.localeCompare(b.username));
}
