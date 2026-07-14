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
    dots: false,
}

function readHash() {
    const p = new URLSearchParams(location.hash.slice(1))
    if (p.has('lang')) state.lang = p.get('lang')
    if (p.has('view')) state.view = p.get('view')
    state.dots = p.get('dots') === '1'
}

function writeHash() {
    const p = new URLSearchParams()
    if (state.lang) p.set('lang', state.lang)
    else p.set('view', state.view)
    if (state.dots) p.set('dots', '1')
    history.replaceState(null, '', '#' + p)
}

// ---------------------------------------------------------------- chrome

const svg = d3.select('#map')
const zoomLayer = svg.append('g')
const land = zoomLayer.append('g').attr('id', 'land')
const dotLayer = zoomLayer.append('g').attr('id', 'dots')
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

    function show(id, isPinned) {
        const html = describe(id, isPinned)
        if (!html) return false
        tooltip.classed('pinned', !!isPinned).html(html).style('opacity', 1)
        sizeLists()
        if (isPinned) tooltip.select('.close').on('click', unpin)
        return true
    }

    // Clicking a unit pins its tooltip, which is the only way to reach the parts of it that
    // don't fit: a hovering tooltip can't take the pointer without stealing it from the map.
    let pinned = null

    function highlight(id, on) {
        d3.selectAll(nodesOf.get(id) || []).classed('hover', on)
        if (on) d3.selectAll(nodesOf.get(id) || []).raise()
    }

    function unpin() {
        if (!pinned) return
        highlight(pinned, false)
        pinned = null
        tooltip.classed('pinned', false).style('opacity', 0)
    }

    function pin(id) {
        if (pinned && pinned !== id) highlight(pinned, false)
        if (!show(id, true)) return unpin()
        pinned = id
        highlight(id, true)
        place()
    }

    paths
        .on('mouseover', d => {
            const id = d.properties.id
            if (pinned) return // a pinned tooltip stays put until you dismiss it
            highlight(id, true)
            if (show(id, false)) place()
        })
        .on('mousemove', () => { if (!pinned) place() })
        .on('mouseout', d => {
            if (pinned) return
            highlight(d.properties.id, false)
            tooltip.style('opacity', 0)
        })
        .on('click', d => {
            d3.event.stopPropagation()
            pin(d.properties.id)
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

    function describe(id, isPinned) {
        const u = units[id]
        if (!u) return null
        const kind = currentKind()
        const rank = rankAll(u.L, kind)
        const where = [u.d, u.s].filter(Boolean).join(', ')
        const bits = (kind === 'broad' ? u.eb : u.en).toFixed(2)
        const noun = kind === 'broad' ? 'languages' : 'mother tongues'

        // The census reports some of this district's people — a municipal corporation —
        // outside any sub-district, so they are on no polygon anywhere. Show them next to
        // the tehsil rather than letting them vanish.
        const a = u.a && asides[u.a]
        const aRank = a ? rankAll(a.L, kind) : []

        return `${isPinned ? '<button class="close" title="Close (Esc)">&times;</button>' : ''}
            <h2>${u.n}</h2>
            ${where ? `<div class="where">${where}</div>` : ''}
            <div class="where">${fmt(u.t)} people · ${rank.length} ${noun} · ${bits} bits of diversity</div>
            <div class="split">
                ${ring(rank, u.L, u.t)}
                <div class="grow scroll">${table(rank, u.L, u.t)}</div>
            </div>
            ${u.x ? '<div class="note">Shown at district level: the census gives no usable sub-district breakdown here.</div>' : ''}
            ${a ? `<div class="aside">
                <div class="where">Plus ${fmt(a.t)} people in ${u.d || 'this'} district that the census
                    places in no sub-district (its towns), and so are on no polygon:</div>
                <div class="split">
                    ${ring(aRank, a.L, a.t, 20)}
                    <div class="grow scroll short">${table(aRank, a.L, a.t)}</div>
                </div>
            </div>` : ''}
            ${isPinned ? '' : '<div class="hint">Click to pin and scroll</div>'}`
    }

    // ------------------------------------------------------------ views

    const currentKind = () =>
        state.lang ? languages[state.lang].kind
            : state.view.endsWith('.n') ? 'narrow' : 'broad'

    // Each view returns {fill, legend}. fill(unit) -> colour or null for "no data".
    function layer() {
        if (state.lang) {
            const l = languages[state.lang]
            const max = d3.max(Object.values(units), u => (u.L[state.lang] || 0) / (u.t || 1)) || 1
            return {
                categorical: false,
                fill: u => (u.t ? RAMP(0.08 + 0.92 * ((u.L[state.lang] || 0) / u.t) / max) : null),
                legend: { title: `${l.name} as a share of the population`, lo: '0%', hi: pct(max) },
                langs: u => (u.L[state.lang] ? [state.lang] : []),
            }
        }

        const [kind, which] = [currentKind(), state.view.split('.')[0]]
        const rankOf = u => (kind === 'broad' ? u.rb : u.rn)
        const nth = { top1: 0, top2: 1, top3: 2 }[which]

        if (nth !== undefined) return {
            categorical: true,
            fill: u => colorOf(rankOf(u)[nth]),
            pick: u => rankOf(u)[nth],
            langs: u => Object.keys(u.L).filter(id => languages[id].kind === kind),
        }

        const ramp = (value, max, lo, hi, title) => ({
            categorical: false,
            fill: u => (u.t ? RAMP(0.08 + 0.92 * Math.min(1, value(u) / max)) : null),
            legend: { title, lo, hi },
            langs: u => Object.keys(u.L).filter(id => languages[id].kind === kind),
        })

        if (which === 'count') {
            const max = d3.max(Object.values(units), u => (kind === 'broad' ? u.kb : u.kn))
            return ramp(u => (kind === 'broad' ? u.kb : u.kn), max, '0', String(max),
                kind === 'broad' ? 'Languages spoken' : 'Mother tongues spoken')
        }
        if (which === 'entropy')
            return ramp(u => (kind === 'broad' ? u.eb : u.en), 4, '0 bits', '4 bits',
                'Shannon diversity of the language distribution')
        if (which === 'erasure')
            return ramp(u => u.en - u.eb, 2.5, '0 bits', '2.5 bits',
                'Diversity that disappears when mother tongues are grouped into languages')
        return ramp(u => u.o, 1, '0%', '100%',
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
                    s.covers += u.t
                }
            }
            const speakers = id => languages[id].total || 0
            const rows = [...seen].sort((a, b) => b[1].covers - a[1].covers)

            // The whole map in one ring: every language of this kind, by speakers.
            const world = Object.keys(languages)
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

    // Where can a dot go? Rasterise every polygon once into an offscreen canvas, each
    // filled with its own index as a colour, and keep the pixels each unit owns. Sampling
    // a pixel uniformly is then automatically area-weighted, and costs nothing.
    //
    // The alternative — throwing random points at a polygon until one lands inside — pays
    // a point-in-polygon test per attempt against geometry with thousands of vertices.
    // That took 37 seconds for the whole map. This takes about half of one.
    let pixelsOf = null // unit id -> Int32Array of packed y*width+x
    let pixelsFor = 0   // the projection these were computed against

    function samplePixels() {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        const draw = d3.geoPath().projection(projection).context(ctx)

        map.features.forEach((f, i) => {
            ctx.beginPath()
            draw(f)
            // index+1 as a 24-bit colour, so pixel colour identifies the polygon
            ctx.fillStyle = '#' + (i + 1).toString(16).padStart(6, '0')
            ctx.fill()
        })

        const px = ctx.getImageData(0, 0, width, height).data
        const at = p => (px[p * 4] << 16) | (px[p * 4 + 1] << 8) | px[p * 4 + 2]

        const buckets = new Map()
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const p = y * width + x
                const v = at(p)
                if (!v || v > map.features.length) continue
                // Anti-aliased edge pixels blend two polygons' colours into a third
                // polygon's index. Keep only pixels whose neighbours agree.
                if (at(p - 1) !== v || at(p + 1) !== v || at(p - width) !== v || at(p + width) !== v) continue
                const id = map.features[v - 1].properties.id
                if (!buckets.has(id)) buckets.set(id, [])
                buckets.get(id).push(p)
            }
        }
        for (const [id, list] of buckets) buckets.set(id, Int32Array.from(list))
        pixelsOf = buckets
        pixelsFor = projection.scale()
    }

    // A unit too small to own a whole pixel still gets its dots, at its centroid.
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
            const pool = pixelsOf.get(ids[i])
            const centre = centroidOf.get(ids[i])
            if (!pool && !centre) continue

            for (const id of spec.langs(u)) {
                let n = Math.round(u.L[id] / DOT_POP)
                if (!n) continue
                total += n
                let d = byLang.get(id) || ''
                while (n--) {
                    let x, y
                    if (pool && pool.length) {
                        const p = pool[(Math.random() * pool.length) | 0]
                        x = (p % width) + Math.random()
                        y = ((p / width) | 0) + Math.random()
                    } else {
                        [x, y] = centre
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
    if (state.lang) {
        const opt = langOptions.find(o => o.id === state.lang)
        if (opt) d3.select('#lang').property('value', opt.label)
    }
    viewSelect.property('value', state.lang ? SINGLE : state.view)
    render()
}

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)) }
