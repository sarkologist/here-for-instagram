// Paste into the browser console on instagram.com (Home) to see which form
// of the home feed request this session answers with posts. Read-only: it
// asks for one page of Following and prints only whether data came back.
(async () => {
  const script = (re) => { for (const s of document.scripts) { const m = !s.src && s.textContent.match(re); if (m) return m[1]; } return null; };
  const token = (name) => script(new RegExp(`"${name}",\\[\\],\\{"token":"([^"]+)"`));
  const dtsg = token('DTSGInitialData');
  const lsd = token('LSD');
  const device = script(/"device_id":"([\w-]+)"/);
  const actor = script(/"RelayAPIConfigDefaults",\[\],\{[^}]*?"actorID":"(\d+)"/);
  const csrf = (document.cookie.match(/(?:^|; )csrftoken=([^;]+)/) || [])[1] || '';
  console.log('tokens found:', { dtsg: !!dtsg, lsd: !!lsd, device: !!device, actor: !!actor, csrf: !!csrf });
  const flag = (n, v) => [`__relay_internal__pv__Polaris${n}relayprovider`, v];
  const variables = JSON.stringify({
    after: null, before: null, first: 12, last: null, variant: 'following',
    data: { device_id: device, is_async_ads_double_request: '0', is_async_ads_in_headload_enabled: '0', is_async_ads_rti: '0', rti_delivery_backend: '0', pagination_source: 'following', feed_view_info: '[]' },
    ...Object.fromEntries([flag('ShortDramaEnabled', true), flag('MultiCaptionCarouselEnabled', true), flag('ThreadsStyleCommentsEnabled', false), flag('ReelsRecoDebugOverlayEnabled', false), flag('AdDebugToolEnabled', false), flag('SuggestedUserFeedUnitCardsEnabled', true), flag('DSA16EntrypointEnabled', false), flag('ProductTagIndicatorEnabled', false)]),
  });
  const NAME = 'PolarisFeedRootPaginationCachedQuery_subscribe';
  const base = { headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-csrftoken': csrf, 'x-ig-app-id': '936619743392459' }, params: { doc_id: '40856843000596438', variables } };
  const tokens = { headers: { 'x-fb-lsd': lsd }, params: { fb_dtsg: dtsg, lsd } };
  const named = { headers: { 'x-fb-friendly-name': NAME, 'x-root-field-name': 'xdt_api__v1__feed__timeline__connection', 'x-asbd-id': '359341' }, params: { fb_api_caller_class: 'RelayModern', fb_api_req_friendly_name: NAME, server_timestamps: 'true' } };
  const jazoest = dtsg ? '2' + [...dtsg].reduce((n, c) => n + c.charCodeAt(0), 0) : '';
  const app = { headers: {}, params: { av: actor || '', __d: 'www', __user: '0', __a: '1', __comet_req: '7', jazoest } };
  const merge = (...parts) => ({ headers: Object.assign({}, ...parts.map((p) => p.headers)), params: Object.assign({}, ...parts.map((p) => p.params)) });
  const ways = { 'A bare (the extension today)': base, 'B + session tokens': merge(base, tokens), 'C + query name headers': merge(base, tokens, named), 'D + app parameters': merge(base, tokens, named, app) };
  for (const [label, w] of Object.entries(ways)) {
    try {
      const res = await fetch('/graphql/query', { method: 'POST', credentials: 'include', headers: w.headers, body: new URLSearchParams(w.params).toString() });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch (_) {}
      const conn = json && json.data && json.data.xdt_api__v1__feed__timeline__connection;
      console.log(label, '→', conn ? `posts (${conn.edges.length})` : json ? `errors: ${JSON.stringify(json.errors || json).slice(0, 120)}` : `HTTP ${res.status}, ${text.slice(0, 40).replace(/\s+/g, ' ')}…`);
    } catch (e) {
      console.log(label, '→', String(e));
    }
  }
})();
