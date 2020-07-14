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

var colour = d3.scaleLinear()
    .domain([0, 1])
    .range(["#eeeeee", "#d82520"])

function load(files) {
    var population = files[0]
    var map = files[1]
    for (var i = 0; i < map.features.length; i++) {
        console.log(i)
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

    var sorted = {}

    for (code in data) {
        sorted[code] = Object.keys(data[code]).sort(
            function(a, b) {
                return data[code][b] - data[code][a]
            }
        )
        sorted[code].shift()
    }
    console.log(langs)
    dropdown.append("option")
        .text("All (broad)")
    dropdown.append("option")
        .text("All (narrow)")

    for (key in langs) {
        if (key != "") dropdown.append("option")
            .text(key)
    }
    
    console.log(data)
    var g = d3.select("#map")
        .append("g")
    
    container.call(d3.zoom().on("zoom", function () {
            g.attr("transform", d3.event.transform)
        })
        .on("start", function() {
            g.selectAll("path")
                .attr("stroke-width", "0px")
        })
        .on("end", function() {
            g.selectAll("path")
                .attr("stroke-width", "0.5px")
        }))

    var lang = ""

    dropdown.on("change", function(d) {
        console.log(this.value)
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
        .attr("stroke", "black")
        .attr("stroke-width", "1px")
        .on("mousemove", function (d) {
            tooltip
                .style("left", (d3.event.pageX + 15) + "px")
                .style("top", (d3.event.pageY - 28) + "px")
        })
        .on("mouseout", function (d) {
            tooltip.transition()
                .duration(250)
                .style("opacity", 0)
        })

    function reformat(fill, text) {
        g.selectAll("path")
            .attr("fill", d => {
                var code = d.properties.censuscode
                if (!code || fill(code) == undefined) return colour(0)
                return fill(code)
            })
            .attr("stroke", d => {
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
    
    function update(lang) {
        if (lang == "" || lang == "All (broad)") {
            reformat(function(c) {
                return stringToColour(sorted[c][0])
            }, function(c) {
                var langs = sorted[c].filter(d => {
                    return (d[0] <= "9" && d[0] >= "0" && !(d.endsWith("OTHER")))
                })
                console.log(sorted[c], langs)
                var ret = "<table class=\"table table-striped table-sm\">"
                langs.forEach((d, i) => {
                    if (i >= 5) return
                    ret += "<tr><td>" + d + "</td><td>" + data[c][d].toLocaleString('en-US') + "</tr>"
                })
                ret += "</table>"
                return ret
            })
        }
        else if (lang == "All (narrow)") {
            reformat(function(c) {
                var maxlang = undefined
                for (var i = 0; i < sorted[c].length; i++) {
                    if (sorted[c][i][0] <= "9" && sorted[c][i][0] >= "0") continue
                    maxlang = sorted[c][i]
                    break
                }
                return stringToColour(maxlang)
            }, function(c) {
                var langs = sorted[c].filter(d => {
                    return (!(d[0] <= "9" && d[0] >= "0") && d != "total" && !(d.endsWith("OTHER")))
                })
                var ret = "<table class=\"table table-striped table-sm\">"
                langs.forEach((d, i) => {
                    if (i >= 5) return
                    ret += "<tr><td>" + d + "</td><td>" + data[c][d].toLocaleString('en-US') + "</tr>"
                })
                ret += "</table>"
                return ret
            })
        }
        else {
            reformat(function(c) {
                return colour(data[c][lang] / population[c])
            }, function(c) {
                return data[c][lang].toLocaleString('en-US') + " speakers (" +
                (data[c][lang] / population[c]).toLocaleString(undefined, {style: 'percent', minimumFractionDigits:2}) + ")"
            })
        }
    }
}
