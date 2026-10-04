'use strict';
const $=id=>document.getElementById(id);
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const emptyState=()=>({name:'',amount:10000,currency:'ARS',start:today(),frequency:'7',people:[],turns:[],receipts:{},drawnAt:null});
let state=emptyState(),db,busy=false;
const amountFormat=new Intl.NumberFormat('es-AR',{useGrouping:true,minimumFractionDigits:2,maximumFractionDigits:2});
const numberFormat=new Intl.NumberFormat('es-AR',{useGrouping:true,maximumFractionDigits:0});
const money=n=>new Intl.NumberFormat('es-AR',{style:'currency',currency:state.currency,useGrouping:true,minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
function parseAmount(value){
 const text=value.trim();
 if(!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(text))throw Error('Ingresá el aporte con punto para miles y coma para decimales. Ejemplo: 10.000,50.');
 const amount=Number(text.replace(/\./g,'').replace(',','.'));
 if(!Number.isFinite(amount)||amount<1||amount>1000000000)throw Error('El aporte debe estar entre 1,00 y 1.000.000.000,00.');
 return amount;
}
const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateLabel=s=>new Intl.DateTimeFormat('es-AR',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(s+'T12:00:00Z'));
function notify(text,error=false){$('notice').textContent=text;$('notice').classList.toggle('error',error)}
function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open('ronda-beta',1);r.onupgradeneeded=()=>r.result.createObjectStore('data');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
function read(){return new Promise((resolve,reject)=>{const r=db.transaction('data').objectStore('data').get('chain');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
function write(next){return new Promise((resolve,reject)=>{const tx=db.transaction('data','readwrite');tx.objectStore('data').put(next,'chain');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)})}
async function commit(next){if(busy)throw Error('Esperá a que termine el guardado.');busy=true;try{await write(next);state=next;render()}finally{busy=false}}
function switchTab(id){document.querySelectorAll('.panel').forEach(el=>el.hidden=el.id!==id);document.querySelectorAll('[data-tab]').forEach(el=>{el.classList.toggle('active',el.dataset.tab===id);if(el.dataset.tab===id)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current')})}
document.querySelectorAll('[data-tab]').forEach(el=>el.onclick=()=>switchTab(el.dataset.tab));
function render(){
 $('chainName').value=state.name;$('amount').value=amountFormat.format(state.amount);$('currency').value=state.currency;$('start').value=state.start;$('frequency').value=state.frequency;
 const locked=state.turns.length>0;['chainName','amount','currency','start','frequency','saveSettings','personName','addPerson','demo'].forEach(id=>$(id).disabled=locked);
 $('count').textContent=numberFormat.format(state.people.length)+' personas';
 $('people').innerHTML=state.people.map(p=>`<div class="person"><span class="avatar">${escapeHtml(p.name.charAt(0).toUpperCase())}</span><span class="name">${escapeHtml(p.name)}</span>${locked?'':`<button class="remove" data-remove="${p.id}" aria-label="Quitar a ${escapeHtml(p.name)}">Quitar</button>`}</div>`).join('');
 $('peopleHint').textContent=locked?'Participantes y configuración fijados al realizar el sorteo.':'Agregá al menos 2 personas para realizar el sorteo.';
 $('draw').disabled=locked||state.people.length<2||!state.name;
 $('draw').textContent=locked?'Sorteo realizado':'Sortear fechas';
 $('drawDescription').textContent=locked?'Orden sorteado y guardado el '+new Date(state.drawnAt).toLocaleString('es-AR')+'. Cada persona tiene una fecha única.':'Guardá los datos de la cadena antes de sortear. El resultado queda fijo; para otro sorteo, creá una nueva cadena.';
 $('summary').innerHTML=locked?`<div class="stat"><small>Aporte por persona / turno</small><strong>${money(state.amount)}</strong></div><div class="stat"><small>Fondo por turno</small><strong>${money(state.amount*state.people.length)}</strong></div><div class="stat"><small>Turnos asignados</small><strong>${numberFormat.format(state.turns.length)}</strong></div>`:'';
 $('turns').innerHTML=locked?state.turns.map((t,i)=>`<div class="turn"><span class="turnnumber">${String(i+1).padStart(2,'0')}</span><div class="turnbody"><strong>${escapeHtml(state.people.find(p=>p.id===t.personId).name)}</strong><small>Recibe ${money(state.amount*state.people.length)}</small></div><div class="turndate">${dateLabel(t.date)}<small>Turno de cobro</small></div></div>`).join(''):'<div class="empty">Las fechas aparecerán acá después del sorteo.</div>';
 const selected=$('round').value;$('round').innerHTML=state.turns.map((t,i)=>`<option value="${i}">Turno ${i+1} · ${dateLabel(t.date)} · ${escapeHtml(state.people.find(p=>p.id===t.personId).name)}</option>`).join('');
 if(state.turns[Number(selected)])$('round').value=selected;renderPayments();
}
function renderPayments(){
 if(!state.turns.length){$('receipts').innerHTML='<div class="empty">Realizá el sorteo para registrar los comprobantes de cada turno.</div>';$('paymentSummary').innerHTML='';return}
 const round=$('round').value,items=state.people.map(p=>state.receipts[round+':'+p.id]);const approved=items.filter(r=>r?.status==='approved').length,pending=items.filter(r=>r?.status==='pending').length;
 $('paymentSummary').innerHTML=`<div class="stat"><small>Pagos aprobados</small><strong>${numberFormat.format(approved)} / ${numberFormat.format(state.people.length)}</strong></div><div class="stat"><small>Por revisar</small><strong>${numberFormat.format(pending)}</strong></div><div class="stat"><small>Importe aprobado</small><strong>${money(approved*state.amount)}</strong></div>`;
 $('receipts').innerHTML=state.people.map(p=>{const r=state.receipts[round+':'+p.id];return `<div class="receipt"><span class="avatar">${escapeHtml(p.name.charAt(0).toUpperCase())}</span><div class="receiptbody"><strong>${escapeHtml(p.name)}</strong><small>${r?escapeHtml(r.filename):'Aporte esperado: '+money(state.amount)}</small></div><span class="status ${r?.status||''}">${r?(r.status==='approved'?'Aprobado':'Pendiente de revisión'):'Sin comprobante'}</span><div class="receiptactions">${r?`<button class="secondary" data-download="${p.id}">Descargar</button>${r.status==='pending'?`<button class="primary" data-approve="${p.id}">Aprobar</button>`:`<button class="secondary" data-review="${p.id}">Volver a pendiente</button>`}`:''}<button class="secondary" data-upload="${p.id}" ${r?.status==='approved'?'disabled':''}>${r?'Reemplazar':'Adjuntar'}</button></div></div>`}).join('');
}
function id(){return crypto.randomUUID()}
function dates(count,start,frequency){const first=new Date(start+'T12:00:00Z');return Array.from({length:count},(_,i)=>{const d=new Date(first);if(frequency==='30'){d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+i);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(first.getUTCDate(),last))}else d.setUTCDate(d.getUTCDate()+Number(frequency)*i);return d.toISOString().slice(0,10)})}
function randomInt(n){const a=new Uint32Array(1),limit=Math.floor(4294967296/n)*n;do{crypto.getRandomValues(a)}while(a[0]>=limit);return a[0]%n}
function shuffle(people){const result=[...people];for(let i=result.length-1;i>0;i--){const j=randomInt(i+1);[result[i],result[j]]=[result[j],result[i]]}return result}
function download(blob,name){
 if(window.RondaAndroid&&typeof window.RondaAndroid.save==='function'){
  const reader=new FileReader();reader.onload=()=>{try{window.RondaAndroid.save(name,blob.type,String(reader.result).split(',')[1]);notify('Elegí dónde guardar el archivo en tu celular.')}catch(error){notify('No se pudo preparar la descarga.',true)}};reader.onerror=()=>notify('No se pudo leer el archivo.',true);reader.readAsDataURL(blob);return;
 }
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function handle(fn){return async e=>{try{await fn(e)}catch(error){notify(error.message||'No se pudo guardar. Intentá nuevamente.',true)}}}
 $('amount').oninput=()=> $('amount').setCustomValidity('');
 $('amount').onblur=()=>{try{$('amount').value=amountFormat.format(parseAmount($('amount').value));$('amount').setCustomValidity('')}catch(error){$('amount').setCustomValidity(error.message)}};
 $('settings').onsubmit=handle(async e=>{e.preventDefault();if(state.turns.length)return;const name=$('chainName').value.trim();if(!name)throw Error('Escribí un nombre para la cadena.');await commit({...state,name,amount:parseAmount($('amount').value),currency:$('currency').value,start:$('start').value,frequency:$('frequency').value});notify('Datos de la cadena guardados.')});
 $('personForm').onsubmit=handle(async e=>{e.preventDefault();if(state.turns.length)return;const name=$('personName').value.trim();if(!name)throw Error('Ingresá un nombre.');if(state.people.some(p=>p.name.toLocaleLowerCase()===name.toLocaleLowerCase()))throw Error('Ese nombre ya está en la cadena. Usá un apellido para distinguirlo.');await commit({...state,people:[...state.people,{id:id(),name}]});$('personName').value='';notify('Participante agregado.')});
 $('people').onclick=handle(async e=>{const b=e.target.closest('[data-remove]');if(!b||state.turns.length)return;await commit({...state,people:state.people.filter(p=>p.id!==b.dataset.remove)})});
 $('demo').onclick=handle(async()=>{if(state.turns.length)return;if(state.people.length&&!confirm('¿Reemplazar la configuración y participantes por un ejemplo?'))return;await commit({...emptyState(),name:'Cadena de amigos · Ejemplo',start:'2026-10-12',people:['Ana','Bruno','Carla','Diego','Elena','Facundo'].map(name=>({id:id(),name}))});notify('Ejemplo cargado. Podés editarlo antes de sortear.')});
 $('draw').onclick=handle(async()=>{if(state.turns.length||state.people.length<2||!state.name)return;if(!confirm('¿Sortear y fijar las fechas con los datos guardados? El grupo y los aportes quedarán bloqueados.'))return;const calendar=dates(state.people.length,state.start,state.frequency);await commit({...state,turns:shuffle(state.people).map((p,i)=>({personId:p.id,date:calendar[i]})),drawnAt:new Date().toISOString()});notify('Sorteo listo. Cada participante ya tiene su fecha de cobro.')});
 $('round').onchange=renderPayments;
 $('receipts').onclick=handle(async e=>{const b=e.target.closest('button');if(!b)return;const round=$('round').value;const personId=b.dataset.upload||b.dataset.approve||b.dataset.review||b.dataset.download;if(!personId)return;const key=round+':'+personId,r=state.receipts[key];if(b.dataset.download){download(r.file,r.filename);return}if(b.dataset.approve||b.dataset.review){await commit({...state,receipts:{...state.receipts,[key]:{...r,status:b.dataset.approve?'approved':'pending',reviewedAt:new Date().toISOString()}}});notify(b.dataset.approve?'Pago aprobado manualmente.':'Comprobante pendiente de revisión.');return}const input=document.createElement('input');input.type='file';input.accept='image/jpeg,image/png,image/webp,application/pdf';input.onchange=handle(async()=>{const file=input.files[0];if(!file)return;if(file.size>5*1024*1024)throw Error('El archivo supera los 5 MB.');if(!['image/jpeg','image/png','image/webp','application/pdf'].includes(file.type))throw Error('Usá un archivo JPG, PNG, WebP o PDF.');await commit({...state,receipts:{...state.receipts,[key]:{filename:file.name,file,status:'pending',uploadedAt:new Date().toISOString()}}});notify('Comprobante guardado y pendiente de revisión.')});input.click()});
 $('newChain').onclick=handle(async()=>{if(!confirm('¿Borrar esta cadena y sus comprobantes de este navegador? Exportá un respaldo antes de continuar.'))return;await commit(emptyState());switchTab('setup');notify('Lista para crear una nueva cadena.')});
 $('export').onclick=handle(async()=>{const receipts={};for(const [key,r] of Object.entries(state.receipts)){const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(r.file)});const {file,...metadata}=r;receipts[key]={...metadata,data}}download(new Blob([JSON.stringify({...state,receipts},null,2)],{type:'application/json'}),'ronda-respaldo.json');notify('Respaldo exportado con los comprobantes. Conservá el archivo; esta beta aún no permite importarlo.')});
 let installPrompt;
 window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;$('install').hidden=false});
 $('install').onclick=async()=>{if(!installPrompt)return;await installPrompt.prompt();const result=await installPrompt.userChoice;if(result.outcome==='accepted')$('install').hidden=true;installPrompt=null};
 window.addEventListener('appinstalled',()=>{$('install').hidden=true;notify('Ronda instalada en tu celular.')});
 if('serviceWorker' in navigator&&!window.RondaAndroid)navigator.serviceWorker.register('./sw.js').catch(()=>{});
 (async()=>{try{db=await openDB();state=await read()||emptyState();render()}catch(e){render();document.querySelectorAll('button').forEach(b=>b.disabled=true);notify('Este navegador no permite guardar datos. Abrí la beta en un navegador normal con almacenamiento habilitado.',true)}})();
