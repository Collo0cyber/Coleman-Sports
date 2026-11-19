# League site

A small football league website for GitHub Pages. You write results as plain text and the site builds the rest:

- **Fixtures and gameweeks**, generated as a round robin repeated as many times as you like (`cycles:`)
- **Results** with goal scorers
- **League table**: P W D L GF GA GD Pts + form
- **Top scorers**
- **Team squads** with goals per player

There's no build step, no database and no server: just 4 files plus your data.

```
index.html   app.js   style.css   .nojekyll
data/seasons.json   ← list of season files (newest first)
data/2026-27.txt    ← the season: teams, players, results  ← YOU EDIT THIS
```

## Publish on GitHub Pages (once)
1. Create a new **public** repository on GitHub, e.g. `league`.
2. Upload all these files, keeping the `data/` folder (**Add file → Upload files**).
3. **Settings → Pages → Build and deployment**: Source = *Deploy from a branch*, Branch = `main` / `(root)` → **Save**.
4. After about a minute the site is live at `https://<your-username>.github.io/league/`.

## Each gameweek (works from your phone)
1. Open your site with **`?admin`** at the end of the address, e.g. `https://you.github.io/league/?admin`.
   Your browser then remembers admin mode. Readers never see it.
2. On **Matches**, the next gameweek shows a **template**: tap **Copy**, then **Edit on GitHub**.
3. Paste the template at the bottom of the file and fill it in, then **Commit changes**:
   ```
   GW4
   Red Lions 3-1 Green Eagles: Ali 10', Ali 44', Dan, Kofi pen
   Blue Sharks 0-0 Gold Tigers:
   ```
4. Reload the site within a minute or two. A yellow box at the top lists anything it couldn't understand
   (unknown player, scorers not adding up to the score, wrong fixture…) with the line number.

### Scorer shorthand
| Write | Means |
|---|---|
| `Ali` | one goal (first name OK if unique in that match) |
| `Ali 12', 55'` or `Ali 12' 55'` | two goals with minutes |
| `Ali x2` | two goals, no minutes |
| `Ali pen 30'` | penalty |
| `Ivan og` | own goal: counts for the *other* team, not in top scorers |
| `90+2'` | stoppage-time minute |

A player who isn't on either squad is counted for the side that is short of goals, and you get a warning to add them.

## Settings (top of the season file)
```
season: Sunday League 2026/27
cycles: 4          // 4 teams → 6 matches per cycle → 24 matches, 12 gameweeks
start: 2026-12-06  // optional, gameweek 1 date
every: 7           // optional, days between gameweeks
team: Red Lions | #d62839
players: Ali Hassan, Ben Okoro, ...
```
- Any number of teams works. With an odd number, one team has a bye each gameweek.
- Home and away swap every cycle.
- **Don't reorder teams or lower `cycles` mid-season**: the order decides the fixtures. Raising `cycles` just adds gameweeks at the end.
- Table order: points → goal difference → goals scored.

## New season
Copy `data/2026-27.txt` to e.g. `data/2027-28.txt`, delete the results and put it first in `data/seasons.json`:
```json
["2027-28.txt", "2026-27.txt"]
```
A season picker appears in the header automatically.

## Preview on a computer
Open a terminal in this folder and run `python -m http.server`, then visit http://localhost:8000.
Opening `index.html` directly doesn't work because browsers block reading the data files that way.
