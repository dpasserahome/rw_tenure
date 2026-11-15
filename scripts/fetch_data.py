#!/usr/bin/env python3
"""Build data/players.json from the NHL stats API. See PLAN.md for the rules."""

import datetime
import html
import json
import os
import re
import time
import unicodedata
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW_DIR = os.path.join(ROOT, "data", "raw")
OUT_PATH = os.path.join(ROOT, "data", "players.json")

CORE_START, CORE_END = 1996, 2007  # season start years, inclusive
CUP_SEASONS = [1996, 1997, 2001, 2007]
LOCKOUT_SEASONS = {2004}  # no games played; not a tenure gap
TEAM_NAME = "Detroit Red Wings"
ROLE_BY_POSITION = {"C": "Forward", "L": "Forward", "R": "Forward", "D": "Defenseman", "G": "Goalie"}
ROLE_ORDER = ["Forward", "Defenseman", "Goalie"]
# The API lists a single current/last position; override where it misrepresents the Detroit role
POSITION_OVERRIDES = {
    8460540: "D",  # Mathieu Dandenault: listed R, played defense for most of his Detroit tenure
}


HR_BASE = "https://www.hockey-reference.com"
HR_HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                            "(KHTML, like Gecko) Chrome/120 Safari/537.36"}
HR_DELAY = 4  # seconds between Hockey-Reference requests
HR_NAME_ALIASES = {"joey kocur": "joe kocur"}  # NHL API name -> Hockey-Reference name
DET = "DET"


def season_id(start_year):
    return f"{start_year}{start_year + 1}"


def fetch_json(url, cache_name):
    """Fetch a URL, caching the raw response under data/raw/."""
    path = os.path.join(RAW_DIR, cache_name)
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    req = urllib.request.Request(url, headers={"User-Agent": "rw-tenure-timeline/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.load(resp)
    with open(path, "w") as f:
        json.dump(data, f)
    time.sleep(0.25)
    return data


def playoff_player_ids(start_year):
    """Player ids with >=1 playoff game for DET in the given season."""
    ids = set()
    for kind in ("skater", "goalie"):
        exp = f'seasonId={season_id(start_year)} and gameTypeId=3 and teamAbbrevs="DET"'
        url = (f"https://api.nhle.com/stats/rest/en/{kind}/summary?limit=-1&cayenneExp="
               + urllib.parse.quote(exp))
        data = fetch_json(url, f"{kind}_playoffs_{season_id(start_year)}.json")
        ids.update(row["playerId"] for row in data["data"] if row.get("gamesPlayed", 0) >= 1)
    return ids


def detroit_seasons(landing):
    """Season start years with >=1 NHL game (any game type) for Detroit."""
    seasons = set()
    for s in landing.get("seasonTotals", []):
        if (s.get("leagueAbbrev") == "NHL"
                and s.get("teamName", {}).get("default") == TEAM_NAME
                and s.get("gamesPlayed", 0) >= 1):
            seasons.add(int(str(s["season"])[:4]))
    return sorted(seasons)


def seasons_played_anywhere(landing):
    """Season start years with >=1 game for any team in any league."""
    return {int(str(s["season"])[:4]) for s in landing.get("seasonTotals", []) if s.get("gamesPlayed", 0) >= 1}


def inactive_gaps(stints, landing):
    """Gaps between stints in which the player played for no one (injury, retirement)."""
    played = seasons_played_anywhere(landing)
    gaps = []
    for prev, nxt in zip(stints, stints[1:]):
        between = set(range(prev["end"] + 1, nxt["start"]))
        if not between & played:
            gaps.append({"start": prev["end"] + 1, "end": nxt["start"] - 1})
    return gaps


def build_stints(seasons):
    """Merge consecutive seasons into stints, bridging the lockout."""
    stints = []
    for year in seasons:
        if stints:
            prev_end = stints[-1]["end"]
            between = set(range(prev_end + 1, year))
            if between <= LOCKOUT_SEASONS:
                stints[-1]["end"] = year
                continue
        stints.append({"start": year, "end": year})
    return stints


def fetch_hr(path):
    """Fetch a Hockey-Reference page (uncached; callers cache what they extract)."""
    req = urllib.request.Request(HR_BASE + path, headers=HR_HEADERS)
    with urllib.request.urlopen(req, timeout=30) as resp:
        page = resp.read().decode("utf-8")
    time.sleep(HR_DELAY)
    return page


def name_key(name):
    plain = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower().strip()
    return HR_NAME_ALIASES.get(plain, plain)


def hr_ids(seasons):
    """Map normalized player name -> Hockey-Reference id from Detroit team pages for the given seasons."""
    path = os.path.join(RAW_DIR, "hr_ids.json")
    cache = {}
    if os.path.exists(path):
        with open(path) as f:
            cache = json.load(f)
    for year in seasons:
        if str(year) in cache:
            continue
        page = fetch_hr(f"/teams/DET/{year + 1}.html")
        ids = {}
        for m in re.finditer(r'data-append-csv="([^"]+)"[^>]*data-stat="name_display"[^>]*>(.*?)</t[dh]>', page):
            ids[name_key(html.unescape(re.sub(r"<[^>]+>", "", m.group(2))))] = m.group(1)
        cache[str(year)] = ids
        with open(path, "w") as f:
            json.dump(cache, f, indent=1, sort_keys=True)
    return {name: hid for ids in cache.values() for name, hid in ids.items()}


def hr_transactions(hr_id):
    """Transaction paragraphs from a Hockey-Reference player page, cached as an HTML snippet."""
    path = os.path.join(RAW_DIR, f"hr_transactions_{hr_id}.html")
    if not os.path.exists(path):
        page = fetch_hr(f"/players/{hr_id[0]}/{hr_id}.html")
        m = re.search(r'id="div_transactions">(.*?)</div>', page, re.S)
        with open(path, "w") as f:
            f.write(m.group(1).strip() if m else "")
    with open(path) as f:
        snippet = f.read()
    return re.findall(r"<p><strong>(.*?):</strong>(.*?)</p>", snippet, re.S)


HR_UNLINKED_TEAMS = {"ANA (NHL)": "Mighty Ducks of Anaheim", "QBN (NHL)": "Quebec Nordiques"}
TEAM = r"(?:the )?([^,()]+?)"  # a team name (never contains commas), with HR's optional leading "the"


def parse_transaction(body):
    """(kind, destination team, source team) for one HR transaction, or None if it doesn't move the player.

    A destination of None means the player left for no team (retired, released).
    """
    text = " ".join(html.unescape(re.sub(r"<[^>]+>", "", body)).split())
    for code, name in HR_UNLINKED_TEAMS.items():
        text = text.replace(code, name)
    if re.match(r"Traded by .*?\(as [^)]*draft pick", text):
        return None  # a trade of the draft pick that later became this player; the draft itself counts
    if m := re.match(rf"Traded by {TEAM}(?: with .*?)? to {TEAM}(?: for |\.$)", text):
        return "Trade", m.group(2), m.group(1)
    if m := re.match(r"Signed as a Free Agent with (?:the )?(.+?)\.?$", text):  # may be a non-NHL club
        return "Free agent", m.group(1), None
    if m := re.match(rf"(?:Claimed|Selected off waivers) by {TEAM} from {TEAM}(?: in Waiver Draft)?\.?$", text):
        return "Waivers", m.group(1), m.group(2)
    if m := re.match(rf"Drafted by {TEAM} from {TEAM} in the \d+ expansion draft", text):
        return "Expansion draft", m.group(1), m.group(2)
    if text.startswith(("Retired", "Released")):
        return "Left", None, None
    return None  # suspensions, tryouts, loans: no change of NHL team


def acquisitions(stints, inactive, landing, transactions):
    """How Detroit acquired the player for each stint not preceded by an inactive gap."""
    events = []  # (date, kind, dest, source, date label or draft details)
    dd = landing.get("draftDetails")
    if dd:
        draft_team = TEAM_NAME if dd["teamAbbrev"] == DET else dd["teamAbbrev"]
        events.append((datetime.date(dd["year"], 6, 30), "Draft", draft_team, None, dd))
    for date_text, body in transactions:
        parsed = parse_transaction(body)
        if parsed:
            date = datetime.datetime.strptime(date_text.strip(), "%B %d, %Y").date()
            events.append((date, *parsed, date_text.strip()))
    events.sort(key=lambda e: e[0])

    # Every move into Detroit from elsewhere
    entries, team = [], None
    for date, kind, dest, src, label in events:
        if dest == TEAM_NAME and team != TEAM_NAME:
            entries.append((date, kind, src, label))
        team = dest

    def team_at(date):
        return ([dest for d, _, dest, _, _ in events if d <= date] or [None])[-1]

    def season_end(year):
        return datetime.date(year + 1, 6, 30)

    inactive_ends = {g["end"] for g in inactive}
    result, prev_end = [], None
    for stint in stints:
        start_cutoff, end_cutoff = season_end(stint["start"]), season_end(stint["end"])
        window = [e for e in entries if (prev_end is None or e[0] > prev_end) and e[0] <= end_cutoff]
        prev_end = end_cutoff
        # Of the moves before the stint's first season ended, only the latest is how this stint began
        before = [e for e in window if e[0] <= start_cutoff]
        window = before[-1:] + [e for e in window if e[0] > start_cutoff]
        if not window:
            if stint["start"] - 1 in inactive_ends or team_at(datetime.date(stint["start"], 7, 1)) == TEAM_NAME:
                continue  # never left Detroit since the last stint (no-games gap or a spell in the minors)
            result.append({"season": stint["start"], "method": "Unknown"})
        for date, kind, src, label in window:
            season = max(stint["start"], date.year if date.month >= 7 else date.year - 1)
            acq = {"season": season, "method": kind}
            if kind == "Draft":
                acq.update(season=stint["start"], year=label["year"], round=label["round"], overall=label["overallPick"])
            else:
                acq["date"] = date.isoformat()
                if src:
                    acq["from"] = src
            result.append(acq)
    return result


def main():
    os.makedirs(RAW_DIR, exist_ok=True)

    playoff_seasons = {}  # playerId -> [season start years in window]
    for year in range(CORE_START, CORE_END + 1):
        for pid in playoff_player_ids(year):
            playoff_seasons.setdefault(pid, []).append(year)

    landings = {pid: fetch_json(f"https://api-web.nhle.com/v1/player/{pid}/landing", f"player_{pid}.json")
                for pid in playoff_seasons}
    ids_by_name = hr_ids(sorted({y for l in landings.values() for y in detroit_seasons(l)}))

    players = []
    for pid, seasons_in_window in playoff_seasons.items():
        landing = landings[pid]
        position = POSITION_OVERRIDES.get(pid, landing["position"])
        stints = build_stints(detroit_seasons(landing))
        inactive = inactive_gaps(stints, landing)
        name = f'{landing["firstName"]["default"]} {landing["lastName"]["default"]}'
        hr_id = ids_by_name.get(name_key(name))
        if not hr_id:
            raise SystemExit(f"No Hockey-Reference id for {name}; add an HR_NAME_ALIASES entry")
        players.append({
            "id": pid,
            "name": name,
            "lastName": landing["lastName"]["default"],
            "role": ROLE_BY_POSITION[position],
            "position": position,
            "stints": stints,
            "inactive": inactive,
            "playoffSeasonsInWindow": sorted(seasons_in_window),
            "acquisitions": acquisitions(stints, inactive, landing, hr_transactions(hr_id)),
        })

    players.sort(key=lambda p: (
        ROLE_ORDER.index(p["role"]),
        p["stints"][0]["start"],
        p["stints"][-1]["end"],
        p["lastName"],
    ))

    out = {
        "generated": datetime.date.today().isoformat(),
        "coreWindow": {"start": CORE_START, "end": CORE_END},
        "cupSeasons": CUP_SEASONS,
        "players": players,
    }
    with open(OUT_PATH, "w") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)

    earliest = min(players, key=lambda p: p["stints"][0]["start"])
    latest_end = max(p["stints"][-1]["end"] for p in players)
    print(f"Players: {len(players)}")
    for role in ROLE_ORDER:
        print(f"  {role}: {sum(p['role'] == role for p in players)}")
    print(f"Earliest start: {earliest['name']} ({earliest['stints'][0]['start']})")
    print("Latest end: " + ", ".join(
        f"{p['name']} ({latest_end})" for p in players if p["stints"][-1]["end"] == latest_end))
    for p in players:
        if len(p["stints"]) > 1:
            print(f"Multi-stint: {p['name']} {p['stints']}")
        if p["inactive"]:
            print(f"Inactive gaps: {p['name']} {p['inactive']}")
    for p in players:
        print(f"Acquired: {p['name']}: " + "; ".join(json.dumps(a) for a in p["acquisitions"]))


if __name__ == "__main__":
    main()
