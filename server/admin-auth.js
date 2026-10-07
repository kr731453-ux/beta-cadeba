const now = () => new Date().toISOString();
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const bytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const random = () =>
  b64(crypto.getRandomValues(new Uint8Array(32)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const hash = async (text) =>
  b64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const first = (db, sql, ...args) =>
  db
    .prepare(sql)
    .bind(...args)
    .first();
const run = (db, sql, ...args) =>
  db
    .prepare(sql)
    .bind(...args)
    .run();
const equal = (a, b) => {
  let different = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    different |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return different === 0;
};
export async function digest(password, salt, env) {
  if (!env.PASSWORD_PEPPER) fail(503, 'El ingreso con contraseña todavía no está disponible.');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: bytes(salt), iterations: 100000 },
    key,
    256,
  );
  const pepper = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.PASSWORD_PEPPER),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return b64(new Uint8Array(await crypto.subtle.sign('HMAC', pepper, derived)));
}
export const cookieToken = (request) =>
  (/(?:^|;\s*)__Host-ronda_admin=([A-Za-z0-9_-]{43})(?:;|$)/.exec(
    request.headers.get('Cookie') || '',
  ) || [])[1] || '';
const cookie = (token) =>
  `__Host-ronda_admin=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${token ? 30 * 86400 : 0}`;
const json = (data, token) =>
  new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...(token !== undefined ? { 'Set-Cookie': cookie(token) } : {}),
    },
  });
async function session(env, id) {
  const token = random();
  await run(env.DB, 'DELETE FROM sessions WHERE expires<?', Date.now());
  await run(
    env.DB,
    'INSERT INTO sessions(token_hash,user_id,expires) VALUES(?,?,?)',
    await hash(token),
    id,
    Date.now() + 30 * 86400000,
  );
  return token;
}
export async function rate(request, env, username) {
  const bucket = Math.floor(Date.now() / 900000),
    ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  await run(env.DB, 'DELETE FROM login_limits WHERE expires<?', Date.now());
  for (const [scope, limit] of [
    ['account:' + username, 8],
    ['ip:' + ip, 20],
  ]) {
    const key = await hash('admin:' + scope + ':' + bucket),
      r = await first(
        env.DB,
        'INSERT INTO login_limits(key,attempts,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1 RETURNING attempts',
        key,
        Date.now() + 900000,
      );
    if (r.attempts > limit)
      fail(429, 'Demasiados intentos. Esperá 15 minutos antes de volver a probar.');
  }
}
async function input(request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json'))
    fail(415, 'Datos de ingreso inválidos.');
  const value = await request.json();
  if (!value || typeof value !== 'object') fail(400, 'Datos de ingreso inválidos.');
  return value;
}
export async function passwordLogin(request, env) {
  const data = await input(request),
    username = String(data.username || '')
      .trim()
      .toLowerCase(),
    password = String(data.password || '');
  await rate(request, env, username.slice(0, 40));
  if (password.length > 128 || username.length > 40) fail(401, 'Usuario o contraseña incorrectos.');
  const row = await first(
    env.DB,
    'SELECT c.*,a.user_id AS permitted,r.state AS request_state FROM admin_credentials c LEFT JOIN admins a ON a.user_id=c.user_id LEFT JOIN account_requests r ON r.user_id=c.user_id WHERE c.username=?',
    username,
  );
  const candidate = await digest(password, row?.salt || b64(new Uint8Array(32)), env);
  if (!row || !equal(candidate, row.digest)) fail(401, 'Usuario o contraseña incorrectos.');
  if (!row.permitted)
    fail(
      403,
      row.request_state === 'pending'
        ? 'Tu solicitud está pendiente de aprobación.'
        : 'Tu cuenta no tiene acceso autorizado.',
    );
  return json({ ok: true }, await session(env, row.user_id));
}
export async function cookieUser(request, env) {
  const token = cookieToken(request);
  if (!token) return null;
  const row = await first(
    env.DB,
    'SELECT u.id,u.name,a.role FROM sessions s JOIN users u ON u.id=s.user_id JOIN admins a ON a.user_id=u.id WHERE s.token_hash=? AND s.expires>?',
    await hash(token),
    Date.now(),
  );
  return row ? { ...row, admin: true, owner: row.role === 'owner', auth: 'password' } : null;
}
export async function passwordCredentials(request, env, u) {
  const row = await first(
    env.DB,
    'SELECT username,digest,salt FROM admin_credentials WHERE user_id=?',
    u.id,
  );
  if (request.method === 'GET')
    return json({
      configured: !!row,
      username: row?.username || '',
      requires_current: !!row && u.auth !== 'platform',
    });
  if (request.method !== 'POST') fail(405, 'Operación no disponible.');
  const data = await input(request),
    username = String(data.username || '')
      .trim()
      .toLowerCase(),
    password = String(data.password || '');
  if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username))
    fail(400, 'Usá entre 3 y 40 letras, números, puntos, guiones o guiones bajos para el usuario.');
  if (password.length < 12 || password.length > 128)
    fail(400, 'La contraseña debe tener entre 12 y 128 caracteres.');
  if (row && u.auth !== 'platform') {
    await rate(request, env, row.username);
    if (!equal(await digest(String(data.current_password || ''), row.salt, env), row.digest))
      fail(401, 'La contraseña actual no es correcta.');
  }
  const other = await first(
    env.DB,
    'SELECT user_id FROM admin_credentials WHERE username=? AND user_id<>?',
    username,
    u.id,
  );
  if (other) fail(409, 'Ese usuario ya está en uso.');
  const salt = b64(crypto.getRandomValues(new Uint8Array(32))),
    value = await digest(password, salt, env);
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO admin_credentials(user_id,username,digest,salt,updated) VALUES(?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET username=excluded.username,digest=excluded.digest,salt=excluded.salt,updated=excluded.updated',
    ).bind(u.id, username, value, salt, now()),
    env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(u.id),
  ]);
  return json({ ok: true, username }, await session(env, u.id));
}
export async function passwordLogout(request, env) {
  const token = cookieToken(request);
  if (token) await run(env.DB, 'DELETE FROM sessions WHERE token_hash=?', await hash(token));
  return json({ ok: true }, '');
}
