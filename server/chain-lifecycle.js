const fail=(status,message)=>{throw Object.assign(new Error(message),{status})};
const all=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results;
// A durable queue keeps orphaned attachments retryable if storage is temporarily unavailable.
export async function cleanDeletedFiles(env){
 const rows=await all(env.DB,'SELECT key FROM file_deletions ORDER BY created LIMIT 100');
 for(let i=0;i<rows.length;i+=10)await Promise.all(rows.slice(i,i+10).map(async({key})=>{try{
  if(!await env.DB.prepare('SELECT id FROM receipts WHERE r2_key=? LIMIT 1').bind(key).first())await env.BUCKET.delete(key);
  await env.DB.prepare('DELETE FROM file_deletions WHERE key=?').bind(key).run();
 }catch{/* Retry on the next administrator refresh. */}}));
}
export async function manageChain(request,env,chain,action){
 const db=env.DB,id=chain.id;
 if(action==='archive'||action==='restore'){
  const result=await db.prepare(`UPDATE chains SET archived_at=? WHERE id=? AND archived_at IS ${action==='archive'?'NULL':'NOT NULL'}`).bind(action==='archive'?new Date().toISOString():null,id).run();
  if(!result.meta.changes)fail(409,'La cadena cambió de estado. Actualizá el panel.');
  return {ok:true};
 }
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))fail(415,'Confirmá el nombre de la cadena.');
 const data=await request.json();if(data?.confirmation!==chain.name)fail(400,'Escribí el nombre exacto de la cadena para eliminarla.');
 const stamp=new Date().toISOString();
 // Delete only this chain. Shared people and their other chains are preserved.
 await db.batch([
  db.prepare("INSERT OR IGNORE INTO file_deletions(key,created) SELECT DISTINCT r2_key,? FROM receipts r WHERE chain_id=? AND r2_key<>'' AND NOT EXISTS(SELECT 1 FROM receipts other WHERE other.r2_key=r.r2_key AND other.chain_id<>?)").bind(stamp,id,id),
  ...['chain_notes','extra_deliveries','dues','receipts','turn_shares','turns','members'].map(table=>db.prepare(`DELETE FROM ${table} WHERE chain_id=?`).bind(id)),
  db.prepare('DELETE FROM chains WHERE id=?').bind(id)
 ]);
 await cleanDeletedFiles(env);return {ok:true};
}
