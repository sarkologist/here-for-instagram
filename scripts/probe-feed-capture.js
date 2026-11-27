// Paste into the browser console on instagram.com (Home), then scroll the
// feed down for 20 seconds. Prints how Instagram's own page asks for more
// posts: endpoint, query name and id, and the names (not values) of the
// variables and headers. No tokens or cookies are printed.
(() => {
  const seen = [];
  const note = (via, url, body, headers) => {
    const path = String(url).replace(location.origin, '').replace(/\?.*/, '');
    if (!/graphql|\/api\/v1\/feed/.test(path)) return;
    const p = new URLSearchParams(typeof body === 'string' ? body : '');
    let vars = {};
    try { vars = JSON.parse(p.get('variables') || '{}'); } catch (_) {}
    seen.push({
      via, path,
      name: p.get('fb_api_req_friendly_name') || (headers && (headers['X-FB-Friendly-Name'] || headers['x-fb-friendly-name'])) || '',
      doc: p.get('doc_id') || '',
      vars: Object.keys(vars).filter((k) => !k.startsWith('__relay')).join(',') + (vars.data ? ` data:{${Object.keys(vars.data).join(',')}}` : ''),
      flags: Object.keys(vars).filter((k) => k.startsWith('__relay')).map((k) => k.replace(/^__relay_internal__pv__Polaris|relayprovider$/g, '')).join(','),
      headers: Object.keys(headers || {}).join(','),
    });
  };
  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  const setHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (m, u) { this.__u = u; this.__h = {}; return open.apply(this, arguments); };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) { if (this.__h) this.__h[k] = v; return setHeader.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (b) { try { note('xhr', this.__u, b, this.__h); } catch (_) {} return send.apply(this, arguments); };
  const fetch0 = window.fetch;
  window.fetch = function (u, i) {
    try { note('fetch', u && u.url || u, i && i.body, i && i.headers instanceof Headers ? Object.fromEntries(i.headers) : i && i.headers); } catch (_) {}
    return fetch0.apply(this, arguments);
  };
  console.log('Here for Instagram probe: scroll the feed down now, for 20 seconds…');
  setTimeout(() => {
    XMLHttpRequest.prototype.open = open;
    XMLHttpRequest.prototype.send = send;
    XMLHttpRequest.prototype.setRequestHeader = setHeader;
    window.fetch = fetch0;
    const feed = seen.filter((r) => /Feed|feed|timeline/.test(r.name + r.path + r.vars));
    console.log(`Here for Instagram probe: ${seen.length} GraphQL/feed requests, ${feed.length} for the feed:\n` +
      (feed.length ? feed : seen).map((r) => JSON.stringify(r)).join('\n'));
  }, 20000);
})();
