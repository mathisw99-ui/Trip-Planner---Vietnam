# Notion schema

**These seven databases already exist**, under the page *Vietnam — Nov 2026*, with
every column below and the trip loaded into them. This file is now the reference
for what is there, and the contract the Netlify function matches.

**Correcting an earlier note in this repo:** the Notion MCP tools handle schema
fine. Creating a database with its full schema in one call works, including
select options and relations, and `update-data-source` genuinely does add,
rename and drop columns afterwards — the `Route` column on Places was added that
way and verified by reading the schema back. The original "schema changes
silently fail" note was wrong; disregard it.

Two syntax notes, in case you rebuild these:
- A relation target must be given as a **bare data-source UUID**. Passing the
  `collection://` URL is rejected.
- A relation points at exactly one database, which is why linking a transport
  leg to both places and stays takes two columns.

Column names below are matched **exactly and case-sensitively** by
`netlify/functions/get-trip-data.js`. Rename a column in Notion and that field goes
silently null in the app. If you want different names, change them in both places.

---

## Conventions that apply to every database

**`Published` — checkbox, on every database.** The function filters on it
server-side, so a row is invisible to the app until you tick it. This is
deliberate: it keeps half-finished rows off the map. It is also the single most
common cause of "I added it and it didn't show up," so check it first.

**Every field the app reads is a real typed column.** Nothing is parsed out of a
free-text blob and nothing is read from the page body. Page body is yours for
whatever notes you like — the app ignores it.

**Times are local to the place they happen.** A Hanoi departure is stored as Hanoi
wall-clock, a San Francisco arrival as SF wall-clock. The app does no timezone
conversion at all, which means it can never be silently wrong by seven hours. The
cost is that it cannot derive a duration across timezones, so flight and transport
duration is an explicit `Duration (min)` column you fill in. Use Notion's "include
time" toggle on these date properties.

**Coordinates are plain Number columns,** `Lat` and `Lng`, in decimal degrees.
Right-click a pin in Google Maps and the first menu entry copies them in
`lat, lng` order. Flights are the exception — see below.

**`Booked` is a checkbox.** Unticked draws the dashed amber ring on the map and the
"things to book" count in the header. If a row has no booking concept, tick it.

---

## 1. Days

One row per calendar day of the trip. This drives the day rail and the list view —
without a row here, a day does not exist.

| Column | Type | Notes |
|---|---|---|
| `Name` | Title | Yours to use; the app ignores it |
| `Date` | Date | One day, no time |
| `Sleeping` | Text | Where you sleep the night *starting* this date |
| `Base` | Text | City or region, e.g. "Ha Giang loop" |
| `Summary` | Text | One line, shown in the list view |
| `Day start` | Text | `HH:MM`. When the Build tab starts counting. Blank means 08:00 |
| `Published` | Checkbox | |

`Day start` is the only clock time the Build tab reads. Everything after it is
computed by adding up durations, which is why moving one stop moves the rest.

## 2. Flights

| Column | Type | Notes |
|---|---|---|
| `Name` | Title | Yours to use |
| `Airline` | Text | |
| `Flight number` | Text | |
| `From` | Text | IATA code, e.g. `SGN` |
| `To` | Text | IATA code |
| `Departs` | Date + time | Local at the origin |
| `Arrives` | Date + time | Local at the destination |
| `Duration (min)` | Number | Actual time in the air |
| `Price` | Number | Optional |
| `Booked` | Checkbox | |
| `Link` | URL | |
| `Notes` | Text | |
| `Published` | Checkbox | |

Flights carry no coordinates. The app resolves the IATA code against the
`AIRPORTS` table at the bottom of `index.html`, which already holds SFO, SGN, HAN
and DAD. Add a line there for any new airport — a code that isn't in the table makes
the flight silently vanish from the map, which is the one failure mode to watch for.
A bundled table beats hand-entering coordinates on every flight row: enter SGN once,
correctly, instead of four times.

## 3. Stays

| Column | Type | Notes |
|---|---|---|
| `Name` | Title | Shown on the map |
| `Location` | Text | Neighbourhood or address |
| `Lat` / `Lng` | Number | |
| `Stay` | Date **range** | Check-in → check-out. Use Notion's "end date" toggle |
| `Price` | Number | Optional |
| `Link` | URL | Airbnb / booking page |
| `Booked` | Checkbox | |
| `Notes` | Text | |
| `Published` | Checkbox | |

The stay appears on every night in the range: a 13 Nov → 15 Nov range is two
nights, 13th and 14th, and the node shows on both days.

## 4. Places (locations of interest)

| Column | Type | Notes |
|---|---|---|
| `Name` | Title | |
| `Lat` / `Lng` | Number | |
| `When` | Date + time | Time optional; without it the node is grey |
| `Category` | Select | `Sight` `Museum` `Nature` `Activity` `Shopping` `Food tour` `Spa` `Nightlife` `Other` |
| `Link` | URL | |
| `Booked` | Checkbox | Tickets, tours |
| `Route` | Text | Optional. Draws this place as a walking path — see below |
| `Area radius (m)` | Number | Optional. Shades a circle instead of a bare pin — see below |
| `Notes` | Text | |
| `Published` | Checkbox | |

### Areas

Some entries are a neighbourhood, not a point: "walk around District 3" names
four streets and a lake, and which way you actually wander is the whole point.
Put a radius in metres in `Area radius (m)` and the site shades a soft disc of
that size around `Lat`/`Lng` rather than dropping a pin that claims more
precision than exists. 400–900 m covers most walkable districts; Hoi An's
ancient town is about 450.

The five "walk around …" entries use this. They previously had invented
polylines threading streets nobody had chosen — a drawn line reads as a decision
that had not been made.

### Walking routes on a place

Some entries are a walk rather than a point — "walk around District 3". Put a
series of `lat,lng` pairs in `Route`, separated by semicolons, and the site draws
a walking line through them instead of a single dot:

```
10.7866,106.6880; 10.7840,106.6905; 10.78266,106.69592
```

Right-click a spot in Google Maps and click the coordinates at the top of the
menu to copy a pair. Order matters; two points is the minimum. Newlines and `|`
work as separators too, and a malformed pair is dropped rather than breaking the
whole line.

Easier than typing them: draw the path on the map with **Add path**, then hit
**Copy** on it and paste the result straight into this column. That is what the
tool's output format is for.

A row can have both a `Route` and an `Area radius (m)` — the two Hoi An old-town
entries do, because their waypoints are real landmarks. The disc gives the
extent, the line gives the order.

`Lat`/`Lng` stay useful alongside a route: they place the node, and the site
falls back to the route's first point when they are blank. The detail panel
shows the walk's length measured along the path, and a small open marker goes at
the far end so the direction reads.

## 5. Food

| Column | Type | Notes |
|---|---|---|
| `Name` | Title | |
| `Lat` / `Lng` | Number | |
| `Type` | Select | `Restaurant` `Street stall` `Market` `Cafe` `Bar` `Dessert` `Grocery` `Other` |
| `When` | Date + time | |
| `Open hours` | Text | Free text, e.g. "07:00–14:00, closed Mon" |
| `Reservation` | Text | Confirmation code or "walk in" |
| `Confidence` | Number | 1–5, how safe the food looks |
| `Link` | URL | |
| `Booked` | Checkbox | Tick for a held reservation |
| `Notes` | Text | |
| `Published` | Checkbox | |

## 6. Transport (ground)

| Column | Type | Notes |
|---|---|---|
| `Name` | Title | Shown as the leg label, e.g. "Sleeper bus" |
| `Mode` | Select | `Walk` `Bike` `Bus` `Train` `Taxi` `Car` `Motorbike` `Ferry` `Other` |
| `From` / `To` | Text | Place names |
| `From lat` / `From lng` | Number | |
| `To lat` / `To lng` | Number | |
| `Departs` | Date + time, **range** | Set an end date for an overnight leg |
| `Arrives` | Date + time | |
| `Distance (mi)` | Number | Road distance; the app does not guess it |
| `Duration (min)` | Number | |
| `Elevation (ft)` | Number | Total climb |
| `Price` | Number | |
| `Booked` | Checkbox | |
| `Link` | URL | |
| `Linked places` | Relation → Places | |
| `Linked stays` | Relation → Stays | |
| `Route` | Text | Optional traced path; the map follows it instead of a straight From→To line |
| `Drawn on site` | Checkbox | Set by the site when it created the row from a drawn path |
| `Notes` | Text | |
| `Published` | Checkbox | |

A Notion relation points at exactly one database, which is why linking a leg to
both places and stays takes two columns. The function merges them into one array.

### Rows the site creates

A path drawn with **Add path** and saved becomes a Transport row here: the mode
chosen for it in the path list, `Route` holding the traced geometry, `Departs`
set to the day it was drawn on, From/To named after whatever the ends sit near,
`Published` ticked, and `Drawn on site` ticked so you can tell at a glance where
a row came from.

`Departs` is what ties the path to a day: the site only draws it on that day.
Change the date here and the path moves with it. Untick `Drawn on site` freely — it is a label,
not a dependency.

Editing that path on the site and saving again updates the same row. Deleting it
on the site archives the row (Notion's trash), it is not destroyed.

### Walks between two places

For a walk from one thing to another, leave all four lat/lng columns **empty**
and just type the names in `From` and `To`. The site matches them against Stays,
Places, Food and the airport table by name — case- and whitespace-insensitive —
and borrows those coordinates, so a walk between two rows that already exist
needs no coordinates typed at all. The detail panel says when a position was
derived this way.

Explicit coordinates always win; this only fills blanks. If a name matches
nothing the leg has no position and is skipped on the map while still showing in
the list, so a typo degrades quietly rather than breaking the page. Duplicate
names resolve to the first match, searching stays, then places, then food.

**Select options must be created by you in the Notion UI before use.** The MCP
tools cannot add one, and writing an unknown value to a fixed select throws.
The `Mode` values above are the ones the map has dash patterns for; anything else
falls back to the `Other` pattern.

## 7. Itinerary — the day plan

This is the **Build** tab: what was decided, in order, and for how long. It is
deliberately separate from Places, Food and Stays, which are the *catalogue* —
the things that exist. One catalogue row can appear in the plan many times,
which is how "drop the bags at the Airbnb, go out, come back" is expressible at
all. A single `When` column on the Place could never say that.

| Column | Type | Notes |
|---|---|---|
| `Name` | Title | What the entry is |
| `Date` | Date | Which day. No time — see below |
| `Order` | Number | Position within the day, low to high. The site rewrites these when you reorder |
| `Type` | Select | `Stop` `Travel` |
| `Duration (min)` | Number | How long this takes |
| `Duration mode` | Select | `Estimated` `Manual`. Manual means it was typed in |
| `Mode` | Select | Travel rows only: `Walk` `Bike` `Bus` `Train` `Taxi` `Car` `Motorbike` `Ferry` `Other` |
| `Lat` / `Lng` | Number | Position. For Travel, the start point |
| `To lat` / `To lng` | Number | Travel rows only: the end point |
| `Area radius (m)` | Number | Shades a circle instead of a pin, for an area rather than a point |
| `Route` | Text | Travel rows only: a traced path, same `lat,lng; …` format as elsewhere |
| `Place` / `Food` / `Stay` | Relation | The catalogue row this stop is, if any. At most one is set |
| `Notes` | Text | |
| `Published` | Checkbox | |

### No entry stores a clock time

Only `Duration (min)`. The day's schedule is computed forward from the Days
row's `Day start`, so changing one duration moves everything after it and
nothing else. A stored start time would have to be rewritten on every edit, and
the first one missed would quietly contradict the rest.

### How a duration is decided

A `Duration (min)` already on the row is used as it stands, whatever
`Duration mode` says — it is a decision someone made, not a guess to redo.
The site only estimates when the column is **empty**, and it empties the column
itself at the two moments that invalidate the old figure: when you pick a
different transport mode, and when you trace the leg on the map.

This matters more than it looks. Recomputing a stored duration from the mode
once priced the SFO → SGN leg as 7,900 miles at walking pace and pushed the
first day to four in the morning, three days later.

For `Bus`, `Train` and `Ferry` the estimate is calibrated against this trip's
own legs of that mode rather than a generic speed: a city-bus figure is useless
for a Hanoi → Ha Giang sleeper, and the trip already records what that one
actually takes. The row says where the number came from.

Calibration applies over 15 miles only. Below that the trip's own legs do not
describe the journey — every bus here is an intercity coach — and a city speed
is used instead.

### Stops with no leg between them

If two stops sit next to each other with no Travel row between, the site shows
the hop it would take and says **it is not in the clock**. One click turns it
into a real Travel row that is. Charging an estimated hop to the clock as well
would double-count every journey already inside a stop's duration, and the day
would drift later with every stop added.

### Rows the site creates

Everything in the Build tab — a stop added, a leg drawn, an area shaded, an
order changed, a stop moved to another day — becomes a row here with
`Published` ticked. Removing one on the site archives it (Notion's trash) on
the next save; nothing is destroyed.

---

## Environment variables

| Variable | Used by | What |
|---|---|---|
| `NOTION_TOKEN` | both functions | Integration token |
| `DB_*` (seven) | both functions | The database ids below. For the write function these double as the allowlist: a page outside them cannot be written even with the right passphrase. |
| `EDIT_SECRET` | `save-trip-data` | The passphrase for saving. Unset means every write is refused. |

## Database IDs

Fill these in as you create each database. Use the classic UUID from the
database's "Copy link" — **not** the `collection://uuid` form the MCP tools return.
Those are different ID systems and the function silently returns nothing if given
the wrong one.

| Database | Netlify env var | ID |
|---|---|---|
| Days | `DB_DAYS` | `7179048519c04c3cb3f1d0049300a859` |
| Flights | `DB_FLIGHTS` | `c3d7fa9f0d1e433ab76ddef16278b25e` |
| Stays | `DB_STAYS` | `ef062ba2a1c94b63a34e7e3a9d05e041` |
| Places | `DB_PLACES` | `6acf9788ec9540f4bf937e986b86201f` |
| Food | `DB_FOOD` | `7bef3b1514b5430bb4fe0f714bee0013` |
| Transport | `DB_TRANSPORT` | `0d3bf780d9b24bfcb9cc7c1f82f96b18` |
| Itinerary | `DB_ITINERARY` | `ef3aa45f78bc438799c6874dd118c156` |

**These IDs are untested against the REST API.** They came back from the MCP
tools that created the databases, and they are the right *shape* for
`api.notion.com/v1/databases/{id}/query` at version 2022-06-28, but no request
has actually been made with them — that needs a `NOTION_TOKEN`, which this
session did not have. First deploy, hit the function URL directly and read the
JSON before assuming the wiring is good.

Share each database with your Notion integration (`•••` → Connections → your
integration), or every query comes back empty with no useful error.

## What is in them now

| Database | Rows | Published |
|---|---|---|
| Days | 14 | 14 |
| Flights | 5 | 5 |
| Stays | 7 | 7 |
| Transport | 9 | 9 |
| Places | 25 | 18 |
| Food | 43 | 26 |
| Itinerary | 73 | 73 |

The unpublished rows are the "other random stuff" shortlists and the items that
do not fit the Schedule tab's timing — they sit in Notion as options, invisible
to the site until you tick `Published` and give them a date.

Coordinates are blank on most places and food rows. The city tabs name places
but not locations, and guessing an address is worse than leaving it empty: the
site shows an undated or uncoordinated row in the list view and simply omits it
from the map, so nothing is lost by filling them in later.
