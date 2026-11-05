import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProduct,youtubeEmbed,ownsProduct,canDownload,signDownload,verifyDownload,publicVRChatSupporters} from './shop.mjs';
import {codeHash,validateGift,redeemGift,giftEntitlements,validateDiscount,discountPrice,validatePost,canReadPost,audienceSummary,supporterEntitlements} from './creator-features.mjs';

const product={id:'fxpack',creatorId:'nekosune',title:'Hardstyle FX Pack',description:'Animation pack',kind:'download',billing:'one_time',price:'6.00',currency:'GBP',assetId:'asset_demo',published:true};
const paid={creatorId:'nekosune',patronId:'patron1',productId:'fxpack',amount:'6.00',currency:'GBP',status:'paid',paidAt:new Date().toISOString()};
const future=new Date(Date.now()+5*86400000).toISOString();
test('shop product and video validation',()=>{
 assert.equal(validateProduct(product).title,'Hardstyle FX Pack');
 assert.throws(()=>validateProduct({...product,price:'-1'}));
 assert.throws(()=>validateProduct({...product,id:'../bad'}));
 assert.equal(youtubeEmbed('https://youtu.be/dQw4w9WgXcQ'),'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
 assert.throws(()=>youtubeEmbed('https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ'));
});
test('paid and refunded shop purchase authorisation',()=>{
 assert.equal(ownsProduct({a:paid},product,'patron1'),true);
 assert.equal(ownsProduct({a:{...paid,status:'refunded'}},product,'patron1'),false);
 assert.equal(ownsProduct({a:{...paid,patronId:'other'}},product,'patron1'),false);
 assert.equal(canDownload({a:paid},{fxpack:product},{asset_demo:{}},'fxpack','patron1'),true);
 assert.equal(canDownload({}, {fxpack:product},{asset_demo:{}},'fxpack','patron1'),false);
 assert.equal(ownsProduct({a:{...paid,amount:'5.40',catalogPrice:'6.00'}},product,'patron1'),true);
});
test('short-lived signed download links cannot be tampered with',()=>{
 const secret='x'.repeat(64), now=Date.now();
 const token=signDownload(secret,{patronId:'patron1',productId:'fxpack',exp:now+5000});
 assert.equal(verifyDownload(secret,token,now).productId,'fxpack');
 assert.equal(verifyDownload(secret,token,now+6000),null);
 assert.equal(verifyDownload(secret,token.slice(0,-2)+'qq',now),null);
});
test('VRChat list only returns consented verified subscription tiers',()=>{
 const links={a:{creatorId:'nekosune',patronId:'patron1',vrchatUsername:'Neko VR',publicOptIn:true},b:{creatorId:'nekosune',patronId:'patron2',vrchatUsername:'Private VR',publicOptIn:false}};
 const invoices={a:{...paid,productId:null,tierId:'premium'},b:{...paid,patronId:'patron2',productId:null,tierId:'donator'}};
 assert.deepEqual(publicVRChatSupporters(links,invoices,'nekosune').map(x=>x.username),['Neko VR']);
});
test('gift code is bounded, unique per patron and expires',()=>{
 const gift=validateGift({creatorId:'nekosune',tierId:'premium',durationDays:30,maxRedemptions:1,expiresAt:future});
 const first=redeemGift(gift,'patron1');
 assert.equal(first.ok,true);
 gift.redemptions.push(first.record);
 assert.equal(redeemGift(gift,'patron1').ok,false);
 assert.equal(redeemGift(gift,'patron2').ok,false);
 assert.equal(giftEntitlements({[codeHash('abc')]:gift},'nekosune','patron1').length,1);
 assert.equal(supporterEntitlements({}, {[codeHash('abc')]:gift},'nekosune','patron1').active,true);
});
test('discount policy rejects invalid discounts and creates deterministic quote',()=>{
 const d=validateDiscount({creatorId:'nekosune',productId:'fxpack',percentOff:10,maxUses:2,expiresAt:future});
 assert.equal(discountPrice(d,product,0),'5.40');
 assert.equal(discountPrice(d,product,2),null);
 assert.equal(discountPrice(d,{...product,creatorId:'other'},0),null);
 assert.throws(()=>validateDiscount({...d,percentOff:100}));
});
test('free posts show content, paid posts only after verified entitlement',()=>{
 const base={id:'update1',creatorId:'nekosune',title:'Work in progress',content:'secret',excerpt:'teaser',access:'members',tierId:'premium',published:true};
 const post=validatePost(base);
 assert.equal(canReadPost(post,'patron1',{},{}),false);
 assert.equal(canReadPost({...post,access:'free'},null,{},{}),true);
 const subscription={...paid,productId:null,tierId:'premium'};
 assert.equal(canReadPost(post,'patron1',{a:subscription},{}),true);
 assert.equal(canReadPost(post,'patron1',{a:{...subscription,status:'refunded'}},{}),false);
});
test('audience insights aggregate verified statuses without personal details',()=>{
 const summary=audienceSummary({a:paid,b:{...paid,patronId:'patron2',status:'cancelled'}},{},'nekosune');
 assert.equal(summary.totalSupporters,2);
 assert.equal(summary.paymentStatuses.cancelled,1);
 assert.equal(summary.totalVerifiedPaid,1);
});
