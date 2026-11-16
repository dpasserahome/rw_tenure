# Red Wings Roster Timeline

Live site: https://dpasserahome.github.io/rw_tenure/

An interactive timeline showing the Detroit tenure of every Red Wings player who played in the playoffs from 1996-97 through 2007-08, with how Detroit acquired them and links to their Hockey-Reference pages.
`scripts/fetch_data.py` pulls the data from the NHL stats API and Hockey-Reference into `data/players.json`, and `index.html` renders it with D3.
Run `python3 -m http.server 8000` and open http://localhost:8000.
