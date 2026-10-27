// Administrator credentials only. The Sites/ChatGPT identity integration remains separate.
const ACCESS_SECONDS = 15 * 60;
const SESSION_MS = 30 * 86400000;
const AUDIENCE = 'ronda-admin';
const enc = new TextEncoder();
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const b64 = (bytes) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const decode = (s) =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const encodeJSON = (value) => b64(enc.encode(JSON.stringify(value)));
const random = () => b64(crypto.getRandomValues(new Uint8Array(32)));
export const tokenHash = async (value) =>
  b64(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(value))));
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
const readCookie = (request, name) =>
  (request.headers.get('Cookie') || '')
    .split(';')
    .map((v) => v.trim())
    .find((v) => v.startsWith(name + '='))
    ?.slice(name.length + 1) || '';
const cookie = (name, value, age) =>
  `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
const ACCESS = '__Host-ronda_access',
  REFRESH = '__Host-ronda_refresh';
const LEGACY = '__Host-ronda_admin';
let cachedKeys;

async function keys(env) {
  // Only server configuration can supply keys; never follow a token's jku/x5u URL.
  if (!env.AUTH_PRIVATE_JWK || !env.AUTH_JWKS || !env.AUTH_ISSUER)
    fail(503, 'El servicio de sesiones no está configurado.');
  if (cachedKeys?.source === env.AUTH_PRIVATE_JWK && cachedKeys?.publicSource === env.AUTH_JWKS)
    return cachedKeys.promise;
  const promise = (async () => {
    const privateJwk = JSON.parse(env.AUTH_PRIVATE_JWK),
      publicSet = JSON.parse(env.AUTH_JWKS);
    if (
      privateJwk.kty !== 'RSA' ||
      !privateJwk.kid ||
      !Array.isArray(publicSet.keys) ||
      publicSet.keys.length > 5
    )
      throw Error('Invalid signing configuration');
    const publicKeys = new Map();
    const published = [];
    for (const jwk of publicSet.keys) {
      if (
        jwk.kty !== 'RSA' ||
        jwk.alg !== 'RS256' ||
        jwk.use !== 'sig' ||
        !jwk.kid ||
        jwk.d ||
        publicKeys.has(jwk.kid) ||
        decode(jwk.n).length < 256
      )
        throw Error('Invalid JWKS configuration');
      const safe = { kty: 'RSA', n: jwk.n, e: jwk.e, kid: jwk.kid, alg: 'RS256', use: 'sig' };
      published.push(safe);
      publicKeys.set(
        jwk.kid,
        await crypto.subtle.importKey(
          'jwk',
          safe,
          { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
          false,
          ['verify'],
        ),
      );
    }
    const current = published.find((k) => k.kid === privateJwk.kid);
    if (!current || current.n !== privateJwk.n || current.e !== privateJwk.e)
      throw Error('Signing key missing from JWKS');
    const signing = await crypto.subtle.importKey(
      'jwk',
      privateJwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    return { signing, kid: privateJwk.kid, publicKeys, published };
  })();
  cachedKeys = { source: env.AUTH_PRIVATE_JWK, publicSource: env.AUTH_JWKS, promise };
  try {
    return await promise;
  } catch {
    cachedKeys = null;
    fail(503, 'El servicio de sesiones no está disponible.');
  }
}

export async function jwksResponse(env) {
  return Response.json(
    { keys: (await keys(env)).published },
    { headers: { 'Cache-Control': 'public, max-age=300' } },
  );
}
async function sign(env, id, userId) {
  const { signing, kid } = await keys(env),
    now = Math.floor(Date.now() / 1000);
  const input =
    encodeJSON({ alg: 'RS256', typ: 'JWT', kid }) +
    '.' +
    encodeJSON({
      iss: env.AUTH_ISSUER,
      aud: AUDIENCE,
      sub: userId,
      sid: id,
      iat: now,
      exp: now + ACCESS_SECONDS,
    });
  return (
    input +
    '.' +
    b64(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signing, enc.encode(input))))
  );
}
export async function verifyAccess(token, env) {
  if (!token || token.length > 4096) return null;
  const { publicKeys } = await keys(env);
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return null;
    const header = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    if (
      header.alg !== 'RS256' ||
      header.typ !== 'JWT' ||
      header.crit ||
      !publicKeys.has(header.kid)
    )
      return null;
    if (
      !(await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5',
        publicKeys.get(header.kid),
        decode(parts[2]),
        enc.encode(parts[0] + '.' + parts[1]),
      ))
    )
      return null;
    const payload = JSON.parse(new TextDecoder().decode(decode(parts[1]))),
      now = Math.floor(Date.now() / 1000);
    if (
      payload.iss !== env.AUTH_ISSUER ||
      payload.aud !== AUDIENCE ||
      typeof payload.sub !== 'string' ||
      typeof payload.sid !== 'string' ||
      !Number.isInteger(payload.iat) ||
      !Number.isInteger(payload.exp) ||
      payload.exp <= now ||
      payload.exp <= payload.iat ||
      payload.iat > now + 30 ||
      payload.exp - payload.iat > ACCESS_SECONDS ||
      (payload.nbf !== undefined && (!Number.isInteger(payload.nbf) || payload.nbf > now))
    )
      return null;
    return payload;
  } catch {
    return null;
  }
}

function response(data, access, refresh, expires) {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', cookie(ACCESS, access, access ? ACCESS_SECONDS : 0));
  headers.append(
    'Set-Cookie',
    cookie(REFRESH, refresh, refresh ? Math.max(0, Math.floor((expires - Date.now()) / 1000)) : 0),
  );
  headers.append('Set-Cookie', cookie(LEGACY, '', 0));
  return new Response(JSON.stringify(data), { headers });
}
export async function newSession(env, userId, data = { ok: true }, legacyHash = null) {
  const id = crypto.randomUUID(),
    refresh = random(),
    hash = await tokenHash(refresh),
    expires = Date.now() + SESSION_MS;
  const access = await sign(env, id, userId);
  const statements = [
    legacyHash
      ? env.DB.prepare(
          'INSERT INTO admin_sessions(id,user_id,refresh_hash,expires) SELECT ?,user_id,?,? FROM sessions WHERE token_hash=? AND user_id=? AND expires>?',
        ).bind(id, hash, expires, legacyHash, userId, Date.now())
      : env.DB.prepare(
          'INSERT INTO admin_sessions(id,user_id,refresh_hash,expires) VALUES(?,?,?,?)',
        ).bind(id, userId, hash, expires),
    env.DB.prepare(
      'INSERT INTO admin_refresh_tokens(token_hash,session_id) SELECT ?,id FROM admin_sessions WHERE id=?',
    ).bind(hash, id),
  ];
  if (legacyHash)
    statements.push(env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(legacyHash));
  const result = await env.DB.batch(statements);
  if (!result[0].meta.changes) fail(401, 'La sesión anterior ya fue renovada.');
  return response(data, access, refresh, expires);
}
export async function sessionUser(request, env) {
  const claims = await verifyAccess(readCookie(request, ACCESS), env);
  if (!claims) return null;
  // Membership and revocation remain authoritative even while a signed token is valid.
  const row = await first(
    env.DB,
    'SELECT u.id,u.name,a.role FROM admin_sessions s JOIN users u ON u.id=s.user_id JOIN admins a ON a.user_id=u.id WHERE s.id=? AND s.user_id=? AND s.expires>? AND s.revoked=0',
    claims.sid,
    claims.sub,
    Date.now(),
  );
  return row ? { ...row, admin: true, owner: row.role === 'owner', auth: 'password' } : null;
}
export function requireSessionOrigin(request) {
  if (request.headers.get('Origin') !== new URL(request.url).origin)
    fail(403, 'Origen de la solicitud no autorizado.');
}
export async function refreshSession(request, env) {
  requireSessionOrigin(request);
  const token = readCookie(request, REFRESH);
  if (!token) {
    // Upgrade an existing password session without asking the administrator to log in again.
    const legacy = readCookie(request, LEGACY);
    if (/^[A-Za-z0-9_-]{43}$/.test(legacy)) {
      const hash = await tokenHash(legacy);
      const row = await first(
        env.DB,
        'SELECT s.user_id FROM sessions s JOIN admins a ON a.user_id=s.user_id WHERE s.token_hash=? AND s.expires>?',
        hash,
        Date.now(),
      );
      if (row) return newSession(env, row.user_id, { ok: true }, hash);
    }
    fail(401, 'Tu sesión venció. Ingresá nuevamente.');
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) fail(401, 'Sesión inválida.');
  const oldHash = await tokenHash(token);
  const row = await first(
    env.DB,
    'SELECT t.used_at,t.session_id,s.user_id,s.expires,s.revoked,s.refresh_hash FROM admin_refresh_tokens t JOIN admin_sessions s ON s.id=t.session_id JOIN admins a ON a.user_id=s.user_id WHERE t.token_hash=?',
    oldHash,
  );
  if (!row || row.revoked || row.expires <= Date.now())
    fail(401, 'Tu sesión venció. Ingresá nuevamente.');
  if (row.used_at) {
    // Brief concurrent-tab grace: never return a token or extend a consumed session.
    if (Date.now() - row.used_at < 5000) fail(409, 'Otra pestaña está renovando la sesión.');
    await run(env.DB, 'UPDATE admin_sessions SET revoked=1 WHERE id=?', row.session_id);
    fail(401, 'La sesión se cerró por reutilización de una credencial. Ingresá nuevamente.');
  }
  const next = random(),
    nextHash = await tokenHash(next),
    stamp = Date.now();
  const access = await sign(env, row.session_id, row.user_id);
  const results = await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO admin_refresh_tokens(token_hash,session_id) SELECT ?,id FROM admin_sessions WHERE id=? AND refresh_hash=? AND revoked=0 AND expires>?',
    ).bind(nextHash, row.session_id, oldHash, stamp),
    env.DB.prepare(
      'UPDATE admin_sessions SET refresh_hash=? WHERE id=? AND refresh_hash=? AND revoked=0',
    ).bind(nextHash, row.session_id, oldHash),
    env.DB.prepare(
      'UPDATE admin_refresh_tokens SET used_at=? WHERE token_hash=? AND EXISTS(SELECT 1 FROM admin_sessions WHERE id=? AND refresh_hash=?)',
    ).bind(stamp, oldHash, row.session_id, nextHash),
  ]);
  if (!results[0].meta.changes) fail(409, 'Otra pestaña está renovando la sesión.');
  return response({ ok: true }, access, next, row.expires);
}
export async function endSession(request, env) {
  requireSessionOrigin(request);
  const refresh = readCookie(request, REFRESH);
  if (refresh)
    await run(
      env.DB,
      'UPDATE admin_sessions SET revoked=1 WHERE id IN (SELECT session_id FROM admin_refresh_tokens WHERE token_hash=?)',
      await tokenHash(refresh),
    );
  const legacy = readCookie(request, LEGACY);
  if (legacy) await run(env.DB, 'DELETE FROM sessions WHERE token_hash=?', await tokenHash(legacy));
  return response({ ok: true }, '', '', 0);
}
