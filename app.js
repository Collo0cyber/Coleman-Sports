/* League site: reads plain-text season files from data/, builds fixtures,
   applies results, and renders table / matches / scorers / teams. No build step. */
'use strict';

const PALETTE = ['#d62839', '#1d70b8', '#2a9d55', '#d99a00', '#7b3fbf', '#e76f00', '#0e8f8f', '#5c6670'];
const app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s).trim().toLowerCase().replace(/\s+/g, ' ');

const ADMIN = (() => {
  const q = new URLSearchParams(location.search);
  try {
    if (q.has('admin')) localStorage.setItem('admin', q.get('admin') === 'off' ? '' : '1');
    return !!localStorage.getItem('admin');
  } catch { return q.has('admin') && q.get('admin') !== 'off'; }
})();

/* ───────────── parsing ───────────── */

function parseSeason(text, file) {
  const S = { file, name: file.replace(/\.txt$/i, ''), cycles: 1, start: null, every: 7, teams: [], entries: [], issues: [] };
  const issue = (ln, msg) => S.issues.push({ ln, msg });
  let team = null, gw = null;

  text.split(/\r?\n/).forEach((raw, i) => {
    const ln = i + 1;
    const line = raw.replace(/\/\/.*$/, '').trim();
    if (!line) return;
    let m;
    if ((m = line.match(/^(season|name|cycles|start|every)\s*:\s*(.*)$/i))) {
      const k = m[1].toLowerCase(), v = m[2].trim();
      if (k === 'season' || k === 'name') S.name = v;
      else if (k === 'cycles') S.cycles = Math.min(50, Math.max(1, parseInt(v, 10) || 1));
      else if (k === 'every') S.every = Math.max(1, parseInt(v, 10) || 7);
      else if (k === 'start') {
        const d = new Date(v + 'T12:00:00');
        if (isNaN(d)) issue(ln, `Can't read start date "${v}" (use YYYY-MM-DD)`); else S.start = d;
      }
    } else if ((m = line.match(/^team\s*:\s*(.+)$/i))) {
      const [name, color] = m[1].split('|').map(x => x.trim());
      if (S.teams.some(t => norm(t.name) === norm(name))) issue(ln, `Team "${name}" is listed twice`);
      team = { name, color: /^#[0-9a-f]{3,8}$/i.test(color || '') ? color : PALETTE[S.teams.length % PALETTE.length], players: [] };
      S.teams.push(team);
    } else if ((m = line.match(/^players?\s*:\s*(.*)$/i))) {
      if (!team) issue(ln, 'Players line comes before any team: line');
      else team.players.push(...m[1].split(',').map(x => x.trim()).filter(Boolean));
    } else if ((m = line.match(/^(?:gw|gameweek|week|round|matchday)\s*(\d+)\s*:?\s*$/i))) {
      gw = +m[1];
    } else {
      const ci = line.indexOf(':');
      const head = ci < 0 ? line : line.slice(0, ci);
      const mm = head.match(/^(.+?)\s+(\d+)\s*[-–—]\s*(\d+)\s+(.+)$/);
      if (mm) S.entries.push({ ln, gw, home: mm[1].trim(), hs: +mm[2], as: +mm[3], away: mm[4].trim(), scorers: ci < 0 ? '' : line.slice(ci + 1) });
      else issue(ln, `Can't read: "${line}"`);
    }
  });

  buildFixtures(S);
  applyResults(S);
  computeStats(S);
  return S;
}

/* Circle-method round robin, repeated `cycles` times with home/away flipped every other cycle. */
function buildFixtures(S) {
  S.gws = [];
  if (S.teams.length < 2) return;
  const t = S.teams.map(x => x.name);
  if (t.length % 2) t.push(null);
  const n = t.length, rounds = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs = [], byes = [];
    for (let i = 0; i < n / 2; i++) {
      let h = t[i], a = t[n - 1 - i];
      if (i === 0 ? r % 2 === 1 : i % 2 === 1) [h, a] = [a, h];
      if (h === null) byes.push(a); else if (a === null) byes.push(h); else pairs.push([h, a]);
    }
    rounds.push({ pairs, byes });
    t.splice(1, 0, t.pop());
  }
  let id = 0;
  for (let c = 0; c < S.cycles; c++) {
    rounds.forEach((rd, r) => {
      const no = c * (n - 1) + r + 1;
      const date = S.start ? new Date(S.start.getTime() + (no - 1) * S.every * 864e5) : null;
      S.gws.push({
        no, date, byes: rd.byes,
        matches: rd.pairs.map(([h, a]) => (c % 2 ? [a, h] : [h, a])).map(([home, away]) => ({ id: id++, gw: no, home, away, result: null })),
      });
    });
  }
}

function applyResults(S) {
  const teamBy = name => S.teams.find(t => norm(t.name) === norm(name));
  const issue = (ln, msg) => S.issues.push({ ln, msg });
  for (const e of S.entries) {
    const h = teamBy(e.home), a = teamBy(e.away);
    if (!h || !a) { issue(e.ln, `Unknown team "${!h ? e.home : e.away}"`); continue; }
    if (h === a) { issue(e.ln, 'A team can\'t play itself'); continue; }
    if (e.gw && !S.gws.some(g => g.no === e.gw)) { issue(e.ln, `There is no GW${e.gw} (season has ${S.gws.length})`); continue; }
    const pool = (e.gw ? S.gws.filter(g => g.no === e.gw) : S.gws).flatMap(g => g.matches)
      .filter(m => !m.result && [m.home, m.away].includes(h.name) && [m.home, m.away].includes(a.name));
    const fx = pool.find(m => m.home === h.name) || pool[0];
    if (!fx) {
      issue(e.ln, e.gw ? `${h.name} v ${a.name} isn't a fixture in GW${e.gw} (or is entered twice)` : `No unplayed ${h.name} v ${a.name} fixture left`);
      continue;
    }
    const flipped = fx.home !== h.name;
    if (flipped) issue(e.ln, `Fixture is ${fx.home} (home) v ${fx.away}; entered the other way round, saved as ${fx.home} ${e.as}-${e.hs} ${fx.away}`);
    const goals = parseScorers(e, h, a, issue);
    fx.result = {
      hs: flipped ? e.as : e.hs,
      as: flipped ? e.hs : e.as,
      goals: goals.map(g => ({ ...g, side: g.forTeam === fx.home ? 'home' : 'away' })),
      ln: e.ln,
    };
  }
}

function findPlayer(name, team) {
  const q = norm(name);
  const exact = team.players.find(p => norm(p) === q);
  if (exact) return [exact];
  return team.players.filter(p => norm(p).split(' ').includes(q) || norm(p).startsWith(q + ' ') || norm(p).startsWith(q));
}

function parseScorers(e, h, a, issue) {
  const goals = [], unknown = [];
  for (let tok of e.scorers.split(/[,;]/)) {
    tok = tok.trim();
    if (!tok) continue;
    let og = false, pen = false, count = 1, mins = [];
    tok = tok.replace(/\(\s*o\.?g\.?\s*\)|\bo\.?g\.?(?=\s|$)/i, () => { og = true; return ' '; });
    tok = tok.replace(/\(\s*(p|pen)\s*\)|\bpen\b/i, () => { pen = true; return ' '; });
    tok = tok.replace(/\s*[x×]\s*(\d+)\s*$/i, (_, n) => { count = +n; return ''; });
    tok = tok.replace(/((?:\s+\(?\d{1,3}(?:\+\d{1,2})?\s*'?\)?)+)\s*$/, s => { mins = s.trim().split(/\s+/).map(x => x.replace(/[()']/g, '')); return ''; });
    const name = tok.replace(/\s+/g, ' ').trim();
    if (!name) { issue(e.ln, 'A goal is missing the scorer\'s name'); continue; }
    if (mins.length > 1) count = mins.length;

    const inH = findPlayer(name, h), inA = findPlayer(name, a);
    let player = null, team = null;
    if (inH.length + inA.length === 1) { player = inH[0] || inA[0]; team = inH.length ? h : a; }
    else if (inH.length + inA.length > 1) issue(e.ln, `"${name}" matches more than one player (${[...inH, ...inA].join(', ')}). Use the full name`);

    for (let k = 0; k < count; k++) {
      const g = { player: player || name, team: team?.name || null, min: mins[k] || null, og, pen };
      if (team) { g.forTeam = og ? (team === h ? a.name : h.name) : team.name; goals.push(g); }
      else unknown.push(g);
    }
  }
  // Players not on either list (guests): give them to the side that's short of goals, if that's clear.
  if (unknown.length) {
    const hg = goals.filter(g => g.forTeam === h.name).length, ag = goals.length - hg;
    const shortH = e.hs - hg, shortA = e.as - ag;
    for (const g of unknown) {
      const side = shortH > 0 && shortA <= 0 ? h : shortA > 0 && shortH <= 0 ? a : null;
      if (side && !g.og) {
        g.team = side.name; g.forTeam = side.name; g.guest = true; goals.push(g);
        issue(e.ln, `"${g.player}" isn't in either squad; counted for ${side.name}. Add them to the players list`);
      } else {
        issue(e.ln, `Unknown player "${g.player}": add them to a team's players line`);
      }
    }
  }
  const hg = goals.filter(g => g.forTeam === h.name).length, ag = goals.length - hg;
  if (goals.length && (hg !== e.hs || ag !== e.as)) issue(e.ln, `Scorers add up to ${hg}-${ag} but the score is ${e.hs}-${e.as}`);
  return goals;
}

function computeStats(S) {
  const row = {};
  S.teams.forEach(t => (row[t.name] = { team: t, P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, Pts: 0, form: [] }));
  const scorers = new Map();
  S.played = 0; S.total = 0;
  for (const g of S.gws) for (const m of g.matches) {
    S.total++;
    if (!m.result) continue;
    S.played++;
    const { hs, as } = m.result, H = row[m.home], A = row[m.away];
    H.P++; A.P++; H.GF += hs; H.GA += as; A.GF += as; A.GA += hs;
    if (hs > as) { H.W++; A.L++; H.Pts += 3; H.form.push('W'); A.form.push('L'); }
    else if (hs < as) { A.W++; H.L++; A.Pts += 3; H.form.push('L'); A.form.push('W'); }
    else { H.D++; A.D++; H.Pts++; A.Pts++; H.form.push('D'); A.form.push('D'); }
    for (const goal of m.result.goals) {
      if (goal.og) continue;
      const key = goal.team + '|' + goal.player;
      const s = scorers.get(key) || { player: goal.player, team: goal.team, goals: 0, pens: 0 };
      s.goals++; if (goal.pen) s.pens++;
      scorers.set(key, s);
    }
  }
  S.table = Object.values(row).map(r => ({ ...r, GD: r.GF - r.GA }))
    .sort((x, y) => y.Pts - x.Pts || y.GD - x.GD || y.GF - x.GF || x.team.name.localeCompare(y.team.name));
  S.scorers = [...scorers.values()].sort((x, y) => y.goals - x.goals || x.player.localeCompare(y.player));
  rank(S.table, r => `${r.Pts}|${r.GD}|${r.GF}`);
  rank(S.scorers, s => s.goals);
  const next = S.gws.find(g => g.matches.some(m => !m.result));
  S.currentGw = next ? next.no : (S.gws.at(-1)?.no || 1);
}

function rank(list, key) {
  list.forEach((r, i) => (r.rank = i && key(list[i - 1]) === key(r) ? list[i - 1].rank : i + 1));
}

/* ───────────── rendering ───────────── */

const state = { seasons: [], si: 0 };
const S = () => state.seasons[state.si];
const team = name => S().teams.find(t => t.name === name);
const fmtDate = d => d ? d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : '';

function crest(t, size = '') {
  if (!t) return '<span class="crest">?</span>';
  const ini = t.name.split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return `<span class="crest ${size}" style="--c:${esc(t.color)}" aria-hidden="true">${esc(ini)}</span>`;
}

function viewTable() {
  const s = S();
  if (!s.teams.length) return empty('No teams yet. Add <code>team:</code> lines to the season file.');
  const rows = s.table.map(r => `
    <tr>
      <td class="pos">${r.rank}</td>
      <td class="tm"><a href="#teams/${encodeURIComponent(r.team.name)}">${crest(r.team)}<span>${esc(r.team.name)}</span></a></td>
      <td>${r.P}</td><td>${r.W}</td><td>${r.D}</td><td>${r.L}</td>
      <td class="wide">${r.GF}</td><td class="wide">${r.GA}</td>
      <td>${r.GD > 0 ? '+' : ''}${r.GD}</td>
      <td class="pts">${r.Pts}</td>
      <td class="form wide">${r.form.slice(-5).map(f => `<i class="f${f}" title="${f}">${f}</i>`).join('')}</td>
    </tr>`).join('');
  return `
    <section class="card flush">
      <table class="standings">
        <thead><tr><th class="pos">#</th><th class="tm">Team</th><th>P</th><th>W</th><th>D</th><th>L</th>
          <th class="wide">GF</th><th class="wide">GA</th><th>GD</th><th class="pts">Pts</th><th class="form wide">Form</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
    <p class="note">3 pts for a win, 1 for a draw. Ties split by goal difference, then goals scored.</p>
    ${s.scorers.length ? `<h2 class="sub">Top scorers <a href="#scorers">See all</a></h2>${scorerList(s.scorers.slice(0, 3))}` : ''}`;
}

function viewMatches(gwNo) {
  const s = S();
  if (!s.gws.length) return empty('Add at least two teams to generate fixtures.');
  const gw = s.gws.find(g => g.no === gwNo) || s.gws.find(g => g.no === s.currentGw);
  const chips = s.gws.map(g => {
    const done = g.matches.every(m => m.result), part = !done && g.matches.some(m => m.result);
    return `<a href="#matches/${g.no}" class="chip ${g.no === gw.no ? 'on' : ''} ${done ? 'done' : part ? 'part' : ''}" ${g.no === gw.no ? 'aria-current="true"' : ''}>${g.no}</a>`;
  }).join('');
  const prev = s.gws.find(g => g.no === gw.no - 1), next = s.gws.find(g => g.no === gw.no + 1);
  return `
    <nav class="gwbar" aria-label="Gameweeks"><div class="chips" id="chips">${chips}</div></nav>
    <div class="gwhead">
      ${prev ? `<a class="arrow" href="#matches/${prev.no}" aria-label="Previous gameweek">‹</a>` : '<span class="arrow off">‹</span>'}
      <div><h2>Gameweek ${gw.no}</h2><div class="muted">${fmtDate(gw.date)}${gw.no === s.currentGw && gw.matches.some(m => !m.result) ? ' · <b>Up next</b>' : ''}</div></div>
      ${next ? `<a class="arrow" href="#matches/${next.no}" aria-label="Next gameweek">›</a>` : '<span class="arrow off">›</span>'}
    </div>
    ${gw.matches.map(matchCard).join('')}
    ${gw.byes.length ? `<p class="note">Bye: ${gw.byes.map(esc).join(', ')}</p>` : ''}
    ${ADMIN ? adminGw(gw) : ''}`;
}

function matchCard(m) {
  const r = m.result, H = team(m.home), A = team(m.away);
  const list = side => {
    if (!r) return '';
    const by = new Map();
    r.goals.filter(g => g.side === side).forEach(g => {
      const k = g.player + (g.og ? '|og' : '');
      const e = by.get(k) || { name: g.player, og: g.og, bits: [] };
      e.bits.push((g.min ? g.min + "'" : '') + (g.pen ? (g.min ? ' ' : '') + 'pen' : ''));
      by.set(k, e);
    });
    return [...by.values()].map(e => {
      const bits = e.bits.filter(Boolean), n = e.bits.length;
      const extra = bits.length ? ' ' + bits.join(', ') : n > 1 ? ` ×${n}` : '';
      return `<li>${esc(e.name)}<span class="min">${esc(extra)}${e.og ? ' (og)' : ''}</span></li>`;
    }).join('');
  };
  const hl = list('home'), al = list('away');
  const win = r ? (r.hs > r.as ? 'home' : r.hs < r.as ? 'away' : '') : '';
  return `
    <article class="card match ${r ? 'played' : ''}">
      <div class="row">
        <div class="side home ${win === 'home' ? 'win' : ''}">${crest(H)}<span>${esc(m.home)}</span></div>
        ${r ? `<div class="score"><b>${r.hs}</b><i>–</i><b>${r.as}</b></div>` : '<div class="score vs">vs</div>'}
        <div class="side away ${win === 'away' ? 'win' : ''}"><span>${esc(m.away)}</span>${crest(A)}</div>
      </div>
      ${hl || al ? `<div class="goals"><ul class="home">${hl}</ul><span class="ball" aria-hidden="true">⚽</span><ul class="away">${al}</ul></div>` : ''}
    </article>`;
}

function scorerList(list) {
  return `<ol class="card flush scorers">${list.map(s => `
    <li class="${s.rank <= 3 ? 'top' + s.rank : ''}">
      <span class="pos">${s.rank}</span>
      ${crest(team(s.team))}
      <span class="who"><b>${esc(s.player)}</b><small>${esc(s.team || '')}${s.pens ? ` · ${s.pens} pen` : ''}</small></span>
      <span class="g">${s.goals}</span>
    </li>`).join('')}</ol>`;
}

function viewScorers() {
  const s = S();
  return s.scorers.length ? `<h2 class="sub">Top scorers</h2>${scorerList(s.scorers)}<p class="note">Own goals aren't counted.</p>`
    : empty('No goals yet.');
}

function viewTeams(focus) {
  const s = S();
  if (!s.teams.length) return empty('No teams yet.');
  const goalsBy = new Map(s.scorers.map(x => [x.team + '|' + x.player, x.goals]));
  return s.teams.map(t => {
    const r = s.table.find(x => x.team === t);
    const players = [...t.players].sort((a, b) => (goalsBy.get(t.name + '|' + b) || 0) - (goalsBy.get(t.name + '|' + a) || 0) || a.localeCompare(b));
    return `
      <section class="card teamcard" id="team-${esc(t.name)}" ${focus === t.name ? 'data-focus' : ''}>
        <header>${crest(t, 'lg')}<div><h2>${esc(t.name)}</h2>
          <div class="muted">${ordinal(r.rank)} · ${r.Pts} pts · W${r.W} D${r.D} L${r.L}</div></div></header>
        <ul class="squad">${players.map(p => {
          const g = goalsBy.get(t.name + '|' + p) || 0;
          return `<li><span>${esc(p)}</span>${g ? `<b>${g} ⚽</b>` : ''}</li>`;
        }).join('') || '<li class="muted">No players listed</li>'}</ul>
      </section>`;
  }).join('');
}

const ordinal = n => {
  const t = n % 100, u = n % 10;
  return n + (t >= 11 && t <= 13 ? 'th' : u === 1 ? 'st' : u === 2 ? 'nd' : u === 3 ? 'rd' : 'th');
};
const empty = html => `<div class="card empty">${html}</div>`;

/* Admin-only: template for the gameweek + list of problems in the file. */
function adminGw(gw) {
  const tpl = `GW${gw.no}\n` + gw.matches.map(m => m.result ? null : `${m.home} 0-0 ${m.away}: `).filter(Boolean).join('\n');
  const open = gw.matches.some(m => !m.result);
  return open ? `
    <section class="card admin">
      <h3>Template for GW${gw.no}</h3>
      <p class="muted">Copy this, paste it at the end of <code>data/${esc(S().file)}</code>, then fill in scores and scorers.</p>
      <pre id="tpl">${esc(tpl)}</pre>
      <div class="btns"><button type="button" id="copy">Copy</button>${editLink()}</div>
    </section>` : '';
}

function editLink() {
  const host = location.hostname;
  if (!host.endsWith('.github.io')) return '';
  const user = host.split('.')[0];
  const seg = location.pathname.split('/').filter(Boolean)[0];
  const repo = seg && !seg.includes('.') ? seg : `${user}.github.io`;
  return `<a class="btn" href="https://github.com/${user}/${repo}/edit/main/data/${encodeURIComponent(S().file)}" target="_blank" rel="noopener">Edit on GitHub</a>`;
}

function issuesPanel() {
  if (!ADMIN) return '';
  const s = S();
  return `
    <section class="card admin ${s.issues.length ? 'warn' : 'ok'}">
      <h3>${s.issues.length ? `⚠ ${s.issues.length} thing${s.issues.length > 1 ? 's' : ''} to check in ${esc(s.file)}` : `✓ ${esc(s.file)} reads cleanly`}</h3>
      ${s.issues.length ? `<ul>${s.issues.sort((a, b) => a.ln - b.ln).map(i => `<li><b>Line ${i.ln}</b> ${esc(i.msg)}</li>`).join('')}</ul>` : ''}
      <p class="muted">You see this box because admin mode is on for this browser. <a href="?admin=off">Turn off</a></p>
    </section>`;
}

/* ───────────── shell ───────────── */

function render() {
  const s = S();
  const [tab = 'table', arg] = decodeURIComponent(location.hash.slice(1)).split('/');
  const views = { table: viewTable, matches: () => viewMatches(+arg), scorers: viewScorers, teams: () => viewTeams(arg) };
  const view = views[tab] ? tab : 'table';
  document.title = s.name;
  app.innerHTML = `
    <header class="top">
      <div class="title">
        <h1>${esc(s.name)}</h1>
        <div class="muted">${s.played} of ${s.total} matches played${s.gws.length ? ` · ${s.gws.length} gameweeks` : ''}</div>
      </div>
      ${state.seasons.length > 1 ? `<select id="season" aria-label="Season">${state.seasons.map((x, i) => `<option value="${i}" ${i === state.si ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>` : ''}
    </header>
    <main>${issuesPanel()}${views[view]()}</main>
    <nav class="tabs" aria-label="Sections">
      ${[['table', 'Table', '▤'], ['matches', 'Matches', '◷'], ['scorers', 'Scorers', '⚽'], ['teams', 'Teams', '◉']]
        .map(([k, label, ic]) => `<a href="#${k}" class="${k === view ? 'on' : ''}" ${k === view ? 'aria-current="page"' : ''}><span aria-hidden="true">${ic}</span>${label}</a>`).join('')}
    </nav>`;

  document.getElementById('season')?.addEventListener('change', e => {
    state.si = +e.target.value;
    try { localStorage.setItem('season', S().file); } catch {}
    render();
  });
  document.getElementById('copy')?.addEventListener('click', async e => {
    try { await navigator.clipboard.writeText(document.getElementById('tpl').textContent); e.target.textContent = 'Copied ✓'; }
    catch { e.target.textContent = 'Select & copy manually'; }
  });
  document.querySelector('.chip.on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  document.querySelector('[data-focus]')?.scrollIntoView({ block: 'start' });
  if (!document.querySelector('[data-focus]')) window.scrollTo(0, 0);
}

async function start() {
  try {
    let files = ['season.txt'];
    const idx = await fetch('data/seasons.json?v=' + Date.now(), { cache: 'no-store' });
    if (idx.ok) files = await idx.json();
    state.seasons = await Promise.all(files.map(async f => {
      const r = await fetch('data/' + encodeURIComponent(f) + '?v=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) throw new Error(`Couldn't load data/${f} (${r.status})`);
      return parseSeason(await r.text(), f);
    }));
    let saved = null;
    try { saved = localStorage.getItem('season'); } catch {}
    state.si = Math.max(0, state.seasons.findIndex(x => x.file === saved));
    render();
    window.addEventListener('hashchange', render);
  } catch (err) {
    app.innerHTML = `<main>${empty(`<b>Couldn't load the league data.</b><br>${esc(err.message)}`)}</main>`;
  }
}

start();
