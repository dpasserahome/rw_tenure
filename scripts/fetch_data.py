#!/usr/bin/env python3
"""Build data/players.json from the NHL stats API. See PLAN.md for the rules."""

import datetime
import json
import os
import time
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


def main():
    os.makedirs(RAW_DIR, exist_ok=True)

    playoff_seasons = {}  # playerId -> [season start years in window]
    for year in range(CORE_START, CORE_END + 1):
        for pid in playoff_player_ids(year):
            playoff_seasons.setdefault(pid, []).append(year)

    players = []
    for pid, seasons_in_window in playoff_seasons.items():
        landing = fetch_json(f"https://api-web.nhle.com/v1/player/{pid}/landing", f"player_{pid}.json")
        position = POSITION_OVERRIDES.get(pid, landing["position"])
        stints = build_stints(detroit_seasons(landing))
        players.append({
            "id": pid,
            "name": f'{landing["firstName"]["default"]} {landing["lastName"]["default"]}',
            "lastName": landing["lastName"]["default"],
            "role": ROLE_BY_POSITION[position],
            "position": position,
            "stints": stints,
            "inactive": inactive_gaps(stints, landing),
            "playoffSeasonsInWindow": sorted(seasons_in_window),
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


if __name__ == "__main__":
    main()
