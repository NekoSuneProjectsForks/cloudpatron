import {randomUUID} from 'node:crypto';
import {mkdir, open, stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {validId,validateProduct,publicProduct,canDownload,signDownload,verifyDownload,publicVRChatSupporters,ownsProduct} from './shop.mjs';

const ALLOWED_MIME=new Set(['application/zip','application/pdf','application/octet-stream','image/png','image/jpeg','video/mp4','video/webm','audio/mpeg','audio/ogg','text/plain']);
const MAX_BYTES=25*1024*1024;
function reply(res,status,data) {
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(JSON.stringify(data));
}
async function readJSON(req) {
  const chunks=[];let bytes=0;
  for await(const chunk of req) {bytes+=chunk.length;if(bytes>16384)throw Error('too_large');chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function assetRoot(dbPath) {return resolve(dirname(dbPath),'assets');}
async function writeAsset(req,dbPath) {
  const mime=String(req.headers['content-type']||'').split(';')[0].toLowerCase();
  if(!ALLOWED_MIME.has(mime)) throw Error('unsupported_media_type');
  const length=Number(req.headers['content-length']);
  if(!Number.isSafeInteger(length)||length<1||length>MAX_BYTES) throw Error('invalid_content_length');
  const filename=String(req.headers['x-file-name']||'download').replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,100);
  const id='asset_'+randomUUID().replaceAll('-','');
  const root=assetRoot(dbPath);await mkdir(root,{recursive:true,mode:0o700});
  const path=join(root,id);
  const fd=await open(path,'wx',0o600);
  let bytes=0;
  try {
    for await(const chunk of req) {
      bytes+=chunk.length;
      if(bytes>MAX_BYTES||bytes>length)throw Error('file_too_large');
      await fd.write(chunk);
    }
    if(bytes!==length) throw Error('content_length_mismatch');
  } catch(e) {
    await fd.close();
    await (await import('node:fs/promises')).unlink(path).catch(()=>{});
    throw e;
  }
  await fd.close();
  return {id,filename,mime,size:bytes};
}
export async function shopRoute(req,res,url,{state,persist,dbPath,admin,apiToken}) {
  const p=url.pathname;
  if(req.method==='GET' && p==='/v1/public/shop') {
    const creatorId=url.searchParams.get('creatorId');
    if(!validId(creatorId)) {reply(res,400,{error:'invalid_creator'});return true;}
    const items=Object.values(state.products||{}).filter(x=>x.creatorId===creatorId&&x.published).map(publicProduct);
    reply(res,200,{creatorId,products:items});return true;
  }
  if(req.method==='GET' && p==='/v1/public/vrchat/tiers') {
    const creatorId=url.searchParams.get('creatorId');
    if(!validId(creatorId)) {reply(res,400,{error:'invalid_creator'});return true;}
    reply(res,200,{creatorId,updatedAt:new Date().toISOString(),supporters:publicVRChatSupporters(state.vrchat||{},state.invoices||{},creatorId)});return true;
  }
  if(req.method==='GET' && p.startsWith('/v1/downloads/')) {
    const signed=p.slice('/v1/downloads/'.length);
    const grant=verifyDownload(process.env.DOWNLOAD_SIGNING_SECRET||'',signed);
    if(!grant||!canDownload(state.invoices||{},state.products||{},state.assets||{},grant.productId,grant.patronId)){reply(res,403,{error:'purchase_required'});return true;}
    const product=state.products[grant.productId],asset=state.assets[product.assetId];
    const path=join(assetRoot(dbPath),asset.id);
    try {
      const info=await stat(path);
      if(!info.isFile()||info.size!==asset.size)throw Error('missing');
      res.writeHead(200,{'content-type':asset.mime,'content-length':asset.size,'content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(asset.filename),'cache-control':'private, no-store','x-content-type-options':'nosniff'});
      createReadStream(path).on('error',()=>res.destroy()).pipe(res);
    }catch{reply(res,404,{error:'asset_not_found'});}
    return true;
  }
  if(!p.startsWith('/v1/admin/shop/')&&!p.startsWith('/v1/admin/vrchat/'))return false;
  if(!admin) {reply(res,401,{error:'unauthorised'});return true;}
  if(req.method==='POST' && p==='/v1/admin/shop/assets') {
    let asset;
    try{asset=await writeAsset(req,dbPath);}catch(e){reply(res,400,{error:e.message});return true;}
    state.assets??={};state.assets[asset.id]=asset;
    try{await persist();}catch{delete state.assets[asset.id];reply(res,500,{error:'asset_persistence_failed'});return true;}
    reply(res,201,{asset});return true;
  }
  if(req.method==='POST' && p==='/v1/admin/shop/products') {
    let product;
    try {product=validateProduct(await readJSON(req));}
    catch(e){reply(res,400,{error:e.message});return true;}
    if(product.assetId&&!state.assets?.[product.assetId]){reply(res,400,{error:'asset_not_found'});return true;}
    state.products??={};const old=state.products[product.id];
    state.products[product.id]=product;
    try{await persist();}catch{if(old)state.products[product.id]=old;else delete state.products[product.id];reply(res,500,{error:'product_persistence_failed'});return true;}
    reply(res,200,{product:publicProduct(product)});return true;
  }
  if(req.method==='POST' && p==='/v1/admin/shop/download-tickets') {
    let data;
    try{data=await readJSON(req);}catch{reply(res,400,{error:'invalid_json'});return true;}
    if(!validId(data.productId)||!validId(data.patronId)||!canDownload(state.invoices||{},state.products||{},state.assets||{},data.productId,data.patronId)){
      reply(res,403,{error:'purchase_required'});return true;
    }
    const exp=Date.now()+5*60*1000;
    let token;
    try{token=signDownload(process.env.DOWNLOAD_SIGNING_SECRET||'',{productId:data.productId,patronId:data.patronId,exp});}
    catch{reply(res,503,{error:'download_secret_not_configured'});return true;}
    reply(res,200,{url:'/v1/downloads/'+token,expiresAt:new Date(exp).toISOString()});return true;
  }
  // Private administrative VRChat identity mapping. Public listing remains opt-in and membership-verified.
  if(req.method==='POST' && p==='/v1/admin/vrchat/link') {
    let data;
    try{data=await readJSON(req);}catch{reply(res,400,{error:'invalid_json'});return true;}
    if(!validId(data.creatorId)||!validId(data.patronId)||!/^.{2,64}$/.test(data.vrchatUsername||'')||typeof data.publicOptIn!=='boolean'||data.consentRecorded!==true){
      reply(res,400,{error:'verified_identity_and_consent_required'});return true;
    }
    const username=data.vrchatUsername.trim();
    if(!/^[a-zA-Z0-9 _.-]{2,64}$/.test(username)){reply(res,400,{error:'invalid_vrchat_username'});return true;}
    const id=data.creatorId+':'+data.patronId;
    state.vrchat??={};const old=state.vrchat[id];
    state.vrchat[id]={creatorId:data.creatorId,patronId:data.patronId,vrchatUsername:username,publicOptIn:data.publicOptIn,consentRecordedAt:new Date().toISOString()};
    try{await persist();}catch{if(old)state.vrchat[id]=old;else delete state.vrchat[id];reply(res,500,{error:'identity_persistence_failed'});return true;}
    reply(res,200,{ok:true});return true;
  }
  reply(res,404,{error:'not_found'});return true;
}
