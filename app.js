import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
  GoogleAuthProvider, signInWithPopup
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {
  getDatabase, ref, set, get, update, remove, onValue,
  query, orderByChild, limitToLast
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js';

const CFG = window.A7_CONFIG;
if (!CFG?.firebase) throw new Error('Missing window.A7_CONFIG.firebase');

const app = initializeApp(CFG.firebase);
const auth = getAuth(app);
const db = getDatabase(app);

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (v='') => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const slugify = (v='') => String(v).toLowerCase().replace(/→/g,' to ').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const money = paise => `₹${(Number(paise||0)/100).toFixed(2)}`;
const dateText = ms => ms ? new Date(ms).toLocaleString() : '—';
const now = () => Date.now();

const pages = [
  [
    ['NUMBER INFO','☎','Basic phone-number metadata','public'],['VEHICLE INFO','▣','Vehicle information via authorized provider','sensitive'],['USERNAME INFO','@','Check public username presence','public'],['TG ID INFO','✈','Telegram public ID/username info','public'],['NAME INFO','Aa','Public-name search placeholder','sensitive'],['UPI INFO','₹','Verify your own/authorized UPI details','sensitive'],['AADHAAR INFO','▦','Consent-based identity verification only','sensitive'],['FAMILY INFO','♧','Authorized family-record workflow only','sensitive']
  ],
  [
    ['VEHICLE INFO','▣','Vehicle data from authorized source','sensitive'],['VEHICLE → NUMBER','⇄','Authorized vehicle-to-contact workflow','sensitive'],['IFSC INFO','⌁','Public bank branch/IFSC lookup','public'],['PAN INFO','P','Consent-based PAN verification','sensitive'],['PAN TO GST','⇢','Authorized business-tax mapping','sensitive'],['GST INFO','G','Public GST/business verification','public'],['IP INFO','◉','IP geolocation/network metadata','public'],['VOTER ID INFO','V','Consent-based voter ID verification','sensitive']
  ],
  [
    ['EMAIL INFO','✉','Public email-domain metadata','public'],['ATM BANK ACCOUNT','▤','Your own authorized banking workflow','sensitive'],['PAYTM INFO','₹','Authorized wallet verification','sensitive'],['NUM TO BANK INFO','⇢','Restricted banking lookup placeholder','sensitive'],['DAILY CLAIM','✓','Claim the server-side daily credit bonus','action'],['REDEEM CODE','⌘','Redeem an admin-created credit code','action'],['BALANCE','◆','View current Firebase credit balance','action']
  ],
  [
    ['BUY CREDITS','◆','Purchase usage credits','nav'],['ADD MONEY','＋','Open payment products','nav'],['PREMIUM','★','View premium membership','nav'],['PURCHASE PREMIUM','★','Purchase an enabled premium plan','nav'],['PROTECT MY SELF','盾','Security and privacy guidance','nav'],['REFERRALS','♙','Referral system placeholder','action'],['CLONE BOT','⧉','Helper-bot template placeholder','action'],['MY BOTS','⚙','Bot integrations placeholder','action'],['INFO BOT','i','Info assistant placeholder','action'],['MY HISTORY','◷','View server activity','nav'],['CHANNELS','#','Official channels and updates','nav'],['API','⌁','Admin-managed backend APIs','nav'],['$ PRICE LIST','$','Pricing and credits','nav'],['DISCLAIMER','!','Legal and usage disclaimer','nav'],['HELP','?','Help center','nav'],['SUPPORT','☏','Support information','nav'],['BACK HOME','⌂','Return to dashboard','nav']
  ]
];

let currentPage = 0;
let currentTool = null;
let currentUser = null;
let profile = null;
let wallet = { credits: 0 };
let premium = null;
let isAdmin = false;
let adminUid = null;
let paymentsEnabled = false;
let billingCatalog = {};
let liveUnsubs = [];

function allTools(){ return pages.flat(); }
function uniqueToolNames(){ return [...new Set(allTools().filter(t=>!['nav','action'].includes(t[3])).map(t=>t[0]))]; }
function toast(msg, ms=2200){ const t=$('#toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),ms); }
function authStatus(msg,type='bad'){ const el=$('#authStatus'); el.textContent=msg; el.className=`status-box ${type}`; }
function clearAuthStatus(){ $('#authStatus').className='status-box hidden'; $('#authStatus').textContent=''; }
function setLoading(btn, state, text='Working…'){ if(!btn)return; if(state){btn.dataset.old=btn.innerHTML;btn.disabled=true;btn.textContent=text;}else{btn.disabled=false;btn.innerHTML=btn.dataset.old||btn.innerHTML;} }
function premiumActive(){ return !!(premium?.active && Number(premium.expiresAt||0) > now()); }
function roleName(){ return isAdmin ? 'ADMIN' : 'USER'; }

function renderTools(filter=''){
  const grid=$('#toolsGrid'); grid.innerHTML='';
  const source=pages[currentPage].filter(t=>t[0].toLowerCase().includes(filter.toLowerCase()));
  source.forEach(tool=>{
    const [name,icon,desc,type]=tool;
    const el=document.createElement('article'); el.className='tool-card';
    const tag = type==='sensitive' ? 'AUTH' : type==='action' ? 'ACTION' : type==='nav' ? 'OPEN' : 'READY';
    el.innerHTML=`<span class="tag">${tag}</span><div class="tool-icon">${icon}</div><h3>${esc(name)}</h3><p>${esc(desc)}</p>`;
    el.onclick=()=>handleTool(tool); grid.appendChild(el);
  });
  $('#pageNum').textContent=currentPage+1; $('#prevBtn').disabled=currentPage===0; $('#nextBtn').disabled=currentPage===pages.length-1;
  $('#dots').innerHTML=pages.map((_,i)=>`<span class="dot ${i===currentPage?'active':''}"></span>`).join('');
}

function showView(id){
  if(id==='admin' && !isAdmin){ toast('Admin access required'); return; }
  $$('.view').forEach(v=>v.classList.remove('active-view'));
  $('#'+id)?.classList.add('active-view');
  $$('[data-go]').forEach(b=>b.classList.toggle('active',b.dataset.go===id));
  if(id==='history') loadHistory();
  if(id==='premium') loadMyUpiPayments();
  if(id==='admin' && isAdmin){ loadAdminAll(); }
}

function inputLabel(name){
  if(name.includes('NUMBER')||name.includes('NUM ')) return 'Enter number';
  if(name.includes('EMAIL')) return 'Enter email';
  if(name.includes('IP')) return 'Enter IP address';
  if(name.includes('IFSC')) return 'Enter IFSC code';
  if(name.includes('USERNAME')||name.includes('TG')) return 'Enter username / ID';
  if(name.includes('VEHICLE')) return 'Enter vehicle number';
  if(name.includes('GST')) return 'Enter GSTIN';
  if(name.includes('PAN')) return 'Enter PAN';
  return 'Enter value';
}

function handleTool(tool){
  const [name,icon,desc,type]=tool;
  if(type==='nav'){
    if(['BUY CREDITS','ADD MONEY','PREMIUM','PURCHASE PREMIUM','$ PRICE LIST'].includes(name)) return showView('premium');
    if(name==='MY HISTORY') return showView('history');
    if(name==='API') return isAdmin ? showView('admin') : toast('API Manager is admin-only');
    if(['PROTECT MY SELF','DISCLAIMER','HELP','SUPPORT','CHANNELS'].includes(name)) return showView('support');
    if(name==='BACK HOME') return showView('home');
  }
  if(type==='action') return runAction(name);
  currentTool=tool;
  $('#modalIcon').textContent=icon; $('#modalTitle').textContent=name; $('#modalDesc').textContent=desc;
  $('#sensitiveNotice').classList.toggle('hidden',type!=='sensitive');
  $('#consentCheck').checked=false; $('#toolQuery').value=''; $('#resultBox').classList.add('hidden'); lastResultPayload=null;
  $('#queryLabel').childNodes[0].nodeValue=inputLabel(name)+' ';
  $('#toolQuery').placeholder=inputLabel(name);
  $('#toolPolicy').textContent='Credits / premium requirements are enforced by the backend.';
  $('#toolModal').classList.remove('hidden');
}

async function backendRequest(path, body={}){
  if(!currentUser) throw new Error('NOT_LOGGED_IN');
  const base=String(CFG.backendBase||'').replace(/\/$/,'');
  if(!base || base.includes('YOUR-A7-BACKEND')) throw new Error('BACKEND_NOT_CONFIGURED');
  const token=await currentUser.getIdToken();
  const res=await fetch(base+path,{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},
    body:JSON.stringify(body)
  });
  let data={}; try{data=await res.json();}catch{data={success:false,error:`HTTP_${res.status}`};}
  if(!res.ok || data.success===false){ const e=new Error(data.error||`HTTP_${res.status}`); e.data=data; throw e; }
  return data;
}

async function runAction(name){
  try{
    if(name==='BALANCE') return toast(`Balance: ${Number(wallet.credits||0)} credits`);
    if(name==='DAILY CLAIM'){
      toast('Claiming…'); const r=await backendRequest('/daily-claim'); toast(`+${r.creditsAdded} credits claimed`); return;
    }
    if(name==='REDEEM CODE') return openRedeemModal();
    toast(`${name}: feature backend not configured yet`);
  }catch(e){ showBackendError(e); }
}

function showBackendError(e){
  const map={
    BACKEND_NOT_CONFIGURED:'Cloudflare backend URL is not configured in config.js.',
    ALREADY_CLAIMED:'Daily claim already used today.',
    INSUFFICIENT_CREDITS:'Not enough credits.',
    PREMIUM_REQUIRED:'This tool requires an active premium plan.',
    API_NOT_CONFIGURED:'Admin has not configured an enabled API for this tool.',
    PAYMENTS_DISABLED:'Payments are disabled by the admin.',
    INVALID_REDEEM_CODE:'Invalid or disabled redeem code.',
    REDEEM_ALREADY_USED:'You already used this redeem code.',
    REDEEM_LIMIT_REACHED:'This redeem code reached its usage limit.'
  };
  toast(map[e.message]||e.data?.message||`Error: ${e.message}`,3500);
}

let lastResultPayload = null;

const resultIconMap = {
  name:'👤', fullname:'👤', father:'😊', fathername:'😊', mobile:'📱', number:'📱', phone:'📱',
  alt:'📞', alternate:'📞', alternatenumber:'📞', address:'🏠', location:'📍', city:'🏙️', state:'🗺️',
  pincode:'📮', pin:'📮', circle:'📡', operator:'📡', network:'📡', email:'✉️', username:'@', userid:'🆔', id:'🆔',
  vehicle:'🚘', vehiclenumber:'🚘', registration:'🪪', owner:'👤', model:'🚗', maker:'🏭', fuel:'⛽',
  ifsc:'🏦', bank:'🏦', branch:'🏛️', account:'💳', upi:'₹', pan:'🪪', gst:'🏢', gstin:'🏢', ip:'🌐',
  country:'🌍', status:'✅', date:'🕐', time:'🕐', created:'🕐', updated:'🕐', credits:'💰', balance:'💰',
  premium:'👑', total:'📊', records:'📊', message:'💬', error:'⚠️', success:'✅', type:'🏷️'
};
function normalizeKey(k=''){ return String(k).toLowerCase().replace(/[^a-z0-9]/g,''); }
function iconForKey(k=''){
  const n=normalizeKey(k);
  if(resultIconMap[n]) return resultIconMap[n];
  for(const [key,icon] of Object.entries(resultIconMap)) if(n.includes(key)) return icon;
  return '🔹';
}
function labelKey(k=''){ return String(k).replace(/[_-]+/g,' ').replace(/([a-z])([A-Z])/g,'$1 $2').trim().toUpperCase(); }
function safeScalar(v){
  if(v===null) return 'null'; if(v===undefined) return '—'; if(typeof v==='boolean') return v?'YES':'NO';
  return String(v).replace(/!!+/g,' • ').replace(/\s*\n\s*/g,' / ').trim();
}
function recordLines(obj,prefix='├'){
  if(obj===null || typeof obj!=='object') return [`${prefix}🔹 VALUE: ${safeScalar(obj)}`];
  const lines=[];
  for(const [k,v] of Object.entries(obj)){
    const icon=iconForKey(k), label=labelKey(k);
    if(Array.isArray(v)){
      if(v.every(x=>x===null || typeof x!=='object')) lines.push(`${prefix}${icon} ${label}: ${v.map(safeScalar).join(', ')}`);
      else {
        lines.push(`${prefix}${icon} ${label}: ${v.length} ITEM(S)`);
        v.forEach((item,i)=>{ lines.push(`│  ├📄 ${label} ${i+1}`); recordLines(item,'│  │  ├').forEach(x=>lines.push(x)); });
      }
    } else if(v && typeof v==='object'){
      lines.push(`${prefix}${icon} ${label}:`);
      recordLines(v,'│  ├').forEach(x=>lines.push(x));
    } else lines.push(`${prefix}${icon} ${label}: ${safeScalar(v)}`);
  }
  return lines;
}
function findRecordArray(data){
  if(Array.isArray(data)) return data;
  if(!data || typeof data!=='object') return null;
  const preferred=['records','data','results','result','items','list'];
  for(const key of preferred) if(Array.isArray(data[key])) return data[key];
  for(const v of Object.values(data)) if(Array.isArray(v) && v.length && v.every(x=>x && typeof x==='object')) return v;
  return null;
}
function formatResultText(tool,payload){
  const data=payload?.data ?? payload;
  const line='🚥🚥🚥🚥🚥🚥🚥🚥';
  const out=[`📋 ${String(tool||'TOOL').toUpperCase()}`,line,`🕐 ${new Date().toLocaleString()}`];
  if(payload?.query) out.push(`🔎 QUERY: ${safeScalar(payload.query)}`);
  const records=findRecordArray(data);
  if(records){
    out.push(`📊 TOTAL RECORDS: ${records.length}`,line);
    records.forEach((rec,i)=>{
      out.push(`👤 RECORD ${i+1}/${records.length}`);
      recordLines(rec).forEach(x=>out.push(x));
      if(i<records.length-1) out.push('');
    });
  } else if(data && typeof data==='object'){
    recordLines(data).forEach(x=>out.push(x));
  } else if(typeof data==='string'){
    const text=data.trim();
    if(text.startsWith('{')||text.startsWith('[')){
      try{return formatResultText(tool,{data:JSON.parse(text)});}catch{}
    }
    text.split(/\r?\n/).filter(Boolean).forEach(x=>out.push(`🔹 ${x}`));
  } else out.push(`🔹 RESULT: ${safeScalar(data)}`);
  if(payload?.charged!==undefined) out.push('',`💰 CREDITS USED: ${payload.charged||0}`);
  if(payload?.premium) out.push('👑 PREMIUM: ACTIVE');
  return out.join('\n');
}
function showFormattedResult(tool,payload,query=''){
  lastResultPayload={status:'success',tool,query,charged:payload?.charged||0,premium:!!payload?.premium,data:payload?.data ?? payload};
  $('#resultText').textContent=formatResultText(tool,lastResultPayload);
}
function showFormattedError(tool,e){
  lastResultPayload={status:'error',tool,error:e.message,message:e.data?.message||null};
  $('#resultText').textContent=`📋 ${String(tool||'TOOL').toUpperCase()}\n🚥🚥🚥🚥🚥🚥🚥🚥\n⚠️ STATUS: ERROR\n🔹 ERROR: ${e.message}\n💬 MESSAGE: ${e.data?.message||'Request failed'}`;
}
function downloadCurrentJson(){
  if(!lastResultPayload) return toast('No result to download');
  const blob=new Blob([JSON.stringify(lastResultPayload,null,2)],{type:'application/json;charset=utf-8'});
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download=`${slugify(lastResultPayload.tool||'a7-result')}-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000); toast('JSON downloaded');
}

$('#runTool').onclick=async()=>{
  const q=$('#toolQuery').value.trim(); if(!q)return toast('Please enter a value');
  const [name,,,type]=currentTool;
  if(type==='sensitive' && !$('#consentCheck').checked) return toast('Authorization confirmation is required');
  const btn=$('#runTool');
  try{
    setLoading(btn,true,'Running…'); $('#resultBox').classList.remove('hidden'); $('#resultText').textContent='Secure backend request in progress…';
    const r=await backendRequest('/tool-query',{tool:name,query:q,authorized:type==='sensitive'?true:undefined});
    showFormattedResult(name,r,q);
    toast(r.charged ? `${r.charged} credit(s) used` : 'Lookup complete');
  }catch(e){
    $('#resultBox').classList.remove('hidden');
    showFormattedError(name,e);
    showBackendError(e);
  }finally{setLoading(btn,false);}
};

function openRedeemModal(){
  $('#actionTitle').textContent='Redeem Code'; $('#actionDesc').textContent='Enter an active code created by the admin.';
  $('#actionBody').innerHTML=`<div class="action-stack"><input id="redeemUserCode" maxlength="32" placeholder="A7BONUS"><button id="redeemUserBtn" class="primary">Redeem</button><div id="redeemUserResult" class="action-result hidden"></div></div>`;
  $('#actionModal').classList.remove('hidden');
  $('#redeemUserBtn').onclick=async()=>{
    const code=$('#redeemUserCode').value.trim().toUpperCase(); if(!code)return toast('Enter a code');
    const b=$('#redeemUserBtn'); try{setLoading(b,true,'Checking…');const r=await backendRequest('/redeem',{code});$('#redeemUserResult').classList.remove('hidden');$('#redeemUserResult').textContent=`Success: +${r.creditsAdded} credits`;toast(`+${r.creditsAdded} credits`);}catch(e){showBackendError(e);}finally{setLoading(b,false);}
  };
}

function renderAccount(){
  const credits=Number(wallet?.credits||0);
  const active=premiumActive();
  $('#topBalance').textContent=credits; $('#sideBalance').textContent=credits; $('#balanceHero').textContent=credits; $('#walletCredits').textContent=credits;
  $('#premiumHero').textContent=active?'PRO':'FREE'; $('#walletPlan').textContent=active?'Premium':'Free';
  $('#premiumUntil').textContent=active?dateText(premium.expiresAt):'—';
  $('#sidePremium').textContent=active?'PREMIUM':'FREE'; $('#sidePremium').classList.toggle('active',active);
  $('#roleBadge').textContent=roleName(); $('#roleBadge').classList.toggle('admin',isAdmin);
  $('#profileRole').value=roleName();
  $$('.admin-only').forEach(el=>el.classList.toggle('hidden',!isAdmin));
}

function renderProfile(){
  if(!currentUser)return;
  $('#profileName').value=profile?.name||currentUser.displayName||'';
  $('#profileEmail').value=currentUser.email||profile?.email||'';
  $('#profileUid').value=currentUser.uid;
  $('#profileRole').value=roleName();
  const initial=(profile?.name||currentUser.email||'A').trim()[0]?.toUpperCase()||'A';
  $('#avatarBtn').textContent=initial;
}

function cleanupLive(){ liveUnsubs.forEach(fn=>{try{fn();}catch{}}); liveUnsubs=[]; }
function subscribeUserData(user){
  cleanupLive();
  liveUnsubs.push(onValue(ref(db,`profiles/${user.uid}`),snap=>{profile=snap.val()||{email:user.email,name:''};renderProfile();}));
  liveUnsubs.push(onValue(ref(db,`wallets/${user.uid}`),snap=>{wallet=snap.val()||{credits:0};renderAccount();}));
  liveUnsubs.push(onValue(ref(db,`premium/${user.uid}`),snap=>{premium=snap.val();renderAccount();}));
  liveUnsubs.push(onValue(ref(db,'system/adminUid'),snap=>{adminUid=snap.val();isAdmin=adminUid===user.uid;renderAccount(); if(isAdmin){ seedNumberApiIfNeeded(); seedBillingCatalogIfNeeded(); }}));
  liveUnsubs.push(onValue(ref(db,'system/paymentsEnabled'),snap=>{paymentsEnabled=snap.val()===true;renderPaymentState();}));
  liveUnsubs.push(onValue(ref(db,'billingCatalog'),snap=>{billingCatalog=snap.val()||{};renderCatalog(); if(isAdmin)renderBillingRecords();}));
}

function renderPaymentState(){
  const el=$('#paymentsState'); if(!el)return;
  el.textContent=paymentsEnabled?'Payments enabled':'Payments disabled'; el.className=`status-pill ${paymentsEnabled?'on':'off'}`;
  if($('#paymentsEnabledToggle')) $('#paymentsEnabledToggle').checked=paymentsEnabled;
  renderCatalog();
}

function renderCatalog(){
  const box=$('#catalogGrid'); if(!box)return;
  const items=Object.entries(billingCatalog||{}).filter(([,v])=>v?.enabled).sort((a,b)=>(a[1].amountPaise||0)-(b[1].amountPaise||0));
  if(!items.length){box.innerHTML='<p class="muted">No enabled products yet. Admin can add credit or premium products.</p>';return;}
  box.innerHTML=items.map(([id,p])=>{
    const meta=p.type==='credits'?`${Number(p.credits||0)} credits`:`${Number(p.days||0)} days premium`;
    const perDay=p.type==='premium'&&Number(p.days)>0?`<small>₹${((Number(p.amountPaise||0)/100)/Number(p.days)).toFixed(1)}/day</small>`:'';
    return `<article class="${p.type==='premium'?'featured':''}"><span>${p.type==='premium'?'💎 PREMIUM':'🛒 CREDITS'}</span><h3>${esc(p.label||id)}</h3><div class="price">${money(p.amountPaise)}</div>${perDay}<p class="meta">${esc(meta)}</p><div class="pay-actions"><button class="primary upi-buy" data-product="${esc(id)}" ${paymentsEnabled?'':'disabled'}>${paymentsEnabled?'Pay UPI / QR':'Payments Disabled'}</button><button class="secondary buy-product" data-product="${esc(id)}" ${paymentsEnabled?'':'disabled'}>${paymentsEnabled?'Razorpay':'Disabled'}</button></div></article>`;
  }).join('');
  $$('.buy-product').forEach(b=>b.onclick=()=>purchaseProduct(b.dataset.product,b));
  $$('.upi-buy').forEach(b=>b.onclick=()=>openUpiPayment(b.dataset.product));
}
async function purchaseProduct(itemId,btn){
  const item=billingCatalog[itemId]; if(!item)return toast('Product not found');
  if(!paymentsEnabled)return toast('Payments are disabled');
  if(!window.Razorpay)return toast('Razorpay Checkout failed to load');
  try{
    setLoading(btn,true,'Creating order…');
    const r=await backendRequest('/create-order',{itemId});
    const rz=new window.Razorpay({
      key:r.keyId, amount:r.order.amount, currency:r.order.currency||'INR', order_id:r.order.id,
      name:'A7 Tools Hub', description:r.item.label||item.label||itemId,
      prefill:{name:profile?.name||'',email:currentUser?.email||''},
      theme:{color:'#34f58a'},
      handler:async(resp)=>{
        try{
          toast('Verifying payment…');
          const vr=await backendRequest('/verify-payment',{
            razorpay_order_id:resp.razorpay_order_id,
            razorpay_payment_id:resp.razorpay_payment_id,
            razorpay_signature:resp.razorpay_signature
          });
          toast(vr.type==='credits'?`Payment verified: +${vr.creditsAdded} credits`:`Premium activated for ${vr.daysAdded} days`,4000);
        }catch(e){ showBackendError(e); }
      },
      modal:{ondismiss:()=>toast('Payment cancelled')}
    });
    rz.on('payment.failed',()=>toast('Payment failed',3500));
    rz.open();
  }catch(e){showBackendError(e);}finally{setLoading(btn,false);}
}


const UPI_ID='t7x@axl';
let selectedUpiProduct=null;
function openUpiPayment(itemId){
  const item=billingCatalog[itemId]; if(!item)return toast('Product not found');
  if(!paymentsEnabled)return toast('Payments are disabled');
  selectedUpiProduct={id:itemId,...item};
  $('#upiProductId').value=itemId; $('#upiProductTitle').textContent=item.label||itemId; $('#upiAmount').textContent=money(item.amountPaise); $('#upiUtr').value='';
  const amount=(Number(item.amountPaise||0)/100).toFixed(2);
  const note=`A7 ${item.type==='premium'?'Premium':'Credits'} ${item.label||itemId}`;
  $('#openUpiApp').href=`upi://pay?pa=${encodeURIComponent(UPI_ID)}&pn=${encodeURIComponent('ANAND KUMAR')}&am=${encodeURIComponent(amount)}&cu=INR&tn=${encodeURIComponent(note)}`;
  $('#upiPaymentModal').classList.remove('hidden');
}
$('#closeUpiPayment').onclick=()=>$('#upiPaymentModal').classList.add('hidden');
$('#upiPaymentModal').onclick=e=>{if(e.target.id==='upiPaymentModal')$('#upiPaymentModal').classList.add('hidden');};
$('#copyUpiId').onclick=()=>navigator.clipboard.writeText(UPI_ID).then(()=>toast('UPI ID copied'));
$('#upiSubmitForm').addEventListener('submit',async e=>{
  e.preventDefault(); const btn=e.submitter, itemId=$('#upiProductId').value, utr=$('#upiUtr').value.trim();
  try{setLoading(btn,true,'Submitting…');const r=await backendRequest('/submit-upi-payment',{itemId,utr});$('#upiPaymentModal').classList.add('hidden');toast(`Payment submitted: ${r.paymentId}. Waiting for admin verification.`,4500);loadMyUpiPayments();}
  catch(err){showBackendError(err);}finally{setLoading(btn,false);}
});
async function loadMyUpiPayments(){
  if(!currentUser)return; const box=$('#myUpiPayments'); if(!box)return; box.innerHTML='<p class="muted">Loading…</p>';
  try{const snap=await get(ref(db,`manualPayments/${currentUser.uid}`)), data=snap.val()||{}; const rows=Object.values(data).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    if(!rows.length){box.innerHTML='<p class="muted">No UPI payment submitted yet.</p>';return;}
    box.innerHTML=rows.map(r=>`<div class="history-row"><div><b>${esc(r.label||r.itemId||'Purchase')}</b><br><small>${money(r.amountPaise)} · UTR ${esc(r.utrMasked||'••••')}</small></div><div><span class="payment-status ${esc(r.status||'pending')}">${esc((r.status||'pending').toUpperCase())}</span><br><small>${dateText(r.createdAt)}</small></div></div>`).join('');
  }catch(e){box.innerHTML=`<p class="muted">Could not load payments: ${esc(e.message)}</p>`;}
}
$('#refreshMyUpi').onclick=loadMyUpiPayments;

async function loadUpiPayments(){
  if(!isAdmin)return; const box=$('#upiPaymentRecords'); box.innerHTML='<div class="empty-admin">Loading…</div>';
  try{const r=await backendRequest('/admin-upi-payments',{});const rows=r.payments||[];if(!rows.length){box.innerHTML='<div class="empty-admin">No UPI payment requests.</div>';return;}
    box.innerHTML=rows.map(x=>`<div class="api-record"><div class="api-record-top"><div><h4>${esc(x.label||x.itemId)}</h4><small>${esc(x.email||x.uid)} · ${money(x.amountPaise)}</small></div><span class="payment-status ${esc(x.status)}">${esc(String(x.status||'pending').toUpperCase())}</span></div><div class="record-meta"><span>UTR: <b>${esc(x.utr||'')}</b></span><span>${dateText(x.createdAt)}</span></div>${x.status==='pending'?`<div class="record-actions"><button class="primary" data-upi-approve="${esc(x.id)}" data-upi-uid="${esc(x.uid)}">Approve</button><button class="danger" data-upi-reject="${esc(x.id)}" data-upi-uid="${esc(x.uid)}">Reject</button></div>`:''}</div>`).join('');
    $$('[data-upi-approve]').forEach(b=>b.onclick=()=>reviewUpi(b.dataset.upiUid,b.dataset.upiApprove,'approve',b));
    $$('[data-upi-reject]').forEach(b=>b.onclick=()=>reviewUpi(b.dataset.upiUid,b.dataset.upiReject,'reject',b));
  }catch(e){box.innerHTML=`<div class="empty-admin">${esc(e.message)}</div>`;}
}
async function reviewUpi(uid,paymentId,action,btn){
  if(action==='approve'&&!confirm('Verify this exact UTR in your PhonePe/bank statement before approving. Approve now?'))return;
  try{setLoading(btn,true,action==='approve'?'Approving…':'Rejecting…');const r=await backendRequest('/admin-review-upi-payment',{uid,paymentId,action});toast(action==='approve'?(r.type==='credits'?`Approved: +${r.creditsAdded} credits`:`Approved: ${r.daysAdded} premium days`):'Payment rejected',4000);await loadUpiPayments();}
  catch(e){showBackendError(e);}finally{setLoading(btn,false);}
}
$('#refreshUpiPayments').onclick=loadUpiPayments;

async function loadHistory(){
  if(!currentUser)return;
  const box=$('#historyList'); box.innerHTML='<p class="muted">Loading…</p>';
  try{
    const q=query(ref(db,`history/${currentUser.uid}`),orderByChild('timestamp'),limitToLast(50));
    const snap=await get(q); const val=snap.val()||{};
    const rows=Object.values(val).sort((a,b)=>(b.timestamp||0)-(a.timestamp||0));
    if(!rows.length){box.innerHTML='<p class="muted">No activity yet.</p>';return;}
    box.innerHTML=rows.map(h=>`<div class="history-row"><div><b>${esc(h.action||'Action')}</b><br><small>${esc(h.detail||'')}</small></div><small>${dateText(h.timestamp)}</small></div>`).join('');
  }catch(e){box.innerHTML=`<p class="muted">Could not load history: ${esc(e.message)}</p>`;}
}

// ---------- AUTH ----------
function switchAuth(mode){
  const login=mode==='login';
  $('#loginForm').classList.toggle('hidden',!login); $('#registerForm').classList.toggle('hidden',login);
  $('#loginTab').classList.toggle('active',login); $('#registerTab').classList.toggle('active',!login); clearAuthStatus();
}
$('#loginTab').onclick=()=>switchAuth('login'); $('#registerTab').onclick=()=>switchAuth('register');

$('#googleLogin').onclick=async()=>{
  clearAuthStatus(); const btn=$('#googleLogin');
  try{
    setLoading(btn,true,'Opening Google…');
    const provider=new GoogleAuthProvider(); provider.setCustomParameters({prompt:'select_account'});
    await signInWithPopup(auth,provider);
    authStatus('Google login successful.','ok');
  }catch(err){
    const msg=err?.code==='auth/popup-blocked'?'Popup blocked. Allow popups and try again.':friendlyAuthError(err);
    authStatus(msg);
  }finally{setLoading(btn,false);}
};

$('#registerForm').addEventListener('submit',async e=>{
  e.preventDefault(); clearAuthStatus();
  const name=$('#registerName').value.trim(), email=$('#registerEmail').value.trim(), pass=$('#registerPassword').value, confirmPass=$('#registerConfirm').value;
  if(pass!==confirmPass)return authStatus('Passwords do not match.');
  const btn=e.submitter;
  try{
    setLoading(btn,true,'Creating…');
    const cred=await createUserWithEmailAndPassword(auth,email,pass);
    await set(ref(db,`profiles/${cred.user.uid}`),{name,email,createdAt:now(),updatedAt:now()});
    authStatus('Account created successfully. Admin access is controlled by server Environment Variables.','ok');
  }catch(err){authStatus(friendlyAuthError(err));}finally{setLoading(btn,false);}
});

$('#loginForm').addEventListener('submit',async e=>{
  e.preventDefault(); clearAuthStatus(); const btn=e.submitter;
  try{setLoading(btn,true,'Logging in…');await signInWithEmailAndPassword(auth,$('#loginEmail').value.trim(),$('#loginPassword').value);}catch(err){authStatus(friendlyAuthError(err));}finally{setLoading(btn,false);}
});

$('#forgotPassword').onclick=async()=>{
  const email=$('#loginEmail').value.trim(); if(!email)return authStatus('Enter your email first.');
  try{await sendPasswordResetEmail(auth,email);authStatus('Password reset email sent.','ok');}catch(e){authStatus(friendlyAuthError(e));}
};
function friendlyAuthError(e){
  const code=e?.code||''; const map={'auth/invalid-credential':'Invalid email or password.','auth/email-already-in-use':'This email is already registered.','auth/weak-password':'Password is too weak.','auth/invalid-email':'Invalid email address.','auth/operation-not-allowed':'Enable the required sign-in provider in Firebase Authentication.','auth/popup-closed-by-user':'Google sign-in was cancelled.','auth/account-exists-with-different-credential':'This email already uses another sign-in method.'}; return map[code]||e.message||'Authentication failed.';
}

onAuthStateChanged(auth,async user=>{
  currentUser=user;
  if(!user){cleanupLive();profile=null;wallet={credits:0};premium=null;isAdmin=false;$('#authScreen').classList.remove('hidden');$('#appShell').classList.add('hidden');$('#mobileNav').classList.add('hidden');return;}
  $('#authScreen').classList.add('hidden'); $('#appShell').classList.remove('hidden'); $('#mobileNav').classList.remove('hidden');
  try{
    const p=await get(ref(db,`profiles/${user.uid}`));
    if(!p.exists()) await set(ref(db,`profiles/${user.uid}`),{name:'',email:user.email||'',createdAt:now(),updatedAt:now()});
  }catch(e){console.warn('Profile init:',e.message);}
  try{ await backendRequest('/sync-role',{}); }catch(e){ console.warn('Role sync:',e.message); }
  subscribeUserData(user); renderProfile(); renderAccount(); renderTools();
});

$('#logoutBtn').onclick=()=>signOut(auth);
$('#avatarBtn').onclick=()=>showView('profile');
$('#saveProfile').onclick=async()=>{if(!currentUser)return;const name=$('#profileName').value.trim();if(!name)return toast('Enter your name');try{await update(ref(db,`profiles/${currentUser.uid}`),{name,updatedAt:now()});toast('Profile saved');}catch(e){toast(e.message);}};

// ---------- ADMIN ----------
function collectApiForm(){
  const headers=$('#adminHeaders').value.trim(); if(headers){JSON.parse(headers);}
  const tool=$('#adminToolSelect').value;
  return {
    tool, name:$('#adminApiName').value.trim(), endpoint:$('#adminEndpoint').value.trim(), method:$('#adminMethod').value,
    responseType:$('#adminResponseType').value, headers, body:$('#adminBody').value.trim(), cost:Math.max(0,Math.floor(Number($('#adminCost').value||0))),
    premiumOnly:$('#adminPremiumOnly').checked, enabled:$('#adminEnabled').checked, updatedAt:now(), updatedBy:currentUser.uid
  };
}
function clearApiEditor(){
  $('#apiAdminForm').reset(); $('#editApiSlug').value=''; $('#adminCost').value=1; $('#adminEnabled').checked=true; $('#apiEditorTitle').textContent='Add / Edit Tool API'; $('#apiTestStatus').className='api-test-status muted'; $('#apiTestStatus').textContent='Not tested yet.';
}

$('#apiAdminForm').addEventListener('submit',async e=>{
  e.preventDefault(); if(!isAdmin)return toast('Admin access required');
  try{
    const cfg=collectApiForm(); if(!cfg.name||!cfg.endpoint)return toast('API name and endpoint required');
    if(!cfg.endpoint.includes('{query}')&&!cfg.endpoint.includes('{}') && cfg.method==='GET')return toast('GET endpoint should contain {query} or {}');
    const newSlug=slugify(cfg.tool), oldSlug=$('#editApiSlug').value;
    if(oldSlug && oldSlug!==newSlug) await remove(ref(db,`apiConfigs/${oldSlug}`));
    await set(ref(db,`apiConfigs/${newSlug}`),cfg); clearApiEditor(); toast('API saved to Firebase'); await loadAdminApis();
  }catch(err){toast(err instanceof SyntaxError?'Headers must be valid JSON':err.message);}
});
$('#clearApiEditor').onclick=clearApiEditor;

$('#testAdminApi').onclick=async()=>{
  if(!isAdmin)return toast('Admin access required');
  let cfg; try{cfg=collectApiForm();}catch{return toast('Headers must be valid JSON');}
  if(!cfg.endpoint)return toast('Enter endpoint first'); const qv=prompt('Test query value:'); if(!qv?.trim())return;
  const st=$('#apiTestStatus'); st.className='api-test-status muted'; st.textContent='Testing through secure backend…';
  try{const r=await backendRequest('/admin-test-api',{config:cfg,query:qv.trim()});st.className='api-test-status ok';st.textContent=JSON.stringify(r.data,null,2).slice(0,5000);}catch(e){st.className='api-test-status bad';st.textContent=`FAILED: ${e.message}\n${e.data?.message||''}`;}
};

async function loadAdminApis(){
  if(!isAdmin)return; const box=$('#adminApiRecords'); box.innerHTML='<div class="empty-admin">Loading…</div>';
  try{
    const snap=await get(ref(db,'apiConfigs')); const records=snap.val()||{}; const entries=Object.entries(records);
    if(!entries.length){box.innerHTML='<div class="empty-admin">No APIs configured.</div>';return;}
    box.innerHTML=entries.map(([slug,r])=>`<div class="api-record"><div class="api-record-top"><div><h4>${esc(r.name||r.tool)}</h4><small>${esc(r.tool)} · ${esc(r.method||'GET')}</small></div><span class="${r.enabled?'status-enabled':'status-disabled'}">${r.enabled?'ENABLED':'DISABLED'}</span></div><div class="record-meta"><span>${Number(r.cost||0)} credits</span>${r.premiumOnly?'<span class="hot">PREMIUM ONLY</span>':''}</div><code>${esc(r.endpoint)}</code><div class="record-actions"><button class="tiny-btn" data-api-edit="${slug}">Edit</button><button class="tiny-btn" data-api-toggle="${slug}">${r.enabled?'Disable':'Enable'}</button><button class="danger" data-api-delete="${slug}">Delete</button></div></div>`).join('');
    $$('[data-api-edit]').forEach(b=>b.onclick=()=>editApi(b.dataset.apiEdit,records[b.dataset.apiEdit]));
    $$('[data-api-toggle]').forEach(b=>b.onclick=async()=>{const s=b.dataset.apiToggle;await update(ref(db,`apiConfigs/${s}`),{enabled:!records[s].enabled,updatedAt:now(),updatedBy:currentUser.uid});toast('API updated');loadAdminApis();});
    $$('[data-api-delete]').forEach(b=>b.onclick=async()=>{const s=b.dataset.apiDelete;if(confirm(`Delete API for ${records[s].tool}?`)){await remove(ref(db,`apiConfigs/${s}`));toast('API deleted');loadAdminApis();}});
  }catch(e){box.innerHTML=`<div class="empty-admin">${esc(e.message)}</div>`;}
}
function editApi(slug,r){
  $('#editApiSlug').value=slug; $('#adminToolSelect').value=r.tool; $('#adminApiName').value=r.name||''; $('#adminEndpoint').value=r.endpoint||''; $('#adminMethod').value=r.method||'GET'; $('#adminResponseType').value=r.responseType||'auto'; $('#adminHeaders').value=r.headers||''; $('#adminBody').value=r.body||''; $('#adminCost').value=Number(r.cost||0); $('#adminPremiumOnly').checked=!!r.premiumOnly; $('#adminEnabled').checked=!!r.enabled; $('#apiEditorTitle').textContent=`Edit: ${r.tool}`;
}

async function seedNumberApiIfNeeded(){
  if(!isAdmin)return;
  try{
    const r=ref(db,'apiConfigs/number-info'); const snap=await get(r); if(snap.exists())return;
    await set(r,{tool:'NUMBER INFO',name:'Anand Number Info API',endpoint:'https://anandapi.anandk11an.workers.dev/?num={query}',method:'GET',responseType:'auto',headers:'',body:'',cost:1,premiumOnly:false,enabled:true,updatedAt:now(),updatedBy:currentUser.uid});
  }catch(e){console.warn('Seed API:',e.message);}
}

async function loadAdminUsers(){
  if(!isAdmin)return; const box=$('#adminUsersList');box.innerHTML='<div class="empty-admin">Loading…</div>';
  try{
    const [ps,ws,prs]=await Promise.all([get(ref(db,'profiles')),get(ref(db,'wallets')),get(ref(db,'premium'))]);
    const profiles=ps.val()||{}, wallets=ws.val()||{}, premiums=prs.val()||{};
    const rows=Object.entries(profiles).sort((a,b)=>(a[1].createdAt||0)-(b[1].createdAt||0));
    box.innerHTML=`<table class="admin-table"><thead><tr><th>User</th><th>Role</th><th>Credits</th><th>Premium</th><th>Admin Actions</th></tr></thead><tbody>${rows.map(([uid,p])=>{const w=wallets[uid]||{credits:0};const pr=premiums[uid];const active=pr?.active&&pr.expiresAt>now();return `<tr><td class="email-cell"><b>${esc(p.name||'Unnamed')}</b><br><small>${esc(p.email||uid)}</small></td><td><span class="badge-mini ${uid===adminUid?'gold':'gray'}">${uid===adminUid?'ADMIN':'USER'}</span></td><td><input type="number" min="0" step="1" value="${Number(w.credits||0)}" data-credit-input="${uid}"></td><td><span class="badge-mini ${active?'gold':'gray'}">${active?'ACTIVE':'FREE'}</span><br><small>${active?dateText(pr.expiresAt):'—'}</small></td><td><div class="record-actions"><button class="tiny-btn" data-save-credit="${uid}">Save Credits</button><button class="tiny-btn" data-premium-user="${uid}">Set Premium</button></div></td></tr>`}).join('')}</tbody></table>`;
    $$('[data-save-credit]').forEach(b=>b.onclick=async()=>{const uid=b.dataset.saveCredit;const input=$(`[data-credit-input="${uid}"]`);const credits=Math.max(0,Math.floor(Number(input.value||0)));await set(ref(db,`wallets/${uid}`),{credits,updatedAt:now(),updatedBy:currentUser.uid});toast('Credits updated');});
    $$('[data-premium-user]').forEach(b=>b.onclick=async()=>{const uid=b.dataset.premiumUser;const days=Number(prompt('Premium days (0 = remove):','30'));if(!Number.isFinite(days)||days<0)return;if(days===0){await remove(ref(db,`premium/${uid}`));toast('Premium removed');}else{await set(ref(db,`premium/${uid}`),{active:true,planId:'admin_manual',purchasedAt:now(),expiresAt:now()+Math.floor(days)*86400000,updatedBy:currentUser.uid});toast('Premium updated');}loadAdminUsers();});
  }catch(e){box.innerHTML=`<div class="empty-admin">${esc(e.message)}</div>`;}
}

async function seedBillingCatalogIfNeeded(){
  if(!isAdmin)return;
  try{
    const defaults={
      credits_50:{label:'50 credits',type:'credits',amountPaise:2500,currency:'INR',credits:50,days:0,enabled:true},
      credits_100:{label:'100 credits',type:'credits',amountPaise:4500,currency:'INR',credits:100,days:0,enabled:true},
      credits_200:{label:'200 credits',type:'credits',amountPaise:7900,currency:'INR',credits:200,days:0,enabled:true},
      credits_500:{label:'500 credits',type:'credits',amountPaise:34900,currency:'INR',credits:500,days:0,enabled:true},
      premium_1:{label:'1 day',type:'premium',amountPaise:4900,currency:'INR',credits:0,days:1,enabled:true},
      premium_7:{label:'7 days',type:'premium',amountPaise:9900,currency:'INR',credits:0,days:7,enabled:true},
      premium_15:{label:'15 days',type:'premium',amountPaise:14900,currency:'INR',credits:0,days:15,enabled:true},
      premium_30:{label:'30 days',type:'premium',amountPaise:24900,currency:'INR',credits:0,days:30,enabled:true},
      premium_365:{label:'365 days',type:'premium',amountPaise:149900,currency:'INR',credits:0,days:365,enabled:true}
    };
    for(const [id,p] of Object.entries(defaults)){
      const rr=ref(db,`billingCatalog/${id}`), snap=await get(rr);
      if(!snap.exists()) await set(rr,{id,...p,updatedAt:now(),updatedBy:currentUser.uid});
    }
  }catch(e){console.warn('Seed billing:',e.message);}
}

function billingFormData(){
  const id=$('#billingId').value.trim(); if(!/^[a-zA-Z0-9_-]{3,40}$/.test(id))throw new Error('Product ID: only letters, numbers, _ and -');
  const type=$('#billingType').value, price=Number($('#billingPrice').value); if(!Number.isFinite(price)||price<=0)throw new Error('Enter valid price');
  const credits=Math.max(0,Math.floor(Number($('#billingCredits').value||0))), days=Math.max(0,Math.floor(Number($('#billingDays').value||0)));
  if(type==='credits'&&credits<1)throw new Error('Credit product needs credits > 0'); if(type==='premium'&&days<1)throw new Error('Premium product needs days > 0');
  return {id,label:$('#billingLabel').value.trim(),type,amountPaise:Math.round(price*100),currency:'INR',credits:type==='credits'?credits:0,days:type==='premium'?days:0,enabled:$('#billingEnabled').checked,updatedAt:now(),updatedBy:currentUser.uid};
}
$('#billingForm').addEventListener('submit',async e=>{
  e.preventDefault(); if(!isAdmin)return; try{const p=billingFormData();const old=$('#billingEditId').value;if(old&&old!==p.id)await remove(ref(db,`billingCatalog/${old}`));await set(ref(db,`billingCatalog/${p.id}`),p);clearBilling();toast('Billing product saved');}catch(err){toast(err.message);}
});
function clearBilling(){ $('#billingForm').reset();$('#billingEditId').value='';$('#billingEnabled').checked=true;$('#billingCredits').value=0;$('#billingDays').value=0; }
$('#clearBilling').onclick=clearBilling;
function renderBillingRecords(){
  if(!isAdmin)return; const box=$('#billingRecords'); const entries=Object.entries(billingCatalog||{}); if(!entries.length){box.innerHTML='<div class="empty-admin">No products.</div>';return;}
  box.innerHTML=entries.map(([id,p])=>`<div class="api-record"><div class="api-record-top"><div><h4>${esc(p.label||id)}</h4><small>${esc(id)} · ${esc(p.type)}</small></div><span class="${p.enabled?'status-enabled':'status-disabled'}">${p.enabled?'ENABLED':'DISABLED'}</span></div><div class="record-meta"><span>${money(p.amountPaise)}</span><span>${p.type==='credits'?`${p.credits} credits`:`${p.days} days`}</span></div><div class="record-actions"><button class="tiny-btn" data-bill-edit="${id}">Edit</button><button class="danger" data-bill-delete="${id}">Delete</button></div></div>`).join('');
  $$('[data-bill-edit]').forEach(b=>b.onclick=()=>{const id=b.dataset.billEdit,p=billingCatalog[id];$('#billingEditId').value=id;$('#billingId').value=id;$('#billingLabel').value=p.label||'';$('#billingType').value=p.type;$('#billingPrice').value=(p.amountPaise/100).toFixed(2);$('#billingCredits').value=p.credits||0;$('#billingDays').value=p.days||0;$('#billingEnabled').checked=!!p.enabled;});
  $$('[data-bill-delete]').forEach(b=>b.onclick=async()=>{if(confirm(`Delete ${b.dataset.billDelete}?`)){await remove(ref(db,`billingCatalog/${b.dataset.billDelete}`));toast('Product deleted');}});
}

$('#redeemAdminForm').addEventListener('submit',async e=>{
  e.preventDefault(); if(!isAdmin)return; const code=$('#redeemAdminCode').value.trim().toUpperCase(); if(!/^[A-Z0-9_-]{3,32}$/.test(code))return toast('Code can use A-Z, 0-9, _ and -');
  const old=(await get(ref(db,`redeemCodes/${code}`))).val()||{};
  await set(ref(db,`redeemCodes/${code}`),{code,credits:Math.max(1,Math.floor(Number($('#redeemAdminCredits').value))),maxUses:Math.max(1,Math.floor(Number($('#redeemAdminMaxUses').value))),uses:Number(old.uses||0),enabled:$('#redeemAdminEnabled').checked,updatedAt:now(),updatedBy:currentUser.uid});
  toast('Redeem code saved'); $('#redeemAdminForm').reset();$('#redeemAdminEnabled').checked=true;$('#redeemAdminCredits').value=10;$('#redeemAdminMaxUses').value=100; loadRedeemCodes();
});
async function loadRedeemCodes(){
  if(!isAdmin)return;const box=$('#redeemRecords');try{const snap=await get(ref(db,'redeemCodes'));const data=snap.val()||{};const entries=Object.entries(data);if(!entries.length){box.innerHTML='<div class="empty-admin">No redeem codes.</div>';return;}box.innerHTML=entries.map(([code,r])=>`<div class="api-record"><div class="api-record-top"><div><h4>${esc(code)}</h4><small>${Number(r.credits||0)} credits</small></div><span class="${r.enabled?'status-enabled':'status-disabled'}">${r.enabled?'ENABLED':'DISABLED'}</span></div><div class="record-meta"><span>${Number(r.uses||0)} / ${Number(r.maxUses||0)} uses</span></div><div class="record-actions"><button class="danger" data-redeem-delete="${code}">Delete</button></div></div>`).join('');$$('[data-redeem-delete]').forEach(b=>b.onclick=async()=>{if(confirm(`Delete code ${b.dataset.redeemDelete}?`)){await remove(ref(db,`redeemCodes/${b.dataset.redeemDelete}`));loadRedeemCodes();}});}catch(e){box.innerHTML=`<div class="empty-admin">${esc(e.message)}</div>`;}
}

$('#paymentsEnabledToggle').onchange=async e=>{if(!isAdmin){e.target.checked=paymentsEnabled;return;}if(e.target.checked&&!confirm('Enable live Razorpay payments? Verify prices and use fresh server-side credentials before enabling.')){e.target.checked=false;return;}await set(ref(db,'system/paymentsEnabled'),!!e.target.checked);toast(e.target.checked?'Payments enabled':'Payments disabled');};

async function loadAdminAll(){ if(!isAdmin)return; await Promise.allSettled([loadAdminApis(),loadAdminUsers(),loadRedeemCodes(),loadUpiPayments()]); renderBillingRecords(); }
$('#refreshUsers').onclick=loadAdminUsers;
$$('[data-admin-tab]').forEach(b=>b.onclick=()=>{const id=b.dataset.adminTab;$$('[data-admin-tab]').forEach(x=>x.classList.toggle('active',x===b));$$('.admin-tab-panel').forEach(p=>p.classList.remove('active-admin-tab'));$('#admin-'+id).classList.add('active-admin-tab');if(id==='users')loadAdminUsers();if(id==='apis')loadAdminApis();if(id==='redeem')loadRedeemCodes();if(id==='billing')renderBillingRecords();if(id==='payments')loadUpiPayments();});

// ---------- UI wiring ----------
$('#toolCount').textContent=allTools().length;
$('#adminToolSelect').innerHTML=uniqueToolNames().map(n=>`<option>${esc(n)}</option>`).join('');
$('#prevBtn').onclick=()=>{if(currentPage>0){currentPage--;renderTools($('#searchInput').value)}};
$('#nextBtn').onclick=()=>{if(currentPage<pages.length-1){currentPage++;renderTools($('#searchInput').value)}};
$('#searchInput').oninput=e=>renderTools(e.target.value);
$$('[data-go]').forEach(b=>b.onclick=()=>showView(b.dataset.go));
$('#refreshHistory').onclick=loadHistory;
$('#themeBtn').onclick=()=>toast('Dark cyber theme active');
$('#copyResult').onclick=()=>navigator.clipboard.writeText($('#resultText').textContent).then(()=>toast('Result copied'));
$('#downloadResult').onclick=downloadCurrentJson;
$('#closeModal').onclick=()=>$('#toolModal').classList.add('hidden'); $('#toolModal').onclick=e=>{if(e.target.id==='toolModal')$('#toolModal').classList.add('hidden')};
$('#closeActionModal').onclick=()=>$('#actionModal').classList.add('hidden'); $('#actionModal').onclick=e=>{if(e.target.id==='actionModal')$('#actionModal').classList.add('hidden')};

renderTools(); renderPaymentState();
