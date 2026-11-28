// Counts calendars created. Only /api/* requests reach this Worker; everything else is served as static assets.
const SHOW_FROM = 10; // the public count only appears once this many calendars exist

export class Counter {
  constructor(state) { this.state = state; }
  async fetch(request) {
    const { pathname } = new URL(request.url);
    let n = (await this.state.storage.get('n')) || 0;
    if (pathname === '/inc') { n += 1; await this.state.storage.put('n', n); }
    return Response.json({ n });
  }
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const stub = env.COUNTER.get(env.COUNTER.idFromName('calendars'));

    if (pathname === '/api/count' && request.method === 'GET') {
      const { n } = await (await stub.fetch('https://do/get')).json();
      return json(n >= SHOW_FROM ? { show: true, count: n } : { show: false });
    }
    if (pathname === '/api/created' && request.method === 'POST') {
      await stub.fetch('https://do/inc');
      return json({ ok: true });
    }
    return json({ error: 'not found' }, 404);
  },
};
