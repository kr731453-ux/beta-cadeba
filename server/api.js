const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
function fail(status,message){throw Object.assign(new Error(message),{status})}
const now=()=>new Date().toISOString();
const random=()=>{const bytes=crypto.getRandomValues(new Uint8Array(32));return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
const hash=async text=>{const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
const first=(db,sql,...args)=>db.prepare(sql).bind(...args).first();
const all=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results;
const run=(db,sql,...args)=>db.prepare(sql).bind(...args).run();
export function schedule(count,start,frequency){const first=new Date(start+'T12:00:00Z');return Array.from({length:count},(_,i)=>{const d=new Date(first);if(frequency==='monthly'){d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+i);d.setUTCDate(Math.min(first.getUTCDate(),new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate()))}else d.setUTCDate(d.getUTCDate()+i*(frequency==='weekly'?7:14));return d.toISOString().slice(0,10)})}
export function shuffle(input){const a=[...input];for(let i=a.length-1;i>0;i--){const n=i+1,lim=Math.floor(4294967296/n)*n;let value;do{value=crypto.getRandomValues(new Uint32Array(1))[0]}while(value>=lim);const j=value%n;[a[i],a[j]]=[a[j],a[i]]}return a}
async function body(request){if(!request.headers.get('Content-Type')?.startsWith('application/json'))fail(415,'Usá un cuerpo JSON.');const value=await request.json();if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'Datos inválidos.');return value}
async function user(request,env){
 const db=env.DB,id=request.headers.get('oai-authenticated-user-id'),email=request.headers.get('oai-authenticated-user-email');
 const authorization=request.headers.get('Authorization')||'';
 if(authorization){if(!authorization.startsWith('Bearer '))return null;const token=authorization.slice(7);if(token.length!==43)return null;const row=await first(db,'SELECT u.id,u.name FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>?',await hash(token),Date.now());if(row)return{...row,admin:!!await first(db,'SELECT user_id FROM admins WHERE user_id=?',row.id)};return null}
 if(id&&email){let name=email.split('@')[0];try{if(request.headers.get('oai-authenticated-user-full-name-encoding')==='percent-encoded-utf-8')name=decodeURIComponent(request.headers.get('oai-authenticated-user-full-name')||'')||name}catch{}name=name.slice(0,80);await run(db,'INSERT INTO users(id,name,created) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name',id,name,now());if(env.ADMIN_EMAIL&&email.toLowerCase()===env.ADMIN_EMAIL.toLowerCase())await run(db,'INSERT OR IGNORE INTO admins(user_id) VALUES(?)',id);return{id,name,admin:!!await first(db,'SELECT user_id FROM admins WHERE user_id=?',id)}}

 return null;
}
async function mustUser(request,env){const u=await user(request,env);if(!u)fail(401,'Iniciá sesión para continuar.');return u}
async function accessState(env,u,create=false){
 if(u.admin)return {state:'approved'};
 if(create)await run(env.DB,"INSERT OR IGNORE INTO access_requests(user_id,state,created) VALUES(?,CASE WHEN EXISTS(SELECT 1 FROM members WHERE user_id=? AND state='active') THEN 'approved' ELSE 'pending' END,?)",u.id,u.id,now());
 return await first(env.DB,'SELECT state,created,reviewed FROM access_requests WHERE user_id=?',u.id)||{state:'not_requested'};
}
async function requireAccess(env,u){if((await accessState(env,u,true)).state!=='approved')fail(403,'Tu acceso a la app necesita autorización del administrador.');}
async function getChain(env,id,u,admin=false){const c=await first(env.DB,'SELECT * FROM chains WHERE id=?',id);if(!c)fail(404,'La cadena no existe.');if(!admin&&!await first(env.DB,"SELECT user_id FROM members WHERE chain_id=? AND user_id=? AND state='active'",id,u.id))fail(403,'Solo podés ver movimientos de las cadenas donde tu ingreso fue aprobado.');return c}
async function chainDetails(env,id,u,admin){const chain=await getChain(env,id,u,admin);const members=await all(env.DB,`SELECT m.user_id,m.state,m.quantity,m.joined,u.name FROM members m JOIN users u ON u.id=m.user_id WHERE m.chain_id=? ${admin?'':"AND m.state='active'"} ORDER BY m.joined`,id);const turns=await all(env.DB,'SELECT t.number,t.user_id,t.slot_number,t.date,t.completed,u.name FROM turns t JOIN users u ON u.id=t.user_id WHERE t.chain_id=? ORDER BY t.number',id);const payments=await all(env.DB,'SELECT r.id,r.turn_number,r.user_id,r.slot_number,r.filename,r.mime,r.state,r.uploaded,r.reviewed,r.payment_method,r.paid_date,r.note,r.recorded_by,u.name FROM receipts r JOIN users u ON u.id=r.user_id WHERE r.chain_id=? ORDER BY r.turn_number,r.uploaded',id);const receipts=payments.map(r=>({...r,filename:admin||r.user_id===u.id?r.filename:null,canDownload:r.payment_method!=='cash'&&(admin||r.user_id===u.id)}));const completed=turns.filter(t=>t.completed).length,myTurns=turns.filter(t=>t.user_id===u.id).map(t=>({...t,turnsUntilCollection:t.completed?null:Math.max(0,t.number-1-completed)})),own=myTurns.find(t=>!t.completed)||myTurns[0];return{chain,members,turns,receipts,myTurns,turnsUntilCollection:own?.turnsUntilCollection??null,myTurn:own||null,currentTurn:turns.find(t=>!t.completed)||null}}
function checkFile(bytes,mime){return mime==='application/pdf'?new TextDecoder().decode(bytes.slice(0,5))==='%PDF-':mime==='image/png'?bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71:mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216:mime==='image/webp'?new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP':false}
async function uploadReceipt(request,env,url,id,ownerId,recorder){const db=env.DB;
   const turn=Number(url.searchParams.get('turn')),slot=Number(url.searchParams.get('slot')||1);const member=await first(db,"SELECT quantity FROM members WHERE chain_id=? AND user_id=? AND state='active'",id,ownerId);if(!member)fail(403,'Ese participante no tiene puestos aprobados en esta cadena.');if(!Number.isInteger(slot)||slot<1||slot>member.quantity)fail(403,'Ese puesto no te pertenece.');if(!Number.isInteger(turn)||turn<1)fail(400,'Elegí un turno.');const t=await first(db,'SELECT completed FROM turns WHERE chain_id=? AND number=?',id,turn);if(!t||t.completed)fail(409,'Este turno no admite nuevos comprobantes.');
   if(Number(request.headers.get('Content-Length')||0)>6*1024*1024)fail(413,'El comprobante supera los 5 MB.');const form=await request.formData(),file=form.get('file');if(!(file instanceof File)||file.size<1||file.size>5*1024*1024)fail(400,'Elegí un comprobante de hasta 5 MB.');const bytes=await file.arrayBuffer();if(!checkFile(new Uint8Array(bytes),file.type))fail(400,'Usá un archivo JPG, PNG, WebP o PDF válido.');
   const existing=await first(db,'SELECT id,r2_key,state FROM receipts WHERE chain_id=? AND turn_number=? AND user_id=? AND slot_number=?',id,turn,ownerId,slot);if(existing?.state==='approved')fail(409,'El pago ya está aprobado.');const receiptId=existing?.id||crypto.randomUUID(),key=crypto.randomUUID();await env.BUCKET.put(key,bytes,{httpMetadata:{contentType:file.type}});
   try{const result=await run(db,"INSERT INTO receipts(id,chain_id,turn_number,user_id,slot_number,r2_key,filename,mime,state,uploaded,recorded_by) VALUES(?,?,?,?,?,?,?,?,'pending',?,?) ON CONFLICT(chain_id,turn_number,user_id,slot_number) DO UPDATE SET r2_key=excluded.r2_key,filename=excluded.filename,mime=excluded.mime,uploaded=excluded.uploaded,recorded_by=excluded.recorded_by WHERE receipts.state='pending'",receiptId,id,turn,ownerId,slot,key,file.name.slice(0,180),file.type,now(),recorder);if(!result.meta.changes)fail(409,'El pago ya fue aprobado.')}catch(error){await env.BUCKET.delete(key);throw error}if(existing?.r2_key)await env.BUCKET.delete(existing.r2_key);return json({ok:true});
}
async function issueLinkCode(env,owner){const db=env.DB;
    const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',code=Array.from(crypto.getRandomValues(new Uint8Array(20)),b=>alphabet[b&31]).join(''),expires=Date.now()+7*86400000;
    await db.batch([db.prepare('DELETE FROM link_codes WHERE user_id=? AND consumed IS NULL').bind(owner.id),db.prepare('INSERT INTO link_codes(code_hash,user_id,created,expires) VALUES(?,?,?,?)').bind(await hash(code),owner.id,now(),expires)]);
    return {user_id:owner.id,name:owner.name,code:code.match(/.{4}/g).join('-'),expires};
}
async function participantDetails(env,id,u){const c=await getChain(env,id,u,false),m=await first(env.DB,"SELECT quantity FROM members WHERE chain_id=? AND user_id=? AND state='active'",id,u.id),turns=await all(env.DB,'SELECT number,slot_number,date,completed FROM turns WHERE chain_id=? AND user_id=? ORDER BY number',id,u.id),completed=await first(env.DB,'SELECT COUNT(*) AS n FROM turns WHERE chain_id=? AND completed IS NOT NULL',id);return{chain:{id:c.id,name:c.name,frequency:c.frequency,status:c.status},quantity:m.quantity,myTurns:turns.map(t=>({...t,turnsUntilCollection:t.completed?null:Math.max(0,t.number-1-completed.n)}))}}
export async function handle(request,env){
 const url=new URL(request.url),origin=request.headers.get('Origin');let response;
 try{
  if(!env.DB||!env.BUCKET)fail(503,'El almacenamiento compartido todavía no está disponible.');
  const allowedOrigins=[url.origin,'https://appassets.androidplatform.net'];
  if(origin&&!allowedOrigins.includes(origin))fail(403,'Origen no autorizado.');
  if(request.method==='OPTIONS')response=new Response(null,{status:204});
  else response=await dispatch(request,env,url);
 }catch(error){response=json({error:error.status?error.message:'No se pudo completar la operación. Intentá nuevamente.'},error.status||500);if(!error.status)console.error('Ronda API error:',error.message)}
 const headers=new Headers(response.headers);headers.set('Cache-Control','no-store');headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');
 if(origin&&[url.origin,'https://appassets.androidplatform.net'].includes(origin)){headers.set('Access-Control-Allow-Origin',origin);headers.set('Vary','Origin');headers.set('Access-Control-Allow-Methods','GET,POST,OPTIONS');headers.set('Access-Control-Allow-Headers','Authorization,Content-Type');}
 return new Response(response.body,{status:response.status,headers});
}
async function dispatch(request,env,url){
 const db=env.DB,path=url.pathname,method=request.method;
 if(path==='/api/link/redeem'&&method==='POST'){
  const key=await hash((request.headers.get('CF-Connecting-IP')||request.headers.get('X-Real-IP')||'unknown')+':'+Math.floor(Date.now()/600000));
  await run(db,'DELETE FROM login_limits WHERE expires<?',Date.now());
  const attempts=await first(db,'INSERT INTO login_limits(key,attempts,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1 RETURNING attempts',key,Date.now()+600000);if(attempts.attempts>20)fail(429,'Demasiados intentos. Esperá 10 minutos antes de volver a probar.');
  const data=await body(request),code=String(data.code||'').toUpperCase().replace(/[\s-]/g,'');if(!/^[A-HJ-NP-Z2-9]{20}$/.test(code))fail(401,'El código no es válido, venció o ya fue utilizado.');
  const codeHash=await hash(code),token=random(),tokenHash=await hash(token),redemption=crypto.randomUUID(),stamp=now();
  const results=await db.batch([
   db.prepare('UPDATE link_codes SET consumed=? WHERE code_hash=? AND consumed IS NULL AND expires>?').bind(redemption,codeHash,Date.now()),
   db.prepare('INSERT INTO sessions(token_hash,user_id,expires) SELECT ?,user_id,? FROM link_codes WHERE code_hash=? AND consumed=?').bind(tokenHash,Date.now()+30*86400000,codeHash,redemption),
   db.prepare("INSERT INTO access_requests(user_id,state,created,reviewed) SELECT user_id,'approved',?,? FROM link_codes WHERE code_hash=? AND consumed=? ON CONFLICT(user_id) DO UPDATE SET state='approved',reviewed=excluded.reviewed").bind(stamp,stamp,codeHash,redemption)
  ]);if(!results[0].meta.changes)fail(401,'El código no es válido, venció o ya fue utilizado.');return json({token});
 }

 if(path==='/api/mobile/connect'&&method==='GET'){
  const challenge=url.searchParams.get('challenge')||'';if(!/^[A-Za-z0-9_-]{43}$/.test(challenge))fail(400,'Solicitud de ingreso inválida.');const u=await user(request,env);
  if(!u)return Response.redirect(url.origin+'/signin-with-chatgpt?return_to='+encodeURIComponent(url.pathname+url.search),302);
  const code=random();await run(db,'DELETE FROM mobile_codes WHERE expires<?',Date.now());await run(db,'INSERT INTO mobile_codes(code_hash,user_id,challenge,expires) VALUES(?,?,?,?)',await hash(code),u.id,challenge,Date.now()+120000);
  return new Response(`<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Volver a Ronda</title><body style="font:16px sans-serif;background:#f5f6f1;color:#203b35;padding:40px 24px"><h1>Ya podés entrar a Ronda</h1><p>Volvé a la app para elegir tu cadena.</p><a href="rondabeta://login?code=${code}" style="display:inline-block;padding:16px 24px;background:#28553f;color:white;border-radius:10px;text-decoration:none">Volver a Ronda</a><p style="font-size:13px">Este acceso vence en dos minutos.</p></body></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'"}});
 }
 if(path==='/api/mobile/exchange'&&method==='POST'){
  const data=await body(request);if(!/^[A-Za-z0-9_-]{43}$/.test(data.code||'')||!/^[A-Za-z0-9_-]{43}$/.test(data.verifier||''))fail(400,'Ingreso inválido.');const h=await hash(data.code),challenge=await hash(data.verifier);const row=await first(db,'DELETE FROM mobile_codes WHERE code_hash=? AND challenge=? AND expires>? RETURNING user_id',h,challenge,Date.now());if(!row)fail(401,'El ingreso venció. Volvé a iniciar sesión.');const token=random();await run(db,'DELETE FROM sessions WHERE expires<?',Date.now());await run(db,'INSERT INTO sessions(token_hash,user_id,expires) VALUES(?,?,?)',await hash(token),row.user_id,Date.now()+30*86400000);return json({token});
 }
 const u=await mustUser(request,env);
 if(path==='/api/me'&&method==='GET')return json(u);
 if(path==='/api/access'&&['GET','POST'].includes(method))return json(await accessState(env,u,method==='POST'));
 if(path==='/api/mine'||path==='/api/available'||path.startsWith('/api/chains/'))await requireAccess(env,u);
 if(path==='/api/logout'&&method==='POST'){const token=(request.headers.get('Authorization')||'').slice(7);if(token)await run(db,'DELETE FROM sessions WHERE token_hash=?',await hash(token));return json({ok:true})}
 if(path==='/api/mine'&&method==='GET')return json(await all(db,"SELECT c.id,c.name,c.frequency,c.status,m.quantity,(SELECT COUNT(*) FROM turns t WHERE t.chain_id=c.id AND t.completed IS NOT NULL) AS completed_count,(SELECT MIN(t.number) FROM turns t WHERE t.chain_id=c.id AND t.user_id=? AND t.completed IS NULL) AS my_turn_number FROM members m JOIN chains c ON c.id=m.chain_id WHERE m.user_id=? AND m.state='active' ORDER BY c.created DESC",u.id,u.id));
 if(path==='/api/available')fail(403,'El administrador asigna tus cadenas y puestos desde la web.');
 const participant=path.match(/^\/api\/chains\/([\w-]+)(?:\/(.*))?$/);
 if(participant){if(method!=='GET'||participant[2])fail(403,'La app de participantes es de consulta. El administrador gestiona los puestos y comprobantes.');return json(await participantDetails(env,participant[1],u));}

 const download=path.match(/^\/api\/(admin\/)?chains\/([\w-]+)\/receipts\/([\w-]+)\/file$/);
 if(download&&method==='GET'){const isAdmin=!!download[1];if(isAdmin&&!u.admin)fail(403,'Acceso reservado al administrador.');await getChain(env,download[2],u,isAdmin);const r=await first(db,'SELECT * FROM receipts WHERE id=? AND chain_id=?',download[3],download[2]);if(r?.payment_method==='cash')fail(404,'El pago en efectivo no tiene un archivo adjunto.');if(!r||(!isAdmin&&r.user_id!==u.id))fail(403,'Solo podés descargar tus propios comprobantes.');const obj=await env.BUCKET.get(r.r2_key);if(!obj)fail(404,'El archivo no está disponible.');return new Response(obj.body,{headers:{'Content-Type':r.mime,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(r.filename)}`}})}
 if(path.startsWith('/api/admin/')){
  if(!u.admin)fail(403,'Solo el administrador puede realizar esta acción.');
  if(path==='/api/admin/participants'&&method==='GET')return json(await all(db,'SELECT id,name FROM users u WHERE NOT EXISTS(SELECT 1 FROM admins a WHERE a.user_id=u.id) ORDER BY name'));
  if(path==='/api/admin/link-codes'){
   if(method==='GET')return json(await all(db,'SELECT u.id,u.name,EXISTS(SELECT 1 FROM link_codes c WHERE c.user_id=u.id AND c.consumed IS NULL AND c.expires>?) AS has_code FROM users u WHERE NOT EXISTS(SELECT 1 FROM admins a WHERE a.user_id=u.id) ORDER BY u.name',Date.now()));
   if(method==='POST'){
    const data=await body(request);let owner;if(data.user_id){owner=await first(db,'SELECT id,name FROM users WHERE id=?',String(data.user_id));if(!owner)fail(404,'El participante no existe.');if(await first(db,'SELECT user_id FROM admins WHERE user_id=?',owner.id))fail(400,'Los códigos son para cuentas de participantes.');}else{const name=String(data.name||'').trim();if(!name||name.length>80)fail(400,'Escribí el nombre del participante.');owner={id:'participant_'+crypto.randomUUID(),name};await run(db,'INSERT INTO users(id,name,created) VALUES(?,?,?)',owner.id,name,now());}
    return json(await issueLinkCode(env,owner),201);
   }
  }

  if(path==='/api/admin/access'&&method==='GET')return json(await all(db,"SELECT r.user_id,r.state,r.created,u.name FROM access_requests r JOIN users u ON u.id=r.user_id WHERE r.state IN ('pending','rejected') ORDER BY r.created DESC"));
  const permission=path.match(/^\/api\/admin\/access\/([\w-]+)\/(approve|reject)$/);
  if(permission&&method==='POST'){const state=permission[2]==='approve'?'approved':'rejected';const result=await run(db,"UPDATE access_requests SET state=?,reviewed=? WHERE user_id=? AND state IN ('pending','rejected')",state,now(),permission[1]);if(!result.meta.changes)fail(409,'La solicitud ya fue autorizada o no existe.');return json({ok:true})}

  if(path==='/api/admin/chains'){
   if(method==='GET')return json(await all(db,"SELECT c.*,(SELECT COALESCE(SUM(m.quantity),0) FROM members m WHERE m.chain_id=c.id AND m.state='active') AS occupied,(SELECT COUNT(*) FROM members m WHERE m.chain_id=c.id AND m.state='pending') AS requests FROM chains c ORDER BY c.created DESC"));
   if(method==='POST'){const data=await body(request),name=String(data.name||'').trim(),amount=Number(data.amount_cents),capacity=Number(data.capacity),start=String(data.start_date||'');if(!name||name.length>80||!Number.isInteger(amount)||amount<100||amount>100000000000||!Number.isInteger(capacity)||capacity<2||capacity>100||!['ARS','USD','EUR'].includes(data.currency)||!['weekly','fortnightly','monthly'].includes(data.frequency)||!/^\d{4}-\d{2}-\d{2}$/.test(start)||Number.isNaN(new Date(start+'T12:00:00Z').getTime())||new Date(start+'T12:00:00Z').toISOString().slice(0,10)!==start)fail(400,'Revisá el nombre, aporte, puestos, modalidad y fecha.');const id=crypto.randomUUID();await run(db,'INSERT INTO chains(id,name,amount_cents,currency,frequency,start_date,capacity,status,created) VALUES(?,?,?,?,?,?,?,\'draft\',?)',id,name,amount,data.currency,data.frequency,start,capacity,now());return json({id},201)}
  }
  const match=path.match(/^\/api\/admin\/chains\/([\w-]+)(?:\/(.*))?$/);if(match){const id=match[1],action=match[2]||'';const chain=await getChain(env,id,u,true);
   if(!action&&method==='GET')return json(await chainDetails(env,id,u,true));
   if(action==='participants'&&method==='POST'){
    if(chain.status!=='draft')fail(409,'Los puestos quedan fijos después de confirmar el orden.');const data=await body(request),quantity=Number(data.quantity);if(!Number.isInteger(quantity)||quantity<1||quantity>chain.capacity)fail(400,'Revisá la cantidad de puestos.');let owner,isNew=false;
    if(data.user_id){owner=await first(db,'SELECT id,name FROM users WHERE id=?',String(data.user_id));if(!owner||await first(db,'SELECT user_id FROM admins WHERE user_id=?',owner.id))fail(400,'Elegí un participante válido.');}else{const name=String(data.name||'').trim();if(!name||name.length>80)fail(400,'Escribí el nombre del participante.');owner={id:'participant_'+crypto.randomUUID(),name};isNew=true;}
    const condition="EXISTS(SELECT 1 FROM chains WHERE id=? AND status='draft' AND (SELECT COALESCE(SUM(quantity),0) FROM members WHERE chain_id=? AND state='active' AND user_id<>?)+?<=capacity)",statements=[];
    if(isNew)statements.push(db.prepare('INSERT INTO users(id,name,created) SELECT ?,?,? WHERE '+condition).bind(owner.id,owner.name,now(),id,id,owner.id,quantity));
    statements.push(db.prepare("INSERT INTO members(chain_id,user_id,quantity,state,joined) SELECT ?,?,?,'active',? WHERE "+condition+" ON CONFLICT(chain_id,user_id) DO UPDATE SET quantity=excluded.quantity,state='active'").bind(id,owner.id,quantity,now(),id,id,owner.id,quantity));
    const result=await db.batch(statements);if(!result[result.length-1].meta.changes)fail(409,'No quedan suficientes puestos o el grupo ya fue sorteado.');
    await run(db,"INSERT INTO access_requests(user_id,state,created,reviewed) VALUES(?,'approved',?,?) ON CONFLICT(user_id) DO UPDATE SET state='approved',reviewed=excluded.reviewed",owner.id,now(),now());
    return json({user_id:owner.id,name:owner.name,quantity},201);
   }

   if(action==='receipts'&&method==='POST'){const ownerId=url.searchParams.get('participant')||'';return uploadReceipt(request,env,url,id,ownerId,u.id);}
   const member=action.match(/^members\/([\w-]+)\/(approve|reject)$/);
   if(member&&method==='POST'){if(chain.status!=='draft')fail(409,'El grupo está cerrado después del sorteo.');const result=await run(db,"UPDATE members SET state=? WHERE chain_id=? AND user_id=? AND state='pending' AND EXISTS(SELECT 1 FROM chains WHERE id=? AND status='draft') AND (?='rejected' OR (SELECT COALESCE(SUM(quantity),0) FROM members WHERE chain_id=? AND state='active')+members.quantity<=?)",member[2]==='approve'?'active':'rejected',id,member[1],id,member[2]==='approve'?'active':'rejected',id,chain.capacity);if(!result.meta.changes)fail(409,'La solicitud ya fue resuelta o no quedan lugares.');return json({ok:true})}
   if(action==='draw')fail(403,'El orden de cobro se carga manualmente desde el administrador.');
   const remove=action.match(/^participants\/([\w-]+)$/);
   if(remove&&method==='DELETE'){if(chain.status!=='draft')fail(409,'Los puestos quedan fijos después de confirmar el orden.');const r=await run(db,"UPDATE members SET state='rejected' WHERE chain_id=? AND user_id=? AND EXISTS(SELECT 1 FROM chains WHERE id=? AND status='draft')",id,remove[1],id);if(!r.meta.changes)fail(409,'El participante ya no está en la cadena o el orden fue confirmado.');return json({ok:true})}
   if(action==='order'&&method==='POST'){
    const data=await body(request),order=data.order,members=await all(db,"SELECT user_id,quantity FROM members WHERE chain_id=? AND state='active'",id),seats=members.flatMap(m=>Array.from({length:m.quantity},(_,i)=>m.user_id+':'+(i+1)));
    if(chain.status!=='draft'||seats.length!==chain.capacity)fail(409,'Completá todos los puestos antes de confirmar el orden.');
    if(!Array.isArray(order)||order.length!==chain.capacity||order.some(p=>!p||!Number.isInteger(p.slot_number)||!seats.includes(p.user_id+':'+p.slot_number))||new Set(order.map(p=>p.user_id+':'+p.slot_number)).size!==seats.length)fail(400,'Incluí cada puesto exactamente una vez en el orden de cobro.');
    const drawId='manual_'+crypto.randomUUID(),dates=schedule(order.length,chain.start_date,chain.frequency),guard=members.map(()=>" AND EXISTS(SELECT 1 FROM members WHERE chain_id=? AND user_id=? AND quantity=? AND state='active')").join('');
    const statements=[db.prepare("UPDATE chains SET status='active',draw_id=? WHERE id=? AND status='draft' AND (SELECT COALESCE(SUM(quantity),0) FROM members WHERE chain_id=? AND state='active')=capacity"+guard).bind(drawId,id,id,...members.flatMap(m=>[id,m.user_id,m.quantity])),...order.map((p,i)=>db.prepare('INSERT INTO turns(chain_id,number,user_id,slot_number,date) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM chains WHERE id=? AND draw_id=?)').bind(id,i+1,p.user_id,p.slot_number,dates[i],id,drawId))];
    const results=await db.batch(statements);if(!results[0].meta.changes)fail(409,'El grupo cambió o el orden ya fue confirmado. Actualizá la cadena.');return json({ok:true});
   }
   if(action==='cash'&&method==='POST'){
    const data=await body(request),owner=String(data.user_id||''),slot=Number(data.slot_number),turn=Number(data.turn_number),paidDate=String(data.paid_date||''),note=String(data.note||'').trim(),today=new Date().toLocaleDateString('sv-SE',{timeZone:'America/Argentina/Buenos_Aires'});
    if(!Number.isInteger(slot)||slot<1||!Number.isInteger(turn)||turn<1||note.length>300||!/^\d{4}-\d{2}-\d{2}$/.test(paidDate)||Number.isNaN(new Date(paidDate+'T12:00:00Z').getTime())||new Date(paidDate+'T12:00:00Z').toISOString().slice(0,10)!==paidDate||paidDate>today)fail(400,'Revisá el puesto, período, fecha y nota del pago.');
    const existing=await first(db,'SELECT id,state FROM receipts WHERE chain_id=? AND turn_number=? AND user_id=? AND slot_number=?',id,turn,owner,slot);if(existing)fail(409,'Ese aporte ya tiene un registro. Revisalo en Pagos.');
    const stamp=now(),result=await run(db,"INSERT INTO receipts(id,chain_id,turn_number,user_id,slot_number,r2_key,filename,mime,state,uploaded,reviewed,payment_method,paid_date,note,recorded_by) SELECT ?,?,?,?,?,'','Pago en efectivo','application/octet-stream','approved',?,?,'cash',?,?,? WHERE EXISTS(SELECT 1 FROM members WHERE chain_id=? AND user_id=? AND state='active' AND quantity>=?) AND EXISTS(SELECT 1 FROM turns WHERE chain_id=? AND number=? AND completed IS NULL) AND NOT EXISTS(SELECT 1 FROM receipts WHERE chain_id=? AND turn_number=? AND user_id=? AND slot_number=?)",crypto.randomUUID(),id,turn,owner,slot,stamp,stamp,paidDate,note,u.id,id,owner,slot,id,turn,id,turn,owner,slot);
    if(!result.meta.changes)fail(409,'Ese puesto no existe o el cobro del período ya fue registrado.');return json({ok:true},201);
   }
   const approve=action.match(/^receipts\/([\w-]+)\/approve$/);if(approve&&method==='POST'){const result=await run(db,"UPDATE receipts SET state='approved',reviewed=? WHERE id=? AND chain_id=? AND state='pending'",now(),approve[1],id);if(!result.meta.changes)fail(409,'El comprobante ya fue revisado.');return json({ok:true})}
   const complete=action.match(/^turns\/(\d+)\/complete$/);if(complete&&method==='POST'){const n=Number(complete[1]),today=new Date().toLocaleDateString('sv-SE',{timeZone:'America/Argentina/Buenos_Aires'});const result=await db.batch([db.prepare("UPDATE turns SET completed=? WHERE chain_id=? AND number=? AND completed IS NULL AND date<=? AND number=(SELECT MIN(number) FROM turns WHERE chain_id=? AND completed IS NULL) AND (SELECT COUNT(*) FROM receipts WHERE chain_id=? AND turn_number=? AND state='approved')=(SELECT COALESCE(SUM(quantity),0) FROM members WHERE chain_id=? AND state='active')").bind(now(),id,n,today,id,id,n,id),db.prepare("UPDATE chains SET status='completed' WHERE id=? AND status='active' AND NOT EXISTS(SELECT 1 FROM turns WHERE chain_id=? AND completed IS NULL)").bind(id,id)]);if(!result[0].meta.changes)fail(409,'Completá los pagos aprobados, respetá la fecha y el orden de los turnos.');return json({ok:true})}
  }
 }
 fail(404,'La operación no existe.');
}
