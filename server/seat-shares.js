export const memberUnits=m=>m.half_units??m.quantity*2;
export const slotUnits=(m,slot)=>slot===m.quantity&&memberUnits(m)%2?1:2;
// Allocate integer cents proportionally, keeping the exact recorded total.
export function allocateContribution(total,m){
 const units=memberUnits(m),parts=Array.from({length:m.quantity},(_,i)=>Math.floor(total*slotUnits(m,i+1)/units));
 let remainder=total-parts.reduce((n,p)=>n+p,0);for(let i=0;remainder>0;i=(i+1)%parts.length,remainder--)parts[i]++;
 return parts;
}
export async function chainTurns(env,id){
 const turns=(await env.DB.prepare('SELECT t.number,t.user_id,t.slot_number,t.date,t.completed,u.name FROM turns t JOIN users u ON u.id=t.user_id WHERE t.chain_id=? ORDER BY t.number').bind(id).all()).results;
 const shares=(await env.DB.prepare('SELECT s.turn_number,s.user_id,s.slot_number,s.half_units,u.name FROM turn_shares s JOIN users u ON u.id=s.user_id WHERE s.chain_id=? ORDER BY s.turn_number,s.position').bind(id).all()).results;
 return turns.map(t=>({...t,participants:shares.filter(s=>s.turn_number===t.number).map(({turn_number,...s})=>s).length?shares.filter(s=>s.turn_number===t.number).map(({turn_number,...s})=>s):[{user_id:t.user_id,slot_number:t.slot_number,half_units:2,name:t.name}]}));
}
export async function saveSharedOrder(env,chain,order,dates){
 const fail=(status,message)=>{throw Object.assign(new Error(message),{status})},db=env.DB,id=chain.id;
 const members=(await db.prepare("SELECT user_id,quantity,half_units FROM members WHERE chain_id=? AND state='active'").bind(id).all()).results;
 const pieces=members.flatMap(m=>Array.from({length:m.quantity},(_,i)=>({user_id:m.user_id,slot_number:i+1,half_units:slotUnits(m,i+1)})));
 if(chain.status!=='draft'||members.reduce((n,m)=>n+memberUnits(m),0)!==chain.capacity*2)fail(409,'Completá todos los puestos, incluidos los medios puestos, antes de confirmar el orden.');
 if(!Array.isArray(order)||order.length!==chain.capacity)fail(400,'Revisá el orden de todos los turnos de cobro.');
 const groups=order.map(p=>Array.isArray(p?.participants)?p.participants:[p]),used=new Set();
 for(const group of groups){if(group.length<1||group.length>2)fail(400,'Cada turno debe tener un puesto completo o dos medios puestos.');let sum=0;
  for(const p of group){const piece=pieces.find(s=>s.user_id===p?.user_id&&s.slot_number===p?.slot_number),key=p?.user_id+':'+p?.slot_number;if(!piece||used.has(key))fail(400,'Incluí cada puesto o medio puesto exactamente una vez.');used.add(key);sum+=piece.half_units;}
  if(sum!==2)fail(400,'Uní dos medios puestos en el mismo turno. Un puesto completo cobra solo.');
 }
 if(used.size!==pieces.length)fail(400,'Faltan puestos o medios puestos en el orden de cobro.');
 const draw='manual_'+crypto.randomUUID(),guard=members.map(()=>" AND EXISTS(SELECT 1 FROM members WHERE chain_id=? AND user_id=? AND quantity=? AND COALESCE(half_units,quantity*2)=? AND state='active')").join('');
 const statements=[db.prepare("UPDATE chains SET status='active',draw_id=? WHERE id=? AND status='draft' AND archived_at IS NULL AND (SELECT COALESCE(SUM(COALESCE(half_units,quantity*2)),0) FROM members WHERE chain_id=? AND state='active')=capacity*2"+guard).bind(draw,id,id,...members.flatMap(m=>[id,m.user_id,m.quantity,memberUnits(m)]))];
 groups.forEach((group,i)=>{
  const p=group[0];statements.push(db.prepare('INSERT INTO turns(chain_id,number,user_id,slot_number,date) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM chains WHERE id=? AND draw_id=?)').bind(id,i+1,p.user_id,p.slot_number,dates[i],id,draw));
  group.forEach((p,position)=>{const piece=pieces.find(s=>s.user_id===p.user_id&&s.slot_number===p.slot_number);statements.push(db.prepare('INSERT INTO turn_shares(chain_id,turn_number,user_id,slot_number,half_units,position) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM chains WHERE id=? AND draw_id=?)').bind(id,i+1,p.user_id,p.slot_number,piece.half_units,position,id,draw))});
 });
 const result=await db.batch(statements);if(!result[0].meta.changes)fail(409,'El grupo cambió o el orden ya fue confirmado. Actualizá la cadena.');
}
