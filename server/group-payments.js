import {allocateContribution,memberUnits} from './seat-shares.js';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const now=()=>new Date().toISOString();
const first=(db,sql,...args)=>db.prepare(sql).bind(...args).first();
const all=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results;
async function body(request){if(!request.headers.get('Content-Type')?.startsWith('application/json'))fail(415,'Datos inválidos.');return request.json()}
function validFile(bytes,mime){return mime==='application/pdf'?new TextDecoder().decode(bytes.slice(0,5))==='%PDF-':mime==='image/png'?bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71:mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216:mime==='image/webp'?new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP':false}
export async function groupedPayment(request,env,u,chain,action){const db=env.DB,id=chain.id;
 let data,file=null;if(action==='group-payments/file'){if(Number(request.headers.get('Content-Length')||0)>6*1024*1024)fail(413,'El comprobante supera los 5 MB.');const form=await request.formData();data={user_id:form.get('user_id'),turn_number:form.get('turn_number')};file=form.get('file')}else data=await body(request);
 const owner=String(data.user_id||''),turn=Number(data.turn_number),m=await first(db,"SELECT quantity,half_units,contribution_cents FROM members WHERE chain_id=? AND user_id=? AND state='active'",id,owner),t=await first(db,'SELECT completed FROM turns WHERE chain_id=? AND number=?',id,turn);
 if(!m||!Number.isInteger(turn)||!t||t.completed)fail(409,'El participante o el período no admite nuevos cambios.');
 if(action==='dues'){
  const amount=Number(data.amount_cents);if(!Number.isSafeInteger(amount)||amount<1||amount>100000000000)fail(400,'Revisá el monto total a pagar.');
  const result=await db.prepare("INSERT INTO dues(chain_id,user_id,turn_number,amount_cents,updated) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM turns WHERE chain_id=? AND number=? AND completed IS NULL) AND NOT EXISTS(SELECT 1 FROM receipts WHERE chain_id=? AND user_id=? AND turn_number=?) ON CONFLICT(chain_id,user_id,turn_number) DO UPDATE SET amount_cents=excluded.amount_cents,updated=excluded.updated").bind(id,owner,turn,amount,now(),id,turn,id,owner,turn).run();if(!result.meta.changes)fail(409,'El monto queda fijo cuando se registra un pago en ese período.');return json({ok:true});
 }
 if(action==='group-approve'){
  const result=await db.prepare("UPDATE receipts SET state='approved',reviewed=? WHERE chain_id=? AND user_id=? AND turn_number=? AND state='pending' AND EXISTS(SELECT 1 FROM turns WHERE chain_id=? AND number=? AND completed IS NULL)").bind(now(),id,owner,turn,id,turn).run();if(!result.meta.changes)fail(409,'No hay comprobantes pendientes por aprobar.');return json({ok:true});
 }
 if(!['group-payments/file','group-payments/cash'].includes(action))fail(404,'Operación no disponible.');
 if((await all(db,'SELECT id FROM receipts WHERE chain_id=? AND user_id=? AND turn_number=?',id,owner,turn)).length)fail(409,'Esta persona ya tiene pagos registrados en el período. Revisalos antes de continuar.');
 const expected=(await first(db,'SELECT amount_cents FROM dues WHERE chain_id=? AND user_id=? AND turn_number=?',id,owner,turn))?.amount_cents??(m.contribution_cents??m.quantity*chain.amount_cents);
 const cash=action.endsWith('/cash'),stamp=now(),paidDate=cash?String(data.paid_date||''):null,note=cash?String(data.note||'').trim():null,today=new Date().toLocaleDateString('sv-SE',{timeZone:'America/Argentina/Buenos_Aires'});
 if(cash&&(!/^\d{4}-\d{2}-\d{2}$/.test(paidDate)||Number.isNaN(new Date(paidDate+'T12:00:00Z').getTime())||new Date(paidDate+'T12:00:00Z').toISOString().slice(0,10)!==paidDate||paidDate>today||note.length>300))fail(400,'Revisá la fecha y nota del efectivo recibido.');
 let key='',filename='Pago en efectivo',mime='application/octet-stream';if(!cash){if(!(file instanceof File)||file.size<1||file.size>5*1024*1024)fail(400,'Elegí un comprobante de hasta 5 MB.');const bytes=await file.arrayBuffer();if(!validFile(new Uint8Array(bytes),file.type))fail(400,'Usá un archivo JPG, PNG, WebP o PDF válido.');key=crypto.randomUUID();filename=file.name.slice(0,180);mime=file.type;await env.BUCKET.put(key,bytes,{httpMetadata:{contentType:mime}})}
 const group=crypto.randomUUID(),amounts=allocateContribution(expected,m);
 const condition="EXISTS(SELECT 1 FROM turns WHERE chain_id=? AND number=? AND completed IS NULL) AND EXISTS(SELECT 1 FROM members WHERE chain_id=? AND user_id=? AND state='active' AND quantity=? AND COALESCE(half_units,quantity*2)=?) AND COALESCE((SELECT amount_cents FROM dues WHERE chain_id=? AND user_id=? AND turn_number=?),?)=? AND NOT EXISTS(SELECT 1 FROM receipts WHERE chain_id=? AND user_id=? AND turn_number=? AND (group_id IS NULL OR group_id<>?))";
 const statements=Array.from({length:m.quantity},(_,i)=>db.prepare('INSERT INTO receipts(id,chain_id,turn_number,user_id,slot_number,r2_key,filename,mime,state,uploaded,reviewed,payment_method,paid_date,note,recorded_by,amount_cents,group_id) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE '+condition).bind(crypto.randomUUID(),id,turn,owner,i+1,key,filename,mime,cash?'approved':'pending',stamp,cash?stamp:null,cash?'cash':'transfer',paidDate,note,u.id,amounts[i],group,id,turn,id,owner,m.quantity,memberUnits(m),id,owner,turn,m.contribution_cents??m.quantity*chain.amount_cents,expected,id,owner,turn,group));
 try{const results=await db.batch(statements);if(results.some(r=>!r.meta.changes))fail(409,'El importe o los pagos cambiaron. Actualizá el período antes de continuar.')}catch(e){if(key)await env.BUCKET.delete(key);throw e}return json({ok:true,amount_cents:expected},201);
}
