// A7 Tools Hub secure backend core.
// On Render, secrets are read from Environment Variables by server.js; never place them in frontend code.

let oauthCache = { token: null, expiresAt: 0 };

class AppError extends Error {
  constructor(code, status=400, message='') { super(code); this.code=code; this.status=status; this.publicMessage=message||code; }
}

const SENSITIVE_TOOLS = new Set([
  'vehicle-info','vehicle-to-number','name-info','upi-info','aadhaar-info','family-info',
  'pan-info','pan-to-gst','voter-id-info','atm-bank-account','paytm-info','num-to-bank-info'
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:corsHeaders(request,env)});

    try {
      if (url.pathname === '/health') return json(request,env,{success:true,service:'A7 Tools Backend',time:Date.now()});
      if (url.pathname === '/razorpay-webhook') return await handleWebhook(request,env);
      if (request.method !== 'POST') throw new AppError('METHOD_NOT_ALLOWED',405);

      const user = await authenticateFirebaseUser(request,env);
      await syncConfiguredAdmin(user,env);
      const body = await readJson(request);

      switch (url.pathname) {
        case '/sync-role': return json(request,env,{success:true,admin:await isConfiguredAdmin(user,env)});
        case '/tool-query': return json(request,env,await toolQuery(user,body,env));
        case '/admin-test-api': return json(request,env,await adminTestApi(user,body,env));
        case '/daily-claim': return json(request,env,await dailyClaim(user,env));
        case '/redeem': return json(request,env,await redeem(user,body,env));
        case '/create-order': return json(request,env,await createOrder(user,body,env));
        case '/verify-payment': return json(request,env,await verifyPayment(user,body,env));
        case '/submit-upi-payment': return json(request,env,await submitUpiPayment(user,body,env));
        case '/admin-upi-payments': return json(request,env,await adminUpiPayments(user,env));
        case '/admin-review-upi-payment': return json(request,env,await adminReviewUpiPayment(user,body,env));
        default: throw new AppError('NOT_FOUND',404);
      }
    } catch (err) {
      const e = err instanceof AppError ? err : new AppError('SERVER_ERROR',500,'Unexpected server error');
      if (!(err instanceof AppError)) console.error('Unhandled:',err?.stack||err);
      return json(request,env,{success:false,error:e.code,message:e.publicMessage},e.status);
    }
  }
};

function corsHeaders(request,env){
  const reqOrigin=request.headers.get('Origin')||'';
  const allowed=(env.ALLOWED_ORIGIN||'*').trim();
  const origin=allowed==='*'?'*':(reqOrigin===allowed?allowed:allowed);
  return {
    'Access-Control-Allow-Origin':origin,
    'Access-Control-Allow-Methods':'POST,GET,OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type, Authorization',
    'Access-Control-Max-Age':'86400',
    'Vary':'Origin'
  };
}
function json(request,env,data,status=200){
  return new Response(JSON.stringify(data),{status,headers:{...corsHeaders(request,env),'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
}
async function readJson(request){
  try{return await request.json();}catch{throw new AppError('INVALID_JSON',400);}
}
function slugify(v=''){return String(v).toLowerCase().replace(/→/g,' to ').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');}
function safeInt(v,min=0,max=100000000){const n=Math.floor(Number(v));return Number.isFinite(n)?Math.min(max,Math.max(min,n)):min;}
function utcDay(){return new Date().toISOString().slice(0,10);}

// -------- Firebase user authentication --------
async function authenticateFirebaseUser(request,env){
  const auth=request.headers.get('Authorization')||'';
  if(!auth.startsWith('Bearer ')) throw new AppError('UNAUTHENTICATED',401);
  const idToken=auth.slice(7).trim(); if(!idToken)throw new AppError('UNAUTHENTICATED',401);
  const r=await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken})
  });
  if(!r.ok) throw new AppError('UNAUTHENTICATED',401,'Session expired or invalid');
  const data=await r.json(); const u=data.users?.[0]; if(!u?.localId)throw new AppError('UNAUTHENTICATED',401);
  return {uid:u.localId,email:u.email||'',displayName:u.displayName||'',idToken};
}
async function isConfiguredAdmin(user,env){
  const adminEmail=String(env.ADMIN_EMAIL||'').trim().toLowerCase();
  if(!adminEmail) return false;
  return String(user.email||'').trim().toLowerCase()===adminEmail;
}
async function syncConfiguredAdmin(user,env){
  if(await isConfiguredAdmin(user,env)){
    const current=await dbGet('system/adminUid',env);
    if(current!==user.uid) await dbSet('system/adminUid',user.uid,env);
  }
}
async function requireAdmin(user,env){if(!(await isConfiguredAdmin(user,env)))throw new AppError('ADMIN_REQUIRED',403);return true;}

// -------- Firebase service account OAuth --------
function b64urlBytes(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
function b64urlText(s){return b64urlBytes(new TextEncoder().encode(s));}
function pemToBytes(pem){const clean=String(pem).replace(/\\n/g,'\n').replace(/-----BEGIN PRIVATE KEY-----/g,'').replace(/-----END PRIVATE KEY-----/g,'').replace(/\s+/g,'');const bin=atob(clean);return Uint8Array.from(bin,c=>c.charCodeAt(0));}
async function serviceAccessToken(env){
  if(oauthCache.token && oauthCache.expiresAt>Date.now()+60000)return oauthCache.token;
  if(!env.FIREBASE_CLIENT_EMAIL||!env.FIREBASE_PRIVATE_KEY)throw new AppError('FIREBASE_SERVER_NOT_CONFIGURED',500,'Add FIREBASE_SERVICE_ACCOUNT_JSON in Render Environment');
  const iat=Math.floor(Date.now()/1000), exp=iat+3500;
  const header=b64urlText(JSON.stringify({alg:'RS256',typ:'JWT'}));
  const payload=b64urlText(JSON.stringify({iss:env.FIREBASE_CLIENT_EMAIL,scope:'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',aud:'https://oauth2.googleapis.com/token',iat,exp}));
  const unsigned=`${header}.${payload}`;
  const key=await crypto.subtle.importKey('pkcs8',pemToBytes(env.FIREBASE_PRIVATE_KEY),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(unsigned));
  const assertion=`${unsigned}.${b64urlBytes(new Uint8Array(sig))}`;
  const tokenRes=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
  if(!tokenRes.ok){console.error('OAuth error',await tokenRes.text());throw new AppError('FIREBASE_OAUTH_FAILED',500);}
  const t=await tokenRes.json(); oauthCache={token:t.access_token,expiresAt:Date.now()+safeInt(t.expires_in,300,3600)*1000}; return t.access_token;
}
function dbUrl(path,env){const base=String(env.FIREBASE_DATABASE_URL||'').replace(/\/$/,'');if(!base)throw new AppError('FIREBASE_SERVER_NOT_CONFIGURED',500);return `${base}/${String(path).replace(/^\/+|\/+$/g,'')}.json`;}
async function dbRaw(path,env,{method='GET',body,headers={}}={}){
  const token=await serviceAccessToken(env);
  const opts={method,headers:{'Authorization':`Bearer ${token}`,'Content-Type':'application/json',...headers}};
  if(body!==undefined)opts.body=JSON.stringify(body);
  return fetch(dbUrl(path,env),opts);
}
async function dbGet(path,env){const r=await dbRaw(path,env);if(!r.ok)throw new AppError('FIREBASE_READ_FAILED',500);return await r.json();}
async function dbSet(path,value,env){const r=await dbRaw(path,env,{method:'PUT',body:value});if(!r.ok)throw new AppError('FIREBASE_WRITE_FAILED',500);return r.json();}
async function dbPatch(path,value,env){const r=await dbRaw(path,env,{method:'PATCH',body:value});if(!r.ok)throw new AppError('FIREBASE_WRITE_FAILED',500);return r.json();}
async function dbDelete(path,env){const r=await dbRaw(path,env,{method:'DELETE'});if(!r.ok)throw new AppError('FIREBASE_WRITE_FAILED',500);}
async function dbPush(path,value,env){const r=await dbRaw(path,env,{method:'POST',body:value});if(!r.ok)throw new AppError('FIREBASE_WRITE_FAILED',500);return r.json();}

async function etagUpdate(path,env,mutator,retries=7){
  for(let i=0;i<retries;i++){
    const r=await dbRaw(path,env,{headers:{'X-Firebase-ETag':'true'}}); if(!r.ok)throw new AppError('FIREBASE_READ_FAILED',500);
    const etag=r.headers.get('ETag'); const current=await r.json(); const next=await mutator(current);
    if(next===undefined)return {changed:false,value:current};
    const w=await dbRaw(path,env,{method:'PUT',body:next,headers:{'if-match':etag}});
    if(w.status===412)continue; if(!w.ok)throw new AppError('FIREBASE_WRITE_FAILED',500); return {changed:true,value:await w.json()};
  }
  throw new AppError('CONCURRENT_UPDATE_RETRY',409,'Please retry');
}

async function adjustCredits(uid,delta,env){
  const result=await etagUpdate(`wallets/${uid}`,env,current=>{
    const w=(current&&typeof current==='object')?current:{}; const credits=safeInt(w.credits,0,100000000); const next=credits+delta;
    if(next<0)throw new AppError('INSUFFICIENT_CREDITS',402,'Not enough credits');
    return {...w,credits:next,updatedAt:Date.now()};
  });
  return safeInt(result.value.credits,0,100000000);
}
async function addHistory(uid,action,detail,env){try{await dbPush(`history/${uid}`,{action,detail:String(detail||'').slice(0,180),timestamp:Date.now()},env);}catch(e){console.warn('history',e.message);}}
async function isPremium(uid,env){const p=await dbGet(`premium/${uid}`,env);return !!(p?.active&&Number(p.expiresAt||0)>Date.now());}

// -------- Configured provider API runner --------
function validateProviderUrl(raw){
  let u;try{u=new URL(raw);}catch{throw new AppError('INVALID_PROVIDER_URL',400);}
  if(!['https:','http:'].includes(u.protocol))throw new AppError('INVALID_PROVIDER_URL',400);
  const h=u.hostname.toLowerCase();
  if(h==='localhost'||h==='::1'||h==='0.0.0.0'||h==='169.254.169.254'||h==='metadata.google.internal'||/^127\./.test(h)||/^10\./.test(h)||/^192\.168\./.test(h)||/^172\.(1[6-9]|2\d|3[01])\./.test(h))throw new AppError('BLOCKED_PROVIDER_HOST',400);
  return u.toString();
}
function parseHeaders(text){
  if(!text)return{}; let h;try{h=typeof text==='string'?JSON.parse(text):text;}catch{throw new AppError('INVALID_PROVIDER_HEADERS',400);}
  if(!h||Array.isArray(h)||typeof h!=='object')throw new AppError('INVALID_PROVIDER_HEADERS',400);
  const out={}; const blocked=new Set(['host','content-length','cf-connecting-ip','x-forwarded-for','x-real-ip']);
  for(const [k,v] of Object.entries(h)){if(blocked.has(k.toLowerCase()))continue;out[String(k)]=String(v);}
  return out;
}
function replaceUrlQuery(template,q){const enc=encodeURIComponent(q);return String(template).split('{query}').join(enc).split('{}').join(enc);}
function replaceBodyQuery(template,q){const safe=JSON.stringify(String(q)).slice(1,-1);return String(template||'').split('{query}').join(safe).split('{}').join(safe);}
async function providerCall(cfg,q){
  const method=String(cfg.method||'GET').toUpperCase(); if(!['GET','POST','PUT','PATCH'].includes(method))throw new AppError('UNSUPPORTED_PROVIDER_METHOD',400);
  const url=validateProviderUrl(replaceUrlQuery(cfg.endpoint,q)); const headers={Accept:'application/json, text/plain, */*',...parseHeaders(cfg.headers)};
  const opts={method,headers}; if(method!=='GET'&&cfg.body){opts.body=replaceBodyQuery(cfg.body,q);if(!Object.keys(headers).some(k=>k.toLowerCase()==='content-type'))headers['Content-Type']='application/json';}
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),20000);opts.signal=controller.signal;
  let r;try{r=await fetch(url,opts);}catch(e){if(e.name==='AbortError')throw new AppError('PROVIDER_TIMEOUT',504);throw new AppError('PROVIDER_FETCH_FAILED',502);}finally{clearTimeout(timer);}
  const raw=(await r.text()).slice(0,250000); let data=raw;
  if(cfg.responseType!=='text'){try{data=JSON.parse(raw);}catch{if(cfg.responseType==='json')throw new AppError('PROVIDER_INVALID_JSON',502);}}
  if(!r.ok){const e=new AppError('PROVIDER_HTTP_ERROR',502,`Provider returned HTTP ${r.status}`);e.providerData=data;throw e;}
  return data;
}

async function toolQuery(user,body,env){
  const tool=String(body.tool||'').trim(), q=String(body.query||'').trim(); if(!tool||!q)throw new AppError('INVALID_QUERY',400); if(q.length>500)throw new AppError('QUERY_TOO_LONG',400);
  const slug=slugify(tool); if(SENSITIVE_TOOLS.has(slug)&&body.authorized!==true)throw new AppError('AUTHORIZATION_CONFIRMATION_REQUIRED',403);
  const cfg=await dbGet(`apiConfigs/${slug}`,env); if(!cfg?.enabled)throw new AppError('API_NOT_CONFIGURED',404);
  const premiumNow=await isPremium(user.uid,env); if(cfg.premiumOnly&&!premiumNow)throw new AppError('PREMIUM_REQUIRED',403);
  const cost=safeInt(cfg.cost,0,10000); let charged=false;
  try{
    if(cost>0){await adjustCredits(user.uid,-cost,env);charged=true;}
    const data=await providerCall(cfg,q);
    await addHistory(user.uid,tool,`${charged?cost:0} credit(s) · success`,env);
    return {success:true,data,charged:charged?cost:0,premium:premiumNow};
  }catch(e){
    if(charged){try{await adjustCredits(user.uid,cost,env);}catch(refundErr){console.error('refund failed',refundErr);}}
    await addHistory(user.uid,tool,'request failed; any charged credits were refunded',env);
    throw e;
  }
}
async function adminTestApi(user,body,env){await requireAdmin(user,env);const cfg=body.config||{};const q=String(body.query||'').trim();if(!cfg.endpoint||!q)throw new AppError('INVALID_QUERY',400);const data=await providerCall(cfg,q);return{success:true,data};}

// -------- Real credits actions --------
async function dailyClaim(user,env){
  const credits=safeInt(env.DAILY_CLAIM_CREDITS||5,1,1000), day=utcDay();
  await etagUpdate(`claims/${user.uid}/${day}`,env,current=>{if(current)throw new AppError('ALREADY_CLAIMED',409);return{credits,claimedAt:Date.now()};});
  await adjustCredits(user.uid,credits,env); await addHistory(user.uid,'DAILY CLAIM',`+${credits} credits`,env); return{success:true,creditsAdded:credits};
}
function randomChoice(arr){const x=new Uint32Array(1);crypto.getRandomValues(x);return arr[x[0]%arr.length];}
async function redeem(user,body,env){
  const code=String(body.code||'').trim().toUpperCase(); if(!/^[A-Z0-9_-]{3,32}$/.test(code))throw new AppError('INVALID_REDEEM_CODE',400);
  const markerPath=`redeemed/${user.uid}/${code}`;
  await etagUpdate(markerPath,env,current=>{if(current)throw new AppError('REDEEM_ALREADY_USED',409);return{reservedAt:Date.now()};});
  let credits=0;
  try{
    const tx=await etagUpdate(`redeemCodes/${code}`,env,current=>{
      if(!current?.enabled)throw new AppError('INVALID_REDEEM_CODE',404); const uses=safeInt(current.uses,0,100000000), max=safeInt(current.maxUses,1,100000000); if(uses>=max)throw new AppError('REDEEM_LIMIT_REACHED',409); credits=safeInt(current.credits,1,1000000); return{...current,uses:uses+1,lastUsedAt:Date.now()};
    });
    credits=safeInt(tx.value.credits,1,1000000); await adjustCredits(user.uid,credits,env); await dbSet(markerPath,{credits,redeemedAt:Date.now()},env); await addHistory(user.uid,'REDEEM CODE',`+${credits} credits`,env); return{success:true,creditsAdded:credits};
  }catch(e){try{await dbDelete(markerPath,env);}catch{}throw e;}
}


// -------- Direct UPI / QR payments (manual bank verification) --------
const DIRECT_UPI_ID='t7x@axl';
function validPaymentId(v){return /^[A-Za-z0-9_-]{3,80}$/.test(String(v||''));}
function normalizeUtr(v){const x=String(v||'').trim().toUpperCase();if(!/^[A-Z0-9_-]{6,40}$/.test(x))throw new AppError('INVALID_UTR',400,'Enter a valid UTR / transaction ID');return x;}
function maskedUtr(utr){return utr.length<=6?'••••'+utr.slice(-2):`${utr.slice(0,3)}••••${utr.slice(-4)}`;}
async function submitUpiPayment(user,body,env){
  const enabled=await dbGet('system/paymentsEnabled',env); if(enabled!==true)throw new AppError('PAYMENTS_DISABLED',403);
  const itemId=String(body.itemId||'').trim(); if(!/^[a-zA-Z0-9_-]{3,40}$/.test(itemId))throw new AppError('INVALID_PRODUCT',400);
  const utr=normalizeUtr(body.utr); const item=await dbGet(`billingCatalog/${itemId}`,env); if(!item?.enabled)throw new AppError('INVALID_PRODUCT',404);
  const amount=safeInt(item.amountPaise,0,100000000); if(amount<100)throw new AppError('INVALID_PRODUCT_PRICE',400);
  const utrKey=utr;
  await etagUpdate(`manualPaymentUtr/${utrKey}`,env,current=>{if(current)throw new AppError('UTR_ALREADY_SUBMITTED',409,'This UTR has already been submitted');return{uid:user.uid,createdAt:Date.now(),status:'reserved'};});
  const random=new Uint32Array(1);crypto.getRandomValues(random); const id=`UPI_${Date.now()}_${random[0].toString(36)}`;
  const record={id,uid:user.uid,email:user.email||'',itemId,label:String(item.label||itemId).slice(0,100),type:item.type,amountPaise:amount,currency:'INR',credits:safeInt(item.credits,0,100000000),days:safeInt(item.days,0,36500),upiId:DIRECT_UPI_ID,utr,utrMasked:maskedUtr(utr),status:'pending',createdAt:Date.now()};
  try{await dbSet(`manualPayments/${user.uid}/${id}`,record,env);await dbSet(`manualPaymentIndex/${id}`,user.uid,env);await dbPatch(`manualPaymentUtr/${utrKey}`,{paymentId:id,status:'pending'},env);await addHistory(user.uid,'UPI PAYMENT SUBMITTED',`${record.label} · ${moneyText(amount)} · pending verification`,env);return{success:true,paymentId:id,status:'pending',message:'Payment submitted for admin verification'};}
  catch(e){try{await dbDelete(`manualPaymentUtr/${utrKey}`,env);}catch{}throw e;}
}
async function adminUpiPayments(user,env){
  await requireAdmin(user,env); const all=await dbGet('manualPayments',env)||{}; const payments=[];
  for(const [uid,rows] of Object.entries(all)){for(const [id,r] of Object.entries(rows||{})){payments.push({...r,id:r.id||id,uid:r.uid||uid});}}
  payments.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)); return{success:true,payments:payments.slice(0,200)};
}
async function adminReviewUpiPayment(user,body,env){
  await requireAdmin(user,env); const uid=String(body.uid||''), paymentId=String(body.paymentId||''), action=String(body.action||'');
  if(!uid||!validPaymentId(paymentId)||!['approve','reject'].includes(action))throw new AppError('INVALID_REVIEW_REQUEST',400);
  const path=`manualPayments/${uid}/${paymentId}`; let rec=await dbGet(path,env); if(!rec)throw new AppError('PAYMENT_NOT_FOUND',404);
  if(action==='reject'){
    if(rec.status==='approved')throw new AppError('PAYMENT_ALREADY_APPROVED',409);
    if(rec.status==='rejected')return{success:true,status:'rejected',alreadyProcessed:true};
    await dbPatch(path,{status:'rejected',reviewedAt:Date.now(),reviewedBy:user.uid},env);await dbPatch(`manualPaymentUtr/${rec.utr}`,{status:'rejected',reviewedAt:Date.now()},env);await addHistory(uid,'UPI PAYMENT REJECTED',`${rec.label} · ${moneyText(rec.amountPaise)}`,env);return{success:true,status:'rejected'};
  }
  const claim=await etagUpdate(path,env,current=>{if(!current)throw new AppError('PAYMENT_NOT_FOUND',404);if(current.status==='approved')return undefined;if(current.status!=='pending')throw new AppError('PAYMENT_NOT_PENDING',409);return{...current,status:'processing',processingAt:Date.now(),reviewedBy:user.uid};});
  if(!claim.changed){rec=claim.value;return{success:true,alreadyProcessed:true,status:'approved',type:rec.type,creditsAdded:rec.fulfilledCredits||0,daysAdded:rec.fulfilledDays||0};}
  rec=claim.value;
  try{
    if(rec.type==='credits'){
      const credits=safeInt(rec.credits,1,100000000);await adjustCredits(uid,credits,env);await dbPatch(path,{status:'approved',approvedAt:Date.now(),fulfilledCredits:credits},env);await dbPatch(`manualPaymentUtr/${rec.utr}`,{status:'approved',approvedAt:Date.now()},env);await addHistory(uid,'UPI CREDITS PURCHASE',`+${credits} credits · ${moneyText(rec.amountPaise)}`,env);return{success:true,status:'approved',type:'credits',creditsAdded:credits,daysAdded:0};
    }
    if(rec.type==='premium'){
      const days=safeInt(rec.days,1,36500), old=await dbGet(`premium/${uid}`,env);const start=Math.max(Date.now(),Number(old?.expiresAt||0)),expiresAt=start+days*86400000;await dbSet(`premium/${uid}`,{active:true,planId:rec.itemId,purchasedAt:Date.now(),expiresAt,paymentId,method:'UPI'},env);await dbPatch(path,{status:'approved',approvedAt:Date.now(),fulfilledDays:days},env);await dbPatch(`manualPaymentUtr/${rec.utr}`,{status:'approved',approvedAt:Date.now()},env);await addHistory(uid,'UPI PREMIUM PURCHASE',`${days} days · ${moneyText(rec.amountPaise)}`,env);return{success:true,status:'approved',type:'premium',creditsAdded:0,daysAdded:days,expiresAt};
    }
    throw new AppError('INVALID_PRODUCT_TYPE',500);
  }catch(e){await dbPatch(path,{status:'pending',processingErrorAt:Date.now()},env);throw e;}
}

// -------- Razorpay --------
function razorAuth(env){if(!env.RAZORPAY_KEY_ID||!env.RAZORPAY_KEY_SECRET)throw new AppError('RAZORPAY_NOT_CONFIGURED',500,'Add Razorpay secrets in Render Environment');return `Basic ${btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`)}`;}
async function razorFetch(path,env,opts={}){const r=await fetch(`https://api.razorpay.com/v1${path}`,{...opts,headers:{Authorization:razorAuth(env),'Content-Type':'application/json',...(opts.headers||{})}});const text=await r.text();let data;try{data=JSON.parse(text);}catch{data={raw:text};}if(!r.ok){console.error('Razorpay',r.status,data);throw new AppError('RAZORPAY_API_ERROR',502,`Razorpay API returned HTTP ${r.status}`);}return data;}
async function createOrder(user,body,env){
  const enabled=await dbGet('system/paymentsEnabled',env); if(enabled!==true)throw new AppError('PAYMENTS_DISABLED',403);
  const itemId=String(body.itemId||'').trim(); if(!/^[a-zA-Z0-9_-]{3,40}$/.test(itemId))throw new AppError('INVALID_PRODUCT',400);
  const item=await dbGet(`billingCatalog/${itemId}`,env); if(!item?.enabled)throw new AppError('INVALID_PRODUCT',404);
  const amount=safeInt(item.amountPaise,0,100000000); if(amount<100)throw new AppError('INVALID_PRODUCT_PRICE',400);
  const receipt=`A7_${user.uid.slice(0,8)}_${Date.now()}`.slice(0,40);
  const order=await razorFetch('/orders',env,{method:'POST',body:JSON.stringify({amount,currency:item.currency||'INR',receipt,notes:{uid:user.uid,itemId}})});
  const record={uid:user.uid,itemId,label:String(item.label||itemId).slice(0,100),type:item.type,amountPaise:amount,currency:item.currency||'INR',credits:safeInt(item.credits,0,100000000),days:safeInt(item.days,0,36500),razorpayOrderId:order.id,status:'created',createdAt:Date.now()};
  await dbSet(`orders/${user.uid}/${order.id}`,record,env); await dbSet(`orderIndex/${order.id}`,user.uid,env);
  return{success:true,keyId:env.RAZORPAY_KEY_ID,order:{id:order.id,amount:order.amount,currency:order.currency},item:{label:record.label,type:record.type,credits:record.credits,days:record.days}};
}
function bytesToHex(buf){return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');}
function timingSafeHex(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0;}
async function hmacHex(secret,data){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return bytesToHex(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(data)));}
async function verifyPayment(user,body,env){
  const orderId=String(body.razorpay_order_id||''), paymentId=String(body.razorpay_payment_id||''), sig=String(body.razorpay_signature||''); if(!orderId||!paymentId||!sig)throw new AppError('INVALID_PAYMENT_RESPONSE',400);
  const order=await dbGet(`orders/${user.uid}/${orderId}`,env); if(!order||order.razorpayOrderId!==orderId)throw new AppError('ORDER_NOT_FOUND',404);
  const expected=await hmacHex(env.RAZORPAY_KEY_SECRET,`${order.razorpayOrderId}|${paymentId}`); if(!timingSafeHex(expected,sig))throw new AppError('PAYMENT_SIGNATURE_INVALID',400);
  return fulfillOrder(user.uid,orderId,paymentId,env,'checkout');
}
async function fulfillOrder(uid,orderId,paymentId,env,source){
  const path=`orders/${uid}/${orderId}`; let existing=await dbGet(path,env); if(!existing)throw new AppError('ORDER_NOT_FOUND',404);
  if(existing.status==='paid')return{success:true,alreadyProcessed:true,type:existing.type,creditsAdded:existing.credits||0,daysAdded:existing.days||0};
  const payment=await razorFetch(`/payments/${encodeURIComponent(paymentId)}`,env); if(payment.order_id!==existing.razorpayOrderId||Number(payment.amount)!==Number(existing.amountPaise))throw new AppError('PAYMENT_MISMATCH',400); if(payment.status!=='captured')throw new AppError('PAYMENT_NOT_CAPTURED',409,'Payment is not captured yet; retry after capture or use webhook');
  const claim=await etagUpdate(path,env,current=>{if(!current)throw new AppError('ORDER_NOT_FOUND',404);if(current.status==='paid')return undefined;if(current.status==='processing')throw new AppError('PAYMENT_PROCESSING',409);return{...current,status:'processing',processingAt:Date.now(),paymentId,source};});
  if(!claim.changed){existing=claim.value;return{success:true,alreadyProcessed:true,type:existing.type,creditsAdded:existing.credits||0,daysAdded:existing.days||0};}
  existing=claim.value;
  try{
    if(existing.type==='credits'){
      const credits=safeInt(existing.credits,1,100000000); await adjustCredits(uid,credits,env); await dbPatch(path,{status:'paid',paidAt:Date.now(),paymentId,fulfilledCredits:credits},env); await addHistory(uid,'CREDITS PURCHASE',`+${credits} credits · ${moneyText(existing.amountPaise)}`,env); return{success:true,type:'credits',creditsAdded:credits,daysAdded:0};
    }
    if(existing.type==='premium'){
      const days=safeInt(existing.days,1,36500); const old=await dbGet(`premium/${uid}`,env); const start=Math.max(Date.now(),Number(old?.expiresAt||0)); const expiresAt=start+days*86400000; await dbSet(`premium/${uid}`,{active:true,planId:existing.itemId,purchasedAt:Date.now(),expiresAt,orderId},env); await dbPatch(path,{status:'paid',paidAt:Date.now(),paymentId,fulfilledDays:days},env); await addHistory(uid,'PREMIUM PURCHASE',`${days} days · ${moneyText(existing.amountPaise)}`,env); return{success:true,type:'premium',creditsAdded:0,daysAdded:days,expiresAt};
    }
    throw new AppError('INVALID_PRODUCT_TYPE',500);
  }catch(e){console.error('Fulfillment failed',uid,orderId,e);await dbPatch(path,{status:'processing_error',errorAt:Date.now()},env);throw e;}
}
function moneyText(paise){return `INR ${(Number(paise||0)/100).toFixed(2)}`;}

async function handleWebhook(request,env){
  const raw=await request.text(); const sig=request.headers.get('X-Razorpay-Signature')||''; if(!env.RAZORPAY_WEBHOOK_SECRET)throw new AppError('WEBHOOK_NOT_CONFIGURED',500);
  const expected=await hmacHex(env.RAZORPAY_WEBHOOK_SECRET,raw); if(!timingSafeHex(expected,sig))throw new AppError('WEBHOOK_SIGNATURE_INVALID',401);
  let event;try{event=JSON.parse(raw);}catch{throw new AppError('INVALID_JSON',400);}
  if(event.event!=='payment.captured')return json(request,env,{success:true,ignored:true});
  const p=event.payload?.payment?.entity, orderId=p?.order_id, paymentId=p?.id; if(!orderId||!paymentId)return json(request,env,{success:true,ignored:true});
  const uid=await dbGet(`orderIndex/${orderId}`,env); if(!uid)return json(request,env,{success:true,ignored:true});
  try{const result=await fulfillOrder(uid,orderId,paymentId,env,'webhook');return json(request,env,result);}catch(e){if(e.code==='PAYMENT_PROCESSING')return json(request,env,{success:true,processing:true});throw e;}
}
