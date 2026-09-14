// Playoffs page: projected bracket, seeding and clinch/elimination picture for one league at a time.

import { playoffPicture, buildBracket, parseMagicNumber } from './rootingEngine.js';
import { teamsData } from './teamsData.js';

const LEAGUE_OPTIONS = [
  { id: 103, label: 'AL', name: 'American League' },
  { id: 104, label: 'NL', name: 'National League' }
];

// Short forms of the clinch labels the engine produces, sized for a badge
const LOCK_SHORT_LABELS = {
  league: 'Best record',
  division: 'Division',
  wildcard: 'Wild Card',
  berth: 'Berth'
};

export function createPlayoffsView(state, helpers = {}) {
  const container = el('div', 'setup-container playoffs-view');
  container.appendChild(createTitleBlock());

  if (!state.processedStandings) {
    container.appendChild(createEmptyState('Loading standings…', 'Seeds and clinch numbers appear as soon as the standings load.'));
    return container;
  }

  const leagueId = resolveLeagueId(state);
  state.playoffsLeagueId = leagueId;

  container.appendChild(createLeagueToggle(state, helpers, leagueId));

  const picture = playoffPicture(state.processedStandings, leagueId);
  if (!picture) {
    container.appendChild(createEmptyState('No playoff picture yet', 'Standings for this league are unavailable right now.'));
    return container;
  }

  container.appendChild(createStatusStrip(state, helpers, picture));
  container.appendChild(createBracketCard(picture, helpers, leagueId));
  container.appendChild(createSeedsCard(state, helpers, picture, leagueId));

  if (picture.hasClinchData) {
    if (picture.clinchedTeams.length) container.appendChild(createClinchedCard(state, helpers, picture));
    if (picture.inTheHunt.length) container.appendChild(createHuntCard(state, helpers, picture));
    if (picture.eliminatedTeams.length) container.appendChild(createEliminatedCard(state, helpers, picture));
  }

  container.appendChild(createLegend());
  container.appendChild(createStandingsButton(state, helpers, 'playoff-standings-link', 'View Full Standings →'));

  return container;
}

// ---------------------------------------------------------------------------
// Header, league toggle and status strip
// ---------------------------------------------------------------------------

function createTitleBlock() {
  const block = el('div', 'playoff-title-block');
  block.appendChild(el('h2', 'section-title playoff-title', 'Playoffs'));
  block.appendChild(el('p', 'playoff-subtitle', 'If the season ended today'));
  return block;
}

function resolveLeagueId(state) {
  if (state.playoffsLeagueId === 103 || state.playoffsLeagueId === 104) return state.playoffsLeagueId;
  const favorite = state.processedStandings?.teamsMap?.[state.activeTeamId] || teamsData[state.activeTeamId];
  return favorite && favorite.leagueId === 104 ? 104 : 103;
}

function createLeagueToggle(state, helpers, leagueId) {
  const toggle = el('div', 'playoff-league-toggle');

  LEAGUE_OPTIONS.forEach(league => {
    const isActive = league.id === leagueId;
    const btn = el('button', `playoff-league-btn${isActive ? ' active' : ''}`, league.label);
    btn.type = 'button';
    btn.title = league.name;
    btn.setAttribute('aria-pressed', String(isActive));
    btn.addEventListener('click', () => {
      if (state.playoffsLeagueId === league.id) return;
      state.playoffsLeagueId = league.id;
      if (typeof helpers.render === 'function') helpers.render();
    });
    toggle.appendChild(btn);
  });

  return toggle;
}

function createStatusStrip(state, helpers, picture) {
  const strip = el('div', 'playoff-status-strip');
  const summary = `${picture.gamesRemainingMax} games left · ${picture.clinchedTeams.length} clinched · ${picture.eliminatedTeams.length} eliminated`;
  strip.appendChild(el('span', 'playoff-status-summary', summary));
  strip.appendChild(createStandingsButton(state, helpers, 'playoff-status-link', 'Standings →'));
  return strip;
}

function createStandingsButton(state, helpers, className, label) {
  const btn = el('button', className, label);
  btn.type = 'button';
  btn.addEventListener('click', () => {
    state.standingsLeagueId = state.playoffsLeagueId;
    if (typeof helpers.openStandings === 'function') helpers.openStandings();
  });
  return btn;
}

// ---------------------------------------------------------------------------
// Bracket
// ---------------------------------------------------------------------------

function createBracketCard(picture, helpers, leagueId) {
  const card = el('div', 'glass-card playoff-bracket-card');
  card.appendChild(el('h3', 'section-title', `${picture.leagueName} Bracket`));

  // Only the selected league is shown, so the other side of the bracket is left unbuilt
  const bracket = buildBracket(leagueId === 103 ? picture : null, leagueId === 104 ? picture : null);
  const leagueBracket = leagueId === 103 ? bracket.al : bracket.nl;

  const scroll = el('div', 'playoff-bracket-scroll');
  const grid = el('div', 'playoff-bracket');

  grid.appendChild(createWildCardRound(leagueBracket, helpers));
  grid.appendChild(createRound('Division Series', leagueBracket.divisionSeries.map(
    series => createMatchup(series.label, series.top, series.bottom, helpers)
  )));
  grid.appendChild(createRound('Championship', [createMatchup(
    leagueBracket.championship.label,
    leagueBracket.championship.top,
    leagueBracket.championship.bottom,
    helpers
  )]));

  scroll.appendChild(grid);
  card.appendChild(scroll);
  card.appendChild(el('p', 'playoff-bracket-caption', 'Projected bracket · current standings'));
  return card;
}

function createWildCardRound(leagueBracket, helpers) {
  const nodes = [];

  const byes = (leagueBracket.byes || []).filter(Boolean);
  if (byes.length) {
    const byeGroup = el('div', 'playoff-bye-group');
    byes.forEach(status => byeGroup.appendChild(createByeChip(status, helpers)));
    nodes.push(byeGroup);
  }

  (leagueBracket.wildCardRound || []).forEach(series => {
    nodes.push(createMatchup(series.label, series.home, series.away, helpers));
  });

  return createRound('Wild Card', nodes);
}

function createRound(title, nodes) {
  const round = el('div', 'playoff-round');
  round.appendChild(el('span', 'playoff-round-title', title));
  nodes.forEach(node => round.appendChild(node));
  return round;
}

function createByeChip(status, helpers) {
  const chip = el('div', 'playoff-bye-chip');
  chip.appendChild(createSeedPill(status.seed));
  if (status.lock.locked) chip.appendChild(createLockIcon(status.lock.label));
  chip.appendChild(createTeamLogo(status, helpers));
  chip.appendChild(el('span', 'playoff-bye-team', status.shortName || status.name));
  chip.appendChild(el('span', 'playoff-bye-note', '— bye'));
  return chip;
}

function createMatchup(label, top, bottom, helpers) {
  const matchup = el('div', 'playoff-matchup');
  if (label) matchup.appendChild(el('span', 'playoff-matchup-label', label));
  matchup.appendChild(createBracketSlot(top, helpers));
  matchup.appendChild(createBracketSlot(bottom, helpers));
  return matchup;
}

function createBracketSlot(entry, helpers) {
  if (!entry || !entry.teamId) {
    const placeholder = el('div', 'playoff-slot is-placeholder');
    placeholder.appendChild(el('span', 'playoff-slot-name', (entry && entry.placeholder) || 'TBD'));
    return placeholder;
  }

  const slot = el('div', 'playoff-slot');
  slot.appendChild(createSeedPill(entry.seed));
  slot.appendChild(createTeamLogo(entry, helpers));
  slot.appendChild(el('span', 'playoff-slot-name', entry.abbreviation || entry.shortName || entry.name));
  slot.appendChild(el('span', 'playoff-slot-record', `${entry.wins}-${entry.losses}`));
  return slot;
}

// ---------------------------------------------------------------------------
// Seeds 1-6
// ---------------------------------------------------------------------------

function createSeedsCard(state, helpers, picture, leagueId) {
  const card = el('div', 'glass-card playoff-group-card');
  card.appendChild(el('h3', 'section-title', `${picture.leagueName} Seeds 1–6`));

  const list = el('div', 'playoff-seed-list');

  const header = el('div', 'playoff-seed-row playoff-seed-header');
  header.appendChild(el('span', 'playoff-seed-cell-seed', 'Seed'));
  header.appendChild(el('div', 'playoff-seed-cell-team', 'Team'));
  header.appendChild(el('span', 'playoff-seed-cell-record', 'W-L'));
  header.appendChild(el('div', 'playoff-seed-cell-badges'));
  list.appendChild(header);

  for (let seed = 1; seed <= 6; seed++) {
    // The bottom three seeds are the Wild Cards, so the cutline sits above seed 4
    if (seed === 4) list.appendChild(createCutline('Wild Cards'));
    const status = picture.seeds[seed - 1];
    list.appendChild(status ? createSeedRow(status, state, helpers) : createEmptySeedRow(seed));
  }

  card.appendChild(list);

  const graphBtn = createSeedGraphButton(state, helpers, picture, leagueId);
  if (graphBtn) card.appendChild(graphBtn);

  return card;
}

function createSeedRow(status, state, helpers) {
  const row = el('div', `playoff-seed-row is-${status.seedKind || 'seed'}`);
  if (status.teamId === state.activeTeamId) row.classList.add('is-active');

  const seedCell = el('span', 'playoff-seed-cell-seed');
  seedCell.appendChild(createSeedPill(status.seed));
  row.appendChild(seedCell);

  const teamCell = el('div', 'playoff-seed-cell-team');
  teamCell.appendChild(createTeamLogo(status, helpers));
  const nameWrap = el('div', 'playoff-seed-name-wrap');
  nameWrap.appendChild(el('span', 'playoff-seed-name', status.shortName || status.name));
  nameWrap.appendChild(el('span', 'playoff-seed-meta', seedMetaText(status)));
  teamCell.appendChild(nameWrap);
  row.appendChild(teamCell);

  row.appendChild(el('span', 'playoff-seed-cell-record', `${status.wins}-${status.losses}`));

  const badges = el('div', 'playoff-seed-cell-badges');
  seedBadges(status).forEach(badge => badges.appendChild(badge));
  row.appendChild(badges);

  makeTappable(row, status.teamId, helpers);
  return row;
}

function createEmptySeedRow(seed) {
  const row = el('div', 'playoff-seed-row is-empty');
  const seedCell = el('span', 'playoff-seed-cell-seed');
  seedCell.appendChild(createSeedPill(seed));
  row.appendChild(seedCell);
  row.appendChild(el('div', 'playoff-seed-cell-team', 'TBD'));
  row.appendChild(el('span', 'playoff-seed-cell-record', '—'));
  row.appendChild(el('div', 'playoff-seed-cell-badges'));
  return row;
}

function seedMetaText(status) {
  if (status.seedKind === 'division') {
    const division = status.divisionName || 'Division';
    return status.hasBye ? `${division} · bye` : `${division} · hosts Wild Card`;
  }
  return `Wild Card ${status.wildCardRank || ''}`.trim();
}

function seedBadges(status) {
  const badges = [];

  if (status.lock.locked) badges.push(createLockBadge(status.lock));

  // A team that has only clinched a berth is still chasing its division, so it keeps the division magic number
  const divisionMagic = status.magic && status.magic.division;
  if (divisionMagic && status.lock.kind !== 'division' && status.lock.kind !== 'league') {
    badges.push(createBadge(`MN ${divisionMagic.value}`, 'is-magic', magicTitle('division', divisionMagic)));
  }

  const wildCardMagic = status.magic && status.magic.wildCard;
  if (wildCardMagic) {
    badges.push(createBadge(`WC MN ${wildCardMagic.value}`, 'is-magic-wc', magicTitle('Wild Card spot', wildCardMagic)));
  }

  return badges;
}

function createCutline(label) {
  const cutline = el('div', 'playoff-cutline');
  cutline.appendChild(el('span', 'playoff-cutline-label', label));
  return cutline;
}

function createSeedGraphButton(state, helpers, picture, leagueId) {
  if (typeof helpers.showGraphModal !== 'function' || typeof helpers.createMultiTeamRaceChart !== 'function') return null;

  const favorite = state.processedStandings?.teamsMap?.[state.activeTeamId];
  if (!favorite || favorite.leagueId !== leagueId) return null;

  const btn = el('button', 'playoff-graph-btn', '📊 Open Seeding Graph');
  btn.type = 'button';
  btn.addEventListener('click', () => {
    const chartNode = helpers.createMultiTeamRaceChart(favorite, picture.seeds.map(s => s.team));
    helpers.showGraphModal(`${picture.leagueName} Seeding Race Trend`, chartNode);
  });
  return btn;
}

// ---------------------------------------------------------------------------
// Clinched / In the Hunt / Eliminated
// ---------------------------------------------------------------------------

function createClinchedCard(state, helpers, picture) {
  const card = el('div', 'glass-card playoff-group-card');
  card.appendChild(el('h3', 'section-title', 'Clinched'));

  const list = el('div', 'playoff-team-list');
  picture.clinchedTeams.forEach(status => {
    list.appendChild(createTeamRow(status, {
      modifier: 'is-clinched',
      meta: status.divisionName,
      badges: [createLockBadge(status.lock)]
    }, state, helpers));
  });

  card.appendChild(list);
  return card;
}

function createHuntCard(state, helpers, picture) {
  const card = el('div', 'glass-card playoff-group-card');
  card.appendChild(el('h3', 'section-title', 'In the Hunt'));

  const list = el('div', 'playoff-team-list');
  picture.inTheHunt.forEach(status => {
    list.appendChild(createTeamRow(status, {
      modifier: 'is-hunting',
      meta: huntMetaText(status),
      badges: huntBadges(status)
    }, state, helpers));
  });

  card.appendChild(list);
  return card;
}

function createEliminatedCard(state, helpers, picture) {
  const card = el('div', 'glass-card playoff-group-card playoff-eliminated-card');
  const expanded = !!state.playoffsEliminatedExpanded;
  const count = picture.eliminatedTeams.length;

  const toggle = el(
    'button',
    `playoff-eliminated-toggle${expanded ? ' is-open' : ''}`,
    `${count} ${count === 1 ? 'team' : 'teams'} eliminated ${expanded ? '▾' : '▸'}`
  );
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.addEventListener('click', () => {
    state.playoffsEliminatedExpanded = !expanded;
    if (typeof helpers.render === 'function') helpers.render();
  });
  card.appendChild(toggle);

  if (expanded) {
    const list = el('div', 'playoff-team-list is-muted');
    picture.eliminatedTeams.forEach(status => {
      list.appendChild(createTeamRow(status, {
        modifier: 'is-eliminated',
        meta: status.divisionName
      }, state, helpers));
    });
    card.appendChild(list);
  }

  return card;
}

function createTeamRow(status, options, state, helpers) {
  const row = el('div', `playoff-team-row${options.modifier ? ` ${options.modifier}` : ''}`);
  if (status.teamId === state.activeTeamId) row.classList.add('is-active');

  row.appendChild(createTeamLogo(status, helpers));

  const info = el('div', 'playoff-team-info');
  info.appendChild(el('span', 'playoff-team-name', status.shortName || status.name));
  const metaParts = [`${status.wins}-${status.losses}`];
  if (options.meta) metaParts.push(options.meta);
  info.appendChild(el('span', 'playoff-team-meta', metaParts.join(' · ')));
  row.appendChild(info);

  const badges = el('div', 'playoff-team-badges');
  (options.badges || []).forEach(badge => badges.appendChild(badge));
  row.appendChild(badges);

  makeTappable(row, status.teamId, helpers);
  return row;
}

function huntMetaText(status) {
  if (status.divisionLeader) return `${status.divisionName || 'Division'} leader`;
  if (status.isWildCardSpot) return `Wild Card ${status.wildCardRank}`;
  const gamesBack = status.wildCardGamesBack;
  if (typeof gamesBack === 'number' && gamesBack > 0) return `${gamesBack.toFixed(1)} GB of the last spot`;
  return 'Wild Card race';
}

function huntBadges(status) {
  const badges = [];

  const divisionMagic = status.magic && status.magic.division;
  if (divisionMagic) {
    badges.push(createBadge(`MN ${divisionMagic.value}`, 'is-magic', magicTitle('division', divisionMagic)));
  }

  const wildCardMagic = status.magic && status.magic.wildCard;
  if (wildCardMagic) {
    badges.push(createBadge(`WC MN ${wildCardMagic.value}`, 'is-magic-wc', magicTitle('Wild Card spot', wildCardMagic)));
  }

  // Chasers have no magic number to show, so the elimination numbers carry the race instead
  if (!badges.length) {
    const elimination = eliminationText(status);
    if (elimination) badges.push(createBadge(elimination, 'is-elim', 'Losses that would end the chase (E = eliminated)'));
  }

  return badges;
}

function eliminationText(status) {
  const parts = [];
  const division = formatEliminationValue(status.elimNumbers.division, status.eliminated.division);
  if (division) parts.push(`Div: ${division}`);
  const wildCard = formatEliminationValue(status.elimNumbers.wildCard, status.eliminated.wildCard);
  if (wildCard) parts.push(`WC ${wildCard}`);
  return parts.join(' · ');
}

function formatEliminationValue(value, isEliminated) {
  if (isEliminated) return 'E';
  const parsed = parseMagicNumber(value);
  return parsed === null ? null : `${parsed}`;
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

function createLegend() {
  const legend = el('div', 'playoff-legend');

  const lockItem = el('p', 'playoff-legend-item');
  lockItem.appendChild(createLockIcon('Clinched'));
  lockItem.appendChild(el('span', 'playoff-legend-text', 'Clinched — Berth, Division, Wild Card or Best record'));
  legend.appendChild(lockItem);

  [
    'MN = magic number: wins still needed to lock up that spot.',
    'E = eliminated from that race; a number is how many more losses would do it.',
    'Wild Card clinch numbers are derived when MLB publishes none, so they can run about a game high.'
  ].forEach(text => {
    const item = el('p', 'playoff-legend-item');
    item.appendChild(el('span', 'playoff-legend-text', text));
    legend.appendChild(item);
  });

  return legend;
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null && text !== '') node.innerText = text;
  return node;
}

function createEmptyState(message, detail) {
  const wrap = el('div', 'empty-state');
  wrap.appendChild(el('div', 'empty-icon', '⚾'));
  wrap.appendChild(el('p', null, message));
  if (detail) wrap.appendChild(el('p', 'playoff-empty-detail', detail));
  return wrap;
}

function createSeedPill(seed) {
  return el('span', 'playoff-seed-pill', seed ? `${seed}` : '–');
}

function createBadge(text, modifier, title) {
  const badge = el('span', `playoff-badge${modifier ? ` ${modifier}` : ''}`, text);
  if (title) badge.title = title;
  return badge;
}

function magicTitle(scope, magic) {
  const over = magic.vs ? ` over ${magic.vs}` : '';
  const derived = magic.source === 'api' ? '' : ' (derived)';
  return `${magic.value} more ${magic.value === 1 ? 'win' : 'wins'} to clinch the ${scope}${over}${derived}`;
}

function createLockBadge(lock) {
  const badge = el('span', 'playoff-badge is-lock');
  badge.appendChild(createLockIcon());
  badge.appendChild(el('span', 'playoff-badge-text', LOCK_SHORT_LABELS[lock.kind] || 'Clinched'));
  badge.title = lock.label || 'Clinched';
  return badge;
}

function createLockIcon(title) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'playoff-lock');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '11');
  svg.setAttribute('height', '11');
  svg.setAttribute('aria-hidden', 'true');

  const shackle = document.createElementNS(ns, 'path');
  shackle.setAttribute('d', 'M8 10V7a4 4 0 0 1 8 0v3');
  shackle.setAttribute('fill', 'none');
  shackle.setAttribute('stroke', 'currentColor');
  shackle.setAttribute('stroke-width', '2.4');
  shackle.setAttribute('stroke-linecap', 'round');
  svg.appendChild(shackle);

  const body = document.createElementNS(ns, 'rect');
  body.setAttribute('x', '4.5');
  body.setAttribute('y', '10');
  body.setAttribute('width', '15');
  body.setAttribute('height', '10.5');
  body.setAttribute('rx', '2.2');
  body.setAttribute('fill', 'currentColor');
  svg.appendChild(body);

  if (title) {
    const titleNode = document.createElementNS(ns, 'title');
    titleNode.textContent = title;
    svg.appendChild(titleNode);
  }

  return svg;
}

function createTeamLogo(status, helpers) {
  const team = (status && status.team) || teamsData[status && status.teamId] || null;

  if (typeof helpers.createTeamLogoBadge === 'function') {
    const badge = helpers.createTeamLogoBadge(team);
    if (badge) return badge;
  }

  const abbr = (team && team.abbreviation) || (status && status.abbreviation) || 'MLB';
  const wrap = el('div', 'team-badge-small');
  if (typeof helpers.getTeamLogoUrl === 'function') {
    const img = document.createElement('img');
    img.src = helpers.getTeamLogoUrl(abbr);
    img.alt = abbr;
    wrap.appendChild(img);
  } else {
    wrap.innerText = abbr;
  }
  return wrap;
}

function makeTappable(row, teamId, helpers) {
  if (typeof helpers.openTeamDashboard !== 'function' || !teamId) return;

  row.classList.add('is-tappable');
  row.setAttribute('role', 'button');
  row.tabIndex = 0;
  row.addEventListener('click', () => helpers.openTeamDashboard(teamId));
  row.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    helpers.openTeamDashboard(teamId);
  });
}
