// Set up the SVG dimensions and projection
const width = 800;
const height = 600;

// Create an SVG element
const svg = d3.select("#map")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .append("g"); // Add a group to apply zoom transforms

// Define a geographic projection (Mercator for simplicity)
const projection = d3.geoMercator()
    .center([8.2275, 46.8182]) // Center on Switzerland (longitude, latitude)
    .scale(7000) // Scale for the map
    .translate([width / 2, height / 2]); // Center the map in the SVG

// Define a path generator using the projection
const path = d3.geoPath().projection(projection);

// GeoJSON URL for Switzerland Cantons (Reliable Source)
const geoJsonUrl = "https://raw.githubusercontent.com/codeforgermany/click_that_hood/main/public/data/switzerland.geojson";

// CSV URL for milk production data
const csvUrl = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQELzLSpDUjKWvcToht_3VNhHCiETLviN1GrrobguJzAMmMjPb5Gp_cF714rM_N3FqGuatY0LtbJTub/pub?gid=1278676072&single=true&output=csv";

// Scale for bubble sizes (based on milk production)
const radiusScale = d3.scaleSqrt().range([0, 30]); // Adjust range for bubble sizes

// Add a div for the tooltip (outside the SVG)
const tooltip = d3.select("body")
    .append("div")
    .attr("id", "tooltip")
    .style("visibility", "hidden");

// Function to normalize strings (removes accents and trims spaces)
const normalizeString = str => str ? str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() : null;

// Initialize the zoom behavior
const zoom = d3.zoom()
    .scaleExtent([1, 10]) // Zoom limits
    .on("zoom", (event) => {
        svg.attr("transform", event.transform); // Apply transformations to the <g> element
    });

// Attach the zoom behavior to the SVG element
d3.select("#map").call(zoom);

// Track the zoom state
let isZoomed = false; // Initial state

Promise.all([
    d3.json(geoJsonUrl),
    d3.csv(csvUrl)
]).then(([geoData, csvData]) => {
    // Process the CSV data
    const milkData = csvData.map(d => ({
        canton: geoData.features.find(c =>
            normalizeString(c.properties.name) === normalizeString(d["Canton"].trim())
        )?.properties.name || d["Canton"].trim(),
        production2021: +d["2021_Market_Milk_Tons"],
        production2022: +d["2022_Market_Milk_Tons"],
        production2023: +d["2023_Market_Milk_Tons"],
        totalProduction: +d["2021_Market_Milk_Tons"] + +d["2022_Market_Milk_Tons"] + +d["2023_Market_Milk_Tons"]
    }));

    // Fill the table with data from the CSV
    const tableBody = d3.select("#data-table tbody");
    milkData.forEach(d => {
        tableBody.append("tr")
            .html(`
                <td>${d.canton}</td>
                <td>${d.production2021.toLocaleString()}</td>
                <td>${d.production2022.toLocaleString()}</td>
                <td>${d.production2023.toLocaleString()}</td>
            `);
    });


    // Update the scale domain based on the total production values
    radiusScale.domain([0, d3.max(milkData, d => d.totalProduction)]);

    svg.selectAll(".canton")
        .data(geoData.features)
        .enter()
        .append("path")
        .attr("class", "canton")
        .attr("d", path)
        .attr("fill", "#cad8d8") // Light gray for background
        .attr("stroke", "#22113e")
        .on("mouseover", function (event, d) {
            tooltip.style("visibility", "visible")
                .text(d.properties.name);
            // Show canton name on hover
            const cantonName = d.properties.name; // Name property in GeoJSON
            d3.select(this).classed("canton-hover", true);
            console.log("Hovered over: " + cantonName);
        })
        .on("mousemove", function (event) {
            const tooltipWidth = tooltip.node().offsetWidth;
            const tooltipHeight = tooltip.node().offsetHeight;
            const pageWidth = window.innerWidth;
            const pageHeight = window.innerHeight;

            let x = event.pageX + 10;
            let y = event.pageY + 10;

            // Adjust if the tooltip is too close to the right or bottom edge
            if (x + tooltipWidth > pageWidth) {
                x = event.pageX - tooltipWidth - 10;
            }
            if (y + tooltipHeight > pageHeight) {
                y = event.pageY - tooltipHeight - 10;
            }

            tooltip.style("top", `${y}px`).style("left", `${x}px`);
        })
        .on("mouseout", function () {
            // Hide the tooltip
            tooltip.style("visibility", "hidden");
            d3.select(this).classed("canton-hover", false); // Reset the fill color
        });

    const bubbles = svg.selectAll(".bubble")
        .data(milkData)
        .enter()
        .append("circle")
        .attr("class", "bubble")
        .attr("cx", d => {
            const canton = geoData.features.find(c =>
                normalizeString(c.properties.name) === normalizeString(d.canton)
            );
            return canton ? path.centroid(canton)[0] : null;
        })
        .attr("cy", d => {
            const canton = geoData.features.find(c =>
                normalizeString(c.properties.name) === normalizeString(d.canton)
            );
            return canton ? path.centroid(canton)[1] : null;
        })
        .attr("r", d => radiusScale(d.totalProduction))
        .attr("fill", "#EA7DFF")
        .on("click", function (event, d) {
            if (isZoomed) {
                resetZoom();
            } else {
                zoomToBubble(this, d);
            }
        });

    function zoomToBubble(clickedBubble, data) {
        const [cx, cy] = [d3.select(clickedBubble).attr("cx"), d3.select(clickedBubble).attr("cy")];
        const radius = +d3.select(clickedBubble).attr("r");

        // Dynamically adjust the zoom scale for small pink bubbles
        const zoomScale = radius < 20 ? 20 : 4; // Higher zoom for smaller bubbles

        svg.transition()
            .duration(750)
            .call(
                zoom.transform, // Apply zoom transformation
                d3.zoomIdentity
                    .translate(width / 2, height / 2)
                    .scale(zoomScale) // Adjust zoom level dynamically
                    .translate(-cx, -cy)
            )
            .on("end", () => {
                addYearBubbles(cx, cy, radius, data);
                isZoomed = true; // Update state
            });
    }

    // Track zoom levels
    let currentZoomLevel = 0; // 0 = initial, 1 = pink bubble zoom, 2 = turquoise bubble zoom

    function addYearBubbles(cx, cy, radius, data) {
        const yearData = [
            { year: "2021", production: data.production2021 },
            { year: "2022", production: data.production2022 },
            { year: "2023", production: data.production2023 }
        ];

        // Calculate proportional areas for bubbles
        const totalProduction = d3.sum(yearData, d => d.production);
        yearData.forEach(d => {
            d.radius = Math.sqrt(d.production / totalProduction) * radius; // Proportional radius
        });

        // Use D3's pack layout for non-overlapping placement
        const pack = d3.pack()
            .size([radius * 2, radius * 2])
            .padding(3); // Add some padding between circles

        const hierarchy = d3.hierarchy({ children: yearData })
            .sum(d => d.radius);

        const nodes = pack(hierarchy).leaves();

        // Add year-specific bubbles
        svg.selectAll(".year-bubble")
            .data(nodes)
            .enter()
            .append("circle")
            .attr("class", "year-bubble")
            .attr("cx", d => +cx + d.x - radius) // Adjust for local packing coordinates
            .attr("cy", d => +cy + d.y - radius)
            .attr("r", d => d.r)
            .on("click", (event, d) => {
                zoomToTurquoiseBubble(this, d.data); // Second-level zoom
            });

        // Add text labels for each year
        svg.selectAll(".year-label")
            .data(nodes)
            .enter()
            .append("text")
            .attr("class", "year-label")
            .attr("x", d => +cx + d.x - radius) // Match positions of the bubbles
            .attr("y", d => +cy + d.y - radius) // Match vertical alignment with bubbles
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "middle") // Center vertically inside the bubble
            .attr("font-size", d => `${Math.min(d.r / 3, 12)}px`) // Font size adjusts to bubble size
            .text(d => d.data.year);
    }

    function zoomToTurquoiseBubble(clickedBubble, data) {
        // Check if already zoomed into this bubble
        if (currentZoomLevel === 2 && clickedBubble === currentlyZoomedBubble) {
            resetZoom(); // Exit zoom if clicked on the same bubble
            currentlyZoomedBubble = null; // Clear reference
            return;
        }

        const [cx, cy] = [
            d3.select(event.currentTarget).attr("cx"),
            d3.select(event.currentTarget).attr("cy")
        ];
        const radius = +d3.select(event.currentTarget).attr("r");

        // Remove existing labels from the turquoise bubble
        svg.selectAll(".year-label").remove();

        svg.transition()
            .duration(750)
            .call(
                zoom.transform,
                d3.zoomIdentity
                    .translate(width / 2, height / 2)
                    .scale(8) // Higher zoom level for turquoise bubble
                    .translate(-cx, -cy)
            )
            .on("end", () => {
                currentZoomLevel = 2; // Update to second zoom level
                currentlyZoomedBubble = clickedBubble; // Track which bubble is zoomed
                addDetailsToTurquoiseBubble(cx, cy, radius, data); // Show details
            });
    }

    function addDetailsToTurquoiseBubble(cx, cy, radius, data) {
        // Garantir que cx, cy e radius sejam números válidos
        cx = parseFloat(cx);
        cy = parseFloat(cy);
        radius = parseFloat(radius);

        if (isNaN(cx) || isNaN(cy) || isNaN(radius)) {
            console.error("Invalid coordinates or radius:", { cx, cy, radius });
            return;
        }

        // Remove any existing details to prevent duplication
        svg.selectAll(".bubble-details").remove();

        // Text container inside the turquoise bubble
        const detailsGroup = svg.append("g")
            .attr("class", "bubble-details");

        // Add the year (first line)
        detailsGroup.append("text")
            .attr("x", cx)
            .attr("y", cy - radius / 5) // Slightly above center for the year
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "middle")
            .attr("font-size", `${Math.min(radius / 4, 16)}px`) // Font size adjusts to bubble size
            .attr("fill", "#ffffff")
            .text(`Year: ${data.year}`);

        // Add the production value (second line)
        detailsGroup.append("text")
            .attr("x", cx)
            .attr("y", cy + radius / 5) // Slightly below center for the production value
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "middle")
            .attr("font-size", `${Math.min(radius / 5, 14)}px`) // Slightly smaller font for value
            .attr("fill", "#ffffff")
            .text(`Tons of Milk: ${data.production}`);
    }


    function resetZoom() {
        svg.transition()
            .duration(750)
            .call(zoom.transform, d3.zoomIdentity) // Reset zoom transformation
            .on("end", () => {
                svg.selectAll(".year-bubble").remove(); // Remove internal bubbles
                svg.selectAll(".year-label").remove(); // Remove internal labels
                svg.selectAll(".bubble-details").remove(); // Remove details text
                currentZoomLevel = 0; // Reset zoom level
                isZoomed = false; // Update state
            });
    }

    // Function to render a grouped bar chart
    function renderBarChart(data) {
        const svg = d3.select("#bar-chart");
        const margin = { top: 20, right: 30, bottom: 100, left: 50 };
        const width = svg.attr("width") - margin.left - margin.right;
        const height = svg.attr("height") - margin.top - margin.bottom;

        // Create a group to contain the chart elements
        const chart = svg.append("g")
            .attr("transform", `translate(${margin.left},${margin.top})`);

        // Define the scales
        const x0 = d3.scaleBand()
            .domain(data.map(d => d.canton)) // Groups by canton
            .range([0, width]) // Full width of the chart
            .padding(0.2); // Space between groups

        const x1 = d3.scaleBand()
            .domain(["2021", "2022", "2023"]) // Sub-groups for years
            .range([0, x0.bandwidth()]) // Distributed within each group
            .padding(0.1); // Space between bars in the same group

        const y = d3.scaleLinear()
            .domain([0, d3.max(data, d => Math.max(d.production2021, d.production2022, d.production2023))]) // Max value across all years
            .nice() // Make the domain end on a rounded number
            .range([height, 0]); // Inverted scale for the y-axis

        // Append x-axis
        chart.append("g")
            .attr("class", "x-axis")
            .attr("transform", `translate(0,${height})`) // Position at the bottom
            .call(d3.axisBottom(x0)) // Generate x-axis
            .selectAll("text")
            .attr("transform", "rotate(-45)") // Rotate labels for readability
            .style("text-anchor", "end");

        // Append y-axis
        chart.append("g")
            .attr("class", "y-axis")
            .call(d3.axisLeft(y)); // Generate y-axis

        // Add tooltip div for hover information
        const tooltip = d3.select("body")
            .append("div")
            .attr("class", "tooltip")
            .style("position", "absolute")
            .style("visibility", "hidden")
            .style("background-color", "white")
            .style("border", "1px solid gray")
            .style("padding", "8px")
            .style("border-radius", "4px")
            .style("font-size", "12px");

        // Create bar groups for each canton
        const barGroups = chart.selectAll(".bar-group")
            .data(data)
            .enter()
            .append("g")
            .attr("class", "bar-group")
            .attr("transform", d => `translate(${x0(d.canton)},0)`);

        // Add bars for each year
        barGroups.selectAll("rect")
            .data(d => [
                { year: "2021", value: d.production2021 },
                { year: "2022", value: d.production2022 },
                { year: "2023", value: d.production2023 }
            ])
            .enter()
            .append("rect")
            .attr("x", d => x1(d.year)) // Position within the group
            .attr("y", d => y(d.value)) // Bar height
            .attr("width", x1.bandwidth()) // Bar width
            .attr("height", d => height - y(d.value)) // Calculate height dynamically
            .attr("fill", (d, i) => ["#EA7DFF", "#08f2db", "#22113e"][i]) // Colors for the years
            .on("mouseover", function (event, d) {
                // Show the tooltip with the value
                tooltip.style("visibility", "visible")
                    .text(`Year: ${d.year}, Tons: ${d.value.toLocaleString()}`);
                d3.select(this).attr("opacity", 0.8); // Highlight bar on hover
            })
            .on("mousemove", function (event) {
                // Position the tooltip near the cursor
                const tooltipWidth = tooltip.node().offsetWidth;
                const tooltipHeight = tooltip.node().offsetHeight;
                let x = event.pageX + 10;
                let y = event.pageY + 10;

                // Prevent tooltip from going out of bounds
                if (x + tooltipWidth > window.innerWidth) x = event.pageX - tooltipWidth - 10;
                if (y + tooltipHeight > window.innerHeight) y = event.pageY - tooltipHeight - 10;

                tooltip.style("left", `${x}px`).style("top", `${y}px`);
            })
            .on("mouseout", function () {
                // Hide the tooltip and reset bar opacity
                tooltip.style("visibility", "hidden");
                d3.select(this).attr("opacity", 1);
            });

        // Add legend to explain colors
        const legend = chart.append("g")
            .attr("class", "legend")
            .attr("transform", `translate(${width - 100},${-margin.top})`);

        ["2021", "2022", "2023"].forEach((year, i) => {
            legend.append("rect")
                .attr("x", 0)
                .attr("y", i * 20)
                .attr("width", 15)
                .attr("height", 15)
                .attr("fill", ["#EA7DFF", "#08f2db", "#22113e"][i]);

            legend.append("text")
                .attr("x", 20)
                .attr("y", i * 20 + 12)
                .text(year)
                .style("font-size", "12px")
                .attr("alignment-baseline", "middle");
        });
    }

    // After processing the data in Promise.all
    renderBarChart(milkData);



}).catch(error => {
    console.error("Error loading data:", error);
});
