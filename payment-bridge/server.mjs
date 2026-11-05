import http from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { PROVIDERS } from './providers.mjs';

const port = Number(process.env.BRIDGE_PORT || 8091);
const host = process.env.BRIDGE_HOST || '127.0.0.1';
const dbPath = resolve(process.env.BRIDGE_DATA_FILE || './data/invoices.json');
const apiToken = process.env.BRIDGE_API_TOKEN || '';
const merchantId = process.env.HELEKET_MERCHANT_ID || '';
const paymentKey = process.env.HELEKET_PAYMENT_KEY || '';
const amountPattern = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/;
const codePattern = /^[A-Z]{3,10}$/;
const invoiceIdPattern = /^[0-9a-f-]{36}$/i;
let state = { invoices: {} };
let writeQueue = Promise.resolve();

export function validAmount(value) {
  return typeof value === 'string' && amountPattern.test(value) && Number(value) > 0;
}
export function authorised(authHeader, token) {
  if (!token || !authHeader?.startsWith('Bearer ')) return false;
  const a = Buffer.from(authHeader.slice(7), 'utf8');
  const b = Buffer.from(token, 'utf8');
  return a.length === b.length && timingSafeEqual(a,b);
}
function send(res, code, data) {
  res.writeHead(code, {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(JSON.stringify(data));
}
async function bodyJSON(req) {
  let chunks = [], size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16_384) throw new Error('request_too_large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function persist() {
  const snapshot = JSON.stringify(state, null, 2);
  writeQueue = writeQueue.catch(()=>{}).then(async () => {
    await mkdir(dirname(dbPath),{recursive:true,mode:0o700});
    const temp = dbPath + '.tmp';
    await writeFile(temp,snapshot,{mode:0o600});
    await rename(temp,dbPath);
  });
  await writeQueue;
}
function publicInvoice(item) {
  return {id:item.id,patronId:item.patronId,provider:item.provider,amount:item.amount,currency:item.currency,status:item.status,checkoutUrl:item.checkoutUrl,createdAt:item.createdAt};
}
export async function handler(req,res) {
  if (req.url === '/health' && req.method === 'GET') return send(res,200,{ok:true});
  if (!authorised(req.headers.authorization,apiToken)) return send(res,401,{error:'unauthorised'});
  const url = new URL(req.url,'http://localhost');
  if (req.method==='GET' && url.pathname==='/v1/providers') {
    return send(res,200,{providers:PROVIDERS});
  }
  if (req.method==='GET' && url.pathname.startsWith('/v1/invoices/')) {
    const id = url.pathname.slice('/v1/invoices/'.length);
    if (!invoiceIdPattern.test(id) || !state.invoices[id]) return send(res,404,{error:'not_found'});
    return send(res,200,publicInvoice(state.invoices[id]));
  }
  // Discord bots can query this endpoint, but beta invoices NEVER authorise access.
  // Only a verified paid ledger entry integrated into CloudPatron may unlock roles.
  if (req.method==='GET' && url.pathname.startsWith('/v1/entitlements/')) {
    const patronId = url.pathname.slice('/v1/entitlements/'.length);
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(patronId)) return send(res,400,{error:'invalid_patron'});
    return send(res,200,{patronId,active:false,roles:[],reason:'reconciliation_not_implemented'});
  }
  if (req.method==='POST' && url.pathname==='/v1/invoices') {
    let data;
    try { data=await bodyJSON(req); } catch { return send(res,400,{error:'invalid_json_or_too_large'}); }
    const {provider,patronId,amount,currency='USD'} = data || {};
    if (provider !== 'heleket') return send(res,422,{error:'provider_not_implemented'});
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(patronId||'') || !validAmount(amount) || !codePattern.test(currency)) {
      return send(res,400,{error:'invalid_invoice_parameters'});
    }
    if (!merchantId || !paymentKey) return send(res,503,{error:'heleket_not_configured'});
    const id = randomUUID();
    const orderId = 'cp_' + id.replaceAll('-','');
    // Import on demand so provider discovery works without installed SDK in development.
    const {HeleketPayment} = await import('@heleket-payment/sdk');
    const client = new HeleketPayment(merchantId,paymentKey);
    let invoice;
    try { invoice=await client.createInvoice({amount,currency,order_id:orderId}); }
    catch { return send(res,502,{error:'heleket_invoice_creation_failed'}); }
    const checkoutUrl = invoice?.url;
    let checkout;
    try { checkout = new URL(checkoutUrl); } catch {}
    if (!checkout || checkout.protocol!=='https:' || checkout.hostname!=='pay.heleket.com') {
      return send(res,502,{error:'invalid_provider_redirect'});
    }
    state.invoices[id]={id,patronId,provider,amount,currency,orderId,providerReference:invoice.uuid||null,status:'pending',checkoutUrl,createdAt:new Date().toISOString()};
    try { await persist(); } catch { delete state.invoices[id]; return send(res,500,{error:'invoice_persistence_failed'}); }
    return send(res,201,publicInvoice(state.invoices[id]));
  }
  return send(res,404,{error:'not_found'});
}

async function start() {
  if (!apiToken || apiToken.length < 32) throw new Error('BRIDGE_API_TOKEN must be at least 32 characters');
  try {
    const data=JSON.parse(await readFile(dbPath,'utf8'));
    if (data && typeof data.invoices==='object' && !Array.isArray(data.invoices)) state=data;
  } catch (error) { if(error.code!=='ENOENT') throw error; }
  const server=http.createServer((req,res)=> {
    Promise.resolve(handler(req,res)).catch(error => {
      console.error('request failed',error?.message);
      if(!res.headersSent) send(res,500,{error:'internal_error'});
      else res.end();
    });
  });
  server.listen(port,host,()=>console.log('CloudPatron payment bridge listening on '+host+':'+port));
}
if (process.argv[1] && import.meta.url === new URL('file://' + resolve(process.argv[1])).href) {
  start().catch(error=>{console.error(error.message);process.exitCode=1;});
}
