import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  receiptForm,
  validateReceipt,
  MAX_FILE_BYTES,
  storeReceipt,
} from '../server/receipt-files.js';
import {
  newSession,
  refreshSession,
  sessionUser,
  endSession,
  jwksResponse,
  verifyAccess,
  tokenHash,
} from '../server/admin-sessions.js';
import { handle } from '../server/api.js';
import { sessionFetch } from '../public/session-fetch.js';

const pair = await crypto.subtle.generateKey(
  {
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256',
  },
  true,
  ['sign', 'verify'],
);
const privateJwk = {
  ...(await crypto.subtle.exportKey('jwk', pair.privateKey)),
  kid: 'test-key',
  alg: 'RS256',
  use: 'sig',
};
const publicJwk = {
  ...(await crypto.subtle.exportKey('jwk', pair.publicKey)),
  kid: 'test-key',
  alg: 'RS256',
  use: 'sig',
};
function fixture() {
  const db = new DatabaseSync(':memory:');
  for (const f of fs
    .readdirSync(new URL('../drizzle/', import.meta.url))
    .filter((f) => f.endsWith('.sql'))
    .sort())
    db.exec(fs.readFileSync(new URL('../drizzle/' + f, import.meta.url), 'utf8'));
  db.exec(
    "INSERT INTO users(id,name,created) VALUES('admin','Test','now'); INSERT INTO admins(user_id,role) VALUES('admin','owner');",
  );
  class Statement {
    constructor(sql, args = []) {
      this.sql = sql;
      this.args = args;
    }
    bind(...args) {
      return new Statement(this.sql, args);
    }
    async first() {
      return db.prepare(this.sql).get(...this.args) || null;
    }
    async all() {
      return { results: db.prepare(this.sql).all(...this.args) };
    }
    async run() {
      return { meta: { changes: Number(db.prepare(this.sql).run(...this.args).changes) } };
    }
  }
  const env = {
    AUTH_PRIVATE_JWK: JSON.stringify(privateJwk),
    AUTH_JWKS: JSON.stringify({ keys: [publicJwk] }),
    AUTH_ISSUER: 'https://ronda.test',
    DB: {
      prepare: (sql) => new Statement(sql),
      async batch(statements) {
        db.exec('BEGIN');
        try {
          const result = [];
          for (const s of statements) result.push(await s.run());
          db.exec('COMMIT');
          return result;
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
      },
    },
    BUCKET: {},
  };
  return { env, db };
}
const cookieHeader = (response) =>
  response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
const req = (cookie = '', origin = 'https://ronda.test') =>
  new Request('https://ronda.test/api/refresh-token', {
    method: 'POST',
    headers: { Cookie: cookie, Origin: origin },
  });
const formRequest = (file) => {
  const f = new FormData();
  f.append('file', file);
  return new Request('https://ronda.test/upload', { method: 'POST', body: f });
};

test('legacy cookie upgrades once; password changes revoke previous JWT sessions', async () => {
  const { env, db } = fixture();
  const legacy = 'a'.repeat(43);
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires) VALUES(?,?,?)').run(
    await tokenHash(legacy),
    'admin',
    Date.now() + 60000,
  );
  const upgraded = await refreshSession(req('__Host-ronda_admin=' + legacy), env);
  assert.equal((await sessionUser(req(cookieHeader(upgraded)), env)).id, 'admin');
  assert.equal(db.prepare('SELECT count(*) AS n FROM sessions').get().n, 0);
  await assert.rejects(
    refreshSession(req('__Host-ronda_admin=' + legacy), env),
    (e) => e.status === 401,
  );
  env.PASSWORD_PEPPER = 'test-only-pepper';
  const changed = await handle(
    new Request('https://ronda.test/api/admin/credentials', {
      method: 'POST',
      headers: {
        Cookie: cookieHeader(upgraded),
        Origin: 'https://ronda.test',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username: 'renewed-user', password: 'New-local-password-2026' }),
    }),
    env,
  );
  assert.equal(changed.status, 200, await changed.clone().text());
  assert.equal(await sessionUser(req(cookieHeader(upgraded)), env), null);
  assert.equal((await sessionUser(req(cookieHeader(changed)), env)).id, 'admin');
});

test('PDF detected from bytes despite absent/wrong MIME; sanitized name; 10 MiB accepted', async () => {
  const f = new File(['%PDF-', new Uint8Array(MAX_FILE_BYTES - 5)], '../../evil.php', {
    type: 'application/octet-stream',
  });
  const result = await validateReceipt((await receiptForm(formRequest(f))).get('file'));
  assert.equal(result.mime, 'application/pdf');
  assert.equal(result.filename, 'evil.pdf');
  assert.equal(result.buffer.byteLength, MAX_FILE_BYTES);
});
test('oversize, spoofed content, missing boundary, duplicates and broken streams rejected', async () => {
  await assert.rejects(
    validateReceipt(new File([new Uint8Array(MAX_FILE_BYTES + 1)], 'a.pdf')),
    (e) => e.status === 413,
  );
  await assert.rejects(
    validateReceipt(new File(['<script>bad</script>'], 'a.pdf', { type: 'application/pdf' })),
    (e) => e.status === 415,
  );
  await assert.rejects(
    receiptForm(
      new Request('https://ronda.test', {
        method: 'POST',
        headers: { 'Content-Type': 'multipart/form-data' },
        body: 'bad',
      }),
    ),
    (e) => e.status === 415,
  );
  const f = new FormData();
  f.append('file', new File(['%PDF-'], 'a'));
  f.append('file', new File(['%PDF-'], 'b'));
  await assert.rejects(
    receiptForm(new Request('https://ronda.test', { method: 'POST', body: f })),
    (e) => e.status === 400,
  );
  const broken = new ReadableStream({
    start(c) {
      c.error(Error('disconnect'));
    },
  });
  await assert.rejects(
    receiptForm(
      new Request('https://ronda.test', {
        method: 'POST',
        headers: { 'Content-Type': 'multipart/form-data; boundary=x' },
        body: broken,
        duplex: 'half',
      }),
    ),
    (e) => e.status === 400,
  );
  const huge = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(MAX_FILE_BYTES + 65537));
      c.close();
    },
  });
  await assert.rejects(
    receiptForm(
      new Request('https://ronda.test', {
        method: 'POST',
        headers: { 'Content-Type': 'multipart/form-data; boundary=x' },
        body: huge,
        duplex: 'half',
      }),
    ),
    (e) => e.status === 413,
  );
  await assert.rejects(
    storeReceipt(
      {
        put: async () => {
          throw Error('storage failed');
        },
      },
      'key',
      { buffer: new ArrayBuffer(1), mime: 'application/pdf' },
    ),
    (e) => e.status === 503,
  );
});
test('JWT claims, JWKS public-only, rotated cookies, replay revokes family and logout revokes access', async () => {
  const { env, db } = fixture();
  const login = await newSession(env, 'admin'),
    cookies = cookieHeader(login);
  for (const c of login.headers.getSetCookie())
    for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) assert(c.includes(flag));
  assert.equal((await sessionUser(req(cookies), env)).id, 'admin');
  const token = /__Host-ronda_access=([^;]+)/.exec(cookies)[1];
  assert.equal((await verifyAccess(token, env)).aud, 'ronda-admin');
  assert.equal(await verifyAccess(token + 'x', env), null);
  assert.equal(await verifyAccess(token, { ...env, AUTH_ISSUER: 'https://evil.test' }), null);
  const jwks = await (await jwksResponse(env)).json();
  assert.equal(jwks.keys[0].d, undefined);
  assert.equal(jwks.keys[0].kid, 'test-key');
  const refreshed = await refreshSession(req(cookies), env),
    next = cookieHeader(refreshed);
  assert.notEqual(
    /__Host-ronda_refresh=([^;]+)/.exec(next)[1],
    /__Host-ronda_refresh=([^;]+)/.exec(cookies)[1],
  );
  await assert.rejects(refreshSession(req(cookies), env), (e) => e.status === 409);
  db.exec('UPDATE admin_refresh_tokens SET used_at=1 WHERE used_at IS NOT NULL');
  await assert.rejects(refreshSession(req(cookies), env), (e) => e.status === 401);
  assert.equal(await sessionUser(req(next), env), null);
  const fresh = cookieHeader(await newSession(env, 'admin'));
  await assert.rejects(
    refreshSession(req(fresh, 'https://evil.test'), env),
    (e) => e.status === 403,
  );
  await endSession(req(fresh), env);
  assert.equal(await sessionUser(req(fresh), env), null);
});
test('expired/forged JWT, removed administrator, missing cookies and cross-site writes fail closed', async () => {
  const { env, db } = fixture();
  const cookies = cookieHeader(await newSession(env, 'admin'));
  const encode = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const input =
    encode({ alg: 'RS256', typ: 'JWT', kid: 'test-key' }) +
    '.' +
    encode({ iss: env.AUTH_ISSUER, aud: 'ronda-admin', sub: 'admin', sid: 'x', iat: 1, exp: 901 });
  const signature = Buffer.from(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(input)),
  ).toString('base64url');
  assert.equal(await verifyAccess(input + '.' + signature, env), null);
  assert.equal(
    await verifyAccess(
      encode({ alg: 'none', kid: 'test-key' }) + '.' + encode({ sub: 'admin' }) + '.abc',
      env,
    ),
    null,
  );
  const blocked = await handle(
    new Request('https://ronda.test/api/admin/chains', {
      method: 'POST',
      headers: { Cookie: cookies, Origin: 'https://evil.test', 'Content-Type': 'application/json' },
      body: '{}',
    }),
    env,
  );
  assert.equal(blocked.status, 403);
  db.exec("DELETE FROM admins WHERE user_id='admin'");
  assert.equal(await sessionUser(req(cookies), env), null);
  await assert.rejects(refreshSession(req(cookies), env), (e) => e.status === 401);
  await assert.rejects(refreshSession(req(), env), (e) => e.status === 401);
});
test('frontend shares one refresh and replays the same FormData once without manual content type', async () => {
  let renewals = 0,
    accepted = false,
    uploads = 0;
  const form = new FormData();
  form.append('file', new File(['%PDF-1.4'], 'test.pdf'));
  const fetcher = async (url, opts) => {
    if (url.endsWith('/api/me')) return Response.json({}, { status: accepted ? 200 : 401 });
    if (url.endsWith('/api/refresh-token')) {
      renewals++;
      await new Promise((r) => setTimeout(r, 10));
      accepted = true;
      return Response.json({ ok: true });
    }
    uploads++;
    assert.equal(opts.body, form);
    assert.equal(new Headers(opts.headers).get('Content-Type'), null);
    return Response.json({}, { status: accepted ? 200 : 401 });
  };
  const options = { method: 'POST', body: form, headers: {}, credentials: 'same-origin' };
  const result = await Promise.all([
    sessionFetch('https://ronda.test', '/api/upload', options, { fetcher }),
    sessionFetch('https://ronda.test', '/api/upload', options, { fetcher }),
  ]);
  assert(result.every((r) => r.ok));
  assert.equal(renewals, 1);
  assert.equal(uploads, 4);
});
test('frontend never refreshes rejected passwords or retries uncertain server/network failures', async () => {
  let count = 0;
  const fetcher = async () => {
    count++;
    return Response.json({}, { status: 401 });
  };
  await sessionFetch('https://ronda.test', '/api/admin/login', {}, { fetcher });
  assert.equal(count, 1);
  count = 0;
  await sessionFetch(
    'https://ronda.test',
    '/api/upload',
    {},
    {
      fetcher: async () => {
        count++;
        return new Response('', { status: 503 });
      },
    },
  );
  assert.equal(count, 1);
});

test('real API: password login, refresh, grouped PDF persistence, permission checks, storage failure and logout', async () => {
  const { env, db } = fixture();
  env.PASSWORD_PEPPER = 'test-only-pepper';
  env.ADMIN_EMAIL = 'admin@sites.test';
  const stored = new Map();
  env.BUCKET = {
    put: async (k, b, options) => stored.set(k, { b, options }),
    delete: async (k) => stored.delete(k),
  };
  const call = async (
    path,
    { body, method = body ? 'POST' : 'GET', cookies, platform = false } = {},
  ) => {
    const headers = { Origin: 'https://ronda.test' };
    if (platform)
      Object.assign(headers, {
        'oai-authenticated-user-id': 'admin',
        'oai-authenticated-user-email': 'admin@sites.test',
      });
    if (cookies) headers.Cookie = cookies;
    if (body && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    return handle(new Request('https://ronda.test' + path, { method, headers, body }), env);
  };
  const setup = await call('/api/admin/credentials', {
    platform: true,
    body: { username: 'testadmin', password: 'Local-only-password-2026' },
  });
  assert.equal(setup.status, 200, await setup.clone().text());
  const login = await call('/api/admin/login', {
    body: { username: 'testadmin', password: 'Local-only-password-2026' },
  });
  assert.equal(login.status, 200);
  let cookies = cookieHeader(login);
  assert.equal((await call('/api/me', { cookies })).status, 200);
  const refreshed = await call('/api/refresh-token', { cookies, body: {} });
  assert.equal(refreshed.status, 200);
  cookies = cookieHeader(refreshed);
  const c = await call('/api/admin/chains', {
    cookies,
    body: {
      name: 'Test upload',
      amount_cents: 100000,
      currency: 'ARS',
      capacity: 2,
      frequency: 'weekly',
      start_date: '2026-10-27',
    },
  });
  assert.equal(c.status, 201, await c.clone().text());
  const base = '/api/admin/chains/' + (await c.json()).id;
  const p = await call(base + '/participants', {
    cookies,
    body: { name: 'Dummy only', quantity: 2 },
  });
  assert(p.ok, await p.clone().text());
  const userId = (await p.json()).user_id;
  const order = await call(base + '/order', {
    cookies,
    body: {
      order: [
        { user_id: userId, slot_number: 1 },
        { user_id: userId, slot_number: 2 },
      ],
    },
  });
  assert(order.ok, await order.clone().text());
  const form = (turn = 1) => {
    const f = new FormData();
    f.append('user_id', userId);
    f.append('turn_number', String(turn));
    f.append(
      'file',
      new File(['%PDF-1.4\n', new Uint8Array(6 * 1024 * 1024)], '../../receipt.pdf', {
        type: 'application/octet-stream',
      }),
    );
    return f;
  };
  const upload = await call(base + '/group-payments/file', { cookies, body: form() });
  assert.equal(upload.status, 201, await upload.clone().text());
  const receipts = db.prepare('SELECT * FROM receipts').all();
  assert.equal(receipts.length, 2);
  assert.equal(stored.size, 1);
  assert(receipts.every((r) => r.mime === 'application/pdf' && r.filename === 'receipt.pdf'));
  assert.match(receipts[0].r2_key, /^[0-9a-f-]{36}$/);
  assert.equal((await call(base + '/group-payments/file', { cookies, body: form() })).status, 409);
  assert.equal((await call(base + '/group-payments/file', { body: form(2) })).status, 401);
  env.BUCKET.put = async () => {
    throw Error('offline');
  };
  assert.equal((await call(base + '/group-payments/file', { cookies, body: form(2) })).status, 503);
  assert.equal(db.prepare('SELECT count(*) AS n FROM receipts').get().n, 2);
  const logout = await call('/api/logout', { cookies, body: {} });
  assert.equal(logout.status, 200);
  assert.equal((await call('/api/me', { cookies })).status, 401);
});
