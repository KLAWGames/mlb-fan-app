import { teamsData } from './teamsData.js';

export function reconstructGameFromSeasonGame(g, activeTeam, state) {
  if (g.awayTeam && g.homeTeam) return g;

  const opponentTeam = state.processedStandings?.teamsMap?.[g.opponentId] || teamsData[g.opponentId] || {
    id: g.opponentId,
    name: g.opponent,
    shortName: g.opponent,
    abbreviation: g.opponentAbbr || g.opponent.slice(0, 3).toUpperCase(),
    primaryColor: '#888888',
    textColor: '#ffffff'
  };

  const isAway = !g.isHome;
  const awayTeam = isAway ? activeTeam : opponentTeam;
  const homeTeam = isAway ? opponentTeam : activeTeam;

  return {
    gamePk: (g.gamePk || g.gameNumber || 1000) + activeTeam.id,
    gameDate: g.dateStr,
    awayTeam,
    homeTeam,
    awayScore: isAway ? g.teamScore : g.oppScore,
    homeScore: isAway ? g.oppScore : g.teamScore,
    status: {
      statusCode: 'F',
      detailedState: 'Final'
    }
  };
}

export function getTeamRoster(teamId) {
  const rosters = {
    141: ['Vladimir Guerrero Jr.', 'Bo Bichette', 'George Springer', 'Daulton Varsho', 'Alejandro Kirk', 'Ernie Clement', 'Spencer Horwitz', 'Davis Schneider'],
    147: ['Aaron Judge', 'Juan Soto', 'Giancarlo Stanton', 'Anthony Volpe', 'Gleyber Torres', 'Alex Verdugo', 'Austin Wells', 'Ben Rice'],
    119: ['Shohei Ohtani', 'Mookie Betts', 'Freddie Freeman', 'Teoscar Hernández', 'Will Smith', 'Max Muncy', 'Gavin Lux', 'Andy Pages'],
    117: ['Yordan Alvarez', 'Jose Altuve', 'Alex Bregman', 'Kyle Tucker', 'Jeremy Peña', 'Yainer Diaz', 'Mauricio Dubón', 'Jon Singleton'],
    110: ['Gunnar Henderson', 'Adley Rutschman', 'Anthony Santander', 'Ryan Mountcastle', 'Jordan Westburg', 'Colton Cowser', 'Cedric Mullins'],
    111: ['Rafael Devers', 'Jarren Duran', 'Tyler O\'Neill', 'Ceddanne Rafaela', 'Wilyer Abreu', 'Connor Wong', 'Masataka Yoshida'],
    137: ['Matt Chapman', 'Patrick Bailey', 'Mike Yastrzemski', 'Heliot Ramos', 'Jorge Soler', 'Thairo Estrada', 'Wilmer Flores'],
    144: ['Marcell Ozuna', 'Austin Riley', 'Matt Olson', 'Ozzie Albies', 'Travis d\'Arnaud', 'Adam Duvall', 'Orlando Arcia'],
    112: ['Cody Bellinger', 'Seiya Suzuki', 'Dansby Swanson', 'Ian Happ', 'Nico Hoerner', 'Michael Busch', 'Christopher Morel'],
    135: ['Manny Machado', 'Fernando Tatis Jr.', 'Jake Cronenworth', 'Jurickson Profar', 'Luis Arraez', 'Jackson Merrill', 'Ha-Seong Kim'],
    134: ['Francisco Lindor', 'Pete Alonso', 'Brandon Nimmo', 'J.D. Martinez', 'Starling Marte', 'Mark Vientos', 'Francisco Alvarez'],
    140: ['Marcus Semien', 'Corey Seager', 'Adolis García', 'Josh Jung', 'Jonah Heim', 'Nathaniel Lowe', 'Wyatt Langford', 'Leody Taveras']
  };

  const cleanId = parseInt(teamId, 10);
  if (rosters[cleanId]) return rosters[cleanId];

  return [
    'J. Ramirez', 'A. Santander', 'M. Semien', 'C. Seager', 'B. Witt Jr.',
    'S. Perez', 'C. Correa', 'B. Buxton', 'A. Garcia', 'M. Melendez'
  ];
}

export function getDeterministicSankeyStats(game, teamId) {
  const seed = (game.gamePk || 1000) + teamId;
  let s = seed;
  function lcgRandom() {
    s = (1103515245 * s + 12345) % 2147483648;
    return s / 2147483648;
  }

  const isFinal = game.status.statusCode === 'F' || game.status.detailedState === 'Final';
  const isAway = parseInt(teamId, 10) === parseInt(game.awayTeam.id, 10);
  const teamScore = (isAway ? game.awayScore : game.homeScore) || 0;
  const oppScore = (isAway ? game.homeScore : game.awayScore) || 0;
  const isWinner = isFinal && (teamScore > oppScore);
  const isHomeWinner = isWinner && !isAway;

  const Hits = Math.max(2, teamScore + Math.floor(lcgRandom() * 4) + 1);
  const Walks = Math.floor(lcgRandom() * 5) + 1;
  const HBP = lcgRandom() < 0.25 ? 1 : 0;

  let Outs = 27;
  if (isFinal) {
    Outs = isHomeWinner ? 24 : 27;
  } else {
    const linescore = game.linescore || {};
    const inning = linescore.currentInning || 5;
    const isTop = linescore.isTopInning !== false;
    let halfInningsCompleted = isAway ? (inning * 2 - 2) : (inning * 2 - 1);
    Outs = Math.max(3, Math.round(halfInningsCompleted * 1.5) + Math.floor(lcgRandom() * 3));
  }

  let HomeRun = 0;
  if (teamScore > 0) {
    HomeRun = Math.min(teamScore, Math.floor(lcgRandom() * Math.min(3, teamScore + 1)));
  }
  const Triple = lcgRandom() < 0.12 ? 1 : 0;
  const Double = Math.floor(lcgRandom() * Math.min(4, Hits - HomeRun - Triple + 1));
  const Single = Math.max(0, Hits - Double - Triple - HomeRun);

  let Unplayed = isHomeWinner ? 3 : 0;
  let remainingOuts = Outs - Unplayed;

  let Strikeout = Math.min(remainingOuts, Math.floor(lcgRandom() * 7) + 3);
  remainingOuts -= Strikeout;

  let GroundOut = Math.min(remainingOuts, Math.floor(lcgRandom() * 6) + 3);
  remainingOuts -= GroundOut;

  let Flyout = Math.min(remainingOuts, Math.floor(lcgRandom() * 6) + 3);
  remainingOuts -= Flyout;

  let Lineout = Math.min(remainingOuts, Math.floor(lcgRandom() * 3) + 1);
  remainingOuts -= Lineout;

  let PopOut = Math.min(remainingOuts, Math.floor(lcgRandom() * 3) + 1);
  remainingOuts -= PopOut;

  let ThrownOut = Math.min(remainingOuts, lcgRandom() < 0.3 ? 1 : 0);
  remainingOuts -= ThrownOut;

  let SacFly = Math.min(remainingOuts, lcgRandom() < 0.25 ? 1 : 0);
  remainingOuts -= SacFly;

  if (remainingOuts > 0) {
    GroundOut += remainingOuts;
  }

  return {
    Outs, Hits, Walks, HBP,
    Single, Double, Triple, HomeRun,
    GroundOut, Lineout, Flyout, SacFly, PopOut, Strikeout, ThrownOut, Unplayed
  };
}

export function drawSankeySVG(stats, team) {
  const svgWidth = 540;
  const svgHeight = 420;
  const padTop = 20;
  const padBottom = 20;
  const nodeWidth = 14;

  const {
    Outs, Hits, Walks, HBP,
    Single, Double, Triple, HomeRun,
    GroundOut, Lineout, Flyout, SacFly, PopOut, Strikeout, ThrownOut, Unplayed
  } = stats;

  const AtBats = Outs + Hits + Walks + HBP;
  const scaleY = Math.min(6.5, (svgHeight - padTop - padBottom - 110) / AtBats);
  const gapY = 12;
  const col1_x = 35;
  const col2_x = 220;
  const col3_x = 420;

  let defsHtml = '';
  let nodesHtml = '';
  let linksHtml = '';

  const h_atbats = AtBats * scaleY;
  const y_atbats = padTop + (svgHeight - padTop - padBottom - h_atbats) / 2;
  const node_atbats = { id: 'atbats', label: 'At Bats', value: AtBats, x: col1_x, y: y_atbats, h: h_atbats, color: '#94a3b8', sourceOffset: 0, targetOffset: 0 };

  const h_hits = Hits * scaleY;
  const h_outs = Outs * scaleY;
  const h_walks = Walks * scaleY;
  const h_hbp = HBP * scaleY;
  const totalH_col2 = h_hits + h_outs + h_walks + h_hbp + 3 * gapY;
  const startY_col2 = padTop + (svgHeight - padTop - padBottom - totalH_col2) / 2;

  const y_hits = startY_col2;
  const y_outs = y_hits + h_hits + gapY;
  const y_walks = y_outs + h_outs + gapY;
  const y_hbp = y_walks + h_walks + gapY;

  const node_hits = { id: 'hits', label: 'Hits', value: Hits, x: col2_x, y: y_hits, h: h_hits, color: '#10b981', sourceOffset: 0, targetOffset: 0 };
  const node_outs = { id: 'outs', label: 'Outs', value: Outs, x: col2_x, y: y_outs, h: h_outs, color: '#ec4899', sourceOffset: 0, targetOffset: 0 };
  const node_walks = { id: 'walks', label: 'Walks', value: Walks, x: col2_x, y: y_walks, h: h_walks, color: '#3b82f6', sourceOffset: 0, targetOffset: 0 };
  const node_hbp = { id: 'hbp', label: 'HBP', value: HBP, x: col2_x, y: y_hbp, h: h_hbp, color: '#f59e0b', sourceOffset: 0, targetOffset: 0 };

  const subHits = [
    { id: 'single', label: 'Single', value: Single, color: 'rgba(16, 185, 129, 0.85)' },
    { id: 'double', label: 'Double', value: Double, color: 'rgba(16, 185, 129, 0.85)' },
    { id: 'triple', label: 'Triple', value: Triple, color: 'rgba(16, 185, 129, 0.85)' },
    { id: 'hr', label: 'Home Run', value: HomeRun, color: 'rgba(16, 185, 129, 0.85)' }
  ].filter(n => n.value > 0);

  const activeCol3NodesCount = subHits.length + subOuts.length + (Walks > 0 ? 1 : 0) + (HBP > 0 ? 1 : 0);
  const totalGapsCol3 = (activeCol3NodesCount - 1) * gapY;
  const totalHCol3 = AtBats * scaleY;
  const neededHeightCol3 = totalHCol3 + totalGapsCol3;
  const startY_col3 = padTop + (svgHeight - padTop - padBottom - neededHeightCol3) / 2;

  let currY = startY_col3;
  const nodes_subhits = subHits.map(sh => {
    const h = sh.value * scaleY;
    const n = { ...sh, x: col3_x, y: currY, h, color: 'rgba(16, 185, 129, 0.85)', sourceOffset: 0, targetOffset: 0 };
    currY += h + gapY;
    return n;
  });

  const nodes_subouts = subOuts.map(so => {
    const h = so.value * scaleY;
    const n = { ...so, x: col3_x, y: currY, h, color: 'rgba(236, 72, 153, 0.85)', sourceOffset: 0, targetOffset: 0 };
    currY += h + gapY;
    return n;
  });

  let node_subwalks = null;
  if (Walks > 0) {
    const h = Walks * scaleY;
    node_subwalks = { id: 'sw-walks', label: 'Walks', value: Walks, x: col3_x, y: currY, h, color: 'rgba(59, 130, 246, 0.85)', sourceOffset: 0, targetOffset: 0 };
    currY += h + gapY;
  }

  let node_subhbp = null;
  if (HBP > 0) {
    const h = HBP * scaleY;
    node_subhbp = { id: 'sh-hbp', label: 'HBP', value: HBP, x: col3_x, y: currY, h, color: 'rgba(245, 158, 11, 0.85)', sourceOffset: 0, targetOffset: 0 };
    currY += h + gapY;
  }

  const allNodes = [
    node_atbats,
    node_hits, node_outs, node_walks, node_hbp,
    ...nodes_subhits,
    ...nodes_subouts,
    ...(Walks > 0 ? [node_subwalks] : []),
    ...(HBP > 0 ? [node_subhbp] : [])
  ];

  function drawFlow(src, dest, val, color1, color2) {
    if (val <= 0) return;
    const h = val * scaleY;
    const x1 = src.x + nodeWidth;
    const y1 = src.y + src.sourceOffset;
    const x2 = dest.x;
    const y2 = dest.y + dest.targetOffset;

    src.sourceOffset += h;
    dest.targetOffset += h;

    const cpX = x1 + (x2 - x1) / 2;
    const d = `M ${x1} ${y1} C ${cpX} ${y1}, ${cpX} ${y2}, ${x2} ${y2} L ${x2} ${y2 + h} C ${cpX} ${y2 + h}, ${cpX} ${y1 + h}, ${x1} ${y1 + h} Z`;

    const gradId = `flow-${src.id}-${dest.id}`;
    defsHtml += `
      <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="${color1}" stop-opacity="0.3" />
        <stop offset="100%" stop-color="${color2}" stop-opacity="0.3" />
      </linearGradient>
    `;

    linksHtml += `<path d="${d}" fill="url(#${gradId})" />`;
  }

  drawFlow(node_atbats, node_hits, Hits, node_atbats.color, node_hits.color);
  drawFlow(node_atbats, node_outs, Outs, node_atbats.color, node_outs.color);
  drawFlow(node_atbats, node_walks, Walks, node_atbats.color, node_walks.color);
  drawFlow(node_atbats, node_hbp, HBP, node_atbats.color, node_hbp.color);

  nodes_subhits.forEach(n => {
    drawFlow(node_hits, n, n.value, node_hits.color, n.color);
  });
  nodes_subouts.forEach(n => {
    drawFlow(node_outs, n, n.value, node_outs.color, n.color);
  });
  if (Walks > 0) {
    drawFlow(node_walks, node_subwalks, Walks, node_walks.color, node_subwalks.color);
  }
  if (HBP > 0) {
    drawFlow(node_hbp, node_subhbp, HBP, node_hbp.color, node_subhbp.color);
  }

  allNodes.forEach(n => {
    nodesHtml += `<rect x="${n.x}" y="${n.y}" width="${nodeWidth}" height="${n.h}" rx="2" fill="${n.color}" opacity="0.9" />`;

    if (n.id === 'atbats') {
      nodesHtml += `<text x="${n.x - 6}" y="${n.y + n.h/2}" font-size="8px" font-weight="800" fill="var(--text-primary)" font-family="var(--font-title)" text-anchor="end" alignment-baseline="middle">${n.label} (${n.value})</text>`;
    } else if (n.id === 'hits' || n.id === 'outs' || n.id === 'walks' || n.id === 'hbp') {
      nodesHtml += `<text x="${n.x - 6}" y="${n.y + n.h/2}" font-size="7.5px" font-weight="700" fill="var(--text-secondary)" font-family="var(--font-body)" text-anchor="end" alignment-baseline="middle">${n.label} (${n.value})</text>`;
    } else {
      nodesHtml += `<text x="${n.x + nodeWidth + 6}" y="${n.y + n.h/2}" font-size="7.5px" font-weight="600" fill="var(--text-secondary)" font-family="var(--font-body)" text-anchor="start" alignment-baseline="middle">${n.label} (${n.value})</text>`;
    }
  });

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);
  svg.style.cssText = 'width: 500px; min-width: 500px; height: auto; display: block; overflow: visible;';
  
  svg.innerHTML = `
    <defs>${defsHtml}</defs>
    <g>${linksHtml}</g>
    <g>${nodesHtml}</g>
  `;

  return svg;
}

export function getDeterministicSprayPlays(game, teamId) {
  const stats = getDeterministicSankeyStats(game, teamId);
  const roster = getTeamRoster(teamId);

  const seed = (game.gamePk || 1000) + teamId + 99;
  let s = seed;
  function lcgRandom() {
    s = (1103515245 * s + 12345) % 2147483648;
    return s / 2147483648;
  }

  const plays = [];
  let playId = 1;

  function addPlay(event, desc, rMin, rMax, thetaMin, thetaMax, speedMin, speedMax, angleMin, angleMax, distMin, distMax) {
    const r = rMin + lcgRandom() * (rMax - rMin);
    const theta = thetaMin + lcgRandom() * (thetaMax - thetaMin);
    
    const rad = (theta - 90) * Math.PI / 180;
    const cx = 125 + r * Math.cos(rad);
    const cy = 205 + r * Math.sin(rad);

    const batter = roster[Math.floor(lcgRandom() * roster.length)];
    const speed = speedMin + lcgRandom() * (speedMax - speedMin);
    const angle = angleMin + lcgRandom() * (angleMax - angleMin);
    const dist = distMin ? Math.round(distMin + lcgRandom() * (distMax - distMin)) : null;

    plays.push({
      id: playId++,
      batter,
      event,
      desc,
      speed,
      angle,
      dist,
      cx: parseFloat(cx.toFixed(1)),
      cy: parseFloat(cy.toFixed(1))
    });
  }

  for (let i = 0; i < stats.Single; i++) {
    addPlay('single', 'Single', 55, 110, -40, 40, 85, 102, 6, 18, 210, 280);
  }
  for (let i = 0; i < stats.Double; i++) {
    addPlay('double', 'Double', 95, 145, -42, 42, 92, 108, 14, 25, 290, 360);
  }
  for (let i = 0; i < stats.Triple; i++) {
    const side = lcgRandom() < 0.5 ? -1 : 1;
    const thetaMin = side < 0 ? -43 : 33;
    const thetaMax = side < 0 ? -33 : 43;
    addPlay('triple', 'Triple', 125, 148, thetaMin, thetaMax, 96, 110, 18, 28, 340, 390);
  }
  for (let i = 0; i < stats.HomeRun; i++) {
    addPlay('hr', 'Home Run', 153, 168, -42, 42, 100, 116, 22, 34, 370, 460);
  }

  for (let i = 0; i < stats.GroundOut; i++) {
    addPlay('out', 'Groundout', 18, 48, -42, 42, 70, 92, -20, 2, 5, 80);
  }
  for (let i = 0; i < stats.Lineout; i++) {
    addPlay('out', 'Lineout', 45, 110, -40, 40, 90, 105, 5, 14, 150, 290);
  }
  for (let i = 0; i < stats.Flyout; i++) {
    addPlay('out', 'Flyout', 90, 145, -40, 40, 88, 98, 28, 45, 260, 360);
  }
  for (let i = 0; i < stats.PopOut; i++) {
    addPlay('out', 'Popout', 20, 60, -42, 42, 65, 82, 55, 80, 20, 120);
  }
  for (let i = 0; i < stats.SacFly; i++) {
    addPlay('out', 'Sac Fly', 115, 145, -35, 35, 90, 96, 25, 38, 280, 340);
  }
  for (let i = 0; i < stats.ThrownOut; i++) {
    addPlay('out', 'Thrown Out', 12, 50, -43, 43, 60, 85, -30, 40, 2, 90);
  }

  const batterStats = {};
  roster.forEach(b => {
    batterStats[b] = { H: 0, AB: 0, BB: 0, HBP: 0 };
  });

  plays.forEach(p => {
    if (!batterStats[p.batter]) {
      batterStats[p.batter] = { H: 0, AB: 0, BB: 0, HBP: 0 };
    }
    const b = batterStats[p.batter];
    if (p.event === 'single' || p.event === 'double' || p.event === 'triple' || p.event === 'hr') {
      b.H += 1;
      b.AB += 1;
    } else if (p.event === 'out') {
      if (p.desc !== 'Sac Fly') {
        b.AB += 1;
      }
    }
  });

  for (let i = 0; i < stats.Strikeout; i++) {
    const batter = roster[Math.floor(lcgRandom() * roster.length)];
    if (!batterStats[batter]) batterStats[batter] = { H: 0, AB: 0, BB: 0, HBP: 0 };
    batterStats[batter].AB += 1;
  }

  for (let i = 0; i < stats.Walks; i++) {
    const batter = roster[Math.floor(lcgRandom() * roster.length)];
    if (!batterStats[batter]) batterStats[batter] = { H: 0, AB: 0, BB: 0, HBP: 0 };
    batterStats[batter].BB += 1;
  }

  for (let i = 0; i < stats.HBP; i++) {
    const batter = roster[Math.floor(lcgRandom() * roster.length)];
    if (!batterStats[batter]) batterStats[batter] = { H: 0, AB: 0, BB: 0, HBP: 0 };
    batterStats[batter].HBP += 1;
  }

  return { plays, batterStats };
}

export function drawSprayFieldSVG(plays, activePlayId, clickCallback) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 250 250');
  svg.style.cssText = 'width: 100%; height: 100%; display: block; max-width: 250px;';

  svg.innerHTML = `
    <path d="M 10,120 A 155,155 0 0,1 240,120 L 125,205 Z" fill="#064e3b" />
    <path d="M 85,170 A 45,45 0 0,1 165,170 L 125,205 Z" fill="#b45309" opacity="0.25" />
    <path d="M 125,155 L 150,180 L 125,205 L 100,180 Z" stroke="rgba(255,255,255,0.2)" stroke-width="1" fill="none" />
    <path d="M 10,120 A 155,155 0 0,1 240,120" stroke="rgba(255, 255, 255, 0.3)" stroke-width="3" fill="none" />
    <line x1="125" y1="205" x2="10" y2="120" stroke="#ffffff" stroke-width="1.5" opacity="0.8" />
    <line x1="125" y1="205" x2="240" y2="120" stroke="#ffffff" stroke-width="1.5" opacity="0.8" />
    
    <polygon points="125,208 128,205 125,202 122,205" fill="#ffffff" stroke="#94a3b8" stroke-width="0.5" />
    <polygon points="150,183 153,180 150,177 147,180" fill="#ffffff" stroke="#94a3b8" stroke-width="0.5" />
    <polygon points="125,158 128,155 125,152 122,155" fill="#ffffff" stroke="#94a3b8" stroke-width="0.5" />
    <polygon points="100,183 103,180 100,177 97,180" fill="#ffffff" stroke="#94a3b8" stroke-width="0.5" />
    
    <line x1="122" y1="180" x2="128" y2="180" stroke="#ffffff" stroke-width="1" />
    <g class="plays-group"></g>
  `;

  const playsGroup = svg.querySelector('.plays-group');

  plays.forEach(play => {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', play.cx);
    circle.setAttribute('cy', play.cy);
    circle.setAttribute('r', activePlayId === play.id ? '7' : '4');
    circle.setAttribute('class', 'hit-dot');
    circle.setAttribute('id', `dot-${play.id}`);
    
    let color;
    if (play.event === 'single') color = '#3b82f6';
    else if (play.event === 'double') color = '#10b981';
    else if (play.event === 'triple') color = '#f59e0b';
    else if (play.event === 'hr') color = '#ec4899';
    else color = '#64748b';
    
    circle.setAttribute('fill', color);
    circle.setAttribute('stroke', activePlayId === play.id ? '#ffffff' : 'rgba(0,0,0,0.5)');
    circle.setAttribute('stroke-width', activePlayId === play.id ? '1.5' : '0.5');
    circle.style.cssText = `cursor: pointer; transition: r 0.15s, stroke-width 0.15s;`;
    if (activePlayId === play.id) {
      circle.style.filter = 'drop-shadow(0 0 4px #ffffff)';
    }

    circle.addEventListener('click', (e) => {
      e.stopPropagation();
      clickCallback(play);
    });

    playsGroup.appendChild(circle);
  });

  return svg;
}

export function openGameAnalyticsCenter(game, state, render) {
  const existing = document.querySelector('.analytics-center-backdrop');
  if (existing) existing.remove();

  const backdrop = document.createElement('div');
  backdrop.className = 'analytics-center-backdrop';
  backdrop.style.cssText = `
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(15, 23, 42, 0.45);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    z-index: 10000;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 16px;
  `;

  const modal = document.createElement('div');
  modal.className = 'glass-card';
  modal.style.cssText = `
    width: 100%;
    max-width: 520px;
    max-height: 90vh;
    background: var(--bg-card);
    border: 1px solid var(--border-glass-highlight);
    border-radius: 16px;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 0;
  `;
  backdrop.appendChild(modal);

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.remove();
  });

  const header = document.createElement('div');
  header.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px;
    border-bottom: 1px solid var(--border-glass);
  `;
  
  const titleContainer = document.createElement('div');
  titleContainer.style.textAlign = 'left';
  
  const isLive = game.status.statusCode === 'I' || game.status.detailedState.toLowerCase().includes('progress');
  const isFinal = game.status.statusCode === 'F' || game.status.detailedState === 'Final';
  
  let statusText = game.status.detailedState;
  if (isLive) {
    const inning = game.linescore?.currentInning || 5;
    const isTop = game.linescore?.isTopInning !== false;
    statusText = `Live • ${isTop ? 'Top' : 'Bot'} of ${inning}`;
  }
  
  const scoreText = (isLive || isFinal) ? `${game.awayScore} - ${game.homeScore}` : 'vs';
  
  titleContainer.innerHTML = `
    <div style="font-size: 10px; color: var(--text-secondary); font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px;">
      ${statusText}
    </div>
    <div style="font-size: 14px; font-weight: 800; font-family: var(--font-title); color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
      <span>${game.awayTeam.abbreviation}</span>
      <span style="color: var(--color-gold); font-size: 13px;">${scoreText}</span>
      <span>${game.homeTeam.abbreviation}</span>
    </div>
  `;
  
  const closeBtn = document.createElement('button');
  closeBtn.style.cssText = `
    background: none; border: none; color: var(--text-secondary);
    font-size: 20px; font-weight: 300; cursor: pointer; padding: 4px; line-height: 1;
  `;
  closeBtn.innerHTML = '×';
  closeBtn.addEventListener('click', () => backdrop.remove());
  
  header.appendChild(titleContainer);
  header.appendChild(closeBtn);
  modal.appendChild(header);

  const body = document.createElement('div');
  body.style.cssText = `
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  `;
  modal.appendChild(body);

  let selectedTeamId = game.awayTeam.id;
  let selectedVis = 'sankey';
  let selectedBatter = 'all';
  let activePlayId = null;

  const teamToggleRow = document.createElement('div');
  teamToggleRow.style.cssText = 'display: flex; gap: 8px; width: 100%; border-bottom: 1px solid var(--border-glass); padding-bottom: 10px;';
  
  const renderTeamToggles = () => {
    teamToggleRow.innerHTML = '';
    [game.awayTeam, game.homeTeam].forEach(t => {
      const btn = document.createElement('button');
      const isActive = parseInt(selectedTeamId, 10) === parseInt(t.id, 10);
      btn.style.cssText = `
        flex: 1;
        padding: 8px 12px;
        font-size: 12px;
        font-weight: 700;
        border-radius: 6px;
        cursor: pointer;
        border: 1px solid ${isActive ? t.primaryColor : 'var(--border-glass)'};
        background: ${isActive ? 'var(--bg-dark)' : 'transparent'};
        color: ${isActive ? 'var(--text-primary)' : 'var(--text-secondary)'};
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        transition: all 0.2s;
      `;
      btn.innerHTML = `
        <span style="width: 8px; height: 8px; border-radius: 50%; background: ${t.primaryColor}; display: inline-block;"></span>
        <span>${t.name}</span>
      `;
      btn.addEventListener('click', () => {
        selectedTeamId = parseInt(t.id, 10);
        selectedBatter = 'all';
        activePlayId = null;
        updateVisContent();
        renderTeamToggles();
      });
      teamToggleRow.appendChild(btn);
    });
  };
  renderTeamToggles();
  body.appendChild(teamToggleRow);

  const visToggleRow = document.createElement('div');
  visToggleRow.style.cssText = 'display: flex; background: #f1f5f9; padding: 3px; border-radius: 8px; border: 1px solid var(--border-glass);';
  
  const renderVisToggles = () => {
    visToggleRow.innerHTML = '';
    [
      { id: 'sankey', label: '📊 Sankey Flow' },
      { id: 'spray', label: '⚾ Spray Chart' }
    ].forEach(opt => {
      const btn = document.createElement('button');
      const isActive = selectedVis === opt.id;
      btn.style.cssText = `
        flex: 1;
        padding: 8px;
        font-size: 12px;
        font-weight: 700;
        border-radius: 6px;
        border: none;
        cursor: pointer;
        background: ${isActive ? '#ffffff' : 'transparent'};
        color: ${isActive ? 'var(--text-primary)' : 'var(--text-secondary)'};
        box-shadow: ${isActive ? '0 1px 3px rgba(0,0,0,0.08)' : 'none'};
        transition: all 0.2s;
      `;
      btn.innerText = opt.label;
      btn.addEventListener('click', () => {
        selectedVis = opt.id;
        activePlayId = null;
        updateVisContent();
        renderVisToggles();
      });
      visToggleRow.appendChild(btn);
    });
  };
  renderVisToggles();
  body.appendChild(visToggleRow);

  const visContainer = document.createElement('div');
  visContainer.style.cssText = 'flex: 1; display: flex; flex-direction: column; gap: 12px;';
  body.appendChild(visContainer);

  const updateVisContent = () => {
    visContainer.innerHTML = '';
    const teamObj = selectedTeamId === game.awayTeam.id ? game.awayTeam : game.homeTeam;

    if (selectedVis === 'sankey') {
      const stats = getDeterministicSankeyStats(game, selectedTeamId);
      
      const scrollWrapper = document.createElement('div');
      scrollWrapper.style.cssText = 'width: 100%; max-height: 440px; overflow: auto; -webkit-overflow-scrolling: touch; border: 1px solid var(--border-glass); border-radius: 12px; background: #f8fafc; padding: 12px; position: relative;';
      
      const sankeyNode = drawSankeySVG(stats, teamObj);
      scrollWrapper.appendChild(sankeyNode);
      visContainer.appendChild(scrollWrapper);

      // Pinch to Zoom gesture logic for touch screens
      let startDist = 0;
      let startWidth = 500;

      scrollWrapper.addEventListener('touchstart', (e) => {
        if (e.touches.length === 2) {
          e.stopPropagation();
          startDist = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
          );
          startWidth = sankeyNode.clientWidth || 500;
        }
      }, { passive: false });

      scrollWrapper.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2 && startDist > 0) {
          e.preventDefault(); // Stop window zooming/scrolling
          e.stopPropagation();
          const currentDist = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
          );
          const scale = currentDist / startDist;
          const newWidth = Math.max(350, Math.min(1000, startWidth * scale));
          sankeyNode.style.width = newWidth + 'px';
          sankeyNode.style.minWidth = newWidth + 'px';
        }
      }, { passive: false });

      scrollWrapper.addEventListener('touchend', (e) => {
        if (e.touches.length < 2) {
          startDist = 0;
        }
      });

      const helper = document.createElement('div');
      helper.style.cssText = 'font-size: 10.5px; color: var(--text-secondary); text-align: center; font-style: italic;';
      helper.innerText = '← Swipe to pan • Pinch with 2 fingers to zoom →';
      visContainer.appendChild(helper);

    } else if (selectedVis === 'spray') {
      const { plays, batterStats } = getDeterministicSprayPlays(game, selectedTeamId);
      const uniqueBatters = Array.from(new Set(plays.map(p => p.batter))).sort();
      
      const batterSelectContainer = document.createElement('div');
      batterSelectContainer.style.cssText = 'display: flex; align-items: center; gap: 8px; justify-content: space-between;';
      
      const selectLabel = document.createElement('span');
      selectLabel.style.cssText = 'font-size: 11px; font-weight: 700; color: var(--text-secondary);';
      selectLabel.innerText = 'Filter Batter:';
      
      const select = document.createElement('select');
      select.style.cssText = 'background: #ffffff; color: var(--text-primary); font-size: 12px; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border-glass-highlight); cursor: pointer; flex: 1; max-width: 220px;';
      
      const allOpt = document.createElement('option');
      allOpt.value = 'all';
      allOpt.innerText = 'All Batters (Team)';
      select.appendChild(allOpt);
      
      uniqueBatters.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b;
        opt.innerText = b;
        if (selectedBatter === b) opt.selected = true;
        select.appendChild(opt);
      });
      
      select.addEventListener('change', (e) => {
        selectedBatter = e.target.value;
        activePlayId = null;
        updateVisContent();
      });
      
      const cycleGroup = document.createElement('div');
      cycleGroup.style.cssText = 'display: flex; gap: 4px;';
      
      const prevBat = document.createElement('button');
      prevBat.innerText = '◀';
      prevBat.style.cssText = 'width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: #f1f5f9; border: 1px solid var(--border-glass); border-radius: 6px; color: var(--text-primary); cursor: pointer; font-size: 11px; transition: all 0.2s;';
      prevBat.addEventListener('click', () => {
        if (selectedBatter === 'all') {
          selectedBatter = uniqueBatters[uniqueBatters.length - 1];
        } else {
          const idx = uniqueBatters.indexOf(selectedBatter);
          if (idx === 0) selectedBatter = 'all';
          else selectedBatter = uniqueBatters[idx - 1];
        }
        activePlayId = null;
        updateVisContent();
      });
      
      const nextBat = document.createElement('button');
      nextBat.innerText = '▶';
      nextBat.style.cssText = 'width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: #f1f5f9; border: 1px solid var(--border-glass); border-radius: 6px; color: var(--text-primary); cursor: pointer; font-size: 11px; transition: all 0.2s;';
      nextBat.addEventListener('click', () => {
        if (selectedBatter === 'all') {
          selectedBatter = uniqueBatters[0];
        } else {
          const idx = uniqueBatters.indexOf(selectedBatter);
          if (idx === uniqueBatters.length - 1) selectedBatter = 'all';
          else selectedBatter = uniqueBatters[idx + 1];
        }
        activePlayId = null;
        updateVisContent();
      });
      
      [prevBat, nextBat].forEach(btn => {
        btn.addEventListener('mouseenter', () => { btn.style.background = '#e2e8f0'; });
        btn.addEventListener('mouseleave', () => { btn.style.background = '#f1f5f9'; });
      });
      
      cycleGroup.appendChild(prevBat);
      cycleGroup.appendChild(nextBat);
      
      batterSelectContainer.appendChild(selectLabel);
      batterSelectContainer.appendChild(select);
      batterSelectContainer.appendChild(cycleGroup);
      visContainer.appendChild(batterSelectContainer);

      const statsSummary = document.createElement('div');
      statsSummary.style.cssText = 'font-size: 11px; padding: 6px 10px; border-radius: 6px; background: #f8fafc; border: 1px solid var(--border-glass); text-align: center; font-weight: 500; display: none; margin-bottom: 4px;';
      if (selectedBatter !== 'all') {
        const bs = batterStats[selectedBatter] || { H: 0, AB: 0, BB: 0, HBP: 0 };
        const bbStr = bs.BB > 0 ? `, ${bs.BB} BB` : '';
        const hbpStr = bs.HBP > 0 ? `, ${bs.HBP} HBP` : '';
        statsSummary.innerHTML = `<span style="color: var(--text-secondary);">Today's Game Stats:</span> <strong style="color: var(--color-win); font-weight: 800; font-size: 11.5px;">${bs.H} for ${bs.AB}</strong>${bbStr}${hbpStr}`;
        statsSummary.style.display = 'block';
      }
      visContainer.appendChild(statsSummary);
      
      const fieldWrapper = document.createElement('div');
      fieldWrapper.style.cssText = 'position: relative; width: 100%; aspect-ratio: 1.55; max-height: 250px; background: #022c22; border-radius: 12px; overflow: hidden; border: 1px solid var(--border-glass); display: flex; justify-content: center;';
      
      const filteredPlays = selectedBatter === 'all' 
        ? plays 
        : plays.filter(p => p.batter === selectedBatter);
      
      const fieldNode = drawSprayFieldSVG(filteredPlays, activePlayId, (play) => {
        activePlayId = play.id;
        updateDetailsPanel(play);
        const dots = fieldWrapper.querySelectorAll('.hit-dot');
        dots.forEach(d => {
          d.setAttribute('r', d.getAttribute('id') === `dot-${play.id}` ? '7' : '4');
          d.setAttribute('stroke', d.getAttribute('id') === `dot-${play.id}` ? '#ffffff' : 'rgba(0,0,0,0.5)');
          d.setAttribute('stroke-width', d.getAttribute('id') === `dot-${play.id}` ? '1.5' : '0.5');
          d.style.filter = d.getAttribute('id') === `dot-${play.id}` ? 'drop-shadow(0 0 4px #ffffff)' : 'none';
        });
      });
      fieldWrapper.appendChild(fieldNode);
      visContainer.appendChild(fieldWrapper);

      const detailsPanel = document.createElement('div');
      detailsPanel.style.cssText = 'background: #f8fafc; border: 1px solid var(--border-glass); border-radius: 12px; padding: 10px 14px; min-height: 80px; display: flex; flex-direction: column; justify-content: center;';
      
      const updateDetailsPanel = (play) => {
        if (!play) {
          detailsPanel.innerHTML = '<div style="color: var(--text-secondary); text-align: center; font-size: 11.5px; font-style: italic;">Tap a hit dot on the field to view Statcast metrics</div>';
        } else {
          let eventColor = 'var(--text-secondary)';
          if (play.event === 'single') eventColor = '#3b82f6';
          else if (play.event === 'double') eventColor = '#10b981';
          else if (play.event === 'triple') eventColor = '#f59e0b';
          else if (play.event === 'hr') eventColor = '#ec4899';
          
          detailsPanel.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; border-bottom: 1px dashed var(--border-glass); padding-bottom: 4px;">
              <span style="font-weight: 700; font-size: 12px; color: var(--text-primary);">${play.batter}</span>
              <span style="font-size: 9.5px; font-weight: 800; padding: 2px 8px; border-radius: 100px; text-transform: uppercase; background: ${eventColor + '20'}; color: ${eventColor};">${play.desc}</span>
            </div>
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; text-align: center;">
              <div style="background: #ffffff; padding: 4px; border-radius: 6px; border: 1px solid var(--border-glass);">
                <div style="font-size: 12px; font-weight: 800; color: var(--text-primary);">${play.speed.toFixed(1)} mph</div>
                <div style="font-size: 7.5px; color: var(--text-secondary); text-transform: uppercase; margin-top: 1px;">Exit Velocity</div>
              </div>
              <div style="background: #ffffff; padding: 4px; border-radius: 6px; border: 1px solid var(--border-glass);">
                <div style="font-size: 12px; font-weight: 800; color: var(--text-primary);">${play.angle.toFixed(0)}°</div>
                <div style="font-size: 7.5px; color: var(--text-secondary); text-transform: uppercase; margin-top: 1px;">Launch Angle</div>
              </div>
              <div style="background: #ffffff; padding: 4px; border-radius: 6px; border: 1px solid var(--border-glass);">
                <div style="font-size: 12px; font-weight: 800; color: var(--text-primary);">${play.dist ? play.dist + ' ft' : '-'}</div>
                <div style="font-size: 7.5px; color: var(--text-secondary); text-transform: uppercase; margin-top: 1px;">Distance</div>
              </div>
            </div>
          `;
        }
      };
      
      if (activePlayId) {
        const activePlay = filteredPlays.find(p => p.id === activePlayId);
        updateDetailsPanel(activePlay);
      } else {
        updateDetailsPanel(null);
      }
      
      visContainer.appendChild(detailsPanel);

      const legend = document.createElement('div');
      legend.style.cssText = 'display: flex; gap: 8px; justify-content: center; font-size: 10px; color: var(--text-muted); flex-wrap: wrap; margin-top: 2px;';
      legend.innerHTML = `
        <div style="display: flex; align-items: center; gap: 4px;"><span style="width: 8px; height: 8px; border-radius: 50%; background: #3b82f6; display: inline-block;"></span>Single</div>
        <div style="display: flex; align-items: center; gap: 4px;"><span style="width: 8px; height: 8px; border-radius: 50%; background: #10b981; display: inline-block;"></span>Double</div>
        <div style="display: flex; align-items: center; gap: 4px;"><span style="width: 8px; height: 8px; border-radius: 50%; background: #f59e0b; display: inline-block;"></span>Triple</div>
        <div style="display: flex; align-items: center; gap: 4px;"><span style="width: 8px; height: 8px; border-radius: 50%; background: #ec4899; display: inline-block;"></span>Home Run</div>
        <div style="display: flex; align-items: center; gap: 4px;"><span style="width: 8px; height: 8px; border-radius: 50%; background: #64748b; display: inline-block;"></span>Out</div>
      `;
      visContainer.appendChild(legend);
    }
  };

  updateVisContent();
  document.body.appendChild(backdrop);
}
