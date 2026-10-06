const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const json=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const clean=(value,max,label)=>{if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value))fail(400,'Revisá '+label+'.');return value.trim()};
export async function chainNotes(request,env,chain){
 const current=await env.DB.prepare('SELECT data,revision,updated FROM chain_notes WHERE chain_id=?').bind(chain.id).first();
 if(request.method==='GET')return json({...current?JSON.parse(current.data):{title:'Lista de cobro',note:'',rows:[]},revision:current?.revision||0,updated:current?.updated||null});
 if(request.method!=='POST')fail(405,'La operación no está disponible.');
 if(chain.archived_at)fail(409,'Restaurá la cadena para modificar sus notas.');
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))fail(415,'Datos de notas inválidos.');
 const input=await request.json();if(!input||!Array.isArray(input.rows)||input.rows.length>500||!Number.isSafeInteger(input.revision)||input.revision<0)fail(400,'La lista admite hasta 500 filas. Revisá sus datos.');
 if(input.revision!==(current?.revision||0))fail(409,'Las notas cambiaron en otro dispositivo. Recargá la lista antes de guardar.');
 const title=clean(input.title,80,'el título'),note=clean(input.note,3000,'la nota general'),ids=new Set();if(!title)fail(400,'Escribí un título para la lista.');
 const rows=input.rows.map(row=>{const id=String(row?.id||''),name=clean(row?.name,80,'el nombre'),date=String(row?.date||''),quantity=Number(row?.quantity),note=clean(row?.note,400,'las observaciones');
  if(!/^[\w-]{1,80}$/.test(id)||ids.has(id)||!name||!Number.isSafeInteger(quantity*2)||quantity<.5||quantity>100)fail(400,'Revisá los nombres y puestos de la lista.');ids.add(id);
  if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(new Date(date+'T12:00:00Z').getTime())||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date))fail(400,'Revisá las fechas de cobro.');return{id,name,date,quantity,note};
 });
 const updated=new Date().toISOString(),value={title,note,rows},result=await env.DB.prepare('INSERT INTO chain_notes(chain_id,data,revision,updated) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM chains WHERE id=? AND archived_at IS NULL) ON CONFLICT(chain_id) DO UPDATE SET data=excluded.data,revision=excluded.revision,updated=excluded.updated WHERE chain_notes.revision=?').bind(chain.id,JSON.stringify(value),input.revision+1,updated,chain.id,input.revision).run();
 if(!result.meta.changes)fail(409,'Las notas cambiaron o la cadena fue archivada. Actualizá la lista.');return json({...value,revision:input.revision+1,updated});
}
