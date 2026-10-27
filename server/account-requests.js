import { digest, rate } from './admin-auth.js';
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
const first = (db, sql, ...args) =>
  db
    .prepare(sql)
    .bind(...args)
    .first();
export async function registerAccount(request, env) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json'))
    fail(415, 'Datos de registro inválidos.');
  await rate(
    request,
    env,
    'registration:' + (request.headers.get('CF-Connecting-IP') || 'unknown'),
  );
  const data = await request.json(),
    name = String(data?.name || '').trim(),
    username = String(data?.username || '')
      .trim()
      .toLowerCase(),
    password = String(data?.password || '');
  if (!name || name.length > 80) fail(400, 'Escribí tu nombre y apellido.');
  if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username))
    fail(400, 'Usá entre 3 y 40 letras, números, puntos, guiones o guiones bajos para el usuario.');
  if (password.length < 12 || password.length > 128)
    fail(400, 'La contraseña debe tener entre 12 y 128 caracteres.');
  if (await first(env.DB, 'SELECT user_id FROM admin_credentials WHERE username=?', username))
    fail(409, 'Ese usuario ya está en uso. Elegí otro.');
  const id = 'account_' + crypto.randomUUID(),
    stamp = new Date().toISOString(),
    salt = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))),
    value = await digest(password, salt, env);
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO users(id,name,created) VALUES(?,?,?)').bind(id, name, stamp),
      env.DB.prepare(
        'INSERT INTO admin_credentials(user_id,username,digest,salt,updated) VALUES(?,?,?,?,?)',
      ).bind(id, username, value, salt, stamp),
      env.DB.prepare(
        "INSERT INTO account_requests(user_id,state,created) VALUES(?,'pending',?)",
      ).bind(id, stamp),
    ]);
  } catch (e) {
    if (e.message?.includes('UNIQUE')) fail(409, 'Ese usuario ya está en uso. Elegí otro.');
    throw e;
  }
  return json({ ok: true, state: 'pending' }, 201);
}
export async function accountRequests(request, env, u, url) {
  if (!u.owner) fail(403, 'Solo el propietario puede autorizar nuevas cuentas.');
  const db = env.DB;
  if (url.pathname === '/api/admin/accounts' && request.method === 'GET')
    return json(
      (
        await db
          .prepare(
            "SELECT r.user_id,r.state,r.created,r.reviewed,u.name,c.username FROM account_requests r JOIN users u ON u.id=r.user_id JOIN admin_credentials c ON c.user_id=r.user_id ORDER BY CASE r.state WHEN 'pending' THEN 0 ELSE 1 END,r.created DESC",
          )
          .all()
      ).results,
    );
  const match = url.pathname.match(/^\/api\/admin\/accounts\/([\w-]+)\/(approve|reject)$/);
  if (!match || request.method !== 'POST') fail(404, 'La operación no existe.');
  const id = match[1],
    approved = match[2] === 'approve',
    stamp = new Date().toISOString();
  if (!(await first(db, 'SELECT user_id FROM account_requests WHERE user_id=?', id)))
    fail(404, 'La solicitud no existe.');
  if (await first(db, "SELECT user_id FROM admins WHERE user_id=? AND role='owner'", id))
    fail(403, 'No se puede cambiar el acceso del propietario.');
  // The decision and account permissions change atomically. Revocation invalidates every session.
  await db.batch([
    db
      .prepare('UPDATE account_requests SET state=?,reviewed=?,reviewed_by=? WHERE user_id=?')
      .bind(approved ? 'approved' : 'rejected', stamp, u.id, id),
    approved
      ? db.prepare("INSERT OR IGNORE INTO admins(user_id,role) VALUES(?,'manager')").bind(id)
      : db.prepare("DELETE FROM admins WHERE user_id=? AND role='manager'").bind(id),
    db.prepare('DELETE FROM sessions WHERE user_id=?').bind(id),
    db.prepare('UPDATE admin_sessions SET revoked=1 WHERE user_id=?').bind(id),
  ]);
  return json({ ok: true, state: approved ? 'approved' : 'rejected' });
}
