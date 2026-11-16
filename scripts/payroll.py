"""Detroit's payroll against the league for each season, for the season-header tooltip. See PLAN.md ("Payroll")."""

import html
import os
import re
import time
import urllib.request
import zipfile
from xml.etree import ElementTree as ET

RAW_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "raw")
HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                         "(KHTML, like Gecko) Chrome/120 Safari/537.36"}

# Rodney Fort's Sports Business Data, NHL/NHLPayroll/"NHL Payrollindex.xlsx": every team, 1989-90 to 2018-19
FORT_URL = "https://drive.google.com/uc?export=download&id=1-2Yi-DkwRazL50LHoRbf4kmmOiyORSq8"
FORT_FIRST_SEASON = 1989
USA_TODAY_SEASONS = range(2000, 2014)  # Fort has several sources for some seasons; use USA Today for all of these
CAP_FIRST_SEASON = 2014  # cap hits from here on: Fort's columns are Spotrac's, and USA Today's salaries stop
# CapFriendly's final cap hits replace Spotrac's wherever archived: Spotrac's (as Fort recorded them) leave out
# injured players and put Detroit 18th-24th in 2015-19, when CapFriendly has them 1st-3rd
CAPFRIENDLY_FIRST_SEASON = 2015
# Wayback snapshots of capfriendly.com/archive/{end year}, by season start year
CAPFRIENDLY_SNAPSHOTS = {2015: "20230327160344", 2016: "20230525091620", 2017: "20230608160300",
                         2018: "20230829124834", 2019: "20230328093425", 2020: "20230516222113"}
SPOTRAC_NOTE = "Spotrac's figure, which may leave out injured players' cap hits. Later seasons use CapFriendly."
LTIR_NOTE_MIN = 500_000  # mention long-term injured reserve relief above this

# League size from each listed season on, to catch parsing mistakes
TEAM_COUNTS = {1989: 21, 1991: 22, 1992: 24, 1993: 26, 1998: 27, 1999: 28, 2000: 30, 2017: 31}

# Published lists missed money that was really paid that season
ADJUSTMENTS = {
    1997: (28_000_000, "Includes Sergei Fedorov's $28M, missing from the published payroll. He held out until "
                       "February 1998, then signed a six-year, $38M offer sheet with Carolina. Detroit matched it, "
                       "and its $14M signing bonus and $12M bonus for reaching the conference final were both "
                       "paid that season."),
}

# Salary cap (the CBA "Upper Limit") by season start year, from league announcements; matches the archived Wikipedia
# "List of team payrolls in the NHL" (2024-06-03) except 2012-13, which it gives as $60M. Contemporary reports
# (CBS, Globe and Mail) give $70.2M, prorated for the 48-game season; the payrolls are full-season figures too.
SALARY_CAP = {2005: 39_000_000, 2006: 44_000_000, 2007: 50_300_000, 2008: 56_700_000, 2009: 56_800_000,
              2010: 59_400_000, 2011: 64_300_000, 2012: 70_200_000, 2013: 64_300_000, 2014: 69_000_000,
              2015: 71_400_000, 2016: 73_000_000, 2017: 75_000_000, 2018: 79_500_000, 2019: 81_500_000,
              2020: 81_500_000}
CAP_NOTES = {2012: "prorated for the 48-game season"}
OVER_CAP_SALARY_NOTE = "Salaries paid can exceed the cap, which counts each contract's average annual value."

# Team payrolls weren't published before 1989-90. The Sporting News' NHL average salary (via Fort's
# NHLSalaries/NHLAveSal46-7to02-03.xls) scales the 1989-90 league-average payroll back to estimate earlier seasons.
TSN_AVERAGE_SALARY = {1983: 118_788, 1984: 127_273, 1985: 144_242, 1986: 169_697, 1987: 178_182,
                      1988: 188_000, 1989: 220_606}


def fetch_cached(url, name, retries=4):
    """Download a URL to data/raw/{name} unless it's already there; Wayback sometimes returns nothing, so retry."""
    path = os.path.join(RAW_DIR, name)
    if not os.path.exists(path):
        for attempt in range(retries):
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=60) as resp:
                body = resp.read()
            if body:
                break
            time.sleep(10 * (attempt + 1))
        else:
            raise SystemExit(f"Empty response from {url}")
        with open(path, "wb") as f:
            f.write(body)
        time.sleep(2)
    return path


def read_xlsx_rows(path):
    """Rows of the first sheet as lists of strings (Python's stdlib has no xlsx reader)."""
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    text = lambda el: "".join(t.text or "" for t in el.iter(f"{{{ns['m']}}}t"))
    with zipfile.ZipFile(path) as z:
        shared = [text(si) for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", ns)] \
            if "xl/sharedStrings.xml" in z.namelist() else []
        sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    rows = []
    for r in sheet.iter(f"{{{ns['m']}}}row"):
        cells = {}
        for c in r.findall("m:c", ns):
            col = 0
            for ch in re.match(r"[A-Z]+", c.get("r")).group(0):
                col = col * 26 + ord(ch) - 64
            v = c.find("m:v", ns)
            if v is not None:
                cells[col - 1] = shared[int(v.text)] if c.get("t") == "s" else v.text
            elif (inline := c.find("m:is", ns)) is not None:
                cells[col - 1] = text(inline)
        rows.append([cells.get(i, "") for i in range(max(cells) + 1)] if cells else [])
    return rows


def dollars(cell):
    """Fort's cells mix "$ 28,430,000", 5.2E7 and millions (28.4)."""
    value = float(re.sub(r"[$,\s\xa0]", "", cell))
    return round(value * 1e6 if value < 1000 else value)


def season_label(start):
    return f"{start}-{(start + 1) % 100:02d}"


def fort_payrolls():
    """{season: (payrolls by team label, Detroit's label, source)} from Fort's spreadsheet."""
    rows = read_xlsx_rows(fetch_cached(FORT_URL, "fort_nhl_payroll.xlsx"))
    header = rows[2]
    teams = [r for r in rows[3:] if r and r[0].strip() and not r[0].startswith(("Note", "Original"))]
    result = {}
    for season in range(FORT_FIRST_SEASON, CAPFRIENDLY_FIRST_SEASON):  # 2015-16 on comes from CapFriendly
        if season == 2004:
            continue  # lockout
        label = season_label(season)
        if season in USA_TODAY_SEASONS:
            col = next(i for i, h in enumerate(header) if h.startswith(label) and "USAToday" in h.replace(" ", ""))
            source = "USA Today salary database, via Rodney Fort"
        elif season >= CAP_FIRST_SEASON:
            col = next(i for i, h in enumerate(header) if h.startswith(label) and "trac" in h)
            source = "Spotrac, via Rodney Fort"
        else:
            col = header.index(label)
            source = "USA Today, via Rodney Fort" if season in (1996, 1997) else "Rodney Fort's Sports Business Data"
        payrolls = {r[0]: dollars(r[col]) for r in teams if col < len(r) and r[col].strip()}
        result[season] = (payrolls, next(t for t in payrolls if t.startswith("Detroit")), source)
    return result


def capfriendly_payrolls(season):
    """(final cap hit by team, Detroit's LTIR relief) from an archived CapFriendly "Past Salary Cap Payrolls" page."""
    end = season + 1
    url = f"http://web.archive.org/web/{CAPFRIENDLY_SNAPSHOTS[season]}id_/https://www.capfriendly.com/archive/{end}"
    with open(fetch_cached(url, f"capfriendly_archive_{end}.html"), encoding="utf-8") as f:
        page = f.read()
    payrolls, ltir = {}, {}
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", page, re.S):
        cells = [html.unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
        if len(cells) >= 3 and cells[1].startswith("$"):  # team, final cap hit, LTIR used, final cap space
            team = re.sub(r"(?<=[a-z])[A-Z]{3}$", "", cells[0])  # some snapshots append the abbreviation
            payrolls[team], ltir[team] = dollars(cells[1]), dollars(cells[2])
    return payrolls, ltir["Detroit Red Wings"]


def payroll_seasons(first, last):
    """One entry per season from first to last (start years), skipping the 2004-05 lockout."""
    fort = fort_payrolls()
    base_avg = sum(fort[1989][0].values()) / len(fort[1989][0])
    seasons = []
    for season in range(first, last + 1):
        if season == 2004:
            continue
        if season < FORT_FIRST_SEASON:
            seasons.append({"season": season, "estimate": True,
                            "leagueAvg": round(base_avg * TSN_AVERAGE_SALARY[season] / TSN_AVERAGE_SALARY[1989]),
                            "avgSalary": TSN_AVERAGE_SALARY[season]})
            continue
        entry = {"season": season, "measure": "cap" if season >= CAP_FIRST_SEASON else "salary"}
        if season >= CAPFRIENDLY_FIRST_SEASON:
            payrolls, ltir = capfriendly_payrolls(season)
            det, entry["source"] = "Detroit Red Wings", "CapFriendly (archived)"
            if ltir >= LTIR_NOTE_MIN:
                entry["note"] = (f"Includes ${ltir / 1e6:.1f}M over the cap, allowed because injured players "
                                 "were on long-term injured reserve.")
        else:
            payrolls, det, entry["source"] = fort[season]
            payrolls = dict(payrolls)
            if season >= CAP_FIRST_SEASON:
                entry["note"] = SPOTRAC_NOTE
        if season in ADJUSTMENTS:
            amount, entry["note"] = ADJUSTMENTS[season]
            payrolls[det] += amount
        expected = TEAM_COUNTS[max(s for s in TEAM_COUNTS if s <= season)]
        if len(payrolls) != expected:
            raise SystemExit(f"{season_label(season)}: {len(payrolls)} team payrolls, expected {expected}")
        ranked = sorted(payrolls.values(), reverse=True)
        others = sorted((v for t, v in payrolls.items() if t != det), reverse=True)
        entry.update(detroit=payrolls[det], rank=ranked.index(payrolls[det]) + 1, teams=len(payrolls),
                     leagueAvg=round(sum(ranked) / len(ranked)), topOthersAvg=round(sum(others[:5]) / 5))
        if season in SALARY_CAP:
            entry["cap"] = SALARY_CAP[season]
            if season in CAP_NOTES:
                entry["capNote"] = CAP_NOTES[season]
            if entry["measure"] == "salary" and entry["detroit"] > entry["cap"]:
                entry["note"] = " ".join(filter(None, [entry.get("note"), OVER_CAP_SALARY_NOTE]))
        seasons.append(entry)
    return seasons
