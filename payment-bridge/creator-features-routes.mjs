import {codeHash,createGiftCode,validateGift,redeemGift,validateDiscount,discountPrice,validatePost,canReadPost,publicPost,audienceSummary,supporterEntitlements} from './creator-features.mjs';
import {validId} from './shop.mjs';

const WRITE_LIMIT=65536;
async function jsonBody(req) {
  let size=0;const chunks=[];
  for await(const chunk of req){size+=chunk.length;if(size>WRITE_LIMIT)throw Error('body_too_large');chunks.push(chunk);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function response(res,status,obj){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(obj));}
export async function creatorFeatureRoute(req,res,url,{state,persist,admin,project}) {
  const path=url.pathname;
  const creatorId=url.searchParams.get('creatorId');
  if(req.method==='GET' && path.startsWith('/v1/public/gifts/')) {
    const code=path.slice('/v1/public/gifts/'.length);
    if(!/^[A-Za-z0-9]{8,64}$/.test(code)){response(res,404,{error:'not_found'});return true;}
    const gift=state.gifts?.[codeHash(code)];
    if(!gift || gift.revoked || Date.parse(gift.expiresAt)<=Date.now() || gift.redemptions.length>=gift.maxRedemptions) {response(res,404,{error:'gift_unavailable'});return true;}
    response(res,200,{creatorId:gift.creatorId,tierId:gift.tierId,durationDays:gift.durationDays,remaining:gift.maxRedemptions-gift.redemptions.length,expiresAt:gift.expiresAt});return true;
  }
  if(req.method==='GET'&&path==='/v1/public/posts') {
    if(!validId(creatorId)){response(res,400,{error:'invalid_creator'});return true;}
    const posts=Object.values(state.posts||{}).filter(p=>p.creatorId===creatorId&&p.published).map(p=>publicPost(p,p.access==='free'));
    response(res,200,{creatorId,posts});return true;
  }
  if(req.method==='GET'&&path.startsWith('/v1/public/posts/')) {
    const id=path.slice('/v1/public/posts/'.length);
    const post=state.posts?.[id];
    if(!post?.published){response(res,404,{error:'not_found'});return true;}
    // Free content is truly public; paid bodies are NEVER returned through an unauthenticated endpoint.
    response(res,200,{post:publicPost(post,post.access==='free')});return true;
  }
  if(req.method==='GET'&&path.startsWith('/v1/creator/posts/')) {
    if(!project?.scopes.includes('posts:read')){response(res,403,{error:'missing_scope'});return true;}
    const id=path.slice('/v1/creator/posts/'.length);
    const patronId=url.searchParams.get('patronId');
    const post=state.posts?.[id];
    if(!post||post.creatorId!==project.creatorId||!post.published||!validId(patronId)){response(res,404,{error:'not_found'});return true;}
    response(res,200,{post:publicPost(post,canReadPost(post,patronId,state.invoices,state.gifts))});return true;
  }
  if(req.method==='GET'&&path.startsWith('/v1/creator/patrons/')&&path.endsWith('/entitlements')) {
    // Handled by the existing Creator API route; extension is wired there separately.
    return false;
  }
  if(!path.startsWith('/v1/admin/creator/'))return false;
  if(!admin){response(res,401,{error:'unauthorised'});return true;}
  if(req.method==='GET'&&path==='/v1/admin/creator/audience') {
    if(!validId(creatorId)){response(res,400,{error:'invalid_creator'});return true;}
    response(res,200,audienceSummary(state.invoices,state.gifts,creatorId));return true;
  }
  if(req.method==='GET'&&path==='/v1/admin/creator/members') {
    if(!validId(creatorId)){response(res,400,{error:'invalid_creator'});return true;}
    const patrons=new Set(Object.values(state.invoices||{}).filter(i=>i.creatorId===creatorId).map(i=>i.patronId));
    for(const g of Object.values(state.gifts||{}))if(g.creatorId===creatorId)for(const r of g.redemptions||[])patrons.add(r.patronId);
    const members=[...patrons].sort().slice(0,500).map(patronId=>supporterEntitlements(state.invoices,state.gifts,creatorId,patronId));
    response(res,200,{creatorId,members,limit:500});return true;
  }
  if(req.method==='POST'&&path==='/v1/admin/creator/posts') {
    let post;try{post=validatePost(await jsonBody(req));}catch(e){response(res,400,{error:e.message});return true;}
    state.posts??={};state.products??={};const old=state.posts[post.id];const productId='post_'+post.id;const oldProduct=state.products[productId];if(old){post.createdAt=old.createdAt;}
    state.posts[post.id]=post;
    if(['one_time','members_or_purchase'].includes(post.access)) state.products[productId]={id:productId,creatorId:post.creatorId,title:post.title,description:post.excerpt,kind:'post',billing:'one_time',price:post.price,currency:post.currency,assetId:null,requiredTierId:null,youtubeEmbedUrl:null,published:post.published};
    else delete state.products[productId];
    try{await persist();}catch{if(old)state.posts[post.id]=old;else delete state.posts[post.id];if(oldProduct)state.products[productId]=oldProduct;else delete state.products[productId];response(res,500,{error:'persistence_failed'});return true;}
    response(res,200,{post:publicPost(post,true)});return true;
  }
  if(req.method==='POST'&&path==='/v1/admin/creator/gifts') {
    let gift;try{gift=validateGift(await jsonBody(req));}catch(e){response(res,400,{error:e.message});return true;}
    const code=createGiftCode(), hash=codeHash(code);
    state.gifts??={};state.gifts[hash]=gift;
    try{await persist();}catch{delete state.gifts[hash];response(res,500,{error:'persistence_failed'});return true;}
    response(res,201,{code,redeemPath:'/redeem/'+code,redeemUiReady:true,expiresAt:gift.expiresAt,maxRedemptions:gift.maxRedemptions});return true;
  }
  if(req.method==='POST'&&path==='/v1/admin/creator/gifts/redeem') {
    let body;try{body=await jsonBody(req);}catch{response(res,400,{error:'invalid_json'});return true;}
    if(typeof body.code!=='string'||body.code.length>64||!validId(body.patronId)){response(res,400,{error:'invalid_gift_request'});return true;}
    const hash=codeHash(body.code),gift=state.gifts?.[hash], result=redeemGift(gift,body.patronId);
    if(!result.ok){response(res,409,{error:result.reason});return true;}
    gift.redemptions.push(result.record);
    try{await persist();}catch{gift.redemptions.pop();response(res,500,{error:'persistence_failed'});return true;}
    response(res,200,{creatorId:gift.creatorId,patronId:body.patronId,tierId:gift.tierId,expiresAt:result.record.expiresAt});return true;
  }
  if(req.method==='POST'&&path==='/v1/admin/creator/discounts') {
    let body,discount;try{body=await jsonBody(req);discount=validateDiscount(body);}catch(e){response(res,400,{error:e.message});return true;}
    const code=createGiftCode(),hash=codeHash(code);
    state.discounts??={};state.discounts[hash]=discount;
    try{await persist();}catch{delete state.discounts[hash];response(res,500,{error:'persistence_failed'});return true;}
    response(res,201,{code,percentOff:discount.percentOff,expiresAt:discount.expiresAt});return true;
  }
  if(req.method==='POST'&&path==='/v1/admin/creator/discounts/quote') {
    let body;try{body=await jsonBody(req);}catch{response(res,400,{error:'invalid_json'});return true;}
    if(typeof body.code!=='string'||body.code.length>64||!validId(body.productId)){response(res,400,{error:'invalid_request'});return true;}
    const discount=state.discounts?.[codeHash(body.code)], product=state.products?.[body.productId];
    if(!product){response(res,404,{error:'product_not_found'});return true;}
    const uses=Object.values(state.invoices).filter(i=>i.discountHash===codeHash(body.code)&&i.status==='paid').length;
    const price=discountPrice(discount,product,uses);
    if(!price){response(res,422,{error:'invalid_or_expired_discount'});return true;}
    response(res,200,{productId:product.id,price,currency:product.currency});return true;
  }
  response(res,404,{error:'not_found'});return true;
}
