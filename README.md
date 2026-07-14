# Languages of South Asia

An interactive map of mother tongues in India, Pakistan, Nepal and Bangladesh, drawn from
the census returns of each country. For every sub-district it shows the largest language,
the largest mother tongue underneath it, how many are spoken, how linguistically diverse
the place is, and where any one language is spoken as a share of the population.

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
| `pakistan_subdivision_aliases.csv` | tehsils the census and the shapefile name differently |
| `pakistan_language_map.csv` | Pakistani language names onto Indian census categories |
| `nepal_language_map.csv` | Nepali language names onto Indian census categories |
| `language_families.csv` | every broad language to its family, which is what picks its colour |

The Nepali and Pakistani maps involve judgement calls — should Nepal's Tharu be counted
under Hindi, the way India counts it? Each row carries a `note` recording which way it went.

## Known gaps

All of these are printed by the build. They are the honest limits of the sources:

- **13.5 million people are in the tooltip but not on the map.** The census reports the
  larger municipal corporations as "Area not under any Sub-district" — they belong to a
  district but to none of its tehsils, and the shapefile has no polygon that is their
  shape. Rather than dropping them (they include most of urban West Bengal) or smearing
  them across the district, each one is shown as a second table in the tooltip of every
  tehsil of its district. Hovering a Darjeeling tehsil tells you it is 97% Nepali *and*
  that the district's towns, 517,000 people, are 36% Nepali and 31% Bengali.
- **5.8 million people (0.36%) are on no map at all.** Their census sub-districts have no
  polygon in the shapefile, mostly places created after it was drawn.
- **16 districts are drawn at district level rather than sub-district.** The tooltip says
  so when you're on one. Three reasons:
  - *2 Indian districts* (Bangalore, Dharwad) have sub-district rows covering less than
    half the district — Bangalore's four tehsils hold 1.2M of its 9.6M people, so drawing
    them would show the rural fringe and no city. Below half, the district's own rows are
    used instead.
  - *1 Indian district* (Shajapur, Madhya Pradesh) has sub-district rows that don't add up:
    five tehsils are missing their Hindi head row and a sixth carries all six totals. The
    build checks that every broad language equals the sum of the mother tongues under it —
    true for 101,645 of 101,646 pairs — and falls back to district level here.
  - *13 Pakistani districts* have tehsils the shapefile predates (Lahore's Model Town,
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
