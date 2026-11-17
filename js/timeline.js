(() => {
  const ROLES = [
    { key: "Forward", label: "Forwards", color: "var(--forward)" },
    { key: "Defenseman", label: "Defensemen", color: "var(--defenseman)" },
    { key: "Goalie", label: "Goalies", color: "var(--goalie)" },
  ];
  const POSITION_NAMES = { C: "Center", L: "Left Wing", R: "Right Wing", D: "Defense", G: "Goalie" };
  const LOCKOUT_SEASON = 2004;
  const DIM_OPACITY = 0.35; // seasons with no Detroit playoff games

  const ROW_H = 22;
  const BAR_H = 12;
  const GROUP_H = 28;
  const AXIS_H = 62;
  const LABEL_ANGLE = 55; // season labels rotate counter-clockwise from the top center of their column
  const LABEL_W = 170;
  const RIGHT_PAD = 32;

  // A stint that began or ended mid-season fills half of that season's column, whatever the date
  const barStart = (s) => s.start + (s.joined ? 0.5 : 0);
  const barEnd = (s) => s.end + (s.left ? 0.5 : 1);

  // Drawn bars: stints joined across inactive gaps (no games anywhere), so one bar covers the whole run
  function barSpans(p) {
    const gapStarts = new Set((p.inactive || []).map((g) => g.start));
    const spans = [];
    for (const s of p.stints) {
      const prev = spans.at(-1);
      if (prev && gapStarts.has(prev.end + 1)) Object.assign(prev, { end: s.end, left: s.left });
      else spans.push({ start: s.start, end: s.end, joined: s.joined, left: s.left });
    }
    return spans;
  }

  // Runs of [from, to) in season units, played = had a Detroit playoff game. The lockout column
  // splits in half, each half following its neighboring season, so it never adds a dim patch.
  function playoffRuns(span, playoffSeasons) {
    const played = (y) => playoffSeasons.includes(y);
    const runs = [];
    const add = (from, to, on) => {
      const last = runs.at(-1);
      if (last && last.played === on) last.to = to; else runs.push({ from, to, played: on });
    };
    for (let y = span.start; y <= span.end; y++) {
      if (y === LOCKOUT_SEASON) {
        add(y, y + 0.5, played(y - 1));
        add(y + 0.5, y + 1, played(y + 1));
      } else add(y, y + 1, played(y));
    }
    runs[0].from = barStart(span);
    runs.at(-1).to = barEnd(span);
    return runs;
  }

  // Inclusive season ranges, bridging the lockout
  function seasonRanges(years) {
    const ranges = [];
    for (const y of years) {
      const last = ranges.at(-1);
      if (last && (y === last.end + 1 || (y === LOCKOUT_SEASON + 1 && last.end === LOCKOUT_SEASON - 1))) last.end = y;
      else ranges.push({ start: y, end: y });
    }
    return ranges;
  }

  const seasonLabel = (y) => `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
  const shortSeason = (y) => `'${String(y % 100).padStart(2, "0")}-${String((y + 1) % 100).padStart(2, "0")}`;

  const chartEl = document.getElementById("chart");
  const tooltip = document.getElementById("tooltip");

  // Filter groups in the settings modal. Values within a group combine with OR; groups combine with AND.
  // An empty selection means the group doesn't filter.
  const METHODS = ["Draft", "Trade", "Free agent", "Waivers"];
  const METHOD_PHRASES = { Draft: "drafted", Trade: "acquired by trade", "Free agent": "signed as free agents", Waivers: "claimed off waivers" };
  const FILTER_GROUPS = [
    { key: "cups", legend: "Cup teams", allLabel: "All players", selected: new Set(),
      matches: (p, v) => p.playoffSeasonsInWindow.includes(v) },
    { key: "methods", legend: "Acquired by", allLabel: "Any method", selected: new Set(),
      matches: (p, v) => p.acquisitions.some((a) => a.method === v) },
  ];
  // "show" hides non-matching players; "highlight" keeps everyone and tints the matching rows
  let filterMode = "show";
  const filterActive = () => FILTER_GROUPS.some((g) => g.selected.size > 0);
  const matchesFilters = (p) => FILTER_GROUPS.every((g) => g.selected.size === 0 || [...g.selected].some((v) => g.matches(p, v)));
  const matchingPlayers = (data) => data.players.filter(matchesFilters);
  const visiblePlayers = (data) => !filterActive() || filterMode === "highlight"
    ? data.players
    : matchingPlayers(data);
  const isHighlighted = (p) => filterMode === "highlight" && filterActive() && matchesFilters(p);
  const orList = (items) => items.length > 1 ? `${items.slice(0, -1).join(", ")} or ${items.at(-1)}` : items[0];

  function buildLegend() {
    const legend = document.getElementById("legend");
    legend.innerHTML = ROLES.map((r) =>
      `<span class="legend-item"><span class="legend-swatch" style="background:${r.color}"></span>${r.key}</span>`
    ).join("") +
      `<span class="legend-item"><span class="legend-swatch legend-dim"></span>Did not play in playoffs</span>` +
      `<span class="legend-item"><span class="legend-core"></span>1996-97 to 2007-08</span>` +
      `<span class="legend-item"><span class="legend-cup"></span>Stanley Cup season</span>` +
      `<span class="legend-item"><span class="legend-no-playoffs"></span>No playoff berth</span>` +
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
    const { coreWindow, cupSeasons, missedPlayoffs } = data;

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
    axisSvg.append("text").attr("class", "axis-hint").attr("x", 8).attr("y", AXIS_H - 12)
      .text("Hover a season for payroll");

    // Body
    const { rows, height } = layoutRows(players);
    const svg = d3.select(chartEl).append("svg").attr("width", width).attr("height", height);

    drawColumns(svg, height);
    // Translucent stripes drawn over the column fills so they stay visible inside them
    svg.selectAll(".row-bg").data(rows.filter((r) => r.type === "player" && r.alt)).join("rect")
      .attr("x", 0).attr("width", width).attr("y", (r) => r.y).attr("height", ROW_H)
      .attr("fill", "var(--row-alt)");
    // Highlighted rows: a translucent band (so Cup and core columns still show through) with a solid edge in the label column
    const highlighted = rows.filter((r) => r.type === "player" && isHighlighted(r.player));
    svg.selectAll(".row-highlight").data(highlighted).join("rect")
      .attr("class", "row-highlight")
      .attr("x", 0).attr("width", width).attr("y", (r) => r.y).attr("height", ROW_H);
    svg.selectAll(".row-highlight-edge").data(highlighted).join("rect")
      .attr("class", "row-highlight-edge")
      .attr("x", 0).attr("width", 3).attr("y", (r) => r.y).attr("height", ROW_H);
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
      .attr("class", "row").classed("is-highlighted", (r) => isHighlighted(r.player))
      .attr("transform", (r) => `translate(0,${r.y})`);
    // Each bar is filled with a hard-stop gradient: full color for playoff seasons, dimmed for the rest
    const spansOf = new Map(rows.filter((r) => r.type === "player").map((r) => [r.player.id, barSpans(r.player).map((s, i) => ({
      ...s, id: `bar-${r.player.id}-${i}`, color: r.role.color, runs: playoffRuns(s, r.player.playoffSeasons),
    }))]));
    svg.append("defs").selectAll("linearGradient").data([...spansOf.values()].flat()).join("linearGradient")
      .attr("id", (s) => s.id).attr("gradientUnits", "userSpaceOnUse").attr("x1", 0).attr("x2", width)
      .selectAll("stop").data((s) => s.runs.flatMap((run) => [run.from, run.to].map((t) => ({ ...run, t, color: s.color }))))
      .join("stop")
      .attr("offset", (d) => x(d.t) / width)
      .style("stop-color", (d) => d.color).style("stop-opacity", (d) => d.played ? 1 : DIM_OPACITY);
    row.selectAll(".bar").data((r) => spansOf.get(r.player.id)).join("rect")
      .attr("class", "bar")
      .attr("x", (s) => x(barStart(s)) + 1).attr("width", (s) => Math.max(x(barEnd(s)) - x(barStart(s)) - 2, 2))
      .attr("y", (ROW_H - BAR_H) / 2).attr("height", BAR_H).attr("rx", 3)
      .attr("fill", (s) => `url(#${s.id})`);
    // Full-row hit target
    row.append("rect").attr("x", 0).attr("width", width).attr("height", ROW_H)
      .attr("fill", "transparent")
      .on("mousemove", (event, r) => showTooltip(event, r.player, cupSeasons))
      .on("mouseleave", hideTooltip);
    // Name links to the player's Hockey-Reference page; drawn above the hit target so it stays clickable
    row.append("a").attr("class", "row-link")
      .attr("href", (r) => `https://www.hockey-reference.com/players/${r.player.hrId[0]}/${r.player.hrId}.html`)
      .attr("target", "_blank").attr("rel", "noopener")
      .on("mousemove", (event, r) => showTooltip(event, r.player, cupSeasons))
      .on("mouseleave", hideTooltip)
      .append("text").attr("class", "row-label")
      .attr("x", LABEL_W - 10).attr("y", ROW_H / 2).attr("dy", "0.35em").attr("text-anchor", "end")
      .text((r) => r.player.name);

    // Highlight the season column under the pointer, in both the header and the body
    const seasonAt = (event, target) => {
      const [px] = d3.pointer(event, target.node());
      const s = Math.floor(x.invert(px));
      return px >= LABEL_W && s >= minYear && s < maxYear ? s : null;
    };
    for (const target of [axisSvg, svg]) {
      target.on("mousemove.season", (event) => highlightSeason(seasonAt(event, target)))
        .on("mouseleave.season", () => highlightSeason(null));
    }
    // In the header, show that season's payroll
    const payrollBySeason = new Map(data.payroll.map((e) => [e.season, e]));
    axisSvg.on("mousemove.payroll", (event) => {
      const s = seasonAt(event, axisSvg);
      if (s === null) { hideTooltip(); return; }
      const tag = cupSeasons.includes(s) ? "Stanley Cup" : missedPlayoffs.includes(s) ? "Missed playoffs" : null;
      showSeasonTooltip(event, s, payrollBySeason.get(s), tag);
    }).on("mouseleave.payroll", hideTooltip);

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
      target.append("g").selectAll("rect").data(missedPlayoffs).join("rect")
        .attr("x", (s) => x(s)).attr("width", pxPerSeason).attr("y", 0).attr("height", h)
        .attr("fill", "var(--no-playoffs-fill)");
      if (LOCKOUT_SEASON >= minYear && LOCKOUT_SEASON < maxYear) {
        target.append("rect")
          .attr("x", x(LOCKOUT_SEASON)).attr("width", pxPerSeason).attr("y", 0).attr("height", h)
          .attr("fill", "var(--lockout-fill)");
      }
    }
  }

  const formatDate = (iso) => iso.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$2/$3/$1"); // "1998-12-30" -> "12/30/1998"

  const ordinal = (n) => {
    if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`;
    return n + ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th");
  };

  function describeAcquisition(a) {
    const from = a.from ? ` from ${a.from}` : "";
    const date = a.date && formatDate(a.date);
    switch (a.method) {
      case "Draft": return `Drafted ${a.year}, ${ordinal(a.round)} round (${ordinal(a.overall)} OA)`;
      case "Trade": return `Trade${from}, ${date}`;
      case "Free agent": return `Free agent, ${date}`;
      case "Waivers": return `Waiver claim${from}, ${date}`;
      default: return "Unknown";
    }
  }

  function showTooltip(event, p, cupSeasons) {
    const stints = p.stints.map((s) =>
      s.start === s.end ? seasonLabel(s.start) : `${seasonLabel(s.start)} to ${seasonLabel(s.end)}`
    ).join("<br>");
    const rangeText = (g) => g.start === g.end ? seasonLabel(g.start) : `${seasonLabel(g.start)} to ${seasonLabel(g.end)}`;
    const inactive = (p.inactive || []).map(rangeText).join("<br>");
    const noPlayoffs = seasonRanges(barSpans(p).flatMap((s) => d3.range(s.start, s.end + 1))
      .filter((y) => y !== LOCKOUT_SEASON && !p.playoffSeasons.includes(y))).map(rangeText).join("<br>");
    const seasonCount = d3.sum(p.stints, (s) => s.end - s.start + 1 - (s.start < LOCKOUT_SEASON && s.end > LOCKOUT_SEASON ? 1 : 0));
    const cupWins = cupSeasons.filter((s) => p.playoffSeasonsInWindow.includes(s));
    // Prefix each acquisition with its stint's first season only when there is more than one
    const acquired = p.acquisitions.map((a) =>
      (p.acquisitions.length > 1 ? `${shortSeason(a.season)}: ` : "") + describeAcquisition(a)
    ).join("<br>");
    tooltip.innerHTML = `
      <div class="tt-name">${p.name}</div>
      <div class="tt-row">${POSITION_NAMES[p.position]} · ${p.role}</div>
      <div class="tt-row"><span class="tt-key">Red Wings:</span><br>${stints}</div>
      <div class="tt-row"><span class="tt-key">Acquired:</span><br>${acquired}</div>
      ${noPlayoffs ? `<div class="tt-row"><span class="tt-key">Did not play in playoffs:</span><br>${noPlayoffs}</div>` : ""}
      ${inactive ? `<div class="tt-row"><span class="tt-key">No games played:</span><br>${inactive}</div>` : ""}
      <div class="tt-row"><span class="tt-key">Seasons with Detroit:</span> ${seasonCount}</div>
      <div class="tt-row"><span class="tt-key">Cup wins:</span> ${cupWins.length ? cupWins.map(shortSeason).join(", ") : "None"}</div>`;
    placeTooltip(event);
  }

  const money = (v) => v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}K`;
  const percent = (v, of) => `${Math.round(v / of * 100)}%`;

  function showSeasonTooltip(event, s, e, tag) {
    let body;
    if (s === LOCKOUT_SEASON) {
      body = `<div class="tt-row">No season (lockout)</div>`;
    } else if (!e) {
      body = `<div class="tt-row">No payroll data</div>`;
    } else if (e.estimate) {
      body = `
        <div class="tt-row"><span class="tt-key">Detroit payroll:</span> not published</div>
        <div class="tt-row"><span class="tt-key">League average:</span> about ${money(e.leagueAvg)} (estimate)</div>
        <div class="tt-row"><span class="tt-key">No salary cap</span></div>
        <div class="tt-note">Team payrolls weren't made public until 1989-90. This scales the 1989-90 league average by the change in the NHL's average salary (${money(e.avgSalary)} this season).</div>`;
    } else {
      body = `
        <div class="tt-row"><span class="tt-key">Detroit payroll:</span> ${money(e.detroit)} (${ordinal(e.rank)} of ${e.teams})</div>
        <div class="tt-row"><span class="tt-key">vs. league average (${money(e.leagueAvg)}):</span> ${percent(e.detroit, e.leagueAvg)}</div>
        <div class="tt-row"><span class="tt-key">vs. top 5 other teams (${money(e.topOthersAvg)} avg):</span> ${percent(e.detroit, e.topOthersAvg)}</div>
        <div class="tt-row">${e.cap
          ? `<span class="tt-key">vs. salary cap (${money(e.cap)}${e.capNote ? `, ${e.capNote}` : ""}):</span> ${percent(e.detroit, e.cap)}`
          : `<span class="tt-key">No salary cap</span>`}</div>
        ${e.note ? `<div class="tt-note">${e.note}</div>` : ""}
        <div class="tt-source">${e.measure === "cap" ? "Salary-cap hits" : "Player salaries"} · ${e.source}</div>`;
    }
    tooltip.innerHTML = `<div class="tt-name">${seasonLabel(s)}${tag ? ` · ${tag}` : ""}</div>${body}`;
    placeTooltip(event);
  }

  function placeTooltip(event) {
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
    const [cupGroup, methodGroup] = FILTER_GROUPS;
    cupGroup.values = data.cupSeasons.map((s) => ({ value: s, label: `${seasonLabel(s)} Cup team` }));
    methodGroup.values = METHODS.map((m) => ({ value: m, label: m }));

    options.innerHTML = FILTER_GROUPS.map((g) =>
      `<fieldset data-group="${g.key}"><legend>${g.legend}</legend>` +
      `<label class="filter-option"><input type="checkbox" data-all><span class="all-label"></span><span class="count">${data.players.length}</span></label>` +
      `<div class="filter-divider"></div>` +
      g.values.map((v, i) =>
        `<label class="filter-option"><input type="checkbox" data-index="${i}">${v.label}<span class="count">${data.players.filter((p) => g.matches(p, v.value)).length}</span></label>`
      ).join("") +
      `</fieldset>`
    ).join("");
    for (const g of FILTER_GROUPS) {
      const fs = options.querySelector(`[data-group="${g.key}"]`);
      g.allBox = fs.querySelector("[data-all]");
      g.allText = fs.querySelector(".all-label");
      g.boxes = [...fs.querySelectorAll("[data-index]")];
      // The "all" option and the group's values are exclusive: checking it clears them; clearing every value re-checks it
      g.allBox.addEventListener("change", () => { g.selected.clear(); sync(); });
      g.boxes.forEach((b) => b.addEventListener("change", () => {
        const v = g.values[+b.dataset.index].value;
        if (b.checked) g.selected.add(v); else g.selected.delete(v);
        sync();
      }));
    }
    const modeRadios = [...modal.querySelectorAll('input[name="filter-mode"]')];

    function describe() {
      const cups = cupGroup.values.filter((v) => cupGroup.selected.has(v.value)).map((v) => seasonLabel(v.value));
      const methods = METHODS.filter((m) => methodGroup.selected.has(m)).map((m) => METHOD_PHRASES[m]);
      let text = "";
      if (cups.length) text += ` from the ${orList(cups)} Cup ${cups.length > 1 ? "teams" : "team"}`;
      if (methods.length) text += ` who were ${orList(methods)}`;
      return text;
    }

    function sync() {
      const highlight = filterMode === "highlight";
      modeRadios.forEach((r) => { r.checked = r.value === filterMode; });
      for (const g of FILTER_GROUPS) {
        g.allText.textContent = highlight ? "No highlight" : g.allLabel;
        g.allBox.checked = g.selected.size === 0;
        g.boxes.forEach((b) => { b.checked = g.selected.has(g.values[+b.dataset.index].value); });
      }
      dot.hidden = !filterActive();
      if (!filterActive()) {
        status.hidden = true;
      } else {
        const n = matchingPlayers(data).length;
        status.innerHTML = highlight
          ? `<span class="highlight-swatch"></span>Highlighting ${n} players${describe()}.<button type="button">Clear</button>`
          : `Showing ${n} players${describe()}.<button type="button">Show all</button>`;
        status.hidden = false;
      }
      render(data);
    }

    const clearAll = () => { FILTER_GROUPS.forEach((g) => g.selected.clear()); sync(); };
    modeRadios.forEach((r) => r.addEventListener("change", () => { filterMode = r.value; sync(); }));
    status.addEventListener("click", (e) => { if (e.target.closest("button")) clearAll(); });
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
