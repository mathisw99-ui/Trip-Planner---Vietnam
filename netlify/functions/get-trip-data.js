/* ===========================================================================
   get-trip-data.js  —  the only Netlify function this app needs.
   ---------------------------------------------------------------------------
   GET /.netlify/functions/get-trip-data?source=days|flights|stays|places|food|transport

   Read-only by design. The app never writes to Notion. This exists for exactly
   two reasons: the Notion token cannot live in client JS, and Notion's API
   refuses direct browser calls (CORS). Keep logic in index.html, not here.

   Env vars (Netlify → Site settings → Environment variables):
     NOTION_TOKEN   secret from your Notion integration
     DB_DAYS DB_FLIGHTS DB_STAYS DB_PLACES DB_FOOD DB_TRANSPORT
                    the classic UUID from each database's "Copy link"

   ID NOTE: pin Notion-Version 2022-06-28 and use classic page/database UUIDs.
   The `collection://uuid` form that the Notion MCP tools hand back is a
   different ID system and silently returns nothing here.
   =========================================================================== */

const NOTION_VERSION = '2022-06-28';

const DBS = {
  itinerary: process.env.DB_ITINERARY,
  days:      process.env.DB_DAYS,
  flights:   process.env.DB_FLIGHTS,
  stays:     process.env.DB_STAYS,
  places:    process.env.DB_PLACES,
  food:      process.env.DB_FOOD,
  transport: process.env.DB_TRANSPORT
};

/* ── Notion property readers ─────────────────────────────────────────────── */
/* Every reader returns null rather than undefined for a missing or empty
   property, so a column that does not exist yet behaves exactly like a blank
   one and the app's "—" rendering covers both. */

const txt  = p => (p && (p.rich_text || p.title) || []).map(t => t.plain_text).join('').trim() || null;
const num  = p => (p && typeof p.number === 'number') ? p.number : null;
const chk  = p => (p && typeof p.checkbox === 'boolean') ? p.checkbox : null;
const sel  = p => (p && p.select && p.select.name) || null;
const url  = p => (p && p.url) || null;
const dStart = p => (p && p.date && p.date.start) || null;
const dEnd   = p => (p && p.date && p.date.end) || null;
const dateOnly = p => { const v = dStart(p); return v ? v.slice(0, 10) : null; };
const timeOnly = p => { const v = dStart(p); return v && v.length > 10 ? v.slice(11, 16) : null; };
const rel  = p => ((p && p.relation) || []).map(r => r.id);

/* ── Row mappers. Left side = the app's field. Right side = Notion column. ── */

const MAP = {
  // The id matters here: it is what the write endpoint patches when the Build
  // tab changes a day's start time.
  days: (p, id) => ({
    id,
    date:     dateOnly(p['Date']),
    sleeping: txt(p['Sleeping']),
    base:     txt(p['Base']),
    summary:  txt(p['Summary']),
    // HH:MM the day begins; every computed time runs forward from it.
    dayStart: txt(p['Day start'])
  }),

  // The day plan: an ordered list of stops and travel legs. Places/Food/Stays
  // stay the catalogue; this is what was decided, in order.
  itinerary: (p, id) => ({
    id,
    name:    txt(p['Name']),
    date:    dateOnly(p['Date']),
    order:   num(p['Order']),
    type:    (sel(p['Type']) || 'Stop').toLowerCase(),
    // Flight rows only. Fixed local wall-clock times, not durations: a flight
    // leaves when it leaves, and the day is pinned to it rather than the other
    // way round.
    startTime: txt(p['Start time']),
    endTime:   txt(p['End time']),
    durationMin:  num(p['Duration (min)']),
    durationMode: (sel(p['Duration mode']) || 'Estimated').toLowerCase(),
    mode:    (sel(p['Mode']) || '').toLowerCase() || null,
    lat:     num(p['Lat']),   lng:    num(p['Lng']),
    toLat:   num(p['To lat']), toLng: num(p['To lng']),
    areaRadius: num(p['Area radius (m)']),
    route:   txt(p['Route']),
    // Exactly one of these is normally set; the app takes the first it finds.
    placeId: rel(p['Place'])[0] || null,
    foodId:  rel(p['Food'])[0]  || null,
    stayId:  rel(p['Stay'])[0]  || null,
    flightId: rel(p['Flight'])[0] || null,
    notes:   txt(p['Notes'])
  }),

  flights: (p, id) => ({
    id, airline: txt(p['Airline']), flightNo: txt(p['Flight number']),
    from: txt(p['From']), to: txt(p['To']),
    date: dateOnly(p['Departs']),
    depLocal: timeOnly(p['Departs']), arrLocal: timeOnly(p['Arrives']),
    durationMin: num(p['Duration (min)']),
    price: num(p['Price']), booked: chk(p['Booked']),
    link: url(p['Link']), notes: txt(p['Notes'])
  }),

  stays: (p, id) => ({
    id, name: txt(p['Name']), location: txt(p['Location']),
    lat: num(p['Lat']), lng: num(p['Lng']),
    checkIn: dStart(p['Stay']) && dStart(p['Stay']).slice(0, 10),
    checkOut: dEnd(p['Stay']) && dEnd(p['Stay']).slice(0, 10),
    price: num(p['Price']), link: url(p['Link']),
    booked: chk(p['Booked']), notes: txt(p['Notes'])
  }),

  places: (p, id) => ({
    id, name: txt(p['Name']), lat: num(p['Lat']), lng: num(p['Lng']),
    date: dateOnly(p['When']), time: timeOnly(p['When']),
    category: sel(p['Category']), link: url(p['Link']),
    booked: chk(p['Booked']),
    // Optional walking path: "lat,lng; lat,lng; ..." — parsed client-side.
    route: txt(p['Route']),
    // Optional. Shades a circle of this radius instead of placing a bare pin,
    // for entries that are a neighbourhood rather than a point.
    areaRadius: num(p['Area radius (m)']),
    notes: txt(p['Notes'])
  }),

  food: (p, id) => ({
    id, name: txt(p['Name']), lat: num(p['Lat']), lng: num(p['Lng']),
    type: sel(p['Type']),
    date: dateOnly(p['When']), time: timeOnly(p['When']),
    openTime: txt(p['Open hours']), reservation: txt(p['Reservation']),
    confidence: num(p['Confidence']), link: url(p['Link']),
    booked: chk(p['Booked']), notes: txt(p['Notes'])
  }),

  transport: (p, id) => ({
    id, mode: (sel(p['Mode']) || 'other').toLowerCase(), label: txt(p['Name']),
    fromName: txt(p['From']), fromLat: num(p['From lat']), fromLng: num(p['From lng']),
    toName: txt(p['To']),   toLat: num(p['To lat']),   toLng: num(p['To lng']),
    date: dateOnly(p['Departs']), endDate: dEnd(p['Departs']) && dEnd(p['Departs']).slice(0, 10),
    depLocal: timeOnly(p['Departs']), arrLocal: timeOnly(p['Arrives']),
    distanceMi: num(p['Distance (mi)']), durationMin: num(p['Duration (min)']),
    elevationFt: num(p['Elevation (ft)']), price: num(p['Price']),
    booked: chk(p['Booked']), link: url(p['Link']),
    // A traced path for this leg, if one was drawn on the site. When set, the
    // map follows it instead of drawing a straight line From -> To.
    route: txt(p['Route']),
    drawnOnSite: chk(p['Drawn on site']),
    // Notion relations point at exactly one database, so linking a leg to both
    // places and stays needs two columns. The app sees one flat array.
    linkedTo: rel(p['Linked places']).concat(rel(p['Linked stays'])),
    notes: txt(p['Notes'])
  })
};

/* ── Query ───────────────────────────────────────────────────────────────── */

async function queryAll(dbId, token) {
  const rows = [];
  let cursor;
  do {
    const res = await fetch('https://api.notion.com/v1/databases/' + dbId + '/query', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        page_size: 100,
        start_cursor: cursor,
        // The publish gate. A new row is invisible to the app until Published
        // is ticked. This is the #1 source of "I added it and it didn't show up".
        filter: { property: 'Published', checkbox: { equals: true } }
      })
    });
    if (!res.ok) throw new Error('Notion ' + res.status + ': ' + (await res.text()).slice(0, 300));
    const json = await res.json();
    rows.push.apply(rows, json.results);
    cursor = json.has_more ? json.next_cursor : null;
  } while (cursor);
  return rows;
}

exports.handler = async function (event) {
  const source = (event.queryStringParameters || {}).source;
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  };

  if (!source || !MAP[source]) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'source must be one of: ' + Object.keys(MAP).join(', ') }) };
  }
  const dbId = DBS[source];
  const token = process.env.NOTION_TOKEN;
  if (!token || !dbId) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Missing NOTION_TOKEN or the database id for ' + source }) };
  }

  try {
    const rows = await queryAll(dbId, token);
    let out = rows.map(function (r) { return MAP[source](r.properties, r.id); });
    if (source === 'days') out.sort(function (a, b) { return (a.date || '').localeCompare(b.date || ''); });
    if (source === 'itinerary') {
      out.sort(function (a, b) {
        const d = (a.date || '').localeCompare(b.date || '');
        return d !== 0 ? d : (a.order || 0) - (b.order || 0);
      });
    }
    return { statusCode: 200, headers, body: JSON.stringify(out) };
  } catch (err) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: String(err.message || err) }) };
  }
};
