// Sortilege L5R Creator — Anthropic shim.
//
// The Creator is a static page, so it cannot hold an Anthropic key. This Worker
// does: it takes the suggestion request, calls Anthropic with the key stored as
// a Worker secret (never in the repo, never in the served site), and returns
// just the text.
//
// It is deliberately not a general LLM endpoint. It accepts one shape of
// request, pins the model and token ceiling from wrangler.toml, requires an
// allowed Origin, and rate-limits per IP. The account-side spend cap is the
// backstop, not the only control.

const ANTHROPIC = 'https://api.anthropic.com/v1/messages';
const MAX_SYSTEM = 4000;   // the per-field prompts are ~500 chars
const MAX_USER = 12000;    // context grows with the character; this is generous

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
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
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
const hits = new Map();
function rateLimited(ip, perMin) {
  const now = Date.now();
  const windowStart = now - 60_000;
  const seen = (hits.get(ip) || []).filter(t => t > windowStart);
  seen.push(now);
  hits.set(ip, seen);
  if (hits.size > 5000) hits.clear();   // bound the map; the window is short
  return seen.length > perMin;
}

export default {
  async fetch(request, env) {
    const origin = corsOrigin(request, env);

    if (request.method === 'OPTIONS') {
      return origin
        ? new Response(null, { status: 204, headers: cors(origin) })
        : new Response('origin not allowed', { status: 403 });
    }
    if (request.method !== 'POST') {
      return json({ error: 'POST only' }, 405, origin);
    }
    if (!origin) {
      // no CORS headers here on purpose: an unlisted origin gets nothing back
      return new Response('origin not allowed', { status: 403 });
    }
    if (!env.ANTHROPIC_API_KEY) {
      return json({ error: 'Worker has no ANTHROPIC_API_KEY set' }, 500, origin);
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (rateLimited(ip, Number(env.RATE_PER_MIN || 12))) {
      return json({ error: 'Too many suggestions, briefly. Try again in a moment.' },
                  429, origin);
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
  },
};
