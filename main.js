// Languages of South Asia. Reads the artefacts built by build.mjs:
//   dist/map.json   merged geometry, one feature per census unit
//   dist/data.json  language counts and derived stats per unit
// Everything about joining census rows to polygons lives in build.mjs; this file draws.

const DOT_POP = 100000 // one dot per this many speakers
const SINGLE = '__single__' // the "Show" value used while a single language is picked

const VIEWS = [
    { id: 'top1.b', label: 'Largest language' },
    { id: 'top1.n', label: 'Largest mother tongue' },
    { id: 'top2.b', label: 'Second largest language' },
    { id: 'top2.n', label: 'Second largest mother tongue' },
    { id: 'top3.b', label: 'Third largest language' },
    { id: 'top3.n', label: 'Third largest mother tongue' },
    { id: 'count.b', label: 'Number of languages spoken' },
    { id: 'count.n', label: 'Number of mother tongues spoken' },
    { id: 'entropy.b', label: 'Diversity, by language (bits)' },
    { id: 'entropy.n', label: 'Diversity, by mother tongue (bits)' },
    { id: 'erasure', label: 'Diversity lost to grouping (mother tongue − language)' },
    { id: 'other', label: 'Share counted only as "other"' },
]

// The census sorts mother tongues into ~120 broad languages; those are what "language"
// means here, and "mother tongue" is the finer level underneath (Bhojpuri under Hindi).
const FAMILY_COLOR = {
    'Indo-Aryan': '#3f6bb0',
    'Dravidian': '#d98032',
    'Sino-Tibetan': '#3f9a68',
    'Austroasiatic': '#c0504d',
    'Iranian': '#8067b7',
    'Kra-Dai': '#b8a13a',
    'Semitic': '#c86fa8',
    'Germanic': '#8a7059',
    'Other': '#9a9a9a',
}
const css = v => getComputedStyle(document.body).getPropertyValue(v).trim()
const NO_DATA = css('--nodata') || '#e8e8e6'
const LAND = css('--land') || '#dcdcd6'
const RAMP = d3.interpolateYlGnBu

// ---------------------------------------------------------------- state

const state = {
    view: 'top1.b',
    lang: null,   // a language id; overrides view when set
    pop: 'total', // total | urban | rural
    dots: false,
}

function readHash() {
    const p = new URLSearchParams(location.hash.slice(1))
    if (p.has('lang')) state.lang = p.get('lang')
    if (p.has('view')) state.view = p.get('view')
    if (['urban', 'rural'].includes(p.get('pop'))) state.pop = p.get('pop')
    state.dots = p.get('dots') === '1'
}

function writeHash() {
    const p = new URLSearchParams()
    if (state.lang) p.set('lang', state.lang)
    else p.set('view', state.view)
    if (state.pop !== 'total') p.set('pop', state.pop)
    if (state.dots) p.set('dots', '1')
    history.replaceState(null, '', '#' + p)
}

// ---------------------------------------------------------------- chrome

const svg = d3.select('#map')
const zoomLayer = svg.append('g')
const land = zoomLayer.append('g').attr('id', 'land')
const dotLayer = zoomLayer.append('g').attr('id', 'dot-layer')
const tooltip = d3.select('body').append('div').attr('class', 'tooltip')
const status = d3.select('#status')
const legend = d3.select('#legend')

let width = window.innerWidth, height = window.innerHeight
const projection = d3.geoMercator().rotate([-78.9629, -20.5937, 0])
const path = d3.geoPath().projection(projection)

function fit(features) {
    width = window.innerWidth
    height = window.innerHeight
    svg.attr('width', width).attr('height', height)
    projection.fitExtent([[10, 10], [width - 10, height - 10]], { type: 'FeatureCollection', features })
}

svg.call(d3.zoom().scaleExtent([1, 60]).on('zoom', () => zoomLayer.attr('transform', d3.event.transform)))

// ---------------------------------------------------------------- load

Promise.all([d3.json('dist/map.json'), d3.json('dist/data.json')])
    .then(([map, data]) => start(map, data))
    .catch(err => {
        status.text('Could not load the map data. Run `node build.mjs` to generate dist/.')
        console.error(err)
    })

function start(map, { languages, units, asides }) {
    // ------------------------------------------------------------ palette

    // Hue carries the family, lightness separates languages within it, biggest first.
    // Colour is the only thing distinguishing ~40 languages on the "largest" views, so
    // a hash of the name (which is what this used to be) throws away the one signal a
    // reader can actually use.
    // Walking lightness up and down from the base runs out of room fast: past the sixth
    // language in a family everything clamps to white or near-black, which is how Punjabi
    // ended up the same colour as a dozen languages it sits next to. Vary lightness, hue
    // and chroma together instead, on a cycle that never reaches either extreme.
    const VARIANTS = [
        { l: 0, h: 0, c: 1.00 },
        { l: +18, h: +10, c: 0.80 },
        { l: -15, h: -11, c: 0.95 },
        { l: +9, h: -19, c: 0.55 },
        { l: -7, h: +19, c: 0.62 },
        { l: +24, h: -5, c: 0.42 },
        { l: -19, h: +6, c: 0.72 },
        { l: +13, h: +23, c: 1.00 },
    ]
    const shade = {}
    for (const kind of ['broad', 'narrow']) {
        const byFamily = {}
        Object.entries(languages)
            .filter(([, l]) => l.kind === kind)
            .sort((a, b) => (b[1].total || 0) - (a[1].total || 0))
            .forEach(([id, l]) => (byFamily[l.family] ??= []).push(id))
        for (const [family, ids] of Object.entries(byFamily)) {
            const base = d3.hcl(FAMILY_COLOR[family] || FAMILY_COLOR.Other)
            ids.forEach((id, i) => {
                const v = VARIANTS[i % VARIANTS.length]
                const lap = Math.floor(i / VARIANTS.length) // second time round, nudge again
                shade[id] = d3.hcl(
                    base.h + v.h + lap * 7,
                    base.c * v.c * (lap ? 0.75 : 1),
                    clamp(base.l + v.l + lap * 5, 30, 80),
                ) + ''
            })
        }
    }
    const colorOf = id => (id && shade[id]) || NO_DATA

    // ------------------------------------------------------------ controls

    const viewSelect = d3.select('#view')
    // Shown only while a single language is selected, so the dropdown never claims to be
    // displaying a view that the language search has overridden.
    viewSelect.append('option')
        .attr('value', SINGLE).attr('disabled', '').attr('hidden', '')
        .text('Single language (below)')
    viewSelect.selectAll('option.view').data(VIEWS).enter().append('option')
        .attr('class', 'view').attr('value', d => d.id).text(d => d.label)

    // A searchable list beats a 600-entry <select> you have to scroll.
    const langOptions = Object.entries(languages)
        .filter(([, l]) => l.total > 0)
        .sort((a, b) => b[1].total - a[1].total)
        .map(([id, l]) => ({
            id,
            label: `${l.name} — ${l.family}${l.kind === 'broad' ? '' : ', mother tongue'}`,
        }))
    const idByLabel = new Map(langOptions.map(o => [o.label, o.id]))
    d3.select('#langlist').selectAll('option').data(langOptions).enter()
        .append('option').attr('value', d => d.label)

    viewSelect.on('change', function () {
        state.view = this.value
        state.lang = null
        d3.select('#lang').property('value', '')
        render()
    })
    d3.select('#lang').on('change', function () {
        state.lang = idByLabel.get(this.value) || null
        viewSelect.property('value', state.lang ? SINGLE : state.view)
        render()
    })
    d3.select('#pop').on('change', function () {
        state.pop = this.value
        render()
    })
    d3.select('#dots').on('change', function () {
        state.dots = this.checked
        render()
    })

    // ------------------------------------------------------------ map

    fit(map.features)

    const paths = land.selectAll('path').data(map.features).enter().append('path')
        .attr('d', path)
        .attr('stroke', 'none')

    // One unit can own several polygons (a district drawn from its sub-district shapes,
    // an island group). Highlight them together — the old id-based lookup silently
    // missed any name with two spaces in it.
    const nodesOf = new Map()
    paths.each(function (d) {
        const id = d.properties.id
        if (!nodesOf.has(id)) nodesOf.set(id, [])
        nodesOf.get(id).push(this)
    })

    function place() {
        const [x, y] = [d3.event.pageX, d3.event.pageY]
        const box = tooltip.node().getBoundingClientRect()
        tooltip
            .style('left', Math.max(8, Math.min(x + 16, window.innerWidth - box.width - 8)) + 'px')
            .style('top', Math.max(8, Math.min(y - 20, window.innerHeight - box.height - 8)) + 'px')
    }

    // Show exactly N rows and scroll the rest. Rows wrap to different heights, so the only
    // way to land on a whole number of them is to measure.
    const VISIBLE_ROWS = 5, VISIBLE_ROWS_ASIDE = 3
    function sizeLists() {
        tooltip.selectAll('.scroll').each(function () {
            const n = this.classList.contains('short') ? VISIBLE_ROWS_ASIDE : VISIBLE_ROWS
            const rows = this.querySelectorAll('tr')
            if (rows.length <= n) { this.style.maxHeight = ''; return }
            let h = 0
            for (let i = 0; i < n; i++) h += rows[i].getBoundingClientRect().height
            this.style.maxHeight = Math.ceil(h) + 'px'
        })
    }

    // A polygon the census doesn't cover (Azad Kashmir, Gilgit-Baltistan) still says what it
    // is and why it's blank, so no shape on the map is silent when hovered.
    function noDataCard(p) {
        const where = [p.district, p.state].filter(Boolean).join(', ')
        return `<h2>${p.name || 'Unmapped area'}</h2>
            ${where ? `<div class="where">${where}</div>` : ''}
            <div class="note">No census language data — ${p.country === 'PK'
                ? 'Azad Kashmir and Gilgit-Baltistan are outside the 2017 language census.'
                : 'not covered by the census tables used here.'}</div>`
    }

    function show(id, isPinned, props) {
        const html = describe(id, isPinned) || (props && !isPinned ? noDataCard(props) : null)
        if (!html) return false
        tooltip.classed('pinned', !!isPinned).html(html).style('opacity', 1)
        sizeLists()
        if (isPinned) tooltip.select('.close').on('click', unpin)
        return true
    }

    // Clicking a unit pins its tooltip, which is the only way to reach the parts of it that
    // don't fit: a hovering tooltip can't take the pointer without stealing it from the map.
    let pinned = null

    // Exactly one unit carries the highlight at a time. Clearing the previous one by class,
    // not by re-running its mouseout, is what keeps edges from stranding: raising the hovered
    // shape reorders the DOM and the browser then drops the matching mouseout, so a
    // per-shape toggle leaks. This single source of truth can't.
    let hovered = null
    function setHover(id) {
        if (id === hovered) return
        if (hovered) d3.selectAll(nodesOf.get(hovered) || []).classed('hover', false)
        hovered = id || null
        if (hovered) d3.selectAll(nodesOf.get(hovered) || []).classed('hover', true).raise()
    }

    function unpin() {
        if (!pinned) return
        pinned = null
        setHover(null)
        tooltip.classed('pinned', false).style('opacity', 0)
    }

    function pin(id) {
        if (!show(id, true)) return unpin()
        pinned = id
        setHover(id)
        place()
    }

    paths
        .on('mouseover', d => {
            const id = d.properties.id
            if (pinned) return // a pinned tooltip stays put until you dismiss it
            setHover(id)
            if (show(id, false, d.properties)) place()
        })
        .on('mousemove', () => { if (!pinned) place() })
        .on('mouseout', d => {
            if (pinned) return
            // ignore a stale mouseout for a shape we've already left
            if (hovered === d.properties.id) setHover(null)
            tooltip.style('opacity', 0)
        })
        .on('click', d => {
            d3.event.stopPropagation()
            if (units[d.properties.id]) pin(d.properties.id) // only real units can be pinned
        })

    svg.on('click', unpin)
    d3.select(document).on('keydown', () => { if (d3.event.key === 'Escape') unpin() })

    window.addEventListener('resize', () => {
        fit(map.features)
        paths.attr('d', path)
        render() // dot positions are in projected space, so they have to be resampled
    })

    // ------------------------------------------------------------ tooltip

    const fmt = n => (n || 0).toLocaleString('en-US')
    const pct = x => (100 * x).toFixed(x < 0.1 ? 2 : 1) + '%'

    // Every language spoken here, commonest first — not a top-5. The tooltip scrolls.
    const rankAll = (L, kind) => Object.keys(L)
        .filter(id => L[id] > 0 && languages[id].kind === kind)
        .sort((a, b) => L[b] - L[a])

    // A ring of the composition, in the same colours as the map. Past the first handful the
    // slices are too thin to read, so the tail becomes one grey slice — the ring still
    // closes, and still accounts for everyone.
    const RING_SLICES = 6
    function ring(rank, L, total, r = 26, n = RING_SLICES) {
        if (!total) return ''
        const head = rank.slice(0, n)
        const shown = head.reduce((s, id) => s + L[id], 0)
        const slices = head.map(id => [colorOf(id), L[id]])
        if (shown < total) slices.push([NO_DATA, total - shown])

        const arc = d3.arc().innerRadius(r * 0.55).outerRadius(r)
        const pie = d3.pie().sort(null).value(d => d[1])
        return `<svg width="${2 * r}" height="${2 * r}" viewBox="${-r} ${-r} ${2 * r} ${2 * r}">`
            + pie(slices).map(s => `<path d="${arc(s)}" fill="${s.data[0]}"></path>`).join('')
            + '</svg>'
    }

    function table(rank, L, total) {
        return `<table>${rank.map(id => `<tr>
            <td><span class="chip" style="background:${colorOf(id)}"></span>${languages[id].name}</td>
            <td>${fmt(L[id])}</td>
            <td>${pct(L[id] / total)}</td></tr>`).join('')}</table>`
    }

    const popLabel = { total: '', urban: 'urban ', rural: 'rural ' }

    function describe(id, isPinned) {
        const u = units[id]
        if (!u) return null
        const kind = currentKind()
        const where = [u.d, u.s].filter(Boolean).join(', ')
        const noun = (popLabel[state.pop]) + (kind === 'broad' ? 'languages' : 'mother tongues')
        const closeBtn = isPinned ? '<button class="close" title="Close (Esc)">&times;</button>' : ''
        const hint = isPinned ? '' : '<div class="hint">Click to pin and scroll</div>'

        const self = splitL(u)
        if (!self) return `${closeBtn}<h2>${u.n}</h2>
            ${where ? `<div class="where">${where}</div>` : ''}
            <div class="note">The census reports only a total here, no urban/rural split.</div>${hint}`

        const rank = rankAll(self.L, kind)
        const bits = entropyOf(self.L, self.t, kind).toFixed(2)

        // Some people belong here but are on no polygon of their own. A placed orphan is a
        // sub-district the shapefile is missing, shown against the nearest mapped tehsil (this
        // one). The district aside is everyone else with no polygon — municipal areas outside
        // any sub-district, tehsils drawn too new — shared across all the district's tehsils.
        const block = (label, side) => {
            const s = splitL(side)
            if (!s || !s.t) return ''
            const r = rankAll(s.L, kind)
            return `<div class="aside">
                <div class="where">${label(s.t)}</div>
                <div class="split">
                    ${ring(r, s.L, s.t, 20)}
                    <div class="grow scroll short">${table(r, s.L, s.t)}</div>
                </div>
            </div>`
        }
        const extras = (u.e || []).map(aid => block(t =>
            `Plus ${asides[aid].n} (${fmt(t)} ${popLabel[state.pop]}people), which the shapefile is missing —`
            + ' shown here as its nearest mapped tehsil:', asides[aid])).join('')
        const districtAside = u.a ? block(t =>
            `Plus ${fmt(t)} ${popLabel[state.pop]}people elsewhere in ${u.d || 'this'} district`
            + ' with no polygon of their own (towns, or areas the shapefile is missing):', asides[u.a]) : ''

        return `${closeBtn}
            <h2>${u.n}</h2>
            ${where ? `<div class="where">${where}</div>` : ''}
            <div class="where">${fmt(self.t)} ${popLabel[state.pop]}people · ${rank.length} ${noun} · ${bits} bits of diversity</div>
            <div class="split">
                ${ring(rank, self.L, self.t)}
                <div class="grow scroll">${table(rank, self.L, self.t)}</div>
            </div>
            ${u.x ? '<div class="note">Shown at district level: the census gives no usable sub-district breakdown here.</div>' : ''}
            ${extras}${districtAside}
            ${hint}`
    }

    // ------------------------------------------------------------ views

    const currentKind = () =>
        state.lang ? languages[state.lang].kind
            : state.view.endsWith('.n') ? 'narrow' : 'broad'

    // The active population split — total, urban, or rural — as an effective {L, t}. Only
    // India and Pakistan report the split; Nepal and Bangladesh have total only, so an
    // urban or rural view returns null for them and they read as no-data.
    function splitL(o) {
        if (state.pop === 'total') return { L: o.L, t: o.t }
        if (o.tu === undefined) return null
        const Lu = o.Lu || {}
        if (state.pop === 'urban') return { L: Lu, t: o.tu }
        const L = {} // rural = total - urban
        for (const id in o.L) { const r = o.L[id] - (Lu[id] || 0); if (r > 0) L[id] = r }
        return { L, t: o.t - o.tu }
    }

    const entropyOf = (L, t, kind) => {
        if (!t) return 0
        let h = 0
        for (const id in L) { if (languages[id].kind !== kind) continue; const p = L[id] / t; if (p > 0) h -= p * Math.log2(p) }
        return h
    }

    // Per-unit stats for the choropleth. Total uses the values baked in at build time;
    // urban and rural are derived here. Returns null when the unit has no split.
    function statsOf(u) {
        if (state.pop === 'total') return u
        const s = splitL(u)
        if (!s) return null
        const { L, t } = s
        const broad = [], narrow = []
        for (const id in L) { const n = L[id]; if (!n) continue; (languages[id].kind === 'broad' ? broad : narrow).push([id, n]) }
        const rank = xs => xs.sort((a, b) => b[1] - a[1]).map(x => x[0])
        const eb = entropyOf(L, t, 'broad'), en = entropyOf(L, t, 'narrow')
        const o = t ? narrow.reduce((a, [id, n]) => languages[id].other ? a + n : a, 0) / t : 0
        return {
            L, t, rb: rank(broad), rn: rank(narrow), kb: broad.length, kn: narrow.length,
            eb: broad.length ? eb : en, en: narrow.length ? en : eb, o,
        }
    }

    // Each view returns {fill, legend}. fill(unit) -> colour or null for "no data".
    function layer() {
        if (state.lang) {
            const l = languages[state.lang]
            let max = 0
            for (const u of Object.values(units)) { const s = splitL(u); if (!s || !s.t) continue; const p = (s.L[state.lang] || 0) / s.t; if (p > max) max = p }
            max = max || 1
            return {
                categorical: false,
                fill: u => { const s = splitL(u); return (s && s.t) ? RAMP(0.08 + 0.92 * ((s.L[state.lang] || 0) / s.t) / max) : null },
                legend: { title: `${l.name} as a share of the population`, lo: '0%', hi: pct(max) },
                langs: u => { const s = splitL(u); return (s && s.L[state.lang]) ? [state.lang] : [] },
            }
        }

        const [kind, which] = [currentKind(), state.view.split('.')[0]]
        const nth = { top1: 0, top2: 1, top3: 2 }[which]

        if (nth !== undefined) return {
            categorical: true,
            fill: u => { const v = statsOf(u); return v ? colorOf((kind === 'broad' ? v.rb : v.rn)[nth]) : null },
            pick: u => { const v = statsOf(u); return v ? (kind === 'broad' ? v.rb : v.rn)[nth] : null },
            langs: u => { const s = splitL(u); return s ? Object.keys(s.L).filter(id => languages[id].kind === kind) : [] },
        }

        const ramp = (value, max, lo, hi, title) => ({
            categorical: false,
            fill: u => { const v = statsOf(u); return (v && v.t) ? RAMP(0.08 + 0.92 * Math.min(1, value(v) / max)) : null },
            legend: { title, lo, hi },
            langs: u => { const s = splitL(u); return s ? Object.keys(s.L).filter(id => languages[id].kind === kind) : [] },
        })

        if (which === 'count') {
            const max = d3.max(Object.values(units), u => { const v = statsOf(u); return v ? (kind === 'broad' ? v.kb : v.kn) : 0 })
            return ramp(v => (kind === 'broad' ? v.kb : v.kn), max, '0', String(max),
                kind === 'broad' ? 'Languages spoken' : 'Mother tongues spoken')
        }
        if (which === 'entropy')
            return ramp(v => (kind === 'broad' ? v.eb : v.en), 4, '0 bits', '4 bits',
                'Shannon diversity of the language distribution')
        if (which === 'erasure')
            return ramp(v => v.en - v.eb, 2.5, '0 bits', '2.5 bits',
                'Diversity that disappears when mother tongues are grouped into languages')
        return ramp(v => v.o, 1, '0%', '100%',
            'Population whose mother tongue the census records only as "other"')
    }

    // ------------------------------------------------------------ legend

    // 1.6B, not 2B; 529M, not 529.0M
    const short = n => new Intl.NumberFormat('en-US', {
        notation: 'compact', maximumFractionDigits: n >= 1e9 || n < 1e7 ? 1 : 0,
    }).format(n)

    function drawLegend(spec) {
        legend.html('')
        if (spec.categorical) {
            const kind = currentKind()
            // Three different quantities, and they are genuinely different: Telugu is the
            // largest language in more areas than Tamil, those areas hold fewer people, and
            // more people speak Telugu than either count implies.
            //   areas  — how many units carry this colour
            //   covers — how many people live in them
            //   people — how many people speak the language, anywhere on the map
            // All three follow the active total/urban/rural split.
            const speak = new Map() // language id -> speakers under the active split
            const seen = new Map()
            for (const f of map.features) {
                const u = units[f.properties.id]
                if (!u) continue
                const id = spec.pick(u)
                if (!id) continue
                if (!seen.has(id)) seen.set(id, { areas: new Set(), covers: 0 })
                const s = seen.get(id)
                if (!s.areas.has(f.properties.id)) { // one unit, several polygons
                    s.areas.add(f.properties.id)
                    s.covers += splitL(u).t
                }
            }
            // whole-map speaker totals for this split, over the units actually shown
            const counted = new Set()
            for (const f of map.features) {
                const u = units[f.properties.id]
                if (!u || counted.has(f.properties.id)) continue
                counted.add(f.properties.id)
                const sl = splitL(u)
                if (!sl) continue
                for (const id in sl.L) speak.set(id, (speak.get(id) || 0) + sl.L[id])
            }
            const speakers = id => speak.get(id) || 0
            const rows = [...seen].sort((a, b) => speakers(b[0]) - speakers(a[0]))

            // The whole map in one ring: every language of this kind, by speakers.
            const world = [...speak.keys()]
                .filter(id => languages[id].kind === kind && speakers(id) > 0)
                .sort((a, b) => speakers(b) - speakers(a))
            const grand = world.reduce((s, id) => s + speakers(id), 0)
            const L = Object.fromEntries(world.map(id => [id, speakers(id)]))

            const MASTER_SLICES = 10
            const master = legend.append('div').attr('class', 'master')
            master.append('div').attr('class', 'ring').html(ring(world, L, grand, 34, MASTER_SLICES))
            const cap = master.append('div').attr('class', 'grow')
            cap.append('div').attr('class', 'big').text(short(grand) + ' people')
            cap.append('div').attr('class', 'fam')
                .text(`${world.length} ${kind === 'broad' ? 'languages' : 'mother tongues'}, `
                    + `${seen.size} of them largest somewhere. Hue is the family.`)
            // name the ring's slices on hover — an SVG shape needs a <title> child, an
            // attribute does nothing
            master.selectAll('svg path').each(function (_, i) {
                const id = world[i] // past the last slice: the grey remainder
                d3.select(this).append('title').text(id && i < MASTER_SLICES
                    ? `${languages[id].name} — ${fmt(speakers(id))} (${pct(speakers(id) / grand)})`
                    : `everyone else — ${fmt(grand - world.slice(0, MASTER_SLICES).reduce((s, x) => s + speakers(x), 0))}`)
            })

            const rankLabel = { top1: '', top2: 'second ', top3: 'third ' }[state.view.split('.')[0]]
            const where = `where it is the ${rankLabel}largest`
            const head = legend.append('div').attr('class', 'row head')
            head.append('div').attr('class', 'swatch')
            head.append('div').attr('class', 'name').text('Language')
            head.append('div').attr('class', 'num').attr('title', `Areas ${where}`).text('Areas')
            head.append('div').attr('class', 'num')
                .attr('title', `People living in the areas ${where}`).text('Covers')
            head.append('div').attr('class', 'num')
                .attr('title', 'People who speak it, anywhere on the map').text('People')

            const list = legend.append('div').attr('class', 'list')
            for (const [id, s] of rows) {
                const row = list.append('div').attr('class', 'row')
                row.append('div').attr('class', 'swatch').style('background', colorOf(id))
                row.append('div').attr('class', 'name')
                    .attr('title', `${languages[id].name} — ${languages[id].family}`)
                    .text(languages[id].name)
                row.append('div').attr('class', 'num')
                    .attr('title', `${languages[id].name} is the ${rankLabel}largest in ${fmt(s.areas.size)} areas`)
                    .text(s.areas.size.toLocaleString('en-US'))
                row.append('div').attr('class', 'num')
                    .attr('title', `${fmt(s.covers)} people live in those areas`)
                    .text(short(s.covers))
                row.append('div').attr('class', 'num')
                    .attr('title', `${fmt(speakers(id))} people speak ${languages[id].name}`)
                    .text(short(speakers(id)))
            }
            return
        }
        const { title, lo, hi } = spec.legend
        legend.append('div').attr('class', 'fam').text(title)
        const stops = d3.range(0, 1.001, 0.05).map(t => RAMP(0.08 + 0.92 * t)).join(',')
        legend.append('div').attr('class', 'ramp')
            .style('background', `linear-gradient(to right, ${stops})`)
        const ends = legend.append('div').attr('class', 'ends')
        ends.append('span').text(lo)
        ends.append('span').text(hi)
    }

    // ------------------------------------------------------------ dots

    // Where can a dot go? Rasterise every unit once into an offscreen canvas, each filled
    // with its own slot number as a colour, and record the pixels each unit owns. A dot is
    // then a random one of those pixels plus sub-pixel jitter — always inside the polygon,
    // and cheap (no point-in-polygon test against thousands of vertices, which took 37s for
    // the whole map). Supersampling gives even small tehsils enough pixels that their dots
    // spread out instead of piling up; sampling owned pixels directly, rather than
    // rejection-sampling a bounding box, means a thin or scattered unit never loses its dots
    // to a fallback point.
    const SS = 3 // supersample factor for the buffer
    let pixelsOf = null // unit id -> Int32Array of packed y*w+x in supersample space
    let sampleW = 0     // buffer width
    let pixelsFor = 0   // the projection these were computed against

    function samplePixels() {
        const w = Math.round(width * SS), h = Math.round(height * SS)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        const draw = d3.geoPath().projection(projection).context(ctx)

        const slotOf = new Map(), unitOfSlot = [] // one slot per unit, shared by its polygons
        for (const f of map.features)
            if (!slotOf.has(f.properties.id)) { unitOfSlot.push(f.properties.id); slotOf.set(f.properties.id, unitOfSlot.length) }

        ctx.save()
        ctx.scale(SS, SS)
        for (const f of map.features) {
            ctx.beginPath()
            draw(f)
            ctx.fillStyle = '#' + slotOf.get(f.properties.id).toString(16).padStart(6, '0')
            ctx.fill()
        }
        ctx.restore()

        const px = ctx.getImageData(0, 0, w, h).data
        const lists = new Map() // unit id -> number[]
        for (let p = 0; p < w * h; p++) {
            // Interior pixels decode to exactly a slot value; anti-aliased edges blend to
            // some other number and are skipped, which keeps dots off the borders.
            const s = (px[p * 4] << 16) | (px[p * 4 + 1] << 8) | px[p * 4 + 2]
            if (!s || s > unitOfSlot.length) continue
            const id = unitOfSlot[s - 1]
            const list = lists.get(id) ?? (lists.set(id, []).get(id))
            list.push(p)
        }
        pixelsOf = new Map()
        for (const [id, list] of lists) pixelsOf.set(id, Int32Array.from(list))
        sampleW = w
        pixelsFor = projection.scale()
    }

    // A unit too small to own a pixel still gets its dots, at its centroid.
    const centroidOf = new Map()
    for (const f of map.features)
        if (!centroidOf.has(f.properties.id)) centroidOf.set(f.properties.id, path.centroid(f))

    let generation = 0

    async function drawDots(spec) {
        const mine = ++generation
        dotLayer.selectAll('*').remove()
        if (!state.dots) { status.text(''); return }

        if (pixelsFor !== projection.scale()) {
            status.text('Finding where dots can go…')
            await new Promise(r => setTimeout(r, 0))
            if (mine !== generation) return
            samplePixels()
            centroidOf.clear()
            for (const f of map.features)
                if (!centroidOf.has(f.properties.id)) centroidOf.set(f.properties.id, path.centroid(f))
        }

        const w = sampleW
        const byLang = new Map() // language id -> one path 'd' string of many dots
        const ids = Object.keys(units)
        let total = 0

        for (let i = 0; i < ids.length; i++) {
            // Yield rarely: a backgrounded tab clamps setTimeout to once a second, so each
            // of these costs a second when nobody is watching.
            if (i % 2000 === 0) {
                status.text(`Placing dots… ${Math.round(100 * i / ids.length)}%`)
                await new Promise(r => setTimeout(r, 0))
                if (mine !== generation) return // superseded by a newer selection
            }
            const u = units[ids[i]]
            const s = splitL(u) // urban/rural counts, or null where there's no split
            if (!s) continue
            const pool = pixelsOf.get(ids[i])
            const centre = centroidOf.get(ids[i])
            if ((!pool || !pool.length) && !centre) continue

            for (const id of spec.langs(u)) {
                let n = Math.round((s.L[id] || 0) / DOT_POP)
                if (!n) continue
                total += n
                let d = byLang.get(id) || ''
                while (n--) {
                    let x, y
                    if (pool && pool.length) {
                        const p = pool[(Math.random() * pool.length) | 0]
                        x = ((p % w) + Math.random()) / SS
                        y = (((p / w) | 0) + Math.random()) / SS
                    } else {
                        [x, y] = centre // sub-pixel unit
                    }
                    d += `M${x.toFixed(1)} ${y.toFixed(1)}l0 .01`
                }
                byLang.set(id, d)
            }
        }
        if (mine !== generation) return

        dotLayer.selectAll('path').data([...byLang]).enter().append('path')
            .attr('d', d => d[1])
            .attr('stroke', d => (spec.categorical ? colorOf(d[0]) : RAMP(0.85)))
        status.text(`${total.toLocaleString('en-US')} dots · 1 = ${DOT_POP.toLocaleString('en-US')} speakers`)
    }

    // ------------------------------------------------------------ render

    function render() {
        writeHash()
        const spec = layer()
        paths.attr('fill', d => {
            const u = units[d.properties.id]
            return (u && spec.fill(u)) || NO_DATA
        })
        drawLegend(spec)
        // a pinned tooltip lists languages or mother tongues depending on the view
        if (pinned) show(pinned, true)
        if (state.dots) {
            // The dots carry the colour, so the choropleth underneath them becomes a
            // plain basemap — otherwise the two encodings fight each other.
            paths.attr('fill', d => (units[d.properties.id] ? LAND : NO_DATA))
            drawDots(spec)
        } else {
            dotLayer.selectAll('*').remove()
            generation++
            status.text('')
        }
    }

    // ------------------------------------------------------------ go

    readHash()
    if (state.lang && !languages[state.lang]) state.lang = null
    if (!VIEWS.some(v => v.id === state.view)) state.view = 'top1.b'
    d3.select('#dots').property('checked', state.dots)
    d3.select('#pop').property('value', state.pop)
    if (state.lang) {
        const opt = langOptions.find(o => o.id === state.lang)
        if (opt) d3.select('#lang').property('value', opt.label)
    }
    viewSelect.property('value', state.lang ? SINGLE : state.view)
    render()
}

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)) }
