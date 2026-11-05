import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';

const FIELDS={
  stripe:['publishableKey','secretKey','webhookSecret'],
  paypal:['clientId','clientSecret','webhookId'],
  nowpayments:['apiKey','ipnSecret'],
  zbd:['apiKey','webhookSecret'],
  heleket:['merchantId','paymentKey','callbackUrl'],
  cryptomus:['merchantId','paymentKey'],
  bitpay:['apiToken'],
  coingate:['apiToken'],
  oxapay:['merchantApiKey'],
  plisio:['secretKey'],
  opennode:['apiKey'],
  strike:['apiKey'],
  alby:['accessToken'],
  speed:['apiKey'],
  checkoutcom:['publicKey','secretKey','webhookSecret'],
  revolut:['merchantApiKey','webhookSecret'],
  hive:['receivingAccount','rpcUrl'],hbd:['receivingAccount','rpcUrl'],
  steem:['receivingAccount','rpcUrl'],sbd:['receivingAccount','rpcUrl'],
  blurt:['receivingAccount','rpcUrl'],telos:['receivingAccount','rpcUrl'],
  eos:['receivingAccount','rpcUrl'],fio:['receivingAccount','rpcUrl'],
  wax:['receivingAccount','rpcUrl'],pivx:['receivingAddress','rpcUrl'],
  fls:['receivingAddress','rpcUrl']
};
const SECRET=new Set(['secretKey','webhookSecret','paymentKey','clientSecret','apiKey','apiToken','ipnSecret','merchantApiKey','accessToken']);
export function definitions(){return Object.entries(FIELDS).map(([id,fields])=>({id,fields:fields.map(name=>({name,secret:SECRET.has(name)}))}));}
export function validateGateway(id,values){
  if(!FIELDS[id])throw Error('unsupported_gateway');
  if(!values||typeof values!=='object'||Array.isArray(values))throw Error('invalid_values');
  const clean={};
  for(const [k,v] of Object.entries(values)){
    if(!FIELDS[id].includes(k)||typeof v!=='string'||v.length>8192)throw Error('invalid_field');
    if(v.trim()) {
      if(k==='callbackUrl'||k==='rpcUrl') { let url;try{url=new URL(v.trim());}catch{throw Error('invalid_endpoint_url');}if(url.protocol!=='https:'||url.username||url.password)throw Error('invalid_endpoint_url'); }
      clean[k]=v.trim();
    }
  }
  return clean;
}
export function safeGateway(id,record){
  return {id,configured:!!record&&Object.keys(record).length>0,fields:FIELDS[id].map(name=>({name,configured:!!record?.[name],secret:SECRET.has(name),...(!SECRET.has(name)&&record?.[name]?{value:record[name]}:{})}))};
}
export class GatewayVault {
  constructor(path){this.path=resolve(path);this.key=null;this.records={};this.queue=Promise.resolve();}
  async init(){
    await mkdir(dirname(this.path),{recursive:true,mode:0o700});
    const keyPath=this.path+'.key';
    try{this.key=await readFile(keyPath);}catch(err){
      if(err.code!=='ENOENT')throw err;
      const key=randomBytes(32);
      try{await writeFile(keyPath,key,{flag:'wx',mode:0o600});this.key=key;}
      catch(e){if(e.code!=='EEXIST')throw e;this.key=await readFile(keyPath);}
    }
    if(this.key.length!==32)throw Error('gateway_encryption_key_invalid');
    try{
      const envelope=JSON.parse(await readFile(this.path,'utf8'));
      if(envelope.version!==1)throw Error('unsupported_vault_version');
      const decipher=createDecipheriv('aes-256-gcm',this.key,Buffer.from(envelope.iv,'base64'));
      decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));
      this.records=JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.data,'base64')),decipher.final()]).toString('utf8'));
    }catch(err){if(err.code!=='ENOENT')throw err;}
  }
  list(){return definitions().map(g=>safeGateway(g.id,this.records[g.id]));}
  get(id){if(!FIELDS[id])return null;return {...(this.records[id]||{})};}
  async update(id,values,remove=[]){
    const clean=validateGateway(id,values);
    if(!Array.isArray(remove)||remove.some(field=>!FIELDS[id].includes(field)))throw Error('invalid_remove_fields');
    const old=this.records[id]||{},next={...old,...clean};
    for(const field of remove)delete next[field];
    const previous=this.records;
    this.records={...previous,[id]:next};
    try{await this.save();}catch(err){this.records=previous;throw err;}
    return safeGateway(id,next);
  }
  async save(){
    const serialized=JSON.stringify(this.records);
    this.queue=this.queue.catch(()=>{}).then(async()=>{
      const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);
      const data=Buffer.concat([cipher.update(serialized,'utf8'),cipher.final()]);
      const tmp=this.path+'.tmp';
      await writeFile(tmp,JSON.stringify({version:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')}),{mode:0o600});
      await rename(tmp,this.path);
    });
    return this.queue;
  }
}
