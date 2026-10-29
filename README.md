# Trip Planner

A single-file trip planner. The trip lives in Notion; this renders it as a
day-by-day map, builds the plan, and writes the plan back.

Three tabs: **Build** (assemble the day — the default), **Map** (what the day
looks like, with the timeline beside it) and **List** (the whole trip).

```
notion  ◄──►  netlify functions  ◄──►  index.html
              get-trip-data   (read,  open)
              save-trip-data  (write, passphrase)
```

There is no build step, no framework and no bundler — `index.html` is the whole
frontend.

## Repo

```
index.html                           the app
netlify/functions/get-trip-data.js   reads Notion
netlify/functions/save-trip-data.js  writes back, passphrase-gated
NOTION_SCHEMA.md                     what the Notion columns are
```

## Running it now

Open `index.html` in a browser. It boots against the sample data at the bottom of
the file — the Vietnam trip, transcribed from the spreadsheet — with no Notion and
no Netlify involved.

## Switching to live Notion

The seven databases already exist under the Notion page *Vietnam — Nov 2026*,
with the trip loaded into them. `NOTION_SCHEMA.md` has their ids. What is left:

1. Create a Notion integration and share each of the seven databases with it
   (`•••` → Connections).
2. In Netlify → Site settings → Environment variables, set `NOTION_TOKEN` and the
   seven `DB_*` ids from `NOTION_SCHEMA.md`.
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

### Legibility over the basemap

Overlays have to read against inverted OSM tiles, which go from near-white
motorways to dark parks within one screen. Three things do that work:

- The tile pane is dimmed harder than it looks like it needs
  (`brightness(.72) contrast(.78) saturate(.45)`) so the basemap stays
  background.
- Every node carries a 2px white ring **and** a dark ring outside it. Either one
  alone fails against some basemap colour; together they always separate.
- Every path is drawn twice: a near-black casing at `weight + 4.5` underneath,
  then the coloured line on top, both with the same dash. Each dash ends up
  outlined rather than sitting bare on the map. This is the single biggest win
  for thin dashed paths and it is why `drawLeg` and `drawRoute` each emit two
  polylines per world copy.

### Areas

An entry with an `Area radius (m)` draws as a shaded disc rather than a pin.
That is for things that are a neighbourhood — "walk around District 3" — where a
pin, or worse an invented polyline through named streets, would assert a
decision nobody has made. The disc says *somewhere in here* and stops.

### The day timeline

A rail beside the map lists the selected day in time order. Between each pair of
stops it works out the hop and what it leaves you:

```
10:45  Binh Tay Market
       ≈20 min taxi — 3 h 55 min there
15:00  Saigon street food tour
```

The useful number is the second one: time at the place, not time between places.
It comes out of the schedule rather than an invented dwell time — gap minus
travel, nothing else. Under 15 minutes it turns amber; negative turns red and
says how far short you are.

Travel estimates prefer a real `Duration (min)` from Notion. Failing that they
use straight-line distance scaled by `DETOUR` (1.3, the usual rule of thumb for
a street grid) over a door-to-door speed per mode — deliberately slower than the
vehicle cruises, since the estimate stands in for waiting and parking too.
Estimates are prefixed `≈`; real durations are not. Anything under 1.2 miles is
assumed walkable.

Entries also carry an *outside opening hours* flag, read from the `Open hours`
text. The parser is deliberately strict and silent when it cannot read a string
with confidence: a false "closed!" is worse than no warning, so `walk in`,
`included` and `Open 24 hours` produce nothing rather than a guess.

### Editing times

Click any time in the timeline for −30/−10/+10/+30 nudges and a direct entry
box. Edits recompute every downstream gap immediately, and the entry re-sorts
into its new slot.

Edits land in `localStorage` first, so they survive a reload with no network at
all. **Save to Notion** then pushes them, or **Copy instead** gives a pasteable
list if you would rather do it by hand. Moved times show a dot until Notion
agrees.

The Build tab works the same way and shares the same save button. On load the
browser's copy of the plan is reconciled with Notion's: a row edited here wins,
a row created here and not yet saved is kept, and a row whose Notion page has
gone is dropped rather than resurrected on the next save.

## Build — assembling a day

The default tab. The right-hand rail is the day as a list you edit: each entry
has a duration, and the clock runs forward from the day's `Day start`.

```
Start 08:00    ends 19:45   9 stops

04:45  SFO → SGN                         ×
04:45  San Francisco → Ho Chi Minh City
       dep[--:--] arr[04:45]  [▲][▼][‹|][|›]

04:45  Through SGN and into District 1   ×
07:30  set by hand · 5.5 mi
       [Taxi ▾][165]min [auto][draw]  [▲][▼][‹|][|›]

07:30  Bánh Mì Huynh Hoa              1  ×
07:45  Street stall
       [ 15 ]min [link][again]  [▲][▼][‹|][|›]

07:45  ≈8 min walk (0.4 mi) to get here — not in the clock
       [ budget it as a leg ]
```

**Nothing stores a clock time.** Every start and end is computed, so changing
one duration moves everything after it and leaves everything before it alone.
That is the whole reason the Build tab exists: the question "if we spend another
hour here, what breaks later?" has an answer on screen rather than in your head.

Every box carries a tooltip saying what its number means, because a bare
"165 min" next to a bare "60 min" gives no clue which is travel and which is
time at a place.

What the controls do:

- **Duration** — type the minutes. For a stop it is time there; for a leg it is
  travel time.
- **link** — pick this place, then pick another, and you get a leg between
  them. Straight line by default, which is the honest shape for a journey
  nobody has traced; the mode picker and **draw** are both on the row it
  creates. Esc or **Cancel** backs out without making anything.
- **again** — adds a second visit to the same place, right after the first. This
  is how the Airbnb appears three times in a day: arrive, drop the bags, sleep.
  The catalogue row is one row; the plan can point at it as often as it likes.
- **▲ ▼** — one slot earlier or later within the day.
- **‹| |›** — move the stop to the previous or next day. The view follows it, so
  you land on the day you just changed. *"The War Remnants Museum on the 14th
  rather than the 15th"* is one click.
- **×** — remove it. On the next save the Notion row is archived, not destroyed.
- **Start** — the day's `Day start`. Everything moves with it.

### Flights

A flight is its own kind of row, not a leg with a variable time. It has a fixed
departure and arrival and **no duration box**, and it pins the day rather than
floating on it: the clock runs up to the departure, the row flags any overrun,
and everything after starts from the arrival. A day that opens with a flight is
pinned by it, and the start-time control is replaced by *pinned by the flight*.

Time at the airport is a separate leg, because landing is not arriving.

The flight home crosses the dateline — leaves Saigon 18:40, lands San Francisco
17:00 the same day. The row says so and the clock stops rather than running
backwards. There is no timezone arithmetic anywhere in this app, by design.

### Transport legs

A leg carries one of six modes — walk, bike, motorbike, taxi, bus, train — plus
car, ferry and other for the rest. Picking a mode asks for that mode's time, so
whatever was there is cleared and re-estimated; type a number instead and it is
kept until you press **auto**.

For **bus, train and ferry** the estimate is calibrated against this trip's own
legs of that mode rather than a generic speed, and the row says so: *"≈ 176.4
mi, from 3 bus legs on this trip"*. A city-bus figure tells you nothing about a
Hanoi → Ha Giang sleeper, and the trip already records what that one takes.

That only applies over **15 miles**. Every bus on this trip is an intercity
coach averaging close to 40 mph, and applying that to a two-mile hop across
Hanoi made the bus beat the taxi — which is nonsense. Short legs get the city
speed and the row says *"≈ 2.4 mi at 18 mph"* instead.

**draw** traces the leg on the map — the same tool as **Add path**, with the
geometry landing on the leg instead of in a separate row. Tracing re-estimates
the time from the real length rather than the straight line.

A standalone drawn path also carries a mode now: the picker in the path list
changes both its dash pattern on the map and the `Mode` of the Transport row it
saves as.

### Hops that are not in the clock

Two stops with no leg between them get a faint row saying what the hop would
take — and saying explicitly that it is **not counted**. One click turns it into
a real leg that is.

The alternative, charging every estimated hop to the clock, double-counts: a
stop's duration already runs until the next thing starts. A day would drift
later with every stop added, which is worse than an honest gap.

### Adding things

The drawer at the foot of the rail is folded until you want it.

- **Find a place** — searches Places, Food and Stays across the whole trip, with
  today's entries first. Click to append. The same row can be added any number
  of times.
- **+ new place** — name it, then click the map.
- **+ walking area** — name it and give a radius, then click the map. Draws the
  same shaded disc as an `Area radius (m)` on a Place.
- **+ travel leg** — pick a mode.

On the map, anything on the day that is *not* in the plan is drawn faint and
dashed. Clicking it adds it. Planned stops are numbered in order, so the rail
and the map refer to each other.

The map frames the day's **stops**, not its legs — fitting everything meant
fitting the flight that got you here, and the whole day collapsed into one dot
in the corner.

## Saving back to Notion

`save-trip-data.js` is the write half. It needs one environment variable beyond
the read function's:

| Variable | What |
|---|---|
| `EDIT_SECRET` | The passphrase. **No default** — without it every write is refused, so a half-configured deploy fails closed rather than open. |

In the site, **Set passphrase** in the timeline footer stores it in your browser
so you type it once.

### Why a passphrase and not nothing

The site is on a public Netlify URL. Reads being open is a judgement call — it
is an itinerary — but an open write endpoint would let anyone who found the URL
edit the trip, so writes are gated.

Be clear about what this buys and what it does not. It stops a stranger who
finds the URL. It does **not** protect against anyone using your browser, and
the passphrase crosses the wire on each save — over HTTPS, but it is a shared
secret, not a token. For a two-person trip planner that is the proportionate
trade. If you want better, Netlify's own password protection or an identity
provider in front of the whole site is the next step up, and the function keeps
working underneath either.

### What the endpoint refuses to do

The integration token can reach every page shared with it, so a leaked
passphrase must not become a write primitive for the whole workspace. Every
target page is fetched first and its parent data source checked against the six
`DB_*` ids; anything outside them is refused **even with the right passphrase**.
Only a fixed set of properties is ever written, and the `Route` value is
re-parsed server-side rather than trusted from the browser.

Deletes archive (`archived: true`, Notion's trash, recoverable from the UI). The
site never hard-deletes anything.

### Rate limits and the 2,000-character cap

Notion allows about 3 requests/second on non-Business plans, so writes go one at
a time with a 350 ms gap, and a 429 is retried after `Retry-After`. A save is
capped at 120 changes.

A rich-text value holds 2,000 characters, roughly 95 coordinate pairs — an
auto-routed path easily exceeds that. The browser simplifies with
Douglas-Peucker before sending, loosening the tolerance until the path fits, so
**what gets saved is the line you were looking at**. The server thins again as a
backstop, dropping whole points and always keeping both ends; it never slices
the string, which would cut a coordinate in half.

### Partial failures

The response reports `applied` and `failed` separately and the page applies only
what landed. If three of four writes succeed, the fourth stays pending and the
save button still shows it. Nothing is silently dropped.

### Walking paths

Three shapes now, because a walk can be any of them:

- **Between two places** — a Transport row with mode `Walk`. Leave the lat/lng
  columns empty and type the names in `From`/`To`; the app resolves them against
  stays, places, food and the airport table by name. Explicit coordinates win.
- **As a place** — a Place row with a `Route` of `lat,lng` pairs. The place
  becomes a line rather than a dot, keeps its node at the start, and gets a small
  open marker at the far end so direction reads. Its length is measured along the
  path, not end to end.

- **Drawn on the map** — the **Add path** tool. Click to place points; click an
  existing node to snap to it *and* finish there; **End path**, Enter, or Esc to
  stop. Reopen a saved path to drag its vertices, or click one to delete it (it
  refuses to go below two points). **Save** writes it to Notion as a Transport
  row with mode `Walk`, marked `Drawn on site`; **Copy** still gives a `Route`
  string if you would rather paste it yourself. A finished path is named from
  whatever it starts and ends near — "Walk: Hoi An Airbnb → Japanese Covered
  Bridge" — by looking for a known node within 220 m of each end.

  Editing a path that is already in Notion marks it pending again, and the next
  save updates that row rather than creating a second one.

  **A path belongs to the day it was drawn on** and only appears on that day,
  like everything else on the map. Carrying every path onto every day turned
  the trip into a tangle. The **Trip** view shows all of them, and the path list
  says how many are on other days so a path you drew yesterday does not look
  lost. Saving stays global — a pending path counts wherever you are.

  **The list is rendered in both rails.** It used to live only beside the map,
  and once Build became the default tab a path you had drawn was on screen with
  no way to select or delete it: the controls were in a panel that tab hides.

  **Auto** snaps new segments to real streets via the public OSRM demo server.
  No key, but no uptime promise either, and the demo only serves the car profile
  — a "walking" snap follows drivable streets, which is fine for a city sketch
  and wrong in a pedestrian zone. Every request has a 6-second abort and falls
  back to a straight segment, so the tool never blocks on the network. **This
  path is untested against the live service** — it could not be reached from the
  sandbox this was built in. The failure path *was* tested, by blocking the
  request.

A route takes its **place's** colour rather than a time colour, because it
belongs to that place. Travel legs stay time-coloured. Drawn paths are pale blue
so they read as drafts rather than data. The legend says so.

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

Six Node suites and a browser pass live outside the repo, in this session's
scratchpad: `suite.js` (static checks plus a jsdom runtime pass over areas, the
timeline, time editing and the path tool), `build.js` (the Build tab end to
end — computed times, durations, reordering, moving between days, modes,
repeat visits, map picking, persistence and the save payload), `parse.js` and
`hours.js` (the two parsers, case by case), `save.js` (the write endpoint
against a mock Notion), `sync.js` (an in-page save round trip) and `bshot.js`
(Playwright: real layout, the Netlify badge clearance, tab switching and the
narrow breakpoint). 293 assertions plus 25 in the browser, all passing.

Five of those exist because the thing they check was once wrong in a way nothing
else would have caught:

- the computed schedule must replay the source times exactly;
- the page must not be scrollable sideways;
- a stored duration must not be recomputed from the mode;
- a blank coordinate must survive the `localStorage` round trip as a blank —
  `Number(null)` is `0`, not `NaN`, and that one line turned every empty
  coordinate into 0°N 0°E on the first reload after an edit;
- **a day you stripped must stay stripped** across a reload, which is the one
  that kept Notion's seed from overwriting a plan built by hand.

`new Function()` on each `<script>` block catches syntax only — it cannot see a
scope or temporal-dead-zone error. Also run a declaration-before-use scan over the
IIFE body, and exercise the app under jsdom with a stubbed `L` to catch the logic
errors the other two miss. Re-run all three after **every** edit, and confirm the
edit actually landed before moving on: a `str_replace` whose old and new strings
are identical reports success and changes nothing.

## Not built yet

- **The sample data mirrors Notion, with two deliberate exceptions.**
  Coordinates are now real, looked up place by place and written into Notion as
  well — 43 of them, several of which had been a kilometre or more out as
  placeholders. The remaining exceptions: a handful of rows that could not be
  identified confidently are still blank, and times on items the spreadsheet left
  unscheduled were inferred from the order they were listed in.
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
- **Dark theme only.** The basemap is OSM standard inverted by a CSS filter; a
  light mode just drops the filter, but the node and path palettes were picked
  against dark and would need re-checking.
- **Cluster count is a plain total.** It does not break down by type beyond the
  pie slices. Hovering lists the first four members by name.
- **Manual-mode paths are straight lines between waypoints.** Auto mode snaps
  them, with the caveats above.
- **Unsaved edits are per-browser.** Until you hit Save they do not sync across
  devices and are lost if site data is cleared. Once saved they are in Notion
  like anything else.
- **No conflict detection on save.** Change a time in Notion and the same time
  in the browser, and the save overwrites Notion without noticing. For one or
  two people editing a trip this has not been worth the machinery; the fix if it
  starts to bite is comparing `last_edited_time` before patching.
- **The Map tab's timeline still has no dwell times.** It knows when you arrive
  somewhere, not how long the thing takes: "3 h 55 min there" is time available,
  not time needed. The Build tab is where a duration is a real field — that is
  the difference between the two tabs.
- **The seeded durations are gaps, not measured visits.** Every Itinerary row's
  `Duration (min)` was derived from the interval to the next entry in the
  spreadsheet, so the computed schedule reproduces the original times exactly.
  They are a faithful transcription of what was planned, not an estimate of how
  long anything takes. Adjust them as you go — that is what the tab is for.
- **Reordering is buttons, not drag and drop.** ▲ ▼ moves one slot; dragging
  would be nicer and is a genuinely larger piece of work on touch.
- **A linked leg is a straight line, not a route.** Press **draw** on it to
  trace the real one, or **Auto** to let the router try.
- **Flight times are not checked against the Flights database.** Edit a
  flight's times in the Build tab and the Flights row keeps its own; the
  itinerary entry is what the day is built from.
- **A new place created on the map is an Itinerary row, not a Places row.** It
  carries its own coordinates and shows on the map, but it is not added to the
  catalogue, so it will not appear in the add drawer's search for other days.
  Promote it in Notion if you want it reusable.
- **No undo.** Every edit is immediate and local; **Discard** throws away *all*
  unsaved plan changes rather than the last one.
- **Name resolution is first-match.** Two rows with the same name resolve to
  whichever comes first (stays, then places, then food). Fine at this size, would
  need ids if the data grew.
- **Airport coordinates in the `AIRPORTS` table are approximate reference points.**
  Fine for drawing an arc; spot-check before relying on them for anything else.
