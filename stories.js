// Story data and a small story viewer.
//
// Instagram's own viewer, opened by link, only knows the one account: it
// closes after that account's last story and cannot load ahead. This viewer
// plays a whole row of accounts in order and preloads what comes next.
const Sinsta = (() => {
  'use strict';

  const APP_ID = '936619743392459'; // Instagram's public web app id
  // The persisted GraphQL queries Instagram's own story viewer uses. If
  // Instagram retires them, opening a story falls back to its viewer.
  const DOC_REELS = '28739385832429456'; // PolarisStoriesV3ReelPageStandaloneQuery
  const DOC_SEEN = '26234228992942885'; // PolarisStoriesV3SeenMutation
  const DOC_FAV = '27833939016209017'; // usePolarisUpdateFeedFavoritesMutation
  const DOC_BADGE = '26853171684350625'; // usePolarisNotificationsNavItemQuery
  const DOC_FEED = '29639616438977013'; // PolarisFeedRootPaginationCachedQuery_subscribe
  const DOC_CLIPS = '29386172244354956'; // PolarisClipsTabDesktopPaginationQuery
  const DOC_PROFILE_POSTS = '39818828461098125'; // PolarisProfilePostsTabContentQuery_connection
  const DOC_LIKE = '27182485238052618'; // usePolarisLikeMediaXIGLikeMutation
  const DOC_UNLIKE = '27345296031770102'; // usePolarisLikeMediaXIGUnlikeMutation
  const DOC_COMMENT = '30184188691181526'; // usePolarisCommentSubmitMutation
  const DOC_COMMENT_LIKE = '25746541371686622'; // usePolarisCommentLikeMutation
  const DOC_COMMENT_UNLIKE = '26466515576331833'; // usePolarisCommentUnlikeMutation
  const DOC_STORY_LIKE = '26938887309082050'; // usePolarisStoriesV4LikeMutationLikeMutation
  const DOC_STORY_UNLIKE = '26510485515280697'; // usePolarisStoriesV4LikeMutationUnlikeMutation
  const DOC_STORY_REPLY = '29327482173525974'; // IGDirectStoryShareReplyMutation
  const DOC_USER_CARD = '28949219061332276'; // PolarisUserHoverCardContentV2Query
  const DOC_FOLLOW = '30480713304862233'; // usePolarisFollowUserFollowMutation
  const DOC_UNFOLLOW = '25174972798866458'; // usePolarisFollowUserUnfollowMutation
  const DOC_SAVE = '27365486596441074'; // usePolarisSaveMediaSaveMutation
  const DOC_UNSAVE = '27371251859134880'; // usePolarisSaveMediaUnsaveMutation
  const DOC_COLLECTIONS = '29115677831365401'; // PolarisSavedCollectionPickerQuery
  const DOC_COLLECTIONS_MORE = '28466833206340367'; // PolarisSavedCollectionPickerPaginationQuery
  const DOC_COLLECTION_ADD = '39663440886576281'; // usePolarisMediaSaveToCollectionAddMediaMutation
  const DOC_COLLECTION_NEW = '27305499509043563'; // PolarisAPICreateCollectionMutation
  // Feature flags the feed query declares; values as Instagram's web app sends them.
  const FEED_FLAGS = {
    __relay_internal__pv__PolarisShortDramaEnabledrelayprovider: true,
    __relay_internal__pv__PolarisMultiCaptionCarouselEnabledrelayprovider: true,
    __relay_internal__pv__PolarisThreadsStyleCommentsEnabledrelayprovider: false,
    __relay_internal__pv__PolarisReelsRecoDebugOverlayEnabledrelayprovider: false,
    __relay_internal__pv__PolarisAdDebugToolEnabledrelayprovider: false,
    __relay_internal__pv__PolarisSuggestedUserFeedUnitCardsEnabledrelayprovider: true,
  };
  const PROFILE_FLAGS = {
    __relay_internal__pv__PolarisMultiCaptionCarouselEnabledrelayprovider: true,
    __relay_internal__pv__PolarisShortDramaEnabledrelayprovider: true,
    __relay_internal__pv__PolarisSEOIsCrawlerrelayprovider: false,
    __relay_internal__pv__PolarisProductTagIndicatorEnabledrelayprovider: false,
    __relay_internal__pv__PolarisThreadsStyleCommentsEnabledrelayprovider: false,
    __relay_internal__pv__PolarisReelsRecoDebugOverlayEnabledrelayprovider: false,
  };
  const CLIPS_FLAGS = {
    __relay_internal__pv__PolarisReelsRecoDebugOverlayEnabledrelayprovider: false,
    __relay_internal__pv__PolarisThreadsStyleCommentsEnabledrelayprovider: false,
    __relay_internal__pv__PolarisShortDramaEnabledrelayprovider: true,
  };
  const AHEAD = 5; // accounts whose story lists are fetched ahead
  const PRELOAD = 3; // media files loaded ahead
  const START = -1; // item index: first unseen story
  const LAST = -2; // item index: last story

  // ---- Requests and navigation -------------------------------------------

  async function request(path, init) {
    const url = location.origin + path;
    const fetchers = [];
    // Firefox: content.fetch sends the request exactly as the page would.
    if (typeof content === 'object' && content && content.fetch) fetchers.push(content.fetch.bind(content));
    fetchers.push(window.fetch.bind(window));
    for (const f of fetchers) {
      try {
        const res = await f(url, init);
        if (res.ok) return JSON.parse(await res.text());
      } catch (_) {}
    }
    return null;
  }

  function api(path) {
    return request(path, { headers: { 'x-ig-app-id': APP_ID }, credentials: 'include' });
  }

  // Some reads work on /graphql/query with just the CSRF cookie. Mutations
  // sent there are accepted but silently dropped (the result is null): they
  // need /api/graphql plus the page's session tokens (`mutation` true), as
  // do more and more reads.
  function gql(docId, variables, mutation) {
    const csrf = (document.cookie.match(/(?:^|; )csrftoken=([^;]+)/) || [])[1] || '';
    const params = { doc_id: docId, variables: typeof variables === 'string' ? variables : JSON.stringify(variables) };
    const headers = {
      'content-type': 'application/x-www-form-urlencoded',
      'x-csrftoken': csrf,
      'x-ig-app-id': APP_ID,
    };
    if (mutation) {
      const t = tokens();
      if (!t) return Promise.resolve(null);
      Object.assign(params, { fb_dtsg: t.dtsg, lsd: t.lsd });
      headers['x-fb-lsd'] = t.lsd;
    }
    return request(mutation ? '/api/graphql' : '/graphql/query', {
      method: 'POST',
      credentials: 'include',
      headers,
      body: new URLSearchParams(params).toString(),
    });
  }

  // Session tokens Instagram embeds in the page's inline scripts.
  let cachedTokens = null;
  function tokens() {
    if (cachedTokens) return cachedTokens;
    const find = (name) => {
      const re = new RegExp(`"${name}",\\[\\],\\{"token":"([^"]+)"`);
      for (const s of document.scripts) {
        const m = !s.src && s.textContent.match(re);
        if (m) return m[1];
      }
      return null;
    };
    const dtsg = find('DTSGInitialData');
    const lsd = find('LSD');
    let device = null;
    for (const s of document.scripts) {
      const m = !s.src && s.textContent.match(/"device_id":"([\w-]+)"/);
      if (m) {
        device = m[1];
        break;
      }
    }
    if (!dtsg || !lsd) return null;
    // Your account's id as Instagram's own mutations name their actor.
    let actor = null;
    for (const s of document.scripts) {
      const m = !s.src && s.textContent.match(/"RelayAPIConfigDefaults",\[\],\{[^}]*?"actorID":"(\d+)"/);
      if (m) {
        actor = m[1];
        break;
      }
    }
    const found = { dtsg, lsd, device, actor };
    if (device) cachedTokens = found; // else look for the device id again next time
    return found;
  }

  // Notifications that light the dot but that Instagram never sends to the
  // web (such as "X added a story" for accounts you get alerts for): the
  // badge total minus the categories the web panel lists. Reading the badge
  // doesn't mark anything as seen.
  async function appOnlyNotifications() {
    const t = tokens();
    if (!t || !t.device) return null;
    const res = await gql(DOC_BADGE, { device_id: t.device }, true);
    const badge = res && res.data && res.data.xdt_notification_badge;
    const counts = badge && badge.badge_count;
    if (!counts) return null;
    const listed = Object.values(counts.activity_badge_counts || {}).reduce((sum, n) => sum + (n || 0), 0);
    return Math.max(0, (counts.total_count || 0) - listed);
  }

  // One page of one of Instagram's home feeds (`variant`: following,
  // favorites or home), as the query's connection, or null on failure.
  // Reports nothing as viewed.
  async function feedConnection(variant, after) {
    const t = tokens();
    if (!t || !t.device) return null;
    const res = await gql(DOC_FEED, {
      after: after || null,
      before: null,
      data: {
        device_id: t.device,
        is_async_ads_double_request: '0',
        is_async_ads_in_headload_enabled: '0',
        is_async_ads_rti: '0',
        rti_delivery_backend: '0',
        // Instagram's own home feed sends none, and the query fails with one.
        ...(variant === 'home' ? {} : { pagination_source: variant }),
        feed_view_info: '[]',
      },
      first: 12,
      last: null,
      variant,
      ...FEED_FLAGS,
    });
    return (res && res.data && res.data.xdt_api__v1__feed__timeline__connection) || null;
  }

  // One page of a home feed's posts and reels, as { items, after } where
  // `after` is null at the end, or null on failure.
  async function feedPage(variant, after) {
    const conn = await feedConnection(variant, after);
    if (!conn) return null;
    const items = [];
    for (const e of conn.edges || []) {
      const node = e && e.node;
      if (!node) continue;
      // The home feed's suggestions come as explore stories; ads as `ad`
      // items, which carry no media of this kind.
      const story = node.explore_story;
      const m = node.media || (story && story.media);
      const it = mediaItem(m);
      if (!it) continue;
      if (node.ad || (story && story.ad) || m.ad_id) it.ad = true;
      it.suggested = !!story;
      items.push(it);
    }
    const info = conn.page_info || {};
    return { items, after: info.has_next_page ? info.end_cursor : null };
  }

  // Posts by followed accounts published since `since` (unix seconds), newest
  // first, from the chronological Following feed. Reports nothing as viewed.
  async function recentPosts(since, maxPages = 4) {
    const out = [];
    let after = null;
    for (let page = 0; page < maxPages; page++) {
      const conn = await feedConnection('following', after);
      if (!conn) return page ? out : null;
      let older = false;
      for (const e of conn.edges || []) {
        const m = e.node && e.node.media;
        if (!m || !m.user || !m.code || !m.taken_at) continue;
        if (m.taken_at < since) {
          older = true;
          continue;
        }
        out.push({
          username: m.user.username,
          takenAt: m.taken_at,
          href: `/${m.product_type === 'clips' ? 'reel' : 'p'}/${m.code}/`,
          kind: m.product_type === 'clips' ? 'reel' : 'post',
        });
      }
      const info = conn.page_info;
      if (older || !info || !info.has_next_page) break;
      after = info.end_cursor;
    }
    return out;
  }

  // An object's id as a string. Ids are too long for a JavaScript number, so
  // when a response has one as a number (losing its last digits) the exact
  // string forms win: `pk_id`, or the pk before the "_" of `id`.
  function idOf(o) {
    if (typeof o.pk === 'string') return o.pk;
    if (typeof o.pk_id === 'string') return o.pk_id;
    if (typeof o.id === 'string' && /^\d+(_|$)/.test(o.id)) return o.id.split('_')[0];
    return String(o.pk);
  }

  // One photo or video of a post: its sizes of picture (largest first), its
  // video if any, and its shape.
  function slideOf(o) {
    const thumbs = ((o.image_versions2 && o.image_versions2.candidates) || []).slice().sort((a, b) => b.width - a.width);
    const video = (o.video_versions || [])[0];
    const big = thumbs[0] || {};
    return {
      thumbs,
      video: video ? video.url : null,
      w: o.original_width || big.width || 1,
      h: o.original_height || big.height || 1,
    };
  }

  // The song a photo post plays: the part its author chose, as { url,
  // start, end } in seconds, with `title` ("Song · Artist"); null when it
  // has none, or is a video (whose sound has the song in it already).
  // undefined when Instagram's response leaves the song out (the home and
  // profile queries do), for songFor to look up.
  function songOf(m) {
    if (m.media_type === 2) return null;
    const meta = m.music_metadata;
    if (meta === undefined) return undefined;
    const info = meta && meta.music_info;
    const asset = info && info.music_asset_info;
    const url = asset && (asset.progressive_download_url || asset.fast_start_progressive_download_url);
    const use = (info && info.music_consumption_info) || {};
    if (!url || use.should_mute_audio) return null;
    const start = (use.audio_asset_start_time_in_ms || 0) / 1000;
    return {
      url,
      start,
      end: use.overlap_duration_in_ms ? start + use.overlap_duration_in_ms / 1000 : null,
      title: [asset.title, asset.display_artist].filter(Boolean).join(' · '),
    };
  }

  // A post's song (see songOf), asking Instagram for the post when its
  // feed left the song out; null if it has none or can't be loaded.
  const songLookups = new Map();
  function songFor(it) {
    if (it.song !== undefined) return Promise.resolve(it.song);
    if (!songLookups.has(it.pk)) {
      songLookups.set(it.pk, api(`/api/v1/media/${it.pk}/info/`).then((res) => {
        const m = res && res.items && res.items[0];
        // A failed lookup is tried again next time.
        if (m) it.song = songOf(m);
        songLookups.delete(it.pk);
        return m ? it.song : null;
      }));
    }
    return songLookups.get(it.pk);
  }

  // A post or reel as the grids, the list and the player use it, from
  // Instagram's media object. A carousel has a slide per photo or video;
  // `thumbs` and `video` are the first slide's.
  function mediaItem(m) {
    if (!m || !m.code || !m.user || !m.user.username) return null;
    const parts = m.carousel_media && m.carousel_media.length ? m.carousel_media : [m];
    const slides = parts.map(slideOf).filter((s) => s.thumbs.length || s.video);
    if (!slides.length) return null;
    const fs = m.user.friendship_status;
    noteId(m.user);
    return {
      pk: idOf(m),
      code: m.code,
      kind: m.product_type === 'clips' ? 'reel' : 'post',
      username: m.user.username,
      pic: m.user.profile_pic_url,
      caption: (m.caption && m.caption.text) || '',
      likes: m.like_and_view_counts_disabled || m.like_count == null ? null : m.like_count,
      liked: !!m.has_liked,
      saved: !!m.has_viewer_saved,
      comments: m.comment_count || 0,
      commentsOff: !!(m.comments_disabled || m.commenting_disabled_for_viewer),
      token: m.organic_tracking_token || null,
      takenAt: m.taken_at,
      slides,
      thumbs: slides[0].thumbs,
      video: slides[0].video,
      song: slides.every((s) => s.video) ? null : songOf(m),
      // Whether you follow the author, when the feed says (null when not).
      following: fs && typeof fs.following === 'boolean' ? fs.following : null,
      ad: false,
    };
  }

  // A reel as the Reels grid and player use it.
  function clipItem(m) {
    const it = mediaItem(m);
    if (!it || !it.video) return null;
    // Covers: portrait ones, else the square crops.
    const portrait = it.thumbs.filter((c) => c.height > c.width);
    if (portrait.length) it.thumbs = it.slides[0].thumbs = portrait;
    return it;
  }

  // Instagram's media object for a post or reel, by its shortcode, which is
  // its pk in URL-safe base 64.
  async function mediaByCode(code) {
    const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let pk = 0n;
    for (const c of code.slice(0, 11)) {
      const d = ABC.indexOf(c);
      if (d < 0) return null;
      pk = pk * 64n + BigInt(d);
    }
    const res = await api(`/api/v1/media/${pk}/info/`);
    const m = res && res.items && res.items[0];
    if (!m) return null;
    // The exact pk, which a plain 11-letter code spells out in full.
    if (code.length <= 11 && m.code === code) m.pk = String(pk);
    return m;
  }

  // One reel by its shortcode.
  async function reelByCode(code) {
    return clipItem(await mediaByCode(code));
  }

  // One page of Instagram's Reels feed (the one its Reels tab plays), as
  // { items, after } where `after` is null at the end, or null on failure.
  // Ads come from a separate query, so there are none here.
  async function reelsPage(after) {
    const res = await gql(DOC_CLIPS, {
      after: after || null,
      before: null,
      data: { container_module: 'clips_tab_desktop_page', seen_reels: '[]' },
      first: 12,
      last: null,
      ...CLIPS_FLAGS,
    }, true);
    const conn = res && res.data && res.data.xdt_api__v1__clips__home__connection_v2;
    if (!conn) return null;
    const items = (conn.edges || []).map((e) => clipItem(e.node && e.node.media)).filter(Boolean);
    const info = conn.page_info || {};
    return { items, after: info.has_next_page ? info.end_cursor : null };
  }

  // One page of an account's posts, as its profile's Posts tab shows them
  // (pinned ones first), as { items, after } where `after` is null at the
  // end, or null on failure.
  async function profilePage(username, after) {
    const res = await gql(DOC_PROFILE_POSTS, {
      after: after || null,
      before: null,
      data: {
        count: 12,
        include_reel_media_seen_timestamp: true,
        include_relationship_info: true,
        latest_besties_reel_media: true,
        latest_reel_media: true,
      },
      first: 12,
      include_multi_captions: true,
      last: null,
      username,
      ...PROFILE_FLAGS,
    }, true);
    const conn = res && res.data && res.data.xdt_api__v1__feed__user_timeline_graphql_connection;
    if (!conn) return null;
    const items = (conn.edges || []).map((e) => mediaItem(e && e.node)).filter(Boolean);
    const info = conn.page_info || {};
    return { items, after: info.has_next_page ? info.end_cursor : null };
  }

  // One page of Explore's grid (the one under Instagram's search box), as
  // { items, after } where `after` is null at the end, or null on failure.
  // Instagram lays it out in sections (a big reel beside four tiles, rows
  // of tiles); the posts come in the order the sections hold them.
  async function explorePage(after) {
    const paging = after ? JSON.parse(after) : {};
    const q = new URLSearchParams({
      include_fixed_destinations: 'true',
      is_nonpersonalized_explore: 'false',
      is_prefetch: 'false',
      omit_cover_media: 'false',
      ...paging,
    });
    const res = await api(`/api/v1/discover/web/explore_grid/?${q}`);
    if (!res || !Array.isArray(res.sectional_items)) return null;
    const items = [];
    const walk = (o) => {
      if (!o || typeof o !== 'object') return;
      if (o.media && o.media.code) {
        const it = mediaItem(o.media);
        if (it) {
          if (o.media.ad_id || o.ad) it.ad = true;
          items.push(it);
        }
        return;
      }
      for (const v of Array.isArray(o) ? o : Object.values(o)) walk(v);
    };
    for (const s of res.sectional_items) walk(s.layout_content);
    const more = res.more_available && res.next_max_id != null;
    return {
      items,
      after: more ? JSON.stringify({
        max_id: String(res.next_max_id),
        ...(res.rank_token ? { rank_token: res.rank_token } : {}),
        ...(res.session_paging_token ? { session_paging_token: res.session_paging_token } : {}),
      }) : null,
    };
  }

  // ---- Likes and comments -------------------------------------------------

  // The first field of a mutation's result, or null if it failed.
  const mutated = (res) => (res && res.data && Object.values(res.data)[0]) || null;

  // Like or unlike a post or reel. Resolves to whether it worked.
  async function likeMedia(pk, on, token, module = 'clips_viewer_clips_tab') {
    const input = { media_id: pk, tracking_token: token || undefined };
    if (on) input.container_module = module;
    return !!mutated(await gql(on ? DOC_LIKE : DOC_UNLIKE, { input }, true));
  }

  // ---- Following ----------------------------------------------------------

  // Follow an account, or unfollow it (which also withdraws a request to
  // follow a private one). Resolves to { following, requested } as Instagram
  // now has it, or null on failure.
  async function follow(userId, on) {
    const send = () => gql(on ? DOC_FOLLOW : DOC_UNFOLLOW, { target_user_id: String(userId) }, true);
    let got = mutated(await send());
    if (!got) {
      cachedTokens = null; // tokens may have rotated: re-read them once
      got = mutated(await send());
    }
    if (!got) return null;
    // The result says where things stand, somewhere inside.
    const statusIn = (o, depth = 0) => {
      if (!o || typeof o !== 'object' || depth > 4) return null;
      if (o.friendship_status && typeof o.friendship_status === 'object') return o.friendship_status;
      if ('outgoing_request' in o && 'following' in o) return o;
      for (const v of Object.values(o)) {
        const fs = statusIn(v, depth + 1);
        if (fs) return fs;
      }
      return null;
    };
    const fs = statusIn(got);
    return fs ? { following: !!fs.following, requested: !!fs.outgoing_request } : { following: on, requested: false };
  }

  // ---- Saved posts --------------------------------------------------------

  // A mutation that names its actor, as Instagram's save mutations do.
  async function acting(docId, input) {
    const send = () => {
      const t = tokens();
      return gql(docId, { input: { ...input, actor_id: (t && t.actor) || undefined } }, true);
    };
    let got = mutated(await send());
    if (!got) {
      cachedTokens = null; // tokens may have rotated: re-read them once
      got = mutated(await send());
    }
    return got;
  }

  // Save a post or reel (to "All posts"), or unsave it. Resolves to
  // whether it worked.
  async function savePost(pk, on) {
    return !!(on
      ? await acting(DOC_SAVE, { container_module: 'feed_timeline', media_id: pk })
      : await acting(DOC_UNSAVE, { media_id: pk }));
  }

  // A page of your collections, as Instagram's "Collections" picker lists
  // them, as { items: [{ id, name, cover }], after }, or null on failure.
  async function collections(after) {
    const res = await gql(after ? DOC_COLLECTIONS_MORE : DOC_COLLECTIONS, after ? { after, first: 20 } : { first: 20 }, true);
    const conn = res && res.data && res.data.viewer && res.data.viewer.media_collections;
    if (!conn) return null;
    const cover = (m) => {
      const cands = (m && m.image_versions2 && m.image_versions2.candidates) || [];
      return (cands.find((c) => /_s150x150_/.test(c.url)) || cands[cands.length - 1] || {}).url || '';
    };
    const items = (conn.edges || []).map((e) => e && e.node).filter((n) => n && (n.collection_id || n.id))
      .map((n) => ({ id: String(n.collection_id || n.id), name: n.collection_name || '', cover: cover(n.cover_media) }));
    const info = conn.page_info || {};
    return { items, after: info.has_next_page ? info.end_cursor : null };
  }

  // Add a saved post to one of your collections. Resolves to whether it worked.
  async function addToCollection(collectionId, pk) {
    return !!(await acting(DOC_COLLECTION_ADD, { collection_id: collectionId, media_id: pk }));
  }

  // Make a collection holding the post. Resolves to its id ('' when
  // Instagram doesn't say), or null on failure.
  async function newCollection(name, pk) {
    const got = await acting(DOC_COLLECTION_NEW, { added_media_ids: [pk], name });
    if (!got) return null;
    const id = got.collection_id || got.id || (got.collection && (got.collection.collection_id || got.collection.id));
    return id ? String(id) : '';
  }

  async function likeComment(pk, on) {
    return !!mutated(await gql(on ? DOC_COMMENT_LIKE : DOC_COMMENT_UNLIKE, { input: { comment_id: pk } }, true));
  }

  function toComment(c) {
    if (!c || !c.pk || !c.user) return null;
    noteId(c.user);
    return {
      pk: idOf(c),
      text: c.text || '',
      username: c.user.username,
      pic: c.user.profile_pic_url,
      at: c.created_at,
      likes: c.comment_like_count || 0,
      liked: !!c.has_liked_comment,
      replies: c.child_comment_count || 0,
    };
  }

  // A page of a post's comments, as { comments, next } where `next` is the
  // cursor for the following page (null at the end), or null on failure.
  async function comments(pk, cursor) {
    let path = `/api/v1/media/${pk}/comments/?can_support_threading=true&permalink_enabled=false`;
    if (cursor) path += `&${cursor.key}=${encodeURIComponent(cursor.value)}`;
    const res = await api(path);
    if (!res || !res.comments) return null;
    const next = res.has_more_headload_comments && res.next_min_id ? { key: 'min_id', value: res.next_min_id }
      : res.has_more_comments && res.next_max_id ? { key: 'max_id', value: res.next_max_id }
      : null;
    return { comments: res.comments.map(toComment).filter(Boolean), next };
  }

  // Replies to a comment, oldest first, paged the same way.
  async function replies(pk, commentPk, cursor) {
    let path = `/api/v1/media/${pk}/comments/${commentPk}/child_comments/`;
    if (cursor) path += `?${cursor.key}=${encodeURIComponent(cursor.value)}`;
    const res = await api(path);
    if (!res || !res.child_comments) return null;
    const next = res.has_more_tail_child_comments && res.next_max_child_cursor ? { key: 'max_id', value: res.next_max_child_cursor }
      : res.has_more_head_child_comments && res.next_min_child_cursor ? { key: 'min_id', value: res.next_min_child_cursor }
      : null;
    return { comments: res.child_comments.map(toComment).filter(Boolean), next };
  }

  // Post a comment, or a reply to comment `replyTo`. Resolves to the new
  // comment, or null if it failed.
  async function addComment(pk, text, replyTo, token) {
    const data = { comment_text: text, media_id: pk, tracking_token: token || undefined };
    if (replyTo) data.replied_to_comment_id = '@REPLY@';
    // Instagram sends the id as a JSON number; ids are too long for a
    // JavaScript number, so write its digits into the JSON directly.
    let variables = JSON.stringify({ data, root_connections: [] });
    if (replyTo && /^\d+$/.test(replyTo)) variables = variables.replace('"@REPLY@"', replyTo);
    const root = mutated(await gql(DOC_COMMENT, variables, true));
    return root ? toComment(root.comment || root) : null;
  }

  // Like or unlike a story (the heart, which its author sees in the viewer list).
  async function likeStory(pk, on) {
    return !!mutated(await gql(on ? DOC_STORY_LIKE : DOC_STORY_UNLIKE, { input: { media_id: pk } }, true));
  }

  // Who has seen one of your own stories, a page at a time, as Instagram's
  // viewer list shows them: { count, viewers, next }, or null on failure.
  async function storyViewers(pk, after) {
    const data = await api(`/api/v1/media/${pk}/list_reel_media_viewer/${after ? `?max_id=${encodeURIComponent(after)}` : ''}`);
    if (!data || !Array.isArray(data.viewers)) return null;
    const viewers = data.viewers.filter((v) => v.user && v.user.username).map((v) => ({
      username: v.user.username,
      name: v.user.full_name || '',
      pic: v.user.profile_pic_url || '',
      liked: !!v.has_liked,
      reply: v.reply_text || '',
    }));
    return { count: data.total_viewer_count ?? data.user_count ?? viewers.length, viewers, next: data.next_max_id || null };
  }

  // The logged-in account's id.
  const me = () => (document.cookie.match(/(?:^|; )ds_user_id=(\d+)/) || [])[1] || '';

  // Reply to a story in the author's DMs, with text or a reaction emoji,
  // as Instagram's own viewer does. Resolves to whether it was sent.
  async function replyToStory(pk, reelId, userId, text, emoji) {
    // An "offline threading id": the time in ms shifted left 22 bits, plus random bits.
    const otid = String((BigInt(Date.now()) << 22n) | BigInt(Math.floor(Math.random() * 4194304)));
    const variables = {
      data: {
        is_shh_mode: false,
        media_id: pk,
        reaction_emoji: emoji || null,
        reel_id: reelId,
        sampled: false,
        share_client_context: otid,
        text: text ? { sensitive_string_value: text } : null,
      },
      send_data: {
        forwarded_from_thread_id: null,
        is_forwarded_from_own_message: null,
        offline_threading_id: otid,
        recipient_users: JSON.stringify([String(userId)]),
        thread_id: null,
      },
    };
    return !!mutated(await gql(DOC_STORY_REPLY, variables, true));
  }

  // Navigate through Instagram's own router (no page reload). In Firefox the
  // event has to be created in the page's world for its router to read it.
  function go(url) {
    try {
      const page = window.wrappedJSObject || window;
      const clone = (o) => (typeof cloneInto === 'function' ? cloneInto(o, window) : o);
      page.history.pushState(clone({}), '', url);
      page.dispatchEvent(new page.PopStateEvent('popstate', clone({ state: {} })));
    } catch (_) {
      location.assign(url);
    }
  }

  // ---- History -------------------------------------------------------------

  // The player and the story viewer give each post and story its own
  // history entry, at Instagram's own address for it (/p/<code>/,
  // /stories/<name>/<pk>/), so Back and Forward go through them as through
  // pages. Instagram's router is never told: the entries are pushed without
  // a popstate, and the popstates that land on them, or come back from them
  // to where they were opened (the base), stop here, before Instagram's own
  // listener (this one is registered at document start). To Instagram, and
  // to here(), the page stays on the base.
  const nav = (() => {
    const SESSION = Math.random().toString(36).slice(2);
    const owners = {}; // 'player', 'story': { restore(data), leave() }
    const bases = new Map(); // base id -> Instagram's state on the base entry
    let bids = 0;
    let entry = null; // { s, href, routed }: the current entry, while it's ours
    let known = location.href; // where Instagram's router last was
    let relaying = false;
    const page = () => window.wrappedJSObject || window;
    const clone = (o) => (typeof cloneInto === 'function' ? cloneInto(o, window) : o);

    function ours(state) {
      try {
        const s = state && typeof state.sinsta === 'string' && JSON.parse(state.sinsta);
        return s && s.session === SESSION && owners[s.owner] ? s : null;
      } catch (_) {
        return null;
      }
    }

    function write(s, url, push) {
      page().history[push ? 'pushState' : 'replaceState'](clone({ sinsta: JSON.stringify(s) }), '', url);
      entry = { s, href: location.href };
    }

    // What `owner` shows is now at `url`, described by `data` (for restore).
    // A new entry, unless the current one is already there (as after Back);
    // `push` makes one even at the same address.
    function at(owner, url, data, push = false) {
      try {
        const href = new URL(url, location.href).href;
        const cur = entry;
        if (cur && cur.s.owner === owner) {
          const same = !push && (cur.href === href || cur.routed);
          write({ ...cur.s, depth: cur.s.depth + (same ? 0 : 1), data }, url, !same);
          return;
        }
        const base = here().href;
        const bid = cur ? cur.s.bid : ++bids;
        if (!cur) bases.set(bid, page().history.state);
        write({ session: SESSION, owner, base, bid, depth: cur ? cur.s.depth + 1 : 1, data }, url, true);
      } catch (e) {
        console.warn('Here for Instagram: history', e);
      }
    }

    // `owner` has closed. `step`: closed by the person, which is a step of
    // its own, back on the base's address, so Back from there reopens what
    // it closed on. Otherwise it closed for a page Instagram goes on to,
    // from which Back comes back.
    function done(owner, step) {
      const cur = entry;
      if (!cur || cur.s.owner !== owner) return;
      entry = null;
      if (!step) return;
      try {
        const st = bases.has(cur.s.bid) ? bases.get(cur.s.bid) : null;
        page().history.pushState(st, '', cur.s.base);
      } catch (e) {
        console.warn('Here for Instagram: history', e);
      }
      known = location.href;
    }

    // Instagram is on another page (Back from it landed on one of ours): it
    // goes back to the base as from that page, and what was showing opens on
    // it again.
    function route(s) {
      const h = page().history;
      h.replaceState(bases.has(s.bid) ? bases.get(s.bid) : null, '', s.base);
      entry = { s, href: location.href, routed: true };
      let init;
      try {
        init = clone({});
        init.state = h.state;
      } catch (_) {
        init = clone({ state: {} });
      }
      relaying = true;
      try {
        page().dispatchEvent(new (page().PopStateEvent)('popstate', init));
      } finally {
        relaying = false;
      }
      known = location.href;
    }

    window.addEventListener('popstate', (e) => {
      if (relaying) return;
      const s = ours(e.state);
      const was = entry;
      if (s) {
        e.stopImmediatePropagation();
        if (was && was.s.owner !== s.owner) owners[was.s.owner].leave();
        entry = { s, href: location.href };
        if (!was && known !== s.base) route(s);
        owners[s.owner].restore(s.data);
        return;
      }
      entry = null;
      // Back (or, after closing, Forward) to the base: Instagram is there already.
      const home = was && location.href === was.s.base;
      if (was) owners[was.s.owner].leave();
      known = location.href;
      if (home) e.stopImmediatePropagation();
    }, true);

    // Instagram going on to another page while one of ours was current.
    new MutationObserver(() => {
      if (entry && location.href !== entry.href) {
        const owner = entry.s.owner;
        entry = null;
        owners[owner].leave();
      }
      if (!entry) known = location.href;
    }).observe(document, { childList: true, subtree: true });

    // The address Instagram is on: the base while one of ours is current.
    function here() {
      return new URL(entry && location.href === entry.href ? entry.s.base : location.href);
    }

    return {
      at,
      done,
      here,
      own: (owner, handlers) => { owners[owner] = handlers; },
      // The current entry's data, if it's `owner`'s.
      data: (owner) => (entry && entry.s.owner === owner ? entry.s.data : null),
    };
  })();

  // ---- DOM helpers --------------------------------------------------------

  // Every element the extension adds carries the id of the copy that made
  // it. Reloading or updating the extension runs it again in tabs already
  // open, where the previous copy's elements stay behind, dead (a second
  // tab bar, a second end-of-feed note); this copy removes them.
  const GEN = Math.random().toString(36).slice(2);
  const mark = (node) => {
    node.setAttribute('data-sinsta-gen', GEN);
    return node;
  };
  for (const node of document.querySelectorAll('[data-sinsta-gen]')) {
    if (node.getAttribute('data-sinsta-gen') !== GEN) node.remove();
  }

  function el(tag, props, ...kids) {
    const node = mark(Object.assign(document.createElement(tag), props));
    node.append(...kids);
    return node;
  }

  // A video inside a closed shadow root, so scripts that scan the page's videos
  // don't find it (one extension paired ours with Instagram's hidden player,
  // clipped its bottom and re-routed its clicks). Returns the video; style and
  // place its host, from hostOf().
  function shadowVideo(props, fit) {
    const host = el('div');
    const v = el('video', props);
    Object.assign(v.style, { display: 'block', width: '100%', height: '100%', objectFit: fit });
    host.attachShadow({ mode: 'closed' }).append(v);
    return v;
  }
  const hostOf = (v) => v.getRootNode().host;

  // A seekbar with the time beside it, for whichever video attach() was last
  // given. It follows playback every frame and seeks as it is dragged.
  function seekbar() {
    const input = el('input', { type: 'range', className: 'sinsta-seek', min: 0, max: 1, step: 'any', value: 0, title: 'Seek' });
    const clock = el('span', { className: 'sinsta-clock' });
    const row = el('div', { className: 'sinsta-seekrow' }, input, clock);
    let video = null;
    let raf = 0;
    let pressed = false;
    let text = '';
    const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    function sync() {
      raf = video ? requestAnimationFrame(sync) : 0;
      if (!video) return;
      const d = video.duration;
      const t = video.currentTime;
      const next = d ? `${fmt(t)} / ${fmt(d)}` : '';
      if (next !== text) clock.textContent = text = next;
      // Writing the value during a press on the slider can cancel it in Firefox.
      if (!pressed) {
        const v = String(d ? t / d : 0);
        if (input.value !== v) input.value = v;
      }
    }
    input.addEventListener('pointerdown', () => { pressed = true; });
    window.addEventListener('pointerup', () => { pressed = false; }, true);
    input.addEventListener('input', () => {
      if (video && video.duration) video.currentTime = Number(input.value) * video.duration;
    });
    // Let go of focus, so the player's keys (arrows, space) work again.
    input.addEventListener('change', () => input.blur());
    function attach(v) {
      video = v;
      if (video && !raf) raf = requestAnimationFrame(sync);
      if (!video) {
        cancelAnimationFrame(raf);
        raf = 0;
        clock.textContent = text = '';
        input.value = '0';
      }
    }
    return { row, attach };
  }

  // Playback speeds, slowest first; shift(rate, ±1) is the next one along.
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
  function shiftSpeed(rate, delta) {
    const i = SPEEDS.indexOf(rate);
    return SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? SPEEDS.indexOf(1) : i) + delta))];
  }
  // The next speed up for a click, back to the slowest after the fastest.
  const cycleSpeed = (rate) => SPEEDS[(SPEEDS.indexOf(rate) + 1) % SPEEDS.length];
  function setRate(video, rate) {
    // load() resets playbackRate to the default, so set both.
    video.defaultPlaybackRate = rate;
    video.playbackRate = rate;
  }
  const speedLabel = (rate) => `${rate}×`;

  // Show a full-window overlay in the browser's top layer, so it covers
  // whatever Instagram stacks with z-index (in narrow or zoomed windows,
  // parts of its hidden feed otherwise show through).
  function onTop(node) {
    document.body.append(node);
    if (!node.showPopover || node.matches(':popover-open')) return;
    node.popover = 'manual';
    node.showPopover();
  }

  function icon(paths) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = mark(document.createElementNS(NS, 'svg'));
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    for (const d of paths) {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      svg.append(path);
    }
    return svg;
  }

  // ---- Account ids --------------------------------------------------------

  const userIds = new Map(); // username -> user id, as far as known

  // Posts and comments say whose they are: noted, so a profile card for
  // their names needs no lookup.
  function noteId(user) {
    const id = user && (user.pk || user.id);
    if (user && user.username && id && !userIds.has(user.username)) userIds.set(user.username, String(id));
  }

  // What Instagram's hover card on a name shows: the account, its counts,
  // whether you follow each other, and its latest three posts, as
  // { username, fullName, pic, verified, private, posts, followers,
  // following, youFollow, followsYou, favourite, recent: [{ code, thumb }] },
  // or null on failure.
  async function userCard(userId) {
    const send = () => gql(DOC_USER_CARD, { userID: String(userId) }, true);
    const of = (res) => res && res.data && res.data.xig_user_by_igid_v2;
    let got = of(await send());
    if (!got) {
      cachedTokens = null; // tokens may have rotated: re-read them once
      got = of(await send());
    }
    const u = got && got.user_dict;
    if (!u || !u.username) return null;
    const fs = u.friendship_status || {};
    // Square crops, a little larger than the card shows them.
    const thumb = (cands) => {
      const square = cands.filter((c) => /[?&]stp=c[\d.]+a_/.test(c.url));
      const pool = square.length ? square : cands;
      return (pool.find((c) => /_s320x320_/.test(c.url)) || pool.find((c) => /_s240x240_/.test(c.url)) || pool[0] || {}).url || '';
    };
    const edges = (got.polaris_ordered_timeline_connection && got.polaris_ordered_timeline_connection.edges) || [];
    return {
      username: u.username,
      fullName: u.full_name || '',
      pic: (u.hd_profile_pic_url_info && u.hd_profile_pic_url_info.url) || u.profile_pic_url || '',
      verified: !!u.is_verified,
      private: !!u.is_private,
      posts: u.media_count == null ? null : u.media_count,
      followers: u.follower_count == null ? null : u.follower_count,
      following: u.following_count == null ? null : u.following_count,
      youFollow: !!fs.following,
      followsYou: !!fs.followed_by,
      requested: !!fs.outgoing_request, // asked to follow a private account
      favourite: !!fs.is_feed_favorite,
      recent: edges.map((e) => e && e.node && e.node.media_dict).filter((m) => m && m.code)
        .slice(0, 3)
        .map((m) => ({ code: m.code, thumb: thumb((m.image_versions2 && m.image_versions2.candidates) || []) })),
    };
  }

  // Favourites' ids come with the favourites list. For anyone else, the only
  // lookup left on the web (web_profile_info is gone) is the profile page,
  // which is large, so it is fetched on click rather than on hover.
  async function lookUpId(user) {
    if (userIds.has(user)) return userIds.get(user);
    // Firefox: content.fetch sends the request as the page would.
    const f = typeof content === 'object' && content && content.fetch ? content.fetch.bind(content) : window.fetch.bind(window);
    try {
      const res = await f(`${location.origin}/${encodeURIComponent(user)}/`, { credentials: 'include' });
      const id = ((await res.text()).match(/"profile_id":"(\d+)"/) || [])[1];
      if (id) userIds.set(user, id);
      return id || null;
    } catch (_) {
      return null;
    }
  }

  // ---- Viewer state -------------------------------------------------------

  let list = []; // reels in play order: { id, username, pic, unseen, seenAt }
  let ri = 0; // reel index
  let ii = START; // item index within the reel
  let dir = 1; // last direction of travel between accounts
  let open = false;
  let token = 0; // invalidates async work from a previous show()
  let current = null; // the <img> or <video> on stage
  let shown = false; // current media has actually loaded
  let raf = 0;
  let muted = true;
  let speed = 1;
  let spacePaused = false;
  let holding = false;
  let hovering = false; // pointer on a sticker
  let card = null; // the current story's shared card: { href, label }
  let bubbleOn = false; // its "Name ›" bubble is showing
  let listing = false; // the list of who has seen your story is open
  let sids = 0;
  let sid = 0; // this opening of the viewer, for its history entries
  const viewings = new Map(); // sid -> { list, onClose }, to reopen from history
  let wantListing = false; // show() opens the list (a history entry had it open)
  let downAt = 0;
  let typing = false; // the reply box has focus
  let sending = false; // a reply or reaction is on its way
  let onClose = null;

  const media = new Map(); // reel id -> [{ pk, takenAt, type, src, thumb, ... }]
  const pending = new Map(); // reel id -> promise of the fetch that covers it
  const preloaded = new Map(); // src -> element
  let storyIn = false; // the story on stage is in (or given up on): the cards' pictures and preloads may load

  // ---- Viewer DOM ---------------------------------------------------------

  const SOUND_OFF = ['M4 9v6h4l5 4V5L8 9z', 'M16.5 9.5l5 5M21.5 9.5l-5 5'];
  const SOUND_ON = ['M4 9v6h4l5 4V5L8 9z', 'M16.5 8.5a5 5 0 0 1 0 7'];

  const mediaBox = el('div', { className: 'sv-media' });
  const bars = el('div', { className: 'sv-bars' });
  const avatar = el('img', { className: 'sv-avatar', alt: '' });
  const userLink = el('a', { className: 'sv-user' });
  const timeText = el('span', { className: 'sv-time' });
  const muteBtn = el('button', { className: 'sv-btn', type: 'button', title: 'Sound (M)' });
  const speedBtn = el('button', { className: 'sv-btn sinsta-speed', type: 'button', title: 'Speed (< >)' }, speedLabel(speed));
  const seek = seekbar();
  const note = el('div', { className: 'sv-note' });
  const stickerBox = el('div', { className: 'sv-stickers' });
  const bubbleText = el('span');
  const bubble = el('a', { className: 'sv-bubble', hidden: true }, bubbleText, icon(['M9 5l7 7-7 7']));
  const sub = el('div', { className: 'sv-sub' });
  // Reply, quick reactions and the heart, along the bottom as in Instagram's viewer.
  const REACTIONS = ['😂', '😮', '😍', '😢', '👏', '🔥', '🎉', '💯'];
  const HEART = ['M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z'];
  const replyInput = el('input', { className: 'sv-reply', type: 'text', maxLength: 1000, enterKeyHint: 'send' });
  const likeBtn = el('button', { className: 'sv-btn sv-like', type: 'button', title: 'Like (L)' }, icon(HEART));
  const reactions = el('div', { className: 'sv-reactions', hidden: true },
    ...REACTIONS.map((emoji) => el('button', { type: 'button', className: 'sv-emoji', title: `React with ${emoji}` }, emoji)));
  const toast = el('div', { className: 'sv-toast', hidden: true });
  // On your own stories: how many have seen it, liked it and replied, in
  // place of the reply box, and beside the story the list of who, opened
  // from it.
  const EYE = ['M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z', 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6'];
  const BUBBLE = ['M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z'];
  const stat = (className, title, paths) => {
    const n = el('b');
    return [el('span', { className, title }, icon(paths), n), n];
  };
  const [seenViews, seenViewsN] = stat('sv-stat', 'Viewers', EYE);
  const [seenLikes, seenLikesN] = stat('sv-stat sv-stat-likes', 'Likes', HEART);
  const [seenReplies, seenRepliesN] = stat('sv-stat', 'Replies', BUBBLE);
  const seenBtn = el('button', { className: 'sv-seen', type: 'button', title: 'Viewers (V)', hidden: true }, seenViews, seenLikes, seenReplies);
  const viewersCount = el('small');
  const viewersClose = el('button', { type: 'button', title: 'Close (Esc)' }, icon(['M6 6l12 12M18 6L6 18']));
  const tabN = { all: el('b'), likes: el('b'), replies: el('b') };
  const tabs = {
    all: el('button', { type: 'button', className: 'sv-tab' }, 'All', tabN.all),
    likes: el('button', { type: 'button', className: 'sv-tab sv-stat-likes', title: 'Liked it' }, icon(HEART), tabN.likes),
    replies: el('button', { type: 'button', className: 'sv-tab', title: 'Replied' }, icon(BUBBLE), tabN.replies),
  };
  const viewersList = el('div', { className: 'sv-viewers-list' });
  const viewersBox = el('div', { className: 'sv-viewers', hidden: true },
    el('div', { className: 'sv-viewers-head' }, el('span', { className: 'sv-viewers-title' }, 'Viewers', viewersCount), viewersClose),
    el('div', { className: 'sv-tabs' }, tabs.all, tabs.likes, tabs.replies),
    viewersList);
  const foot = el('div', { className: 'sv-foot' }, seek.row, reactions, seenBtn, el('div', { className: 'sv-reply-row' }, replyInput, likeBtn));
  const stage = el('div', { className: 'sv-stage' },
    mediaBox,
    stickerBox,
    el('div', { className: 'sv-dim' }),
    el('div', { className: 'sv-top' },
      bars,
      el('div', { className: 'sv-head' }, avatar, userLink, timeText, el('span', { className: 'sv-gap' }), speedBtn, muteBtn),
      sub),
    note,
    toast,
    foot);
  const closeBtn = el('button', { className: 'sv-close', type: 'button', title: 'Close (Esc)' }, icon(['M6 6l12 12M18 6L6 18']));
  // The viewer scrolls sideways, one snap point per account (see Scrolling
  // the carousel): `view` stays put while `wide` gives it room to scroll.
  const view = el('div', { className: 'sv-view' }, closeBtn, stage, viewersBox);
  const stops = el('div'); // a snap point per account, placed by sizeScroller
  const wide = el('div', { className: 'sv-wide' }, view, stops);
  const root = el('div', { id: 'sinsta-viewer' }, wide);

  closeBtn.addEventListener('click', () => close());
  muteBtn.addEventListener('click', () => setMuted(!muted));
  speedBtn.addEventListener('click', () => setSpeed(cycleSpeed(speed)));
  // Links within Instagram close the viewer and navigate in place; link
  // stickers open a new tab and pause the story.
  stage.addEventListener('click', (e) => {
    const link = e.target.closest('a[href]');
    if (!link || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (link.target === '_blank') {
      spacePaused = true;
      syncPause();
      return;
    }
    e.preventDefault();
    const href = link.getAttribute('href');
    close(false);
    go(href);
  });

  // Tap the left third to go back, elsewhere to go forward; hold to pause.
  // As on Instagram, tapping a shared post or story shows a bubble linking to
  // it instead, and the next tap anywhere else dismisses the bubble.
  stage.addEventListener('pointerdown', (e) => {
    // While typing a reply, a tap on the story only leaves the reply box.
    if (e.button !== 0 || typing || e.target.closest('a, button, input, .sv-foot, .sv-viewers')) return;
    downAt = Date.now();
    holding = true;
    syncPause();
  });
  stage.addEventListener('pointerup', (e) => {
    if (!downAt) return;
    const held = Date.now() - downAt;
    release();
    if (held >= 250) return;
    if (listing) return showListing(false);
    if (bubbleOn) return setBubble(false);
    if (card && onCard(e)) return setBubble(true);
    const box = stage.getBoundingClientRect();
    step(e.clientX - box.left < box.width * 0.3 ? -1 : 1);
  });

  // Instagram reports a shared card only as the middle quarter of the media,
  // whatever its real size.
  function onCard(e) {
    const box = stickerBox.getBoundingClientRect();
    const x = (e.clientX - box.left) / box.width;
    const y = (e.clientY - box.top) / box.height;
    return x > 0.25 && x < 0.75 && y > 0.25 && y < 0.75;
  }

  function setBubble(on) {
    bubbleOn = on;
    bubble.hidden = !on;
    syncPause();
  }
  stage.addEventListener('pointerleave', release);
  stage.addEventListener('pointercancel', release);

  // A click outside the story and the cards closes the viewer. Not while the
  // carousel turns (the stage is hidden then), nor at the end of a drag.
  // While typing a reply or with a shared card's bubble up, it only leaves
  // those, as a tap on the story does.
  let outsideDown = null;
  const outside = (t) => !t.closest('.sv-stage, .sv-peek, .sv-viewers, a, button, input');
  root.addEventListener('pointerdown', (e) => {
    outsideDown = e.button === 0 && outside(e.target) ? { x: e.clientX, y: e.clientY, typing, bubble: bubbleOn, listing } : null;
  });
  root.addEventListener('click', (e) => {
    const down = outsideDown;
    outsideDown = null;
    if (!down || !open || scrolling || !outside(e.target)) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10 || down.typing) return;
    if (down.listing) return showListing(false);
    if (down.bubble) return setBubble(false);
    close();
  });

  function release() {
    downAt = 0;
    holding = false;
    syncPause();
  }

  // Registered once, at document start, so it runs before Instagram's own
  // key handlers, which could otherwise swallow the keys.
  window.addEventListener('keydown', (e) => {
    if (open) onKey(e);
  }, true);

  function onKey(e) {
    // Typing a reply: keep the keys from the viewer and from Instagram.
    if (e.target === replyInput) {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        replyInput.blur();
      } else if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        sendReply();
      }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const actions = {
      Escape: () => (listing ? showListing(false) : close()),
      ArrowRight: () => (e.shiftKey ? jump(1) : step(1)),
      ArrowLeft: () => (e.shiftKey ? jump(-1) : step(-1)),
      ' ': () => { spacePaused = !spacePaused; syncPause(); },
      m: () => setMuted(!muted),
      l: toggleLike,
      v: () => showListing(!listing),
      '<': () => setSpeed(shiftSpeed(speed, -1)),
      '>': () => setSpeed(shiftSpeed(speed, 1)),
    };
    const action = actions[e.key];
    if (!action) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    action();
  }

  // ---- Replies, reactions and likes ---------------------------------------

  function currentItem() {
    const reel = list[ri];
    const item = reel && (media.get(reel.id) || [])[ii];
    return item ? { reel, item } : null;
  }

  replyInput.addEventListener('focus', () => {
    typing = true;
    reactions.hidden = false;
    syncPause();
  });
  replyInput.addEventListener('blur', () => {
    typing = false;
    reactions.hidden = true;
    syncPause();
  });
  // Keep the reply box focused while an emoji is pressed, so it stays open.
  reactions.addEventListener('pointerdown', (e) => e.preventDefault());
  reactions.addEventListener('click', (e) => {
    const b = e.target.closest('.sv-emoji');
    if (b) send(null, b.textContent);
  });
  likeBtn.addEventListener('click', toggleLike);

  function sendReply() {
    const text = replyInput.value.trim();
    if (text) send(text, null);
  }

  // While a reply is on its way the box stays focused but read-only (a
  // disabled input would lose focus), and the story stays paused, so it
  // can't move on and take the typed text with it.
  async function send(text, emoji) {
    const cur = currentItem();
    if (!cur || !cur.item.canReply || sending) return;
    sending = true;
    replyInput.readOnly = true;
    replyInput.toggleAttribute('data-sending', true);
    syncPause();
    const ok = await replyToStory(cur.item.pk, cur.reel.id, cur.reel.id, text, emoji);
    sending = false;
    replyInput.readOnly = false;
    replyInput.toggleAttribute('data-sending', false);
    syncPause();
    if (!open) return;
    if (ok) {
      if (text) replyInput.value = '';
      replyInput.blur();
      showToast(emoji ? emoji : 'Sent', !!emoji);
    } else {
      showToast(emoji ? 'Couldn\'t send your reaction' : 'Couldn\'t send your reply', false);
      if (text) replyInput.focus();
    }
  }

  let toastTimer = 0;
  function showToast(text, big) {
    toast.textContent = text;
    toast.classList.toggle('sv-toast-big', big);
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, big ? 1200 : 2000);
  }

  // Stories whose like is on its way; another story can be liked meanwhile.
  const liking = new WeakSet();

  async function toggleLike() {
    const cur = currentItem();
    if (!cur || liking.has(cur.item) || cur.reel.id === me()) return;
    const { item } = cur;
    const flip = (v) => {
      item.liked = v;
      syncLike();
    };
    const on = !item.liked;
    liking.add(item);
    flip(on);
    const ok = await likeStory(item.pk, on);
    liking.delete(item);
    flip(ok ? on : !on);
  }

  function syncLike() {
    const cur = currentItem();
    const liked = !!(cur && cur.item.liked);
    likeBtn.toggleAttribute('data-busy', !!(cur && liking.has(cur.item)));
    likeBtn.toggleAttribute('data-on', liked);
    likeBtn.title = liked ? 'Unlike (L)' : 'Like (L)';
  }

  // The bottom bar for the story on screen; typed text stays while the
  // account stays the same.
  function syncFoot(reel, item) {
    if (foot.dataset.reel !== reel.id) {
      foot.dataset.reel = reel.id;
      replyInput.value = '';
    }
    replyInput.placeholder = `Reply to ${reel.username}…`;
    const own = reel.id === me();
    replyInput.hidden = own || !item.canReply;
    if (replyInput.hidden && typing) replyInput.blur();
    likeBtn.hidden = own;
    seenBtn.hidden = !own;
    foot.hidden = false;
    syncLike();
    if (own) {
      const s = seenBy.get(item.pk);
      if (!s || (!s.busy && Date.now() - s.at > VIEWERS_TTL)) loadViewers(item.pk);
      renderSeen();
    } else if (listing) {
      setListing(false);
    }
  }

  // ---- Who has seen your story --------------------------------------------

  const VIEWERS_TTL = 60000; // asked again when shown after this long
  const VIEWER_PAGES = 30; // at most this many pages of viewers
  const seenBy = new Map(); // story pk -> { at, count, viewers, more, busy, failed }
  let viewersTab = 'all'; // all, likes or replies

  // Every page, so the likes and replies can be counted and the likers put
  // first. The first time, the counts fill in as the pages come; after
  // that, the new list replaces the old one when it is complete.
  async function loadViewers(pk) {
    const s = seenBy.get(pk) || { at: 0, count: null, viewers: [], more: false, busy: false, failed: false };
    if (s.busy) return;
    seenBy.set(pk, s);
    s.busy = true;
    const first = s.count === null;
    const shown = () => {
      const cur = currentItem();
      if (open && cur && cur.item.pk === pk) renderSeen();
    };
    let viewers = [];
    let count = null;
    let after = null;
    let pages = 0;
    do {
      const page = await storyViewers(pk, after);
      if (!page) break;
      count = page.count;
      viewers = viewers.concat(page.viewers);
      after = page.next;
      if (first) Object.assign(s, { count, viewers, more: !!after });
      if (first && after) shown();
    } while (after && ++pages < VIEWER_PAGES);
    s.busy = false;
    if (count !== null) Object.assign(s, { at: Date.now(), failed: false, count, viewers, more: !!after });
    else s.failed = s.count === null;
    shown();
  }

  // Opened or closed by the person: either is a history step, so Back
  // undoes it.
  function showListing(on) {
    const was = listing;
    setListing(on);
    const d = nav.data('story');
    if (listing === was || !d) return;
    nav.at('story', location.href, { ...d, listing }, true);
  }

  function setListing(on) {
    const cur = currentItem();
    on = !!(on && cur && cur.reel.id === me());
    if (on === listing) return;
    listing = on;
    viewersBox.hidden = !on;
    root.classList.toggle('sv-listing', on);
    if (on) {
      viewersList.scrollTop = 0;
      renderSeen();
    }
    syncPause();
  }

  // The counts and, while open, the list: likers first, then the rest, in
  // Instagram's order.
  function renderSeen() {
    const cur = currentItem();
    if (!cur) return;
    const s = seenBy.get(cur.item.pk);
    const all = (s && s.viewers) || [];
    const likers = all.filter((v) => v.liked);
    const repliers = all.filter((v) => v.reply);
    const plus = s && s.more ? '+' : '';
    const known = !!(s && s.count !== null);
    seenViewsN.textContent = known ? s.count : s && s.failed ? '–' : '…';
    seenLikesN.textContent = likers.length + plus;
    seenRepliesN.textContent = repliers.length + plus;
    seenLikes.hidden = !likers.length;
    seenReplies.hidden = !repliers.length;
    seenBtn.title = s && s.failed ? 'Couldn\'t load who has seen it' : 'Viewers (V)';
    if (!listing) return;
    viewersCount.textContent = known && s.count ? s.count : '';
    tabN.all.textContent = known ? s.count : '';
    tabN.likes.textContent = likers.length + plus;
    tabN.replies.textContent = repliers.length + plus;
    for (const [k, b] of Object.entries(tabs)) b.toggleAttribute('data-on', k === viewersTab);
    const picked = { all, likes: likers, replies: repliers }[viewersTab];
    const shown = [...picked.filter((v) => v.liked), ...picked.filter((v) => !v.liked)];
    const rows = shown.map((v) => el('div', { className: 'sv-viewer' },
      el('img', { src: v.pic, alt: '' }),
      el('div', { className: 'sv-viewer-who' },
        el('a', { href: `/${v.username}/` }, v.username),
        v.name ? el('span', { className: 'sv-viewer-name' }, v.name) : '',
        v.reply ? el('span', { className: 'sv-viewer-reply' }, v.reply) : ''),
      v.liked ? el('span', { className: 'sv-viewer-liked', title: 'Liked' }, icon(HEART)) : ''));
    const end = s && s.failed ? 'Couldn\'t load who has seen it'
      : !known || (s.busy && all.length < s.count) ? 'Loading…'
      : shown.length ? ''
      : { all: 'No one has seen it yet', likes: 'No likes yet', replies: 'No replies yet' }[viewersTab];
    viewersList.replaceChildren(...rows, ...(end ? [el('div', { className: 'sv-viewers-end' }, end)] : []));
    if (viewersList.dataset.pk !== cur.item.pk) {
      viewersList.dataset.pk = cur.item.pk;
      viewersList.scrollTop = 0;
    }
  }

  for (const [k, b] of Object.entries(tabs)) {
    b.addEventListener('click', () => {
      viewersTab = k;
      viewersList.scrollTop = 0;
      renderSeen();
    });
  }
  viewersClose.addEventListener('click', () => showListing(false));
  seenBtn.addEventListener('click', () => showListing(!listing));

  // ---- Data ---------------------------------------------------------------

  function toItem(it) {
    const video = it.media_type === 2 && it.video_versions && it.video_versions[0];
    const images = (it.image_versions2 && it.image_versions2.candidates) || [];
    const image = images[0];
    if (!video && !image) return null;
    // The smallest image still sharp on a neighbour card beside the stage.
    const thumb = images.filter((c) => c.width >= 480).sort((a, b) => a.width - b.width)[0] || image;
    const music = it.story_music_stickers && it.story_music_stickers[0] && it.story_music_stickers[0].music_asset_info;
    const shared = (it.story_feed_media || []).find((s) => s.media_code);
    const sharedBy = (it.story_bloks_stickers || []).filter(placeholder)
      .map((s) => s.bloks_sticker && s.bloks_sticker.sticker_data && s.bloks_sticker.sticker_data.ig_mention)
      .find((m) => m && m.username);
    const author = it.reshared_story_media_author || sharedBy;
    const sharedLink = shared && {
      reel: shared.product_type === 'clips',
      href: `/${shared.product_type === 'clips' ? 'reel' : 'p'}/${shared.media_code}/`,
    };
    return {
      pk: String(it.pk),
      takenAt: it.taken_at,
      type: video ? 'video' : 'image',
      src: video ? video.url : image.url,
      liked: !!it.has_liked,
      canReply: !!it.can_reply,
      thumb: thumb ? thumb.url : '',
      ratio: it.original_width && it.original_height ? it.original_width / it.original_height : 9 / 16,
      stickers: stickersOf(it),
      music: music && music.title ? [music.title, music.display_artist].filter(Boolean).join(' · ') : '',
      from: (author && author.username) || '',
      shared: sharedLink || null,
      card: sharedLink ? { href: sharedLink.href, label: sharedLink.reel ? 'View reel' : 'View post' }
        : author && author.username ? { href: `/${author.username}/`, label: author.full_name || author.username }
        : null,
    };
  }

  // Clickable stickers: what each points to and where it sits, as fractions
  // of the media (x, y are its centre; rotation is in turns), largest first
  // so smaller ones lying on top stay clickable.
  function stickersOf(it) {
    const out = [];
    const add = (stickers, target) => {
      for (const s of stickers || []) {
        const t = s && s.width && s.height && !placeholder(s) && target(s);
        if (t) out.push({ ...t, x: s.x, y: s.y, w: s.width, h: s.height, rot: s.rotation || 0 });
      }
    };
    const mention = (username) => username && { href: `/${username}/`, title: `@${username}` };
    add(it.story_bloks_stickers, (s) => {
      const data = s.bloks_sticker && s.bloks_sticker.sticker_data;
      return data && data.ig_mention && mention(data.ig_mention.username);
    });
    add(it.reel_mentions, (s) => s.user && mention(s.user.username));
    add(it.story_locations, (s) => s.location && s.location.pk
      && { href: `/explore/locations/${s.location.pk}/`, title: 'Open location' });
    add(it.story_hashtags, (s) => s.hashtag && s.hashtag.name
      && { href: `/explore/tags/${encodeURIComponent(s.hashtag.name)}/`, title: `#${s.hashtag.name}` });
    add(it.story_link_stickers, (s) => s.story_link && /^https:\/\//.test(s.story_link.url)
      && { href: s.story_link.url, title: linkTarget(s.story_link.url), external: true });
    return out.sort((a, b) => b.w * b.h - a.w * a.h);
  }

  // Shared posts, and the mention of their author, are placed at the middle
  // quarter whatever their real size: as a clickable area they would swallow
  // taps meant to advance, so they get links in the header instead.
  function placeholder(s) {
    return s.x === 0.5 && s.y === 0.5 && s.width === 0.5 && s.height === 0.5;
  }

  // Link stickers go through Instagram's redirect; show where they lead.
  function linkTarget(url) {
    try {
      const u = new URL(url);
      const real = u.hostname === 'l.instagram.com' ? u.searchParams.get('u') : url;
      return real ? new URL(real).hostname.replace(/^www\./, '') : url;
    } catch (_) {
      return url;
    }
  }

  // One request for several accounts' stories. Since November 2026 this
  // query needs /api/graphql and the session tokens: /graphql/query
  // answers it with an HTML page.
  function loadReels(ids) {
    const send = () => gql(DOC_REELS, {
      media_id: null,
      reel_ids_arr: ids,
      __relay_internal__pv__PolarisCommunityNoteStoriesLabelEnabledrelayprovider: true,
    }, true);
    const reelsOf = (data) => data && data.data && data.data.xdt_api__v1__feed__reels_media;
    const job = send().then((data) => {
      if (reelsOf(data)) return data;
      cachedTokens = null; // tokens may have rotated: re-read them once
      return send();
    }).then((data) => {
      const got = reelsOf(data);
      if (!got) console.warn('Here for Instagram: the stories query failed', data);
      const byId = new Map(((got && got.reels_media) || []).map((r) => [String(r.id), r]));
      for (const id of ids) {
        pending.delete(id);
        if (!got) continue; // request failed: stays unknown, show() falls back
        const reel = byId.get(id);
        media.set(id, reel ? reel.items.map(toItem).filter(Boolean) : []);
        const mine = list.find((r) => r.id === id);
        if (mine && reel) mine.seenAt = Math.max(mine.seenAt, reel.seen || 0);
      }
      // While the story on stage loads, the rest waits for it (see show).
      if (open && storyIn) {
        preload();
        renderDeck();
      }
      return got ? got.reels_media || [] : null;
    });
    for (const id of ids) pending.set(id, job);
    return job;
  }

  // Story summaries for the given accounts (those with active stories only),
  // straight from the viewer's own query. Unlike Instagram's stories tray,
  // which is ranked and cut off at 120 accounts, this misses nobody. The
  // stories themselves are kept for the viewer, so they open instantly.
  // Larger batches than 10 accounts make Instagram fail the whole request.
  async function fetchReels(ids) {
    const batches = [];
    for (let i = 0; i < ids.length; i += 10) batches.push(loadReels(ids.slice(i, i + 10)));
    const results = await Promise.all(batches);
    if (results.some((r) => r === null)) return null;
    return results.flat().map((r) => {
      const seenAt = r.seen || 0;
      return {
        id: String(r.id),
        username: r.user.username,
        pic: r.user.profile_pic_url,
        seenAt,
        latest: r.latest_reel_media || 0,
        unseen: r.items.some((it) => it.taken_at > seenAt),
      };
    });
  }

  // Fetch in batches: only when one of the next two accounts is still unknown.
  function loadAhead() {
    const missing = (r) => !media.has(r.id) && !pending.has(r.id);
    if (!list.slice(ri, ri + 3).some(missing)) return;
    const ids = list.slice(ri, ri + 1 + AHEAD).filter(missing).map((r) => r.id);
    if (ids.length) loadReels(ids);
  }

  function firstUnseen(reel, items) {
    const i = items.findIndex((it) => it.takenAt > reel.seenAt);
    return i < 0 ? 0 : i;
  }

  function markSeen(reel, item) {
    if (item.takenAt <= reel.seenAt) return;
    reel.seenAt = item.takenAt;
    if (media.get(reel.id).every((it) => it.takenAt <= reel.seenAt)) reel.unseen = false;
    const send = () => gql(DOC_SEEN, {
      reelId: reel.id,
      reelMediaId: item.pk,
      reelMediaOwnerId: reel.id,
      reelMediaTakenAt: item.takenAt,
      viewSeenAt: Math.floor(Date.now() / 1000),
    }, true);
    const marked = (res) => !!(res && res.data && res.data.xdt_mark_story_reel_seen);
    send().then((res) => {
      if (marked(res)) return;
      cachedTokens = null; // tokens may have rotated: re-read them once
      send();
    });
  }

  // Star or unstar an account, as Instagram's "Add to Favourites" menu item
  // does. Resolves to whether the account is now a favourite, or null.
  async function setFavourite(userId, on) {
    const send = () => gql(DOC_FAV, {
      input: { add: on ? [userId] : [], remove: on ? [] : [userId], source: 'profile' },
    }, true);
    const state = (res) => {
      const got = res && res.data && res.data.xig_update_feed_favorites;
      const info = got && got.user_id_and_relationship_infos && got.user_id_and_relationship_infos[0];
      return info && info.relationship_info ? !!info.relationship_info.is_feed_favorite : null;
    };
    let result = state(await send());
    if (result === null) {
      cachedTokens = null; // tokens may have rotated: re-read them once
      result = state(await send());
    }
    return result;
  }

  // ---- Preloading ---------------------------------------------------------

  function mediaEl(item) {
    let node = preloaded.get(item.src);
    if (!node) {
      node = item.type === 'video'
        // No poster: until its first frame the story before stays in view
        // (see show), and a full-size poster would load ahead of the video.
        ? el('video', { src: item.src, preload: 'auto', playsInline: true, muted: true })
        : el('img', { src: item.src, alt: '', decoding: 'async' });
      preloaded.set(item.src, node);
    }
    return node;
  }

  // The next n stories in play order, as far as their lists are known.
  function upcoming(n) {
    const out = [];
    let r = ri;
    let i = ii;
    while (out.length < n && r < list.length) {
      const items = media.get(list[r].id);
      if (!items) break;
      if (i + 1 < items.length) {
        out.push(items[++i]);
        continue;
      }
      r++;
      const next = r < list.length && media.get(list[r].id);
      if (!next) break;
      if (!next.length) {
        i = -1;
        continue;
      }
      i = firstUnseen(list[r], next);
      out.push(next[i]);
    }
    return out;
  }

  // The story going back lands on: the one before, or where the account
  // before was left (its last story, unless jumped away from).
  function behind(items) {
    if (ii > 0) return items[ii - 1];
    const prev = ri > 0 && media.get(list[ri - 1].id);
    if (!prev || !prev.length) return null;
    const at = landing(list[ri - 1]);
    return prev[at === LAST ? prev.length - 1 : Math.min(at, prev.length - 1)];
  }

  // Load the stories around the current one, and let go of the rest; with
  // fill false, only let go (what's already loaded around it stays).
  function preload(fill = true) {
    const reel = list[ri];
    const items = reel && media.get(reel.id);
    const now = items && items[ii];
    if (!now) return;
    const keep = new Set([now.src]);
    // The stories ahead, and the one behind: going back is common, and a
    // video let go has to load again before it shows.
    for (const item of [...upcoming(PRELOAD), behind(items)].filter(Boolean)) {
      keep.add(item.src);
      if (fill) mediaEl(item);
    }
    for (const [src, node] of preloaded) {
      // Also spare the previous story while it still shows under this one.
      if (keep.has(src) || node.parentNode === mediaBox) continue;
      unload(node);
      preloaded.delete(src);
    }
  }

  // Stop a video's download and free its buffer.
  function unload(node) {
    if (node.tagName !== 'VIDEO') return;
    node.pause();
    node.removeAttribute('src');
    node.load();
  }

  // ---- Neighbouring accounts ----------------------------------------------

  // The accounts before and after the current one, as cards beside the stage;
  // clicking one goes to the story it shows. The free room on each side is
  // split by a geometric falloff: each card's visible share is DECK.ratio of
  // the nearer one's, and cards whose share would be under DECK.minStrip
  // stage widths are left out. A card's outer edge goes where its share ends
  // and the nearer card covers the rest of it. Its scale and angle follow its
  // share, so near cards are large and flat, far ones smaller and turned.
  const DECK = { ratio: 0.91, scaleFar: 0.63, angleNear: 0, angleFar: 20, minStrip: 0.075, persp: 1.4, fade: 0.09, margin: 0.015 };
  const peeks = new Map(); // reel id -> card element
  const peekAsked = new Set(); // reel ids whose stories the cards asked for
  let slots = []; // right-hand card placements, nearest first: { x, th, s, edge } (edge: where its share ends)
  let deckW = 0;
  let deckH = 0;

  function layoutDeck() {
    const FW = root.clientWidth;
    const FH = root.clientHeight;
    const W = stage.offsetWidth;
    const H = stage.offsetHeight;
    deckW = W;
    deckH = H;
    slots = [];
    const room = FW / 2 - DECK.margin * FW - W / 2;
    if (!W || room <= 0) return sizeScroller(FW, W);
    const d = DECK.persp * FH;
    view.style.perspective = `${d}px`;
    let n = 40;
    let strips = [];
    for (; n >= 1; n--) {
      const sum = (1 - DECK.ratio ** n) / (1 - DECK.ratio);
      strips = Array.from({ length: n }, (_, k) => (room * DECK.ratio ** k) / sum);
      if (strips[n - 1] >= DECK.minStrip * W) break;
    }
    let edge = W / 2;
    for (let k = 0; k < n; k++) {
      edge += strips[k];
      const u = strips[k] / strips[0];
      const s = DECK.scaleFar + (1 - DECK.scaleFar) * u;
      const th = DECK.angleNear + (DECK.angleFar - DECK.angleNear) * (1 - u);
      // Turned with its outer edge toward the viewer, that edge projects to
      // (x + half·cos θ) · d / (d − half·sin θ); put it at `edge`.
      const r = (th * Math.PI) / 180;
      const half = (W * s) / 2;
      const x = (edge * (d - half * Math.sin(r))) / d - half * Math.cos(r);
      slots.push({ x, th, s, edge });
    }
    // Cards not peeked at size their labels as if they were the nearest one
    // (see .sv-peek-label).
    if (slots.length) view.style.setProperty('--open-rest', `${openAt(1)}px`);
    sizeScroller(FW, W);
  }

  function peekCard(reel) {
    const img = el('img', { className: 'sv-peek-img', alt: '', decoding: 'async', draggable: false, fetchPriority: 'low' });
    const avatar = el('img', { className: 'sv-peek-avatar', alt: reel.username, title: reel.username, decoding: 'async', draggable: false });
    if (reel.pic) avatar.src = reel.pic;
    const dots = el('div', { className: 'sv-peek-dots' });
    const label = el('div', { className: 'sv-peek-label' }, avatar, dots);
    const card = el('div', { className: 'sv-peek' }, el('div', { className: 'sv-peek-clip' }, img), el('div', { className: 'sv-peek-dim' }), label);
    card.parts = { img, dots };
    card.reel = reel;
    // Opaque until its picture is in (see .sv-peek-wait); one that fails
    // stays black.
    img.addEventListener('load', () => card.classList.remove('sv-peek-wait'));
    card.addEventListener('click', () => toReel(list.indexOf(reel), scrubId === reel.id ? scrubJ : null));
    card.addEventListener('pointermove', (e) => scrub(reel, card, e));
    card.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'touch') peekAt(reel); // a tap just turns
    });
    card.addEventListener('pointerleave', (e) => {
      // A stray leave with the pointer still on the card (as a click can
      // send) doesn't count.
      const inWindow = e.clientX > 0 && e.clientY > 0 && e.clientX < innerWidth - 1 && e.clientY < innerHeight - 1;
      const at = inWindow && document.elementFromPoint(e.clientX, e.clientY);
      if (at && card.contains(at)) return;
      // Onto another card, that one's pointerenter takes over.
      const to = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.sv-peek');
      if (peekId === reel.id && !(to && sideCard(to))) unpeek();
    });
    return card;
  }

  // What a card shows, which is where going to it lands: for an account
  // behind, the story you left it on (its last, unless you jumped away); for
  // one ahead, its first unseen story; for the current one (hidden under the
  // stage until it turns away), the story on stage. While an account's stories
  // are unknown, its profile picture.
  function storyAt(reel, items, off) {
    if (!off) {
      if (ii === START) return items[firstUnseen(reel, items)];
      return items[ii === LAST ? items.length - 1 : Math.min(ii, items.length - 1)];
    }
    if (off > 0) return items[firstUnseen(reel, items)];
    return items[reel.leftAt != null ? Math.min(reel.leftAt, items.length - 1) : items.length - 1];
  }

  function fillPeek(card, reel, off) {
    const items = media.get(reel.id);
    const scrubbed = items && reel.id === scrubId && scrubJ != null;
    const item = items && items.length ? (scrubbed ? items[Math.min(scrubJ, items.length - 1)] : storyAt(reel, items, off)) : null;
    const { img, dots } = card.parts;
    const src = (item && item.thumb) || reel.pic;
    if (img.getAttribute('src') !== src) {
      img.src = src;
      card.classList.toggle('sv-peek-wait', !img.complete);
    }
    card.classList.toggle('sv-peek-pic', !item || !item.thumb);
    // A dot per story: the one it shows white, the rest pink while unwatched
    // and grey once watched. How old it is shows only on the stage.
    const j = item ? items.indexOf(item) : -1;
    const tones = item ? items.map((it, k) => (k === j ? 'me' : it.takenAt > reel.seenAt ? 'new' : '')).join() : '';
    if (dots.dataset.tones !== tones) {
      dots.dataset.tones = tones;
      dots.replaceChildren(...(item ? items.map((it, k) => el('i', { className: k === j ? 'sv-dot-me' : it.takenAt > reel.seenAt ? 'sv-dot-new' : '' })) : []));
    }
  }

  function renderDeck() {
    if (!open) return;
    const n = slots.length;
    const pos = scrolling ? scrollPos : ri;
    const lo = Math.max(0, Math.floor(pos) - n - 1);
    const hi = Math.min(list.length - 1, Math.ceil(pos) + n + 1);
    const keep = new Set();
    const missing = [];
    const starting = []; // new cards, and where they go once started out
    const hand = handAt();
    for (let k = lo; k <= hi; k++) {
      const reel = list[k];
      const off = k - pos;
      const d = Math.abs(off);
      keep.add(reel.id);
      if (!media.has(reel.id) && !pending.has(reel.id) && !peekAsked.has(reel.id)) missing.push(reel.id);
      let card = peeks.get(reel.id);
      const fresh = !card;
      if (fresh) {
        card = peekCard(reel);
        peeks.set(reel.id, card);
        view.insertBefore(card, stage);
      }
      fillPeek(card, reel, k - ri);
      const { transform, dim } = placement(off, hand(k));
      card.classList.toggle('sv-peek-open-r', hand.k === k && off > 0);
      card.classList.toggle('sv-peek-open-l', hand.k === k && off < 0);
      if (hand.k === k) card.style.setProperty('--open', `${hand.open}px`);
      // While scrolling, the stage is hidden and every card shows, the
      // farthest fading out as it goes. After a turn, the new account's card
      // stays under the stage, which is see-through until its story has
      // loaded, so the picture is there from the start.
      const inView = scrolling ? d < (n || 1) + 1 : !!d && d <= n;
      const opacity = scrolling ? Math.min(1, (n || 1) + 1 - d) : inView || (!d && arriving) ? 1 : 0;
      Object.assign(card.style, { width: `${deckW}px`, height: `${deckH}px`, marginLeft: `${-deckW / 2}px`, marginTop: `${-deckH / 2}px`, zIndex: String(Math.round(99 - 20 * d)) });
      card.style.setProperty('--dim', String(dim));
      // While scrolling, every card keeps its label, the one passing the
      // middle included (the stage is hidden then).
      card.classList.toggle('sv-peek-centre', !scrolling && !d);
      card.classList.toggle('sv-peek-off', !inView);
      if (fresh && !scrolling) {
        // Slide a new neighbour out from behind the stage; fade in farther
        // ones. They start out together, after one style flush (below).
        card.style.transform = d <= 1 ? 'none' : transform;
        card.style.opacity = '0';
        starting.push([card, transform, String(opacity)]);
        continue;
      }
      card.style.transform = transform;
      card.style.opacity = String(opacity);
    }
    if (starting.length) {
      view.getBoundingClientRect();
      for (const [card, transform, opacity] of starting) Object.assign(card.style, { transform, opacity });
    }
    for (const [id, card] of peeks) {
      if (keep.has(id)) continue;
      card.remove();
      peeks.delete(id);
    }
    for (let i = 0; i < missing.length; i += 10) {
      const ids = missing.slice(i, i + 10);
      for (const id of ids) peekAsked.add(id);
      loadReels(ids);
    }
  }

  // Where a card `off` places from the middle goes, and how dim it is. While
  // the carousel scrolls, `off` is fractional: between two places, a card is
  // part way from one to the other. `push` moves it outward, in px.
  function placement(off, push = 0) {
    const d = Math.abs(off);
    const sign = Math.sign(off);
    const n = slots.length;
    if (!d) return { transform: 'none', dim: 0 };
    if (!n && !scrolling) return { transform: 'none', dim: Math.min(0.85, 0.15 + d * DECK.fade) };
    if (!n) {
      // No room for cards beside the stage: while scrolling, they slide in
      // from off screen.
      return { transform: `translateX(${off * unit}px)`, dim: Math.min(d, 1) * 0.3 };
    }
    const k = Math.min(Math.floor(d), n);
    const f = k === n ? 0 : d - k;
    const a = k ? slots[k - 1] : { x: 0, th: 0, s: 1 };
    const b = slots[Math.min(k, n - 1)];
    const x = a.x + (b.x - a.x) * f + push;
    const th = a.th + (b.th - a.th) * f;
    const s = a.s + (b.s - a.s) * f;
    const far = 0.15 + DECK.fade;
    return {
      transform: `translateX(${sign * x}px) rotateY(${-sign * th}deg) scale(${s})`,
      dim: d < 1 ? d * far : Math.min(0.85, 0.15 + d * DECK.fade),
    };
  }

  // ---- Peeking at a card -------------------------------------------------

  // Hovering a card beside the stage fans the deck open there, like a hand of
  // cards: every other card on that side shows DECK.ratio as much of itself,
  // as if one place further out, and the hovered card takes the room that
  // frees. Not while the carousel moves; and a card that comes to rest under
  // a still pointer waits for the pointer to move.
  let peekId = null; // the account whose card is peeked at
  let scrubId = null; // the account whose stories the pointer flips through
  let scrubJ = null; // the story it points at
  let peekRearm = null; // where the pointer was when the deck last moved
  let pointerX = -1;
  let pointerY = -1;

  const sideCard = (card) => !card.classList.contains('sv-peek-off') && card.reel !== list[ri];

  function peekAt(reel) {
    if (!open || scrolling || turning || peekRearm || reel === list[ri] || peekId === reel.id) return;
    peekId = reel.id;
    scrubId = scrubJ = null;
    root.classList.add('sv-hand');
    renderDeck();
  }

  function unpeek() {
    if (!peekId) return;
    peekId = null;
    scrubId = scrubJ = null;
    renderDeck();
  }

  // The deck moves: the peek goes, until the pointer moves again.
  function dropPeek() {
    peekId = null;
    scrubId = scrubJ = null;
    peekRearm = { x: pointerX, y: pointerY };
    root.classList.remove('sv-hand');
  }

  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    pointerX = e.clientX;
    pointerY = e.clientY;
    if (!open || !peekRearm || Math.hypot(pointerX - peekRearm.x, pointerY - peekRearm.y) < 3) return;
    peekRearm = null;
    const hit = document.elementFromPoint(pointerX, pointerY);
    const card = hit && hit.closest('.sv-peek');
    if (card && sideCard(card)) peekAt(card.reel);
  }, true);

  // Across the part of a peeked card that shows, the pointer flips through
  // its account's stories, and clicking lands on the one it shows.
  function scrub(reel, card, e) {
    if (e.pointerType === 'touch' || reel.id !== peekId) return;
    const items = media.get(reel.id);
    if (!items || !items.length) return;
    const k = list.indexOf(reel);
    const side = Math.sign(k - ri);
    const over = Math.abs(k - ri) === 1 ? stage : peeks.get(list[k - side].id); // the card on top of it
    if (!over) return;
    const r = card.getBoundingClientRect();
    const o = over.getBoundingClientRect();
    const [a, b] = side > 0 ? [Math.max(r.left, o.right), r.right] : [r.left, Math.min(r.right, o.left)];
    const j = Math.min(items.length - 1, Math.max(0, Math.floor(((e.clientX - a) / Math.max(1, b - a)) * items.length)));
    if (scrubId === reel.id && scrubJ === j) return;
    scrubId = reel.id;
    scrubJ = j;
    fillPeek(card, reel, k - ri);
  }

  // How far (px, outward) the peek moves the card at index k, with `centre`
  // in the middle; .k is the card peeked at, or -1.
  function handAt(centre = ri) {
    const none = () => 0;
    none.k = -1;
    const k = peekId && !scrolling ? list.findIndex((r) => r.id === peekId) : -1;
    const n = slots.length;
    const D = Math.abs(k - centre);
    if (k < 0 || !D || D > n) return none;
    const E = [deckW / 2, ...slots.map((t) => t.edge)]; // where each share ends; E[0] the stage's edge
    const strip = (j) => E[j] - E[j - 1];
    let gain = 0;
    for (let j = 1; j <= n; j++) if (j !== D) gain += strip(j) * (1 - DECK.ratio);
    const shift = [0];
    let e = E[0];
    for (let j = 1; j <= n; j++) {
      e += j === D ? strip(j) + gain : strip(j) * DECK.ratio;
      shift.push(e - E[j]);
    }
    const side = Math.sign(k - centre);
    const hand = (i) => (Math.sign(i - centre) === side ? shift[Math.min(Math.abs(i - centre), n)] : 0);
    hand.k = k;
    hand.open = openAt(D);
    return hand;
  }

  // How much of the card D places out shows while it's peeked at, in its own
  // px: its share, and what every other card on that side gives up.
  function openAt(D) {
    const E = [deckW / 2, ...slots.map((t) => t.edge)];
    let open = E[D] - E[D - 1];
    for (let j = 1; j < E.length; j++) if (j !== D) open += (E[j] - E[j - 1]) * (1 - DECK.ratio);
    const t = slots[D - 1];
    return open / (t.s * Math.cos((t.th * Math.PI) / 180));
  }

  // Apply styles at once, without transitions.
  function snap(node, apply) {
    node.classList.add('sv-snap');
    apply();
    node.getBoundingClientRect();
    node.classList.remove('sv-snap');
  }

  function clearDeck() {
    peekId = null;
    peekRearm = null;
    root.classList.remove('sv-hand');
    for (const card of peeks.values()) card.remove();
    peeks.clear();
    peekAsked.clear();
    clearTimeout(turnTimer);
    turning = false;
    endScroll();
    landed = false;
    arrived();
    shownReel = null;
    snap(stage, () => {
      stage.style.transform = '';
      stage.style.setProperty('--dim', '0');
    });
  }

  // Changing account turns the carousel, as in a coverflow. The stage, already
  // showing the new account with its controls, flies in from where that
  // account's card was, brightening as it comes; the card itself moves in
  // under it, standing in until the story has loaded. The account left behind
  // becomes a card where the stage was and slides aside.
  let turning = false;
  let arriving = false; // turned to an account whose story hasn't loaded yet
  let turnTimer = 0;
  let shownReel = null; // the account last put on stage
  const TURN_MS = 400; // as the transitions in content.css

  function beginTurn(prev, delta) {
    const card = peeks.get(prev.id);
    if (card) {
      snap(card, () => {
        card.classList.add('sv-peek-centre');
        card.style.transform = 'none';
        card.style.opacity = '1';
        card.style.setProperty('--dim', '0');
      });
    }
    const from = placement(delta, handAt(list.indexOf(prev))(ri)); // from where its card is, peeked or not
    snap(stage, () => {
      stage.style.transform = from.transform;
      stage.style.setProperty('--dim', String(from.dim));
    });
    stage.style.transform = '';
    stage.style.setProperty('--dim', '0');
    arriving = true;
    root.classList.add('sv-arriving');
    turning = true; // videos wait until the stage has arrived
    clearTimeout(turnTimer);
    turnTimer = setTimeout(() => {
      turning = false;
      syncPause();
    }, TURN_MS);
    syncPause();
  }

  // The story has loaded (or failed): the stand-in card under the stage
  // fades out and the stage is opaque again.
  function arrived() {
    if (!arriving) return;
    arriving = false;
    root.classList.remove('sv-arriving');
    renderDeck();
  }

  // Remember which story an account was left on, for its card.
  function leave() {
    if (ii >= 0) list[ri].leftAt = ii;
  }

  window.addEventListener('resize', () => {
    if (!open) return;
    layoutDeck();
    renderDeck();
  });

  // ---- Scrolling the carousel ---------------------------------------------

  // The viewer is a sideways scroller with a snap point per account, so a
  // trackpad turns the carousel natively: continuously, with the system's
  // momentum, coming to rest on an account. A mouse wheel turns it
  // continuously too (down = next), but without momentum: it scrolls
  // smoothly as far as the wheel goes, then settles on the nearest account,
  // at least one along. While it turns, the cards stand in for the stage;
  // where it comes to rest is shown on the stage again.
  const WHEEL_PER_LINE = 0.15; // accounts per line of mouse wheel scrolling (3 lines a notch)
  const WHEEL_SETTLE_MS = 200; // ms after the wheel stops before settling
  let unit = 1; // px of scrolling per account: from the middle to the first card
  let scrolling = false;
  let scrollPos = 0; // where the carousel is, in accounts
  let landed = false; // the stage comes to an account the carousel turned to
  let wheelTimer = 0;
  let wheelFrom = 0;
  let wheelTo = 0;

  function sizeScroller(FW, W) {
    unit = Math.max(1, Math.round(slots.length ? slots[0].x : W + 16));
    view.style.width = `${FW}px`;
    wide.style.width = `${(list.length - 1) * unit + FW}px`;
    stops.replaceChildren(...list.map((_, k) => {
      const stop = el('i', { className: 'sv-stop' });
      stop.style.left = `${k * unit}px`;
      return stop;
    }));
    syncScroll();
  }

  // Put the scroller at the account on stage.
  function syncScroll() {
    endScroll();
    if (Math.abs(root.scrollLeft - ri * unit) >= 1) root.scrollLeft = ri * unit;
  }

  function endScroll() {
    clearTimeout(wheelTimer);
    wheelTimer = 0;
    root.classList.remove('sv-free');
    if (!scrolling) return;
    scrolling = false;
    root.classList.remove('sv-scrolling');
    syncPause();
  }

  root.addEventListener('scroll', () => {
    if (!open) return;
    const pos = root.scrollLeft / unit;
    if (!scrolling) {
      if (Math.abs(pos - ri) < 0.01) return; // put there by syncScroll
      scrolling = true;
      root.classList.add('sv-scrolling');
      if (typing) replyInput.blur(); // the stage, reply box included, hides
      dropPeek();
      syncPause();
    }
    scrollPos = pos;
    renderDeck();
  });

  // Come to rest, on an account (a snap point; after the mouse wheel, where
  // settle sent it).
  root.addEventListener('scrollend', () => {
    if (open && scrolling && !wheelTimer) rest();
  });

  function rest() {
    const k = Math.min(Math.max(Math.round(root.scrollLeft / unit), 0), list.length - 1);
    if (Math.abs(root.scrollLeft - k * unit) >= 1) {
      root.scrollTo({ left: k * unit, behavior: 'smooth' });
      return;
    }
    endScroll();
    if (k === ri) return renderDeck();
    landed = true;
    toReel(k);
  }

  // Firefox reports a mouse wheel in lines and a trackpad (or Magic Mouse) in
  // pixels, but only to a listener that reads deltaMode before the deltas:
  // read it first, ahead of Instagram's listeners. Pixels are left to the
  // scroller.
  window.addEventListener('wheel', (e) => {
    if (!open || e.ctrlKey || e.metaKey) return; // zoom
    if (e.target.closest && e.target.closest('.sv-viewers')) return; // scrolls the list
    const mode = e.deltaMode;
    if (mode === 0) {
      if (wheelTimer) {
        // A trackpad takes over from the wheel: snap again.
        clearTimeout(wheelTimer);
        wheelTimer = 0;
        root.classList.remove('sv-free');
      }
      return;
    }
    e.preventDefault();
    const lines = (e.deltaY || e.deltaX) * (mode === 2 ? 1 / WHEEL_PER_LINE : 1);
    if (!wheelTimer) {
      wheelFrom = scrolling ? Math.round(root.scrollLeft / unit) : ri;
      wheelTo = root.scrollLeft;
      root.classList.add('sv-free'); // no snapping until it settles
    }
    wheelTo = Math.min(Math.max(wheelTo + lines * WHEEL_PER_LINE * unit, 0), (list.length - 1) * unit);
    root.scrollTo({ left: wheelTo, behavior: 'smooth' });
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(settle, WHEEL_SETTLE_MS);
  }, { capture: true, passive: false });

  function settle() {
    wheelTimer = 0;
    const pos = wheelTo / unit;
    let k = Math.round(pos);
    if (k === wheelFrom && Math.abs(pos - wheelFrom) > 0.05) k += Math.sign(pos - wheelFrom);
    k = Math.min(Math.max(k, 0), list.length - 1);
    // Snapping stays off until it comes to rest (endScroll), so it can't
    // pull the carousel elsewhere on the way.
    if (Math.abs(root.scrollLeft - k * unit) >= 1) root.scrollTo({ left: k * unit, behavior: 'smooth' });
    else if (scrolling) rest();
    else endScroll();
  }

  // ---- Playback -----------------------------------------------------------

  const paused = () => spacePaused || holding || hovering || bubbleOn || listing || typing || sending || turning || scrolling;

  // Clickable areas over the stickers, on a layer matching the media's own
  // box within the 9:16 stage (the media is shown uncropped).
  function renderStickers(item) {
    hovering = false;
    const stageRatio = 9 / 16;
    const w = item.ratio <= stageRatio ? item.ratio / stageRatio : 1;
    const h = item.ratio <= stageRatio ? 1 : stageRatio / item.ratio;
    Object.assign(stickerBox.style, {
      left: `${(1 - w) * 50}%`, top: `${(1 - h) * 50}%`, width: `${w * 100}%`, height: `${h * 100}%`,
    });
    stickerBox.replaceChildren(...item.stickers.map((s) => {
      const a = el('a', { className: 'sv-sticker', href: s.href, title: s.title });
      if (s.external) Object.assign(a, { target: '_blank', rel: 'noopener noreferrer' });
      Object.assign(a.style, {
        left: `${(s.x - s.w / 2) * 100}%`, top: `${(s.y - s.h / 2) * 100}%`,
        width: `${s.w * 100}%`, height: `${s.h * 100}%`, transform: `rotate(${s.rot}turn)`,
      });
      // Hovering a sticker holds the story, so there is time to click it.
      a.addEventListener('pointerenter', () => { hovering = true; syncPause(); });
      a.addEventListener('pointerleave', () => { hovering = false; syncPause(); });
      return a;
    }), bubble);
    card = item.card || null;
    bubbleOn = false;
    bubble.hidden = true;
    if (card) {
      bubble.href = card.href;
      bubbleText.textContent = card.label;
    }
    const parts = [];
    if (item.shared) parts.push(el('a', { href: item.shared.href }, item.shared.reel ? 'View reel' : 'View post'));
    if (item.from) parts.push(el('span', {}, 'from ', el('a', { href: `/${item.from}/` }, `@${item.from}`)));
    if (item.music) parts.push(el('span', { className: 'sv-music' }, `♪ ${item.music}`));
    sub.replaceChildren(...parts);
    sub.hidden = !parts.length;
  }

  function syncPause() {
    root.classList.toggle('sv-paused', paused());
    if (!current || current.tagName !== 'VIDEO') return;
    if (paused()) current.pause();
    else if (current.paused && !current.ended) startVideo();
  }

  function setMuted(value) {
    muted = value;
    muteBtn.replaceChildren(icon(muted ? SOUND_OFF : SOUND_ON));
    if (current && current.tagName === 'VIDEO') current.muted = muted;
  }

  function setSpeed(value) {
    speed = value;
    speedBtn.textContent = speedLabel(speed);
    if (current && current.tagName === 'VIDEO') setRate(current, speed);
  }

  function startVideo() {
    current.muted = muted;
    setRate(current, speed);
    const attempt = current.play();
    if (attempt && attempt.catch) {
      // Browsers can refuse to autoplay with sound.
      attempt.catch(() => {
        if (!current || current.muted) return;
        setMuted(true);
        current.play().catch(() => {});
      });
    }
  }

  // How long ago a unix time was, as Instagram writes it: 5m, 3h, 2d, 4w.
  function ago(seconds) {
    const mins = Math.max(1, Math.round((Date.now() / 1000 - seconds) / 60));
    if (mins < 60) return `${mins}m`;
    if (mins < 60 * 24) return `${Math.round(mins / 60)}h`;
    if (mins < 60 * 24 * 7) return `${Math.floor(mins / 60 / 24)}d`;
    return `${Math.floor(mins / 60 / 24 / 7)}w`;
  }

  function fail(text) {
    note.textContent = text;
    note.hidden = false;
    arrived();
  }

  async function show() {
    const my = ++token;
    storyIn = false;
    // Ask for the account's stories before anything else, so the request
    // isn't held up by laying out the deck.
    loadAhead();
    if (current && current.tagName === 'VIDEO') current.pause();
    current = null;
    seek.attach(null);
    shown = false;
    const reel = list[ri];
    avatar.src = reel.pic;
    userLink.textContent = reel.username;
    userLink.href = `/${reel.username}/`;
    timeText.textContent = '';
    renderStickers({ ratio: 9 / 16, stickers: [] });
    foot.hidden = true;
    note.hidden = true;
    root.classList.add('sv-loading');
    if (shownReel && shownReel !== reel) {
      const from = list.indexOf(shownReel);
      mediaBox.replaceChildren(); // the account's card stands in meanwhile
      if (landed) {
        // The carousel already turned there: the card is in place under the stage.
        arriving = true;
        root.classList.add('sv-arriving');
      } else {
        beginTurn(shownReel, from < 0 ? dir : ri - from);
      }
      dropPeek();
    }
    landed = false;
    shownReel = reel;
    syncScroll();
    renderDeck();

    try {
      if (!media.has(reel.id)) await (pending.get(reel.id) || loadReels([reel.id]));
    } catch (e) {
      console.warn('Here for Instagram: loading stories failed', e);
    }
    if (my !== token || !open) return;
    const items = media.get(reel.id);
    if (!items) {
      // Instagram no longer answers our query: hand over to its own viewer.
      close(false);
      go(`/stories/${reel.username}/`);
      return;
    }
    if (!items.length) {
      reel.unseen = false; // expired since the row was loaded
      const n = ri + dir;
      if (n < 0 || n >= list.length) return close();
      ri = n;
      ii = dir > 0 ? START : landing(list[n]);
      return show();
    }
    if (ii === START) ii = firstUnseen(reel, items);
    else if (ii === LAST) ii = items.length - 1;
    ii = Math.min(Math.max(ii, 0), items.length - 1);
    const item = items[ii];

    bars.replaceChildren(...items.map((_, i) => {
      const fill = el('i', {});
      fill.style.width = i < ii ? '100%' : '0%';
      return el('span', {}, fill);
    }));
    timeText.textContent = ago(item.takenAt);
    syncFoot(reel, item);
    if (wantListing) setListing(true);
    wantListing = false;
    nav.at('story', `/stories/${reel.username}/${item.pk}/`, { sid, ri, ii, listing });
    muteBtn.hidden = speedBtn.hidden = seek.row.hidden = item.type !== 'video';
    renderStickers(item);

    current = mediaEl(item);
    current.fetchPriority = 'high';
    // The previous story of the account stays underneath until this one has
    // a picture, so switching doesn't flash black (a video takes a moment to
    // show its first frame). An image goes in only once decoded: in place
    // while it downloads, it is drawn again as each part arrives, and a
    // full-size one doing that holds up frames.
    if (item.type === 'video') mediaBox.append(current);
    preload(false); // stories no longer around this one stop loading now
    // The cards' pictures and the stories preloaded around this one load
    // once it is in, so they don't hold it up (a video starts loading a beat
    // after an image would, behind anything asked for meanwhile); a story
    // slow to load holds them up only so long.
    const follow = () => {
      clearTimeout(followTimer);
      if (storyIn || my !== token) return;
      storyIn = true;
      renderDeck();
      preload();
    };
    const followTimer = setTimeout(follow, 1500);
    const clearBelow = () => {
      for (const node of [...mediaBox.children]) if (node !== current) node.remove();
    };
    const ready = () => {
      if (my !== token || shown) return;
      shown = true;
      clearBelow();
      root.classList.remove('sv-loading');
      arrived();
      markSeen(reel, item); // only once it is really on screen
      follow();
    };
    const broken = () => {
      if (my !== token) return;
      clearBelow();
      fail('This story could not be loaded.');
      follow();
    };
    // Ready means really painted: a video counts as loaded (even fully) a few
    // frames before Firefox presents its first frame, and an image before it
    // is decoded. Until then the story underneath, or after a turn the card,
    // must stay in view.
    const node = current;
    if (item.type === 'video') {
      const painted = () => {
        if (!node.requestVideoFrameCallback) return ready();
        node.requestVideoFrameCallback(() => ready());
        setTimeout(ready, 500); // a background tab may present no frames
      };
      if (node.currentTime) node.currentTime = 0; // a seek, even to where it is
      node.loop = true;
      setRate(node, speed);
      seek.attach(node);
      node.onloadeddata = painted;
      node.onplaying = painted;
      node.onerror = broken;
      if (node.error) broken();
      else if (node.readyState >= 2) painted();
      if (!node.error && !paused()) startVideo();
    } else {
      const reveal = () => {
        if (my !== token) return;
        mediaBox.append(node);
        ready();
      };
      const painted = () => (node.decode ? node.decode() : Promise.resolve()).then(reveal, reveal);
      node.onload = painted;
      node.onerror = broken;
      if (node.complete) (node.naturalWidth ? painted : broken)();
    }
  }

  // No timer moves stories on: a photo stays until you move on and a video
  // loops. The current story's bar is full for a photo and follows a video's
  // playback.
  function tick() {
    if (!open) return;
    raf = requestAnimationFrame(tick);
    const bar = bars.children[ii];
    if (!current || !shown || !bar) return;
    const done = current.tagName !== 'VIDEO' ? 1 : current.duration ? current.currentTime / current.duration : 0;
    bar.firstChild.style.width = `${Math.min(done, 1) * 100}%`;
  }

  // Next or previous story, crossing into the neighbouring account at the ends.
  function step(delta) {
    const items = media.get(list[ri].id) || [];
    if (ii === START || ii === LAST) return; // still loading this account
    if (delta > 0 && ii < items.length - 1) ii++;
    else if (delta < 0 && ii > 0) ii--;
    else return jump(delta);
    show();
  }

  // Next or previous account.
  function jump(delta) {
    const n = ri + delta;
    if (n >= list.length) return close();
    dir = delta;
    if (n < 0) {
      ii = 0;
    } else {
      leave();
      ri = n;
      ii = delta > 0 ? START : landing(list[n]);
    }
    show();
  }

  // Straight to another account, from its card: the story the card shows
  // (story j, when scrubbed to it).
  function toReel(k, j = null) {
    if (k < 0 || k >= list.length || k === ri) return;
    dir = k > ri ? 1 : -1;
    leave();
    ri = k;
    ii = j != null ? j : dir > 0 ? START : landing(list[k]);
    show();
  }

  // Going back to an account lands where you left it, else on its last story.
  const landing = (reel) => (reel.leftAt != null ? reel.leftAt : LAST);

  function openViewer(reels, index, hooks) {
    if (open) return;
    // Opened on an unwatched account: end after the last unwatched one instead
    // of running on into accounts already watched (the row puts those last).
    let end = reels.length;
    if (reels[index].unseen) {
      end = reels.findIndex((r, i) => i > index && !r.unseen);
      if (end < 0) end = reels.length;
    }
    const row = reels.slice(0, end);
    for (const reel of row) delete reel.leftAt;
    sid = ++sids;
    viewings.set(sid, { list: row, onClose: hooks && hooks.onClose });
    start(row, index, START);
  }

  function start(reels, index, item) {
    list = reels;
    ri = index;
    ii = item;
    dir = 1;
    open = true;
    spacePaused = false;
    holding = false;
    typing = false;
    replyInput.value = '';
    delete foot.dataset.reel;
    toast.hidden = true;
    onClose = viewings.get(sid).onClose;
    setMuted(muted);
    loadAhead(); // first: the request needn't wait for the layout below
    for (const video of document.querySelectorAll('main video')) video.pause();
    document.documentElement.classList.add('sinsta-viewing');
    onTop(root);
    layoutDeck();
    dropPeek(); // a card that opens under the pointer waits for it to move
    raf = requestAnimationFrame(tick);
    show();
  }

  // `step`: closed by the person (see nav.done).
  function close(step = true) {
    if (!open) return;
    open = false;
    nav.done('story', step);
    token++;
    cancelAnimationFrame(raf);
    for (const node of preloaded.values()) unload(node);
    preloaded.clear();
    current = null;
    seek.attach(null);
    mediaBox.replaceChildren();
    clearDeck();
    replyInput.blur();
    typing = false;
    listing = false;
    viewersBox.hidden = true;
    root.classList.remove('sv-listing');
    root.remove();
    document.documentElement.classList.remove('sinsta-viewing');
    if (onClose) onClose();
  }

  // Back or Forward to one of the viewer's entries.
  nav.own('story', {
    restore(d) {
      const v = viewings.get(d.sid);
      if (!v) return;
      if (!open || sid !== d.sid) {
        close(false);
        sid = d.sid;
        wantListing = d.listing;
        start(v.list, d.ri, d.ii);
        return;
      }
      if (d.ri === ri && d.ii === ii) {
        setListing(d.listing);
        return;
      }
      if (d.ri !== ri) {
        dir = d.ri > ri ? 1 : -1;
        leave();
      }
      ri = d.ri;
      ii = d.ii;
      wantListing = d.listing;
      show();
    },
    leave: () => close(false),
  });

  return {
    api, go, nav, el, shadowVideo, hostOf, icon, seekbar, shiftSpeed, cycleSpeed, setRate, speedLabel, onTop, openViewer, fetchReels, setFavourite, appOnlyNotifications, recentPosts, reelsPage, explorePage, profilePage, reelByCode, feedPage, songFor,
    mark, userIds, lookUpId, userCard, ago,
    likeMedia, likeComment, comments, replies, addComment, savePost, collections, addToCollection, newCollection, follow,
  };
})();
