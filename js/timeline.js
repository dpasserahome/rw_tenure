(() => {
  const ROLES = [
    { key: "Forward", label: "Forwards", color: "var(--forward)" },
    { key: "Defenseman", label: "Defensemen", color: "var(--defenseman)" },
    { key: "Goalie", label: "Goalies", color: "var(--goalie)" },
  ];
  const POSITION_NAMES = { C: "Center", L: "Left Wing", R: "Right Wing", D: "Defense", G: "Goalie" };
  const LOCKOUT_SEASON = 2004;
  const INACTIVE_OPACITY = 0.35;

  const ROW_H = 22;
  const BAR_H = 12;
  const GROUP_H = 28;
  const AXIS_H = 62;
  const LABEL_ANGLE = 55; // season labels rotate counter-clockwise from the top center of their column
  const LABEL_W = 170;
  const RIGHT_PAD = 32;

  const seasonLabel = (y) => `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
  const shortSeason = (y) => `'${String(y % 100).padStart(2, "0")}-${String((y + 1) % 100).padStart(2, "0")}`;

  const chartEl = document.getElementById("chart");
  const tooltip = document.getElementById("tooltip");

  // Cup seasons selected in the filter modal; empty means "All players"
  const selectedCups = new Set();
  const visiblePlayers = (data) => selectedCups.size === 0
    ? data.players
    : data.players.filter((p) => p.playoffSeasonsInWindow.some((s) => selectedCups.has(s)));

  function buildLegend() {
    const legend = document.getElementById("legend");
    legend.innerHTML = ROLES.map((r) =>
      `<span class="legend-item"><span class="legend-swatch" style="background:${r.color}"></span>${r.key}</span>`
    ).join("") +
      `<span class="legend-item"><span class="legend-swatch legend-inactive"></span>Still with Detroit, no games played</span>` +
      `<span class="legend-item"><span class="legend-core"></span>1996-97 to 2007-08</span>` +
      `<span class="legend-item"><span class="legend-cup"></span>Stanley Cup season</span>` +
      `<span class="legend-item"><span class="legend-lockout"></span>Lockout (no season)</span>`;
  }

  // Flatten players into rows with group headers interleaved.
  function layoutRows(players) {
    const rows = [];
    let y = 0;
    for (const role of ROLES) {
      const members = players.filter((p) => p.role === role.key);
      if (!members.length) continue;
      rows.push({ type: "group", role, y, count: members.length });
      y += GROUP_H;
      members.forEach((p, i) => {
        rows.push({ type: "player", role, player: p, y, alt: i % 2 === 1 });
        y += ROW_H;
      });
    }
    return { rows, height: y };
  }

  function render(data) {
    chartEl.innerHTML = "";
    const players = visiblePlayers(data);
    // The axis always spans every player's tenure, so filtering doesn't shift the columns
    const minYear = d3.min(data.players, (p) => p.stints[0].start);
    const maxYear = d3.max(data.players, (p) => p.stints[p.stints.length - 1].end) + 1;
    const width = Math.max(chartEl.clientWidth, 640);
    const plotW = width - LABEL_W - RIGHT_PAD;

    const x = d3.scaleLinear().domain([minYear, maxYear]).range([LABEL_W, LABEL_W + plotW]);
    const pxPerSeason = plotW / (maxYear - minYear);
    // Rotated labels are spaced perpendicular to their baseline; thin them only if they would overlap
    const labelEvery = pxPerSeason * Math.sin(LABEL_ANGLE * Math.PI / 180) >= 10 ? 1 : 2;
    const seasons = d3.range(minYear, maxYear);
    const { coreWindow, cupSeasons } = data;

    // Sticky axis header
    const axisWrap = d3.select(chartEl).append("div").attr("class", "axis-sticky");
    const axisSvg = axisWrap.append("svg").attr("width", width).attr("height", AXIS_H);
    drawColumns(axisSvg, AXIS_H);
    const axisHover = drawHoverColumn(axisSvg, AXIS_H);
    const axis = axisSvg.append("g").attr("class", "axis").attr("transform", `translate(0,${AXIS_H - 6})`);
    axis.selectAll("line").data(d3.range(minYear, maxYear + 1)).join("line")
      .attr("x1", (s) => x(s)).attr("x2", (s) => x(s)).attr("y1", -6).attr("y2", 0);
    // When thinned, keep the parity (odd/even start year) that labels the most Cup seasons
    const labelParity = d3.sum(cupSeasons, (s) => s % 2) * 2 > cupSeasons.length ? 1 : 0;
    axis.selectAll("text").data(seasons.filter((s) => labelEvery === 1 || s % 2 === labelParity)).join("text")
      .attr("class", "season-label").attr("dy", "0.35em")
      .classed("is-cup", (s) => cupSeasons.includes(s)).classed("is-lockout", (s) => s === LOCKOUT_SEASON)
      .attr("transform", (s) => `translate(${x(s + 0.5)},-10) rotate(${-LABEL_ANGLE})`)
      .text(seasonLabel);
    axis.append("line").attr("x1", LABEL_W).attr("x2", LABEL_W + plotW).attr("y1", 0).attr("y2", 0);

    // Body
    const { rows, height } = layoutRows(players);
    const svg = d3.select(chartEl).append("svg").attr("width", width).attr("height", height);

    drawColumns(svg, height);
    // Translucent stripes drawn over the column fills so they stay visible inside them
    svg.selectAll(".row-bg").data(rows.filter((r) => r.type === "player" && r.alt)).join("rect")
      .attr("x", 0).attr("width", width).attr("y", (r) => r.y).attr("height", ROW_H)
      .attr("fill", "var(--row-alt)");
    const bodyHover = drawHoverColumn(svg, height);

    // Season grid
    svg.append("g").selectAll("line").data(d3.range(minYear, maxYear + 1)).join("line")
      .attr("x1", (s) => x(s)).attr("x2", (s) => x(s)).attr("y1", 0).attr("y2", height)
      .attr("stroke", "var(--grid)").attr("stroke-width", (s) => (s - minYear) % 5 === 0 ? 1 : 0.5)
      .attr("opacity", 0.7);

    // Cup season edges
    svg.append("g").selectAll("line").data(cupSeasons.flatMap((s) => [s, s + 1])).join("line")
      .attr("x1", (s) => x(s)).attr("x2", (s) => x(s)).attr("y1", 0).attr("y2", height)
      .attr("stroke", "var(--cup-edge)").attr("stroke-width", 1);

    // Group headers
    svg.selectAll(".group-label").data(rows.filter((r) => r.type === "group")).join("text")
      .attr("class", "group-label").attr("x", 8).attr("y", (r) => r.y + GROUP_H - 9)
      .text((r) => `${r.role.label} (${r.count})`);

    // Player rows
    const row = svg.selectAll(".row").data(rows.filter((r) => r.type === "player")).join("g")
      .attr("class", "row").attr("transform", (r) => `translate(0,${r.y})`);
    row.append("text").attr("class", "row-label")
      .attr("x", LABEL_W - 10).attr("y", ROW_H / 2).attr("dy", "0.35em").attr("text-anchor", "end")
      .text((r) => r.player.name);
    // Inactive gaps (no games anywhere) join the adjacent stints; extend under them so the bar reads as continuous
    row.selectAll(".bar-inactive").data((r) => (r.player.inactive || []).map((g) => ({ ...g, color: r.role.color }))).join("rect")
      .attr("class", "bar-inactive")
      .attr("x", (g) => x(g.start) - 4).attr("width", (g) => x(g.end + 1) - x(g.start) + 8)
      .attr("y", (ROW_H - BAR_H) / 2).attr("height", BAR_H)
      .attr("fill", (g) => g.color).attr("fill-opacity", INACTIVE_OPACITY);
    row.selectAll(".bar").data((r) => r.player.stints.map((s) => ({ ...s, color: r.role.color }))).join("rect")
      .attr("class", "bar")
      .attr("x", (s) => x(s.start) + 1).attr("width", (s) => Math.max(x(s.end + 1) - x(s.start) - 2, 2))
      .attr("y", (ROW_H - BAR_H) / 2).attr("height", BAR_H).attr("rx", 3)
      .attr("fill", (s) => s.color);
    // Full-row hit target
    row.append("rect").attr("x", 0).attr("width", width).attr("height", ROW_H)
      .attr("fill", "transparent")
      .on("mousemove", (event, r) => showTooltip(event, r.player))
      .on("mouseleave", hideTooltip);

    // Highlight the season column under the pointer, in both the header and the body
    for (const target of [axisSvg, svg]) {
      target.on("mousemove.season", (event) => {
        const [px] = d3.pointer(event, target.node());
        const s = Math.floor(x.invert(px));
        highlightSeason(px >= LABEL_W && s >= minYear && s < maxYear ? s : null);
      }).on("mouseleave.season", () => highlightSeason(null));
    }

    function highlightSeason(s) {
      for (const h of [axisHover, bodyHover]) {
        h.attr("display", s === null ? "none" : null).attr("x", s === null ? 0 : x(s));
      }
      axis.selectAll(".season-label").classed("is-hover", (d) => d === s);
    }

    function drawHoverColumn(target, h) {
      return target.append("rect").attr("class", "season-hover").attr("display", "none")
        .attr("y", 0).attr("width", pxPerSeason).attr("height", h)
        .attr("pointer-events", "none");
    }

    function drawColumns(target, h) {
      target.append("rect")
        .attr("x", x(coreWindow.start)).attr("width", x(coreWindow.end + 1) - x(coreWindow.start))
        .attr("y", 0).attr("height", h).attr("fill", "var(--core)").attr("fill-opacity", 0.7);
      target.append("g").selectAll("rect").data(cupSeasons).join("rect")
        .attr("x", (s) => x(s)).attr("width", pxPerSeason).attr("y", 0).attr("height", h)
        .attr("fill", "var(--cup-fill)");
      if (LOCKOUT_SEASON >= minYear && LOCKOUT_SEASON < maxYear) {
        target.append("rect")
          .attr("x", x(LOCKOUT_SEASON)).attr("width", pxPerSeason).attr("y", 0).attr("height", h)
          .attr("fill", "var(--lockout-fill)");
      }
    }
  }

  function showTooltip(event, p) {
    const stints = p.stints.map((s) =>
      s.start === s.end ? seasonLabel(s.start) : `${seasonLabel(s.start)} to ${seasonLabel(s.end)}`
    ).join("<br>");
    const inactive = (p.inactive || []).map((g) =>
      g.start === g.end ? seasonLabel(g.start) : `${seasonLabel(g.start)} to ${seasonLabel(g.end)}`
    ).join("<br>");
    const seasonCount = d3.sum(p.stints, (s) => s.end - s.start + 1 - (s.start < LOCKOUT_SEASON && s.end > LOCKOUT_SEASON ? 1 : 0));
    tooltip.innerHTML = `
      <div class="tt-name">${p.name}</div>
      <div class="tt-row">${POSITION_NAMES[p.position]} · ${p.role}</div>
      <div class="tt-row"><span class="tt-key">Red Wings:</span><br>${stints}</div>
      ${inactive ? `<div class="tt-row"><span class="tt-key">No games played:</span><br>${inactive}</div>` : ""}
      <div class="tt-row"><span class="tt-key">Seasons with Detroit:</span> ${seasonCount}</div>
      <div class="tt-row"><span class="tt-key">Playoffs, 1996-97 to 2007-08:</span> ${p.playoffSeasonsInWindow.map(shortSeason).join(", ")}</div>`;
    tooltip.hidden = false;
    const pad = 14;
    const { offsetWidth: w, offsetHeight: h } = tooltip;
    let left = event.clientX + pad;
    let top = event.clientY + pad;
    if (left + w > window.innerWidth - 8) left = event.clientX - w - pad;
    if (top + h > window.innerHeight - 8) top = event.clientY - h - pad;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  function hideTooltip() {
    tooltip.hidden = true;
  }

  function setupFilters(data) {
    const modal = document.getElementById("settings-modal");
    const options = document.getElementById("filter-options");
    const status = document.getElementById("filter-status");
    const dot = document.getElementById("filter-dot");
    const cupCount = (s) => data.players.filter((p) => p.playoffSeasonsInWindow.includes(s)).length;

    options.innerHTML =
      `<label class="filter-option"><input type="checkbox" value="all">All players<span class="count">${data.players.length}</span></label>` +
      `<div class="filter-divider"></div>` +
      data.cupSeasons.map((s) =>
        `<label class="filter-option"><input type="checkbox" value="${s}">${seasonLabel(s)} Cup team<span class="count">${cupCount(s)}</span></label>`
      ).join("");
    const allBox = options.querySelector('input[value="all"]');
    const cupBoxes = [...options.querySelectorAll('input:not([value="all"])')];

    function sync() {
      allBox.checked = selectedCups.size === 0;
      cupBoxes.forEach((b) => { b.checked = selectedCups.has(+b.value); });
      dot.hidden = selectedCups.size === 0;
      if (selectedCups.size === 0) {
        status.hidden = true;
      } else {
        const cups = data.cupSeasons.filter((s) => selectedCups.has(s)).map(seasonLabel);
        const list = cups.length > 1 ? `${cups.slice(0, -1).join(", ")} or ${cups.at(-1)}` : cups[0];
        status.innerHTML = `Showing ${visiblePlayers(data).length} players from the ${list} Cup ${cups.length > 1 ? "teams" : "team"}.<button type="button">Show all</button>`;
        status.hidden = false;
      }
      render(data);
    }

    // "All players" and the Cup filters are exclusive: checking All clears the Cups; clearing every Cup returns to All
    allBox.addEventListener("change", () => { selectedCups.clear(); sync(); });
    cupBoxes.forEach((b) => b.addEventListener("change", () => {
      if (b.checked) selectedCups.add(+b.value); else selectedCups.delete(+b.value);
      sync();
    }));
    status.addEventListener("click", (e) => {
      if (e.target.closest("button")) { selectedCups.clear(); sync(); }
    });
    document.getElementById("settings-button").addEventListener("click", () => modal.showModal());
    // Close on a backdrop click; the form fills the dialog, so the dialog itself is the target only for backdrop clicks
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.close(); });

    sync();
  }

  buildLegend();
  d3.json("data/players.json").then((data) => {
    setupFilters(data);
    let resizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => render(data), 150);
    });
  });
})();
