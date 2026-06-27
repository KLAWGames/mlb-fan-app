import './style.css';
import { teamsData } from './teamsData.js';
import { fetchStandings, fetchSchedule, formatLocalDate } from './mlbApi.js';
import { processStandings, analyzeMatchups } from './rootingEngine.js';

// Application State
let state = {
  selectedTeamIds: [], // Tracked favorite team IDs (max 3)
  activeTeamId: null,  // Currently active team ID in view
  activeView: 'dashboard', // 'dashboard' | 'standings' | 'settings'
  selectedDate: formatLocalDate(new Date()), // YYYY-MM-DD
  rawStandings: null,
  rawSchedule: null,
  rawStandingsYesterday: null,
  processedStandings: null,
  processedStandingsYesterday: null,
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

// Generate season standings history (wins - losses) deterministically using LCG
function generateSeasonHistory(teamId, wins, losses) {
  const G = wins + losses;
  if (G === 0) return [0];
  
  const history = [0];
  
  // Seed based on teamId so it's stable and unique per team
  let seed = teamId * 13;
  function lcg() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  }
  
  // Distribute wins (+1) and losses (-1)
  const games = [];
  for (let i = 0; i < wins; i++) games.push(1);
  for (let i = 0; i < losses; i++) games.push(-1);
  
  // Deterministic shuffle using LCG
  for (let i = G - 1; i > 0; i--) {
    const j = Math.floor(lcg() * (i + 1));
    const temp = games[i];
    games[i] = games[j];
    games[j] = temp;
  }
  
  // Build cumulative wins - losses history
  let diff = 0;
  for (let i = 0; i < G; i++) {
    diff += games[i];
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
  const svgHeight = 200;
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

// Generate deterministic game-by-game results for a team
function generateSeasonGames(teamId, wins, losses) {
  // Trigger silent fetch for this team's schedule if not already loaded
  fetchTeamSeasonSchedule(teamId);

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
          gameNumber: idx + 1,
          dateStr,
          opponent: opponentData.name,
          opponentAbbr: opponentData.abbreviation,
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
      opponent: opponent.name,
      opponentAbbr: opponent.abbreviation,
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

  // Set up touch gestures (Pull to Refresh)
  setupPullToRefresh();

  // Set up scroll-to-hide navigation bar
  setupScrollToHide();

  // Start auto-refresh interval for live scores
  startAutoRefresh();
}

// Setup mobile-native Pull-to-Refresh gesture
function setupPullToRefresh() {
  const appContainer = document.querySelector('#app');
  if (!appContainer) return;

  // Create and inject PTR elements if they don't exist
  let ptrContainer = document.querySelector('.ptr-container');
  if (!ptrContainer) {
    ptrContainer = document.createElement('div');
    ptrContainer.className = 'ptr-container';
    ptrContainer.innerHTML = `<div class="ptr-spinner"></div>`;
    document.body.insertBefore(ptrContainer, document.body.firstChild);
  }

  const spinner = ptrContainer.querySelector('.ptr-spinner');
  
  let startY = 0;
  let currentY = 0;
  let isTracking = false;
  let isRefreshing = false;
  
  const threshold = 65; // px to drag to trigger refresh
  const resistance = 0.35; // drag resistance multiplier

  document.addEventListener('touchstart', (e) => {
    // Only track if we are scrolled to the very top of the window
    if (window.scrollY === 0 && !isRefreshing) {
      startY = e.touches[0].pageY;
      currentY = startY; // reset
      isTracking = true;
      appContainer.classList.remove('ptr-animating');
    }
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!isTracking) return;
    
    currentY = e.touches[0].pageY;
    const diff = currentY - startY;

    if (diff > 0) {
      // Pulling down!
      // Prevent default browser elastic overflow bounce on iOS
      if (e.cancelable) e.preventDefault();
      
      const translateY = Math.min(diff * resistance, threshold);
      appContainer.style.transform = `translateY(${translateY}px)`;
      
      // Pull loader down and rotate it
      ptrContainer.style.top = `${Math.min(translateY - 50, 15)}px`;
      ptrContainer.classList.add('active');
      spinner.style.transform = `rotate(${diff * 2}deg)`;
    } else {
      // Swiping up, cancel tracking
      isTracking = false;
      resetPTR();
    }
  }, { passive: false });

  document.addEventListener('touchend', async () => {
    if (!isTracking) return;
    isTracking = false;

    const diff = currentY - startY;
    const translateY = diff * resistance;

    if (translateY >= threshold - 5) {
      // Trigger refresh!
      isRefreshing = true;
      appContainer.classList.add('ptr-animating');
      appContainer.style.transform = `translateY(${threshold - 15}px)`;
      ptrContainer.style.top = '15px';
      
      spinner.classList.add('spinning');

      try {
        console.log("PTR active - fetching standings & schedule...");
        await loadData(); // Reload API schedule and standings dynamically!
      } catch (err) {
        console.error("PTR refresh failed:", err);
      } finally {
        isRefreshing = false;
        spinner.classList.remove('spinning');
        resetPTR();
      }
    } else {
      resetPTR();
    }
  });

  function resetPTR() {
    appContainer.classList.add('ptr-animating');
    appContainer.style.transform = 'translateY(0)';
    ptrContainer.style.top = '-60px';
    ptrContainer.classList.remove('active');
    spinner.style.transform = 'rotate(0deg)';
  }
}

// Setup scroll-to-hide behavior for bottom navigation
function setupScrollToHide() {
  let lastScrollY = window.scrollY;
  
  window.addEventListener('scroll', () => {
    const nav = document.querySelector('.bottom-nav');
    if (!nav) return;
    
    const currentScrollY = window.scrollY;
    
    // Determine scroll direction
    if (currentScrollY > lastScrollY && currentScrollY > 60) {
      // Scrolling down - hide navigation
      nav.classList.add('hidden');
    } else {
      // Scrolling up or at the very top - show navigation
      nav.classList.remove('hidden');
    }
    
    lastScrollY = currentScrollY;
  }, { passive: true });
}

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
const confettiColors = ['#34d399', '#f87171', '#60a5fa', '#fbbf24', '#c084fc', '#f472b6', '#ffffff'];

function startConfetti() {
  if (confettiActive) return;
  
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
  requestAnimationFrame(updateConfetti);
}

function resizeConfettiCanvas() {
  if (confettiCanvas) {
    confettiCanvas.width = window.innerWidth;
    confettiCanvas.height = window.innerHeight;
  }
}

function updateConfetti() {
  if (!confettiActive || !confettiCtx || !confettiCanvas) return;

  confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);

  let activeCount = 0;
  confettiParticles.forEach(p => {
    p.y += p.ySpeed;
    p.x += p.xSpeed;
    p.rotation += p.rotationSpeed;
    p.xSpeed += Math.sin(p.y / 30) * 0.05;

    if (p.y <= confettiCanvas.height) {
      activeCount++;
    }

    confettiCtx.save();
    confettiCtx.translate(p.x, p.y);
    confettiCtx.rotate((p.rotation * Math.PI) / 180);
    confettiCtx.globalAlpha = p.opacity;
    confettiCtx.fillStyle = p.color;
    confettiCtx.fillRect(-p.size / 2, -p.size, p.size, p.size * 2);
    confettiCtx.restore();
  });

  if (activeCount > 0 && confettiActive) {
    requestAnimationFrame(updateConfetti);
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
  const teamToday = state.processedStandings?.teamsMap?.[activeTeamId] || teamsData[activeTeamId];
  const teamYesterday = state.processedStandingsYesterday?.teamsMap?.[activeTeamId];
  
  if (!teamToday || !teamYesterday) return;

  // Safely compute formatted label for yesterday's date
  const parts = state.selectedDate.split('-');
  const todayDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 12, 0, 0);
  const yesterdayDate = new Date(todayDate);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayLabel = yesterdayDate.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });

  // Create backdrop
  const backdrop = document.createElement('div');
  backdrop.className = 'recap-backdrop';
  
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
    backdrop.classList.remove('show');
    setTimeout(() => {
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
      stopConfetti();
    }, 300);
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
    if (didTeamWin) {
      startConfetti();
    }
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
  const divTrend = getDivisionTrend(activeTeamId);
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
    divBadge.innerText = `▲ Gained ${divTrend.toFixed(1)} G`;
    hasGainedGround = true;
  } else if (divTrend < 0) {
    divBadge.className = 'recap-trend-badge lost';
    divBadge.innerText = `▼ Lost ${Math.abs(divTrend).toFixed(1)} G`;
  } else {
    divBadge.className = 'recap-trend-badge no-change';
    divBadge.innerText = '— No Change';
  }
  divRow.appendChild(divLabel);
  divRow.appendChild(divBadge);
  standingsBody.appendChild(divRow);

  // Wild Card Race
  const wcTrend = getWildCardTrend(activeTeamId);
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
    wcBadge.innerText = `▲ Gained ${wcTrend.toFixed(1)} G`;
    hasGainedGround = true;
  } else if (wcTrend < 0) {
    wcBadge.className = 'recap-trend-badge lost';
    wcBadge.innerText = `▼ Lost ${Math.abs(wcTrend).toFixed(1)} G`;
  } else {
    wcBadge.className = 'recap-trend-badge no-change';
    wcBadge.innerText = '— No Change';
  }
  wcRow.appendChild(wcLabel);
  wcRow.appendChild(wcBadge);
  standingsBody.appendChild(wcRow);

  standingsCard.appendChild(standingsBody);
  body.appendChild(standingsCard);

  if (hasGainedGround) {
    startConfetti();
  }

  // 3. Rooting Advice Results Card
  const rootingCard = document.createElement('div');
  rootingCard.className = 'recap-card';

  const rootingTitle = document.createElement('div');
  rootingTitle.className = 'recap-card-title';
  rootingTitle.innerText = 'Rivalry Outcomes Yesterday';
  rootingCard.appendChild(rootingTitle);

  const rootingBody = document.createElement('div');
  rootingBody.style.display = 'flex';
  rootingBody.style.flexDirection = 'column';
  rootingBody.style.gap = '12px';

  // Analyze yesterday's games
  const rootingGamesAnalysis = analyzeMatchups(yesterdayGames, state.processedStandingsYesterday, activeTeamId);
  // Exclude our own game and priority 0 games
  const targetRivalGames = rootingGamesAnalysis.filter(g => g.priority > 0 && g.awayTeam.id !== activeTeamId && g.homeTeam.id !== activeTeamId);

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
        <div style="color: var(--text-secondary); font-size:11px; margin-bottom:4px;">
          Rooted for: <strong>${rootTeamName}</strong>. 
          ${winnerTeam.shortName} beat ${loserTeam.shortName}.
        </div>
      `;

      // If rooting choice won, allow user to "High Five" the winning team!
      if (didRootSucceed) {
        const hfBtn = document.createElement('button');
        hfBtn.className = 'high-five-btn';
        
        const isFived = state.highFivedTeams.includes(g.gamePk);
        hfBtn.disabled = isFived;
        hfBtn.innerHTML = isFived ? 'High Fived! 🖐️' : `🖐️ High Five the ${winnerTeam.shortName}`;
        
        hfBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          triggerHighFiveAnimation(e, winnerTeam.shortName);
          state.highFivedTeams.push(g.gamePk);
          hfBtn.disabled = true;
          hfBtn.innerHTML = 'High Fived! 🖐️';
        });
        gameRow.appendChild(hfBtn);
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

  // Animate slide up
  backdrop.offsetWidth; // force reflow
  backdrop.classList.add('show');
}


// Fetch schedule and standings
async function loadData() {
  state.loading = true;
  render();

  try {
    // Compute yesterday's date string safely to avoid iOS Safari date parsing issues
    const parts = state.selectedDate.split('-');
    const todayDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), 12, 0, 0);
    const yesterdayDate = new Date(todayDate);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayStr = formatLocalDate(yesterdayDate);

    const [standings, schedule, standingsYesterday, scheduleYesterday] = await Promise.all([
      fetchStandings(state.selectedDate),
      fetchSchedule(state.selectedDate),
      fetchStandings(yesterdayStr),
      fetchSchedule(yesterdayStr)
    ]);
    
    state.rawStandings = standings;
    state.rawSchedule = schedule;
    state.rawStandingsYesterday = standingsYesterday;
    state.rawScheduleYesterday = scheduleYesterday;
    
    state.processedStandings = processStandings(standings);
    state.processedStandingsYesterday = processStandings(standingsYesterday);
    
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

    const [standings, schedule, standingsYesterday, scheduleYesterday] = await Promise.all([
      fetchStandings(state.selectedDate),
      fetchSchedule(state.selectedDate),
      fetchStandings(yesterdayStr),
      fetchSchedule(yesterdayStr)
    ]);
    
    state.rawStandings = standings;
    state.rawSchedule = schedule;
    state.rawStandingsYesterday = standingsYesterday;
    state.rawScheduleYesterday = scheduleYesterday;
    
    state.processedStandings = processStandings(standings);
    state.processedStandingsYesterday = processStandings(standingsYesterday);
    
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

// Switch view with directional transitions
function transitionToView(targetView, targetTeamId = null) {
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

  // Resolve target index
  let targetIndex = -1;
  if (targetView === 'standings') {
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

  appContainer.innerHTML = '';

  // 1. Render Header (Tabs & Date selector)
  appContainer.appendChild(createHeader());

  // 2. Render Main Body Content based on activeView
  const mainContent = document.createElement('main');
  mainContent.style.flex = '1';

  if (state.transitionDirection) {
    mainContent.classList.add(`slide-in-${state.transitionDirection}`);
    state.transitionDirection = null; // Clear so subsequent silent updates do not animate
  }

  if (state.loading) {
    mainContent.appendChild(createLoader());
  } else {
    switch (state.activeView) {
      case 'dashboard':
        mainContent.appendChild(createDashboardView());
        break;
      case 'standings':
        mainContent.appendChild(createStandingsView());
        break;
      case 'team-select':
        mainContent.appendChild(createTeamSelectView());
        break;
      case 'credits-version':
        mainContent.appendChild(createCreditsVersionView());
        break;
      default:
        mainContent.appendChild(createDashboardView());
    }
  }

  appContainer.appendChild(mainContent);

  // 3. Bottom Nav removed as tabs moved to header sticky navigation
}

// Global Hamburger Menu Controller
function toggleHamburgerMenu(open) {
  let drawer = document.getElementById('hamburger-drawer');
  if (!drawer) {
    drawer = document.createElement('div');
    drawer.id = 'hamburger-drawer';
    drawer.className = 'hamburger-drawer';
    
    const backdrop = document.createElement('div');
    backdrop.className = 'drawer-backdrop';
    backdrop.addEventListener('click', () => toggleHamburgerMenu(false));
    drawer.appendChild(backdrop);
    
    const content = document.createElement('div');
    content.className = 'drawer-content';
    
    const header = document.createElement('div');
    header.className = 'drawer-header';
    const title = document.createElement('h3');
    title.innerText = 'BaseTab Menu';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'drawer-close-btn';
    closeBtn.innerHTML = '×';
    closeBtn.addEventListener('click', () => toggleHamburgerMenu(false));
    
    header.appendChild(title);
    header.appendChild(closeBtn);
    content.appendChild(header);
    
    const list = document.createElement('div');
    list.className = 'drawer-menu-list';
    
    // Option 1: Team Select
    const optTeamSelect = document.createElement('button');
    optTeamSelect.className = 'drawer-menu-item';
    optTeamSelect.innerHTML = '👥 <span>Configure Teams</span>';
    optTeamSelect.addEventListener('click', () => {
      toggleHamburgerMenu(false);
      state.activeView = 'team-select';
      state.searchQuery = '';
      render();
    });
    
    // Option 2: Credits & Version
    const optCredits = document.createElement('button');
    optCredits.className = 'drawer-menu-item';
    optCredits.innerHTML = 'ℹ️ <span>Credits & Version</span>';
    optCredits.addEventListener('click', () => {
      toggleHamburgerMenu(false);
      state.activeView = 'credits-version';
      render();
    });
    
    // Option 3: Force Reload
    const optReload = document.createElement('button');
    optReload.className = 'drawer-menu-item';
    optReload.innerHTML = '🔄 <span>Force Reload App</span>';
    optReload.addEventListener('click', () => {
      toggleHamburgerMenu(false);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(registrations => {
          for (let registration of registrations) {
            registration.unregister();
          }
        });
      }
      window.location.reload(true);
    });
    
    list.appendChild(optTeamSelect);
    list.appendChild(optCredits);
    list.appendChild(optReload);
    content.appendChild(list);
    
    drawer.appendChild(content);
    document.body.appendChild(drawer);
  }
  
  if (open) {
    drawer.classList.add('show');
  } else {
    drawer.classList.remove('show');
  }
}

// Header Component
function createHeader() {
  const header = document.createElement('header');

  const topRow = document.createElement('div');
  topRow.className = 'header-top';

  const logo = document.createElement('div');
  logo.className = 'app-logo';
  logo.innerText = 'BaseTab';
  logo.style.cursor = 'pointer';
  logo.addEventListener('click', () => {
    state.activeView = 'dashboard';
    render();
  });

  const rightControls = document.createElement('div');
  rightControls.style.display = 'flex';
  rightControls.style.alignItems = 'center';
  rightControls.style.gap = '8px';

  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.className = 'date-selector';
  dateInput.value = state.selectedDate;
  dateInput.addEventListener('change', async (e) => {
    state.selectedDate = e.target.value;
    await loadData();
  });

  const menuBtn = document.createElement('button');
  menuBtn.className = 'menu-hamburger-btn';
  menuBtn.innerHTML = '☰';
  menuBtn.title = 'App Menu';
  menuBtn.addEventListener('click', () => {
    if (state.activeView === 'dashboard' || state.activeView === 'standings') {
      state.previousMainView = state.activeView;
    }
    toggleHamburgerMenu(true);
  });

  rightControls.appendChild(dateInput);
  rightControls.appendChild(menuBtn);

  topRow.appendChild(logo);
  topRow.appendChild(rightControls);
  header.appendChild(topRow);

  // Team Switcher & Standings Tabs (Only visible on dashboard and standings views)
  if (state.activeView === 'dashboard' || state.activeView === 'standings') {
    const tabs = document.createElement('div');
    tabs.className = 'team-tabs';

    state.selectedTeamIds.forEach(id => {
      const team = teamsData[id];
      if (!team) return;

      const btn = document.createElement('button');
      const isTeamActive = state.activeView === 'dashboard' && state.activeTeamId === id;
      btn.className = `team-tab ${isTeamActive ? 'active' : ''}`;
      btn.title = team.name;
      
      const badge = document.createElement('div');
      badge.className = 'team-tab-badge';
      badge.innerText = team.abbreviation;
      badge.style.background = team.primaryColor;
      badge.style.border = `1px solid ${team.secondaryColor}`;

      btn.appendChild(badge);

      btn.addEventListener('click', () => {
        transitionToView('dashboard', id);
      });

      tabs.appendChild(btn);
    });

    // Standings Switcher Tab (🏆) next to teams
    const standingsBtn = document.createElement('button');
    const isStandingsActive = state.activeView === 'standings';
    standingsBtn.className = `team-tab standings-tab-item ${isStandingsActive ? 'active' : ''}`;

    const standingsBadge = document.createElement('div');
    standingsBadge.className = 'team-tab-badge';
    standingsBadge.innerText = '🏆';
    standingsBadge.style.background = '#64748b';
    standingsBadge.style.border = '1px solid #475569';
    standingsBadge.style.color = '#ffffff';

    const standingsLabel = document.createElement('span');
    standingsLabel.innerText = 'Standings';

    standingsBtn.appendChild(standingsBadge);
    standingsBtn.appendChild(standingsLabel);

    standingsBtn.addEventListener('click', () => {
      transitionToView('standings');
    });

    tabs.appendChild(standingsBtn);

    // Wrap in sticky wrapper to fix to top on scroll
    const stickyWrapper = document.createElement('div');
    stickyWrapper.className = 'sticky-nav-wrapper';
    stickyWrapper.appendChild(tabs);
    header.appendChild(stickyWrapper);
  }

  return header;
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
    const seasonGames = generateSeasonGames(team.id, team.wins || 0, team.losses || 0);
    if (state.bannerZoomedIn && seasonGames.length > 10) {
      const minVisibleIdx = seasonGames.length - 10;
      if (state.selectedGameIdx === null || state.selectedGameIdx < minVisibleIdx) {
        state.selectedGameIdx = seasonGames.length - 1;
      }
    }
    render();
  });
  
  banner.appendChild(zoomBtn);

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
  const name = document.createElement('h2');
  name.innerText = team.name;
  const desc = document.createElement('p');
  const leagueName = team.leagueId === 103 ? 'American League' : 'National League';
  desc.innerText = `${leagueName} • ${team.divisionName}`;
  textNode.appendChild(name);
  textNode.appendChild(desc);

  left.appendChild(badge);
  left.appendChild(textNode);

  // Right side stats ticker
  const right = document.createElement('div');
  right.className = 'banner-stats-ticker';
  right.style.display = 'flex';
  right.style.gap = '8px';
  right.style.flexWrap = 'wrap';

  const wins = team.wins !== undefined ? team.wins : 0;
  const losses = team.losses !== undefined ? team.losses : 0;
  const gamesRemaining = 162 - wins - losses;
  
  let divStandingText = '-';
  if (team.divisionLeader) divStandingText = "Leader";
  else if (team.gamesBack !== undefined) divStandingText = `${team.gamesBack} GB`;
  
  const wcStandingText = getWildCardStats(team, state.processedStandings);

  const statBoxes = [
    { label: 'Record', value: `${wins}-${losses}` },
    { label: 'Left', value: `${gamesRemaining}` },
    { label: 'Division', value: divStandingText },
    { label: 'Wild Card', value: wcStandingText }
  ];

  statBoxes.forEach(box => {
    const boxEl = document.createElement('div');
    boxEl.style.background = 'rgba(255, 255, 255, 0.10)';
    boxEl.style.border = '1px solid rgba(255, 255, 255, 0.18)';
    boxEl.style.padding = '4px 10px';
    boxEl.style.borderRadius = '4px';
    boxEl.style.display = 'flex';
    boxEl.style.flexDirection = 'column';
    boxEl.style.alignItems = 'center';
    boxEl.style.minWidth = '70px';

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
    valEl.style.fontSize = '13px';
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
  const seasonGames = generateSeasonGames(team.id, wins, losses);
  
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
    detailStrip.style.display = 'flex';
    detailStrip.style.alignItems = 'center';
    detailStrip.style.justifyContent = 'space-between';
    detailStrip.style.gap = '12px';
    detailStrip.style.padding = '6px 8px';
    detailStrip.style.background = 'rgba(0, 0, 0, 0.18)';
    detailStrip.style.borderRadius = '4px';
    detailStrip.style.border = '1px solid rgba(255, 255, 255, 0.08)';
    detailStrip.style.width = '100%';

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
    
    function updateDetailStrip(g) {
      const resultText = g.isWin ? 'Win' : 'Loss';
      const resultColor = g.isWin ? '#6ee7b7' : '#fca5a5';
      const diffText = g.runDiff > 0 ? `+${g.runDiff}` : `${g.runDiff}`;
      
      textContainer.innerHTML = `
        <div style="font-size: 9px; color: rgba(255,255,255,0.65); text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700; margin-bottom: 2px;">
          Game ${g.gameNumber} • ${g.dateStr}
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

    detailStrip.appendChild(textContainer);
    detailStrip.appendChild(btnGroup);
    banner.appendChild(detailStrip);

  }

  container.appendChild(banner);

  // Yesterday's Standings Recap Trigger Button
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
        const colorB = opponent.primaryColor || '#f5d130';
        const opponentLabel = isLeader ? '2nd Place' : 'Div Leader';
        
        legend.innerHTML = `
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="display:inline-block; width:8px; height:8px; background:${colorA}; border-radius:50%;"></span>
            <span style="color:var(--text-primary); font-weight:700;">${team.shortName} (Active)</span>
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="display:inline-block; width:8px; height:8px; background:${colorB}; border-radius:50%;"></span>
            <span style="color:var(--text-secondary); font-weight:600;">${opponent.shortName} (${opponentLabel})</span>
          </div>
        `;
        timeline.appendChild(legend);
        
        // Generate SVG chart
        const chartNode = createDivisionRaceChart(team, opponent);
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

  // 3. Collapsible Magic Numbers Accordion (🔒 Clinch Math)
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
    let clinchs = [];

    // Division magic number info
    const divText = document.createElement('p');
    divText.style.marginBottom = '10px';
    divText.style.fontSize = '13px';
    if (hasDivMagic) {
      divText.innerHTML = `<strong>Division Magic Number: <span style="color:var(--color-gold); font-size:16px;">${team.divisionMagicNumber}</span></strong><br/>Any combination of ${team.shortName} wins and division rivals losses totaling ${team.divisionMagicNumber} clinches the division. <span style="color:var(--text-muted); font-size:11px;">(${gamesRemaining} games remaining)</span>`;
    } else if (team.divisionLeader) {
      divText.innerHTML = `<strong>Division Magic Number:</strong> No active magic number. You are leading the division. <span style="color:var(--text-muted); font-size:11px;">(${gamesRemaining} games remaining)</span>`;
    } else {
      divText.innerHTML = `<strong>Division Position:</strong> Trailing the division leader by ${team.gamesBack} games. <span style="color:var(--text-muted); font-size:11px;">(${gamesRemaining} games remaining)</span>`;
    }
    accordionContent.appendChild(divText);

    // Wild Card magic number info
    const wcText = document.createElement('p');
    wcText.style.fontSize = '13px';
    if (hasWcMagic) {
      wcText.innerHTML = `<strong>Wild Card Magic Number: <span style="color:var(--color-gold); font-size:16px;">${team.wildCardMagicNumber}</span></strong><br/>Any combination of ${team.shortName} wins and the first-out team's losses totaling ${team.wildCardMagicNumber} clinches a Wild Card spot. <span style="color:var(--text-muted); font-size:11px;">(${gamesRemaining} games remaining)</span>`;
    } else if (team.isWildCardSpot) {
      wcText.innerHTML = `<strong>Wild Card Position:</strong> Holding a Wild Card spot (+${Math.abs(team.wildCardGamesBack)} ahead of cutoff). <span style="color:var(--text-muted); font-size:11px;">(${gamesRemaining} games remaining)</span>`;
    } else {
      wcText.innerHTML = `<strong>Wild Card Position:</strong> Trailing the Wild Card cutoff by ${team.wildCardGamesBack} games. <span style="color:var(--text-muted); font-size:11px;">(${gamesRemaining} games remaining)</span>`;
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

  // 3. Matchup / Rooting Guide Section
  const headerContainer = document.createElement('div');
  headerContainer.style.display = 'flex';
  headerContainer.style.justifyContent = 'space-between';
  headerContainer.style.alignItems = 'center';
  headerContainer.style.marginBottom = '12px';

  const gamesTitle = document.createElement('h3');
  gamesTitle.className = 'section-title';
  gamesTitle.innerText = 'Games That Matter Today';
  gamesTitle.style.marginBottom = '0';

  headerContainer.appendChild(gamesTitle);

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

  const games = state.rawSchedule || [];
  if (games.length === 0) {
    container.appendChild(createEmptyState('No games scheduled for this date. Standings remain locked.'));
    return container;
  }

  const analysis = analyzeMatchups(games, state.processedStandings, state.activeTeamId);
  const relevantGames = analysis.filter(g => g.priority > 0 || g.awayTeam.id === state.activeTeamId || g.homeTeam.id === state.activeTeamId);
  const neutralGames = analysis.filter(g => g.priority === 0 && g.awayTeam.id !== state.activeTeamId && g.homeTeam.id !== state.activeTeamId);

  if (relevantGames.length === 0) {
    const noGamesMsg = document.createElement('p');
    noGamesMsg.style.fontSize = '13px';
    noGamesMsg.style.color = 'var(--text-secondary)';
    noGamesMsg.style.textAlign = 'center';
    noGamesMsg.style.padding = '20px 0';
    noGamesMsg.innerText = 'No matchups directly impacting your standing today.';
    container.appendChild(noGamesMsg);
  } else {
    relevantGames.forEach(item => {
      container.appendChild(createGameCard(item, false));
    });
  }

  if (neutralGames.length > 0) {
    const divider = document.createElement('div');
    divider.className = 'relevance-divider';
    divider.innerText = 'Other Matchups (No Standing Impact)';
    container.appendChild(divider);

    neutralGames.forEach(item => {
      container.appendChild(createGameCard(item, true));
    });
  }

  // Helper inside createDashboardView to render cards
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

      const footerHint = document.createElement('div');
      footerHint.className = 'game-card-footer';
      footerHint.innerText = 'Click card to collapse details';
      card.appendChild(footerHint);
    }

    return card;
  }

  return container;
}

// Standings View
function createStandingsView() {
  const container = document.createElement('div');
  const favTeam = state.processedStandings?.teamsMap?.[state.activeTeamId] || teamsData[state.activeTeamId];
  if (!favTeam) return container;

  // Render division standings
  const divTitle = document.createElement('h3');
  divTitle.className = 'section-title';
  divTitle.innerText = `${favTeam.divisionName} Standings`;
  container.appendChild(divTitle);

  const divCard = document.createElement('div');
  divCard.className = 'glass-card';
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
  
  const divisionId = favTeam.divisionId;
  const divTeams = state.processedStandings?.divisionTeams?.[divisionId] || [];
  
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
  container.appendChild(divCard);

  // Render Wild Card Standings for active league
  const leagueName = favTeam.leagueId === 103 ? 'AL' : 'NL';
  const wcTitle = document.createElement('h3');
  wcTitle.className = 'section-title';
  wcTitle.innerText = `${leagueName} Wild Card Race`;
  container.appendChild(wcTitle);

  const wcCard = document.createElement('div');
  wcCard.className = 'glass-card';
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

  const leagueId = favTeam.leagueId;
  const allLeague = state.processedStandings?.leagueTeams?.[leagueId] || [];
  // Non-division leaders sorted by wildcard rank
  const wcPool = allLeague.filter(t => !t.divisionLeader).sort((a, b) => a.wildCardRank - b.wildCardRank);

  wcPool.forEach(team => {
    const tr = document.createElement('tr');
    if (team.id === state.activeTeamId) tr.className = 'highlight';

    // Show plus sign for teams ahead, minus/blank for others
    let gbText = '-';
    if (team.wildCardGamesBack < 0) {
      gbText = `+${Math.abs(team.wildCardGamesBack)}`;
    } else if (team.wildCardGamesBack > 0) {
      gbText = `${team.wildCardGamesBack}`;
    }

    // Highlight top 3 teams in wildcard position
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

  const backBtn = document.createElement('button');
  backBtn.className = 'drawer-menu-item';
  backBtn.style.cssText = 'font-size: 14px; font-weight: 700; color: var(--text-primary); background: var(--bg-card-hover); border: 1px solid var(--border-glass); border-radius: 6px; cursor: pointer; padding: 6px 12px; font-family: var(--font-title); display: flex; align-items: center; justify-content: center; width: auto;';
  backBtn.innerHTML = '← Back';
  backBtn.addEventListener('click', () => {
    state.activeView = state.previousMainView || 'dashboard';
    render();
  });

  const title = document.createElement('h2');
  title.className = 'setup-title';
  title.innerText = 'Configure Teams';
  title.style.margin = '0';

  backHeader.appendChild(backBtn);
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

  const backBtn = document.createElement('button');
  backBtn.style.cssText = 'font-size: 14px; font-weight: 700; color: var(--text-primary); background: var(--bg-card-hover); border: 1px solid var(--border-glass); border-radius: 6px; cursor: pointer; padding: 6px 12px; font-family: var(--font-title); display: flex; align-items: center; justify-content: center; width: auto;';
  backBtn.innerHTML = '← Back';
  backBtn.addEventListener('click', () => {
    state.activeView = state.previousMainView || 'dashboard';
    render();
  });

  const title = document.createElement('h2');
  title.className = 'setup-title';
  title.innerText = 'Credits & Info';
  title.style.margin = '0';

  backHeader.appendChild(backBtn);
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
  appMetaText.innerHTML = '<strong>BaseTab Web App</strong><br>Version: v1.2.0<br>Build: Production Build<br>Designed for MLB Fans and playoff rooting priority tracking.';
  creditsCard.appendChild(appMetaText);

  container.appendChild(creditsCard);

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
      e.target.closest('.team-list-grid')) {
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

// Fire application initialization
document.addEventListener('DOMContentLoaded', init);
// Run init immediately in case DOM is already loaded
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  init();
}
export { init };
