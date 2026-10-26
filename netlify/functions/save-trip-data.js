/* ===========================================================================
   save-trip-data.js  —  the write half of the site.
   ---------------------------------------------------------------------------
   POST /.netlify/functions/save-trip-data
   Body: { secret,
           times: [...],            a stop's clock time, edited on the timeline
           paths: [...],            a path drawn on the map -> a Transport row
           deletePathIds: [...],    archive those Transport rows
           plan: [...],             Build-tab entries -> Itinerary rows
           dayStarts: [...],        a day's start time -> Days."Day start"
           deleteEntryIds: [...] }  archive those Itinerary rows

   Reads go through get-trip-data.js and stay open to anyone with the URL.
   Writes come through here and need the shared passphrase, because the site
   sits on a public Netlify URL.

   Env vars (Netlify → Site settings → Environment variables):
     NOTION_TOKEN   same integration token the read function uses
     EDIT_SECRET    the passphrase. No default — without it every write is
                    refused, so a half-configured deploy fails closed.
     DB_TRANSPORT   needed to create rows for drawn paths
     DB_ITINERARY   needed to create rows for the day plan
     DB_DAYS DB_FLIGHTS DB_STAYS DB_PLACES DB_FOOD
                    the allowlist: a page is only writable if its parent data
                    source is one of these.

   WHAT THIS DELIBERATELY WILL NOT DO
   The integration token can reach every page shared with it. A leaked
   passphrase should therefore not become a write primitive for the whole
   workspace, so every target page is fetched first and its parent checked
   against the allowlist, and only a fixed set of properties is ever written.
   An id that is not in one of the trip databases is refused even with a valid
   passphrase.
   =========================================================================== */

const NOTION_VERSION = '2022-06-28';
const API = 'https://api.notion.com/v1';

// Notion allows ~3 requests/second on non-Business plans. Writes go one at a
// time with a gap rather than in parallel: a burst of ten edits would
// otherwise trip the limit and fail halfway through.
const GAP_MS = 350;
const MAX_CHANGES = 120;          // one click should not become a long job
const RICH_TEXT_MAX = 1900;       // Notion's cap is 2000; leave headroom

// Which date property carries the time, per source database.
const TIME_PROP = {
  place: 'When', food: 'When', flight: 'Departs', transport: 'Departs'
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

// The Mode select's options, exactly as Notion spells them. A value that is
// not in here is refused rather than written: Notion rejects an unknown option
// on a fixed select, and a half-applied save is worse than a clear failure.
const MODE_NAME = {
  walk: 'Walk', bike: 'Bike', bus: 'Bus', train: 'Train', taxi: 'Taxi',
  car: 'Car', motorbike: 'Motorbike', ferry: 'Ferry', other: 'Other'
};

// Which relation column links an itinerary entry back to the catalogue. One
// column per target database, because a Notion relation points at exactly one.
const REF_PROP = { place: 'Place', food: 'Food', stay: 'Stay' };

// Flights link to their own database rather than the three catalogue ones, and
// carry two fixed clock times instead of a duration.
const FLIGHT_PROP = 'Flight';

function allowedSources() {
  return [
    process.env.DB_DAYS, process.env.DB_FLIGHTS, process.env.DB_STAYS,
    process.env.DB_PLACES, process.env.DB_FOOD, process.env.DB_TRANSPORT,
    process.env.DB_ITINERARY
  ].filter(Boolean).map(id => String(id).replace(/-/g, ''));
}

async function notion(path, method, body, token) {
  const res = await fetch(API + path, {
    method: method,
    headers: {
      Authorization: 'Bearer ' + token,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 429) {
    // Honour Retry-After rather than hammering, then try once more.
    const wait = (parseInt(res.headers.get('retry-after'), 10) || 2) * 1000;
    await sleep(wait);
    return notion(path, method, body, token);
  }
  const text = await res.text();
  if (!res.ok) throw new Error('Notion ' + res.status + ': ' + text.slice(0, 300));
  return text ? JSON.parse(text) : {};
}

// A page is writable only if it lives in one of the trip databases.
async function assertWritable(pageId, token, allow) {
  const page = await notion('/pages/' + pageId, 'GET', null, token);
  const parent = page && page.parent;
  const src = parent && (parent.data_source_id || parent.database_id);
  if (!src) throw new Error('page has no database parent');
  const norm = String(src).replace(/-/g, '');
  if (allow.indexOf(norm) === -1) throw new Error('page is outside the trip databases');
  return page;
}

/* ── Validation ──────────────────────────────────────────────────────────── */

const isHM = v => typeof v === 'string' && /^([01]?\d|2[0-3]):[0-5]\d$/.test(v);
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isId = v => typeof v === 'string' && /^[0-9a-f]{32}$/.test(String(v).replace(/-/g, ''));

// Re-validated here rather than trusted from the browser: the endpoint is the
// security boundary, and the only thing it should ever put in a Route column
// is a list of coordinate pairs.
function cleanRoute(str) {
  if (typeof str !== 'string') return null;
  const pts = str.split(';').map(s => s.trim()).filter(Boolean).map(chunk => {
    const m = chunk.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (!m) return null;
    const la = parseFloat(m[1]), ln = parseFloat(m[2]);
    if (!isFinite(la) || !isFinite(ln)) return null;
    if (la < -90 || la > 90 || ln < -180 || ln > 180) return null;
    return la.toFixed(5) + ',' + ln.toFixed(5);
  }).filter(Boolean);
  if (pts.length < 2) return null;
  if (pts.join('; ').length <= RICH_TEXT_MAX) return pts.join('; ');

  // Too long for one rich-text value. Thin it by dropping points evenly and
  // ALWAYS keeping the first and last, so the path still starts and ends where
  // it did. Never slice the string: that would cut a coordinate in half and
  // leave a pair that parses to nothing.
  let keep = Math.max(2, Math.floor(pts.length * RICH_TEXT_MAX / pts.join('; ').length));
  for (;;) {
    const step = (pts.length - 1) / (keep - 1);
    const thinned = [];
    for (let i = 0; i < keep; i++) thinned.push(pts[Math.round(i * step)]);
    thinned[thinned.length - 1] = pts[pts.length - 1];
    const joined = thinned.join('; ');
    if (joined.length <= RICH_TEXT_MAX || keep <= 2) return joined;
    keep--;                                    // still long: drop one and retry
  }
}

const text = v => ({ rich_text: [{ type: 'text', text: { content: String(v).slice(0, RICH_TEXT_MAX) } }] });
const numOrNull = v => ({ number: (typeof v === 'number' && isFinite(v)) ? v : null });

/* ── Handler ─────────────────────────────────────────────────────────────── */

exports.handler = async function (event) {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST only' }) };
  }

  const token = process.env.NOTION_TOKEN;
  const secret = process.env.EDIT_SECRET;
  if (!token) return { statusCode: 500, headers, body: JSON.stringify({ error: 'NOTION_TOKEN not set' }) };
  if (!secret) {
    return { statusCode: 503, headers, body: JSON.stringify({
      error: 'Saving is switched off: EDIT_SECRET is not set on this deploy.' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'bad JSON' }) }; }

  // Constant-time-ish compare. Not a real defence against a remote timing
  // attack over HTTP, but it costs nothing and avoids the trivially leaky
  // early-exit of ===.
  const given = String(body.secret || '');
  let diff = given.length === secret.length ? 0 : 1;
  for (let i = 0; i < Math.max(given.length, secret.length); i++) {
    diff |= given.charCodeAt(i % (given.length || 1)) ^ secret.charCodeAt(i % (secret.length || 1));
  }
  if (diff !== 0) {
    await sleep(400);                                  // slow down guessing
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Wrong passphrase.' }) };
  }

  const times = Array.isArray(body.times) ? body.times : [];
  const paths = Array.isArray(body.paths) ? body.paths : [];
  const dels  = Array.isArray(body.deletePathIds) ? body.deletePathIds : [];
  const entries   = Array.isArray(body.plan) ? body.plan : [];
  const entryDels = Array.isArray(body.deleteEntryIds) ? body.deleteEntryIds : [];
  const dayStarts = Array.isArray(body.dayStarts) ? body.dayStarts : [];
  const total = times.length + paths.length + dels.length +
                entries.length + entryDels.length + dayStarts.length;
  if (total === 0) {
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, applied: [], failed: [] }) };
  }
  if (total > MAX_CHANGES) {
    return { statusCode: 413, headers, body: JSON.stringify({
      error: 'Too many changes in one save (max ' + MAX_CHANGES + ').' }) };
  }

  const allow = allowedSources();
  if (!allow.length) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'No DB_* ids configured' }) };
  }

  const applied = [], failed = [];

  /* ── Time changes ─────────────────────────────────────────────────────── */
  for (const t of times) {
    try {
      if (!isId(t.id)) throw new Error('bad page id');
      if (!isHM(t.time)) throw new Error('bad time, expected HH:MM');
      if (!isDate(t.date)) throw new Error('bad date, expected YYYY-MM-DD');
      const prop = TIME_PROP[t.kind];
      if (!prop) throw new Error('no time property for kind ' + t.kind);

      const page = await assertWritable(t.id, token, allow);
      if (!page.properties || !(prop in page.properties)) {
        throw new Error('page has no "' + prop + '" property');
      }
      // Keep any existing end date — overnight legs depend on it.
      const existing = page.properties[prop].date || {};
      const start = t.date + 'T' + (t.time.length === 4 ? '0' + t.time : t.time) + ':00';
      await notion('/pages/' + t.id, 'PATCH', {
        properties: { [prop]: { date: { start: start, end: existing.end || null } } }
      }, token);
      applied.push({ type: 'time', id: t.id });
      await sleep(GAP_MS);
    } catch (e) {
      failed.push({ type: 'time', id: t.id, error: String(e.message || e) });
    }
  }

  /* ── Drawn paths → Transport rows ─────────────────────────────────────── */
  const transportDb = process.env.DB_TRANSPORT;
  for (const p of paths) {
    try {
      if (!transportDb) throw new Error('DB_TRANSPORT not set');
      const route = cleanRoute(p.route);
      if (!route) throw new Error('route needs at least two valid lat,lng pairs');
      const first = route.split(';')[0].split(',').map(Number);
      const parts = route.split(';');
      const last = parts[parts.length - 1].trim().split(',').map(Number);

      const props = {
        Name: { title: [{ type: 'text', text: { content: String(p.name || 'Drawn path').slice(0, 200) } }] },
        Mode: { select: { name: MODE_NAME[p.mode] || 'Walk' } },
        From: text(p.fromName || 'Start'),
        To: text(p.toName || 'End'),
        'From lat': numOrNull(first[0]), 'From lng': numOrNull(first[1]),
        'To lat': numOrNull(last[0]),   'To lng': numOrNull(last[1]),
        Route: text(route),
        'Distance (mi)': numOrNull(typeof p.miles === 'number' ? Math.round(p.miles * 100) / 100 : null),
        'Drawn on site': { checkbox: true },
        Published: { checkbox: true }
      };
      if (isDate(p.date)) {
        props.Departs = { date: { start: isHM(p.time) ? p.date + 'T' + p.time + ':00' : p.date } };
      }

      let pageId;
      if (isId(p.notionId)) {
        await assertWritable(p.notionId, token, allow);
        await notion('/pages/' + p.notionId, 'PATCH', { properties: props }, token);
        pageId = p.notionId;
      } else {
        const made = await notion('/pages', 'POST', {
          parent: { database_id: transportDb }, properties: props
        }, token);
        pageId = made.id;
      }
      applied.push({ type: 'path', id: p.id, notionId: pageId });
      await sleep(GAP_MS);
    } catch (e) {
      failed.push({ type: 'path', id: p.id, error: String(e.message || e) });
    }
  }

  /* ── Itinerary entries: the Build tab's day plan ───────────────────────── */
  const itinDb = process.env.DB_ITINERARY;
  for (const e of entries) {
    try {
      if (!itinDb) throw new Error('DB_ITINERARY not set');
      if (!isDate(e.date)) throw new Error('bad date, expected YYYY-MM-DD');
      const type = e.type === 'Travel' ? 'Travel' : (e.type === 'Flight' ? 'Flight' : 'Stop');
      const ord = Number(e.order);
      if (!isFinite(ord) || ord < 0) throw new Error('bad order');

      // A flight is timetabled, not budgeted: two fixed clock times and no
      // duration. Everything else is the reverse.
      let dur = null;
      if (type !== 'Flight') {
        dur = Number(e.durationMin);
        if (!isFinite(dur) || dur < 0 || dur > 60 * 36) throw new Error('bad duration');
        dur = Math.round(dur);
      } else {
        if (e.startTime != null && !isHM(e.startTime)) throw new Error('bad start time, expected HH:MM');
        if (e.endTime != null && !isHM(e.endTime)) throw new Error('bad end time, expected HH:MM');
        if (!e.startTime && !e.endTime) throw new Error('a flight needs a departure or an arrival time');
      }

      const props = {
        Name: { title: [{ type: 'text', text: { content: String(e.name || type).slice(0, 200) } }] },
        Date: { date: { start: e.date } },
        Order: { number: Math.round(ord) },
        Type: { select: { name: type } },
        'Duration (min)': { number: dur },
        'Duration mode': type === 'Flight' ? { select: null }
          : { select: { name: e.durationMode === 'Manual' ? 'Manual' : 'Estimated' } },
        'Start time': text(type === 'Flight' ? (e.startTime || '') : ''),
        'End time':   text(type === 'Flight' ? (e.endTime   || '') : ''),
        Lat: numOrNull(e.lat), Lng: numOrNull(e.lng),
        'To lat': numOrNull(e.toLat), 'To lng': numOrNull(e.toLng),
        'Area radius (m)': numOrNull(e.areaRadius),
        Notes: text(e.notes == null ? '' : e.notes),
        Published: { checkbox: true }
      };

      if (type === 'Travel') {
        const m = MODE_NAME[e.mode];
        if (!m) throw new Error('unknown mode: ' + e.mode);
        props.Mode = { select: { name: m } };
        props.Route = text(cleanRoute(e.route) || '');
      } else {
        props.Mode = { select: null };
        props.Route = text('');
      }

      // Written every time, so re-pointing or clearing a flight link cannot
      // leave the old one behind — the same rule as the catalogue relations.
      props[FLIGHT_PROP] = { relation: [] };
      if (type === 'Flight' && e.flightId) {
        if (!isId(e.flightId)) throw new Error('bad flight id');
        await assertWritable(e.flightId, token, allow);
        props[FLIGHT_PROP] = { relation: [{ id: e.flightId }] };
      }

      // The link back to the catalogue. All three relation columns are written
      // every time, so changing which row an entry points at — or clearing it —
      // cannot leave a stale link behind on one of the others.
      const refProp = REF_PROP[e.refKind];
      Object.keys(REF_PROP).forEach(k => { props[REF_PROP[k]] = { relation: [] }; });
      if (refProp) {
        if (!isId(e.refId)) throw new Error('bad catalogue id');
        await assertWritable(e.refId, token, allow);     // never link outside the trip
        props[refProp] = { relation: [{ id: e.refId }] };
      }

      let pageId;
      if (isId(e.notionId)) {
        await assertWritable(e.notionId, token, allow);
        await notion('/pages/' + e.notionId, 'PATCH', { properties: props }, token);
        pageId = e.notionId;
      } else {
        const made = await notion('/pages', 'POST', {
          parent: { database_id: itinDb }, properties: props
        }, token);
        pageId = made.id;
      }
      applied.push({ type: 'entry', id: e.id, notionId: pageId });
      await sleep(GAP_MS);
    } catch (err) {
      failed.push({ type: 'entry', id: e.id, error: String(err.message || err) });
    }
  }

  /* ── A day's start time ───────────────────────────────────────────────── */
  for (const d of dayStarts) {
    try {
      if (!isId(d.id)) throw new Error('bad page id');
      if (!isHM(d.start)) throw new Error('bad time, expected HH:MM');
      const page = await assertWritable(d.id, token, allow);
      if (!page.properties || !('Day start' in page.properties)) {
        throw new Error('page has no "Day start" property');
      }
      await notion('/pages/' + d.id, 'PATCH', {
        properties: { 'Day start': text(d.start) }
      }, token);
      applied.push({ type: 'dayStart', id: d.id, date: d.date });
      await sleep(GAP_MS);
    } catch (err) {
      failed.push({ type: 'dayStart', id: d.id, error: String(err.message || err) });
    }
  }

  /* ── Entries removed in the Build tab ─────────────────────────────────── */
  for (const id of entryDels) {
    try {
      if (!isId(id)) throw new Error('bad page id');
      await assertWritable(id, token, allow);
      await notion('/pages/' + id, 'PATCH', { archived: true }, token);
      applied.push({ type: 'entryDelete', notionId: id });
      await sleep(GAP_MS);
    } catch (err) {
      failed.push({ type: 'entryDelete', id: id, error: String(err.message || err) });
    }
  }

  /* ── Deletions: archive, never destroy ────────────────────────────────── */
  for (const id of dels) {
    try {
      if (!isId(id)) throw new Error('bad page id');
      await assertWritable(id, token, allow);
      // archived:true is Notion's trash, recoverable from the UI. The site
      // never hard-deletes anything.
      await notion('/pages/' + id, 'PATCH', { archived: true }, token);
      applied.push({ type: 'delete', notionId: id });
      await sleep(GAP_MS);
    } catch (e) {
      failed.push({ type: 'delete', id: id, error: String(e.message || e) });
    }
  }

  return {
    statusCode: failed.length && !applied.length ? 502 : 200,
    headers,
    body: JSON.stringify({ ok: failed.length === 0, applied: applied, failed: failed })
  };
};

// Exported for tests; not part of the HTTP surface.
exports._internal = { cleanRoute, isHM, isDate, isId, MODE_NAME, REF_PROP };
