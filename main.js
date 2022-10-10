var width = window.innerWidth, height = window.innerHeight;
var container = d3.select("#map")
    .attr("width", width)
    .attr("height", height)

var projection = d3.geoMercator()
    .rotate([-78.9629, -20.5937, 0])
    .scale(1500)
    .translate([width / 2, height / 2])

var path = d3.geoPath()
    .projection(projection)

var tooltip = d3.select("body").append("div")
    .attr("class", "tooltip")
    .style("opacity", 0)

var indicator = d3.select(".indicator")

var dropdown = indicator.append("div")
    .style("margin", "10px")
    .attr("class", "form-group")

dropdown.append("label")
    .attr("for", "lang")
    .text("Language (Family)")

dropdown = dropdown.append("select")
    .attr("class", "form-control")
    .attr("id", "lang")

Promise.all([
    d3.csv("population.csv"),
    d3.json("2011_Dist (1).json"),
    d3.csv("data/andaman.csv"),
    d3.csv("data/andhra_pradesh.csv"),
    d3.csv("data/arunachal_pradesh.csv"),
    d3.csv("data/assam.csv"),
    d3.csv("data/bihar.csv"),
    d3.csv("data/chandigarh.csv"),
    d3.csv("data/chattisgarh.csv"),
    d3.csv("data/dadra.csv"),
    d3.csv("data/daman.csv"),
    d3.csv("data/delhi.csv"),
    d3.csv("data/goa.csv"),
    d3.csv("data/gujarat.csv"),
    d3.csv("data/haryana.csv"),
    d3.csv("data/himachal.csv"),
    d3.csv("data/jammu.csv"),
    d3.csv("data/jharkhand.csv"),
    d3.csv("data/karnataka.csv"),
    d3.csv("data/kerala.csv"),
    d3.csv("data/lakshadweep.csv"),
    d3.csv("data/madhya_pradesh.csv"),
    d3.csv("data/maharashtra.csv"),
    d3.csv("data/manipur.csv"),
    d3.csv("data/meghalaya.csv"),
    d3.csv("data/mizoram.csv"),
    d3.csv("data/nagaland.csv"),
    d3.csv("data/odisha.csv"),
    d3.csv("data/puducherry.csv"),
    d3.csv("data/punjab.csv"),
    d3.csv("data/rajasthan.csv"),
    d3.csv("data/sikkim.csv"),
    d3.csv("data/tamil_nadu.csv"),
    d3.csv("data/tripura.csv"),
    d3.csv("data/uttar_pradesh.csv"),
    d3.csv("data/uttarakhand.csv"),
    d3.csv("data/west_bengal.csv")
]).then(function (files) {
    load(files)
})

var sc = d3.scaleLinear()
    .interpolate(() => d3.interpolateRdPu)
    // .range(["#eeeeee", "#000", "#d82520"])
var colour = function(x, max=1) {
    // if (x == 0) return "#ffffff"
    return sc.domain([0, max])(x)
}


function load(files) {
    var population = files[0]
    var map = files[1]
    for (var i = 0; i < map.features.length; i++) {
        for (var j = 0; j < map.features[i].geometry.coordinates.length; j++) {
            if (isNaN(d3.polygonArea(map.features[i].geometry.coordinates[j]))) {
                if (d3.polygonArea(map.features[i].geometry.coordinates[j][0]) < 0)
                    map.features[i].geometry.coordinates[j][0] = map.features[i].geometry.coordinates[j][0].reverse()
            }
            else if (d3.polygonArea(map.features[i].geometry.coordinates[j]) < 0) {
                map.features[i].geometry.coordinates[j] = map.features[i].geometry.coordinates[j].reverse()
            }
        }
    }

    population = population.reduce(function(map, obj) {
        if (obj.Level == "DISTRICT" && obj.TRU == "Total") map[parseInt(obj.District)] = parseInt(obj.TOT_P)
        return map
    }, {})

    var data = {}, langs = {}
    for (var i = 2; i < files.length; i++) {
        var data2 = files[i].reduce(function(map, obj) {
            obj["Mother tongue name"] = obj["Mother tongue name"].trim()
            if (!(obj["Mother tongue name"] in langs)) langs[obj["Mother tongue name"]] = true
            if (obj["Sub-"] == "00000") {
                obj.District = parseInt(obj.District)
                if (!(obj.District in map)) {
                    map[obj.District] = {total: 0}
                }
                map[obj.District][obj["Mother tongue name"]] = parseInt(obj["Total"])
                if (obj["Mother tongue name"][0] <= "9" && obj["Mother tongue name"] >= "0") map[obj.District]["total"] += parseInt(obj["Total"])
            }
            return map
        }, {})
        data = {...data, ...data2}
    }

    var entropy = {}
    var entropy_broad = {}
    var sorted = {}
    for (code in data) {
        sorted[code] = Object.keys(data[code]).sort(
            function(a, b) {
                return data[code][b] - data[code][a]
            }
        )
        sorted[code].shift()
        entropy[code] = 0.0
        entropy_broad[code] = 0.0

        console.log(sorted[code])
        sorted[code].forEach(lang => {
            var p = data[code][lang] / population[code]
            if (p != 0) {
                if (lang[0] <= "9" && lang[0] >= "0" && !(lang.includes("Others"))) entropy_broad[code] -= p * Math.log2(p)
                else entropy[code] -= p * Math.log2(p)
            }
        })
    }
    
    dropdown.append("option")
        .text("All (broad)")
    dropdown.append("option")
        .text("All (narrow)")
    dropdown.append("option")
        .text("All (narrow, second-largest)")
    dropdown.append("option")
        .text("All (narrow, third-largest)")
    dropdown.append("option")
        .text("Diversity (broad)")
    dropdown.append("option")
        .text("Diversity (narrow)")
    dropdown.append("option")
        .text("Diversity erasure (narrow - broad)")

    var sorted_langs = Object.keys(langs)
    sorted_langs.sort((a, b) => {
        if (a[0] >= "0" && a[0] <= "9" && b[0] >= "0" && b[0] <= "9") {
            return parseInt(a.split(" ")[0]) - parseInt(b.split(" ")[0])
        }
        else if (a[0] >= "0" && a[0] <= "9") return -1
        else if (b[0] >= "0" && b[0] <= "9") return 1
        else if (a > b) return 1
        else if (b > a) return -1
        else return 0
    })
    for (key in sorted_langs) {
        if (key != "") dropdown.append("option")
            .text(sorted_langs[key])
    }
    
    var g = d3.select("#map")
        .append("g")
    
    container.call(d3.zoom().on("zoom", function () {
            g.attr("transform", d3.event.transform)
        }))

    var lang = ""

    dropdown.on("change", function(d) {
        update(this.value)
    })

    var stringToColour = function(str) {
        try {
            var hash = 0
            for (var i = 0; i < str.length; i++) {
                hash = str.charCodeAt(i) + ((hash << 4) - hash)
            }
            var colour = '#'
            for (var i = 0; i < 3; i++) {
                var value = (hash >> (i * 8)) & 0xFF
                colour += ('00' + value.toString(16)).substr(-2)
            }
            return colour
        }
        catch {
            return colour(0)
        }
    }
    
    g.selectAll("path")
        .data(map.features)
        .enter()
        .append("path")
        .attr("d", d => {
            return path(d)
        })
        .attr("opacity", 1)
        .on("mousemove", function (d) {
            tooltip
                .style("left", (d3.event.pageX + 15) + "px")
                .style("top", (d3.event.pageY - 28) + "px")
            d3.select(this).attr("stroke", "black").raise()
        })
        .on("mouseout", function (d) {
            tooltip.transition()
                .duration(250)
                .style("opacity", 0)
            d3.select(this).attr("stroke", null).lower()
        })

    function reformat(fill, text) {
        g.selectAll("path")
            .attr("fill", d => {
                var code = d.properties.censuscode
                if (!code || fill(code) == undefined) return colour(0)
                return fill(code)
            })
            .on("mouseover", function(d) {
                var code = d.properties.censuscode
                if (!code) return
                tooltip.transition()
                    .duration(250)
                    .style("opacity", 1)
                tooltip.html(
                    "<p><strong>" + d.properties.DISTRICT + ", " + d.properties.ST_NM + "</strong><br>" +
                        (population[code] ? population[code].toLocaleString('en-US') : 0) + " people total<br>" +
                        (text(code) ? text(code) : 0) + "<br>" +
                        "</p>")
                    .style("left", (d3.event.pageX + 15) + "px")
                    .style("top", (d3.event.pageY - 28) + "px")
            })
    }

    update("")

    function table_broad(c) {
        var langs = sorted[c].filter(d => {
            return (d[0] <= "9" && d[0] >= "0" && !d.includes("Others"))
        })
        var ret = (entropy_broad[c].toFixed(2)) + " bits (diversity)<br>" +
            "<table class=\"table table-striped table-sm\">"
        langs.forEach((d, i) => {
            if (i >= 5) return
            ret += "<tr><td>" + d + "</td><td>" + data[c][d].toLocaleString('en-US') + "</td><td>" + (100 * data[c][d] / (population[c] ? population[c] : 1)).toFixed(2) + "%</td></tr>"
        })
        ret += "</table>"
        return ret
    }

    function table_narrow(c) {
        var langs = sorted[c].filter(d => {
            return (!(d[0] <= "9" && d[0] >= "0" && !d.includes("Others")) && d != "total" && !(d.endsWith("OTHER")))
        })
        var ret = (entropy[c].toFixed(2)) + " bits (diversity)<br>" +
            "<table class=\"table table-striped table-sm\">"
        langs.forEach((d, i) => {
            if (i >= 5) return
            ret += "<tr><td>" + d + "</td><td>" + data[c][d].toLocaleString('en-US') + "</td><td>" + (100 * data[c][d] / (population[c] ? population[c] : 1)).toFixed(2) + "%</td></tr>"
        })
        ret += "</table>"
        return ret
    }
    
    function update(lang) {
        if (lang == "" || lang == "All (broad)") {
            reformat(function(c) {
                return stringToColour(sorted[c][0])
            }, table_broad)
        }
        else if (lang == "All (narrow)") {
            reformat(function(c) {
                var langs = sorted[c].filter(d => !(d[0] <= "9" && d[0] >= "0" && !d.includes("Others")) && d != "total" && !(d.endsWith("OTHER")))
                return stringToColour(langs[0])
            }, table_narrow)
        }
        else if (lang == "All (narrow, second-largest)") {
            reformat(function(c) {
                var langs = sorted[c].filter(d => !(d[0] <= "9" && d[0] >= "0" && !d.includes("Others")) && d != "total" && !(d.endsWith("OTHER")))
                return stringToColour(langs[1])
            }, table_narrow)
        }
        else if (lang == "All (narrow, third-largest)") {
            reformat(function(c) {
                var langs = sorted[c].filter(d => !(d[0] <= "9" && d[0] >= "0" && !d.includes("Others")) && d != "total" && !(d.endsWith("OTHER")))
                return stringToColour(langs[2])
            }, table_narrow)
        }
        else if (lang == "Diversity (broad)") {
            reformat(function(c) {
                return colour(entropy_broad[c], 4)
            }, table_broad)
        }
        else if (lang == "Diversity (narrow)") {
            reformat(function(c) {
                return colour(entropy[c], 4)
            }, table_narrow)
        }
        else if (lang == "Diversity erasure (narrow - broad)") {
            reformat(function(c) {
                return colour(entropy[c] - entropy_broad[c], 2.5)
            }, table_narrow)
        }
        else {
            maximum = 0.0
            for (c in population) {
                var p = data[c][lang] / population[c]
                if (p > maximum) maximum = p
            }
            reformat(function(c) {
                return colour(data[c][lang] / population[c], maximum)
            }, function(c) {
                return data[c][lang].toLocaleString('en-US') + " speakers (" +
                (data[c][lang] / population[c]).toLocaleString(undefined, {style: 'percent', minimumFractionDigits:2}) + ")"
            })
        }
    }
}
