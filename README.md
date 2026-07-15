# Languages of South Asia

An interactive map of mother tongues in India, Pakistan, Nepal and Bangladesh, drawn from
the census returns of each country. For every sub-district it shows the largest language,
the largest mother tongue underneath it, how many are spoken, how linguistically diverse
the place is, and where any one language is spoken as a share of the population. The
**Population** control restricts any of these to urban or rural residents (India and
Pakistan report the split; Nepal and Bangladesh give totals only, so they grey out there).

Open `index.html` over a local server (`python3 -m http.server`) — the map fetches its
data, so `file://` will not work.

## What the census actually gives you

The Indian census sorts every reported mother tongue into one of ~120 **broad languages**.
Bhojpuri, Awadhi, Magahi and around fifty others are counted under Hindi; Saraiki and
Hindko under Lahnda. The map calls the broad category a *language* and the thing underneath
it a *mother tongue*, and lets you look at either. The gap between them is what "Diversity
lost to grouping" measures: the Shannon entropy of the mother tongue distribution minus
that of the language distribution, in bits.

Anything a state reports with under 10,000 speakers is thrown into an unnamed "others"
bucket, which is why "Share counted only as *other*" is worth looking at.

## Rebuilding the data

```
node build.mjs
```

reads the raw tables in `data/` plus the geometry, and writes `dist/data.json` (language
counts per unit) and `dist/map.json` (merged, quantised geometry). It prints a join report:
how many polygons matched a census unit, which ones didn't, and how many people ended up on
no map at all. **If you change anything, read that report.** A broken join renders as a grey
polygon, which looks exactly like a place that has no data.

Everything needed to match a census row to a polygon lives in `crosswalk/` as data, not as
`if` statements buried in the drawing code:

| file | what it fixes |
| --- | --- |
| `india_subdistrict_fixes.csv` | census sub-district codes that don't match the shapefile |
| `india_orphan_nearest.csv` | sub-districts the shapefile lacks → the nearest tehsil that has a polygon |
| `pakistan_subdivision_aliases.csv` | tehsils the census and the shapefile name differently |
| `pakistan_language_map.csv` | Pakistani language names onto Indian census categories |
| `nepal_language_map.csv` | Nepali language names onto Indian census categories |
| `language_families.csv` | every broad language to its family, which is what picks its colour |

The Nepali and Pakistani maps involve judgement calls — should Nepal's Tharu be counted
under Hindi, the way India counts it? Each row carries a `note` recording which way it went.

## Known gaps

All of these are printed by the build. They are the honest limits of the sources:

- **~22 million people are in a tooltip but not drawn on the map.** They belong to a
  district but to no polygon in it, either because the census keeps them outside any
  sub-district (a municipal corporation — "Area not under any Sub-district") or because the
  shapefile is simply missing their tehsil. Every one is reachable in some tooltip:
  - Municipal areas with no location of their own show as a second table in the tooltip of
    every tehsil of their district. Hovering a Darjeeling tehsil tells you it is 97% Nepali
    *and* that the district's towns, 517,000 people, are 36% Nepali and 31% Bengali.
  - Missing sub-districts attach to one drawn tehsil, shown only in its tooltip. Where
    gadm's sub-district geometry (`misc/gadm36_IND_3.json`) gives a real location, that's
    the true nearest tehsil (`crosswalk/india_orphan_nearest.csv`); otherwise it's a guess —
    the drawn sibling with the closest census code, since codes run in rough spatial order.
    Hovering Bisauli shows Budaun's million people (Hindi 88%, Urdu 12%).
- **Nothing with census data is left off the map.** The six FATA Frontier Regions do have
  polygons (`FR KOHAT` …) and data (~98% Pashto); an earlier parsing bug hid them, now
  fixed. Azad Kashmir and Gilgit-Baltistan are the only blank areas — the 2017 language
  census doesn't cover them — and hovering one says so rather than showing nothing.
- **6 districts are drawn at district level rather than sub-district.** The tooltip says
  so when you're on one. Three reasons:
  - *2 Indian districts* (Bangalore, Dharwad) have sub-district rows covering less than
    half the district — Bangalore's four tehsils hold 1.2M of its 9.6M people, so drawing
    them would show the rural fringe and no city. Below half, the district's own rows are
    used instead.
  - *1 Indian district* (Shajapur, Madhya Pradesh) has sub-district rows that don't add up:
    five tehsils are missing their Hindi head row and a sixth carries all six totals. The
    build checks that every broad language equals the sum of the mother tongues under it —
    true for 101,645 of 101,646 pairs — and falls back to district level here.
  - *3 Pakistani districts* have tehsils the shapefile predates (Lahore's Model Town,
    Shalimar and Raiwind), so their sub-divisions can't all be drawn.
- **Azad Kashmir and Gilgit-Baltistan are grey.** The 2017 Pakistani language tables don't
  cover them.
- **Diversity is not comparable across borders.** Only India publishes the mother tongue
  level, so Pakistan, Nepal and Bangladesh look far less diverse than they are; their
  "mother tongue" figures are just their language figures repeated.
- Bangladesh is a single polygon: its 2011 census published no district language breakdown.

## Sources

- **India**: Census 2011, table C-16 (mother tongue by sub-district). The `data/*.xlsx`
  files are the downloads; the `.csv` files are exports of them.
- **Pakistan**: 2017 census, table 11, by tehsil. `scripts/pakistan.py` concatenated the
  per-district tables into `data/pakistan.csv`.
- **Nepal**: 2011 census, language by district.
- **Bangladesh**: 2011 census, national totals only.
- **Geometry**: Indian sub-districts from Subhodip Mukherjee; Pakistan, Nepal and
  Bangladesh from [geoBoundaries](https://www.geoboundaries.org/).

Sri Lanka was removed: its census reports ethnicity, not language, and the two are not the
same question.

## Notes

Colour is by language family (blue Indo-Aryan, orange Dravidian, green Sino-Tibetan, purple
Iranian), with lightness separating languages inside a family.

Geometry is quantised to 4 decimal places (~11 m) at build time, which halves its size with
no visible change. Running it through [mapshaper](https://mapshaper.org/) would cut it much
further — that needs topology-aware simplification, which this build doesn't attempt.
