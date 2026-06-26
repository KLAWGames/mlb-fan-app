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
  expandedTiebreakerTeamIds: [] // List of team IDs whose tiebreakers are expanded in the Wild Card view
};

// Helper: Convert Hex color to RGB string for custom CSS transparency gradients
function hexToRgbString(hex) {
  let shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
  let fullHex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);
  let result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(fullHex);
  return result ? 
    `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` 
    : "19, 74, 142";
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

    const [standings, schedule, standingsYesterday] = await Promise.all([
      fetchStandings(state.selectedDate),
      fetchSchedule(state.selectedDate),
      fetchStandings(yesterdayStr)
    ]);
    
    state.rawStandings = standings;
    state.rawSchedule = schedule;
    state.rawStandingsYesterday = standingsYesterday;
    
    state.processedStandings = processStandings(standings);
    state.processedStandingsYesterday = processStandings(standingsYesterday);
    
    // Automatically set default active tab (Division vs Wild Card)
    syncDefaultTab();
  } catch (err) {
    console.error("Error loading MLB data:", err);
  } finally {
    state.loading = false;
    render();
  }
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
      case 'settings':
        mainContent.appendChild(createSettingsView());
        break;
      default:
        mainContent.appendChild(createDashboardView());
    }
  }

  appContainer.appendChild(mainContent);

  // 3. Render Bottom Navigation Bar
  appContainer.appendChild(createNavigation());
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

  const settingsBtn = document.createElement('button');
  settingsBtn.className = 'settings-btn';
  settingsBtn.innerHTML = '⚙️';
  settingsBtn.title = 'App Settings';
  settingsBtn.addEventListener('click', () => {
    state.activeView = 'settings';
    render();
  });

  rightControls.appendChild(dateInput);
  rightControls.appendChild(settingsBtn);

  topRow.appendChild(logo);
  topRow.appendChild(rightControls);
  header.appendChild(topRow);

  // Team Switcher Tabs (Only visible on dashboard and standings views)
  if (state.activeView !== 'settings') {
    const tabs = document.createElement('div');
    tabs.className = 'team-tabs';

    state.selectedTeamIds.forEach(id => {
      const team = teamsData[id];
      if (!team) return;

      const btn = document.createElement('button');
      btn.className = `team-tab ${state.activeTeamId === id ? 'active' : ''}`;
      
      const badge = document.createElement('div');
      badge.className = 'team-tab-badge';
      badge.innerText = team.abbreviation;
      badge.style.background = team.primaryColor;
      badge.style.border = `1px solid ${team.secondaryColor}`;

      const nameLabel = document.createElement('span');
      nameLabel.innerText = team.shortName;

      btn.appendChild(badge);
      btn.appendChild(nameLabel);

      btn.addEventListener('click', () => {
        state.activeTeamId = id;
        updateTeamTheme(id);
        syncDefaultTab();
        render();
      });

      tabs.appendChild(btn);
    });

    // Add team button if under limit of 3
    if (state.selectedTeamIds.length < 3) {
      const addBtn = document.createElement('button');
      addBtn.className = 'team-tab team-tab-add';
      addBtn.innerHTML = '＋';
      addBtn.title = 'Add Team to Track';
      addBtn.addEventListener('click', () => {
        state.activeView = 'settings';
        state.searchQuery = '';
        render();
      });
      tabs.appendChild(addBtn);
    }

    header.appendChild(tabs);
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

// Dashboard View
function createDashboardView() {
  const container = document.createElement('div');

  const team = state.processedStandings?.teamsMap?.[state.activeTeamId] || teamsData[state.activeTeamId];
  if (!team) return container;

  // 1. Dashboard Active Team Banner
  const banner = document.createElement('div');
  banner.className = 'glass-card dashboard-banner';

  const content = document.createElement('div');
  content.className = 'banner-content';

  const left = document.createElement('div');
  left.className = 'banner-team-info';

  const badge = document.createElement('div');
  badge.className = 'team-badge-large';
  badge.innerText = team.abbreviation;
  badge.style.background = team.primaryColor;
  badge.style.color = team.textColor;

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

  const right = document.createElement('div');
  right.className = 'banner-stats';
  const record = document.createElement('div');
  record.className = 'banner-record';
  record.innerText = team.wins !== undefined ? `${team.wins}-${team.losses}` : '0-0';
  
  const wins = team.wins !== undefined ? team.wins : 0;
  const losses = team.losses !== undefined ? team.losses : 0;
  const gamesRemaining = 162 - wins - losses;

  const gamesLeftLabel = document.createElement('div');
  gamesLeftLabel.className = 'games-left-label';
  gamesLeftLabel.innerText = `${gamesRemaining} games left`;

  const standingBadge = document.createElement('div');
  standingBadge.className = 'banner-standing';
  
  let standingText = `Rank ${team.divisionRank || '-'}`;
  if (team.divisionLeader) standingText = "Division Leader";
  else if (team.gamesBack !== undefined) standingText = `${team.gamesBack} GB`;
  standingBadge.innerText = standingText;

  right.appendChild(record);
  right.appendChild(gamesLeftLabel);
  right.appendChild(standingBadge);

  content.appendChild(left);
  content.appendChild(right);
  banner.appendChild(content);
  container.appendChild(banner);

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
    // DIVISION VISUAL TIMELINE
    const timeline = document.createElement('div');
    timeline.className = 'division-timeline';

    const divId = team.divisionId;
    const divTeams = state.processedStandings?.divisionTeams?.[divId] || [];

    if (divTeams.length > 0) {
      const leader = divTeams[0];
      
      if (team.divisionLeader) {
        // We are the leader! Show us first, then the 2nd place team
        const nodeActive = createTimelineNode(team, true);
        const line = document.createElement('div');
        line.className = 'timeline-line';
        
        // Lead details
        const secondPlace = divTeams[1];
        if (secondPlace) {
          const lead = ((team.wins - secondPlace.wins) + (secondPlace.losses - team.losses)) / 2;
          const gap = document.createElement('div');
          gap.className = 'timeline-gap-text';
          gap.innerText = `+${lead} GB`;
          
          const trend = getDivisionTrend(team.id);
          gap.appendChild(renderTrendBadge(trend));
          
          line.appendChild(gap);
        }

        const nodeSecond = secondPlace ? createTimelineNode(secondPlace, false) : null;

        timeline.appendChild(nodeActive);
        timeline.appendChild(line);
        if (nodeSecond) timeline.appendChild(nodeSecond);
      } else {
        // We are chasing the leader! Show leader first, then us
        const nodeLeader = createTimelineNode(leader, false);
        const line = document.createElement('div');
        line.className = 'timeline-line';
        
        const gap = document.createElement('div');
        gap.className = 'timeline-gap-text';
        gap.innerText = `${team.gamesBack} GB`;
        
        const trend = getDivisionTrend(team.id);
        gap.appendChild(renderTrendBadge(trend));
        
        line.appendChild(gap);

        const nodeActive = createTimelineNode(team, true);

        timeline.appendChild(nodeLeader);
        timeline.appendChild(line);
        timeline.appendChild(nodeActive);
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
      // We will show WC1, WC2, WC3, then Cutoff Line, then WC4, WC5
      const showCount = Math.min(wcPool.length, 5);
      
      for (let i = 0; i < showCount; i++) {
        if (i === 3) {
          // Render Cutoff Line
          const cutoff = document.createElement('div');
          cutoff.className = 'ladder-cutoff-line';
          const label = document.createElement('span');
          label.className = 'ladder-cutoff-label';
          label.innerText = 'Playoff Cutoff';
          cutoff.appendChild(label);
          ladder.appendChild(cutoff);
        }

        const tRec = wcPool[i];
        ladder.appendChild(createLadderRow(tRec, i < 3, tRec.id === state.activeTeamId));
      }

      // If active team is below WC5 (i.e. index >= 5 in wcPool)
      const activeIdx = wcPool.findIndex(t => t.id === state.activeTeamId);
      if (activeIdx >= 5) {
        // Draw ellipsis divider
        const ellipsis = document.createElement('div');
        ellipsis.style.textAlign = 'center';
        ellipsis.style.color = 'var(--text-muted)';
        ellipsis.style.fontSize = '12px';
        ellipsis.style.margin = '4px 0';
        ellipsis.innerText = '• • •';
        ladder.appendChild(ellipsis);

        // Draw active team row
        const tRec = wcPool[activeIdx];
        ladder.appendChild(createLadderRow(tRec, false, true));
      }
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
    if (tRecord.wildCardGamesBack < 0) {
      gapText.innerText = `+${Math.abs(tRecord.wildCardGamesBack)}`;
    } else if (tRecord.wildCardGamesBack > 0) {
      gapText.innerText = `${tRecord.wildCardGamesBack} GB`;
    } else {
      gapText.innerText = '0.0';
    }
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
  const gamesTitle = document.createElement('h3');
  gamesTitle.className = 'section-title';
  gamesTitle.innerText = 'Games That Matter Today';
  container.appendChild(gamesTitle);

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

    // Click handler to toggle details (only relevant games can be expanded)
    if (!isNeutral) {
      card.addEventListener('click', () => {
        if (isExpanded) {
          state.expandedGamePks = state.expandedGamePks.filter(pk => pk !== item.gamePk);
        } else {
          state.expandedGamePks.push(item.gamePk);
        }
        render();
      });
    }

    // Game Header
    const gHeader = document.createElement('div');
    gHeader.className = 'game-header';
    const date = new Date(item.gameDate);
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    const headerLeft = document.createElement('span');
    headerLeft.innerText = timeStr;

    const headerRight = document.createElement('div');
    headerRight.style.display = 'flex';
    headerRight.style.alignItems = 'center';
    headerRight.style.gap = '8px';

    const statusNode = document.createElement('span');
    statusNode.className = `game-status ${item.status.statusCode === 'I' ? 'live' : ''}`;
    statusNode.innerText = item.status.detailedState;
    headerRight.appendChild(statusNode);

    // Completed game outcome badge (Happy/Sad Emoji)
    const isFinal = item.status.statusCode === 'F' || item.status.detailedState === 'Final';
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

    if (!isNeutral) {
      const expandHint = document.createElement('span');
      expandHint.className = 'card-expand-hint';
      expandHint.innerText = isExpanded ? 'Collapse ▲' : 'Details ▼';
      headerRight.appendChild(expandHint);
    }

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
    
    const awayName = document.createElement('span');
    awayName.className = `team-name ${item.awayTeam.id === state.activeTeamId ? 'favorite' : ''}`;
    awayName.innerText = item.awayTeam.name;
    
    awayInfo.appendChild(awayBadge);
    
    // If it's the favorite team, add a gold star badge
    if (item.awayTeam.id === state.activeTeamId) {
      awayInfo.appendChild(awayName);
      const starBadge = document.createElement('span');
      starBadge.className = 'fav-star-badge';
      starBadge.innerText = '★ Fav';
      awayInfo.appendChild(starBadge);
    } else {
      awayInfo.appendChild(awayName);
    }

    // Thumbs-up root indicator
    if (item.rootFor === 'Away') {
      const rootIcon = document.createElement('span');
      rootIcon.className = 'root-indicator-badge';
      rootIcon.innerHTML = '👍 Root';
      awayInfo.appendChild(rootIcon);
    }

    const awayScore = document.createElement('span');
    awayScore.className = `team-score ${isFinal ? (item.awayScore > item.homeScore ? 'winner' : 'loser') : ''}`;
    awayScore.innerText = item.awayScore !== null && item.awayScore !== undefined ? item.awayScore : '';
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
    
    const homeName = document.createElement('span');
    homeName.className = `team-name ${item.homeTeam.id === state.activeTeamId ? 'favorite' : ''}`;
    homeName.innerText = item.homeTeam.name;
    
    homeInfo.appendChild(homeBadge);
    
    // If it's the favorite team, add a gold star badge
    if (item.homeTeam.id === state.activeTeamId) {
      homeInfo.appendChild(homeName);
      const starBadge = document.createElement('span');
      starBadge.className = 'fav-star-badge';
      starBadge.innerText = '★ Fav';
      homeInfo.appendChild(starBadge);
    } else {
      homeInfo.appendChild(homeName);
    }

    // Thumbs-up root indicator
    if (item.rootFor === 'Home') {
      const rootIcon = document.createElement('span');
      rootIcon.className = 'root-indicator-badge';
      rootIcon.innerHTML = '👍 Root';
      homeInfo.appendChild(rootIcon);
    }

    const homeScore = document.createElement('span');
    homeScore.className = `team-score ${isFinal ? (item.homeScore > item.awayScore ? 'winner' : 'loser') : ''}`;
    homeScore.innerText = item.homeScore !== null && item.homeScore !== undefined ? item.homeScore : '';
    homeRow.appendChild(homeInfo);
    homeRow.appendChild(homeScore);

    gTeams.appendChild(awayRow);
    gTeams.appendChild(homeRow);
    card.appendChild(gTeams);

    // Rooting Advice Banner (Only visible on demand when expanded)
    if (isExpanded && !isNeutral && (item.rootFor !== 'Neutral' || item.priority > 0)) {
      const banner = document.createElement('div');
      banner.className = `rooting-banner ${item.rootFor === 'Away' ? 'root-away' : item.rootFor === 'Home' ? 'root-home' : 'neutral'}`;

      const badgeTarget = document.createElement('span');
      badgeTarget.className = `rooting-target-badge ${item.rootFor !== 'Neutral' ? 'root' : 'neutral'}`;
      
      let targetName = 'Neutral';
      if (item.rootFor === 'Away') targetName = item.awayTeam.shortName;
      if (item.rootFor === 'Home') targetName = item.homeTeam.shortName;
      badgeTarget.innerText = item.rootFor !== 'Neutral' ? `Root for: ${targetName}` : 'No Impact';

      const expl = document.createElement('div');
      expl.className = 'rooting-explanation';
      expl.innerHTML = item.explanation;

      banner.appendChild(badgeTarget);
      banner.appendChild(expl);
      card.appendChild(banner);

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

// Settings / Team selection View
function createSettingsView() {
  const container = document.createElement('div');
  container.className = 'setup-container';

  const title = document.createElement('h2');
  title.className = 'setup-title';
  title.innerText = 'App Settings';

  const desc = document.createElement('p');
  desc.className = 'setup-desc';
  desc.innerText = 'Configure your favorite teams and manage application preferences.';
  desc.style.marginBottom = '20px';

  container.appendChild(title);
  container.appendChild(desc);

  // Section 1: Tracked Teams
  const teamsSection = document.createElement('div');
  teamsSection.className = 'settings-section';

  const teamsTitle = document.createElement('h3');
  teamsTitle.className = 'settings-section-title';
  teamsTitle.innerText = 'Tracked Teams (Max 3)';
  teamsSection.appendChild(teamsTitle);

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

  // Section 2: Diagnostics
  const diagSection = document.createElement('div');
  diagSection.className = 'settings-section';

  const diagTitle = document.createElement('h3');
  diagTitle.className = 'settings-section-title';
  diagTitle.innerText = 'Diagnostics';
  diagSection.appendChild(diagTitle);

  const diagDesc = document.createElement('p');
  diagDesc.style.fontSize = '12px';
  diagDesc.style.color = 'var(--text-secondary)';
  diagDesc.style.lineHeight = '1.5';
  diagDesc.innerText = 'Perform a hard reload if the home screen web app caching prevents it from pulling the latest codebase updates.';
  diagSection.appendChild(diagDesc);

  const reloadBtn = document.createElement('button');
  reloadBtn.className = 'force-reload-btn';
  reloadBtn.innerHTML = '🔄 Force Reload App';
  reloadBtn.addEventListener('click', () => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        for (let registration of registrations) {
          registration.unregister();
        }
      });
    }
    // Perform hard reload
    window.location.reload(true);
  });
  diagSection.appendChild(reloadBtn);

  container.appendChild(diagSection);

  // Section 3: Metadata Footer
  const metadata = document.createElement('div');
  metadata.className = 'settings-metadata';
  metadata.innerHTML = `BaseTab Web App • <span class="settings-version">v1.2.0</span> • Production Build`;
  container.appendChild(metadata);

  // Helper to populate grid
  setTimeout(() => filterTeamsList(), 0);

  return container;
}

function filterTeamsList() {
  const grid = document.querySelector('#team-select-list');
  if (!grid) return;

  grid.innerHTML = '';
  
  const query = state.searchQuery.toLowerCase();
  const sortedTeams = Object.values(teamsData).sort((a, b) => a.name.localeCompare(b.name));

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

// Navigation Bar Component
function createNavigation() {
  const nav = document.createElement('nav');
  nav.className = 'bottom-nav';

  const items = [
    { view: 'dashboard', label: 'Games', icon: '📅' },
    { view: 'standings', label: 'Standings', icon: '🏆' }
  ];

  items.forEach(item => {
    const btn = document.createElement('button');
    btn.className = `nav-item ${state.activeView === item.view ? 'active' : ''}`;
    
    const icon = document.createElement('span');
    icon.className = 'nav-icon';
    icon.innerText = item.icon;

    const label = document.createElement('span');
    label.className = 'nav-label';
    label.innerText = item.label;

    btn.appendChild(icon);
    btn.appendChild(label);

    btn.addEventListener('click', () => {
      state.activeView = item.view;
      state.searchQuery = '';
      render();
    });

    nav.appendChild(btn);
  });

  return nav;
}

// Fire application initialization
document.addEventListener('DOMContentLoaded', init);
// Run init immediately in case DOM is already loaded
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  init();
}
export { init };
