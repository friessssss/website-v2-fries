"""One-off: convert the Christmas League workbook (2021-2023) to JSON.

Usage: python3 -I scripts/christmas-league/convert.py <workbook.xlsx> <out.json>

The workbook is untrusted data: it is only read (data_only=True), never executed.
"""
import json
import re
import sys
import warnings

import openpyxl

warnings.filterwarnings("ignore")

SEASONS = [
    # (year, sheet, ISO date of the first known night)
    (2021, "Data CY 2021", "2021-09-22T20:00:00-06:00"),
    (2022, "Data CY 2022", "2022-12-01T20:00:00-07:00"),
    (2023, "The Data", "2023-11-07T20:00:00-07:00"),
]
EXPECTED = {  # year: (songs, goals for, goals against)
    2021: (56, 155, 159),
    2022: (66, 128, 110),
    2023: (80, 237, 188),
}


def num(v, where):
    if v is None or (isinstance(v, str) and not v.strip()):
        return 0
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise SystemExit(f"{where}: non-numeric cell {v!r}")
    if v != int(v) or v < 0:
        raise SystemExit(f"{where}: expected a whole number >= 0, got {v!r}")
    return int(v)


def text(v):
    return " ".join(str(v).split()) if v is not None else ""


def convert_sheet(ws, year):
    header = [text(c) for c in next(ws.iter_rows(min_row=2, max_row=2, values_only=True))]
    cols = {"Song Title": 0, "Artist": 1, "Goals For": 2, "Goals Against": 3}
    for k, i in cols.items():
        if header[i] != k:
            raise SystemExit(f"{ws.title}: expected column {i} to be {k!r}, got {header[i]!r}")
    players = []
    for i, h in enumerate(header):
        m = re.fullmatch(r"(\S+) Scored", h)
        if m:
            players.append((i, m.group(1)))
    songs = []
    for r, row in enumerate(ws.iter_rows(min_row=3, values_only=True), start=3):
        title = text(row[0])
        if not title:
            break
        where = f"{ws.title} row {r}"
        by_player = {}
        for i, name in players:
            n = num(row[i], f"{where} {name}")
            if n:
                by_player[name] = n
        songs.append(
            {
                "song": title,
                "artist": text(row[1]),
                "goalsFor": num(row[2], f"{where} Goals For"),
                "goalsAgainst": num(row[3], f"{where} Goals Against"),
                "byPlayer": by_player,
            }
        )
    return songs


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: convert.py <workbook.xlsx> <out.json>")
    wb = openpyxl.load_workbook(sys.argv[1], data_only=True, read_only=False)
    seasons = []
    for year, sheet, date in SEASONS:
        songs = convert_sheet(wb[sheet], year)
        got = (len(songs), sum(s["goalsFor"] for s in songs), sum(s["goalsAgainst"] for s in songs))
        if got != EXPECTED[year]:
            raise SystemExit(f"{year}: expected (songs, GF, GA) {EXPECTED[year]}, sheet has {got}")
        seasons.append({"year": year, "sessionId": f"christmas-league-{year}", "date": date, "songs": songs})
    with open(sys.argv[2], "w", encoding="utf-8") as f:
        json.dump({"seasons": seasons}, f, ensure_ascii=False, indent=1)
        f.write("\n")
    for s in seasons:
        print(s["year"], len(s["songs"]), "songs")


main()
