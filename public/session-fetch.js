let renewal;
let generation = 0;
const excluded = /\/api\/(?:refresh-token|logout|admin\/(?:login|logout|register|credentials))$/;

async function renew(base, fetcher) {
  const response = await fetcher(base + '/api/refresh-token', {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(15000),
  });
  if (response.ok) {
    generation++;
    return true;
  }
  if (response.status === 409) {
    // Another tab may already have rotated the cookie. Check, never replay a refresh token.
    const probe = await fetcher(base + '/api/me', {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    if (probe.ok) {
      generation++;
      return true;
    }
  }
  return false;
}

export async function sessionFetch(
  base,
  path,
  options,
  { participant = false, fetcher = fetch } = {},
) {
  const version = generation;
  const response = await fetcher(base + path, options);
  if (response.status !== 401 || participant || excluded.test(path) || options.signal?.aborted)
    return response;
  if (version === generation) {
    if (!renewal) {
      const task = () => renew(base, fetcher);
      // Coordinate refresh-cookie rotation across tabs where Web Locks are available.
      renewal = (
        globalThis.navigator?.locks
          ? navigator.locks.request('ronda-session-refresh', async () => {
              const probe = await fetcher(base + '/api/me', {
                credentials: 'same-origin',
                cache: 'no-store',
                signal: AbortSignal.timeout(15000),
              });
              if (probe.ok) {
                generation++;
                return true;
              }
              return task();
            })
          : task()
      ).finally(() => {
        renewal = null;
      });
    }
    if (!(await renewal)) return response;
  }
  if (options.signal?.aborted) return response;
  // Exactly one replay, only after a rejected authentication. FormData remains reusable.
  return fetcher(base + path, options);
}
