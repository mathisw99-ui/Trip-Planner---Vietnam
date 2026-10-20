# Notion schema

**These six databases already exist**, under the page *Vietnam — Nov 2026*, with
every column below and the trip loaded into them. This file is now the reference
for what is there, and the contract the Netlify function matches.

One correction to an earlier note in this repo: creating a database **with its
full schema in one call** does work through the Notion MCP tools, including
select options and relations. It is *altering* an existing schema afterwards —
adding a column, renaming one, adding an option — that reports success and
changes nothing. So: get the schema right at creation, and make later changes by
hand in the Notion UI.

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
| `Published` | Checkbox | |

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
| `Notes` | Text | |
| `Published` | Checkbox | |

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
| `Notes` | Text | |
| `Published` | Checkbox | |

A Notion relation points at exactly one database, which is why linking a leg to
both places and stays takes two columns. The function merges them into one array.

**Select options must be created by you in the Notion UI before use.** The MCP
tools cannot add one, and writing an unknown value to a fixed select throws.
The `Mode` values above are the ones the map has dash patterns for; anything else
falls back to the `Other` pattern.

---

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

The unpublished rows are the "other random stuff" shortlists and the items that
do not fit the Schedule tab's timing — they sit in Notion as options, invisible
to the site until you tick `Published` and give them a date.

Coordinates are blank on most places and food rows. The city tabs name places
but not locations, and guessing an address is worse than leaving it empty: the
site shows an undated or uncoordinated row in the list view and simply omits it
from the map, so nothing is lost by filling them in later.
