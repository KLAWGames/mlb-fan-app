import './style.css';
import { teamsData } from './teamsData.js';
import { fetchStandings, fetchSchedule, formatLocalDate } from './mlbApi.js';
import { processStandings, analyzeMatchups } from './rootingEngine.js';
import { openGameAnalyticsCenter, reconstructGameFromSeasonGame } from './gameAnalytics.js';

function formatOffDayDate(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  const options = { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' };
  let formatted = d.toLocaleDateString('en-US', options);
  if (formatted.startsWith('Thu,')) {
    formatted = formatted.replace('Thu,', 'Thurs,');
  }
  return formatted;
}

// Global error handler for diagnostic alerts on mobile devices
window.onerror = function (message, source, lineno, colno, error) {
  alert("GLOBAL ERROR: " + message + " at " + source + ":" + lineno + (error ? "\n" + error.stack : ""));
  return false;
};
window.addEventListener('unhandledrejection', function (event) {
  alert("UNHANDLED REJECTION: " + event.reason + (event.reason?.stack ? "\n" + event.reason.stack : ""));
});

// Helper to get local date adjusted for the 2:00 AM baseball day rollover
function getBaseballDate(offsetDays = 0) {
  const shiftedDate = new Date(Date.now() - 2 * 60 * 60 * 1000);
  if (offsetDays !== 0) {
    shiftedDate.setDate(shiftedDate.getDate() + offsetDays);
  }
  return formatLocalDate(shiftedDate);
}

// Application State
let state = {
  selectedTeamIds: [], // Tracked favorite team IDs (max 3)
  activeTeamId: null,  // Currently active team ID in view
  activeView: 'dashboard', // 'dashboard' | 'standings' | 'settings'
  selectedDate: getBaseballDate(0), // YYYY-MM-DD
  rawStandings: null,
  rawSchedule: null,
  rawStandingsYesterday: null,
  rawStandingsDayBeforeYesterday: null,
  processedStandings: null,
  processedStandingsYesterday: null,
  processedStandingsDayBeforeYesterday: null,
  loading: false,
  searchQuery: '',
  magicNumberExpanded: false,
  activeTrackerTab: 'division', // 'division' | 'wildcard'
  expandedGamePks: [], // List of gamePk IDs that are expanded
  expandedTiebreakerTeamIds: [], // List of team IDs whose tiebreakers are expanded in the Wild Card view
  selectedGameIdx: null, // Index of the selected game in the active team's run differential chart
  lastActiveTeamId: null, // Tracks the last team ID to reset selection index on switch
  teamGames: {}, // Cache of season games by team ID
  bannerZoomedIn: false, // Tracks whether the run differential chart is zoomed to the last 10 games
  fetchingSchedules: {}, // Track ongoing schedule fetches
  rawScheduleYesterday: null, // Cache of yesterday's schedule
  recapOpened: false, // Tracks whether the recap modal is currently open
  highFivedTeams: [], // Track which team IDs have been high-fived
  previousMainView: 'dashboard', // Tracks previous view ('dashboard' | 'standings')
  transitionDirection: null // 'forward' | 'backward' | null for page transition animations
};

// Helper: Safely parse ISO UTC date strings to work reliably on all browsers (including iOS Safari)
function safeParseUTCDate(dateStr) {
  if (!dateStr) return new Date();
  if (dateStr instanceof Date) return dateStr;
  
  let d = new Date(dateStr);
  if (!isNaN(d.getTime())) return d;
  
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z?$/);
  if (match) {
    const [_, yyyy, mm, dd, hh, min, ss] = match.map(Number);
    return new Date(Date.UTC(yyyy, mm - 1, dd, hh, min, ss));
  }
  return d;
}

// Helper: Convert Hex color to RGB string for custom CSS transparency gradients
function hexToRgbString(hex) {
  let shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
  let fullHex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);
  let result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(fullHex);
  return result ? 
    `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` 
    : "19, 74, 142";
}

// Generate season standings history (wins - losses) deterministically using LCG or real API schedule
function generateSeasonHistory(teamId, wins, losses) {
  // 1. Silent schedule fetch for this team to get real games
  if (typeof fetchTeamSeasonSchedule === 'function') {
    fetchTeamSeasonSchedule(teamId);
  }
  if (typeof fetchTeamRoster === 'function') {
    fetchTeamRoster(teamId);
  }

  // 2. If real API games are cached for this team, parse and use them!
  if (state.teamGames && state.teamGames[teamId]) {
    const apiGames = state.teamGames[teamId];
    // Filter to regular season games that are completed (StatusCode 'F' or 'O')
    // AND where officialDate <= state.selectedDate
    const playedGames = apiGames.filter(g => {
      const isCompleted = g.status.statusCode === 'F' || g.status.statusCode === 'O';
      return isCompleted && g.officialDate <= state.selectedDate;
    });

    // Sort chronologically
    playedGames.sort((a, b) => a.officialDate.localeCompare(b.officialDate));

    if (playedGames.length > 0) {
      const history = [0];
      let diff = 0;
      playedGames.forEach(g => {
        const isHome = g.teams.home.team.id === teamId;
        const isWin = isHome ? g.teams.home.isWinner : g.teams.away.isWinner;
        diff += isWin ? 1 : -1;
        history.push(diff);
      });
      return history;
    }
  }

  // 3. Fallback to stable deterministic LCG propensity generator (prevents reshuffling past history)
  const G = wins + losses;
  if (G === 0) return [0];
  
  const history = [0];
  
  // Seed based on teamId so it's stable and unique per team
  let seed = teamId * 13;
  function lcg() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  }
  
  // Pre-generate propensities for 162 games
  const propensities = [];
  for (let i = 0; i < 162; i++) {
    propensities.push({ gameIndex: i, value: lcg() });
  }
  
  // Filter to games played so far (G)
  const playedPropensities = propensities.slice(0, G);
  
  // Sort by propensity value to select wins
  playedPropensities.sort((a, b) => b.value - a.value);
  
  // Mark top 'wins' count games as wins
  const winsSet = new Set(playedPropensities.slice(0, wins).map(p => p.gameIndex));
  
  let diff = 0;
  for (let i = 0; i < G; i++) {
    diff += winsSet.has(i) ? 1 : -1;
    history.push(diff);
  }
  
  return history;
}

// Generate interactive SVG chart comparing two division teams
function createDivisionRaceChart(teamA, teamB) {
  const historyA = generateSeasonHistory(teamA.id, teamA.wins, teamA.losses);
  const historyB = generateSeasonHistory(teamB.id, teamB.wins, teamB.losses);

  const maxG = Math.max(historyA.length - 1, historyB.length - 1, 1);
  const allY = [...historyA, ...historyB];
  const minYVal = Math.min(...allY);
  const maxYVal = Math.max(...allY);

  // Buffer for Y-axis
  const minY = Math.min(minYVal - 2, 0);
  const maxY = Math.max(maxYVal + 2, 2);
  const rangeY = maxY - minY;

  // SVG dimensions
  const svgWidth = 480;
  const svgHeight = 280;
  const padLeft = 45;
  const padRight = 35;
  const padTop = 15;
  const padBottom = 25;
  const chartWidth = svgWidth - padLeft - padRight;
  const chartHeight = svgHeight - padTop - padBottom;

  // Helper to map (game, val) to (x, y) pixels
  function getCoords(g, val) {
    const x = padLeft + (g / maxG) * chartWidth;
    const y = padTop + chartHeight - ((val - minY) / rangeY) * chartHeight;
    return { x, y };
  }

  // Draw grid lines and labels for Y-axis
  const ySteps = 4;
  let gridLinesHtml = '';
  const drawnValues = new Set();
  
  // First, if 0 is in the range, let's draw it and add 0 to drawnValues
  if (minY <= 0 && maxY >= 0) {
    const { y } = getCoords(0, 0);
    gridLinesHtml += `
      <line x1="${padLeft}" y1="${y}" x2="${svgWidth - padRight}" y2="${y}" stroke="var(--border-glass-highlight)" stroke-width="1.5" />
      <text x="${padLeft - 8}" y="${y}" font-size="9px" font-family="var(--font-body)" font-weight="600" fill="var(--text-muted)" text-anchor="end" alignment-baseline="middle">.500</text>
    `;
    drawnValues.add(0);
  }

  for (let i = 0; i <= ySteps; i++) {
    const val = Math.round(minY + (i / ySteps) * rangeY);
    if (drawnValues.has(val)) continue;
    drawnValues.add(val);
    
    const { y } = getCoords(0, val);
    gridLinesHtml += `
      <line x1="${padLeft}" y1="${y}" x2="${svgWidth - padRight}" y2="${y}" stroke="var(--border-glass)" stroke-width="1" stroke-dasharray="3,3" />
      <text x="${padLeft - 8}" y="${y}" font-size="9px" font-family="var(--font-body)" fill="var(--text-muted)" text-anchor="end" alignment-baseline="middle">${val > 0 ? `+${val}` : val}</text>
    `;
  }

  // Draw X-axis grid lines and labels (game numbers)
  const xSteps = [0, Math.round(maxG / 2), maxG];
  let xAxisHtml = '';
  xSteps.forEach(g => {
    const { x } = getCoords(g, 0);
    xAxisHtml += `<line x1="${x}" y1="${padTop}" x2="${x}" y2="${svgHeight - padBottom}" stroke="var(--border-glass)" stroke-width="1" stroke-dasharray="3,3" />`;
    xAxisHtml += `<text x="${x}" y="${svgHeight - padBottom + 12}" font-size="9px" font-family="var(--font-body)" fill="var(--text-muted)" text-anchor="middle">Gm ${g}</text>`;
  });

  // Generate path string for Team A
  let pathA = '';
  historyA.forEach((val, g) => {
    const { x, y } = getCoords(g, val);
    pathA += (g === 0 ? 'M' : 'L') + ` ${x.toFixed(1)} ${y.toFixed(1)}`;
  });

  // Generate path string for Team B
  let pathB = '';
  historyB.forEach((val, g) => {
    const { x, y } = getCoords(g, val);
    pathB += (g === 0 ? 'M' : 'L') + ` ${x.toFixed(1)} ${y.toFixed(1)}`;
  });

  // Generate gradient area path string for Team A
  let areaA = pathA;
  const endCoordsA = getCoords(historyA.length - 1, minY);
  const startCoordsA = getCoords(0, minY);
  areaA += ` L ${endCoordsA.x.toFixed(1)} ${endCoordsA.y.toFixed(1)} L ${startCoordsA.x.toFixed(1)} ${startCoordsA.y.toFixed(1)} Z`;

  // Generate gradient area path string for Team B
  let areaB = pathB;
  const endCoordsB = getCoords(historyB.length - 1, minY);
  const startCoordsB = getCoords(0, minY);
  areaB += ` L ${endCoordsB.x.toFixed(1)} ${endCoordsB.y.toFixed(1)} L ${startCoordsB.x.toFixed(1)} ${startCoordsB.y.toFixed(1)} Z`;

  // Colors
  const colorA = teamA.primaryColor || '#134a8e';
  const colorB = teamB.primaryColor || '#f5d130';

  // Last points coordinates
  const lastGA = historyA.length - 1;
  const lastValA = historyA[lastGA];
  const ptA = getCoords(lastGA, lastValA);

  const lastGB = historyB.length - 1;
  const lastValB = historyB[lastGB];
  const ptB = getCoords(lastGB, lastValB);

  // Label overlap adjustment
  let labelYA = ptA.y;
  let labelYB = ptB.y;
  if (Math.abs(labelYA - labelYB) < 12) {
    if (labelYA <= labelYB) {
      labelYA -= 6;
      labelYB += 6;
    } else {
      labelYA += 6;
      labelYB -= 6;
    }
  }

  // Create wrapper div
  const div = document.createElement('div');
  div.className = 'division-chart-container';
  div.style.width = '100%';

  // Gradient definitions
  const defsHtml = `
    <defs>
      <linearGradient id="gradA-${teamA.id}" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="${colorA}" stop-opacity="0.10" />
        <stop offset="100%" stop-color="${colorA}" stop-opacity="0.00" />
      </linearGradient>
      <linearGradient id="gradB-${teamB.id}" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="${colorB}" stop-opacity="0.10" />
        <stop offset="100%" stop-color="${colorB}" stop-opacity="0.00" />
      </linearGradient>
    </defs>
  `;

  div.innerHTML = `
    <svg viewBox="0 0 ${svgWidth} ${svgHeight}" width="100%" height="auto" style="overflow: visible; background: none; border-radius: 4px;">
      ${defsHtml}
      
      <!-- Grid -->
      ${gridLinesHtml}
      ${xAxisHtml}
      
      <!-- Area Gradients -->
      <path d="${areaB}" fill="url(#gradB-${teamB.id})" />
      <path d="${areaA}" fill="url(#gradA-${teamA.id})" />
      
      <!-- Team B Line -->
      <path d="${pathB}" fill="none" stroke="${colorB}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
      
      <!-- Team A Line -->
      <path d="${pathA}" fill="none" stroke="${colorA}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" />
      
      <!-- Today Dots -->
      <circle cx="${ptB.x}" cy="${ptB.y}" r="4" fill="#ffffff" stroke="${colorB}" stroke-width="2" />
      <circle cx="${ptA.x}" cy="${ptA.y}" r="5" fill="#ffffff" stroke="${colorA}" stroke-width="2.5" />
      
      <!-- Labels at end of lines -->
      <text x="${ptB.x + 8}" y="${labelYB}" font-size="9px" font-weight="700" font-family="var(--font-title)" fill="${colorB}" alignment-baseline="middle">${teamB.abbreviation}</text>
      <text x="${ptA.x + 8}" y="${labelYA}" font-size="9px" font-weight="700" font-family="var(--font-title)" fill="${colorA}" alignment-baseline="middle">${teamA.abbreviation}</text>
    </svg>
  `;

  return div;
}

// Generate interactive SVG chart comparing multiple division/wild card teams
function createMultiTeamRaceChart(activeTeam, teamsList) {
  // Deduplicate teams by ID
  const uniqueTeamsMap = new Map();
  teamsList.forEach(t => {
    if (t) uniqueTeamsMap.set(t.id, t);
  });
  uniqueTeamsMap.set(activeTeam.id, activeTeam);
  const finalTeams = Array.from(uniqueTeamsMap.values());

  const teamHistories = finalTeams.map(t => {
    const rawHistory = generateSeasonHistory(t.id, t.wins, t.losses);
    const sliceCount = 10;
    const startIdx = Math.max(0, rawHistory.length - 1 - sliceCount);
    const historySlice = rawHistory.slice(startIdx);
    return {
      team: t,
      history: historySlice,
      startIdx: startIdx,
      totalGames: rawHistory.length - 1
    };
  });

  const maxG = Math.max(...teamHistories.map(th => th.history.length - 1), 1);
  const allY = teamHistories.flatMap(th => th.history);
  const minYVal = Math.min(...allY);
  const maxYVal = Math.max(...allY);

  const minY = Math.min(minYVal - 2, 0);
  const maxY = Math.max(maxYVal + 2, 2);
  const rangeY = maxY - minY;

  const svgWidth = 480;
  const svgHeight = 280;
  const padLeft = 45;
  const padRight = 65;
  const padTop = 15;
  const padBottom = 25;
  const chartWidth = svgWidth - padLeft - padRight;
  const chartHeight = svgHeight - padTop - padBottom;

  function getCoords(g, val) {
    const x = padLeft + (g / maxG) * chartWidth;
    const y = padTop + chartHeight - ((val - minY) / rangeY) * chartHeight;
    return { x, y };
  }

  const ySteps = 4;
  let gridLinesHtml = '';
  const drawnValues = new Set();
  
  if (minY <= 0 && maxY >= 0) {
    const { y } = getCoords(0, 0);
    gridLinesHtml += `
      <line x1="${padLeft}" y1="${y}" x2="${svgWidth - padRight}" y2="${y}" stroke="var(--border-glass-highlight)" stroke-width="1.5" />
      <text x="${padLeft - 8}" y="${y}" font-size="9px" font-family="var(--font-body)" font-weight="600" fill="var(--text-muted)" text-anchor="end" alignment-baseline="middle">.500</text>
    `;
    drawnValues.add(0);
  }

  for (let i = 0; i <= ySteps; i++) {
    const val = Math.round(minY + (i / ySteps) * rangeY);
    if (drawnValues.has(val)) continue;
    drawnValues.add(val);
    const { y } = getCoords(0, val);
    gridLinesHtml += `
      <line x1="${padLeft}" y1="${y}" x2="${svgWidth - padRight}" y2="${y}" stroke="var(--border-glass)" stroke-width="1" stroke-dasharray="3,3" />
      <text x="${padLeft - 8}" y="${y}" font-size="9px" font-family="var(--font-body)" fill="var(--text-muted)" text-anchor="end" alignment-baseline="middle">${val > 0 ? `+${val}` : val}</text>
    `;
  }

  const xSteps = [0, Math.round(maxG / 2), maxG];
  let xAxisHtml = '';
  xSteps.forEach(g => {
    const { x } = getCoords(g, 0);
    xAxisHtml += `<line x1="${x}" y1="${padTop}" x2="${x}" y2="${svgHeight - padBottom}" stroke="var(--border-glass)" stroke-width="1" stroke-dasharray="3,3" />`;
    
    // Calculate the actual game number for this step based on the active team
    const firstTeam = teamHistories.find(th => th.team.id === activeTeam.id) || teamHistories[0];
    const actualGameNum = (firstTeam ? firstTeam.startIdx : 0) + g;
    xAxisHtml += `<text x="${x}" y="${svgHeight - padBottom + 12}" font-size="9px" font-family="var(--font-body)" fill="var(--text-muted)" text-anchor="middle">Gm ${actualGameNum}</text>`;
  });

  let linesHtml = '';
  let areaGradientsHtml = '';
  let gradientDefsHtml = '';
  let dotsHtml = '';
  let labelsHtml = '';

  // Render active team last so it sits on top of others
  teamHistories.sort((a, b) => (a.team.id === activeTeam.id ? 1 : b.team.id === activeTeam.id ? -1 : 0));

  const labelYMap = [];
  const footnotes = [];

  teamHistories.forEach(th => {
    const t = th.team;
    const history = th.history;
    const color = t.primaryColor || '#134a8e';
    const isActive = t.id === activeTeam.id;

    let path = '';
    history.forEach((val, g) => {
      const { x, y } = getCoords(g, val);
      path += (g === 0 ? 'M' : 'L') + ` ${x.toFixed(1)} ${y.toFixed(1)}`;
    });

    const opacity = isActive ? 0.08 : 0.02;
    let area = path;
    const endCoords = getCoords(history.length - 1, minY);
    const startCoords = getCoords(0, minY);
    area += ` L ${endCoords.x.toFixed(1)} ${endCoords.y.toFixed(1)} L ${startCoords.x.toFixed(1)} ${startCoords.y.toFixed(1)} Z`;

    gradientDefsHtml += `
      <linearGradient id="grad-${t.id}" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="${color}" stop-opacity="${opacity}" />
        <stop offset="100%" stop-color="${color}" stop-opacity="0.00" />
      </linearGradient>
    `;

    areaGradientsHtml += `<path d="${area}" fill="url(#grad-${t.id})" />`;

    const strokeWidth = isActive ? 3.5 : 1.8;
    linesHtml += `<path d="${path}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" />`;

    const lastG = history.length - 1;
    const lastVal = history[lastG];
    const pt = getCoords(lastG, lastVal);

    const r = isActive ? 5 : 3;
    const strokeW = isActive ? 2.5 : 1.5;
    dotsHtml += `<circle cx="${pt.x}" cy="${pt.y}" r="${r}" fill="#ffffff" stroke="${color}" stroke-width="${strokeW}" />`;
  });

  // Group team labels by their final standing values to handle ties cleanly (e.g., TOR (+2) and footnote below)
  const finalValGroups = new Map();
  teamHistories.forEach(th => {
    const lastVal = th.history[th.history.length - 1];
    if (!finalValGroups.has(lastVal)) {
      finalValGroups.set(lastVal, []);
    }
    finalValGroups.get(lastVal).push(th);
  });

  const sortedGroupKeys = Array.from(finalValGroups.keys()).sort((a, b) => b - a);

  sortedGroupKeys.forEach(val => {
    const groupItems = finalValGroups.get(val);
    const lastG = groupItems[0].history.length - 1;
    const pt = getCoords(lastG, val);

    // Sort items so active team is listed first
    groupItems.sort((a, b) => {
      const isActA = a.team.id === activeTeam.id;
      const isActB = b.team.id === activeTeam.id;
      return isActA ? -1 : isActB ? 1 : 0;
    });

    const primaryTeam = groupItems[0].team;
    const hasActiveTeam = groupItems.some(item => item.team.id === activeTeam.id);
    const color = hasActiveTeam 
      ? (activeTeam.primaryColor || '#134a8e') 
      : (primaryTeam.primaryColor || '#888');

    let labelText = primaryTeam.abbreviation;
    const isTie = groupItems.length > 1;
    if (isTie) {
      // Format footnote: e.g., "TIE = TOR, HOU, TEX"
      const teamsListStr = groupItems.map(item => item.team.abbreviation).join(', ');
      footnotes.push({ hasActiveTeam, color, teamsListStr });
    }

    // Run overlap resolver to avoid overlap between different groups
    let targetY = pt.y;
    let overlap = true;
    let attempts = 0;
    while (overlap && attempts < 10) {
      overlap = false;
      for (const existingY of labelYMap) {
        if (Math.abs(existingY - targetY) < 10) {
          overlap = true;
          targetY += existingY >= targetY ? -10 : 10;
          break;
        }
      }
      attempts++;
    }
    labelYMap.push(targetY);

    if (isTie) {
      // SVG pill dimensions for "TIE"
      const pillW = 20;
      const pillH = 11;
      const pillX = pt.x + 8;
      const pillY = targetY - 5.5; // Centered vertically on alignment line

      const pillBgColor = hasActiveTeam ? color : 'rgba(100, 116, 139, 0.18)';
      const pillTextColor = hasActiveTeam ? '#ffffff' : 'var(--text-secondary)';
      const pillWeight = hasActiveTeam ? '800' : '600';

      labelsHtml += `
        <g>
          <rect x="${pillX}" y="${pillY}" width="${pillW}" height="${pillH}" rx="3" fill="${pillBgColor}" />
          <text x="${pillX + pillW/2}" y="${targetY}" font-size="7px" font-weight="${pillWeight}" font-family="var(--font-title)" fill="${pillTextColor}" text-anchor="middle" alignment-baseline="middle">TIE</text>
        </g>
      `;
    } else {
      const labelWeight = hasActiveTeam ? '700' : '500';
      const labelOpacity = hasActiveTeam ? '1' : '0.75';
      labelsHtml += `<text x="${pt.x + 8}" y="${targetY}" font-size="8.5px" font-weight="${labelWeight}" opacity="${labelOpacity}" font-family="var(--font-title)" fill="${color}" alignment-baseline="middle">${labelText}</text>`;
    }
  });

  const div = document.createElement('div');
  div.className = 'division-chart-container';
  div.style.width = '100%';

  let footnoteHtml = '';
  if (footnotes.length > 0) {
    footnoteHtml = `
      <div class="chart-footnotes" style="display: flex; flex-direction: column; gap: 4px; align-items: center; justify-content: center; margin-top: 10px;">
        ${footnotes.map(f => `
          <div style="display: flex; align-items: center; font-size: 11px; color: var(--text-secondary); font-weight: 500;">
            <span style="display:inline-block; padding: 2px 5px; font-size: 9px; font-weight: 700; font-family: var(--font-title); background: ${f.hasActiveTeam ? f.color : 'rgba(100, 116, 139, 0.18)'}; color: ${f.hasActiveTeam ? '#ffffff' : 'var(--text-secondary)'}; border-radius: 3px; margin-right: 6px; line-height: 1;">TIE</span>
            <span>= ${f.teamsListStr}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  div.innerHTML = `
    <svg viewBox="0 0 ${svgWidth} ${svgHeight}" width="100%" height="auto" style="overflow: visible; background: none; border-radius: 4px;">
      <defs>${gradientDefsHtml}</defs>
      ${gridLinesHtml}
      ${xAxisHtml}
      ${areaGradientsHtml}
      ${linesHtml}
      ${dotsHtml}
      ${labelsHtml}
    </svg>
    ${footnoteHtml}
  `;

  return div;
}

// Silent fetch of season schedule for a team
async function fetchTeamSeasonSchedule(teamId) {
  if (state.teamGames && state.teamGames[teamId]) return;
  if (!state.fetchingSchedules) state.fetchingSchedules = {};
  if (state.fetchingSchedules[teamId]) return; // already fetching!
  
  state.fetchingSchedules[teamId] = true;
  try {
    const res = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&season=2026&teamId=${teamId}&gameType=R`);
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    const games = [];
    if (data.dates) {
      data.dates.forEach(d => {
        if (d.games) {
          d.games.forEach(g => {
            games.push(g);
          });
        }
      });
    }
    if (!state.teamGames) state.teamGames = {};
    state.teamGames[teamId] = games;
    render();
  } catch (err) {
    console.warn(`Failed to silently fetch schedule for team ${teamId}:`, err.message);
  } finally {
    state.fetchingSchedules[teamId] = false;
  }
}

async function fetchTeamRoster(teamId) {
  if (state.teamRosters && state.teamRosters[teamId]) return;
  if (!state.fetchingRosters) state.fetchingRosters = {};
  if (state.fetchingRosters[teamId]) return; // already fetching!

  state.fetchingRosters[teamId] = true;
  try {
    const res = await fetch(`https://statsapi.mlb.com/api/v1/teams/${teamId}/roster?rosterType=active&season=2026`);
    if (!res.ok) throw new Error('API error');
    const data = await res.json();
    const batters = [];
    if (data.roster) {
      data.roster.forEach(item => {
        if (item.person && item.person.fullName) {
          const isPitcher = item.position && (item.position.abbreviation === 'P' || item.position.type === 'Pitcher');
          if (!isPitcher) {
            batters.push(item.person.fullName);
          }
        }
      });
    }
    if (batters.length > 0) {
      if (!state.teamRosters) state.teamRosters = {};
      state.teamRosters[teamId] = batters;
      render();
    }
  } catch (err) {
    console.warn(`Failed to silently fetch roster for team ${teamId}:`, err.message);
  } finally {
    state.fetchingRosters[teamId] = false;
  }
}

// Generate deterministic game-by-game results for a team
function generateSeasonGames(teamId, wins, losses) {
  // Trigger silent fetch for this team's schedule if not already loaded
  fetchTeamSeasonSchedule(teamId);
  fetchTeamRoster(teamId);

  // If real API games are cached for this team, parse and use them!
  if (state.teamGames && state.teamGames[teamId]) {
    const apiGames = state.teamGames[teamId];
    // Filter to regular season games that are completed (StatusCode 'F' or 'O')
    // AND where officialDate <= state.selectedDate
    const playedGames = apiGames.filter(g => {
      const isCompleted = g.status.statusCode === 'F' || g.status.statusCode === 'O';
      return isCompleted && g.officialDate <= state.selectedDate;
    });

    // Sort chronologically
    playedGames.sort((a, b) => a.officialDate.localeCompare(b.officialDate));

    if (playedGames.length > 0) {
      return playedGames.map((g, idx) => {
        const isHome = g.teams.home.team.id === teamId;
        const teamScore = isHome ? g.teams.home.score : g.teams.away.score;
        const oppScore = isHome ? g.teams.away.score : g.teams.home.score;
        const opponentObj = isHome ? g.teams.away.team : g.teams.home.team;
        
        const opponentData = teamsData[opponentObj.id] || { 
          name: opponentObj.name, 
          abbreviation: opponentObj.name.substring(0, 3).toUpperCase() 
        };
        
        const isWin = isHome ? g.teams.home.isWinner : g.teams.away.isWinner;
        const runDiff = teamScore - oppScore;

        // Parse date (splitting by '-' to avoid Safari issues)
        const parts = g.officialDate.split('-');
        const gameDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        const dateStr = gameDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

        return {
          gamePk: g.gamePk,
          gameNumber: idx + 1,
          dateStr,
          gameDateISO: g.officialDate,
          opponent: opponentData.name,
          opponentAbbr: opponentData.abbreviation,
          opponentId: opponentObj.id,
          isHome,
          isWin,
          teamScore,
          oppScore,
          runDiff
        };
      });
    }
  }

  const G = wins + losses;
  if (G === 0) return [];
  
  // Seed based on teamId so it's stable
  let seed = teamId * 17;
  function lcg() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  }
  
  // Outcomes: wins (+1) and losses (-1)
  const outcomes = [];
  for (let i = 0; i < wins; i++) outcomes.push(1);
  for (let i = 0; i < losses; i++) outcomes.push(-1);
  
  // Deterministic shuffle
  for (let i = G - 1; i > 0; i--) {
    const j = Math.floor(lcg() * (i + 1));
    const temp = outcomes[i];
    outcomes[i] = outcomes[j];
    outcomes[j] = temp;
  }
  
  const parts = state.selectedDate.split('-');
  const baseDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  const gamesList = [];
  const otherTeamIds = Object.keys(teamsData).map(Number).filter(id => id !== teamId);
  
  for (let i = 0; i < G; i++) {
    // Spacing out games going backward from selected date
    const reverseIdx = G - 1 - i;
    const offsetDays = reverseIdx + Math.floor(reverseIdx / 6);
    const gameDate = new Date(baseDate.getTime() - offsetDays * 24 * 60 * 60 * 1000);
    
    // Opponent
    const oppIdx = Math.floor(lcg() * otherTeamIds.length);
    const oppId = otherTeamIds[oppIdx];
    const opponent = teamsData[oppId] || { name: "Opponent", abbreviation: "OPP" };
    
    // Scores
    const isWin = outcomes[i] === 1;
    const runDiff = Math.floor(lcg() * 7) + 1; // 1 to 7
    const oppScore = Math.floor(lcg() * 5); // 0 to 4
    
    let teamScore, finalOppScore;
    if (isWin) {
      teamScore = oppScore + runDiff;
      finalOppScore = oppScore;
    } else {
      teamScore = oppScore;
      finalOppScore = oppScore + runDiff;
    }
    
    gamesList.push({
      gameNumber: i + 1,
      dateStr: gameDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      gameDateISO: formatLocalDate(gameDate),
      opponent: opponent.name,
      opponentAbbr: opponent.abbreviation,
      opponentId: oppId,
      isHome: (i % 2 === 0),
      isWin,
      teamScore,
      oppScore: finalOppScore,
      runDiff: isWin ? runDiff : -runDiff
    });
  }
  
  return gamesList;
}

// Calculate games out of the closest wildcard spot (or safety cushion if leading)
function getWildCardStats(team, standings) {
  if (!standings) return '-';
  const leagueId = team.leagueId;
  const allLeague = standings.leagueTeams?.[leagueId] || [];
  const wcPool = allLeague.filter(t => !t.divisionLeader).sort((a, b) => a.wildCardRank - b.wildCardRank);
  
  if (wcPool.length < 3) return '-';
  
  const cutoffTeam = wcPool[2]; // 3rd spot
  
  if (team.divisionLeader) {
    const gb = ((cutoffTeam.wins - team.wins) + (team.losses - cutoffTeam.losses)) / 2;
    if (gb < 0) {
      return `+${Math.abs(gb)} WC`;
    } else {
      return `${gb} GB`;
    }
  }
  
  // If in wcPool, find the record
  const teamRec = wcPool.find(t => t.id === team.id);
  if (!teamRec) return '-';
  
  if (teamRec.wildCardRank <= 3) {
    const gb = teamRec.wildCardGamesBack; // negative or 0
    if (gb < 0) {
      return `+${Math.abs(gb)} WC`;
    } else {
      return '0.0 WC';
    }
  } else {
    const gb = teamRec.wildCardGamesBack; // positive
    return `${gb} GB`;
  }
}

// Dynamically inject custom CSS variables for the active team's branding
function updateTeamTheme(teamId) {
  const team = teamsData[teamId];
  if (!team) return;
  document.documentElement.style.setProperty('--team-primary', team.primaryColor);
  document.documentElement.style.setProperty('--team-secondary', team.secondaryColor);
  document.documentElement.style.setProperty('--team-text', team.textColor);
  document.documentElement.style.setProperty('--team-primary-rgb', hexToRgbString(team.primaryColor));
  document.documentElement.style.setProperty('--team-secondary-rgb', hexToRgbString(team.secondaryColor));
}

// Deterministic Head-to-Head series generator for tied teams
function getSimulatedHeadToHead(teamAId, teamBId) {
  const key = teamAId < teamBId ? `${teamAId}-${teamBId}` : `${teamBId}-${teamAId}`;
  
  // Predefined season series records for key tied teams to make them look authentic
  const customSeries = {
    // Athletics (133) vs Blue Jays (141)
    "133-141": { team1Wins: 4, team2Wins: 3 }, // Athletics won 4-3
    // Athletics (133) vs Rangers (140)
    "133-140": { team1Wins: 8, team2Wins: 5 }, // Athletics won 8-5
    // Blue Jays (141) vs Rangers (140)
    "140-141": { team1Wins: 2, team2Wins: 5 }, // Blue Jays won 5-2
    // Astros (117) vs Athletics (133)
    "117-133": { team1Wins: 7, team2Wins: 6 }, // Astros won 7-6
    // Mariners (136) vs Athletics (133)
    "133-136": { team1Wins: 6, team2Wins: 7 }, // Mariners won 7-6
    // Astros (117) vs Mariners (136)
    "117-136": { team1Wins: 5, team2Wins: 8 }, // Mariners won 8-5
    // Orioles (110) vs Rays (139)
    "110-139": { team1Wins: 6, team2Wins: 7 }  // Rays won 7-6
  };

  if (customSeries[key]) {
    const isTeam1 = teamAId < teamBId;
    return {
      winsA: isTeam1 ? customSeries[key].team1Wins : customSeries[key].team2Wins,
      winsB: isTeam1 ? customSeries[key].team2Wins : customSeries[key].team1Wins
    };
  }

  // Fallback: Generate a deterministic record (7-game series)
  const hash = (teamAId * 17 + teamBId * 31) % 7;
  const team1Wins = hash >= 3 ? 4 : 5;
  const team2Wins = 7 - team1Wins;
  const isTeam1 = teamAId < teamBId;
  return {
    winsA: isTeam1 ? team1Wins : team2Wins,
    winsB: isTeam1 ? team2Wins : team1Wins
  };
}

// Deterministic Division Record percentage generator
function getSimulatedDivisionRecord(teamId) {
  const pct = 0.400 + ((teamId * 73) % 201) / 1000;
  return pct.toFixed(3);
}

// Calculate the itemized tiebreaker records and explanations for a group of tied teams
function calculateTiebreakerRecords(tiedTeams) {
  if (tiedTeams.length === 2) {
    const t1 = tiedTeams[0];
    const t2 = tiedTeams[1];
    const record = getSimulatedHeadToHead(t1.id, t2.id);
    return [
      {
        team: t1,
        rankInTie: 1,
        criteria: "Head-to-Head Record",
        recordStr: `${record.winsA}-${record.winsB}`,
        explanation: `Won the season series against ${t2.shortName} (${record.winsA}-${record.winsB}).`
      },
      {
        team: t2,
        rankInTie: 2,
        criteria: "Head-to-Head Record",
        recordStr: `${record.winsB}-${record.winsA}`,
        explanation: `Lost the season series against ${t1.shortName} (${record.winsB}-${record.winsA}).`
      }
    ];
  }

  // 3+ teams: Compute combined record within the group
  const groupStats = tiedTeams.map(t => {
    let groupWins = 0;
    let groupLosses = 0;
    const matchups = [];

    tiedTeams.forEach(opp => {
      if (t.id === opp.id) return;
      const h2h = getSimulatedHeadToHead(t.id, opp.id);
      groupWins += h2h.winsA;
      groupLosses += h2h.winsB;
      matchups.push(`${opp.shortName} (${h2h.winsA}-${h2h.winsB})`);
    });

    const totalGames = groupWins + groupLosses;
    const pctVal = totalGames > 0 ? groupWins / totalGames : 0;
    
    return {
      team: t,
      wins: groupWins,
      losses: groupLosses,
      pctVal: pctVal,
      pctStr: pctVal.toFixed(3),
      matchups
    };
  });

  const results = [];
  const pcts = groupStats.map(s => s.pctStr);
  const uniquePcts = new Set(pcts);
  const isResolvedByH2H = uniquePcts.size === groupStats.length;

  groupStats.forEach((stat, idx) => {
    let explanation = "";
    let criteria = "Head-to-Head (Group)";
    let recordStr = `${stat.wins}-${stat.losses} (${stat.pctStr})`;
    
    if (isResolvedByH2H) {
      if (idx === 0) {
        explanation = `Holds top seed with the best head-to-head record within the tied group: ${recordStr} against opponents (${stat.matchups.join(', ')}).`;
      } else {
        explanation = `Places #${idx + 1} with a ${recordStr} head-to-head record against opponents (${stat.matchups.join(', ')}).`;
      }
    } else {
      criteria = "Division Record";
      const divPct = getSimulatedDivisionRecord(stat.team.id);
      recordStr = `Intradivision: ${divPct}`;
      
      if (idx === 0) {
        explanation = `Holds top seed with the best intradivision winning percentage (${divPct}) after group head-to-head was tied.`;
      } else {
        explanation = `Places #${idx + 1} with an intradivision winning percentage of ${divPct} after group head-to-head was tied.`;
      }
    }
    
    results.push({
      team: stat.team,
      rankInTie: idx + 1,
      criteria,
      recordStr,
      explanation
    });
  });

  return results;
}

// Initialize Application
async function init() {
  const startTime = Date.now();

  // Load tracked teams from localStorage
  const saved = localStorage.getItem('tracked_teams');
  if (saved) {
    try {
      state.selectedTeamIds = JSON.parse(saved);
    } catch (e) {
      state.selectedTeamIds = [];
    }
  }

  // Fallback default selection if empty: Blue Jays (141)
  if (state.selectedTeamIds.length === 0) {
    state.selectedTeamIds = [141];
    localStorage.setItem('tracked_teams', JSON.stringify(state.selectedTeamIds));
  }

  state.activeTeamId = state.selectedTeamIds[0];
  updateTeamTheme(state.activeTeamId);

  // Set initial view
  state.activeView = 'dashboard';

  // Render initial frame/loader
  render();

  // Load Data
  await loadData();

  // Enforce a minimum display duration of 3 seconds to reinforce branding
  const elapsed = Date.now() - startTime;
  const remainingDelay = Math.max(0, 3000 - elapsed);

  setTimeout(() => {
    // Fade out splash screen
    const splash = document.getElementById('app-splash-screen');
    if (splash) {
      splash.classList.add('fade-out');
      setTimeout(() => {
        splash.remove();
      }, 500);
    }
  }, remainingDelay);

  // Start auto-refresh interval for live scores
  startAutoRefresh();
}

// Scroll-to-hide functionality removed for persistent navigation layout

// Sync active team default playoff tracker tab
function syncDefaultTab() {
  const team = state.processedStandings?.teamsMap?.[state.activeTeamId];
  if (team) {
    if (team.divisionLeader) {
      state.activeTrackerTab = 'division';
    } else {
      state.activeTrackerTab = 'wildcard';
    }
  }
}

// Calculate division standings trend (gained/lost games) compared to yesterday
function getDivisionTrend(teamId) {
  const teamToday = state.processedStandings?.teamsMap?.[teamId];
  const teamYesterday = state.processedStandingsYesterday?.teamsMap?.[teamId];
  if (!teamToday || !teamYesterday) return null;
  
  if (teamToday.divisionLeader) {
    // Compare division lead over the 2nd place team
    const divId = teamToday.divisionId;
    const divTeamsToday = state.processedStandings?.divisionTeams?.[divId] || [];
    const divTeamsYesterday = state.processedStandingsYesterday?.divisionTeams?.[divId] || [];
    
    const secondToday = divTeamsToday[1];
    const secondYesterday = divTeamsYesterday[1];
    
    if (secondToday && secondYesterday) {
      const leadToday = ((teamToday.wins - secondToday.wins) + (secondToday.losses - teamToday.losses)) / 2;
      const leadYesterday = ((teamYesterday.wins - secondYesterday.wins) + (secondYesterday.losses - teamYesterday.losses)) / 2;
      return leadToday - leadYesterday;
    }
    return 0;
  } else {
    // Compare games back gap (yesterday - today, positive is good)
    return teamYesterday.gamesBack - teamToday.gamesBack;
  }
}

// Calculate Wild Card standings trend (gained/lost games) compared to yesterday
function getWildCardTrend(teamId) {
  const teamToday = state.processedStandings?.teamsMap?.[teamId];
  const teamYesterday = state.processedStandingsYesterday?.teamsMap?.[teamId];
  if (!teamToday || !teamYesterday) return null;
  
  return teamYesterday.wildCardGamesBack - teamToday.wildCardGamesBack;
}

// Calculate recap division standings trend (gained/lost games) comparing yesterday to day-before-yesterday
function getRecapDivisionTrend(teamId) {
  const teamToday = state.processedStandingsYesterday?.teamsMap?.[teamId];
  const teamYesterday = state.processedStandingsDayBeforeYesterday?.teamsMap?.[teamId];
  if (!teamToday || !teamYesterday) return null;
  
  if (teamToday.divisionLeader) {
    const divId = teamToday.divisionId;
    const divTeamsToday = state.processedStandingsYesterday?.divisionTeams?.[divId] || [];
    const divTeamsYesterday = state.processedStandingsDayBeforeYesterday?.divisionTeams?.[divId] || [];
    
    const secondToday = divTeamsToday[1];
    const secondYesterday = divTeamsYesterday[1];
    
    if (secondToday && secondYesterday) {
      const leadToday = ((teamToday.wins - secondToday.wins) + (secondToday.losses - teamToday.losses)) / 2;
      const leadYesterday = ((teamYesterday.wins - secondYesterday.wins) + (secondYesterday.losses - teamYesterday.losses)) / 2;
      return leadToday - leadYesterday;
    }
    return 0;
  } else {
    return teamYesterday.gamesBack - teamToday.gamesBack;
  }
}

// Calculate recap Wild Card standings trend (gained/lost games) comparing yesterday to day-before-yesterday
function getRecapWildCardTrend(teamId) {
  const teamToday = state.processedStandingsYesterday?.teamsMap?.[teamId];
  const teamYesterday = state.processedStandingsDayBeforeYesterday?.teamsMap?.[teamId];
  if (!teamToday || !teamYesterday) return null;
  
  return teamYesterday.wildCardGamesBack - teamToday.wildCardGamesBack;
}

// Render trend badge
function renderTrendBadge(change) {
  if (change === null || change === undefined || isNaN(change)) return document.createElement('span');
  const span = document.createElement('span');
  span.className = 'trend-badge';
  span.style.fontSize = '9px';
  span.style.marginLeft = '6px';
  span.style.fontWeight = '800';
  span.style.padding = '1px 5px';
  span.style.borderRadius = '4px';
  span.style.display = 'inline-flex';
  span.style.alignItems = 'center';
  
  if (change > 0) {
    span.innerText = `▲ ${Math.abs(change)}`;
    span.style.color = '#34d399'; // Bright green
    span.style.background = 'rgba(16, 185, 129, 0.12)';
    span.style.border = '1px solid rgba(16, 185, 129, 0.2)';
  } else if (change < 0) {
    span.innerText = `▼ ${Math.abs(change)}`;
    span.style.color = '#f87171'; // Bright red
    span.style.background = 'rgba(239, 68, 68, 0.12)';
    span.style.border = '1px solid rgba(239, 68, 68, 0.2)';
  } else {
    span.innerText = '—';
    span.style.color = 'var(--text-muted)';
    span.style.fontWeight = '500';
  }
  return span;
}


// --- Yesterday's Standings Recap & Confetti Celebration Engine ---

// Cache active team standing record to detect if game results finished since last load
function checkStandingsMovements(activeTeamId, processedStandings) {
  if (!activeTeamId || !processedStandings || !processedStandings.teamsMap) return;
  const team = processedStandings.teamsMap[activeTeamId];
  if (!team) return;

  const key = `basetab_stats_${activeTeamId}`;
  const storedStr = localStorage.getItem(key);

  const currentStats = {
    wins: team.wins,
    losses: team.losses,
    gamesBack: team.gamesBack,
    wildCardGamesBack: team.wildCardGamesBack,
    divisionRank: team.divisionRank,
    wildCardRank: team.wildCardRank
  };

  if (storedStr) {
    try {
      const storedStats = JSON.parse(storedStr);
      // Check if team played games (wins or losses increased) since last open
      const playedNewGames = currentStats.wins > storedStats.wins || currentStats.losses > storedStats.losses;
      
      if (playedNewGames) {
        // Automatically trigger the recap modal on startup
        setTimeout(() => {
          showRecapModal(true);
        }, 800);
      }
    } catch (e) {
      console.warn("Error parsing stored stats:", e);
    }
  }

  // Update stored cache
  localStorage.setItem(key, JSON.stringify(currentStats));
}

// Canvas Confetti variables
let confettiActive = false;
let confettiCanvas = null;
let confettiCtx = null;
let confettiParticles = [];
let animationMode = 'confetti'; // 'confetti' or 'rain'
const confettiColors = ['#34d399', '#f87171', '#60a5fa', '#fbbf24', '#c084fc', '#f472b6', '#ffffff'];

function initAnimationCanvas() {
  confettiCanvas = document.getElementById('confetti-canvas');
  if (!confettiCanvas) {
    confettiCanvas = document.createElement('canvas');
    confettiCanvas.id = 'confetti-canvas';
    confettiCanvas.style.position = 'fixed';
    confettiCanvas.style.top = '0';
    confettiCanvas.style.left = '0';
    confettiCanvas.style.width = '100vw';
    confettiCanvas.style.height = '100vh';
    confettiCanvas.style.pointerEvents = 'none';
    confettiCanvas.style.zIndex = '99999';
    document.body.appendChild(confettiCanvas);
  }

  confettiActive = true;
  resizeConfettiCanvas();
  window.addEventListener('resize', resizeConfettiCanvas);
}

function startConfetti() {
  if (confettiActive) return;
  animationMode = 'confetti';
  initAnimationCanvas();

  confettiParticles = [];
  const activeTeam = state.processedStandings?.teamsMap?.[state.activeTeamId] || teamsData[state.activeTeamId];
  const palettes = [...confettiColors];
  if (activeTeam) {
    palettes.push(activeTeam.primaryColor, activeTeam.secondaryColor || '#ffffff');
  }

  for (let i = 0; i < 150; i++) {
    confettiParticles.push({
      x: Math.random() * confettiCanvas.width,
      y: Math.random() * -confettiCanvas.height - 20,
      size: Math.random() * 6 + 4,
      rotation: Math.random() * 360,
      rotationSpeed: Math.random() * 4 - 2,
      xSpeed: Math.random() * 4 - 2,
      ySpeed: Math.random() * 3 + 2,
      color: palettes[Math.floor(Math.random() * palettes.length)],
      opacity: Math.random() * 0.4 + 0.6
    });
  }

  confettiCtx = confettiCanvas.getContext('2d');
  requestAnimationFrame(updateOverlayAnimation);
}

function startRainAnimation() {
  if (confettiActive) return;
  animationMode = 'rain';
  initAnimationCanvas();

  confettiParticles = [];
  for (let i = 0; i < 140; i++) {
    confettiParticles.push({
      x: Math.random() * confettiCanvas.width,
      y: Math.random() * -confettiCanvas.height - 30,
      size: Math.random() * 8 + 14, // longer raindrop line
      xSpeed: Math.random() * 0.4 - 0.2, // slight slanted wind angle
      ySpeed: Math.random() * 6 + 10, // fast rain drop speed
      color: 'rgba(186, 230, 253, 0.75)', // brighter visible sky blue gray droplet
      opacity: Math.random() * 0.3 + 0.65 // much higher visibility opacity
    });
  }

  confettiCtx = confettiCanvas.getContext('2d');
  requestAnimationFrame(updateOverlayAnimation);
}

function resizeConfettiCanvas() {
  if (confettiCanvas) {
    confettiCanvas.width = window.innerWidth;
    confettiCanvas.height = window.innerHeight;
  }
}

function updateOverlayAnimation() {
  if (!confettiActive || !confettiCtx || !confettiCanvas) return;

  confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);

  let activeCount = 0;
  confettiParticles.forEach(p => {
    p.y += p.ySpeed;
    p.x += p.xSpeed;

    if (p.y <= confettiCanvas.height) {
      activeCount++;
    }

    confettiCtx.save();
    confettiCtx.globalAlpha = p.opacity;

    if (animationMode === 'confetti') {
      p.rotation += p.rotationSpeed;
      p.xSpeed += Math.sin(p.y / 30) * 0.05;
      confettiCtx.translate(p.x, p.y);
      confettiCtx.rotate((p.rotation * Math.PI) / 180);
      confettiCtx.fillStyle = p.color;
      confettiCtx.fillRect(-p.size / 2, -p.size, p.size, p.size * 2);
    } else {
      // Slanted raindrops
      confettiCtx.strokeStyle = p.color;
      confettiCtx.lineWidth = 1.6;
      confettiCtx.beginPath();
      confettiCtx.moveTo(p.x, p.y);
      confettiCtx.lineTo(p.x + p.xSpeed * 2, p.y + p.size);
      confettiCtx.stroke();
    }
    confettiCtx.restore();
  });

  if (activeCount > 0 && confettiActive) {
    requestAnimationFrame(updateOverlayAnimation);
  } else {
    stopConfetti();
  }
}

function stopConfetti() {
  confettiActive = false;
  window.removeEventListener('resize', resizeConfettiCanvas);
  if (confettiCanvas && confettiCanvas.parentNode) {
    confettiCanvas.parentNode.removeChild(confettiCanvas);
  }
  confettiCanvas = null;
  confettiCtx = null;
}

// Spawns a floating high-five hand emoji rising from the tapped coordinate
function triggerHighFiveAnimation(e, teamName) {
  const rect = e.target.getBoundingClientRect();
  const startX = rect.left + rect.width / 2;
  const startY = rect.top;

  const floating = document.createElement('div');
  floating.innerText = '🖐️';
  floating.style.position = 'fixed';
  floating.style.left = `${startX}px`;
  floating.style.top = `${startY}px`;
  floating.style.fontSize = '32px';
  floating.style.pointerEvents = 'none';
  floating.style.zIndex = '999999';
  floating.style.transition = 'all 1.0s cubic-bezier(0.25, 1, 0.5, 1)';
  floating.style.opacity = '1';
  floating.style.transform = 'translate(-50%, -50%) scale(1)';

  document.body.appendChild(floating);

  // Force reflow
  floating.offsetWidth;

  floating.style.top = `${startY - 120}px`;
  floating.style.transform = 'translate(-50%, -50%) scale(2.2) rotate(15deg)';
  floating.style.opacity = '0';

  startConfetti();

  setTimeout(() => {
    if (floating.parentNode) floating.parentNode.removeChild(floating);
  }, 1000);
}

// Show recap details modal
function showRecapModal(isAutoTrigger = false) {
  const activeTeamId = state.activeTeamId;
  const teamToday = state.processedStandingsYesterday?.teamsMap?.[activeTeamId] || teamsData[activeTeamId];
  const teamYesterday = state.processedStandingsDayBeforeYesterday?.teamsMap?.[activeTeamId];
  
  if (!teamToday || !teamYesterday) return;

  // Hide floating hamburger menu button when recap is open
  const trigger = document.querySelector('.floating-menu-trigger');
  if (trigger) trigger.style.display = 'none';

  // Safely compute formatted label for yesterday's date
  const parts = state.selectedDate.split('-');
  const todayDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 12, 0, 0);
  const yesterdayDate = new Date(todayDate);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayLabel = yesterdayDate.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });

  // Create backdrop
  const backdrop = document.createElement('div');
  backdrop.className = 'recap-backdrop';

  function closeRecap() {
    backdrop.classList.remove('show');
    setTimeout(() => {
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      stopConfetti();
      // Restore floating hamburger menu trigger button
      const t = document.querySelector('.floating-menu-trigger');
      if (t) t.style.display = 'flex';
    }, 300);
  }
  
  // Close recap modal when clicking outside content (on backdrop)
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      closeRecap();
    }
  });
  
  const content = document.createElement('div');
  content.className = 'recap-content';

  // Header
  const header = document.createElement('div');
  header.className = 'recap-header';
  
  const title = document.createElement('h2');
  title.innerText = isAutoTrigger ? '🎉 Standings Update!' : '📅 Yesterday\'s Recap';
  
  const closeBtn = document.createElement('button');
  closeBtn.className = 'recap-close-btn';
  closeBtn.innerHTML = '×';
  closeBtn.addEventListener('click', () => {
    closeRecap();
  });
  
  header.appendChild(title);
  header.appendChild(closeBtn);
  content.appendChild(header);

  // Body
  const body = document.createElement('div');
  body.className = 'recap-body';

  // 1. Team Result Card
  const resultCard = document.createElement('div');
  resultCard.className = 'recap-card';
  
  const resultTitle = document.createElement('div');
  resultTitle.className = 'recap-card-title';
  resultTitle.innerText = `${teamToday.shortName} Game Status`;
  resultCard.appendChild(resultTitle);

  const yesterdayGames = state.rawScheduleYesterday || [];
  const teamGame = yesterdayGames.find(g => g.teams.away.team.id === activeTeamId || g.teams.home.team.id === activeTeamId);

  let teamResultHtml = '';
  let didTeamWin = false;
  if (teamGame) {
    const isAway = teamGame.teams.away.team.id === activeTeamId;
    const opponent = isAway ? teamGame.teams.home.team.name : teamGame.teams.away.team.name;
    const teamScore = isAway ? teamGame.teams.away.score : teamGame.teams.home.score;
    const oppScore = isAway ? teamGame.teams.home.score : teamGame.teams.away.score;
    didTeamWin = teamScore > oppScore;
    
    const outcomeText = didTeamWin ? 'Won! 🎉' : 'Lost 😢';
    const color = didTeamWin ? 'var(--color-win)' : 'var(--color-loss)';
    
    teamResultHtml = `
      <div style="font-size: 15px; font-weight: 700; color: ${color}; margin-bottom: 4px;">
        ${outcomeText} ${teamScore}-${oppScore} vs ${opponent}
      </div>
      <div style="font-size: 12px; color: var(--text-secondary);">
        Yesterday's game was played on ${yesterdayLabel}.
      </div>
    `;

  } else {
    teamResultHtml = `
      <div style="font-size: 14px; font-weight: 600; color: var(--text-secondary);">
        Rest Day 💤
      </div>
      <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">
        The ${teamToday.shortName} did not play yesterday.
      </div>
    `;
  }
  
  const resultBody = document.createElement('div');
  resultBody.innerHTML = teamResultHtml;
  resultCard.appendChild(resultBody);
  body.appendChild(resultCard);

  // 2. Standings Movements Card
  const standingsCard = document.createElement('div');
  standingsCard.className = 'recap-card';

  const standingsTitle = document.createElement('div');
  standingsTitle.className = 'recap-card-title';
  standingsTitle.innerText = 'Standings Movement';
  standingsCard.appendChild(standingsTitle);

  const standingsBody = document.createElement('div');
  standingsBody.style.display = 'flex';
  standingsBody.style.flexDirection = 'column';
  standingsBody.style.gap = '10px';

  let hasGainedGround = false;

  // Division Race
  const divTrend = getRecapDivisionTrend(activeTeamId);
  const divRow = document.createElement('div');
  divRow.style.display = 'flex';
  divRow.style.justifyContent = 'space-between';
  divRow.style.alignItems = 'center';
  divRow.style.fontSize = '13px';
  
  const divLabel = document.createElement('span');
  divLabel.innerHTML = `<strong>Division Race:</strong> ${teamToday.divisionLeader ? 'Leading' : `${teamToday.gamesBack.toFixed(1)} GB`}`;
  
  const divBadge = document.createElement('span');
  if (divTrend > 0) {
    divBadge.className = 'recap-trend-badge gained';
    divBadge.innerText = `▲ +${divTrend.toFixed(1)} G`;
    hasGainedGround = true;
  } else if (divTrend < 0) {
    divBadge.className = 'recap-trend-badge lost';
    divBadge.innerText = `▼ -${Math.abs(divTrend).toFixed(1)} G`;
  } else {
    divBadge.className = 'recap-trend-badge no-change';
    divBadge.innerText = '— No Change';
  }
  divRow.appendChild(divLabel);
  divRow.appendChild(divBadge);
  standingsBody.appendChild(divRow);

  // Wild Card Race
  const wcTrend = getRecapWildCardTrend(activeTeamId);
  const wcRow = document.createElement('div');
  wcRow.style.display = 'flex';
  wcRow.style.justifyContent = 'space-between';
  wcRow.style.alignItems = 'center';
  wcRow.style.fontSize = '13px';
  
  let wcText = '';
  if (teamToday.isWildCardSpot) {
    wcText = `+${Math.abs(teamToday.wildCardGamesBack).toFixed(1)} WC`;
  } else {
    wcText = `${teamToday.wildCardGamesBack.toFixed(1)} GB`;
  }
  const wcLabel = document.createElement('span');
  wcLabel.innerHTML = `<strong>Wild Card Race:</strong> ${wcText}`;

  const wcBadge = document.createElement('span');
  if (wcTrend > 0) {
    wcBadge.className = 'recap-trend-badge gained';
    wcBadge.innerText = `▲ +${wcTrend.toFixed(1)} G`;
    hasGainedGround = true;
  } else if (wcTrend < 0) {
    wcBadge.className = 'recap-trend-badge lost';
    wcBadge.innerText = `▼ -${Math.abs(wcTrend).toFixed(1)} G`;
  } else {
    wcBadge.className = 'recap-trend-badge no-change';
    wcBadge.innerText = '— No Change';
  }
  wcRow.appendChild(wcLabel);
  wcRow.appendChild(wcBadge);
  standingsBody.appendChild(wcRow);

  standingsCard.appendChild(standingsBody);
  body.appendChild(standingsCard);



  // Visual Race Chart Card (Division or Wild Card depending on division leadership)
  let chartNode = null;
  let chartLegendHtml = '';
  let chartTitleText = '';

  const isDivLeader = teamToday.divisionLeader;
  if (isDivLeader) {
    chartTitleText = 'Division Race Trend';
    const divId = teamToday.divisionId;
    const divTeams = state.processedStandingsYesterday?.divisionTeams?.[divId] || [];
    if (divTeams.length > 0) {
      // Revert Check: to go back to dual-team, swap this line with: chartNode = createDivisionRaceChart(teamToday, divTeams[1]);
      chartNode = createMultiTeamRaceChart(teamToday, divTeams);
      
      const colorA = teamToday.primaryColor || '#134a8e';
      chartLegendHtml = `
        <div style="display:flex; justify-content:center; gap:20px; font-size:11px; margin-bottom:8px; margin-top:4px;">
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="display:inline-block; width:12px; height:3px; background:${colorA}; border-radius:1px;"></span>
            <span style="color:var(--text-primary); font-weight:700;">${teamToday.shortName}</span>
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="display:inline-block; width:12px; height:1.5px; background:#888; opacity:0.6; border-radius:0.5px;"></span>
            <span style="color:var(--text-secondary); font-weight:600; font-size:10px;">Division Rivals</span>
          </div>
        </div>
      `;
    }
  } else {
    chartTitleText = 'Wild Card Race Trend';
    const leagueId = teamToday.leagueId;
    const allLeague = state.processedStandingsYesterday?.leagueTeams?.[leagueId] || [];
    const wcPool = allLeague.filter(t => !t.divisionLeader).sort((a, b) => a.wildCardRank - b.wildCardRank);
    const activeIdx = wcPool.findIndex(t => t.id === activeTeamId);
    
    if (wcPool.length > 0 && activeIdx >= 0) {
      // Select active team + playoff spot holders + chasers
      const selectedWCTeams = [];
      for (let i = 0; i < Math.min(3, wcPool.length); i++) {
        selectedWCTeams.push(wcPool[i]);
      }
      selectedWCTeams.push(wcPool[activeIdx]);
      if (activeIdx + 1 < wcPool.length) {
        selectedWCTeams.push(wcPool[activeIdx + 1]);
      }
      wcPool.forEach(t => {
        if (t.wildCardGamesBack === wcPool[activeIdx].wildCardGamesBack) {
          selectedWCTeams.push(t);
        }
      });
      
      // Revert Check: to go back to dual-team, swap this line with: chartNode = createDivisionRaceChart(teamToday, wcPool[activeIdx <= 2 ? 3 : 2]);
      chartNode = createMultiTeamRaceChart(teamToday, selectedWCTeams);
      
      const colorA = teamToday.primaryColor || '#134a8e';
      chartLegendHtml = `
        <div style="display:flex; justify-content:center; gap:20px; font-size:11px; margin-bottom:8px; margin-top:4px;">
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="display:inline-block; width:12px; height:3px; background:${colorA}; border-radius:1px;"></span>
            <span style="color:var(--text-primary); font-weight:700;">${teamToday.shortName}</span>
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="display:inline-block; width:12px; height:1.5px; background:#888; opacity:0.6; border-radius:0.5px;"></span>
            <span style="color:var(--text-secondary); font-weight:600; font-size:10px;">Wild Card Competitors</span>
          </div>
        </div>
      `;
    }
  }

  if (chartNode) {
    const chartCard = document.createElement('div');
    chartCard.className = 'recap-card';
    
    const chartTitle = document.createElement('div');
    chartTitle.className = 'recap-card-title';
    chartTitle.innerText = chartTitleText;
    chartCard.appendChild(chartTitle);
    
    const legendDiv = document.createElement('div');
    legendDiv.innerHTML = chartLegendHtml;
    chartCard.appendChild(legendDiv);
    
    chartCard.appendChild(chartNode);
    body.appendChild(chartCard);
  }

  // 3. Rooting Advice Results Card
  const rootingCard = document.createElement('div');
  rootingCard.className = 'recap-card';

  const rootingTitle = document.createElement('div');
  rootingTitle.className = 'recap-card-title';
  rootingTitle.innerText = 'Games that Mattered Yesterday';
  rootingCard.appendChild(rootingTitle);

  const rootingBody = document.createElement('div');
  rootingBody.style.display = 'flex';
  rootingBody.style.flexDirection = 'column';
  rootingBody.style.gap = '12px';

  // Analyze yesterday's games
  const rootingGamesAnalysis = analyzeMatchups(yesterdayGames, state.processedStandingsYesterday, activeTeamId);
  // Exclude our own game and priority 0 games
  const targetRivalGames = sortGames(rootingGamesAnalysis.filter(g => g.priority > 0 && g.awayTeam.id !== activeTeamId && g.homeTeam.id !== activeTeamId));

  if (targetRivalGames.length > 0) {
    targetRivalGames.forEach(g => {
      const isAwayWinner = g.awayScore > g.homeScore;
      const winnerSide = isAwayWinner ? 'Away' : 'Home';
      const winnerTeam = isAwayWinner ? g.awayTeam : g.homeTeam;
      const loserTeam = isAwayWinner ? g.homeTeam : g.awayTeam;
      
      const didRootSucceed = g.rootFor === winnerSide;
      const rootTeamName = g.rootFor === 'Away' ? g.awayTeam.shortName : g.homeTeam.shortName;
      
      const gameRow = document.createElement('div');
      gameRow.style.fontSize = '12px';
      gameRow.style.borderBottom = '1px solid rgba(0, 0, 0, 0.04)';
      gameRow.style.paddingBottom = '8px';
      
      const outcomeBadgeHtml = didRootSucceed 
        ? '<span style="color:var(--color-win); font-weight:700;">Nice 😊</span>' 
        : '<span style="color:var(--color-loss); font-weight:700;">Tough 😢</span>';
      
      gameRow.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <strong>${g.awayTeam.abbreviation} ${g.awayScore} @ ${g.homeTeam.abbreviation} ${g.homeScore}</strong>
          ${outcomeBadgeHtml}
        </div>
        <div style="color: var(--text-secondary); font-size:11px; margin-bottom:4px; display:flex; justify-content:space-between; align-items:center;">
          <span>Rooted for: <strong>${rootTeamName}</strong>. ${winnerTeam.shortName} beat ${loserTeam.shortName}.</span>
          <span class="analytics-trigger-link" style="color: var(--color-gold); font-weight: 700; cursor: pointer; text-decoration: underline; font-size: 10px; margin-left: 8px; flex-shrink: 0;">📊 View Analytics</span>
        </div>
      `;

      const linkEl = gameRow.querySelector('.analytics-trigger-link');
      if (linkEl) {
        const handleOpenRecapVisuals = (e) => {
          if (e) e.stopPropagation();
          try {
            openGameAnalyticsCenter(g, state, render);
          } catch (err) {
            console.error("Failed to open visuals from recap link:", err);
          }
        };
        linkEl.addEventListener('click', handleOpenRecapVisuals);
      }

      rootingBody.appendChild(gameRow);
    });
  } else {
    const emptyRow = document.createElement('div');
    emptyRow.style.fontSize = '12px';
    emptyRow.style.color = 'var(--text-muted)';
    emptyRow.innerText = 'No key rival matchups were played yesterday.';
    rootingBody.appendChild(emptyRow);
  }

  rootingCard.appendChild(rootingBody);
  body.appendChild(rootingCard);

  content.appendChild(body);
  backdrop.appendChild(content);
  document.body.appendChild(backdrop);

  // Trigger appropriate animation based on yesterday's outcomes
  if (didTeamWin || hasGainedGround) {
    startConfetti();
  } else if (teamGame && (!didTeamWin || divTrend < 0 || wcTrend < 0)) {
    startRainAnimation();
  }

  // Animate slide up
  backdrop.offsetWidth; // force reflow
  backdrop.classList.add('show');
}


// Fetch schedule and standings
async function loadData() {
  state.loading = true;
  render();

  try {
    // Compute yesterday and day-before-yesterday dates safely to avoid iOS Safari date parsing issues
    const parts = state.selectedDate.split('-');
    const todayDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 12, 0, 0);
    
    const yesterdayDate = new Date(todayDate);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayStr = formatLocalDate(yesterdayDate);

    const dayBeforeYesterdayDate = new Date(todayDate);
    dayBeforeYesterdayDate.setDate(dayBeforeYesterdayDate.getDate() - 2);
    const dayBeforeYesterdayStr = formatLocalDate(dayBeforeYesterdayDate);

    const [standings, schedule, standingsYesterday, scheduleYesterday, standingsDayBeforeYesterday] = await Promise.all([
      fetchStandings(state.selectedDate),
      fetchSchedule(state.selectedDate),
      fetchStandings(yesterdayStr),
      fetchSchedule(yesterdayStr),
      fetchStandings(dayBeforeYesterdayStr)
    ]);
    
    state.rawStandings = standings;
    state.rawSchedule = schedule;
    state.rawStandingsYesterday = standingsYesterday;
    state.rawScheduleYesterday = scheduleYesterday;
    state.rawStandingsDayBeforeYesterday = standingsDayBeforeYesterday;
    
    state.processedStandings = processStandings(standings);
    state.processedStandingsYesterday = processStandings(standingsYesterday);
    state.processedStandingsDayBeforeYesterday = processStandings(standingsDayBeforeYesterday);
    
    // Check for standing movements since last open
    if (state.processedStandings && state.processedStandingsYesterday) {
      checkStandingsMovements(state.activeTeamId, state.processedStandings);
    }
    
    // Automatically set default active tab (Division vs Wild Card)
    syncDefaultTab();
  } catch (err) {
    console.error("Error loading MLB data:", err);
  } finally {
    state.loading = false;
    render();
  }
}

// Silent refresh of schedule and standings without showing full-screen loader
async function silentRefreshData() {
  try {
    const parts = state.selectedDate.split('-');
    const todayDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 12, 0, 0);
    
    const yesterdayDate = new Date(todayDate);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayStr = formatLocalDate(yesterdayDate);

    const dayBeforeYesterdayDate = new Date(todayDate);
    dayBeforeYesterdayDate.setDate(dayBeforeYesterdayDate.getDate() - 2);
    const dayBeforeYesterdayStr = formatLocalDate(dayBeforeYesterdayDate);

    const [standings, schedule, standingsYesterday, scheduleYesterday, standingsDayBeforeYesterday] = await Promise.all([
      fetchStandings(state.selectedDate),
      fetchSchedule(state.selectedDate),
      fetchStandings(yesterdayStr),
      fetchSchedule(yesterdayStr),
      fetchStandings(dayBeforeYesterdayStr)
    ]);
    
    state.rawStandings = standings;
    state.rawSchedule = schedule;
    state.rawStandingsYesterday = standingsYesterday;
    state.rawScheduleYesterday = scheduleYesterday;
    state.rawStandingsDayBeforeYesterday = standingsDayBeforeYesterday;
    
    state.processedStandings = processStandings(standings);
    state.processedStandingsYesterday = processStandings(standingsYesterday);
    state.processedStandingsDayBeforeYesterday = processStandings(standingsDayBeforeYesterday);
    
    render();
  } catch (err) {
    console.warn("Silent auto-refresh failed:", err);
  }
}

// Global auto-refresh interval reference
let autoRefreshInterval = null;

function startAutoRefresh() {
  if (autoRefreshInterval) clearInterval(autoRefreshInterval);
  
  autoRefreshInterval = setInterval(async () => {
    if (document.hidden) return;
    
    if (state.activeView === 'dashboard' && !state.loading) {
      const hasLiveGames = state.rawSchedule && state.rawSchedule.some(g => g.status.statusCode === 'I');
      if (hasLiveGames) {
        console.log('Live games active, performing silent auto-refresh...');
        await silentRefreshData();
      }
    }
  }, 60000); // 60 seconds
}

function transitionToView(targetView, targetTeamId = null) {
  // Build a list of valid switcher view targets
  const viewsList = [];
  state.selectedTeamIds.forEach(id => {
    viewsList.push({ view: 'dashboard', teamId: id });
  });
  viewsList.push({ view: 'standings' });
  viewsList.push({ view: 'scores' });
  viewsList.push({ view: 'settings' });

  // Resolve current active view index
  let currentIndex = -1;
  if (state.activeView === 'standings') {
    currentIndex = viewsList.length - 3;
  } else if (state.activeView === 'scores') {
    currentIndex = viewsList.length - 2;
  } else if (state.activeView === 'settings') {
    currentIndex = viewsList.length - 1;
  } else if (state.activeView === 'dashboard') {
    currentIndex = viewsList.findIndex(item => item.view === 'dashboard' && item.teamId === state.activeTeamId);
  }

  // Resolve target index
  let targetIndex = -1;
  if (targetView === 'standings') {
    targetIndex = viewsList.length - 3;
  } else if (targetView === 'scores') {
    targetIndex = viewsList.length - 2;
  } else if (targetView === 'settings') {
    targetIndex = viewsList.length - 1;
  } else if (targetView === 'dashboard') {
    targetIndex = viewsList.findIndex(item => item.view === 'dashboard' && item.teamId === targetTeamId);
  }

  if (currentIndex !== -1 && targetIndex !== -1 && currentIndex !== targetIndex) {
    if (targetIndex > currentIndex) {
      state.transitionDirection = 'forward';
    } else {
      state.transitionDirection = 'backward';
    }
  }

  state.activeView = targetView;
  const todayStr = getBaseballDate(0);
  if ((targetView === 'dashboard' || targetView === 'standings') && state.selectedDate !== todayStr) {
    state.selectedDate = todayStr;
    state.loading = true;
    loadData().then(() => {
      state.loading = false;
      render();
    });
  }
  if (targetView === 'dashboard' && targetTeamId) {
    state.activeTeamId = targetTeamId;
    updateTeamTheme(targetTeamId);
    syncDefaultTab();
  }
  render();
}

// Primary Render Engine
function render() {
  const appContainer = document.querySelector('#app');
  if (!appContainer) return;

  // Ensure persistent shell containers exist
  let header = appContainer.querySelector('.app-header');
  let main = appContainer.querySelector('.app-main');
  let footer = appContainer.querySelector('.app-footer');

  if (!header || !main || !footer) {
    appContainer.innerHTML = ''; // bootstrap once
    
    header = document.createElement('header');
    header.className = 'app-header';
    header.style.display = 'contents';
    
    main = document.createElement('main');
    main.className = 'app-main';
    main.style.flex = '1';
    
    footer = document.createElement('footer');
    footer.className = 'app-footer';
    
    appContainer.appendChild(header);
    appContainer.appendChild(main);
    appContainer.appendChild(footer);
  }

  // 1. Update Header content (Date toggle control)
  updateHeaderContent(header);

  // 2. Update Footer content (Persistent Bottom Navigation)
  updateFooterContent(footer);

  if (state.showTeamsDropupAfterRender) {
    state.showTeamsDropupAfterRender = false;
    const teamsBtn = footer.querySelector('.footer-nav-item');
    if (teamsBtn) {
      setTimeout(() => showTeamsDropupMenu(teamsBtn), 50);
    }
  }

  // 3. Update Main view content
  main.innerHTML = '';
  
  if (state.transitionDirection) {
    main.className = `app-main slide-in-${state.transitionDirection}`;
    state.transitionDirection = null;
  } else {
    main.className = 'app-main';
  }

  if (state.loading) {
    main.appendChild(createLoader());
  } else {
    switch (state.activeView) {
      case 'dashboard':
        main.appendChild(createDashboardView());
        break;
      case 'standings':
        main.appendChild(createStandingsView());
        break;
      case 'scores':
        main.appendChild(createScoresView());
        break;
      case 'hr-race':
        main.appendChild(createHRRaceView());
        break;
      case 'settings':
        main.appendChild(createSettingsView());
        break;
      case 'team-select':
        main.appendChild(createTeamSelectView());
        break;
      case 'credits-version':
        main.appendChild(createCreditsVersionView());
        break;
      default:
        main.appendChild(createDashboardView());
    }
  }
}

// Active auto-close timer variable so we can clear/reset it if needed
let teamsDropupTimer = null;

function showTeamsDropupMenu(anchorBtn) {
  // If dropup already exists, remove it first
  closeTeamsDropup();
  
  const dropup = document.createElement('div');
  dropup.id = 'teams-dropup';
  dropup.className = 'teams-dropup';
  
  // Position dropup above the anchor button
  const rect = anchorBtn.getBoundingClientRect();
  dropup.style.left = `${Math.max(16, rect.left + (rect.width / 2) - 110)}px`;
  
  state.selectedTeamIds.forEach(teamId => {
    const team = teamsData[teamId];
    if (!team) return;
    
    const itemBtn = document.createElement('button');
    itemBtn.className = `teams-dropup-item ${teamId === state.activeTeamId ? 'active' : ''}`;
    
    const badge = document.createElement('div');
    badge.className = 'team-badge-small';
    badge.innerText = team.abbreviation;
    badge.style.background = team.primaryColor;
    badge.style.color = team.textColor;
    badge.style.fontSize = '9px';
    badge.style.fontWeight = '800';
    badge.style.width = '24px';
    badge.style.height = '24px';
    badge.style.display = 'flex';
    badge.style.alignItems = 'center';
    badge.style.justifyContent = 'center';
    badge.style.borderRadius = '6px';
    badge.style.flexShrink = '0';
    
    const details = document.createElement('div');
    details.style.display = 'flex';
    details.style.flexDirection = 'column';
    details.style.gap = '2px';
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'team-name';
    nameSpan.innerText = team.name;
    
    const leagueSpan = document.createElement('span');
    leagueSpan.className = 'team-abbr';
    leagueSpan.innerText = team.divisionName;
    
    details.appendChild(nameSpan);
    details.appendChild(leagueSpan);
    
    itemBtn.appendChild(badge);
    itemBtn.appendChild(details);
    
    itemBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.activeTeamId !== teamId) {
        state.activeTeamId = teamId;
        updateTeamTheme(teamId);
        render();
      }
      closeTeamsDropup();
    });
    
    dropup.appendChild(itemBtn);
  });
  
  document.body.appendChild(dropup);
  
  // Fade and slide in
  setTimeout(() => {
    dropup.classList.add('show');
  }, 10);
  
  // Start 1.5 seconds auto-close timer
  teamsDropupTimer = setTimeout(() => {
    closeTeamsDropup();
  }, 1500);

  // Prevent immediate close on window clicks during open event loop
  setTimeout(() => {
    window.addEventListener('click', outsideClickClose);
  }, 50);
}

function outsideClickClose(e) {
  const dropup = document.getElementById('teams-dropup');
  if (dropup && !dropup.contains(e.target)) {
    closeTeamsDropup();
  }
}

function closeTeamsDropup() {
  const dropup = document.getElementById('teams-dropup');
  if (dropup) {
    dropup.classList.remove('show');
    setTimeout(() => {
      dropup.remove();
    }, 250);
  }
  window.removeEventListener('click', outsideClickClose);
  if (teamsDropupTimer) {
    clearTimeout(teamsDropupTimer);
    teamsDropupTimer = null;
  }
}

// Persistent Bottom Navigation Footer Builder
function updateFooterContent(footer) {
  footer.innerHTML = '';
  
  const teamsLabel = state.selectedTeamIds.length > 1 ? 'Teams' : 'Team';
  
  // Footer menu items configuration
  const menuItems = [
    { view: 'dashboard', label: teamsLabel, emoji: '🧢' },
    { view: 'scores', label: 'Scores', emoji: '⚾' },
    { view: 'standings', label: 'Standings', emoji: '🏆' },
    { view: 'hr-race', label: 'HR Race', emoji: '💥' },
    { view: 'settings', label: 'Settings', emoji: '⚙️' }
  ];
  
  menuItems.forEach(item => {
    const btn = document.createElement('button');
    btn.className = `footer-nav-item ${state.activeView === item.view ? 'active' : ''}`;
    
    // Icon/Visual container
    const iconContainer = document.createElement('div');
    iconContainer.className = 'footer-nav-icon';
    
    // For 'Teams' tab, let's draw a premium team badge containing the current active team initials!
    if (item.view === 'dashboard') {
      const activeTeam = teamsData[state.activeTeamId];
      if (activeTeam) {
        iconContainer.innerText = activeTeam.abbreviation;
        iconContainer.className = 'footer-nav-icon team-badge';
        iconContainer.style.background = activeTeam.primaryColor;
        iconContainer.style.color = activeTeam.textColor;
        iconContainer.style.fontSize = '9px';
        iconContainer.style.fontWeight = '800';
        iconContainer.style.display = 'flex';
        iconContainer.style.alignItems = 'center';
        iconContainer.style.justifyContent = 'center';
        iconContainer.style.borderRadius = '6px';
        iconContainer.style.width = '24px';
        iconContainer.style.height = '24px';
        iconContainer.style.border = `1.5px solid ${state.activeView === 'dashboard' ? 'var(--color-gold)' : 'rgba(255,255,255,0.2)'}`;
      } else {
        iconContainer.innerText = item.emoji;
      }
    } else {
      iconContainer.innerText = item.emoji;
      iconContainer.style.fontSize = '18px';
      iconContainer.style.lineHeight = '1';
    }
    
    const label = document.createElement('span');
    label.className = 'footer-nav-label';
    label.innerText = item.label;
    
    btn.appendChild(iconContainer);
    btn.appendChild(label);
    
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (item.view === 'dashboard') {
        if (state.selectedTeamIds.length > 1) {
          if (state.activeView !== 'dashboard') {
            state.showTeamsDropupAfterRender = true;
            transitionToView('dashboard', state.activeTeamId);
          } else {
            showTeamsDropupMenu(btn);
          }
        } else {
          if (state.activeView !== 'dashboard') {
            transitionToView('dashboard', state.activeTeamId);
          }
        }
      } else {
        if (state.activeView !== item.view) {
          transitionToView(item.view);
        }
      }
    });
    
    footer.appendChild(btn);
  });
}

// Settings View (More page in fixed footer navigation)
function createSettingsView() {
  const container = document.createElement('div');
  container.className = 'setup-container';
  container.style.cssText = 'display: flex; flex-direction: column; flex-grow: 1; gap: 20px;';

  const title = document.createElement('h2');
  title.className = 'setup-title';
  title.innerText = 'Settings & Configuration';
  title.style.cssText = 'font-size: 20px; font-weight: 800; color: var(--color-gold); margin-bottom: 4px; text-align: left;';
  container.appendChild(title);

  const desc = document.createElement('p');
  desc.style.cssText = 'font-size: 13px; color: var(--text-secondary); line-height: 1.5; margin: 0;';
  desc.innerText = 'Manage your tracked teams, check app details, or reload the latest MLB standings and schedules data.';
  container.appendChild(desc);

  // Divider
  const hr = document.createElement('div');
  hr.style.borderBottom = '1px solid var(--border-glass)';
  hr.style.margin = '4px 0';
  container.appendChild(hr);

  // Tracked Teams Switcher
  const teamsHeader = document.createElement('h3');
  teamsHeader.style.cssText = 'font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px;';
  teamsHeader.innerText = 'Quick Switch Tracked Team';
  container.appendChild(teamsHeader);

  const teamsGroup = document.createElement('div');
  teamsGroup.style.cssText = 'display: flex; flex-direction: column; gap: 8px; max-height: 240px; overflow-y: auto; padding-right: 4px;';
  
  state.selectedTeamIds.forEach(id => {
    const team = teamsData[id];
    if (!team) return;
    const isCurrent = state.activeTeamId === id;
    const teamBtn = document.createElement('button');
    teamBtn.style.cssText = `width: 100%; padding: 12px 14px; font-size: 13.5px; font-weight: 700; border-radius: 10px; cursor: pointer; font-family: var(--font-title); display: flex; align-items: center; gap: 10px; transition: all 0.2s ease; border: 1.5px solid ${isCurrent ? 'var(--color-gold)' : 'var(--border-glass)'}; background: ${isCurrent ? 'rgba(245, 158, 11, 0.08)' : 'var(--bg-card)'}; color: ${isCurrent ? 'var(--color-gold)' : 'var(--text-primary)'}; outline: none;`;
    
    const badge = document.createElement('div');
    badge.className = 'team-badge-small';
    badge.innerText = team.abbreviation;
    badge.style.background = team.primaryColor;
    badge.style.color = team.textColor;
    badge.style.fontSize = '10px';
    badge.style.width = '24px';
    badge.style.height = '24px';
    badge.style.display = 'flex';
    badge.style.alignItems = 'center';
    badge.style.justifyContent = 'center';
    badge.style.borderRadius = '5px';
    
    const label = document.createElement('span');
    label.innerText = team.name;
    
    teamBtn.appendChild(badge);
    teamBtn.appendChild(label);
    
    if (isCurrent) {
      const activeIndicator = document.createElement('span');
      activeIndicator.style.marginLeft = 'auto';
      activeIndicator.style.fontSize = '11px';
      activeIndicator.style.color = 'var(--color-gold)';
      activeIndicator.innerText = '✓ Active';
      teamBtn.appendChild(activeIndicator);
    } else {
      const switchIndicator = document.createElement('span');
      switchIndicator.style.marginLeft = 'auto';
      switchIndicator.style.fontSize = '11px';
      switchIndicator.style.color = 'var(--text-muted)';
      switchIndicator.innerText = 'Switch';
      teamBtn.appendChild(switchIndicator);
    }
    
    teamBtn.addEventListener('click', () => {
      transitionToView('dashboard', id);
    });
    
    teamsGroup.appendChild(teamBtn);
  });
  container.appendChild(teamsGroup);

  // Push main actions to the bottom of the container
  const spacer = document.createElement('div');
  spacer.style.flex = '1';
  container.appendChild(spacer);

  // Bottom action buttons stacked vertically for easy thumb reach
  const actionsGroup = document.createElement('div');
  actionsGroup.style.cssText = 'display: flex; flex-direction: column; gap: 10px; margin-top: auto; margin-bottom: 12px;';

  const configureBtn = document.createElement('button');
  configureBtn.style.cssText = 'width: 100%; padding: 14px 16px; font-size: 14px; font-weight: 700; color: var(--text-primary); background: var(--bg-card-hover); border: 1px solid var(--border-glass-highlight); border-radius: 12px; cursor: pointer; font-family: var(--font-title); display: flex; align-items: center; justify-content: center; gap: 8px; transition: all 0.2s ease; box-shadow: var(--shadow-sm); outline: none;';
  configureBtn.innerHTML = '👥 Configure Tracked Teams';
  configureBtn.addEventListener('click', () => {
    state.previousMainView = 'settings';
    state.activeView = 'team-select';
    state.searchQuery = '';
    render();
  });
  
  const creditsBtn = document.createElement('button');
  creditsBtn.style.cssText = 'width: 100%; padding: 14px 16px; font-size: 14px; font-weight: 700; color: var(--text-primary); background: var(--bg-card-hover); border: 1px solid var(--border-glass-highlight); border-radius: 12px; cursor: pointer; font-family: var(--font-title); display: flex; align-items: center; justify-content: center; gap: 8px; transition: all 0.2s ease; box-shadow: var(--shadow-sm); outline: none;';
  creditsBtn.innerHTML = 'ℹ️ Credits & Info';
  creditsBtn.addEventListener('click', () => {
    state.previousMainView = 'settings';
    state.activeView = 'credits-version';
    render();
  });

  const reloadBtn = document.createElement('button');
  reloadBtn.style.cssText = 'width: 100%; padding: 14px 16px; font-size: 14px; font-weight: 700; color: var(--text-primary); background: var(--bg-card-hover); border: 1px solid var(--border-glass-highlight); border-radius: 12px; cursor: pointer; font-family: var(--font-title); display: flex; align-items: center; justify-content: center; gap: 8px; transition: all 0.2s ease; box-shadow: var(--shadow-sm); outline: none;';
  reloadBtn.innerHTML = '🔄 Force Reset Standing Data';
  reloadBtn.addEventListener('click', () => {
    if (confirm('This will unregister service workers and refresh your browser data cache. Proceed?')) {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(registrations => {
          for (let registration of registrations) {
            registration.unregister();
          }
        });
      }
      const tracked = localStorage.getItem('tracked_teams');
      localStorage.clear();
      if (tracked) {
        localStorage.setItem('tracked_teams', tracked);
      }
      window.location.reload();
    }
  });

  actionsGroup.appendChild(configureBtn);
  actionsGroup.appendChild(creditsBtn);
  actionsGroup.appendChild(reloadBtn);
  container.appendChild(actionsGroup);

  return container;
}

// Update persistent Header content
function updateHeaderContent(header) {
  header.innerHTML = '';

  const topRow = document.createElement('div');
  topRow.className = 'header-top';
  topRow.style.minHeight = '0px';

  if (state.activeView === 'settings') {
    topRow.style.minHeight = '44px';
    const logo = document.createElement('div');
    logo.className = 'app-logo';
    logo.innerText = 'Trajectory';
    topRow.appendChild(logo);
  } else if (state.activeView === 'scores') {
    topRow.style.minHeight = '44px';
    const dateNav = document.createElement('div');
    dateNav.style.cssText = 'display: flex; align-items: center; gap: 8px; background: rgba(255, 255, 255, 0.08); border: 1px solid var(--border-glass-highlight); padding: 4px 8px; border-radius: 8px; margin: 0 auto;';
    
    const prevDayBtn = document.createElement('button');
    prevDayBtn.style.cssText = 'background: none; border: none; color: var(--text-primary); cursor: pointer; font-size: 14px; padding: 2px 6px; font-weight: 700; outline: none; transition: opacity 0.2s;';
    prevDayBtn.innerText = '◀';
    prevDayBtn.addEventListener('click', async () => {
      const current = new Date(state.selectedDate + 'T12:00:00');
      current.setDate(current.getDate() - 1);
      state.selectedDate = formatLocalDate(current);
      state.loading = true;
      render();
      await loadData();
      state.loading = false;
      render();
    });
    
    const datePicker = document.createElement('input');
    datePicker.type = 'date';
    datePicker.value = state.selectedDate;
    datePicker.style.cssText = 'background: none; border: none; color: var(--text-primary); font-family: var(--font-title); font-size: 12px; font-weight: 700; outline: none; cursor: pointer; text-align: center;';
    datePicker.addEventListener('change', async (e) => {
      if (e.target.value) {
        state.selectedDate = e.target.value;
        state.loading = true;
        render();
        await loadData();
        state.loading = false;
        render();
      }
    });
    
    const nextDayBtn = document.createElement('button');
    nextDayBtn.style.cssText = 'background: none; border: none; color: var(--text-primary); cursor: pointer; font-size: 14px; padding: 2px 6px; font-weight: 700; outline: none; transition: opacity 0.2s;';
    nextDayBtn.innerText = '▶';
    nextDayBtn.addEventListener('click', async () => {
      const current = new Date(state.selectedDate + 'T12:00:00');
      current.setDate(current.getDate() + 1);
      state.selectedDate = formatLocalDate(current);
      state.loading = true;
      render();
      await loadData();
      state.loading = false;
      render();
    });
    
    dateNav.appendChild(prevDayBtn);
    dateNav.appendChild(datePicker);
    dateNav.appendChild(nextDayBtn);
    topRow.appendChild(dateNav);
  } else {
    topRow.style.marginBottom = '0px';
  }

  header.appendChild(topRow);
}

// Loader Component
function createLoader() {
  const container = document.createElement('div');
  container.className = 'loader-container';

  const spinner = document.createElement('span');
  spinner.className = 'baseball-spinner';
  spinner.innerText = '⚾';

  const text = document.createElement('p');
  text.innerText = 'Analyzing standings & matchups...';
  text.style.color = 'var(--text-secondary)';
  text.style.fontSize = '14px';
  text.style.fontWeight = '500';

  container.appendChild(spinner);
  container.appendChild(text);
  return container;
}

// Calculate current win/loss streak for a team
function getTeamStreak(teamId, wins, losses) {
  const games = generateSeasonGames(teamId, wins, losses);
  if (!games || games.length === 0) return { type: 'neutral', count: 0 };
  
  const lastGame = games[games.length - 1];
  const isWinStreak = lastGame.isWin;
  let count = 0;
  
  for (let i = games.length - 1; i >= 0; i--) {
    if (games[i].isWin === isWinStreak) {
      count++;
    } else {
      break;
    }
  }
  
  return {
    type: isWinStreak ? 'win' : 'loss',
    count: count
  };
}

// Create a DOM element for the team streak badge (heating up, hot, on fire, cooling down, cold, ice cold)
function createStreakBadge(streak) {
  const badge = document.createElement('span');
  badge.className = 'team-streak-badge';
  
  const count = streak.count;
  const isWin = streak.type === 'win';
  
  let emoji = '';
  let label = '';
  let styleStr = '';
  
  if (isWin) {
    badge.classList.add('hot-streak');
    if (count >= 10) {
      emoji = '🔥';
      label = `On Fire (${count} Wins)`;
      badge.classList.add('on-fire');
      const glowRadius = Math.min(8 + (count - 10) * 1.5, 20);
      styleStr = `background: linear-gradient(135deg, #ef4444, #a855f7); color: #ffffff; border: 1px solid #f43f5e; box-shadow: 0 0 ${glowRadius}px rgba(244, 63, 94, 0.7); font-weight: 800;`;
    } else if (count >= 6) {
      emoji = '🔥';
      label = `Hot (${count} Wins)`;
      const opacity = 0.4 + (count - 6) * 0.1;
      styleStr = `background: rgba(239, 68, 68, 0.2); color: #ef4444; border: 1px solid rgba(239, 68, 68, ${opacity});`;
    } else { // 3-5 wins
      emoji = '🔥';
      label = `Heating Up (${count} Wins)`;
      const opacity = 0.25 + (count - 3) * 0.08;
      styleStr = `background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, ${opacity});`;
    }
  } else {
    badge.classList.add('cold-streak');
    if (count >= 10) {
      emoji = '❄️';
      label = `Ice Cold (${count} Losses)`;
      badge.classList.add('ice-cold');
      const glowRadius = Math.min(8 + (count - 10) * 1.5, 20);
      styleStr = `background: linear-gradient(135deg, #0ea5e9, #2563eb); color: #ffffff; border: 1px solid #38bdf8; box-shadow: 0 0 ${glowRadius}px rgba(56, 189, 248, 0.7); font-weight: 800;`;
    } else if (count >= 6) {
      emoji = '❄️';
      label = `Cold (${count} Losses)`;
      const opacity = 0.4 + (count - 6) * 0.1;
      styleStr = `background: rgba(37, 99, 235, 0.2); color: #3b82f6; border: 1px solid rgba(59, 130, 246, ${opacity});`;
    } else { // 3-5 losses
      emoji = '❄️';
      label = `Cooling Down (${count} Losses)`;
      const opacity = 0.25 + (count - 3) * 0.08;
      styleStr = `background: rgba(186, 230, 253, 0.25); color: #0ea5e9; border: 1px solid rgba(14, 165, 233, ${opacity});`;
    }
  }
  
  badge.innerHTML = `<span class="streak-emoji">${emoji}</span><span class="streak-count">${count}</span>`;
  badge.setAttribute('title', label);
  if (styleStr) {
    badge.style.cssText += styleStr;
  }
  return badge;
}

// Star players by team ID for realism
const STAR_PLAYERS = {
  141: ["Vladimir Guerrero Jr.", "Alejandro Kirk", "George Springer", "Daulton Varsho"], // Blue Jays
  147: ["Aaron Judge", "Juan Soto", "Giancarlo Stanton", "Gleyber Torres"], // Yankees
  119: ["Shohei Ohtani", "Mookie Betts", "Freddie Freeman", "Teoscar Hernández"], // Dodgers
  144: ["Ronald Acuña Jr.", "Matt Olson", "Austin Riley", "Marcell Ozuna"], // Braves
  143: ["Bryce Harper", "Trea Turner", "Kyle Schwarber", "J.T. Realmuto"], // Phillies
  110: ["Adley Rutschman", "Gunnar Henderson", "Anthony Santander", "Cedric Mullins"], // Orioles
  136: ["Julio Rodríguez", "Cal Raleigh", "J.P. Crawford", "Mitch Haniger"], // Mariners
  117: ["Jose Altuve", "Yordan Alvarez", "Alex Bregman", "Kyle Tucker"], // Astros
  135: ["Manny Machado", "Fernando Tatis Jr.", "Xander Bogaerts", "Jake Cronenworth"], // Padres
  139: ["Christopher Morel", "Yandy Díaz", "Isaac Paredes", "Brandon Lowe"], // Rays
  111: ["Rafael Devers", "Triston Casas", "Jarren Duran", "Masataka Yoshida"], // Red Sox
  112: ["Cody Bellinger", "Dansby Swanson", "Nico Hoerner", "Seiya Suzuki"], // Cubs
  138: ["Paul Goldschmidt", "Nolan Arenado", "Willson Contreras", "Masyn Winn"], // Cardinals
  158: ["Christian Yelich", "William Contreras", "Willy Adames", "Rhys Hoskins"], // Brewers
  137: ["Matt Chapman", "Logan Webb", "Jung Hoo Lee", "Bo Bichette"] // Giants
};

const GENERIC_FIRST_NAMES = ["Mike", "John", "David", "James", "Brandon", "Tyler", "Chris", "Alex", "Bobby", "Austin", "Jose", "Carlos", "Luis", "Rafael", "Justin", "Marcus", "Zack", "Kyle"];
const GENERIC_LAST_NAMES = ["Smith", "Johnson", "Rodriguez", "Hernandez", "Martinez", "Davis", "Miller", "Garcia", "Wilson", "Anderson", "Taylor", "Thomas", "Moore", "Jackson", "Martin", "Lee"];

// Generate deterministic player hit streaks (>=10 games) for a team on a given date
function getPlayerHitStreaks(teamId, dateStr) {
  let seed = 0;
  for (let i = 0; i < dateStr.length; i++) {
    seed += dateStr.charCodeAt(i);
  }
  seed = (seed * 31 + teamId) % 10000;
  
  function random() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  }
  
  const players = STAR_PLAYERS[teamId] || [];
  if (players.length === 0) {
    const generated = [];
    for (let i = 0; i < 4; i++) {
      const first = GENERIC_FIRST_NAMES[Math.floor(random() * GENERIC_FIRST_NAMES.length)];
      const last = GENERIC_LAST_NAMES[Math.floor(random() * GENERIC_LAST_NAMES.length)];
      generated.push(`${first} ${last}`);
    }
    players.push(...generated);
  }
  
  const activeStreaks = [];
  players.forEach((name, idx) => {
    // 25% chance of a hit streak per player
    const hasStreak = random() < 0.28;
    if (hasStreak) {
      const streakLength = Math.floor(random() * 17) + 10;
      activeStreaks.push({
        name,
        streak: streakLength
      });
    }
  });
  
  activeStreaks.sort((a, b) => b.streak - a.streak);
  return activeStreaks;
}

// Helper to format YYYY-MM-DD into a human-readable date (e.g. Jun 27)
function formatHumanDate(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const d = new Date(year, month, day);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// Helper to sort games by play time, kicking completed ones to the bottom
function sortGames(gamesList) {
  return [...gamesList].sort((a, b) => {
    const timeA = new Date(a.gameDate).getTime();
    const timeB = new Date(b.gameDate).getTime();
    
    const isFinalA = a.status?.statusCode === 'F' || a.status?.detailedState === 'Final' || a.status?.statusCode === 'O';
    const isFinalB = b.status?.statusCode === 'F' || b.status?.detailedState === 'Final' || b.status?.statusCode === 'O';
    
    if (isFinalA && !isFinalB) return 1;
    if (!isFinalA && isFinalB) return -1;
    
    return timeA - timeB;
  });
}

// Helper to determine active/complete state of games for division/league teams
function getRaceStatusNote(targetTeamIds) {
  const games = state.rawSchedule || [];
  
  // Filter games involving any of the target teams (raw API schema uses teams.away.team.id)
  const relevantGames = games.filter(g => {
    const awayId = g.teams?.away?.team?.id;
    const homeId = g.teams?.home?.team?.id;
    return targetTeamIds.has(awayId) || targetTeamIds.has(homeId);
  });

  if (relevantGames.length === 0) {
    const formattedDate = formatHumanDate(state.selectedDate);
    return `No Games Scheduled for ${formattedDate}`;
  }

  let completedCount = 0;
  let liveCount = 0;
  let scheduledCount = 0;

  relevantGames.forEach(g => {
    const isLive = g.status.statusCode === 'I' || g.status.detailedState.toLowerCase().includes('progress');
    const isFinal = g.status.statusCode === 'F' || g.status.detailedState === 'Final' || g.status.statusCode === 'O';
    
    if (isFinal) {
      completedCount++;
    } else if (isLive) {
      liveCount++;
    } else {
      scheduledCount++;
    }
  });

  const formattedDate = formatHumanDate(state.selectedDate);

  if (completedCount === relevantGames.length) {
    return `All Games Complete for ${formattedDate}`;
  }

  const total = relevantGames.length;
  const remaining = total - completedCount;

  if (completedCount > 0) {
    return `${total} Games That Matter Today (${remaining} Remaining)`;
  } else {
    return `${total} Games That Matter Today`;
  }
}

// Helper to render cards
function createGameCard(item, isNeutral) {
  const card = document.createElement('div');
  
  // Check if favorite team is playing in this game
  const isFavoriteMatchup = item.awayTeam.id === state.activeTeamId || item.homeTeam.id === state.activeTeamId;
  card.className = `glass-card game-card ${isNeutral ? 'neutral' : ''} ${isFavoriteMatchup ? 'favorite-matchup' : ''}`;
  
  const isExpanded = state.expandedGamePks.includes(item.gamePk);

  // Click handler to toggle details
  card.addEventListener('click', () => {
    if (isExpanded) {
      state.expandedGamePks = state.expandedGamePks.filter(pk => pk !== item.gamePk);
    } else {
      state.expandedGamePks.push(item.gamePk);
    }
    render();
  });

  // Game Header
  const gHeader = document.createElement('div');
  gHeader.className = 'game-header';
  const date = safeParseUTCDate(item.gameDate);
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  const headerLeft = document.createElement('span');
  headerLeft.innerText = timeStr;

  const headerRight = document.createElement('div');
  headerRight.style.display = 'flex';
  headerRight.style.alignItems = 'center';
  headerRight.style.gap = '8px';

  const isLive = item.status.statusCode === 'I' || item.status.detailedState.toLowerCase().includes('progress');
  const isFinal = item.status.statusCode === 'F' || item.status.detailedState === 'Final';
  const hasStarted = isLive || isFinal || ['I', 'F', 'O', 'D', 'U'].includes(item.status.statusCode) || item.status.detailedState.toLowerCase().includes('suspended');
  
  const now = new Date();
  const timeUntilStartMs = date.getTime() - now.getTime();
  const isWithin30Mins = timeUntilStartMs <= 30 * 60 * 1000;
  const shouldShowStatusBadge = isLive || isFinal || isWithin30Mins;
  const isScheduled = item.status.statusCode === 'S' || item.status.detailedState === 'Scheduled';
  
  if (shouldShowStatusBadge && !isScheduled) {
    const statusNode = document.createElement('span');
    let stateText = item.status.detailedState;
    if (isLive) {
      stateText = 'Live';
    }
    statusNode.className = `game-status ${isLive ? 'live' : ''}`;
    statusNode.innerText = stateText;
    headerRight.appendChild(statusNode);
  }

  // Completed game outcome badge (Happy/Sad Emoji)
  if (isFinal) {
    const outcomeBadge = document.createElement('span');
    
    const isAwayWinner = item.awayScore > item.homeScore;
    const winnerSide = isAwayWinner ? 'Away' : 'Home';
    
    if (item.rootFor === 'Neutral') {
      outcomeBadge.className = 'outcome-badge neutral';
      outcomeBadge.innerHTML = 'Neutral 😐';
    } else if (item.rootFor === winnerSide) {
      outcomeBadge.className = 'outcome-badge good';
      outcomeBadge.innerHTML = 'Nice 😊';
    } else {
      outcomeBadge.className = 'outcome-badge bad';
      outcomeBadge.innerHTML = 'Tough 😢';
    }
    headerRight.appendChild(outcomeBadge);
  }

  const expandHint = document.createElement('span');
  expandHint.className = 'card-expand-hint';
  expandHint.innerText = isExpanded ? 'Collapse ▲' : 'Details ▼';
  headerRight.appendChild(expandHint);

  gHeader.appendChild(headerLeft);
  gHeader.appendChild(headerRight);
  card.appendChild(gHeader);

  // Teams details
  const gTeams = document.createElement('div');
  gTeams.className = 'game-teams';

  // Away Team Row
  const awayRow = document.createElement('div');
  awayRow.className = 'game-team-row';
  const awayInfo = document.createElement('div');
  awayInfo.className = 'team-info';
  const awayBadge = document.createElement('div');
  awayBadge.className = 'team-badge-small';
  awayBadge.innerText = item.awayTeam.abbreviation;
  awayBadge.style.background = item.awayTeam.primaryColor;
  awayBadge.style.color = item.awayTeam.textColor;
  
  const awayInfoWrapper = document.createElement('div');
  awayInfoWrapper.className = 'team-name-wrapper';

  const awayName = document.createElement('span');
  awayName.className = `team-name ${item.awayTeam.id === state.activeTeamId ? 'favorite' : ''}`;
  awayName.innerText = item.awayTeam.name;
  awayInfoWrapper.appendChild(awayName);
  
  awayInfo.appendChild(awayBadge);
  
  // If it's the favorite team, add a gold star badge
  if (item.awayTeam.id === state.activeTeamId) {
    const starBadge = document.createElement('span');
    starBadge.className = 'fav-star-badge';
    starBadge.innerText = '★ Fav';
    awayInfoWrapper.appendChild(starBadge);
  }

  // Thumbs-up root indicator
  if (item.rootFor === 'Away') {
    const rootIcon = document.createElement('span');
    rootIcon.className = 'root-indicator-badge';
    rootIcon.innerText = 'ROOT';
    awayInfoWrapper.appendChild(rootIcon);
  }

  // Streak indicator
  const awayStreak = getTeamStreak(item.awayTeam.id, item.awayTeam.wins || 0, item.awayTeam.losses || 0);
  if (awayStreak && awayStreak.count >= 3) {
    awayInfoWrapper.appendChild(createStreakBadge(awayStreak));
  }

  awayInfo.appendChild(awayInfoWrapper);

  const awayScore = document.createElement('span');
  awayScore.className = `team-score ${isFinal ? (item.awayScore > item.homeScore ? 'winner' : 'loser') : ''}`;
  awayScore.innerText = hasStarted && item.awayScore !== null && item.awayScore !== undefined ? item.awayScore : '';
  awayRow.appendChild(awayInfo);
  awayRow.appendChild(awayScore);

  // Home Team Row
  const homeRow = document.createElement('div');
  homeRow.className = 'game-team-row';
  const homeInfo = document.createElement('div');
  homeInfo.className = 'team-info';
  const homeBadge = document.createElement('div');
  homeBadge.className = 'team-badge-small';
  homeBadge.innerText = item.homeTeam.abbreviation;
  homeBadge.style.background = item.homeTeam.primaryColor;
  homeBadge.style.color = item.homeTeam.textColor;
  
  const homeInfoWrapper = document.createElement('div');
  homeInfoWrapper.className = 'team-name-wrapper';

  const homeName = document.createElement('span');
  homeName.className = `team-name ${item.homeTeam.id === state.activeTeamId ? 'favorite' : ''}`;
  homeName.innerText = item.homeTeam.name;
  homeInfoWrapper.appendChild(homeName);
  
  homeInfo.appendChild(homeBadge);
  
  // If it's the favorite team, add a gold star badge
  if (item.homeTeam.id === state.activeTeamId) {
    const starBadge = document.createElement('span');
    starBadge.className = 'fav-star-badge';
    starBadge.innerText = '★ Fav';
    homeInfoWrapper.appendChild(starBadge);
  }

  // Thumbs-up root indicator
  if (item.rootFor === 'Home') {
    const rootIcon = document.createElement('span');
    rootIcon.className = 'root-indicator-badge';
    rootIcon.innerText = 'ROOT';
    homeInfoWrapper.appendChild(rootIcon);
  }

  // Streak indicator
  const homeStreak = getTeamStreak(item.homeTeam.id, item.homeTeam.wins || 0, item.homeTeam.losses || 0);
  if (homeStreak && homeStreak.count >= 3) {
    homeInfoWrapper.appendChild(createStreakBadge(homeStreak));
  }

  homeInfo.appendChild(homeInfoWrapper);

  const homeScore = document.createElement('span');
  homeScore.className = `team-score ${isFinal ? (item.homeScore > item.awayScore ? 'winner' : 'loser') : ''}`;
  homeScore.innerText = hasStarted && item.homeScore !== null && item.homeScore !== undefined ? item.homeScore : '';
  homeRow.appendChild(homeInfo);
  homeRow.appendChild(homeScore);

  gTeams.appendChild(awayRow);
  gTeams.appendChild(homeRow);

  // Dynamic Player Hitting Streaks (Always visible on the card)
  const streaksAway = getPlayerHitStreaks(item.awayTeam.id, state.selectedDate);
  const streaksHome = getPlayerHitStreaks(item.homeTeam.id, state.selectedDate);
  
  const hotPlayers = [];
  streaksAway.forEach(p => hotPlayers.push({ ...p, teamAbbr: item.awayTeam.abbreviation }));
  streaksHome.forEach(p => hotPlayers.push({ ...p, teamAbbr: item.homeTeam.abbreviation }));
  
  hotPlayers.sort((a, b) => b.streak - a.streak);

  if (hotPlayers.length > 0) {
    const hotBatsRow = document.createElement('div');
    hotBatsRow.className = 'game-hot-bats-row';
    hotBatsRow.style.cssText = `
      display: flex;
      align-items: center;
      gap: 4px;
      margin-top: 8px;
      padding-top: 6px;
      border-top: 1px dashed var(--border-glass);
      font-size: 10.5px;
      color: var(--text-secondary);
      flex-wrap: wrap;
    `;
    
    const icon = document.createElement('span');
    icon.innerText = '⚡';
    icon.style.cssText = 'color: #f59e0b; margin-right: 2px;';
    hotBatsRow.appendChild(icon);
    
    const label = document.createElement('span');
    label.style.fontWeight = '700';
    label.innerText = 'Hitting Streaks: ';
    hotBatsRow.appendChild(label);
    
    const playersListSpan = document.createElement('span');
    playersListSpan.style.display = 'inline-flex';
    playersListSpan.style.flexWrap = 'wrap';
    playersListSpan.style.gap = '6px';
    
    hotPlayers.forEach((p, idx) => {
      const pSpan = document.createElement('span');
      
      let streakColor = '#f59e0b';
      if (p.streak >= 20) streakColor = '#f43f5e';
      else if (p.streak >= 15) streakColor = '#f97316';
      
      pSpan.innerHTML = `${p.name} (<strong style="color: ${streakColor}; font-weight: 800; font-family: var(--font-title);">${p.streak}G</strong>, ${p.teamAbbr})${idx < hotPlayers.length - 1 ? ',' : ''}`;
      playersListSpan.appendChild(pSpan);
    });
    
    hotBatsRow.appendChild(playersListSpan);
    gTeams.appendChild(hotBatsRow);
  }

  card.appendChild(gTeams);

  // Expanded Game Details Drawer
  if (isExpanded) {
    // 1. Rooting Advice Banner (if not neutral and has standing impact)
    if (!isNeutral && (item.rootFor !== 'Neutral' || item.priority > 0)) {
      const rootingBanner = document.createElement('div');
      rootingBanner.className = `rooting-banner ${item.rootFor === 'Away' ? 'root-away' : item.rootFor === 'Home' ? 'root-home' : 'neutral'}`;

      const badgeTarget = document.createElement('span');
      badgeTarget.className = `rooting-target-badge ${item.rootFor !== 'Neutral' ? 'root' : 'neutral'}`;
      
      let targetName = 'Neutral';
      if (item.rootFor === 'Away') targetName = item.awayTeam.shortName;
      if (item.rootFor === 'Home') targetName = item.homeTeam.shortName;
      badgeTarget.innerText = item.rootFor !== 'Neutral' ? `Root for: ${targetName}` : 'No Impact';

      const expl = document.createElement('div');
      expl.className = 'rooting-explanation';
      expl.innerHTML = item.explanation;

      rootingBanner.appendChild(badgeTarget);
      rootingBanner.appendChild(expl);
      card.appendChild(rootingBanner);
    }

    const analyticsBtnRow = document.createElement('div');
    analyticsBtnRow.style.cssText = 'margin-top: 10px; display: flex; justify-content: center; width: 100%;';

    const analyticsBtn = document.createElement('button');
    analyticsBtn.className = 'recap-trigger-btn';
    analyticsBtn.style.cssText = 'width: 100%; margin: 0; padding: 10px 14px; font-size: 12.5px; font-weight: 700; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px;';
    analyticsBtn.innerHTML = '<span>📊</span> <span>Open Game Visual Analytics</span>';

    const handleOpenCardVisuals = (e) => {
      if (e) e.stopPropagation();
      try {
        openGameAnalyticsCenter(item, state, render);
      } catch (err) {
        console.error("Failed to open visuals from matchup card button:", err);
      }
    };

    analyticsBtn.addEventListener('click', handleOpenCardVisuals);

    analyticsBtnRow.appendChild(analyticsBtn);
    card.appendChild(analyticsBtnRow);

    const footerHint = document.createElement('div');
    footerHint.className = 'game-card-footer';
    footerHint.innerText = 'Click card to collapse details';
    card.appendChild(footerHint);
  }

  return card;
}

// Dashboard View
function createDashboardView() {
  const container = document.createElement('div');

  const team = state.processedStandings?.teamsMap?.[state.activeTeamId] || teamsData[state.activeTeamId];
  if (!team) return container;

  // 1. Dashboard Active Team Banner
  // If activeTeamId changed, reset selectedGameIdx to null
  if (state.lastActiveTeamId !== state.activeTeamId) {
    state.selectedGameIdx = null;
    state.lastActiveTeamId = state.activeTeamId;
  }

  const banner = document.createElement('div');
  banner.className = 'glass-card dashboard-banner';
  banner.style.display = 'flex';
  banner.style.flexDirection = 'column';
  banner.style.gap = '14px';
  banner.style.padding = '16px';
  banner.style.position = 'relative';

  const wins = team.wins !== undefined ? team.wins : 0;
  const losses = team.losses !== undefined ? team.losses : 0;
  const gamesRemaining = 162 - wins - losses;
  const seasonGames = generateSeasonGames(team.id, wins, losses);

  // Zoom Button (Toggle Zoom level of the run differential chart)
  const zoomBtn = document.createElement('button');
  zoomBtn.className = 'banner-zoom-btn';
  zoomBtn.setAttribute('title', state.bannerZoomedIn ? 'Show All Games' : 'Zoom to Last 10 Games');
  
  const zoomIconSvg = state.bannerZoomedIn 
    ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>` // Zoom Out (minus)
    : `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>`; // Zoom In (plus)

  zoomBtn.innerHTML = `${zoomIconSvg} <span style="vertical-align:middle;">${state.bannerZoomedIn ? 'ALL' : '10G'}</span>`;
  
  zoomBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    state.bannerZoomedIn = !state.bannerZoomedIn;
    
    // Adjust selectedGameIdx if it goes out of bounds of the zoom view
    if (state.bannerZoomedIn && seasonGames.length > 10) {
      const minVisibleIdx = seasonGames.length - 10;
      if (state.selectedGameIdx === null || state.selectedGameIdx < minVisibleIdx) {
        state.selectedGameIdx = seasonGames.length - 1;
      }
    }
    render();
  });
  
  // Help/Info Button (Explains run differential)
  const helpBtn = document.createElement('button');
  helpBtn.className = 'banner-help-btn';
  helpBtn.setAttribute('title', 'What is Run Differential?');
  helpBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block; vertical-align:middle;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
  
  helpBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showRunDiffHelpModal();
  });
  
  banner.appendChild(zoomBtn);
  banner.appendChild(helpBtn);

  // --- Row 1: Team Info & Stats Ticker ---
  const headerRow = document.createElement('div');
  headerRow.style.display = 'flex';
  headerRow.style.justifyContent = 'space-between';
  headerRow.style.alignItems = 'center';
  headerRow.style.flexWrap = 'wrap';
  headerRow.style.gap = '12px';

  const left = document.createElement('div');
  left.className = 'banner-team-info';

  const badge = document.createElement('div');
  badge.className = 'team-badge-large';
  badge.innerText = team.abbreviation;
  badge.style.background = 'rgba(255, 255, 255, 0.12)';
  badge.style.color = '#ffffff';

  const textNode = document.createElement('div');
  textNode.className = 'banner-team-text';

  const nameWrapper = document.createElement('div');
  nameWrapper.style.display = 'flex';
  nameWrapper.style.alignItems = 'center';
  nameWrapper.style.gap = '8px';

  const name = document.createElement('h2');
  name.innerText = team.name;
  name.style.margin = '0';
  nameWrapper.appendChild(name);

  // Streak indicator next to name if team is on a streak
  const activeTeamStreak = getTeamStreak(team.id, wins, losses);
  if (activeTeamStreak && activeTeamStreak.count >= 3) {
    nameWrapper.appendChild(createStreakBadge(activeTeamStreak));
  }

  const desc = document.createElement('p');
  const leagueName = team.leagueId === 103 ? 'American League' : 'National League';
  desc.innerText = `${leagueName} • ${team.divisionName}`;

  textNode.appendChild(nameWrapper);
  textNode.appendChild(desc);

  left.appendChild(badge);
  left.appendChild(textNode);

  // Right side stats ticker
  const right = document.createElement('div');
  right.className = 'banner-stats-ticker';
  right.style.display = 'flex';
  right.style.gap = '8px';
  right.style.flexWrap = 'wrap';

  // Calculate Last 10 games record
  const last10 = seasonGames.slice(-10);
  let last10Wins = 0;
  let last10Losses = 0;
  last10.forEach(g => {
    if (g.isWin) last10Wins++;
    else last10Losses++;
  });
  const last10Text = `${last10Wins}-${last10Losses}`;

  // Calculate formatted streak string (W/L)
  let streakText = '-';
  if (activeTeamStreak.type === 'win') streakText = `W${activeTeamStreak.count}`;
  else if (activeTeamStreak.type === 'loss') streakText = `L${activeTeamStreak.count}`;

  let divStandingText = '-';
  if (team.divisionLeader) divStandingText = "Leader";
  else if (team.gamesBack !== undefined) divStandingText = `${team.gamesBack} GB`;
  
  const wcStandingText = getWildCardStats(team, state.processedStandings);

  const statBoxes = [
    { label: 'Record', value: `${wins}-${losses}` },
    { label: 'Last 10', value: last10Text },
    { label: 'Streak', value: streakText },
    { label: 'Games Left', value: `${gamesRemaining}` },
    { label: 'Division', value: divStandingText },
    { label: 'Wild Card', value: wcStandingText }
  ];

  statBoxes.forEach(box => {
    const boxEl = document.createElement('div');
    boxEl.style.background = 'rgba(255, 255, 255, 0.10)';
    boxEl.style.border = '1px solid rgba(255, 255, 255, 0.18)';
    boxEl.style.padding = '4px 8px';
    boxEl.style.borderRadius = '4px';
    boxEl.style.display = 'flex';
    boxEl.style.flexDirection = 'column';
    boxEl.style.alignItems = 'center';
    boxEl.style.minWidth = '62px';

    const labelEl = document.createElement('span');
    labelEl.innerText = box.label;
    labelEl.style.fontSize = '8px';
    labelEl.style.textTransform = 'uppercase';
    labelEl.style.color = 'rgba(255, 255, 255, 0.7)';
    labelEl.style.fontWeight = '700';
    labelEl.style.letterSpacing = '0.05em';
    labelEl.style.marginBottom = '2px';

    const valEl = document.createElement('span');
    valEl.innerText = box.value;
    valEl.style.fontSize = '12px';
    valEl.style.color = '#ffffff';
    valEl.style.fontWeight = '800';
    valEl.style.fontFamily = 'var(--font-title)';

    boxEl.appendChild(labelEl);
    boxEl.appendChild(valEl);
    right.appendChild(boxEl);
  });

  headerRow.appendChild(left);
  headerRow.appendChild(right);
  banner.appendChild(headerRow);

  // --- Row 2: Run Differential Bar Chart ---

  
  if (seasonGames.length > 0) {
    const displayGames = state.bannerZoomedIn ? seasonGames.slice(-10) : seasonGames;
    const startIndex = state.bannerZoomedIn ? (seasonGames.length - displayGames.length) : 0;

    if (state.selectedGameIdx === null || state.selectedGameIdx >= seasonGames.length) {
      state.selectedGameIdx = seasonGames.length - 1;
    }
    // If zoomed in and selected index is out of visible range, adjust it to the latest game
    if (state.bannerZoomedIn && state.selectedGameIdx < startIndex) {
      state.selectedGameIdx = seasonGames.length - 1;
    }

    const chartContainer = document.createElement('div');
    chartContainer.className = 'banner-chart-container';
    chartContainer.style.width = '100%';
    chartContainer.style.marginTop = '4px';
    chartContainer.style.position = 'relative';

    const svgWidth = 500;
    const svgHeight = 90;
    const padL = 10;
    const padR = 10;
    const padT = 8;
    const padB = 8;
    const plotW = svgWidth - padL - padR;
    const plotH = svgHeight - padT - padB;
    const zeroY = padT + plotH / 2; // Center zero line
    
    const runDiffs = seasonGames.map(g => Math.abs(g.runDiff));
    const maxDiff = Math.max(...runDiffs, 1);
    const halfH = plotH / 2;

    const G_count = displayGames.length;
    const slotW = plotW / G_count;
    const barWidth = Math.max(2.5, slotW - 1.5);

    let barsHtml = '';
    displayGames.forEach((g, displayIdx) => {
      const idx = startIndex + displayIdx;
      const isWin = g.isWin;
      const diff = Math.abs(g.runDiff);
      const barH = (diff / maxDiff) * halfH;
      const barX = padL + displayIdx * slotW;
      const barY = isWin ? (zeroY - barH) : zeroY;
      
      const isSelected = idx === state.selectedGameIdx;
      
      let fill = isWin ? '#34d399' : '#f87171'; // Teal for win, Rose for loss
      let strokeHtml = '';
      let classList = 'run-diff-bar';
      if (isSelected) {
        strokeHtml = `stroke="#ffffff" stroke-width="1.5"`;
        classList += ' selected-bar-active';
      }

      barsHtml += `
        <rect class="${classList}" 
              data-game-idx="${idx}"
              x="${barX.toFixed(2)}" 
              y="${barY.toFixed(2)}" 
              width="${barWidth.toFixed(2)}" 
              height="${barH.toFixed(2)}" 
              fill="${fill}" 
              ${strokeHtml}
              rx="1.5"
              style="cursor: pointer; ${isSelected ? '' : 'opacity: 0.65;'} transition: opacity 0.15s, fill 0.15s;" />
      `;
    });

    const svgHtml = `
      <svg viewBox="0 0 ${svgWidth} ${svgHeight}" width="100%" height="auto" style="overflow: visible; background: none;">
        <!-- Zero baseline -->
        <line x1="${padL}" y1="${zeroY}" x2="${svgWidth - padR}" y2="${zeroY}" stroke="rgba(255, 255, 255, 0.25)" stroke-width="1" stroke-dasharray="2,2" />
        
        <!-- Game Bars -->
        ${barsHtml}
      </svg>
    `;

    chartContainer.innerHTML = svgHtml;
    
    // Add interactive click and hover listeners to SVG elements
    const svgEl = chartContainer.querySelector('svg');
    
    const handleBarSelect = (e) => {
      const bar = e.target.classList && e.target.classList.contains('run-diff-bar') ? e.target : e.target.closest('.run-diff-bar');
      if (!bar) return;
      const idx = parseInt(bar.getAttribute('data-game-idx'));
      if (!isNaN(idx)) {
        state.selectedGameIdx = idx;
        render();
      }
    };

    svgEl.addEventListener('click', handleBarSelect);
    svgEl.addEventListener('touchstart', handleBarSelect, { passive: true });
    
    svgEl.addEventListener('mouseover', (e) => {
      const bar = e.target.classList && e.target.classList.contains('run-diff-bar') ? e.target : e.target.closest('.run-diff-bar');
      if (!bar) return;
      const idx = parseInt(bar.getAttribute('data-game-idx'));
      if (!isNaN(idx)) {
        updateDetailStrip(seasonGames[idx]);
      }
    });
    
    svgEl.addEventListener('mouseleave', () => {
      if (state.selectedGameIdx !== null && seasonGames[state.selectedGameIdx]) {
        updateDetailStrip(seasonGames[state.selectedGameIdx]);
      }
    });

    banner.appendChild(chartContainer);

    // --- Row 3: Selected Game Detail Strip ---
    const detailStrip = document.createElement('div');
    detailStrip.className = 'banner-detail-strip';
    detailStrip.style.cssText = 'display: flex; flex-direction: column; gap: 8px; padding: 8px 10px; background: rgba(0, 0, 0, 0.18); border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.08); width: 100%;';

    const topRow = document.createElement('div');
    topRow.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%;';

    const textContainer = document.createElement('div');
    textContainer.style.flex = '1';
    textContainer.style.textAlign = 'left';
    textContainer.style.color = 'rgba(255, 255, 255, 0.95)';
    textContainer.style.fontWeight = '500';
    textContainer.style.letterSpacing = '0.02em';
    
    // Side-by-side buttons on the right
    const btnGroup = document.createElement('div');
    btnGroup.style.display = 'flex';
    btnGroup.style.gap = '4px';
    btnGroup.style.flexShrink = '0';

    const prevBtn = document.createElement('button');
    prevBtn.className = 'banner-nav-btn';
    prevBtn.style.flexShrink = '0';
    prevBtn.innerText = '◀';
    prevBtn.disabled = state.selectedGameIdx <= 0;
    prevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.selectedGameIdx > 0) {
        state.selectedGameIdx--;
        render();
      }
    });

    const nextBtn = document.createElement('button');
    nextBtn.className = 'banner-nav-btn';
    nextBtn.style.flexShrink = '0';
    nextBtn.innerText = '▶';
    nextBtn.disabled = state.selectedGameIdx >= seasonGames.length - 1;
    nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.selectedGameIdx < seasonGames.length - 1) {
        state.selectedGameIdx++;
        render();
      }
    });

    btnGroup.appendChild(prevBtn);
    btnGroup.appendChild(nextBtn);

    topRow.appendChild(textContainer);
    topRow.appendChild(btnGroup);
    detailStrip.appendChild(topRow);

    // Separator Line
    const separator = document.createElement('div');
    separator.style.cssText = 'border-top: 1px dashed rgba(255, 255, 255, 0.15); width: 100%; height: 0;';
    detailStrip.appendChild(separator);

    // Full-width Analytics Button
    const analyticsBtn = document.createElement('button');
    analyticsBtn.className = 'banner-nav-btn';
    analyticsBtn.style.cssText = 'width: 100%; margin: 0; padding: 6px 12px; font-size: 11.5px; font-weight: 700; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.12); color: #ffffff; box-shadow: none;';
    analyticsBtn.innerHTML = '<span>📊</span> <span>Open Game Visual Analytics</span>';

    const handleOpenVisuals = (e) => {
      if (e) e.stopPropagation();
      try {
        const g = seasonGames[state.selectedGameIdx] || seasonGames[seasonGames.length - 1];
        if (g) {
          openGameAnalyticsCenter(reconstructGameFromSeasonGame(g, team, state), state, render);
        } else {
          console.warn("handleOpenVisuals: seasonGames array is empty.");
        }
      } catch (err) {
        console.error("Failed to open visuals from banner button:", err);
        alert("Banner Button Error:\n" + err.message + "\n" + err.stack);
      }
    };

    analyticsBtn.addEventListener('click', handleOpenVisuals);
    detailStrip.appendChild(analyticsBtn);
    
    function updateDetailStrip(g) {
      const resultText = g.isWin ? 'Win' : 'Loss';
      const resultColor = g.isWin ? '#6ee7b7' : '#fca5a5';
      const diffText = g.runDiff > 0 ? `+${g.runDiff}` : `${g.runDiff}`;
      
      const yesterdayStr = getBaseballDate(-1);
      const isTrulyYesterday = g.gameDateISO === yesterdayStr;
      const dateDisplay = isTrulyYesterday ? `${g.dateStr} (Yesterday)` : g.dateStr;
      
      textContainer.innerHTML = `
        <div style="font-size: 9px; color: rgba(255,255,255,0.65); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700; margin-bottom: 2px;">
          Game ${g.gameNumber} • ${dateDisplay}
        </div>
        <div style="font-size: 13px; font-weight: 800; color: #ffffff;">
          <span style="color: ${resultColor};">${resultText} ${g.teamScore}-${g.oppScore}</span> vs ${g.opponent}
        </div>
        <div style="font-size: 9px; color: rgba(255,255,255,0.7); margin-top: 1px;">
          Run Differential: <strong style="color: #ffffff;">${diffText}</strong>
        </div>
      `;
    }

    if (seasonGames[state.selectedGameIdx]) {
      updateDetailStrip(seasonGames[state.selectedGameIdx]);
    }

    banner.appendChild(detailStrip);

  }

  container.appendChild(banner);

  // Active team today's matchup card (if any) placed directly under the team banner
  const todayGames = state.rawSchedule || [];
  const analysis = analyzeMatchups(todayGames, state.processedStandings, state.activeTeamId);
  const activeTeamMatchup = analysis.find(g =>
    g.awayTeam.id === state.activeTeamId ||
    g.homeTeam.id === state.activeTeamId
  );
  if (activeTeamMatchup) {
    const activeTeamGameCard = createGameCard(activeTeamMatchup, false);
    activeTeamGameCard.style.marginTop = '14px';
    container.appendChild(activeTeamGameCard);
  } else {
    const activeTeamName = state.processedStandings?.teamsMap?.[state.activeTeamId]?.shortName || teamsData[state.activeTeamId]?.shortName || 'Tracked Team';
    const noGameCard = document.createElement('div');
    noGameCard.className = 'glass-card';
    noGameCard.style.cssText = 'margin-top: 14px; padding: 16px; text-align: center; color: var(--text-secondary); font-size: 13px; font-weight: 600; border: 1px solid var(--border-glass-highlight);';
    const formattedDate = formatOffDayDate(state.selectedDate);
    noGameCard.innerHTML = `
      <div>⚾ The ${activeTeamName} do not have a game today.</div>
      <div style="font-size: 11.5px; opacity: 0.8; margin-top: 4px; font-weight: 500;">(${formattedDate})</div>
    `;
    container.appendChild(noGameCard);
  }

  // Yesterday's Standings Recap Trigger Button (only visible when looking at today's data)
  const todayStr = getBaseballDate(0);
  if (state.selectedDate === todayStr) {
    const recapBtn = document.createElement('button');
    recapBtn.className = 'recap-trigger-btn';
    recapBtn.innerHTML = `
      <span class="icon">📅</span>
      <span>What Happened Yesterday</span>
    `;
    recapBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showRecapModal(false);
    });
    container.appendChild(recapBtn);
  }

  // 2. Playoff Position Visual Tracker Card
  const trackerCard = document.createElement('div');
  trackerCard.className = 'glass-card';
  
  const trackerTitle = document.createElement('h3');
  trackerTitle.className = 'section-title';
  trackerTitle.innerText = 'Playoff Position Tracker';
  trackerCard.appendChild(trackerTitle);

  // Toggle buttons
  const toggleGroup = document.createElement('div');
  toggleGroup.className = 'tracker-toggle-group';
  
  const divToggle = document.createElement('button');
  divToggle.className = `tracker-toggle-btn ${state.activeTrackerTab === 'division' ? 'active' : ''}`;
  divToggle.innerText = 'Division Race';
  divToggle.addEventListener('click', () => {
    state.activeTrackerTab = 'division';
    render();
  });

  const wcToggle = document.createElement('button');
  wcToggle.className = `tracker-toggle-btn ${state.activeTrackerTab === 'wildcard' ? 'active' : ''}`;
  wcToggle.innerText = 'Wild Card Race';
  wcToggle.addEventListener('click', () => {
    state.activeTrackerTab = 'wildcard';
    render();
  });

  toggleGroup.appendChild(divToggle);
  toggleGroup.appendChild(wcToggle);
  trackerCard.appendChild(toggleGroup);

  // Visuals content
  if (state.activeTrackerTab === 'division') {
    // DIVISION RACE CHART (replaced visual timeline with SVG comparison chart)
    const timeline = document.createElement('div');
    timeline.className = 'division-timeline';

    const divId = team.divisionId;
    const divTeams = state.processedStandings?.divisionTeams?.[divId] || [];

    if (divTeams.length > 0) {
      const leader = divTeams[0];
      const isLeader = team.divisionLeader;
      const opponent = isLeader ? divTeams[1] : leader;
      
      if (opponent) {
        // Render the legend at the top
        const legend = document.createElement('div');
        legend.className = 'chart-legend';
        legend.style.display = 'flex';
        legend.style.justifyContent = 'center';
        legend.style.gap = '20px';
        legend.style.fontSize = '11px';
        legend.style.marginBottom = '8px';
        legend.style.marginTop = '4px';
        
        const colorA = team.primaryColor || '#134a8e';
        
        legend.innerHTML = `
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="display:inline-block; width:12px; height:3px; background:${colorA}; border-radius:1px;"></span>
            <span style="color:var(--text-primary); font-weight:700;">${team.shortName} (Active)</span>
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="display:inline-block; width:12px; height:1.5px; background:#888; opacity:0.6; border-radius:0.5px;"></span>
            <span style="color:var(--text-secondary); font-weight:600; font-size:10px;">Division Rivals</span>
          </div>
        `;
        timeline.appendChild(legend);
        
        // Generate SVG chart
        // Revert Check: to go back to dual-team, swap this line with: const chartNode = createDivisionRaceChart(team, opponent);
        const chartNode = createMultiTeamRaceChart(team, divTeams);
        timeline.appendChild(chartNode);
        
        // Add info subtitle
        const info = document.createElement('div');
        info.style.textAlign = 'center';
        info.style.fontSize = '12px';
        info.style.color = 'var(--text-secondary)';
        info.style.marginTop = '10px';
        info.style.fontWeight = '500';
        
        let leadText = '';
        if (isLeader) {
          const lead = ((team.wins - opponent.wins) + (opponent.losses - team.losses)) / 2;
          leadText = `Holding a <strong>+${lead} GB</strong> lead over ${opponent.shortName}.`;
        } else {
          leadText = `Trailing ${opponent.shortName} by <strong>${team.gamesBack} GB</strong>.`;
        }
        
        const trend = getDivisionTrend(team.id);
        const trendBadge = renderTrendBadge(trend);
        
        info.innerHTML = leadText;
        if (trend && trendBadge.innerText !== '') {
          info.appendChild(document.createTextNode(' '));
          info.appendChild(trendBadge);
        }
        timeline.appendChild(info);
      }
    }

    trackerCard.appendChild(timeline);
  } else {
    // WILD CARD VISUAL LADDER
    const ladder = document.createElement('div');
    ladder.className = 'ladder-container';

    const leagueId = team.leagueId;
    const allLeague = state.processedStandings?.leagueTeams?.[leagueId] || [];
    // Wild Card pool: teams that are NOT division leaders
    const wcPool = allLeague.filter(t => !t.divisionLeader).sort((a, b) => a.wildCardRank - b.wildCardRank);

    if (wcPool.length > 0) {
      const displayedIndices = new Set();
      
      // 1. Always display the top 5 (indices 0 to 4)
      const baseLimit = Math.min(wcPool.length, 5);
      for (let i = 0; i < baseLimit; i++) {
        displayedIndices.add(i);
      }
      
      // 2. Find active team index and add it + its chaser (the team immediately behind them)
      const activeIdx = wcPool.findIndex(t => t.id === state.activeTeamId);
      if (activeIdx >= 0) {
        displayedIndices.add(activeIdx);
        if (activeIdx + 1 < wcPool.length) {
          displayedIndices.add(activeIdx + 1);
        }
      }
      
      // 3. Resolve direct ties for any team in the base set
      const baseIndices = Array.from(displayedIndices);
      baseIndices.forEach(idx => {
        const team = wcPool[idx];
        for (let j = 0; j < wcPool.length; j++) {
          if (wcPool[j].wildCardGamesBack === team.wildCardGamesBack) {
            displayedIndices.add(j);
          }
        }
      });
      
      // 4. Find the team (or group of tied teams) immediately behind each tied group
      // We do this in a single pass to prevent recursive chain reactions
      const resolvedIndices = Array.from(displayedIndices);
      const newAdditions = [];
      
      resolvedIndices.forEach(idx => {
        const team = wcPool[idx];
        
        // Find all teams in the same tied group
        const tiedGroup = [];
        for (let j = 0; j < wcPool.length; j++) {
          if (wcPool[j].wildCardGamesBack === team.wildCardGamesBack) {
            tiedGroup.push(j);
          }
        }
        
        // Find the team immediately behind this tied group if it is a tied group (size > 1)
        if (tiedGroup.length > 1) {
          const maxGroupIdx = Math.max(...tiedGroup);
          const nextIdx = maxGroupIdx + 1;
          if (nextIdx < wcPool.length) {
            newAdditions.push(nextIdx);
            
            // Also include any teams tied with this next team (to avoid half-hidden ties)
            for (let j = 0; j < wcPool.length; j++) {
              if (wcPool[j].wildCardGamesBack === wcPool[nextIdx].wildCardGamesBack) {
                newAdditions.push(j);
              }
            }
          }
        }
      });
      
      // Add the final next-in-line additions to our display list
      newAdditions.forEach(idx => displayedIndices.add(idx));
      
      // 4. Sort indices ascending to render in correct standing order
      const sortedIndices = Array.from(displayedIndices).sort((a, b) => a - b);
      
      // 5. Render rows, drawing cutoff line and ellipsis as needed
      let cutoffDrawn = false;
      let lastIdx = -1;
      
      sortedIndices.forEach((idx) => {
        // Draw Cutoff Line when crossing the playoff threshold (index >= 3)
        if (idx >= 3 && !cutoffDrawn) {
          const cutoff = document.createElement('div');
          cutoff.className = 'ladder-cutoff-line';
          const label = document.createElement('span');
          label.className = 'ladder-cutoff-label';
          label.innerText = 'Playoff Cutoff';
          cutoff.appendChild(label);
          ladder.appendChild(cutoff);
          cutoffDrawn = true;
        }

        // Draw ellipsis if there's a gap in indices
        if (lastIdx !== -1 && idx > lastIdx + 1) {
          const ellipsis = document.createElement('div');
          ellipsis.style.textAlign = 'center';
          ellipsis.style.color = 'var(--text-muted)';
          ellipsis.style.fontSize = '12px';
          ellipsis.style.margin = '6px 0';
          ellipsis.innerText = '• • •';
          ladder.appendChild(ellipsis);
        }

        const tRec = wcPool[idx];
        ladder.appendChild(createLadderRow(tRec, idx < 3, tRec.id === state.activeTeamId));
        lastIdx = idx;
      });
    }

    trackerCard.appendChild(ladder);
  }
  container.appendChild(trackerCard);

  // Helper: Create a visual timeline node for division timeline
  function createTimelineNode(tRecord, isCurrent) {
    const node = document.createElement('div');
    node.className = `timeline-node ${isCurrent ? 'highlight' : ''}`;
    
    const leftSide = document.createElement('div');
    leftSide.className = 'standings-team-cell';
    const tBadge = document.createElement('div');
    tBadge.className = 'team-badge-small';
    tBadge.innerText = tRecord.abbreviation;
    tBadge.style.background = tRecord.primaryColor;
    tBadge.style.color = tRecord.textColor;

    const tName = document.createElement('span');
    tName.innerText = tRecord.name;
    tName.style.fontWeight = isCurrent ? '700' : '500';

    leftSide.appendChild(tBadge);
    leftSide.appendChild(tName);

    const rightSide = document.createElement('span');
    rightSide.style.fontFamily = 'var(--font-title)';
    rightSide.style.fontWeight = '700';
    rightSide.innerText = `${tRecord.wins}-${tRecord.losses}`;

    node.appendChild(leftSide);
    node.appendChild(rightSide);
    return node;
  }

  // Generate tiebreaker details natural language explanation
  function getTiebreakerExplanation(tRecord, wcPool) {
    const tiedTeams = wcPool.filter(t => t.wildCardGamesBack === tRecord.wildCardGamesBack);
    if (tiedTeams.length <= 1) return "";

    let explanation = `<div style="font-weight:700; margin-bottom:6px; font-size:11px; text-transform:uppercase; color:#d97706; display:flex; align-items:center; gap:4px;">⚠️ Tiebreaker Breakdown</div>`;
    explanation += `<p style="margin-bottom:8px; font-size:11px; color:var(--text-secondary);">These teams are tied in games back (${tRecord.wildCardGamesBack < 0 ? '+' : ''}${Math.abs(tRecord.wildCardGamesBack)} GB). Seeding order is determined by official MLB tiebreaker rules:</p>`;
    
    const tiebreakerDetails = calculateTiebreakerRecords(tiedTeams);
    
    explanation += `<div style="display:flex; flex-direction:column; gap:6px;">`;
    tiebreakerDetails.forEach(detail => {
      const isCurrentTeam = detail.team.id === tRecord.id;
      explanation += `
        <div style="font-size:11px; padding:6px 10px; background:${isCurrentTeam ? 'rgba(var(--team-primary-rgb), 0.08)' : '#f8fafc'}; border-radius:6px; border: 1px solid ${isCurrentTeam ? 'rgba(var(--team-primary-rgb), 0.25)' : '#cbd5e1'};">
          <div style="display:flex; justify-content:space-between; margin-bottom:2px; font-weight:700;">
            <span style="color:${isCurrentTeam ? 'var(--team-primary)' : 'var(--text-primary)'};">#${detail.rankInTie} ${detail.team.name}</span>
            <span style="font-family:monospace; color:var(--text-secondary);">${detail.recordStr}</span>
          </div>
          <p style="color:var(--text-secondary); line-height:1.3; margin:0;">${detail.explanation}</p>
        </div>
      `;
    });
    explanation += `</div>`;

    const bestTeam = tiedTeams[0];
    explanation += `<p style="margin-top:10px; font-size:11px; border-top:1px solid #cbd5e1; padding-top:8px; color:var(--text-secondary); margin-bottom:0;">
      <strong>${bestTeam.shortName}</strong> currently holds the higher seed due to the active tiebreaker (<strong>${tiebreakerDetails[0].criteria}</strong>).
    </p>`;
    
    return explanation;
  }

  // Helper: Create a row for wildcard visual ladder
  function createLadderRow(tRecord, inPlayoffs, isCurrent) {
    const leagueId = tRecord.leagueId;
    const allLeague = state.processedStandings?.leagueTeams?.[leagueId] || [];
    const wcPool = allLeague.filter(t => !t.divisionLeader).sort((a, b) => a.wildCardRank - b.wildCardRank);
    
    // Check if other teams are tied with this team's games back
    const tiedTeams = wcPool.filter(t => t.wildCardGamesBack === tRecord.wildCardGamesBack);
    const isTied = tiedTeams.length > 1;
    const isTiebreakerExpanded = state.expandedTiebreakerTeamIds.includes(tRecord.id);

    const wrapper = document.createElement('div');
    wrapper.style.display = 'flex';
    wrapper.style.flexDirection = 'column';
    wrapper.style.width = '100%';

    const row = document.createElement('div');
    row.className = `ladder-row ${inPlayoffs ? 'in-playoffs' : ''} ${isCurrent ? 'highlight' : ''}`;
    
    if (isTied) {
      row.style.cursor = 'pointer';
      row.title = 'Click to show tiebreaker details';
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isTiebreakerExpanded) {
          state.expandedTiebreakerTeamIds = state.expandedTiebreakerTeamIds.filter(id => id !== tRecord.id);
        } else {
          state.expandedTiebreakerTeamIds.push(tRecord.id);
        }
        render();
      });
    }

    const label = document.createElement('span');
    label.className = 'ladder-label';
    label.innerText = tRecord.wildCardRank <= 3 ? `WC ${tRecord.wildCardRank}` : 'OUT';

    const teamCol = document.createElement('div');
    teamCol.className = 'ladder-team';
    const tBadge = document.createElement('div');
    tBadge.className = 'team-badge-small';
    tBadge.innerText = tRecord.abbreviation;
    tBadge.style.background = tRecord.primaryColor;
    tBadge.style.color = tRecord.textColor;
    tBadge.style.fontSize = '9px';
    const tName = document.createElement('span');
    tName.innerText = tRecord.shortName;

    teamCol.appendChild(tBadge);
    teamCol.appendChild(tName);

    // If tied, add an info icon indicator next to the team name
    if (isTied) {
      const tiedBadge = document.createElement('span');
      tiedBadge.style.background = 'rgba(245, 158, 11, 0.1)';
      tiedBadge.style.border = '1px solid rgba(245, 158, 11, 0.2)';
      tiedBadge.style.color = '#f59e0b';
      tiedBadge.style.fontSize = '8px';
      tiedBadge.style.padding = '1px 4.5px';
      tiedBadge.style.borderRadius = '4px';
      tiedBadge.style.marginLeft = '6px';
      tiedBadge.style.fontWeight = '800';
      tiedBadge.style.textTransform = 'uppercase';
      tiedBadge.style.letterSpacing = '0.02em';
      tiedBadge.innerText = isTiebreakerExpanded ? 'Tied ▲' : 'Tied ℹ️';
      teamCol.appendChild(tiedBadge);
    }

    const gap = document.createElement('span');
    gap.className = `ladder-gap ${tRecord.wildCardGamesBack <= 0 ? 'ahead' : 'behind'}`;
    gap.style.display = 'inline-flex';
    gap.style.alignItems = 'center';
    
    const gapText = document.createElement('span');
    gapText.style.display = 'inline-flex';
    gapText.style.alignItems = 'center';
    
    let gbStr = '';
    if (tRecord.wildCardGamesBack < 0) {
      gbStr = `+${Math.abs(tRecord.wildCardGamesBack)}`;
    } else if (tRecord.wildCardGamesBack > 0) {
      gbStr = `${tRecord.wildCardGamesBack} GB`;
    } else {
      gbStr = '0.0 GB';
    }
    
    gapText.innerHTML = `<span style="font-size: 11px; font-weight: 400; color: var(--text-muted); margin-right: 8px; font-family: var(--font-body);">${tRecord.pct}</span><span>${gbStr}</span>`;
    gap.appendChild(gapText);

    // Add trend badge
    const trend = getWildCardTrend(tRecord.id);
    gap.appendChild(renderTrendBadge(trend));

    row.appendChild(label);
    row.appendChild(teamCol);
    row.appendChild(gap);
    wrapper.appendChild(row);

    // Render tiebreaker details accordion dropdown
    if (isTied && isTiebreakerExpanded) {
      const detailContainer = document.createElement('div');
      detailContainer.className = 'tiebreaker-detail';
      detailContainer.innerHTML = getTiebreakerExplanation(tRecord, wcPool);
      wrapper.appendChild(detailContainer);
    }

    return wrapper;
  }

  // 3. Collapsible Magic Numbers Accordion (🔒 Playoff Clinch Math)
  // Hide this section until there are only 20 games left in the season (gamesRemaining <= 20)
  if (gamesRemaining <= 20) {
    const magicAccordion = document.createElement('div');
    magicAccordion.className = `magic-accordion ${state.magicNumberExpanded ? 'expanded' : ''}`;

    const accordionHeader = document.createElement('button');
    accordionHeader.className = 'magic-accordion-header';
    
    const headerTitle = document.createElement('span');
    headerTitle.innerHTML = '🔒 Playoff Clinch Math';
    
    const caret = document.createElement('span');
    caret.className = 'magic-accordion-caret';
    caret.innerText = '▼';

    accordionHeader.appendChild(headerTitle);
    accordionHeader.appendChild(caret);
    magicAccordion.appendChild(accordionHeader);

    const accordionContent = document.createElement('div');
    accordionContent.className = 'magic-accordion-content';

    accordionHeader.addEventListener('click', () => {
      state.magicNumberExpanded = !state.magicNumberExpanded;
      render();
    });

    const hasDivMagic = team.divisionMagicNumber !== undefined && team.divisionMagicNumber !== null;
    const hasWcMagic = team.wildCardMagicNumber !== undefined && team.wildCardMagicNumber !== null;

    if (state.magicNumberExpanded) {
      // Division magic number info
      const divText = document.createElement('div');
      divText.style.marginBottom = '12px';
      divText.style.fontSize = '13px';
      if (hasDivMagic) {
        const winsHalf = Math.ceil(team.divisionMagicNumber / 2);
        const lossesHalf = Math.floor(team.divisionMagicNumber / 2);
        divText.innerHTML = `
          <strong>Division Magic Number: <span style="color:var(--color-gold); font-size:16px;">${team.divisionMagicNumber}</span></strong><br/>
          Any combination of ${team.shortName} wins and ${team.divisionChallengerName || 'division rivals'} losses totaling ${team.divisionMagicNumber} clinches the division. <span style="color:var(--text-muted); font-size:11px;">(${gamesRemaining} games left)</span>
          <div style="margin-top: 6px; font-size: 11px; color: var(--text-secondary); background: rgba(255,255,255,0.03); border-radius: 4px; padding: 6px 8px; border-left: 3px solid var(--color-gold); line-height: 1.5;">
            <strong>To Clinch the Division, ${team.shortName} needs:</strong><br/>
            • <strong>${team.divisionMagicNumber} wins</strong> (with zero challenger losses)<br/>
            • <strong>${winsHalf} wins</strong> + <strong>${lossesHalf} ${team.divisionChallengerName || 'rival'} losses</strong><br/>
            • <strong>${team.divisionMagicNumber} losses</strong> by the ${team.divisionChallengerName || 'challenger'} (with zero wins)
          </div>
        `;
      } else if (team.divisionLeader) {
        divText.innerHTML = `<strong>Division Magic Number:</strong> No active magic number. You are leading the division. <span style="color:var(--text-muted); font-size:11px;">(${gamesRemaining} games left)</span>`;
      } else {
        divText.innerHTML = `
          <strong>Division Position:</strong> Trailing the division leader (<strong>${team.divisionLeaderName || 'Leader'}</strong>) by <strong>${team.gamesBack} games</strong>. <span style="color:var(--text-muted); font-size:11px;">(${gamesRemaining} games left)</span>
          <div style="margin-top: 6px; font-size: 11px; color: var(--text-secondary); background: rgba(255,255,255,0.03); border-radius: 4px; padding: 6px 8px; border-left: 3px solid var(--border-glass-highlight); line-height: 1.5;">
            <strong>To claim the Division Title:</strong><br/>
            • ${team.shortName} must win games AND have the ${team.divisionLeaderName || 'Leader'} lose games to make up the <strong>${team.gamesBack} games back</strong> deficit.
          </div>
        `;
      }
      accordionContent.appendChild(divText);

      // Wild Card magic number info
      const wcText = document.createElement('div');
      wcText.style.marginBottom = '12px';
      wcText.style.fontSize = '13px';
      if (hasWcMagic) {
        const winsHalf = Math.ceil(team.wildCardMagicNumber / 2);
        const lossesHalf = Math.floor(team.wildCardMagicNumber / 2);
        wcText.innerHTML = `
          <strong>Wild Card Magic Number: <span style="color:var(--color-gold); font-size:16px;">${team.wildCardMagicNumber}</span></strong><br/>
          Any combination of ${team.shortName} wins and the first-out team's (${team.wildCardChallengerName || 'challenger'}) losses totaling ${team.wildCardMagicNumber} clinches a Wild Card spot. <span style="color:var(--text-muted); font-size:11px;">(${gamesRemaining} games left)</span>
          <div style="margin-top: 6px; font-size: 11px; color: var(--text-secondary); background: rgba(255,255,255,0.03); border-radius: 4px; padding: 6px 8px; border-left: 3px solid var(--color-gold); line-height: 1.5;">
            <strong>To Clinch a Wild Card Spot, ${team.shortName} needs:</strong><br/>
            • <strong>${team.wildCardMagicNumber} wins</strong> (with zero challenger losses)<br/>
            • <strong>${winsHalf} wins</strong> + <strong>${lossesHalf} ${team.wildCardChallengerName || 'challenger'} losses</strong><br/>
            • <strong>${team.wildCardMagicNumber} losses</strong> by the ${team.wildCardChallengerName || 'challenger'} (with zero wins)
          </div>
        `;
      } else if (team.isWildCardSpot) {
        wcText.innerHTML = `<strong>Wild Card Position:</strong> Holding a Wild Card spot (+${Math.abs(team.wildCardGamesBack)} ahead of cutoff). <span style="color:var(--text-muted); font-size:11px;">(${gamesRemaining} games left)</span>`;
      } else {
        wcText.innerHTML = `
          <strong>Wild Card Position:</strong> Trailing the Wild Card cutoff (<strong>${team.wildCardCutoffName || 'Cutoff'}</strong>) by <strong>${team.wildCardGamesBack} games</strong>. <span style="color:var(--text-muted); font-size:11px;">(${gamesRemaining} games left)</span>
          <div style="margin-top: 6px; font-size: 11px; color: var(--text-secondary); background: rgba(255,255,255,0.03); border-radius: 4px; padding: 6px 8px; border-left: 3px solid var(--border-glass-highlight); line-height: 1.5;">
            <strong>To claim a Playoff Spot:</strong><br/>
            • ${team.shortName} must win games AND have the ${team.wildCardCutoffName || 'Cutoff'} lose games to make up the <strong>${team.wildCardGamesBack} games back</strong> deficit.
          </div>
        `;
      }
      accordionContent.appendChild(wcText);

      const explText = document.createElement('div');
      explText.className = 'magic-explain-text';
      explText.innerHTML = `
        <strong>What is a Magic Number?</strong><br/>
        In baseball, the magic number is the total number of wins by your team and/or losses by your closest challenger required to mathematically clinch a playoff position. It represents guaranteed advancement.
      `;
      accordionContent.appendChild(explText);
    }

    magicAccordion.appendChild(accordionContent);
    container.appendChild(magicAccordion);
  }

  // 3. Games That Matter Today (Rival matchups that impact standings)
  const rivalGamesThatMatter = analysis.filter(g =>
    g.priority > 0 &&
    g.awayTeam.id !== state.activeTeamId &&
    g.homeTeam.id !== state.activeTeamId
  );

  const sectionHeader = document.createElement('div');
  sectionHeader.style.display = 'flex';
  sectionHeader.style.justifyContent = 'space-between';
  sectionHeader.style.alignItems = 'center';
  sectionHeader.style.marginTop = '20px';
  sectionHeader.style.marginBottom = '12px';

  const sectionTitle = document.createElement('h3');
  sectionTitle.className = 'section-title';
  sectionTitle.innerText = 'Games That Matter Today';
  sectionTitle.style.marginBottom = '0';
  sectionHeader.appendChild(sectionTitle);

  container.appendChild(sectionHeader);

  if (rivalGamesThatMatter.length === 0) {
    const noGamesMsg = document.createElement('p');
    noGamesMsg.style.fontSize = '13px';
    noGamesMsg.style.color = 'var(--text-secondary)';
    noGamesMsg.style.textAlign = 'center';
    noGamesMsg.style.padding = '20px 0';
    noGamesMsg.innerText = 'No rival matchups directly impacting your standing today.';
    container.appendChild(noGamesMsg);
  } else {
    const sortedRivalGames = sortGames(rivalGamesThatMatter);
    sortedRivalGames.forEach(g => {
      container.appendChild(createGameCard(g, false));
    });
  }

  return container;
}

// Modal popup explaining MLB Run Differential metrics and the spark-bar chart
function showRunDiffHelpModal() {
  const backdrop = document.createElement('div');
  backdrop.className = 'recap-backdrop show';
  backdrop.style.zIndex = '100000';
  
  const modal = document.createElement('div');
  modal.className = 'glass-card';
  modal.style.cssText = 'width: 90%; max-width: 420px; background: var(--bg-card); border: 1px solid var(--border-glass-highlight); border-radius: 16px; padding: 22px; display: flex; flex-direction: column; gap: 16px; color: var(--text-primary); animation: slideUpDetails 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards; position: relative; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.3);';
  
  const closeBtn = document.createElement('button');
  closeBtn.innerText = '×';
  closeBtn.style.cssText = 'position: absolute; top: 12px; right: 16px; border: none; background: none; font-size: 26px; font-weight: 300; color: var(--text-secondary); cursor: pointer; padding: 4px; line-height: 1; outline: none;';
  closeBtn.addEventListener('click', () => backdrop.remove());
  modal.appendChild(closeBtn);

  const title = document.createElement('h3');
  title.innerText = '📊 Run Differential Guide';
  title.style.cssText = 'font-family: var(--font-title); font-size: 18px; margin: 0; padding-right: 24px; color: var(--color-gold); font-weight: 800;';
  modal.appendChild(title);

  const content = document.createElement('div');
  content.style.cssText = 'display: flex; flex-direction: column; gap: 14px; font-size: 13px; line-height: 1.55; color: var(--text-secondary);';
  content.innerHTML = `
    <div>
      <strong style="color: var(--text-primary); font-size: 13.5px; display: block; margin-bottom: 2px;">What is Run Differential?</strong>
      <p style="margin: 0;">Run differential is the difference between runs scored (RS) and runs allowed (RA). It is calculated as: <br><code style="display:inline-block; margin-top:4px; padding: 2px 6px; background: rgba(255,255,255,0.06); border-radius: 4px;">Runs Scored − Runs Allowed</code></p>
    </div>
    <div>
      <strong style="color: var(--text-primary); font-size: 13.5px; display: block; margin-bottom: 2px;">Reading the Spark-Bar Chart:</strong>
      <ul style="margin: 0; padding-left: 16px; display: flex; flex-direction: column; gap: 6px;">
        <li><span style="color: #34d399; font-weight: 700;">Green bars (upwards)</span> represent games won. Taller bars indicate blowout victories.</li>
        <li><span style="color: #f87171; font-weight: 700;">Red bars (downwards)</span> represent games lost. Longer bars indicate tough blowout defeats.</li>
        <li>Tap any bar to see that specific game's detailed summary, standings priority, and play-by-play visual analytics!</li>
      </ul>
    </div>
    <div>
      <strong style="color: var(--text-primary); font-size: 13.5px; display: block; margin-bottom: 2px;">Why does it matter?</strong>
      <p style="margin: 0;">In baseball analytics, run differential is a highly predictive metric. It shows a team's true skill by stripping away the luck of close one-run outcomes. Teams with positive differentials are structurally strong and likely to win consistently over a 162-game season.</p>
    </div>
  `;
  modal.appendChild(content);

  const okBtn = document.createElement('button');
  okBtn.innerText = 'Got it';
  okBtn.style.cssText = 'width: 100%; padding: 12px; font-size: 13px; font-weight: 700; color: #ffffff; background: var(--team-primary, #3b82f6); border: none; border-radius: 10px; cursor: pointer; transition: opacity 0.2s; outline: none; margin-top: 8px; font-family: var(--font-title);';
  okBtn.addEventListener('click', () => backdrop.remove());
  modal.appendChild(okBtn);

  backdrop.appendChild(modal);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) backdrop.remove();
  });
  document.body.appendChild(backdrop);
}

// Scores View (Dedicated scores panel in menu)
function createScoresView() {
  const container = document.createElement('div');
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.gap = '14px';

  const headerContainer = document.createElement('div');
  headerContainer.style.display = 'flex';
  headerContainer.style.justifyContent = 'space-between';
  headerContainer.style.alignItems = 'center';
  headerContainer.style.marginBottom = '6px';

  const scoresTitle = document.createElement('h3');
  scoresTitle.className = 'section-title';
  scoresTitle.innerText = `Scores for ${formatHumanDate(state.selectedDate)}`;
  scoresTitle.style.marginBottom = '0';
  headerContainer.appendChild(scoresTitle);

  const hasLiveGames = state.rawSchedule && state.rawSchedule.some(g => g.status.statusCode === 'I');
  if (hasLiveGames) {
    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'manual-refresh-btn';
    refreshBtn.innerHTML = '↻ Refresh Scores';
    refreshBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      refreshBtn.disabled = true;
      refreshBtn.innerHTML = '⚡ Refreshing...';
      refreshBtn.style.opacity = '0.7';
      await silentRefreshData();
      refreshBtn.disabled = false;
      refreshBtn.innerHTML = '↻ Refresh Scores';
      refreshBtn.style.opacity = '1';
    });
    headerContainer.appendChild(refreshBtn);
  }

  container.appendChild(headerContainer);

  const rawGames = state.rawSchedule || [];
  if (rawGames.length === 0) {
    container.appendChild(createEmptyState(`No games scheduled for ${formatHumanDate(state.selectedDate)}.`));
    return container;
  }

  const analyzedGames = analyzeMatchups(rawGames, state.processedStandings, state.activeTeamId);
  const sortedGames = sortGames(analyzedGames);

  const gamesListContainer = document.createElement('div');
  gamesListContainer.style.display = 'flex';
  gamesListContainer.style.flexDirection = 'column';
  gamesListContainer.style.gap = '12px';

  sortedGames.forEach(g => {
    gamesListContainer.appendChild(createGameCard(g, false));
  });

  container.appendChild(gamesListContainer);
  return container;
}

// Standings View
// Helper to filter wildcard race graph teams cleanly
function getWildCardRaceTeams(leagueId, activeTeam, processedStandings) {
  const allLeague = processedStandings?.leagueTeams?.[leagueId] || [];
  const wcPool = allLeague.filter(t => !t.divisionLeader).sort((a, b) => a.wildCardRank - b.wildCardRank);
  
  const selectedWCTeams = [];
  const activeIdx = wcPool.findIndex(t => t.id === activeTeam.id);
  
  if (activeIdx >= 0) {
    for (let i = 0; i < Math.min(3, wcPool.length); i++) {
      selectedWCTeams.push(wcPool[i]);
    }
    selectedWCTeams.push(wcPool[activeIdx]);
    if (activeIdx + 1 < wcPool.length) {
      selectedWCTeams.push(wcPool[activeIdx + 1]);
    }
    wcPool.forEach(t => {
      if (t.wildCardGamesBack === wcPool[activeIdx].wildCardGamesBack) {
        selectedWCTeams.push(t);
      }
    });
  } else {
    for (let i = 0; i < Math.min(5, wcPool.length); i++) {
      selectedWCTeams.push(wcPool[i]);
    }
  }
  return { wcPool, selectedWCTeams };
}

// Modal popup showing stand-alone SVG trend graphs, styled to match the app's modal templates
function showStandingsGraphModal(title, chartNode) {
  const backdrop = document.createElement('div');
  backdrop.className = 'recap-backdrop';
  backdrop.style.zIndex = '100000';
  
  const modal = document.createElement('div');
  modal.className = 'recap-content';
  
  // Header Row
  const headerRow = document.createElement('div');
  headerRow.className = 'recap-header';
  
  const modalTitle = document.createElement('h3');
  modalTitle.style.cssText = 'font-size: 16px; font-weight: 800; color: #0f172a; margin: 0; font-family: var(--font-title);';
  modalTitle.innerText = title;
  headerRow.appendChild(modalTitle);
  
  const closeBtn = document.createElement('button');
  closeBtn.className = 'recap-close-btn';
  closeBtn.innerHTML = '×';
  closeBtn.addEventListener('click', () => {
    backdrop.classList.remove('show');
    setTimeout(() => backdrop.remove(), 300);
  });
  headerRow.appendChild(closeBtn);
  modal.appendChild(headerRow);
  
  // Body Container
  const bodyContainer = document.createElement('div');
  bodyContainer.style.cssText = 'padding: 20px; display: flex; flex-direction: column; gap: 16px; align-items: center;';
  
  const chartWrapper = document.createElement('div');
  chartWrapper.style.cssText = 'background: rgba(15, 23, 42, 0.03); border: 1px solid rgba(15, 23, 42, 0.08); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%;';
  chartWrapper.appendChild(chartNode);
  bodyContainer.appendChild(chartWrapper);
  
  const desc = document.createElement('p');
  desc.style.cssText = 'font-size: 12px; color: #64748b; line-height: 1.5; text-align: center; margin: 0; font-family: var(--font-body); font-weight: 500;';
  desc.innerText = 'Trend graph shows relative games above or below .500 (Wins - Losses surplus) over the last 10 games.';
  bodyContainer.appendChild(desc);
  
  modal.appendChild(bodyContainer);
  backdrop.appendChild(modal);
  
  document.body.appendChild(backdrop);
  
  // Trigger transition
  setTimeout(() => {
    backdrop.classList.add('show');
  }, 10);
}

// Standings View
function createStandingsView() {
  const container = document.createElement('div');
  container.className = 'setup-container';
  container.style.cssText = 'display: flex; flex-direction: column; gap: 20px;';

  const favTeam = state.processedStandings?.teamsMap?.[state.activeTeamId] || teamsData[state.activeTeamId];
  if (!favTeam) return container;

  // Initialize league filter state to favor active team's league
  if (!state.standingsLeagueId) {
    state.standingsLeagueId = favTeam.leagueId;
  }

  // 1. League Selection Tabs
  const tabContainer = document.createElement('div');
  tabContainer.className = 'standings-tab-container';
  tabContainer.style.cssText = 'display: flex; gap: 8px; margin-bottom: 4px; background: rgba(255,255,255,0.06); padding: 4px; border-radius: 10px; border: 1px solid var(--border-glass-highlight);';

  const leagues = [
    { id: 103, name: 'American League (AL)' },
    { id: 104, name: 'National League (NL)' }
  ];

  leagues.forEach(league => {
    const tab = document.createElement('button');
    const isActive = state.standingsLeagueId === league.id;
    tab.innerText = league.name;
    tab.style.cssText = `flex: 1; padding: 10px; border: none; border-radius: 8px; font-size: 13px; font-weight: 700; cursor: pointer; transition: all 0.2s ease; font-family: var(--font-title); text-align: center; outline: none; background: ${isActive ? 'var(--text-primary)' : 'transparent'}; color: ${isActive ? 'var(--bg-dark)' : 'var(--text-secondary)'};`;
    
    tab.addEventListener('click', () => {
      if (state.standingsLeagueId !== league.id) {
        state.standingsLeagueId = league.id;
        render();
      }
    });
    tabContainer.appendChild(tab);
  });
  container.appendChild(tabContainer);

  const leagueId = state.standingsLeagueId;
  const leagueName = leagueId === 103 ? 'AL' : 'NL';

  // 2. Render all division tables in the selected league
  const divisionIds = leagueId === 103 ? [201, 202, 200] : [204, 205, 203];

  divisionIds.forEach(divId => {
    const divTeams = state.processedStandings?.divisionTeams?.[divId] || [];
    if (divTeams.length === 0) return;

    const divName = divTeams[0].divisionName;
    const divTitle = document.createElement('h3');
    divTitle.className = 'section-title';
    divTitle.innerText = `${divName} Standings`;
    divTitle.style.cssText = 'margin-bottom: 2px; font-size: 16px; color: var(--text-primary);';
    container.appendChild(divTitle);

    const divCard = document.createElement('div');
    divCard.className = 'glass-card';
    divCard.style.padding = '12px';

    const divTable = document.createElement('table');
    divTable.className = 'standings-table';
    divTable.innerHTML = `
      <thead>
        <tr>
          <th>Team</th>
          <th>W</th>
          <th>L</th>
          <th>Pct</th>
          <th>GB</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;
    const divBody = divTable.querySelector('tbody');
    
    divTeams.forEach(team => {
      const tr = document.createElement('tr');
      if (team.id === state.activeTeamId) tr.className = 'highlight';
      
      tr.innerHTML = `
        <td>
          <div class="standings-team-cell">
            <div class="team-badge-small" style="background:${team.primaryColor}; color:${team.textColor}; font-size:9px;">${team.abbreviation}</div>
            <span>${team.name}</span>
          </div>
        </td>
        <td>${team.wins}</td>
        <td>${team.losses}</td>
        <td>${team.pct}</td>
        <td>${team.gamesBack === 0 ? '-' : team.gamesBack}</td>
      `;
      divBody.appendChild(tr);
    });
    divCard.appendChild(divTable);

    // Open division graph button
    const openGraphBtn = document.createElement('button');
    openGraphBtn.style.cssText = 'width: 100%; margin-top: 12px; padding: 10px; font-size: 12.5px; font-weight: 700; border-radius: 8px; cursor: pointer; font-family: var(--font-title); display: flex; align-items: center; justify-content: center; gap: 8px; transition: all 0.2s ease; border: 1px solid var(--border-glass-highlight); background: var(--bg-card-hover); color: var(--text-primary); outline: none;';
    openGraphBtn.innerHTML = '📊 Open Division Graph';
    openGraphBtn.addEventListener('click', () => {
      const chartNode = createMultiTeamRaceChart(favTeam, divTeams);
      showStandingsGraphModal(`${divName} Race Trend`, chartNode);
    });
    divCard.appendChild(openGraphBtn);

    container.appendChild(divCard);
  });

  // 3. Render Wild Card Standings for selected league
  const wcTitle = document.createElement('h3');
  wcTitle.className = 'section-title';
  wcTitle.innerText = `${leagueName} Wild Card Race`;
  wcTitle.style.cssText = 'margin-bottom: 2px; font-size: 16px; color: var(--text-primary);';
  container.appendChild(wcTitle);

  const wcCard = document.createElement('div');
  wcCard.className = 'glass-card';
  wcCard.style.padding = '12px';

  const wcTable = document.createElement('table');
  wcTable.className = 'standings-table';
  wcTable.innerHTML = `
    <thead>
      <tr>
        <th>Team</th>
        <th>W</th>
        <th>L</th>
        <th>Pct</th>
        <th>WC GB</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const wcBody = wcTable.querySelector('tbody');

  const { wcPool, selectedWCTeams } = getWildCardRaceTeams(leagueId, favTeam, state.processedStandings);

  wcPool.forEach(team => {
    const tr = document.createElement('tr');
    if (team.id === state.activeTeamId) tr.className = 'highlight';

    let gbText = '-';
    if (team.wildCardGamesBack < 0) {
      gbText = `+${Math.abs(team.wildCardGamesBack)}`;
    } else if (team.wildCardGamesBack > 0) {
      gbText = `${team.wildCardGamesBack}`;
    }

    const rowStyle = team.isWildCardSpot ? 'font-style: italic; border-left: 2px solid var(--color-win);' : '';
    tr.style.cssText = rowStyle;

    tr.innerHTML = `
      <td>
        <div class="standings-team-cell">
          <div class="team-badge-small" style="background:${team.primaryColor}; color:${team.textColor}; font-size:9px;">${team.abbreviation}</div>
          <span>${team.name}</span>
        </div>
      </td>
      <td>${team.wins}</td>
      <td>${team.losses}</td>
      <td>${team.pct}</td>
      <td>${gbText}</td>
    `;
    wcBody.appendChild(tr);
  });
  wcCard.appendChild(wcTable);

  // Open wildcard graph button
  const openWCGraphBtn = document.createElement('button');
  openWCGraphBtn.style.cssText = 'width: 100%; margin-top: 12px; padding: 10px; font-size: 12.5px; font-weight: 700; border-radius: 8px; cursor: pointer; font-family: var(--font-title); display: flex; align-items: center; justify-content: center; gap: 8px; transition: all 0.2s ease; border: 1px solid var(--border-glass-highlight); background: var(--bg-card-hover); color: var(--text-primary); outline: none;';
  openWCGraphBtn.innerHTML = '📊 Open Wild Card Graph';
  openWCGraphBtn.addEventListener('click', () => {
    const chartNode = createMultiTeamRaceChart(favTeam, selectedWCTeams);
    showStandingsGraphModal(`${leagueName} Wild Card Race Trend`, chartNode);
  });
  wcCard.appendChild(openWCGraphBtn);

  container.appendChild(wcCard);

  return container;
}

// Team Selection View (Settings sub-page)
function createTeamSelectView() {
  const container = document.createElement('div');
  container.className = 'setup-container';

  // Back Header Row
  const backHeader = document.createElement('div');
  backHeader.style.display = 'flex';
  backHeader.style.alignItems = 'center';
  backHeader.style.gap = '12px';
  backHeader.style.marginBottom = '20px';

  const title = document.createElement('h2');
  title.className = 'setup-title';
  title.innerText = 'Configure Teams';
  title.style.margin = '0';

  backHeader.appendChild(title);
  container.appendChild(backHeader);

  const desc = document.createElement('p');
  desc.className = 'setup-desc';
  desc.innerText = 'Select up to 3 favorite teams to track. Tap a team to select or deselect it.';
  desc.style.marginBottom = '20px';
  container.appendChild(desc);

  // Section 1: Tracked Teams
  const teamsSection = document.createElement('div');
  teamsSection.className = 'settings-section';

  const searchBox = document.createElement('div');
  searchBox.className = 'search-container';
  searchBox.style.marginBottom = '12px';
  const searchInput = document.createElement('input');
  searchInput.className = 'search-input';
  searchInput.placeholder = 'Search team name...';
  searchInput.value = state.searchQuery;
  searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    filterTeamsList();
  });
  searchBox.appendChild(searchInput);
  teamsSection.appendChild(searchBox);

  const listGrid = document.createElement('div');
  listGrid.className = 'team-list-grid';
  listGrid.id = 'team-select-list';
  teamsSection.appendChild(listGrid);

  container.appendChild(teamsSection);

  // Helper to populate grid
  setTimeout(() => filterTeamsList(), 0);

  // Large full-width back button at the bottom for easier touch target finger presses
  const backBtn = document.createElement('button');
  backBtn.style.cssText = 'width: 100%; margin-top: 24px; padding: 14px 16px; font-size: 14.5px; font-weight: 700; color: var(--text-primary); background: var(--bg-card-hover); border: 1px solid var(--border-glass-highlight); border-radius: 12px; cursor: pointer; font-family: var(--font-title); display: flex; align-items: center; justify-content: center; transition: all 0.2s ease; box-shadow: var(--shadow-sm);';
  backBtn.innerHTML = '← Back';
  backBtn.addEventListener('click', () => {
    state.activeView = state.previousMainView || 'dashboard';
    render();
  });
  container.appendChild(backBtn);

  return container;
}

// Credits & Info View (Settings sub-page)
function createCreditsVersionView() {
  const container = document.createElement('div');
  container.className = 'setup-container';

  // Back Header Row
  const backHeader = document.createElement('div');
  backHeader.style.display = 'flex';
  backHeader.style.alignItems = 'center';
  backHeader.style.gap = '12px';
  backHeader.style.marginBottom = '20px';

  const title = document.createElement('h2');
  title.className = 'setup-title';
  title.innerText = 'Credits & Info';
  title.style.margin = '0';

  backHeader.appendChild(title);
  container.appendChild(backHeader);

  // Credits info card
  const creditsCard = document.createElement('div');
  creditsCard.className = 'glass-card';
  creditsCard.style.padding = '20px';
  creditsCard.style.display = 'flex';
  creditsCard.style.flexDirection = 'column';
  creditsCard.style.gap = '14px';

  const creditsTitle = document.createElement('h3');
  creditsTitle.innerText = 'Data Source';
  creditsTitle.style.fontFamily = 'var(--font-title)';
  creditsTitle.style.fontSize = '16px';
  creditsTitle.style.margin = '0';
  creditsCard.appendChild(creditsTitle);

  const creditsText = document.createElement('p');
  creditsText.style.fontSize = '13px';
  creditsText.style.color = 'var(--text-secondary)';
  creditsText.style.lineHeight = '1.6';
  creditsText.innerHTML = 'All schedules, standings, division/wildcard structures, and game statuses are fetched dynamically from the official <strong>MLB Stats API</strong>.';
  creditsCard.appendChild(creditsText);

  const visualCreditTitle = document.createElement('h3');
  visualCreditTitle.innerText = 'Visualization Inspiration';
  visualCreditTitle.style.fontFamily = 'var(--font-title)';
  visualCreditTitle.style.fontSize = '16px';
  visualCreditTitle.style.margin = '0';
  creditsCard.appendChild(visualCreditTitle);

  const visualCreditText = document.createElement('p');
  visualCreditText.style.fontSize = '13px';
  visualCreditText.style.color = 'var(--text-secondary)';
  visualCreditText.style.lineHeight = '1.6';
  visualCreditText.innerHTML = 'The division and wildcard race trend line graphs are inspired by <strong>Greg Stoll\'s MLB Division Race Charts</strong>. Check out his interactive project at <a href="https://gregstoll.com/baseball/stats/divisionrace/" target="_blank" style="color:var(--color-win); text-decoration:underline; font-weight:600;">gregstoll.com/baseball/stats/divisionrace/</a>.';
  creditsCard.appendChild(visualCreditText);

  const appMetaTitle = document.createElement('h3');
  appMetaTitle.innerText = 'App Version';
  appMetaTitle.style.fontFamily = 'var(--font-title)';
  appMetaTitle.style.fontSize = '16px';
  appMetaTitle.style.margin = '0';
  creditsCard.appendChild(appMetaTitle);

  const appMetaText = document.createElement('p');
  appMetaText.style.fontSize = '13px';
  appMetaText.style.color = 'var(--text-secondary)';
  appMetaText.style.lineHeight = '1.6';
  appMetaText.innerHTML = '<strong>Trajectory Web App</strong><br>Version: v1.3.0<br>Build: Production Build<br>Designed for MLB Fans and playoff rooting priority tracking.';
  creditsCard.appendChild(appMetaText);

  container.appendChild(creditsCard);

  // Large full-width back button at the bottom for easier touch target finger presses
  const backBtn = document.createElement('button');
  backBtn.style.cssText = 'width: 100%; margin-top: 24px; padding: 14px 16px; font-size: 14.5px; font-weight: 700; color: var(--text-primary); background: var(--bg-card-hover); border: 1px solid var(--border-glass-highlight); border-radius: 12px; cursor: pointer; font-family: var(--font-title); display: flex; align-items: center; justify-content: center; transition: all 0.2s ease; box-shadow: var(--shadow-sm);';
  backBtn.innerHTML = '← Back';
  backBtn.addEventListener('click', () => {
    state.activeView = state.previousMainView || 'dashboard';
    render();
  });
  container.appendChild(backBtn);

  return container;
}

function filterTeamsList() {
  const grid = document.querySelector('#team-select-list');
  if (!grid) return;

  grid.innerHTML = '';
  
  const query = state.searchQuery.toLowerCase();
  const sortedTeams = Object.values(teamsData).sort((a, b) => {
    const aSelected = state.selectedTeamIds.includes(a.id);
    const bSelected = state.selectedTeamIds.includes(b.id);
    if (aSelected && !bSelected) return -1;
    if (!aSelected && bSelected) return 1;
    return a.name.localeCompare(b.name);
  });

  sortedTeams.forEach(team => {
    if (query && !team.name.toLowerCase().includes(query)) return;

    const isSelected = state.selectedTeamIds.includes(team.id);

    const item = document.createElement('div');
    item.className = `team-select-item ${isSelected ? 'selected' : ''}`;
    if (isSelected) {
      item.style.setProperty('--team-primary', team.primaryColor);
    }

    const info = document.createElement('div');
    info.className = 'standings-team-cell';
    const badge = document.createElement('div');
    badge.className = 'team-badge-small';
    badge.innerText = team.abbreviation;
    badge.style.background = team.primaryColor;
    badge.style.color = team.textColor;

    const name = document.createElement('span');
    name.innerText = team.name;
    name.style.fontSize = '14px';
    name.style.fontWeight = isSelected ? '700' : '500';

    info.appendChild(badge);
    info.appendChild(name);

    const check = document.createElement('div');
    check.className = 'select-checkbox';
    check.innerText = isSelected ? '✓' : '';
    if (isSelected) {
      check.style.background = team.primaryColor;
      check.style.borderColor = team.primaryColor;
    }

    item.appendChild(info);
    item.appendChild(check);

    item.addEventListener('click', () => {
      if (isSelected) {
        // Deselect (but keep at least 1 team)
        if (state.selectedTeamIds.length > 1) {
          state.selectedTeamIds = state.selectedTeamIds.filter(id => id !== team.id);
          // If we removed the active team, switch to another one
          if (state.activeTeamId === team.id) {
            state.activeTeamId = state.selectedTeamIds[0];
            updateTeamTheme(state.activeTeamId);
          }
        } else {
          alert('You must track at least one team!');
          return;
        }
      } else {
        // Select (max 3)
        if (state.selectedTeamIds.length >= 3) {
          alert('You can track a maximum of 3 teams!');
          return;
        }
        state.selectedTeamIds.push(team.id);
        // Automatically make it the active team
        state.activeTeamId = team.id;
        updateTeamTheme(team.id);
      }

      // Save choices
      localStorage.setItem('tracked_teams', JSON.stringify(state.selectedTeamIds));
      render();
    });

    grid.appendChild(item);
  });
}

// Empty State Component
function createEmptyState(message) {
  const div = document.createElement('div');
  div.className = 'empty-state';
  
  const icon = document.createElement('div');
  icon.className = 'empty-icon';
  icon.innerText = '⚾';

  const txt = document.createElement('p');
  txt.innerText = message;

  div.appendChild(icon);
  div.appendChild(txt);
  return div;
}

// Navigate between team dashboards and standings using swipe actions
function navigateToTab(direction) {
  // Build a list of valid switcher view targets
  const viewsList = [];
  state.selectedTeamIds.forEach(id => {
    viewsList.push({ view: 'dashboard', teamId: id });
  });
  viewsList.push({ view: 'standings' });

  // Resolve current active view index
  let currentIndex = -1;
  if (state.activeView === 'standings') {
    currentIndex = viewsList.length - 1;
  } else if (state.activeView === 'dashboard') {
    currentIndex = viewsList.findIndex(item => item.view === 'dashboard' && item.teamId === state.activeTeamId);
  }

  // Swipe only functional on main switcher pages (dashboard & standings)
  if (currentIndex === -1) return;

  let nextIndex = currentIndex;
  if (direction === 'left') {
    // Swipe left (drags right-to-left) -> go to next view
    if (currentIndex < viewsList.length - 1) {
      nextIndex = currentIndex + 1;
    }
  } else if (direction === 'right') {
    // Swipe right (drags left-to-right) -> go to previous view
    if (currentIndex > 0) {
      nextIndex = currentIndex - 1;
    }
  }

  if (nextIndex !== currentIndex) {
    const target = viewsList[nextIndex];
    transitionToView(target.view, target.teamId || null);
  }
}

// Bind swipe gesture event listeners globally
let touchStartX = 0;
let touchStartY = 0;

document.addEventListener('touchstart', (e) => {
  // Ignore swipe triggers on active charts, maps, inputs, modal drawer backdrop or modals
  if (e.target.closest('.banner-chart-container') || 
      e.target.closest('.division-chart-container') || 
      e.target.closest('.date-selector') || 
      e.target.closest('.recap-content') ||
      e.target.closest('.drawer-content') ||
      e.target.closest('.team-list-grid') ||
      e.target.closest('.analytics-center-backdrop')) {
    return;
  }
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}, { passive: true });

document.addEventListener('touchend', (e) => {
  if (!touchStartX) return;

  const touchEndX = e.changedTouches[0].clientX;
  const touchEndY = e.changedTouches[0].clientY;

  const diffX = touchEndX - touchStartX;
  const diffY = touchEndY - touchStartY;

  // Ignore primarily vertical scrolls (vertical swipe larger than horizontal)
  if (Math.abs(diffY) > Math.abs(diffX)) {
    touchStartX = 0;
    return;
  }

  const threshold = 60; // minimum horizontal swipe pixels
  if (Math.abs(diffX) > threshold) {
    if (diffX > 0) {
      navigateToTab('right');
    } else {
      navigateToTab('left');
    }
  }

  touchStartX = 0;
}, { passive: true });

// --- HOME RUN CHASE SECTION ---

// Fetch schedule and parallel boxscores to count HRs for a given date
async function getDailyHRStats(dateStr) {
  const cacheKey = `hr_count_v1_${dateStr}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (parsed.isFinal) {
        return parsed;
      }
    } catch (e) {
      console.warn("Error parsing cached daily HRs:", e);
    }
  }

  try {
    const res = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${dateStr}&endDate=${dateStr}`);
    if (!res.ok) throw new Error('API failed');
    const data = await res.json();
    
    let games = [];
    if (data.dates && data.dates[0] && data.dates[0].games) {
      games = data.dates[0].games;
    }
    
    if (games.length === 0) {
      const mockHRCount = dateStr === getBaseballDate(-1) ? 22 : 14;
      const mockResult = { count: mockHRCount, remainingGames: 0, isFinal: true };
      localStorage.setItem(cacheKey, JSON.stringify(mockResult));
      return mockResult;
    }
    
    const activeGames = games.filter(g => {
      const state = g.status?.statusCode;
      return state !== 'DI' && state !== 'DR' && state !== 'P';
    });
    
    let totalHRs = 0;
    let remainingGames = 0;
    
    const boxscorePromises = activeGames.map(async (game) => {
      const statusCode = game.status?.statusCode;
      const isCompleted = statusCode === 'F' || statusCode === 'O' || statusCode === 'FT' || statusCode === 'W';
      
      if (statusCode === 'S' || statusCode === 'P' || statusCode === 'I') {
        remainingGames++;
        return;
      }
      
      try {
        const boxRes = await fetch(`https://statsapi.mlb.com/api/v1/game/${game.gamePk}/boxscore`);
        if (!boxRes.ok) return;
        const boxData = await boxRes.json();
        const hr = (boxData.teams?.away?.teamStats?.batting?.homeRuns || 0) + 
                   (boxData.teams?.home?.teamStats?.batting?.homeRuns || 0);
        totalHRs += hr;
        
        if (!isCompleted) {
          remainingGames++;
        }
      } catch (err) {
        console.warn(`Error fetching boxscore for game ${game.gamePk}:`, err);
        if (!isCompleted) remainingGames++;
      }
    });
    
    await Promise.all(boxscorePromises);
    
    const isFinal = remainingGames === 0;
    const result = { count: totalHRs, remainingGames, isFinal };
    
    localStorage.setItem(cacheKey, JSON.stringify(result));
    return result;
  } catch (err) {
    console.error(`Error loading daily HR stats for ${dateStr}:`, err);
    const mockHRCount = dateStr === getBaseballDate(-1) ? 22 : 14;
    return { count: mockHRCount, remainingGames: 0, isFinal: true };
  }
}

// Global today player HR map
let todayPlayerHRsMap = {};

// Load player HR counts hit today
async function loadTodayPlayerHRs() {
  const todayDate = getBaseballDate(0);
  try {
    const res = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${todayDate}&endDate=${todayDate}`);
    if (!res.ok) return {};
    const data = await res.json();
    const games = data.dates?.[0]?.games || [];
    
    const activeGames = games.filter(g => {
      const state = g.status?.statusCode;
      return state !== 'DI' && state !== 'DR' && state !== 'P';
    });
    
    const hrMap = {};
    
    await Promise.all(activeGames.map(async (game) => {
      const statusCode = game.status?.statusCode;
      if (statusCode === 'S' || statusCode === 'P' || statusCode === 'I') return;
      
      try {
        const boxRes = await fetch(`https://statsapi.mlb.com/api/v1/game/${game.gamePk}/boxscore`);
        if (!boxRes.ok) return;
        const boxData = await boxRes.json();
        
        const processTeam = (teamData) => {
          if (!teamData?.players) return;
          for (const key in teamData.players) {
            const p = teamData.players[key];
            const pId = p.person?.id;
            const hr = p.stats?.batting?.homeRuns || 0;
            if (pId && hr > 0) {
              hrMap[pId] = (hrMap[pId] || 0) + hr;
            }
          }
        };
        
        processTeam(boxData.teams?.away);
        processTeam(boxData.teams?.home);
      } catch (err) {
        console.warn("Failed loading boxscore for player HR map:", err);
      }
    }));
    
    todayPlayerHRsMap = hrMap;
    return hrMap;
  } catch (err) {
    console.error("Failed loading today player HRs:", err);
    return {};
  }
}

// Render top 20 MLB leaders as a visual horizontal bar graph with season record chase
function renderMLBLeadersGraph(leaders, card, spinner) {
  if (spinner) spinner.remove();

  const existingGraph = card.querySelector('.hr-leaders-graph-container');
  if (existingGraph) existingGraph.remove();

  const graphContainer = document.createElement('div');
  graphContainer.className = 'hr-leaders-graph-container';
  graphContainer.style.cssText = 'display: flex; flex-direction: column; gap: 12px; width: 100%;';

  const maxScaleHR = 83; // Bonds 73 + 10 room

  // Prepend Barry Bonds Single Season Record at the top
  const recordRow = document.createElement('div');
  recordRow.style.cssText = 'display: flex; align-items: center; width: 100%; gap: 12px; padding-bottom: 8px; border-bottom: 1.5px dashed var(--border-glass);';
  
  const recordLabelCol = document.createElement('div');
  recordLabelCol.style.cssText = 'width: 110px; display: flex; flex-direction: column; text-align: left; flex-shrink: 0;';
  
  const recordName = document.createElement('span');
  recordName.style.cssText = 'font-size: 12px; font-weight: 800; color: var(--color-gold); font-family: var(--font-title); display: flex; align-items: center; gap: 4px;';
  recordName.innerHTML = `👑 Barry Bonds`;
  
  const recordSub = document.createElement('span');
  recordSub.style.cssText = 'font-size: 9px; color: var(--text-muted); font-weight: 700;';
  recordSub.innerText = 'RECORD (2001)';
  
  recordLabelCol.appendChild(recordName);
  recordLabelCol.appendChild(recordSub);
  recordRow.appendChild(recordLabelCol);

  const recordBarCol = document.createElement('div');
  recordBarCol.style.cssText = 'flex: 1; display: flex; align-items: center; gap: 8px;';
  
  const recordBarOuter = document.createElement('div');
  recordBarOuter.style.cssText = 'flex: 1; height: 16px; background: rgba(217, 119, 6, 0.08); border-radius: 8px; overflow: hidden; border: 1.5px solid var(--color-gold); position: relative;';
  
  const recordBarInner = document.createElement('div');
  const recordWidth = (73 / maxScaleHR) * 100;
  recordBarInner.style.cssText = `height: 100%; width: ${recordWidth}%; background: linear-gradient(90deg, #b45309, #d97706, #f59e0b); border-radius: 6px; box-shadow: 0 0 10px rgba(245, 158, 11, 0.4);`;
  
  recordBarOuter.appendChild(recordBarInner);
  recordBarCol.appendChild(recordBarOuter);
  
  const recordValue = document.createElement('span');
  recordValue.style.cssText = 'font-size: 13px; font-weight: 800; color: var(--color-gold); width: 22px; text-align: right; font-family: var(--font-title);';
  recordValue.innerText = '73';
  recordBarCol.appendChild(recordValue);
  
  recordRow.appendChild(recordBarCol);
  graphContainer.appendChild(recordRow);

  // Animation Action Button Header
  const btnContainer = document.createElement('div');
  btnContainer.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; margin-top: 4px;';
  
  const btnTitle = document.createElement('span');
  btnTitle.style.cssText = 'font-size: 11px; font-weight: 800; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px;';
  btnTitle.innerText = 'Challengers List';
  btnContainer.appendChild(btnTitle);

  const animBtn = document.createElement('button');
  animBtn.className = 'action-btn';
  animBtn.style.cssText = 'padding: 6px 12px; font-size: 11px; font-weight: 800; border-radius: 20px; text-transform: none; display: flex; align-items: center; gap: 6px; transition: all 0.3s; background: rgba(255, 90, 0, 0.1); border: 1px solid rgba(255, 90, 0, 0.35); color: #ff5a00; cursor: pointer;';
  animBtn.innerHTML = `🔥 Show Yesterday to Today`;
  btnContainer.appendChild(animBtn);
  
  graphContainer.appendChild(btnContainer);

  // Find the first AL player and first NL player to tag them as leaders
  let alLeaderId = null;
  let nlLeaderId = null;
  for (const leader of leaders) {
    const teamId = leader.team?.id;
    const staticTeam = teamsData[teamId] || {};
    const leagueId = leader.league?.id || staticTeam.leagueId;
    if (leagueId === 103 && !alLeaderId) {
      alLeaderId = leader.person?.id;
    } else if (leagueId === 104 && !nlLeaderId) {
      nlLeaderId = leader.person?.id;
    }
    if (alLeaderId && nlLeaderId) break;
  }

  // Render player rows
  const animRows = [];

  leaders.forEach((leader, idx) => {
    const pId = leader.person?.id;
    let todayHRs = 0;
    if (Object.keys(todayPlayerHRsMap).length > 0) {
      todayHRs = todayPlayerHRsMap[pId] || 0;
    } else {
      todayHRs = MOCK_TODAY_PLAYER_HRS[pId] || 0;
    }
    
    const totalHR = parseInt(leader.value, 10);
    const yesterdayHR = totalHR - todayHRs;
    
    const teamId = leader.team?.id;
    const staticTeam = teamsData[teamId] || {};
    const teamColor = staticTeam.primaryColor || '#94a3b8';

    const row = document.createElement('div');
    row.style.cssText = 'display: flex; align-items: center; width: 100%; gap: 12px;';

    const labelCol = document.createElement('div');
    labelCol.style.cssText = 'width: 110px; display: flex; flex-direction: column; text-align: left; flex-shrink: 0;';
    
    const nameSpan = document.createElement('span');
    nameSpan.style.cssText = 'font-size: 12px; font-weight: 700; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: var(--font-main);';
    nameSpan.innerText = leader.person?.fullName || 'Player';
    
    const teamSpan = document.createElement('span');
    teamSpan.style.cssText = 'font-size: 9.5px; color: var(--text-muted); font-weight: 600; text-transform: uppercase; display: flex; align-items: center; gap: 6px;';
    teamSpan.innerText = `${idx + 1}. ${staticTeam.abbreviation || leader.team?.name || 'MLB'}`;

    if (pId === alLeaderId) {
      const tag = document.createElement('span');
      tag.style.cssText = 'font-size: 8px; font-weight: 800; padding: 0.5px 4px; border-radius: 3px; background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.35); font-family: var(--font-title); line-height: 1;';
      tag.innerText = 'AL LEADER';
      teamSpan.appendChild(tag);
    } else if (pId === nlLeaderId) {
      const tag = document.createElement('span');
      tag.style.cssText = 'font-size: 8px; font-weight: 800; padding: 0.5px 4px; border-radius: 3px; background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.35); font-family: var(--font-title); line-height: 1;';
      tag.innerText = 'NL LEADER';
      teamSpan.appendChild(tag);
    }

    labelCol.appendChild(nameSpan);
    labelCol.appendChild(teamSpan);
    row.appendChild(labelCol);

    const barCol = document.createElement('div');
    barCol.style.cssText = 'flex: 1; display: flex; align-items: center; gap: 8px; position: relative;';

    const barOuter = document.createElement('div');
    barOuter.style.cssText = 'flex: 1; height: 16px; background: rgba(255,255,255,0.06); border-radius: 8px; overflow: hidden; border: 1px solid var(--border-glass); display: flex; transition: all 0.3s;';

    // Base segment (Yesterday)
    const baseBar = document.createElement('div');
    const baseWidth = (yesterdayHR / maxScaleHR) * 100;
    baseBar.style.cssText = `height: 100%; width: 0%; background: ${teamColor}; border-radius: 6px 0 0 6px; transition: width 0.8s cubic-bezier(0.16, 1, 0.3, 1);`;
    barOuter.appendChild(baseBar);

    // Today's added segment
    const todayBar = document.createElement('div');
    const todayAddedWidth = (todayHRs / maxScaleHR) * 100;
    todayBar.style.cssText = `height: 100%; width: 0%; background: #ff5a00; border-radius: 0 6px 6px 0; transition: width 6.0s cubic-bezier(0.16, 1, 0.3, 1), background-color 2.0s ease; box-shadow: 0 0 8px rgba(255, 90, 0, 0.4);`;
    barOuter.appendChild(todayBar);

    barCol.appendChild(barOuter);

    const valueSpan = document.createElement('span');
    valueSpan.style.cssText = 'font-size: 13px; font-weight: 800; color: var(--text-primary); width: 22px; text-align: right; font-family: var(--font-title);';
    valueSpan.innerText = yesterdayHR;
    barCol.appendChild(valueSpan);

    row.appendChild(barCol);
    graphContainer.appendChild(row);

    setTimeout(() => {
      baseBar.style.width = `${baseWidth}%`;
    }, 50);

    animRows.push({
      todayBar,
      todayAddedWidth,
      valueSpan,
      yesterdayHR,
      totalHR,
      teamColor,
      hasChange: todayHRs > 0,
      todayHRs,
      baseWidth,
      barOuter,
      barCol,
      bubbleInterval: null
    });
  });

  let isAnimated = false;

  animBtn.addEventListener('click', () => {
    if (isAnimated) {
      // Reset state transition-less
      animRows.forEach(row => {
        if (row.hasChange) {
          // Clear any active bubble intervals
          if (row.bubbleInterval) {
            clearInterval(row.bubbleInterval);
            row.bubbleInterval = null;
          }
          
          row.todayBar.style.transition = 'none';
          row.todayBar.style.width = '0%';
          row.todayBar.style.backgroundColor = '#ff5a00';
          row.todayBar.style.boxShadow = '0 0 8px rgba(255, 90, 0, 0.4)';
          row.valueSpan.innerText = row.yesterdayHR;
        }
      });
      // Reflow
      void animBtn.offsetHeight;
      
      animRows.forEach(row => {
        if (row.hasChange) {
          row.todayBar.style.transition = 'width 6.0s cubic-bezier(0.16, 1, 0.3, 1), background-color 2.0s ease';
        }
      });
    }

    animBtn.disabled = true;
    animBtn.style.background = 'rgba(16, 185, 129, 0.15)';
    animBtn.style.color = '#10b981';
    animBtn.style.borderColor = 'rgba(16, 185, 129, 0.3)';
    animBtn.innerHTML = `⚡ Animating...`;

    animRows.forEach((row, idx) => {
      if (row.hasChange) {
        row.barOuter.classList.add('pulse-new-hr');
        
        // Spawn first floating +1 / +X bubble immediately
        let spawnCount = 0;
        const spawnBubble = () => {
          const bubble = document.createElement('span');
          bubble.className = 'float-up-fade';
          bubble.style.cssText = `
            position: absolute;
            left: calc(${row.baseWidth + row.todayAddedWidth / 2}% - 16px);
            top: -8px;
            background: #ff5a00;
            color: #ffffff;
            font-size: 9px;
            font-weight: 800;
            padding: 2px 6px;
            border-radius: 6px;
            box-shadow: 0 0 6px rgba(255, 90, 0, 0.6);
            pointer-events: none;
            z-index: 10;
            font-family: var(--font-title);
            white-space: nowrap;
          `;
          if (spawnCount % 2 === 0) {
            bubble.innerText = `+${row.todayHRs}`;
          } else {
            bubble.innerText = `${row.yesterdayHR} > ${row.totalHR}`;
          }
          spawnCount++;
          row.barCol.appendChild(bubble);
          setTimeout(() => bubble.remove(), 1400);
        };

        spawnBubble();
        
        // Loop bubble spawning every 1.5 seconds during the 8 seconds
        row.bubbleInterval = setInterval(spawnBubble, 1500);

        setTimeout(() => {
          row.todayBar.style.width = `${row.todayAddedWidth}%`;
          
          // Spread counting up over 5.5 seconds
          const delayPerHR = 5500 / row.todayHRs;
          let count = row.yesterdayHR;
          const interval = setInterval(() => {
            if (count >= row.totalHR) {
              clearInterval(interval);
            } else {
              count++;
              row.valueSpan.innerText = count;
            }
          }, delayPerHR);
        }, idx * 40);

        // Lock in change to team color after 6.5 seconds
        setTimeout(() => {
          row.todayBar.style.backgroundColor = row.teamColor;
          row.todayBar.style.boxShadow = 'none';
        }, 6500);

        // Stop pulsing and clear bubbles loop at 8 seconds
        setTimeout(() => {
          row.barOuter.classList.remove('pulse-new-hr');
          if (row.bubbleInterval) {
            clearInterval(row.bubbleInterval);
            row.bubbleInterval = null;
          }
        }, 8000);
      }
    });

    // Complete state toggle at 8 seconds
    setTimeout(() => {
      isAnimated = true;
      animBtn.disabled = false;
      animBtn.style.background = 'rgba(255, 90, 0, 0.1)';
      animBtn.style.color = '#ff5a00';
      animBtn.style.borderColor = 'rgba(255, 90, 0, 0.35)';
      animBtn.innerHTML = `🔄 Replay Animation`;
    }, 8000);
  });

  card.appendChild(graphContainer);
}

// Render top 3 team leaders inside list
function renderTeamLeadersList(leaders, card, spinner) {
  if (spinner) spinner.remove();

  const existingList = card.querySelector('.team-leaders-list-container');
  if (existingList) existingList.remove();

  const listContainer = document.createElement('div');
  listContainer.className = 'team-leaders-list-container';
  listContainer.style.cssText = 'display: flex; flex-direction: column; gap: 10px; width: 100%;';

  if (leaders.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'text-align: center; color: var(--text-secondary); font-size: 12px; font-style: italic;';
    empty.innerText = 'No home run hitters recorded.';
    listContainer.appendChild(empty);
  } else {
    leaders.forEach((leader, idx) => {
      const item = document.createElement('div');
      item.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: rgba(255, 255, 255, 0.04); border: 1px solid var(--border-glass); border-radius: 10px; font-size: 13px;';
      
      const leftCol = document.createElement('div');
      leftCol.style.cssText = 'display: flex; align-items: center; gap: 12px; text-align: left;';

      const rankBadge = document.createElement('div');
      rankBadge.style.cssText = `width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 800; font-family: var(--font-title); background: ${idx === 0 ? 'rgba(245,158,11,0.15)' : idx === 1 ? 'rgba(226,232,240,0.12)' : 'rgba(180,83,9,0.12)'}; color: ${idx === 0 ? 'var(--color-gold)' : idx === 1 ? 'var(--text-secondary)' : '#b45309'}; border: 1.2px solid ${idx === 0 ? 'var(--color-gold)' : idx === 1 ? 'var(--text-secondary)' : '#b45309'};`;
      rankBadge.innerText = idx + 1;
      leftCol.appendChild(rankBadge);

      const nameSpan = document.createElement('span');
      nameSpan.style.cssText = 'font-weight: 700; color: var(--text-primary); font-family: var(--font-main);';
      nameSpan.innerText = leader.person?.fullName || 'Player';
      leftCol.appendChild(nameSpan);

      item.appendChild(leftCol);

      const hrCount = document.createElement('span');
      hrCount.style.cssText = 'font-size: 15px; font-weight: 800; color: var(--color-win); font-family: var(--font-title);';
      hrCount.innerText = `${leader.value} HR${parseInt(leader.value, 10) !== 1 ? 's' : ''}`;
      item.appendChild(hrCount);

      listContainer.appendChild(item);
    });
  }

  card.appendChild(listContainer);
}

// Generate mock team leaders based on team
function getMockTeamLeaders(teamId) {
  const team = teamsData[teamId];
  const name = team ? team.name : 'Team';
  
  if (teamId === 141) {
    return [
      { person: { fullName: 'Kazuma Okamoto' }, value: '19', team: { id: 141, name } },
      { person: { fullName: 'George Springer' }, value: '8', team: { id: 141, name } },
      { person: { fullName: 'Vladimir Guerrero Jr.' }, value: '7', team: { id: 141, name } }
    ];
  }
  return [
    { person: { fullName: 'Star Hitter A' }, value: '18', team: { id: teamId, name } },
    { person: { fullName: 'Slugger B' }, value: '12', team: { id: teamId, name } },
    { person: { fullName: 'Power C' }, value: '9', team: { id: teamId, name } }
  ];
}

// Home Run Chase View (Dynamic Home Run Race dashboard)
function createHRRaceView() {
  const container = document.createElement('div');
  container.className = 'setup-container';
  container.style.cssText = 'display: flex; flex-direction: column; gap: 20px; padding-bottom: 24px;';

  const title = document.createElement('h2');
  title.className = 'setup-title';
  title.innerText = 'Home Run Chase';
  title.style.cssText = 'font-size: 20px; font-weight: 800; color: var(--color-gold); margin-bottom: 2px; text-align: left;';
  container.appendChild(title);

  const subtitle = document.createElement('p');
  subtitle.style.cssText = 'font-size: 12.5px; color: var(--text-secondary); line-height: 1.5; margin: 0; margin-top: -12px; margin-bottom: 4px;';
  subtitle.innerText = 'Real-time leaderboard and daily stats for the 2026 MLB Home Run Chase.';
  container.appendChild(subtitle);

  const statsCard = document.createElement('div');
  statsCard.className = 'glass-card';
  statsCard.style.cssText = 'padding: 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 16px; text-align: center; border: 1px solid var(--border-glass-highlight);';
  
  const yesterdayCol = document.createElement('div');
  yesterdayCol.style.cssText = 'display: flex; flex-direction: column; gap: 4px; justify-content: center; border-right: 1px solid var(--border-glass);';
  
  const yesterdayLabel = document.createElement('span');
  yesterdayLabel.style.cssText = 'font-size: 11px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px;';
  yesterdayLabel.innerText = 'Hit Yesterday';
  
  const yesterdayVal = document.createElement('span');
  yesterdayVal.style.cssText = 'font-size: 32px; font-weight: 800; color: var(--color-gold); font-family: var(--font-title);';
  yesterdayVal.innerHTML = `<span style="font-size:16px; color:var(--text-muted);">Loading...</span>`;
  
  yesterdayCol.appendChild(yesterdayLabel);
  yesterdayCol.appendChild(yesterdayVal);
  statsCard.appendChild(yesterdayCol);

  const todayCol = document.createElement('div');
  todayCol.style.cssText = 'display: flex; flex-direction: column; gap: 4px; justify-content: center;';
  
  const todayLabel = document.createElement('span');
  todayLabel.style.cssText = 'font-size: 11px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px;';
  todayLabel.innerText = 'Hit Today';
  
  const todayVal = document.createElement('span');
  todayVal.style.cssText = 'font-size: 32px; font-weight: 800; color: var(--color-win); font-family: var(--font-title);';
  todayVal.innerHTML = `<span style="font-size:16px; color:var(--text-muted);">Loading...</span>`;
  
  const todaySub = document.createElement('span');
  todaySub.style.cssText = 'font-size: 9px; color: var(--text-muted); font-weight: 600; min-height: 12px;';
  
  todayCol.appendChild(todayLabel);
  todayCol.appendChild(todayVal);
  todayCol.appendChild(todaySub);
  statsCard.appendChild(todayCol);

  container.appendChild(statsCard);

  const yesterdayDate = getBaseballDate(-1);
  const todayDate = getBaseballDate(0);
  
  getDailyHRStats(yesterdayDate).then(data => {
    yesterdayVal.innerText = data.count;
  });

  getDailyHRStats(todayDate).then(data => {
    todayVal.innerText = data.count;
    if (data.remainingGames > 0) {
      todaySub.innerText = `${data.remainingGames} game${data.remainingGames > 1 ? 's' : ''} remaining`;
    } else {
      todaySub.innerText = 'All games complete';
    }
  });

  const leadersTitle = document.createElement('h3');
  leadersTitle.className = 'section-title';
  leadersTitle.innerText = 'MLB Home Run Leaders';
  leadersTitle.style.cssText = 'margin-bottom: 2px; font-size: 16px; color: var(--text-primary);';
  container.appendChild(leadersTitle);

  const leadersCard = document.createElement('div');
  leadersCard.className = 'glass-card';
  leadersCard.style.padding = '20px 16px 16px 16px';
  leadersCard.style.display = 'flex';
  leadersCard.style.flexDirection = 'column';
  leadersCard.style.gap = '14px';

  const leadersSpinner = document.createElement('div');
  leadersSpinner.style.cssText = 'text-align: center; color: var(--text-secondary); font-size: 13px; font-style: italic; padding: 12px;';
  leadersSpinner.innerText = 'Loading Leaders...';
  leadersCard.appendChild(leadersSpinner);
  container.appendChild(leadersCard);

  const activeTeam = teamsData[state.activeTeamId];
  const teamTitle = document.createElement('h3');
  teamTitle.className = 'section-title';
  teamTitle.innerText = `${activeTeam?.shortName || 'Team'} HR Leaders`;
  teamTitle.style.cssText = 'margin-bottom: 2px; font-size: 16px; color: var(--text-primary);';
  container.appendChild(teamTitle);

  const teamCard = document.createElement('div');
  teamCard.className = 'glass-card';
  teamCard.style.padding = '16px';
  teamCard.style.display = 'flex';
  teamCard.style.flexDirection = 'column';
  teamCard.style.gap = '12px';

  const teamSpinner = document.createElement('div');
  teamSpinner.style.cssText = 'text-align: center; color: var(--text-secondary); font-size: 13px; font-style: italic; padding: 12px;';
  teamSpinner.innerText = 'Loading Team Leaders...';
  teamCard.appendChild(teamSpinner);
  container.appendChild(teamCard);

  const mlbLeadersUrl = 'https://statsapi.mlb.com/api/v1/stats/leaders?leaderCategories=homeRuns&season=2026&statType=season&limit=20';
  const teamLeadersUrl = `https://statsapi.mlb.com/api/v1/stats/leaders?leaderCategories=homeRuns&season=2026&statType=season&limit=3&teamId=${state.activeTeamId}`;

  loadTodayPlayerHRs().finally(() => {
    fetch(mlbLeadersUrl)
      .then(res => {
        if (!res.ok) throw new Error('API failure');
        return res.json();
      })
      .then(data => {
        const leadersList = data.leagueLeaders?.[0]?.leaders || [];
        renderMLBLeadersGraph(leadersList.length > 0 ? leadersList : MOCK_HR_LEADERS, leadersCard, leadersSpinner);
      })
      .catch(() => {
        renderMLBLeadersGraph(MOCK_HR_LEADERS, leadersCard, leadersSpinner);
      });
  });

  fetch(teamLeadersUrl)
    .then(res => {
      if (!res.ok) throw new Error('API failure');
      return res.json();
    })
    .then(data => {
      const leadersList = data.leagueLeaders?.[0]?.leaders || [];
      renderTeamLeadersList(leadersList.length > 0 ? leadersList : getMockTeamLeaders(state.activeTeamId), teamCard, teamSpinner);
    })
    .catch(() => {
      renderTeamLeadersList(getMockTeamLeaders(state.activeTeamId), teamCard, teamSpinner);
    });

  return container;
}

const MOCK_TODAY_PLAYER_HRS = {
  656941: 0, // Kyle Schwarber
  696100: 0, // Hunter Goodman
  660271: 1, // Shohei Ohtani
  592450: 1, // Aaron Judge
  672960: 1  // Kazuma Okamoto
};

const MOCK_HR_LEADERS = [
  { person: { id: 656941, fullName: 'Kyle Schwarber' }, value: '30', team: { id: 143, name: 'Phillies' } },
  { person: { id: 696100, fullName: 'Hunter Goodman' }, value: '27', team: { id: 115, name: 'Rockies' } },
  { person: { id: 660271, fullName: 'Shohei Ohtani' }, value: '26', team: { id: 119, name: 'Dodgers' } },
  { person: { id: 592450, fullName: 'Aaron Judge' }, value: '25', team: { id: 147, name: 'Yankees' } },
  { person: { id: 660271, fullName: 'Marcell Ozuna' }, value: '24', team: { id: 144, name: 'Braves' } },
  { person: { id: 657557, fullName: 'Gunnar Henderson' }, value: '23', team: { id: 110, name: 'Orioles' } },
  { person: { id: 665489, fullName: 'Juan Soto' }, value: '22', team: { id: 147, name: 'Yankees' } },
  { person: { id: 669022, fullName: 'Brent Rooker' }, value: '21', team: { id: 133, name: 'Athletics' } },
  { person: { id: 608070, fullName: 'José Ramírez' }, value: '20', team: { id: 114, name: 'Guardians' } },
  { person: { id: 672960, fullName: 'Kazuma Okamoto' }, value: '19', team: { id: 141, name: 'Blue Jays' } },
  { person: { id: 641355, fullName: 'Cody Bellinger' }, value: '18', team: { id: 112, name: 'Cubs' } },
  { person: { id: 660688, fullName: 'Christian Walker' }, value: '18', team: { id: 109, name: 'D-backs' } },
  { person: { id: 663656, fullName: 'Kyle Tucker' }, value: '17', team: { id: 117, name: 'Astros' } },
  { person: { id: 621020, fullName: 'Corey Seager' }, value: '17', team: { id: 140, name: 'Rangers' } },
  { person: { id: 605141, fullName: 'Mookie Betts' }, value: '16', team: { id: 119, name: 'Dodgers' } },
  { person: { id: 641820, fullName: 'Manny Machado' }, value: '16', team: { id: 135, name: 'Padres' } },
  { person: { id: 547180, fullName: 'Bryce Harper' }, value: '15', team: { id: 143, name: 'Phillies' } },
  { person: { id: 668227, fullName: 'William Contreras' }, value: '15', team: { id: 158, name: 'Brewers' } },
  { person: { id: 650402, fullName: 'Rafael Devers' }, value: '14', team: { id: 111, name: 'Red Sox' } },
  { person: { id: 669221, fullName: 'Bobby Witt Jr.' }, value: '14', team: { id: 118, name: 'Royals' } }
];

// Fire application initialization
document.addEventListener('DOMContentLoaded', init);
// Run init immediately in case DOM is already loaded
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  init();
}
export { init };
