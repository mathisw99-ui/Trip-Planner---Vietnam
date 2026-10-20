# Trip Planner

A single-file trip viewer. The itinerary lives in Notion; this renders it as a
day-by-day map and list. Edit Notion, reload, see the change.

```
notion  ──►  netlify function (read-only proxy)  ──►  index.html
```

Nothing writes back to Notion. There is no build step, no framework and no
bundler — `index.html` is the whole frontend.

## Repo

```
index.html                          the app
netlify/functions/get-trip-data.js  the Notion proxy
NOTION_SCHEMA.md                    the exact columns to create by hand in Notion
```

## Running it now

Open `index.html` in a browser. It boots against the sample data at the bottom of
the file — the Vietnam trip, transcribed from the spreadsheet — with no Notion and
no Netlify involved.

## Switching to live Notion

The six databases already exist under the Notion page *Vietnam — Nov 2026*, with
the trip loaded into them. `NOTION_SCHEMA.md` has their ids. What is left:

1. Create a Notion integration and share each of the six databases with it
   (`•••` → Connections).
2. In Netlify → Site settings → Environment variables, set `NOTION_TOKEN` and the
   six `DB_*` ids from `NOTION_SCHEMA.md`.
3. In `index.html`, change `const SOURCE = 'sample'` to `'notion'`.
4. Delete the `<script id="trip-data">` block.

Step 1 is the one that fails silently: an unshared database returns an empty
result set rather than an error.

That is the whole swap. Both paths produce the same normalized model, so nothing
downstream of `loadRaw()` knows or cares which one ran.

## Deploying

Connect the repo to Netlify. Defaults work: no build command, publish directory
`.`, functions directory `netlify/functions`.

**When something looks broken, rule out a stale deploy first.** Open the function
URL directly —
`https://<site>.netlify.app/.netlify/functions/get-trip-data?source=flights` — and
read the raw JSON. That one step separates a stale deploy from a code or data
problem, which otherwise look identical from the app.

## Map tiles

Plain OpenStreetMap tiles (`tile.openstreetmap.org`) — no account, no API key, no
usage token. The dark look is a CSS filter applied to `.leaflet-tile-pane` only, so
markers and paths keep their real colours.

OSM's servers run on donations and their usage policy prohibits heavy use without
prior permission, which a two-person trip viewer is nowhere near. If you later want
a purpose-built dark basemap, Stadia/Stamen, Thunderforest and CARTO all offer one
on a free tier — all three now want an account and a key. That is a one-line change
to the `L.tileLayer` call.

## How the map encodes things

A node's fill can only carry one variable, and there are two worth seeing — what a
place is, and when you are there. So it is a switch in the legend, **Type / Time**,
defaulting to type:

- **Type** — coral for food, teal for attractions, slate for stays and route
  endpoints. A red-blue pair is among the safer ones for colour-blind viewers, and
  neither is the amber that means unbooked.
- **Time** — the original ramp: deep blue before dawn, blue through the morning,
  gold at midday, orange then red into the evening, back to indigo at night.

**Paths are always coloured by time**, in both modes. A leg has a mode, not a
food/sight type, so colouring every path slate grey would throw real information
away. Dash pattern carries the mode: flights are fine dots, buses long dashes,
taxis short dots, walking a tight round-capped dotted line.

Anything unbooked gets a dashed amber ring, and the leg gets an amber halo.

### Clustering

Nodes closer together than 34 screen pixels merge into one larger node: a disc
sliced in proportion to what is inside it, with the member count below. Zoom in
and the same nodes drift past the threshold and separate again, so the threshold
is zoom-dependent for free.

The grouping is *seeded greedy* — walk the points in order, and for each one not
yet taken, absorb every remaining point within the radius of **it**. Distances are
measured to the seed, never transitively, so a long string of nodes cannot chain
into one blob spanning half the map.

Clicking a cluster zooms far enough to break it apart. When its members sit on the
same coordinates no zoom separates them, so it lists them in the panel instead of
leaving the click dead.

Only free-standing nodes cluster. Leg endpoints stay put, so a flight or bus line
always terminates on a visible node rather than in empty space.

Flight paths are true great-circle arcs, computed directly rather than via a
library. Longitudes are left unwrapped past ±180 so a Pacific crossing stays one
continuous line, and each path is drawn at −360 / 0 / +360 so it is visible in
whichever copy of the world is on screen.

## Where new code goes

All app state lives inside the single IIFE in `<script id="trip-app">`, declared in
the `STATE` block at the top before anything that runs during boot can touch it.
Put new features inside that IIFE.

There are no inline `onclick` handlers anywhere in the markup, and there should not
be — they resolve against the global scope, not the IIFE, so they would each need a
`window.foo = foo` export. Every listener is attached in `wire()`.

## Validating a change

`new Function()` on each `<script>` block catches syntax only — it cannot see a
scope or temporal-dead-zone error. Also run a declaration-before-use scan over the
IIFE body, and exercise the app under jsdom with a stubbed `L` to catch the logic
errors the other two miss. Re-run all three after **every** edit, and confirm the
edit actually landed before moving on: a `str_replace` whose old and new strings
are identical reports success and changes nothing.

## Not built yet

- **The sample data mirrors Notion, with two deliberate exceptions.**
  Coordinates on places and food are neighbourhood-level placeholders, added so
  the map has something to cluster; Notion holds the honest version, blank. And
  times on items the spreadsheet left unscheduled were inferred from the order
  they were listed in. Neither should be copied back into Notion.
- **`Confidence` is empty on every food row.** The column exists and the panel
  renders it, but the spreadsheet rated nothing, and inventing food-safety scores
  for restaurants nobody has been to would be worse than a blank.
- **Walking legs between stops are gone.** The previous sample data had eleven
  invented ones; the real Notion Transport database has only the nine legs the
  spreadsheet actually describes. Add walks as Transport rows with mode `Walk`
  and they will draw.
- **`Linked places` / `Linked stays` are carried through the data layer but not
  rendered.** The relation reaches the app as `item.linkedTo`; nothing displays it.
- **No offline cache.** The app refetches on every load and does nothing useful
  without signal. Worth deciding before the data layer grows.
- **No Firebase, no local overrides, no writes of any kind.** If you later want
  in-app checkboxes or draggable pins, note that once an override exists for a
  record, later edits to that value in Notion are silently shadowed — build the
  "clear override" path at the same time, not afterwards.
- **Dark theme only.** The basemap is OSM standard inverted by a CSS filter; a
  light mode just drops the filter, but the node and path palettes were picked
  against dark and would need re-checking.
- **Cluster count is a plain total.** It does not break down by type beyond the
  pie slices. Hovering lists the first four members by name.
- **Airport coordinates in the `AIRPORTS` table are approximate reference points.**
  Fine for drawing an arc; spot-check before relying on them for anything else.
