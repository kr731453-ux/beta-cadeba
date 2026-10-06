import {noteRegistry,groupNotePeople} from './note-people.js';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const json=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const clean=(value,max,label)=>{if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value))fail(400,'Revisá '+label+'.');return value.trim()};
const validDate=date=>!date||/^\d{4}-\d{2}-\d{2}$/.test(date)&&!Number.isNaN(new Date(date+'T12:00:00Z').getTime())&&new Date(date+'T12:00:00Z').toISOString().slice(0,10)===date;
export async function chainNotes(request,env,chain){
 const current=await env.DB.prepare('SELECT data,revision,updated FROM chain_notes WHERE chain_id=?').bind(chain.id).first(),people=await noteRegistry(env,chain);
 if(request.method==='GET')return json({...groupNotePeople(current?JSON.parse(current.data):{rows:[]},people).value,revision:current?.revision||0,updated:current?.updated||null});
 if(request.method!=='POST')fail(405,'La operación no está disponible.');if(chain.archived_at)fail(409,'Restaurá la cadena para modificar sus notas.');
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))fail(415,'Datos de notas inválidos.');const input=await request.json();
 if(!input||!Array.isArray(input.rows)||input.rows.length>500||!Number.isSafeInteger(input.revision)||input.revision<0)fail(400,'La lista admite hasta 500 participantes. Revisá sus datos.');
 if(input.revision!==(current?.revision||0))fail(409,'Las notas cambiaron en otro dispositivo. Recargá la lista antes de guardar.');
 const ids=new Set();for(const r of input.rows){if(!/^[\w-]{1,80}$/.test(r?.id||'')||ids.has(r.id))fail(400,'Revisá los participantes de la lista.');ids.add(r.id);if(!clean(r.name,80,'el nombre'))fail(400,'Escribí el nombre.');clean(r.note,3000,'las observaciones');const dates=Array.isArray(r.dates)?r.dates:[String(r.date||'')];if(dates.length>500||dates.some(d=>typeof d!=='string'||!validDate(d)))fail(400,'Revisá las fechas de cobro.');}
 const grouped=groupNotePeople(input,people,{writing:true}),value=grouped.value;value.title=clean(input.title,80,'el título');value.note=clean(input.note,3000,'la nota general');if(!value.title)fail(400,'Escribí un título.');
 for(const row of value.rows)if(row.note.length>10000)fail(400,'Las observaciones de una persona son demasiado largas.');
 const updated=new Date().toISOString(),token=crypto.randomUUID(),statements=[env.DB.prepare('INSERT INTO chain_notes(chain_id,data,revision,edit_token,updated) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM chains WHERE id=? AND archived_at IS NULL) ON CONFLICT(chain_id) DO UPDATE SET data=excluded.data,revision=excluded.revision,edit_token=excluded.edit_token,updated=excluded.updated WHERE chain_notes.revision=?').bind(chain.id,JSON.stringify(value),input.revision+1,token,updated,chain.id,input.revision)];
 for(const profile of grouped.updates)statements.push(env.DB.prepare('UPDATE users SET name=?,dni=? WHERE id=? AND created_by=? AND EXISTS(SELECT 1 FROM chain_notes WHERE chain_id=? AND edit_token=?)').bind(profile.name,profile.dni,profile.id,chain.owner_id,chain.id,token));
 const result=await env.DB.batch(statements);if(!result[0].meta.changes)fail(409,'Las notas cambiaron o la cadena fue archivada. Actualizá la lista.');return json({...value,revision:input.revision+1,updated});
}
