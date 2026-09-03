// Sortilege L5R Creator — Anthropic shim and shared draft store.
//
// The Creator is a static page on GitHub Pages, so it can neither hold a secret
// nor keep state anybody else can see. This Worker does both, on two routes
// that share nothing but the origin check and the rate limiter:
//
//   POST /            the AI shim. Takes a suggestion request, calls Anthropic
//                     with the key stored as a Worker secret, returns the text.
//
//   /drafts[/:id]     the shared draft store, in D1. Drafts used to live in one
//                     browser's localStorage, which meant a character in
//                     progress could only be worked on by the person who
//                     started it, on the machine they started it on.
//
// Neither route is open. Both require an allowed Origin; /drafts additionally
// requires the table key, so the store is reachable by the people at the table
// and not by everyone who can load a public GitHub Pages site.

const ANTHROPIC = 'https://api.anthropic.com/v1/messages';
const MAX_SYSTEM = 4000;   // the per-field prompts are ~500 chars
const MAX_USER = 12000;    // context grows with the character; this is generous
const MAX_BODY = 262144;   // a draft is a few KB; this is a ceiling, not a target

function origins(env) {
  return (env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
}

function corsOrigin(request, env) {
  const allowed = origins(env);
  const got = request.headers.get('Origin') || '';
  return allowed.includes(got) ? got : null;
}

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, x-table-key',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...(origin ? cors(origin) : {}) },
  });
}

// A minimal fixed-window limiter. No KV binding required: the Worker isolate
// holds the window, which is enough to blunt a script without adding state.
//
// The two routes are counted separately. They are paced by different things: a
// suggestion is a person pressing a button, while a sync is an autosave and a
// poll, so one shared allowance would either throttle editing or stop limiting
// the expensive route.
const hits = new Map();
function rateLimited(bucket, ip, perMin) {
  const now = Date.now();
  const windowStart = now - 60_000;
  const k = bucket + ':' + ip;
  const seen = (hits.get(k) || []).filter(t => t > windowStart);
  seen.push(now);
  hits.set(k, seen);
  if (hits.size > 5000) hits.clear();   // bound the map; the window is short
  return seen.length > perMin;
}

// Compare in constant time, so a wrong key cannot be found a character at a
// time. The length is not hidden, which is fine — the key's length is not the
// secret.
function keyOk(request, env) {
  const want = env.TABLE_KEY || '';
  const got = request.headers.get('x-table-key') || '';
  if (!want || got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

const row = r => ({ id: r.id, rev: r.rev, name: r.name, updated: r.updated,
                    editor: r.editor, body: JSON.parse(r.body) });

async function drafts(request, env, origin, path) {
  if (!env.DB) return json({ error: 'Worker has no D1 binding' }, 500, origin);
  if (!env.TABLE_KEY) return json({ error: 'Worker has no TABLE_KEY set' }, 500, origin);
  if (!keyOk(request, env)) return json({ error: 'bad table key' }, 403, origin);

  const id = path.startsWith('/drafts/') ? decodeURIComponent(path.slice(8)) : '';
  const method = request.method;

  // The whole list. Metadata only unless ?full=1, because the poll that keeps
  // everyone in step runs every few seconds and only needs to know which
  // revisions moved.
  if (!id && method === 'GET') {
    const full = new URL(request.url).searchParams.get('full') === '1';
    const cols = full ? 'id, rev, name, updated, editor, body'
                      : 'id, rev, name, updated, editor';
    const { results } = await env.DB.prepare(
      `SELECT ${cols} FROM drafts ORDER BY updated DESC`).all();
    return json({ drafts: (results || []).map(r => full ? row(r) : r) }, 200, origin);
  }

  if (id && method === 'GET') {
    const r = await env.DB.prepare(
      'SELECT id, rev, name, updated, editor, body FROM drafts WHERE id = ?')
      .bind(id).first();
    return r ? json(row(r), 200, origin)
             : json({ error: 'no such draft' }, 404, origin);
  }

  if (id && method === 'PUT') {
    let payload;
    try { payload = await request.json(); }
    catch { return json({ error: 'bad JSON' }, 400, origin); }

    const body = JSON.stringify(payload.body ?? null);
    if (body.length > MAX_BODY) {
      return json({ error: 'draft too large' }, 413, origin);
    }
    const name = String(payload.name || '').slice(0, 200);
    const editor = String(payload.editor || '').slice(0, 80);
    const base = Number(payload.rev || 0);
    const now = Date.now();

    // rev 0 means "I believe this is new". Anything else is a claim about what
    // the row currently says, and the WHERE clause is what checks it: if the
    // revision has moved on, no row matches and nothing is overwritten.
    const stmt = base === 0
      ? env.DB.prepare(
          'INSERT INTO drafts (id, rev, name, updated, editor, body) ' +
          'VALUES (?, 1, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
          .bind(id, name, now, editor, body)
      : env.DB.prepare(
          'UPDATE drafts SET rev = rev + 1, name = ?, updated = ?, editor = ?, ' +
          'body = ? WHERE id = ? AND rev = ?')
          .bind(name, now, editor, body, id, base);

    const res = await stmt.run();
    if (res.meta.changes === 0) {
      // Rejected. Hand back what is actually there, so the caller can show the
      // two versions rather than just reporting a number that did not match.
      const cur = await env.DB.prepare(
        'SELECT id, rev, name, updated, editor, body FROM drafts WHERE id = ?')
        .bind(id).first();
      return cur
        ? json({ error: 'conflict', current: row(cur) }, 409, origin)
        : json({ error: 'no such draft' }, 404, origin);
    }
    return json({ id, rev: base + 1, updated: now }, 200, origin);
  }

  if (id && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM drafts WHERE id = ?').bind(id).run();
    return json({ ok: true }, 200, origin);
  }

  return json({ error: 'method not allowed here' }, 405, origin);
}

async function ai(request, env, origin) {
  if (request.method !== 'POST') {
    return json({ error: 'POST only' }, 405, origin);
  }
  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: 'Worker has no ANTHROPIC_API_KEY set' }, 500, origin);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad JSON' }, 400, origin);
  }

  const system = String(body.system || '').slice(0, MAX_SYSTEM);
  const user = String(body.user || '').slice(0, MAX_USER);
  if (!system || !user) {
    return json({ error: 'system and user are both required' }, 400, origin);
  }

  // Model and ceiling come from config, never from the caller.
  const upstream = await fetch(ANTHROPIC, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: env.MODEL || 'claude-haiku-4-5-20251001',
      max_tokens: Number(env.MAX_TOKENS || 400),
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });

  if (!upstream.ok) {
    const detail = await upstream.text();
    // pass the status through, but not the upstream body verbatim
    return json({ error: `upstream ${upstream.status}`,
                  detail: detail.slice(0, 300) }, upstream.status, origin);
  }

  const data = await upstream.json();
  const text = (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();

  return json({ text }, 200, origin);
}

export default {
  async fetch(request, env) {
    const origin = corsOrigin(request, env);

    if (request.method === 'OPTIONS') {
      return origin
        ? new Response(null, { status: 204, headers: cors(origin) })
        : new Response('origin not allowed', { status: 403 });
    }
    if (!origin) {
      // no CORS headers here on purpose: an unlisted origin gets nothing back
      return new Response('origin not allowed', { status: 403 });
    }

    const path = new URL(request.url).pathname.replace(/\/+$/, '') || '/';
    const isDrafts = path === '/drafts' || path.startsWith('/drafts/');
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

    if (isDrafts) {
      if (rateLimited('sync', ip, Number(env.SYNC_PER_MIN || 120))) {
        return json({ error: 'syncing too fast; pausing briefly' }, 429, origin);
      }
      return drafts(request, env, origin, path);
    }

    if (rateLimited('ai', ip, Number(env.RATE_PER_MIN || 12))) {
      return json({ error: 'Too many suggestions, briefly. Try again in a moment.' },
                  429, origin);
    }
    return ai(request, env, origin);
  },
};
