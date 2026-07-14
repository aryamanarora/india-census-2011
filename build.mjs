// Builds dist/data.json (language counts per unit) and dist/map.json (merged geometry)
// from the raw census tables in data/ and the crosswalks in crosswalk/.
//
//   node build.mjs
//
// Everything the map needs to join a census row to a polygon lives in crosswalk/,
// as data. If a unit stops matching, the build says so instead of the map quietly
// rendering it grey.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'fs'

const COORD_DECIMALS = 4 // ~11 m; well under a pixel even zoomed in

// ---------------------------------------------------------------- csv

function parseCSV(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
    const rows = []
    let row = [], field = '', quoted = false
    for (let i = 0; i < text.length; i++) {
        const c = text[i]
        if (quoted) {
            if (c === '"') {
                if (text[i + 1] === '"') { field += '"'; i++ }
                else quoted = false
            } else field += c
        } else if (c === '"') quoted = true
        else if (c === ',') { row.push(field); field = '' }
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
        else if (c !== '\r') field += c
    }
    if (field || row.length) { row.push(field); rows.push(row) }
    return rows
}

function readRows(path) {
    return parseCSV(readFileSync(path, 'utf8')).filter(r => r.some(f => f !== ''))
}

function readObjects(path) {
    const rows = readRows(path)
    const header = rows[0].map(h => h.trim())
    return rows.slice(1).map(r => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])))
}

const readJSON = path => JSON.parse(readFileSync(path, 'utf8'))

// ---------------------------------------------------------------- languages

const families = new Map(
    readObjects('crosswalk/language_families.csv').map(r => [r.broad_name, r.family])
)

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const titleCase = s => s.toLowerCase().replace(/(^|[ /])([a-z])/g, (_, p, c) => p + c.toUpperCase())

const languages = {}       // id -> {name, family, kind, broad, other, code}
const narrowIndex = new Map() // "BROAD|narrow name" -> id, and "narrow name" -> id
const unmappedFamilies = new Set()

function familyOf(broadName) {
    if (families.has(broadName)) return families.get(broadName)
    unmappedFamilies.add(broadName)
    return 'Other'
}

function broadId(broadName, code = null) {
    const id = 'b.' + slug(broadName)
    if (!languages[id]) {
        languages[id] = {
            name: titleCase(broadName), family: familyOf(broadName), kind: 'broad',
            other: broadName === 'OTHERS', code,
        }
    }
    if (code != null) languages[id].code = code
    return id
}

// "Others counted under Hindi" — the census's residual bucket inside each broad language.
function residualId(broadName) {
    const id = 'o.' + slug(broadName)
    if (!languages[id]) {
        languages[id] = {
            name: 'Others counted under ' + titleCase(broadName),
            family: familyOf(broadName), kind: 'narrow', broad: broadId(broadName), other: true,
        }
    }
    return id
}

function narrowId(name, broadName, censusCode = null) {
    const key = broadName + '|' + name.toLowerCase()
    if (narrowIndex.has(key)) return narrowIndex.get(key)
    const id = censusCode ? 'n.' + censusCode : 'm.' + slug(name)
    if (!languages[id]) {
        languages[id] = {
            name, family: familyOf(broadName), kind: 'narrow', broad: broadId(broadName),
            other: name === 'Other(s)',
        }
    }
    narrowIndex.set(key, id)
    return id
}

// Resolve a foreign (Pakistan/Nepal) mother tongue onto an Indian one where the
// census already has it, so "Punjabi" is one entry on both sides of the border.
function foreignNarrowId(name, broadName) {
    const key = broadName + '|' + name.toLowerCase()
    if (narrowIndex.has(key)) return narrowIndex.get(key)
    return narrowId(name, broadName)
}

// ---------------------------------------------------------------- units

const units = {}

function unit(id, meta) {
    if (!units[id]) units[id] = { ...meta, total: 0, langs: {} }
    return units[id]
}

const add = (u, langId, n) => { if (n) u.langs[langId] = (u.langs[langId] || 0) + n }

// ---------------------------------------------------------------- India

const INDIA_FIXES = new Map(
    readObjects('crosswalk/india_subdistrict_fixes.csv').map(r => [r.census_key, r.sdtcode11])
)

// mother tongue code "006002" -> the broad language it is counted under ("HINDI").
// Filled in from each state's own broad-head rows, which precede its narrow rows.
const BROAD_BY_GROUP = new Map()

const stateFiles = readdirSync('data')
    .filter(f => f.endsWith('.csv'))
    .filter(f => !['pakistan.csv', 'nepal.csv', 'bangladesh.csv'].includes(f))

const indiaTables = stateFiles.map(f => readRows('data/' + f))

// Some districts report part of their population as "Area not under any Sub-district"
// (a municipal corporation, typically). Those people are in the district totals but in
// none of its sub-district rows: Bangalore's sub-districts hold 1.2M of its 9.6M people.
// Six such areas have a polygon of their own (Kolkata, Greater Mumbai, ...) and are
// listed in the fixes crosswalk. For the rest there is no polygon to put them on, so we
// fall back to district-level figures for the whole district rather than mapping a
// version of it with the city cut out.
const COARSE_DISTRICTS = new Set()
const COARSE_REASON = new Map()
// The shapefile is newer than the census and disagrees with it about which district
// some sub-districts sit in (West Bengal redistricted after 2011). The census's own
// assignment is the one the counts follow, so route polygons by that.
const DISTRICT_OF_SUB = new Map()

// A broad language is the sum of the mother tongues counted under it. Check it, per
// sub-district: in Shajapur (Madhya Pradesh) five sub-districts have no Hindi head row at
// all and a sixth carries all six of their totals, so drawing that district from its
// sub-district rows would show one tehsil at five times its real size and five more as
// empty. Where the sub-district rows don't add up, use the district's own rows, which do.
const tally = new Map()
// Population the census puts in no sub-district at all — a municipal corporation, usually.
// Six of them have a polygon of their own (Kolkata, Greater Mumbai, ...) and are listed in
// the fixes crosswalk. The rest have nowhere to be drawn.
const aside = new Map()   // district -> people not under any sub-district
const dtTotal = new Map() // district -> people, from its own rows
const subTotal = new Map() // district -> people, summed over its sub-district rows

for (const rows of indiaTables)
    for (const r of rows) {
        const [, , district, sub, , mtCode, , totalP] = r
        if (!/^\d{6}$/.test(mtCode ?? '') || district === '000') continue
        const n = parseInt(totalP) || 0
        const group = mtCode.slice(0, 3)
        const head = mtCode.slice(3) === '000'
        const bump = (m, k, v) => m.set(k, (m.get(k) || 0) + v)

        if (sub === '00000') { if (head) bump(dtTotal, district, n); continue }
        if (sub === '99999') {
            if (head && !INDIA_FIXES.has(district + sub)) bump(aside, district, n)
            continue
        }
        DISTRICT_OF_SUB.set(sub, district)
        if (head) bump(subTotal, district, n)

        if (group === '124') continue // the "others" bucket has no mother tongues under it
        const key = district + '|' + sub + '|' + group
        if (!tally.has(key)) tally.set(key, { head: null, sum: 0, district })
        const t = tally.get(key)
        if (head) t.head = n
        else t.sum += n
    }

for (const t of tally.values())
    if (t.head === null || t.head !== t.sum) {
        COARSE_DISTRICTS.add(t.district)
        COARSE_REASON.set(t.district, 'sub-district rows do not add up')
    }

// Drawing the sub-districts of a district whose sub-district rows cover almost none of it
// is a caricature: Bangalore's four tehsils hold 12% of the district, so the map would
// show its rural fringe and no city. Below half, fall back to the district. Above it, keep
// the sub-districts and report the leftover in the tooltip instead of burying it.
for (const [district, people] of aside) {
    const covered = (subTotal.get(district) || 0) / (dtTotal.get(district) || 1)
    if (covered < 0.5) {
        COARSE_DISTRICTS.add(district)
        COARSE_REASON.set(district, 'the census puts most of the district in no sub-district')
        aside.delete(district) // the district's own rows already include these people
    }
}

let indiaRows = 0
for (const rows of indiaTables) {
    let stateName = ''
    for (const r of rows) {
        // cols: 0 table, 1 state, 2 district, 3 sub-district, 4 area name, 5 mt code, 6 mt name, 7 total P
        const [, , district, sub, areaName, mtCode, mtName, totalP] = r
        if (!/^\d{6}$/.test(mtCode || '')) continue // header cruft
        if (district === '000') { stateName = areaName.trim(); continue }

        const coarse = COARSE_DISTRICTS.has(district)
        // The people the census puts in no sub-district get their own record, with a full
        // language breakdown, which the tooltip shows alongside whichever tehsil you are
        // hovering. They can't be drawn — nothing in the shapefile is that shape — but
        // they can at least be read.
        const isAside = sub === '99999' && aside.has(district)
        // In a coarse district the district row is the whole story; elsewhere it is a
        // duplicate of its sub-districts.
        if (!isAside && coarse !== (sub === '00000')) continue
        if (sub === '99999' && !isAside && !INDIA_FIXES.has(district + sub)) continue

        // Assam's sub-district codes repeat across districts, so its ids carry the
        // district prefix — applied after the fix, not before.
        const fixed = INDIA_FIXES.get(district + sub) ?? sub
        const dtKey = 'IN' + district
        let unitId
        if (isAside) unitId = 'A:' + dtKey
        else if (coarse) unitId = 'D' + district
        else if (stateName === 'ASSAM') unitId = district + fixed
        else unitId = fixed

        const u = unit(unitId, {
            country: 'IN',
            coarse: coarse || undefined,
            aside: isAside || undefined,
            dtKey, // district this unit belongs to, for folding no-polygon units into asides
            dtcode: district, // `district` itself gets the district's name, from the shapefile
            // the census's own name for this unit — the only label an orphan (no polygon) has
            censusName: areaName.trim(),
            censusState: titleCase(stateName),
        })
        const n = parseInt(totalP) || 0
        const name = mtName.trim()
        const group = mtCode.slice(0, 3)          // broad language number, e.g. "006"
        const kind = mtCode.slice(3)              // "000" head, "999" residual, else a mother tongue
        indiaRows++

        if (kind === '000') {
            const broadName = name.replace(/^\d+\s+/, '').trim() // "6 HINDI" -> "HINDI"
            add(u, broadId(broadName, parseInt(group)), n)
            u.total += n // the broad languages partition the population
            BROAD_BY_GROUP.set(group, broadName)
            if (broadName === 'OTHERS') add(u, narrowId('Other(s)', 'OTHERS', mtCode), n)
        } else if (kind === '999') {
            add(u, residualId(BROAD_BY_GROUP.get(group)), n)
        } else {
            add(u, narrowId(name, BROAD_BY_GROUP.get(group), mtCode), n)
        }
    }
}

// ---------------------------------------------------------------- Pakistan

const PK_ALIASES = readObjects('crosswalk/pakistan_subdivision_aliases.csv')
const PK_LANGS = new Map(
    readObjects('crosswalk/pakistan_language_map.csv').map(r => [r.pakistan_name, r])
)

// Census names carry a unit type ("X TEHSIL", "Y TALUKA"); the shapefile doesn't.
function pkSubdivision(row) {
    let name = row.subdivision
    for (const a of PK_ALIASES) {
        if (a.census_name !== name) continue
        if (a.district && a.district !== row.district) continue
        if (a.province && a.province !== row.province) continue
        name = a.shapefile_name
        break
    }
    name = name.replace('SUB DIVISION', 'SUB-DIVISION')
    const parts = name.split(' ')
    if (parts[0] === 'FR') parts.push('TEHSIL') // Frontier Regions are named without a type
    return parts.slice(0, -1).join(' ')
}

// The polygon names decide what granularity we can actually draw.
const pkShapes = new Set(
    readJSON('pakistan-2017.geojson').features.map(f => f.properties.shapeName.toUpperCase())
)

// A row whose sub-division is its own district is the district total — that is how FATA
// ("BAJAUR AGENCY") and Malakand report, so keying off a "DISTRICT" suffix missed them
// and turned seven district aggregates into phantom sub-divisions.
const pkRows = readObjects('data/pakistan.csv')
    .filter(r => r.urban === 'TOTAL' && r.sex === 'ALL SEXES')
const pkSubRows = pkRows.filter(r => r.subdivision !== r.district)
const pkDistrictRows = pkRows.filter(r => r.subdivision === r.district)

// The shapefile predates the 2017 census, which split new tehsils out (Lahore's Model
// Town, Shalimar and Raiwind have no polygon). A tehsil with a polygon is drawn on its own;
// one without becomes a no-polygon unit that the folding pass below turns into an aside on
// its district. But where the tehsils that *do* have polygons cover less than half the
// district — Lahore keeps only its two smallest — that leaves a caricature, so draw the
// whole district coarse instead (the same rule India uses for Bangalore).
const pkDistrictPop = new Map(), pkDrawablePop = new Map()
for (const r of pkRows) {
    if (r.language !== 'TOTAL') continue
    const n = parseInt(r.count) || 0
    if (r.subdivision === r.district) pkDistrictPop.set(r.district, n)
    else if (pkShapes.has(pkSubdivision(r)))
        pkDrawablePop.set(r.district, (pkDrawablePop.get(r.district) || 0) + n)
}
const pkCoarse = new Set()
for (const [district, total] of pkDistrictPop)
    if ((pkDrawablePop.get(district) || 0) < 0.5 * total) {
        pkCoarse.add(district)
        COARSE_REASON.set('PK' + district, 'most of the district has no sub-division polygon')
    }

// For a coarse district, its matched-tehsil polygons carry the whole-district figures.
const PK_POLYGON_UNIT = new Map()
for (const r of pkSubRows) {
    const id = pkSubdivision(r)
    if (pkCoarse.has(r.district) && pkShapes.has(id)) PK_POLYGON_UNIT.set(id, 'PK' + r.district)
}

for (const row of [...pkSubRows, ...pkDistrictRows]) {
    const coarse = pkCoarse.has(row.district)
    if (coarse !== (row.subdivision === row.district)) continue
    const id = coarse ? 'PK' + row.district : pkSubdivision(row)
    if (!id) continue
    const u = unit(id, {
        country: 'PK',
        name: titleCase(coarse ? row.district : id),
        district: coarse ? undefined : titleCase(row.district),
        state: titleCase(row.province),
        coarse: coarse || undefined,
        dtKey: coarse ? undefined : 'PK' + row.district,
    })
    const n = parseInt(row.count) || 0
    if (row.language === 'TOTAL') { u.total = n; continue }
    const m = PK_LANGS.get(row.language)
    if (!m) { console.warn(`  ! unmapped Pakistani language: ${row.language}`); continue }
    add(u, broadId(m.broad_name), n)
    add(u, foreignNarrowId(m.narrow_name, m.broad_name), n)
}

// ---------------------------------------------------------------- Nepal

const NP_LANGS = readObjects('crosswalk/nepal_language_map.csv')

for (const row of readObjects('data/nepal.csv')) {
    if (row.admin2_name.startsWith('#')) continue // HXL tag row, not data
    const id = row.admin2_name.toUpperCase() + '_NEPAL'
    const total = parseInt(row.pop_total) || 0
    const u = unit(id, { country: 'NP', name: row.admin2_name, state: row.admin1_name })
    u.total = total
    for (const m of NP_LANGS) {
        const share = parseFloat(row[m.nepal_name + '_primary'])
        if (!share) continue
        const n = Math.round(share * total)
        add(u, broadId(m.broad_name), n)
        add(u, foreignNarrowId(m.narrow_name, m.broad_name), n)
    }
}

// ---------------------------------------------------------------- Bangladesh

{
    const u = unit('BANGLADESH', { country: 'BD', name: 'Bangladesh' })
    for (const row of readObjects('data/bangladesh.csv')) {
        const n = parseInt(row.count) || 0
        add(u, broadId(row.broad_name), n)
        add(u, foreignNarrowId(row.narrow_name, row.broad_name), n)
        u.total += n
    }
}

// ---------------------------------------------------------------- derived stats

// Broad heads and narrow mother tongues each partition the population, so each
// gives a well-formed distribution to take an entropy over.
function stats(u) {
    const broad = [], narrow = []
    for (const [id, n] of Object.entries(u.langs)) {
        if (!n) continue
        ;(languages[id].kind === 'broad' ? broad : narrow).push([id, n])
    }
    const rank = xs => xs.sort((a, b) => b[1] - a[1]).map(x => x[0])
    const entropy = xs => u.total
        ? -xs.reduce((h, [, n]) => { const p = n / u.total; return p > 0 ? h + p * Math.log2(p) : h }, 0)
        : 0
    const otherShare = u.total
        ? narrow.reduce((s, [id, n]) => languages[id].other ? s + n : s, 0) / u.total
        : 0

    const eb = entropy(broad), en = entropy(narrow)
    return {
        rankBroad: rank(broad), rankNarrow: rank(narrow),
        nBroad: broad.length, nNarrow: narrow.length,
        // A unit with no narrow breakdown (Pakistan, Nepal, Bangladesh) reports the
        // same figure for both, so "erasure" is 0 rather than a phantom -bits.
        entropyBroad: broad.length ? eb : en,
        entropyNarrow: narrow.length ? en : eb,
        otherShare,
    }
}

// Per-unit stats (ranking, entropy) are computed after the folding pass below, once every
// aside has all the people that belong to it.
//
// Language totals are computed further down too, once we know which units have a polygon —
// they have to count exactly the people the map can show, or the legend won't reconcile
// with the map underneath it.

// ---------------------------------------------------------------- geometry

const round = x => Math.round(x * 10 ** COORD_DECIMALS) / 10 ** COORD_DECIMALS

function cleanRing(ring) {
    const out = []
    for (const [x, y] of ring) {
        const p = [round(x), round(y)]
        const last = out[out.length - 1]
        if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p)
    }
    // re-close
    const [a, b] = [out[0], out[out.length - 1]]
    if (a && b && (a[0] !== b[0] || a[1] !== b[1])) out.push([a[0], a[1]])
    return out.length >= 4 ? out : null
}

const area = ring => {
    let s = 0
    for (let i = 0, n = ring.length - 1; i < n; i++)
        s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
    return s / 2
}

// d3-geo reads ring winding to decide inside from outside, and it wants the opposite of
// what RFC 7946 asks for: exteriors clockwise, holes counter-clockwise. Get it backwards
// and the "inside" becomes the rest of the planet, which paints over the whole map.
// The source shapefiles are inconsistent, so normalise every ring.
function fixPolygon(rings) {
    const out = []
    for (let i = 0; i < rings.length; i++) {
        const ring = cleanRing(rings[i])
        if (!ring) continue
        const wantClockwise = i === 0
        if ((area(ring) > 0) === wantClockwise) ring.reverse()
        out.push(ring)
    }
    return out.length && out[0].length ? out : null
}

function cleanGeometry(geom) {
    if (!geom) return null
    if (geom.type === 'Polygon') {
        const rings = fixPolygon(geom.coordinates)
        return rings ? { type: 'Polygon', coordinates: rings } : null
    }
    if (geom.type === 'MultiPolygon') {
        const polys = geom.coordinates.map(fixPolygon).filter(Boolean)
        return polys.length ? { type: 'MultiPolygon', coordinates: polys } : null
    }
    return null
}

const features = []
const geoIds = new Set()

function pushFeature(id, props, geom) {
    const g = cleanGeometry(geom)
    if (!g) return
    geoIds.add(id)
    features.push({ type: 'Feature', properties: { id, ...props }, geometry: g })
}

for (const f of readJSON('india-5.json').features) {
    const p = f.properties
    if (!p.sdtcode11) continue
    const censusDistrict = DISTRICT_OF_SUB.get(p.sdtcode11)
    if (censusDistrict && COARSE_DISTRICTS.has(censusDistrict)) {
        pushFeature('D' + censusDistrict, {
            name: p.dtname, state: titleCase(p.stname), country: 'IN',
        }, f.geometry)
    } else {
        const id = p.stname === 'ASSAM' ? p.dtcode11 + p.sdtcode11 : p.sdtcode11
        pushFeature(id, {
            name: p.sdtname, district: p.dtname, state: titleCase(p.stname), country: 'IN',
        }, f.geometry)
    }
}

for (const f of readJSON('pakistan-2017.geojson').features) {
    const shape = f.properties.shapeName.toUpperCase()
    pushFeature(PK_POLYGON_UNIT.get(shape) ?? shape, {
        name: titleCase(f.properties.shapeName), country: 'PK',
    }, f.geometry)
}

for (const f of readJSON('nepal.geojson').features)
    pushFeature(f.properties.DISTRICT + '_NEPAL', {
        name: titleCase(f.properties.DISTRICT), country: 'NP',
    }, f.geometry)

for (const f of readJSON('bangladesh.json').features)
    pushFeature('BANGLADESH', { name: 'Bangladesh', country: 'BD' }, f.geometry)

// The Indian tables identify units by code, not name, so take their names from the
// shapefile. Units that named themselves (Pakistan, Nepal, Bangladesh) keep theirs.
for (const f of features) {
    const u = units[f.properties.id]
    if (!u || u.name) continue
    u.name = f.properties.name
    u.district = f.properties.district
    u.state = f.properties.state
}

// ---------------------------------------------------------------- fold orphans into asides

// A unit with no polygon can't be drawn, but its people needn't vanish. If its district has
// at least one unit that IS drawn, fold it into that district's aside — the extra table the
// tooltip already shows for municipal areas the census keeps outside any sub-district. This
// covers sub-districts the shapefile is missing (Budaun, Shimla city) and the new Pakistani
// tehsils that predate the shapefile (Lahore's Model Town). A unit whose whole district is
// undrawable (the FATA Frontier Regions) has nowhere to attach and stays a true orphan.
const drawnDistricts = new Set()
for (const [id, u] of Object.entries(units))
    if (geoIds.has(id) && u.dtKey) drawnDistricts.add(u.dtKey)

// Some orphans can be placed: gadm's sub-district geometry gives them a location, and the
// nearest drawn tehsil is recorded in the crosswalk. Those attach to that one tehsil (shown
// only in its tooltip) instead of the whole district. The rest — no location we trust —
// stay a district-level aside shown in every sibling.
const ORPHAN_NEAREST = new Map(
    readObjects('crosswalk/india_orphan_nearest.csv').map(r => [r.orphan_code, r.nearest_unit_id])
)

let folded = 0, foldedPop = 0
for (const [id, u] of Object.entries(units)) {
    if (geoIds.has(id) || u.aside || !u.dtKey) continue // drawn, already an aside, or unfoldable
    if (!drawnDistricts.has(u.dtKey)) continue           // no drawn sibling to attach to

    const near = ORPHAN_NEAREST.get(id)
    if (near && geoIds.has(near)) {
        // a placed orphan: its own aside, attached to the single nearest drawn tehsil
        const okey = 'O:' + id
        units[okey] = { country: u.country, aside: true, name: u.censusName, total: u.total, langs: u.langs }
        ;(units[near].extras ??= []).push(okey)
        folded++; foldedPop += u.total
        delete units[id]
        continue
    }

    const akey = 'A:' + u.dtKey
    const a = units[akey] ?? (units[akey] = {
        country: u.country, aside: true, dtKey: u.dtKey, total: 0, langs: {},
    })
    for (const [lid, n] of Object.entries(u.langs)) a.langs[lid] = (a.langs[lid] || 0) + n
    a.total += u.total
    folded++
    foldedPop += u.total
    delete units[id] // subsumed by the aside; no longer a standalone orphan
}

for (const u of Object.values(units)) Object.assign(u, stats(u))

// ---------------------------------------------------------------- language totals

// Count only units the map can actually show: those with a polygon, plus the municipal
// areas the tooltip reports. The sub-districts with no polygon at all are excluded, so
// every number in the legend adds up to something a reader can find on the map.
for (const [unitId, u] of Object.entries(units)) {
    if (!geoIds.has(unitId) && !u.aside) continue
    for (const [id, n] of Object.entries(u.langs))
        languages[id].total = (languages[id].total || 0) + n
}

// ---------------------------------------------------------------- validate

const COUNTRY = { IN: 'India', PK: 'Pakistan', NP: 'Nepal', BD: 'Bangladesh' }
const byCountry = {}
for (const f of features) {
    const c = f.properties.country
    byCountry[c] ??= { polys: 0, matched: 0, unmatched: [] }
    byCountry[c].polys++
    if (units[f.properties.id]) byCountry[c].matched++
    else byCountry[c].unmatched.push(`${f.properties.id} (${f.properties.name})`)
}

const orphans = Object.keys(units).filter(id => !geoIds.has(id) && !units[id].aside)
const asideUnits = Object.values(units).filter(u => u.aside)

console.log(`\nlanguages: ${Object.keys(languages).length}  units: ${Object.keys(units).length}  polygons: ${features.length}  (${indiaRows.toLocaleString()} Indian census rows)`)
console.log('\njoin report — polygons matched to a census unit:')
let worst = 0
for (const [c, s] of Object.entries(byCountry)) {
    const pct = (100 * s.matched / s.polys)
    worst = Math.max(worst, s.polys - s.matched)
    console.log(`  ${COUNTRY[c].padEnd(11)} ${String(s.matched).padStart(5)}/${String(s.polys).padEnd(5)} ${pct.toFixed(1).padStart(5)}%`)
    for (const u of s.unmatched.slice(0, 15)) console.log(`      unmatched polygon: ${u}`)
    if (s.unmatched.length > 15) console.log(`      ... and ${s.unmatched.length - 15} more`)
}
const mapped = Object.entries(units).filter(([id]) => geoIds.has(id) && !units[id].aside)
const people = xs => xs.reduce((s, [, u]) => s + u.total, 0)
const lost = people(orphans.map(id => [id, units[id]]))
console.log(`\npopulation on the map: ${people(mapped).toLocaleString()}`)
if (asideUnits.length)
    console.log(`  ${asideUnits.length} districts have no-polygon population (municipal areas, missing tehsils, folded orphans) — ${asideUnits.reduce((s, u) => s + u.total, 0).toLocaleString()} people — shown in the tooltip of a drawn sibling (${folded} orphan units folded in)`)
if (orphans.length) {
    console.log(`  ${orphans.length} census units have no polygon and no drawn sibling — ${lost.toLocaleString()} people are on no map:`)
    for (const id of orphans.sort((a, b) => units[b].total - units[a].total)) {
        const u = units[id]
        const label = [u.censusName || u.name, u.censusState || u.state].filter(Boolean).join(', ')
        console.log(`      ${id.padEnd(10)} ${u.total.toLocaleString().padStart(11)}  ${label}`)
    }
}
const coarse = mapped.filter(([, u]) => u.coarse)
if (coarse.length) {
    console.log(`  ${coarse.length} districts drawn at district level, not sub-district — ${people(coarse).toLocaleString()} people:`)
    const why = {}
    for (const [id] of coarse) {
        const reason = COARSE_REASON.get(id.replace(/^D/, '')) ?? COARSE_REASON.get(id)
        why[reason] = (why[reason] || 0) + 1
    }
    for (const [reason, n] of Object.entries(why)) console.log(`      ${n} because ${reason}`)
}
if (unmappedFamilies.size)
    console.log(`\n  languages with no family in crosswalk/language_families.csv: ${[...unmappedFamilies].join(', ')}`)

// ---------------------------------------------------------------- write

mkdirSync('dist', { recursive: true })

const compact = {}
for (const [id, u] of Object.entries(units)) {
    if (!geoIds.has(id) || u.aside) continue // no polygon, nothing to draw
    compact[id] = {
        n: u.name, d: u.district, s: u.state, c: u.country, t: u.total, L: u.langs,
        eb: +u.entropyBroad.toFixed(4), en: +u.entropyNarrow.toFixed(4),
        kb: u.nBroad, kn: u.nNarrow, o: +u.otherShare.toFixed(5),
        rb: u.rankBroad.slice(0, 8), rn: u.rankNarrow.slice(0, 8),
        x: u.coarse ? 1 : undefined, // district-level, no sub-district breakdown
        // the district's people on no polygon (municipal areas, tehsils the shapefile lacks)
        a: u.dtKey && units['A:' + u.dtKey] ? 'A:' + u.dtKey : undefined,
        // orphan sub-districts placed here as their nearest drawn tehsil
        e: u.extras,
    }
}

// Not drawn — nothing in the shapefile is their shape — but shown in a tooltip: the shared
// district aside in every sibling, a placed orphan only in its nearest tehsil.
const asides = {}
for (const [id, u] of Object.entries(units)) {
    if (!u.aside) continue
    asides[id] = {
        t: u.total, L: u.langs, rb: u.rankBroad.slice(0, 5), rn: u.rankNarrow.slice(0, 5),
        n: u.name, // present only for a placed orphan (its census name)
    }
}

writeFileSync('dist/data.json', JSON.stringify({ languages, units: compact, asides }))
writeFileSync('dist/map.json', JSON.stringify({ type: 'FeatureCollection', features }))

const mb = p => (statSync(p).size / 1e6).toFixed(1) + ' MB'
console.log(`\nwrote dist/data.json (${mb('dist/data.json')})  dist/map.json (${mb('dist/map.json')})\n`)
