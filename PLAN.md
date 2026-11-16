# Detroit Red Wings Roster Timeline

Interactive horizontal-bar timeline of Red Wings player tenures, in the style of Wikipedia band-membership timelines (see `ref docs/` screenshot). Covers the players who contributed in the playoffs during the 1996-97 through 2007-08 era.

This file is the single source of truth for requirements, design, and status. **Read it fully before working.**

## Documentation rules (mandatory)

- **Update this file in the same session as any change** to requirements, data rules, code behavior, or status. It must never describe something the code doesn't do.
- **Keep it concise and comprehensive.** Replace stale text; don't append history. Remove resolved open questions and record the outcome under Decisions.
- **Before ending a session, update the Status section:** done, in progress, open questions, and next steps. A new agent should be able to continue from this file alone.
- Record user decisions under Decisions with a short rationale.

## Requirements

1. **Core window:** seasons 1996-97 through 2007-08 (12 seasons; Stanley Cups in 1996-97, 1997-98, 2001-02, 2007-08).
2. **Inclusion:** a player is included **only if they played ≥1 playoff game for Detroit in a core-window season**. Regular-season games alone never qualify.
3. **Tenure shown:** for included players, show the **entire** Detroit tenure, including seasons outside the window and regular-season-only seasons.
4. **Tenure season:** any season with ≥1 Detroit game (regular season or playoff).
5. **Gaps:** non-consecutive stints are separate bar segments on the same row. The 2004-05 lockout (no games played) is **not** a gap. A gap in which the player played **no games for any team** (injury, retirement; e.g. Krupp, Hasek) is not a break either: the bar continues through it in a dimmer shade of the role color.
6. **Extent:** computed from data. Currently Steve Yzerman (1983-84) through Darren Helm and Valtteri Filppula (2020-21).
7. **Precision:** season-level, except that a stint that began or ended mid-season fills only half of that season's column, whatever the date (e.g. Gilchrist, waived to Dallas in Feb 2002, stops halfway through the 2001-02 Cup column). The tooltip's acquisition dates give specifics for arrivals; departure dates aren't shown.
8. **Roles (bar color):** Forward (`C`, `L`, `R`), Defenseman (`D`), Goalie (`G`). No secondary stripes. Per-player position overrides live in `POSITION_OVERRIDES` in `fetch_data.py` (never hand-edit the JSON).
9. **On-page note (required):** only players with ≥1 Detroit playoff game from 1996-97 through 2007-08 are shown.
10. **Layout:** vertical scrolling is fine; don't force-fit the viewport.
11. **Filters:** a settings (gear) button at the right of the title row opens a modal. It has two sections: **Cup teams** (All players, default, plus one checkbox per Cup team) and **Acquired by** (Any method, default, plus Draft, Trade, Free agent, Waivers). In each section the "all" option and the value checkboxes are mutually exclusive, and several values can be checked at once. A **Show only / Highlight** switch sets whether the selection hides non-matching players or just highlights the matching rows.
12. **Hosting:** GitHub Pages at https://dpasserahome.github.io/rw_tenure/ (enabled 2026-11-16; serves `main`, root folder, and republishes on every push). Locally, use a static server. Use relative paths only and no build step.

## Files

```
PLAN.md                 # this file
CLAUDE.md               # pointer to this file for agents
README.md               # live URL and 3-sentence project summary
index.html              # page shell: title row + settings button, note, legend, filter status, #chart, filter modal, #tooltip
css/style.css           # color tokens (light/dark), layout, tooltip
js/timeline.js          # D3 v7 rendering (CDN, pinned d3@7.9.0)
scripts/fetch_data.py   # builds data/players.json (Python 3 stdlib only)
data/players.json       # generated; the only data file the page reads
data/raw/               # cached API responses plus Hockey-Reference extracts (hr_ids.json, hr_transactions_{hrId}.html); delete a file to force a re-fetch
ref docs/               # reference screenshot
```

Run:
```
python3 scripts/fetch_data.py     # prints counts, extent, multi-stint players
python3 -m http.server 8000       # http://localhost:8000
```
Git remote: https://github.com/dpasserahome/rw_tenure.git (branch `main`). Live site: https://dpasserahome.github.io/rw_tenure/ (pushing to `main` deploys it).

## Data source

NHL official stats API (public JSON, no key) for rosters, seasons, positions and the draft. Hockey-Reference for player ids (also used for the name links) and transactions, and for verification.

| Purpose | Endpoint |
|---|---|
| Qualifying skaters | `https://api.nhle.com/stats/rest/en/skater/summary?limit=-1&cayenneExp=seasonId={SEASON} and gameTypeId=3 and teamAbbrevs="DET"` (URL-encoded) |
| Qualifying goalies | same, with `/goalie/summary` |
| Career by team/season, draft | `https://api-web.nhle.com/v1/player/{playerId}/landing` → `seasonTotals[]`, `draftDetails` |
| Hockey-Reference ids | `https://www.hockey-reference.com/teams/DET/{endYear}.html` (one per Detroit season of any included player) |
| Transactions | `https://www.hockey-reference.com/players/{x}/{hrId}.html` → `#div_transactions` |

- `SEASON` = `19961997` format. `gameTypeId` 2 = regular season, 3 = playoffs.
- Detroit seasons: `seasonTotals` rows with `leagueAbbrev == "NHL"`, `teamName.default == "Detroit Red Wings"`, `gamesPlayed >= 1`.
- Position is the landing `position` field (current or last listed position, not per-season), unless overridden.
- Inactive gap: every season between two Detroit stints has zero games in all `seasonTotals` rows (any team, league, or game type).
- Hockey-Reference ids are matched by normalized name (accents stripped, lowercase); `HR_NAME_ALIASES` covers spelling differences (Joey/Joe Kocur). The script stops if a player has no match.

### Acquisitions (`team_events()` and `acquisitions()` in `fetch_data.py`)

- Events: the NHL draft (dated June 30 of the draft year) plus parsed HR transactions: trade, free-agent signing (any club, incl. non-NHL), waiver claim ("Claimed by…" / "Selected off waivers…"), expansion draft, retired/released (team = none). Trades of a draft pick before it was used ("as 2nd round draft pick in…") are ignored, so a Detroit draft pick reads as Drafted. Suspensions, tryouts, and loans don't change the team. Unlinked HR team codes are mapped in `HR_UNLINKED_TEAMS` (ANA, QBN).
- An acquisition is any event that moves the player to Detroit from another team (or none). Each stint shows the latest acquisition before its first season ended (June 30) plus any later acquisitions within it (e.g. Gill left and came back mid-stint).
- Event order: same-day moves are ordered so a move to Detroit comes last, because HR's same-day order is unreliable (Gilchrist was claimed by Tampa Bay in the 1998 waiver draft and traded back the same day, so it shows as a 1998-99 trade acquisition; Quincey and Calder came through a third team the same day). Non-NHL signings (team names with "(", e.g. "Pori (Finland)") during the 2004-05 and 2012-13 lockouts (`LOCKOUTS`) are loans and are ignored.
- A stint with no new acquisition shows nothing if the player never left Detroit (minor-league spell, e.g. Ward; or a no-games gap, e.g. Hasek, Krupp); otherwise it shows `Unknown` (none currently).

### Mid-season moves (`mid_season_moves()` in `fetch_data.py`)

- "In season" means Oct 1 through Apr 15 (opening night to the end of the regular season). Moves after Apr 15 count as offseason: no mid-season departures happen in the playoffs, and later trades of rights or retirements (Stuart June 2012, Lidstrom May 2012) belong to the end of the season.
- `joined`: the stint's first season has an acquisition (with a date) dated in season. Currently 28 (e.g. Murphy Mar 1997, Stuart Feb 2008, Shanahan Oct 9 1996).
- `left`: a move out of Detroit dated in the stint's last season, with no move back to Detroit later that season. Retirements ("Left") never count. Currently 9: Kocur 1990-91, Drake 1993-94, Pushor 1997-98 (Cup), Eriksson and Hodson 1998-99, Gilchrist 2001-02 (Cup), Roest 2002-03, Rivers 2005-06, J. Williams 2006-07.
- Moves inside a stint (Gill left in summer 1999 and came back in March 2000) aren't drawn.

## `data/players.json` schema

```json
{
  "generated": "YYYY-MM-DD",
  "coreWindow": { "start": 1996, "end": 2007 },
  "cupSeasons": [1996, 1997, 2001, 2007],
  "players": [
    { "id": 8446120, "name": "Steve Yzerman", "hrId": "yzermst01", "lastName": "Yzerman",
      "role": "Forward", "position": "C",
      "stints": [{ "start": 1983, "end": 2005 }],  // optional "joined", "left", see below
      "inactive": [],
      "playoffSeasonsInWindow": [1996, 1997],
      "acquisitions": [{ "season": 1983, "method": "Draft", "year": 1983, "round": 1, "overall": 4 }] }
  ]
}
```

- `hrId`: Hockey-Reference player id (from the team-page name match), used for the name link.
- Seasons are identified by start year (1996 = 1996-97).
- Stints are inclusive; a bar spans from `start` to `end + 1` on the axis. Stints contain only seasons with Detroit games. Optional `joined` (ISO date) and `left` (`{date, method, to}`, method `Trade`, `Waivers`, or `Free agent` for a non-NHL club) mark mid-season moves.
- `inactive`: inclusive gaps between stints in which the player played nowhere (e.g. Krupp `[{start: 1999, end: 2000}]`). Always present; usually empty.
- `acquisitions`: in date order. `method` is `Draft` (`year`, `round`, `overall`), `Trade`, `Free agent`, `Waivers` (these three have an ISO `date`, e.g. "1996-10-09", and optional `from` team name), or `Unknown`. `season` is the season it applied to (never before the stint start). Currently 37 free agent, 28 trade, 27 draft, 3 waivers.
- Players are pre-sorted by role (Forward → Defenseman → Goalie), then first season, last season, and last name. The page renders in file order.
- Future per-player fields get added to player objects. Don't restructure.

## Rendering (`js/timeline.js`)

- **Rows:** one per player, under role group headers with counts. Fixed 22px rows with alternating backgrounds (a translucent `--row-alt` overlay drawn above the column fills, so stripes show inside them). Names on the left (170px column). Each name links to the player's Hockey-Reference page (`/players/{first letter}/{hrId}.html`) in a new tab, underlined on hover; the link sits above the row's hit target and also shows the tooltip.
- **X-axis:** linear scale over season start years. The width follows the container, with a minimum of 640px. Every season is labeled (`1996-97` format), rotated 55° counter-clockwise with the label's start anchored at the top center of its column. If the columns are too narrow for the labels not to overlap (below ~12px per season), every other season is labeled, choosing odd or even start years by whichever labels more Cup seasons (currently odd: 1997-98, 2001-02, 2007-08). Below 700px viewport width, the chart scrolls horizontally.
- **Sticky axis header** at the top, holding only the rotated season labels. There are no separate Cup or Lockout subheaders. Cup season labels are bold dark gold (`--cup-text`), and the 2004-05 label is muted italic.
- **Mid-season bar ends:** a stint with `joined` starts, and one with `left` ends, at the middle of that season's column, regardless of the date (so early-October arrivals like Shanahan, Cleary and Legace also start halfway). There is no legend entry.
- **Inactive gaps:** drawn under the adjacent stints at 35% opacity of the role color, extended 4px each side so the bar reads as continuous.
- **Column fills** (header and body): the core window is shaded light blue. Cup seasons have an opaque light gold fill (`--cup-fill`) with thin gold edge lines (`--cup-edge`), replacing the blue shading in those columns. The 2004-05 lockout column has a dark grey fill (`--lockout-fill`).
- **Colors:** validated categorical palette, defined as CSS tokens with light and dark variants. Forward is blue (`#2a78d6` / `#3987e5`), Defenseman orange (`#eb6834` / `#d95926`), Goalie aqua (`#1baf7a` / `#199e70`). The legend covers roles, inactive gaps ("Still with Detroit, no games played"), the core window, Cup seasons, and the lockout.
- **Season hover:** the season column under the pointer is tinted (`--season-hover` token) in both the sticky header and the body, and its axis label turns bold if that season has one. It clears when the pointer leaves the plot area.
- **Tooltip:** hovering anywhere on a row shows the name, position and role, stint ranges, acquisitions ("Drafted 1983, 1st round (4th OA)", "Trade from Hartford Whalers, 10/09/1996", "Free agent, 07/01/2007", "Waiver claim from …"; prefixed with the season when there are several), any no-games-played ranges, number of Detroit seasons (excluding the lockout), and Cup wins (Cup seasons in `playoffSeasonsInWindow`, same rule as the filters; "None" if empty).
- Re-renders on window resize.

## Filters (`setupFilters` in `js/timeline.js`)

- State: `FILTER_GROUPS` (Cup teams, Acquired by), each with a `selected` set and a `matches(player, value)` test, plus `filterMode`, `"show"` (default) or `"highlight"`. An empty set means that group doesn't filter. One selection is shared by both modes; switching modes keeps it.
- **Cup team:** that season is in `playoffSeasonsInWindow`. Counts: '96-97 = 23, '97-98 = 24, '01-02 = 23, '07-08 = 23; 22 players are on no Cup team.
- **Acquisition method:** any entry in `acquisitions` has that method, from any Detroit stint (so a Cup + method match doesn't require the acquisition to be for the Cup-season stint). Counts: Draft 27, Trade 27, Free agent 34, Waivers 3 (players with several stints can count under several methods).
- Values within a group combine with OR; groups combine with AND (e.g. '07-08 Cup + Free agent = 12 players).
- **Show only:** only matching players are drawn.
- **Highlight:** every player is drawn. Matching rows get a translucent gold band across the full row (`--row-highlight`, so column fills still show through), a 3px `--cup-edge` strip at the left edge, and a bold name. Group header counts stay at the full totals. Each group's "all" option reads "No highlight" in this mode.
- Checking a group's "all" option clears its values. Checking a value unchecks it. Unchecking the last value re-checks it.
- Changes apply immediately. The modal is a native `<dialog>` that closes on Done, Esc, or a backdrop click. The mode switch is a segmented control of two radio buttons above the groups.
- While any value is selected, a red dot shows on the gear and a status line under the legend describes the selection, e.g. "Showing 12 players from the 2007-08 Cup team who were signed as free agents." with a "Show all" link, or in Highlight mode a highlight swatch, "Highlighting …", and a "Clear" link. Both links clear every group.
- The x-axis extent always comes from all players, so columns don't shift when filtering. Group header counts reflect the drawn rows. Filter state isn't persisted (no URL or storage).
- Colors: `--accent` token (Red Wings red, `#c8102e` / `#e0384f` dark) for the dot, checkboxes, mode switch, link, and Done button.

## Decisions

- **NHL API as the primary source:** structured and official. Hockey-Reference fills what the API lacks (transactions) and is used for verification.
- **Lockout bridging:** a player with Detroit seasons on both sides of 2004-05 has one continuous stint.
- **Row order:** within each role, sort by start season, then end season, then name.
- **Dandenault is a Defenseman** (override `D`): he played defense for most of his Detroit tenure; the API lists `R`.
- **Zero-game gaps are dimmed, not broken:** seasons where the player played for no one (Krupp 1999-01 injury, Hasek 2002-03 retirement) are part of the tenure but shown dimmer. They don't count toward "Seasons with Detroit".
- **Farm-team seasons are not tenure:** a season counts only if the player played for Detroit itself (a call-up with ≥1 Detroit game counts). A season spent only with a minor-league affiliate is a normal break, not a dimmed gap (e.g. Aaron Ward 1995-96). Farm teams and pre-Detroit history are never shown on the page.
- **Cup team membership = played ≥1 Detroit playoff game that Cup season.** This matches the site's inclusion rule. It isn't the official Cup engraving list.
- **Acquisition = how Detroit got the player, per stint.** Draft from the NHL API; trades, signings, and waivers from Hockey-Reference transactions. Unsigned draft picks who later sign count as Drafted; pick-for-pick trades before the draft are not shown.
- **Multiple Cup filters combine with OR.** The user asked for players who won any selected Cup.
- **Highlight is a mode of the Cup filter, not a separate selection.** The user chose one shared selection with a Show only / Highlight switch over independent show and highlight controls (simpler modal). Every match gets the same highlight regardless of how many checked values the player matches.
- **Acquisition filter: OR within the group, AND with the Cup group, matching any stint's acquisition.** Standard faceted-filter behavior; per-stint matching against the Cup season wasn't requested. Gold matches the Cup columns; red accent would compete with the role colors.
- **Mid-season moves are drawn as a half-filled column, not placed by date.** The user tried date-proportional ends and chose a fixed half: it reads more clearly, and hovering gives specifics. It applies to arrivals and departures in every season, not just Cup seasons. No legend swatch and no departure line in the tooltip (user's call). Players who left before a Cup run already don't count as Cup team members.
- **Cup and lockout marking:** shown with column fills plus styled season labels and legend entries, not separate header text. This keeps the header to one row of labels.

## Status

**Done:** fetch script, generated data (79 players: 40 F, 31 D, 8 G), and a working timeline page with all rendering features above, including the Dandenault override, dimmed inactive gaps (Krupp, Hasek), season-column hover highlighting, rotated season labels, and gold Cup / grey lockout columns. Checked by screenshot at desktop and narrow (600px) widths, in light and dark mode.

**Verification checklist:**
- [x] Earliest start is Yzerman, 1983-84 (from data).
- [x] Latest end determined: Helm and Filppula, 2020-21 (from data).
- [x] Full check against Hockey-Reference (2026-11-15), using all 37 Detroit team-season pages from 1983-84 to 2020-21: all 79 players' Detroit seasons and in-window playoff seasons match, and no qualifying player is missing.
- [x] Per-season playoff player counts match Hockey-Reference for all 11 window seasons (96-97 = 23, 97-98 = 24, 98-99 = 24, 99-00 = 22, 00-01 = 23, 01-02 = 23, 02-03 = 19, 03-04 = 24, 05-06 = 20, 06-07 = 22, 07-08 = 23).
- [x] No regular-season-only players (guaranteed by construction).

Also done: acquisitions in the tooltip (all 79 players, no `Unknown`), Cup-team filters, Highlight mode, the acquisition-method filter, mid-season half-column bar ends, and player-name links to Hockey-Reference. The Cup filters were checked in headless Chrome (light and dark: toggle logic, 1996-97 + 2007-08 = 40 players, Show all). The others were checked by script and `node --check` only (filter match counts as listed under Filters; all 79 `hrId`s well-formed), because browser automation was blocked in the sessions that built them.

**Pending browser check** (none of these has been seen in a browser yet):
- Tooltip text, including acquisition lines.
- Highlight look in light and dark mode, the Show only / Highlight switch, the two-section modal (also at phone width), and the status line wording.
- Half-column bars (Gilchrist, Pushor, Murphy) in light and dark mode.
- Name links: clickable, open a new tab, and still show the tooltip.

**Open questions:** none.

**Next steps:** do the pending browser check (or ask the user to), then wait for the user's next requirements.

## Future phases (not started)

- Additional per-player data points (to be specified by the user).
- How each player left Detroit. `team_events()` already has the moves; only mid-season departures are stored (`left`), and none is shown in the tooltip.

## Agent notes

- Hockey-Reference team pages (`/teams/DET/{endYear}.html`) download with plain `curl` and a browser User-Agent; keep it to about 1 request per 4s. Tables: `player_stats`, `goalie_stats`, plus `_post` for playoffs. Rows have `data-append-csv` (player id), `data-stat="name_display"`, and `data-stat="games"` / `"goalie_games"`. HR spells "Joe Kocur", while the NHL API has "Joey".
- Headless Chrome screenshots: `--window-size` can't go below a 500px viewport. Use a fresh `--user-data-dir` in the scratchpad. For dark mode, add `--force-dark-mode --blink-settings=preferredColorScheme=0`. To test hover, drive a real mouse move through `--remote-debugging-port` (CDP `Input.dispatchMouseEvent`; Node 20 needs `--experimental-websocket`).
- `python3 -m http.server` doesn't send cache headers, so browsers can keep old JS/CSS after edits. Tell the user to hard-refresh (Cmd+Shift+R) after changes.
