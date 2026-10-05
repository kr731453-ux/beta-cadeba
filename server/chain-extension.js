import {chainTurns,memberUnits,slotUnits} from './seat-shares.js';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const first=(db,sql,...args)=>db.prepare(sql).bind(...args).first();
const all=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results;
export async function extendChain(env,u,chain,data,dates){
 const db=env.DB,id=chain.id;
 if(!['active','completed'].includes(chain.status)||chain.archived_at)fail(409,'Confirmá el orden o restaurá la cadena antes de ampliarla.');
 if(!Number.isInteger(data.revision)||data.revision!==chain.revision)fail(409,'La cadena cambió. Actualizala antes de ampliar.');
 if(!Array.isArray(data.additions)||!data.additions.length||data.additions.length>200)fail(400,'Agregá al menos un participante.');
 const turns=await chainTurns(env,id),completed=turns.filter(t=>t.completed),pending=turns.filter(t=>!t.completed),count=completed.length;
 if(turns.length!==chain.capacity||completed.some(t=>t.number>count))fail(409,'Revisá el calendario de la cadena antes de ampliarla.');
 const additions=[],keys=new Set(),users=new Set();
 for(const input of data.additions){
  const key=String(input.key||''),units=Number(input.quantity)*2,quantity=Math.ceil(units/2),amount=input.amount_cents===undefined?Math.round(chain.amount_cents*units/2):Number(input.amount_cents);
  if(!/^[\w-]{1,80}$/.test(key)||keys.has(key)||!Number.isSafeInteger(units)||units<1||units>200||!Number.isSafeInteger(amount)||amount<1||amount>100000000000)fail(400,'Revisá los participantes, puestos y montos nuevos.');keys.add(key);
  let person,isNew=false;if(input.user_id){person=await first(db,'SELECT id,name FROM users WHERE id=? AND created_by=?',String(input.user_id),u.id);if(!person||users.has(person.id)||await first(db,'SELECT user_id FROM members WHERE chain_id=? AND user_id=?',id,person.id)||await first(db,'SELECT user_id FROM admins WHERE user_id=?',person.id))fail(400,'Elegí personas que todavía no estén en esta cadena.');users.add(person.id)}else{const name=String(input.name||'').trim();if(!name||name.length>80)fail(400,'Escribí el nombre de cada participante.');person={id:'participant_'+crypto.randomUUID(),name};isNew=true}
  additions.push({...person,key,half_units:units,quantity,contribution_cents:amount,isNew});
 }
 const extra=additions.reduce((n,m)=>n+memberUnits(m),0)/2,newCapacity=chain.capacity+extra;
 if(!Number.isInteger(newCapacity)||newCapacity>100)fail(400,'Completá las parejas de medios puestos. La cadena admite hasta 100 puestos.');
 const pieces=pending.flatMap(t=>t.participants.map(p=>({...p,key:p.user_id+':'+p.slot_number,actual:p.user_id}))).concat(additions.flatMap(m=>Array.from({length:m.quantity},(_,i)=>({key:m.key+':'+(i+1),actual:m.id,user_id:m.key,slot_number:i+1,half_units:slotUnits(m,i+1)}))));
 if(!Array.isArray(data.order)||data.order.length!==newCapacity-count)fail(400,'Incluí todos los cobros pendientes y nuevos.');
 const used=new Set(),groups=data.order.map(g=>g?.participants);
 for(const group of groups){if(!Array.isArray(group)||group.length<1||group.length>2)fail(400,'Cada cobro corresponde a un puesto completo o dos medios.');let units=0;for(const p of group){const key=p?.user_id+':'+p?.slot_number,piece=pieces.find(x=>x.key===key);if(!piece||used.has(key))fail(400,'Incluí cada puesto pendiente exactamente una vez.');used.add(key);units+=piece.half_units}if(units!==2)fail(400,'Cada medio puesto necesita su pareja.');}
 if(used.size!==pieces.length)fail(400,'Faltan puestos pendientes por ubicar.');
 const token=crypto.randomUUID(),stamp=new Date().toISOString(),guard='EXISTS(SELECT 1 FROM chains WHERE id=? AND edit_token=?)';
 const statements=[db.prepare("UPDATE chains SET capacity=?,status='active',revision=revision+1,edit_token=? WHERE id=? AND revision=? AND capacity=? AND status=? AND archived_at IS NULL AND (SELECT COUNT(*) FROM turns WHERE chain_id=? AND completed IS NOT NULL)=?").bind(newCapacity,token,id,data.revision,chain.capacity,chain.status,id,count)];
 for(const m of additions){
  if(m.isNew)statements.push(db.prepare('INSERT INTO users(id,name,created,created_by) SELECT ?,?,?,? WHERE '+guard).bind(m.id,m.name,stamp,u.id,id,token));
  statements.push(db.prepare("INSERT INTO members(chain_id,user_id,quantity,half_units,contribution_cents,added_after_turn,state,joined) SELECT ?,?,?,?,?,?,'active',? WHERE "+guard).bind(id,m.id,m.quantity,m.half_units,m.contribution_cents,count,stamp,id,token));
  statements.push(db.prepare("INSERT INTO access_requests(user_id,state,created,reviewed) SELECT ?,'approved',?,? WHERE "+guard+" ON CONFLICT(user_id) DO UPDATE SET state='approved',reviewed=excluded.reviewed").bind(m.id,stamp,stamp,id,token));
 }
 // Period numbers and their existing payments stay in place; only unpaid beneficiaries move.
 statements.push(db.prepare('UPDATE turns SET slot_number=-number WHERE chain_id=? AND completed IS NULL AND '+guard).bind(id,id,token));
 statements.push(db.prepare('DELETE FROM turn_shares WHERE chain_id=? AND turn_number>? AND '+guard).bind(id,count,id,token));
 groups.forEach((group,i)=>{
  const n=count+i+1,parts=group.map(p=>pieces.find(x=>x.key===p.user_id+':'+p.slot_number)),p=parts[0];
  statements.push(db.prepare('INSERT INTO turns(chain_id,number,user_id,slot_number,date) SELECT ?,?,?,?,? WHERE '+guard+' ON CONFLICT(chain_id,number) DO UPDATE SET user_id=excluded.user_id,slot_number=excluded.slot_number,date=excluded.date WHERE turns.completed IS NULL').bind(id,n,p.actual,p.slot_number,dates[n-1],id,token));
  parts.forEach((p,position)=>statements.push(db.prepare('INSERT INTO turn_shares(chain_id,turn_number,user_id,slot_number,half_units,position) SELECT ?,?,?,?,?,? WHERE '+guard).bind(id,n,p.actual,p.slot_number,p.half_units,position,id,token)));
 });
 const results=await db.batch(statements);if(!results[0].meta.changes)fail(409,'Se registró un cobro o cambió la cadena. Actualizá y revisá el nuevo calendario.');
 return {ok:true,capacity:newCapacity,added:additions.length};
}
export async function recordExtraDelivery(env,u,chain,data){
 const db=env.DB,id=chain.id,n=Number(data.turn_number),owner=String(data.user_id||''),amount=Number(data.amount_cents),date=String(data.paid_date||''),note=String(data.note||'').trim(),today=new Date().toLocaleDateString('sv-SE',{timeZone:'America/Argentina/Buenos_Aires'});
 if(!Number.isSafeInteger(amount)||amount<1||!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(new Date(date+'T12:00:00Z').getTime())||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date||date>today||note.length>300)fail(400,'Revisá el importe, fecha y nota de la entrega.');
 const turn=(await chainTurns(env,id)).find(t=>t.number===n),part=turn?.participants.find(p=>p.user_id===owner);if(!turn?.completed||!part)fail(409,'Elegí a un destinatario de un cobro ya realizado.');
 const total=(await first(db,"SELECT COALESCE(SUM(amount_cents),0) n FROM receipts WHERE chain_id=? AND turn_number=? AND is_arrear=1 AND state='approved'",id,n)).n;
 const previous=(await first(db,'SELECT COALESCE(SUM(amount_cents),0) n FROM extra_deliveries WHERE chain_id=? AND turn_number=? AND user_id=?',id,n,owner)).n;
 const allocation=turn.participants.length===1?total:Math.floor(total/2)+(turn.participants[0].user_id===owner?total%2:0),pending=allocation-previous;
 if(!Number.isSafeInteger(data.expected_delivered)||data.expected_delivered!==previous||amount!==pending||pending<=0)fail(409,'El saldo adicional cambió o ya fue entregado. Actualizá el período.');
 const result=await db.prepare("INSERT INTO extra_deliveries(id,chain_id,turn_number,user_id,amount_cents,paid_date,note,recorded_by,created) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM chains WHERE id=? AND archived_at IS NULL) AND (SELECT COALESCE(SUM(amount_cents),0) FROM receipts WHERE chain_id=? AND turn_number=? AND is_arrear=1 AND state='approved')=? AND (SELECT COALESCE(SUM(amount_cents),0) FROM extra_deliveries WHERE chain_id=? AND turn_number=? AND user_id=?)=?").bind(crypto.randomUUID(),id,n,owner,amount,date,note,u.id,new Date().toISOString(),id,id,n,total,id,n,owner,previous).run();
 if(!result.meta.changes)fail(409,'El saldo adicional cambió. Actualizá el período.');return {ok:true};
}
