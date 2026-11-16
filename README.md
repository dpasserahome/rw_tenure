# Red Wings Roster Timeline

Live site: https://dpasserahome.github.io/rw_tenure/

An interactive timeline showing the Detroit tenure of every Red Wings player who played in the playoffs from 1996-97 through 2007-08, with how Detroit acquired them, links to their Hockey-Reference pages, and Detroit's payroll against the league each season.
`scripts/fetch_data.py` pulls the data from the NHL stats API, Hockey-Reference, and payroll sources (Rodney Fort's Sports Business Data, archived CapFriendly) into `data/players.json`, and `index.html` renders it with D3.
Run `python3 -m http.server 8000` and open http://localhost:8000.
