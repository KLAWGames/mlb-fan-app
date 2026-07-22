// Vertical Standings Timeline Experience Component

import { teamsData } from './teamsData.js';

export function createVerticalStandingsView(state, onBack) {
  const container = document.createElement('div');
  container.className = 'vertical-standings-container';

  // Determine initial league (AL = 103, NL = 104) based on active team if present
  let activeLeagueId = 103;
  if (state.activeTeamId && teamsData[state.activeTeamId]) {
    activeLeagueId = teamsData[state.activeTeamId].leagueId || 103;
  }

  // Header Bar
  const header = document.createElement('div');
  header.className = 'vertical-standings-header';

  const leftGroup = document.createElement('div');
  leftGroup.style.cssText = 'display: flex; align-items: center; gap: 10px;';

  const backBtn = document.createElement('button');
  backBtn.style.cssText = 'background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.2); color: #fff; padding: 6px 12px; border-radius: 8px; font-weight: 700; font-size: 13px; cursor: pointer; display: flex; align-items: center; gap: 4px;';
  backBtn.innerHTML = '← Back';
  backBtn.addEventListener('click', () => {
    if (onBack) onBack();
  });
  leftGroup.appendChild(backBtn);

  const title = document.createElement('span');
  title.style.cssText = 'font-family: var(--font-title); font-weight: 800; font-size: 15px; color: #00e5ff; letter-spacing: -0.01em;';
  title.innerText = 'Vertical Standings';
  leftGroup.appendChild(title);

  header.appendChild(leftGroup);

  // League Switcher (AL / NL)
  const leagueToggle = document.createElement('div');
  leagueToggle.style.cssText = 'display: flex; background: rgba(0, 0, 0, 0.4); padding: 3px; border-radius: 8px; border: 1px solid rgba(0, 229, 255, 0.3);';

  const alBtn = document.createElement('button');
  const nlBtn = document.createElement('button');

  const updateToggleStyle = () => {
    const activeStyle = 'background: #00e5ff; color: #071318; font-weight: 800; border: none; padding: 4px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; transition: all 0.2s ease;';
    const inactiveStyle = 'background: transparent; color: #94a3b8; font-weight: 700; border: none; padding: 4px 12px; border-radius: 6px; font-size: 12px; cursor: pointer; transition: all 0.2s ease;';
    alBtn.style.cssText = activeLeagueId === 103 ? activeStyle : inactiveStyle;
    nlBtn.style.cssText = activeLeagueId === 104 ? activeStyle : inactiveStyle;
  };

  alBtn.innerText = 'AL';
  nlBtn.innerText = 'NL';

  alBtn.addEventListener('click', () => {
    if (activeLeagueId !== 103) {
      activeLeagueId = 103;
      updateToggleStyle();
      renderTimeline();
    }
  });

  nlBtn.addEventListener('click', () => {
    if (activeLeagueId !== 104) {
      activeLeagueId = 104;
      updateToggleStyle();
      renderTimeline();
    }
  });

  updateToggleStyle();
  leagueToggle.appendChild(alBtn);
  leagueToggle.appendChild(nlBtn);
  header.appendChild(leagueToggle);

  container.appendChild(header);

  // Key Legend Banner
  const keyBox = document.createElement('div');
  keyBox.className = 'vertical-standings-key-box';
  keyBox.innerText = 'KEY: Small corner circle indicates next opponent. Outlines reflect game status (Green = Win, Red = Loss, Blue Pulsing = Live).';
  container.appendChild(keyBox);

  // Scroll Area for Timeline
  const scrollArea = document.createElement('div');
  scrollArea.className = 'vertical-standings-scroll-area';
  container.appendChild(scrollArea);

  // Main Timeline Rendering Function
  function renderTimeline() {
    scrollArea.innerHTML = '';

    // Retrieve league teams from processedStandings
    const leagueTeams = state.processedStandings?.leagueTeams?.[activeLeagueId] || [];

    if (leagueTeams.length === 0) {
      const emptyMsg = document.createElement('div');
      emptyMsg.style.cssText = 'padding: 40px; text-align: center; color: #94a3b8; font-size: 14px;';
      emptyMsg.innerText = 'Standings data loading or unavailable...';
      scrollArea.appendChild(emptyMsg);
      return;
    }

    // Determine Wild Card Cutoff Team (3rd Wild Card team)
    // Non-division leaders sorted by winning percentage / games back
    const wcPool = leagueTeams.filter(t => !t.divisionLeader).sort((a, b) => {
      const pctA = parseFloat(a.pct || 0);
      const pctB = parseFloat(b.pct || 0);
      if (Math.abs(pctA - pctB) > 0.0005) return pctB - pctA;
      return b.wins - a.wins || a.losses - b.losses;
    });

    const cutoffTeam = wcPool[2] || wcPool[wcPool.length - 1] || leagueTeams[0];

    // Compute relative GB to Wild Card cutoff (positive = ahead of cutoff, negative = behind cutoff)
    const teamsWithPos = leagueTeams.map(team => {
      const gbRel = ((team.wins - cutoffTeam.wins) + (cutoffTeam.losses - team.losses)) / 2;
      return {
        ...team,
        gbRel
      };
    });

    // Find max and min relative GB to establish vertical bounds
    let maxGBAhead = Math.max(...teamsWithPos.map(t => t.gbRel), 2.5);
    let minGBBehind = Math.min(...teamsWithPos.map(t => t.gbRel), -5.0);

    // Round bounds to nice tick values
    maxGBAhead = Math.ceil(maxGBAhead * 2) / 2 + 1.0;
    minGBBehind = Math.floor(minGBBehind * 2) / 2 - 1.0;

    // Timeline pixel scaling: 130px per 1.0 GB = 65px per 0.5 GB
    // Ensures team nodes (38px height) + metadata text (20px height) never overlap vertically at 0.5 GB intervals
    const pxPerGB = 130;
    const topPadding = 80;
    const bottomPadding = 120;

    const zeroLineY = topPadding + (maxGBAhead * pxPerGB);
    const totalHeight = zeroLineY + (Math.abs(minGBBehind) * pxPerGB) + bottomPadding;

    // 3. Group Teams by exact gbRel for Side-by-Side placement of ties and axis row matching
    const gbGroups = {};
    let maxTiedInRow = 1;
    teamsWithPos.forEach(team => {
      const key = team.gbRel.toFixed(1);
      if (!gbGroups[key]) gbGroups[key] = [];
      gbGroups[key].push(team);
      if (gbGroups[key].length > maxTiedInRow) {
        maxTiedInRow = gbGroups[key].length;
      }
    });

    // Content box dimensions:
    // Fits 3 teams easily (~375px width).
    // If 4 or more teams are tied in a single row, extends width to enable smooth horizontal scrolling.
    const minContentWidth = Math.max(375, 78 + (maxTiedInRow * 98) + 20);
    const contentBox = document.createElement('div');
    contentBox.style.cssText = `position: relative; min-width: ${minContentWidth}px; width: ${minContentWidth}px; min-height: ${totalHeight}px; height: ${totalHeight}px;`;

    // 1. Continuous Vertical Axis Line
    const axis = document.createElement('div');
    axis.className = 'vertical-timeline-axis';
    contentBox.appendChild(axis);

    // 4. Render Ticks and Labels (Only show label if a team is in that row OR if it's the 0.0 Wild Card cutoff)
    for (let gb = maxGBAhead; gb >= minGBBehind; gb -= 0.5) {
      const y = zeroLineY - (gb * pxPerGB);
      const isMajor = Math.abs(gb % 1) < 0.01;

      const tick = document.createElement('div');
      tick.className = `vertical-timeline-tick ${isMajor ? 'vertical-timeline-tick-major' : ''}`;
      tick.style.top = `${y}px`;
      contentBox.appendChild(tick);

      const gbKey = gb.toFixed(1);
      const isZero = Math.abs(gb) < 0.01;
      const hasTeam = Boolean(gbGroups[gbKey] && gbGroups[gbKey].length > 0);

      // Show label ONLY if a team is in that row OR if it is the Wild Card cutoff at zero
      if (isZero || hasTeam) {
        const label = document.createElement('div');
        label.className = `vertical-timeline-tick-label ${isZero ? 'div-leader' : ''}`;
        label.style.top = `${y}px`;

        if (isZero) {
          label.style.color = '#fbbf24';
          label.style.textShadow = '0 0 8px rgba(251, 191, 36, 0.5)';
          label.style.lineHeight = '1.1';
          label.innerHTML = `<span style="font-size: 11px; font-weight: 800;">0.0 GB</span><br/><span style="font-size: 8px; font-weight: 800; letter-spacing: 0.04em;">WC CUTOFF</span>`;
        } else {
          const sign = gb > 0 ? '+' : '';
          label.innerText = `${sign}${gb.toFixed(1)} GB`;
        }
        contentBox.appendChild(label);
      }
    }

    // 5. Render Zero Cutoff Line (0.0 GB)
    const cutoffLine = document.createElement('div');
    cutoffLine.className = 'vertical-cutoff-line';
    cutoffLine.style.top = `${zeroLineY}px`;
    contentBox.appendChild(cutoffLine);

    let favoriteNodeEl = null;

    // Schedule array for matchup lookups today
    const schedule = state.rawSchedule || [];

    // Render Team Nodes
    Object.keys(gbGroups).forEach(gbKey => {
      const group = gbGroups[gbKey];
      const gbVal = parseFloat(gbKey);
      const yPos = zeroLineY - (gbVal * pxPerGB) - 19; // Centered on tick mark

      group.forEach((team, colIdx) => {
        // Calculate X position (column offset for ties)
        // Axis line at 70px. Nodes start at 78px, width 92px, gap 6px.
        const xPos = 78 + (colIdx * 98);

        const node = document.createElement('div');
        node.className = 'vertical-team-node';
        node.style.top = `${yPos}px`;
        node.style.left = `${xPos}px`;

        // If team is a division leader, render gold badge directly ABOVE the team node
        if (team.divisionLeader) {
          const leaderBadge = document.createElement('div');
          leaderBadge.className = 'vertical-div-leader-badge';
          leaderBadge.innerHTML = `${team.divisionName || 'Division Leader'} ⭐`;
          node.appendChild(leaderBadge);
        }

        // Check if favorite team
        const isFavorite = team.id === state.activeTeamId;
        if (isFavorite) {
          node.classList.add('favorite');
        }

        // Determine Game & Matchup Status from schedule
        const game = schedule.find(g => g.teams?.away?.team?.id === team.id || g.teams?.home?.team?.id === team.id);

        let statusClass = 'upcoming';
        let metadataText = '';
        let oppTeamId = null;
        let oppAbbr = '';
        let isWin = false;

        if (game) {
          const isAway = game.teams.away.team.id === team.id;
          const oppTeamObj = isAway ? game.teams.home.team : game.teams.away.team;
          oppTeamId = oppTeamObj.id;
          const oppStatic = teamsData[oppTeamId];
          oppAbbr = oppStatic ? oppStatic.abbreviation : oppTeamObj.name.substring(0, 3).toUpperCase();

          const detailedState = game.status?.detailedState || '';
          const statusCode = game.status?.statusCode || '';
          const teamScore = isAway ? game.teams.away.score : game.teams.home.score;
          const oppScore = isAway ? game.teams.home.score : game.teams.away.score;

          if (detailedState.includes('Postponed') || statusCode === 'D' || statusCode === 'DI' || statusCode === 'DR' || detailedState.includes('Cancelled') || detailedState.includes('Suspended')) {
            // Postponed or Suspended Game
            statusClass = 'postponed';
            metadataText = detailedState.includes('Postponed') ? 'Postponed' : (detailedState || 'Postponed');
          } else if (statusCode === 'F' || detailedState.includes('Final') || detailedState.includes('Completed')) {
            // Completed Game: Show Won/Lost + Score (Green for Win, Red for Loss)
            if (teamScore !== null && oppScore !== null) {
              isWin = teamScore > oppScore;
              statusClass = isWin ? 'win' : 'loss';
              metadataText = isWin ? `Won: ${teamScore} - ${oppScore}` : `Lost: ${teamScore} - ${oppScore}`;
            } else {
              statusClass = 'win';
              metadataText = 'Final';
            }
          } else if (statusCode === 'I' || detailedState.includes('In Progress') || detailedState.includes('Live')) {
            // Live Game: Show Live Score + Inning
            statusClass = 'live';
            const inn = game.linescore?.currentInningOrdinal ? `${game.linescore.currentInningOrdinal} INN` : 'LIVE';
            if (teamScore !== null && oppScore !== null) {
              metadataText = `${teamScore} - ${oppScore} (${inn})`;
            } else {
              metadataText = `LIVE - ${inn}`;
            }
          } else {
            // Upcoming Game: Show Start Time
            statusClass = 'upcoming';
            if (game.gameDate) {
              const d = new Date(game.gameDate);
              const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
              metadataText = `Start Time: ${timeStr}`;
            } else {
              metadataText = 'Scheduled';
            }
          }
        } else {
          // No Game Today
          statusClass = 'upcoming';
          metadataText = 'Off Day';
        }

        node.classList.add(statusClass);

        // Render Hot / Cold Streak tag if team is on a streak of 4+ games (W4+ or L4+)
        let streakTag = null;
        let streakTypeClass = null;

        if (team.streakType === 'wins' && team.streakNumber >= 4) {
          streakTag = `🔥 W${team.streakNumber}`;
          streakTypeClass = 'hot';
        } else if (team.streakType === 'losses' && team.streakNumber >= 4) {
          streakTag = `❄️ L${team.streakNumber}`;
          streakTypeClass = 'cold';
        } else if (team.streakCode && team.streakCode !== '-') {
          if (team.streakCode.startsWith('W')) {
            const num = parseInt(team.streakCode.substring(1), 10);
            if (num >= 4) {
              streakTag = `🔥 W${num}`;
              streakTypeClass = 'hot';
            }
          } else if (team.streakCode.startsWith('L')) {
            const num = parseInt(team.streakCode.substring(1), 10);
            if (num >= 4) {
              streakTag = `❄️ L${num}`;
              streakTypeClass = 'cold';
            }
          }
        }

        if (streakTag) {
          const streakBadge = document.createElement('div');
          streakBadge.className = `vertical-streak-badge ${streakTypeClass}`;
          streakBadge.innerText = streakTag;
          node.appendChild(streakBadge);
        }

        // Primary Team Logo & Abbr
        const logoImg = document.createElement('img');
        logoImg.src = `https://a.espncdn.com/i/teamlogos/mlb/500/${team.abbreviation.toLowerCase()}.png`;
        logoImg.alt = team.abbreviation;
        logoImg.style.cssText = 'width: 22px; height: 22px; object-fit: contain; flex-shrink: 0;';
        logoImg.onerror = () => {
          // Fallback to text badge if image load fails
          const fallback = document.createElement('div');
          fallback.style.cssText = `width: 22px; height: 22px; border-radius: 4px; background: ${team.primaryColor}; color: ${team.textColor}; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 800;`;
          fallback.innerText = team.abbreviation.substring(0, 2);
          if (logoImg.parentNode) logoImg.parentNode.replaceChild(fallback, logoImg);
        };
        node.appendChild(logoImg);

        const abbrSpan = document.createElement('span');
        abbrSpan.style.cssText = 'font-family: var(--font-title); font-weight: 800; font-size: 13px; color: #ffffff;';
        abbrSpan.innerText = team.abbreviation;
        node.appendChild(abbrSpan);

        // Small Corner Opponent Circle
        if (oppAbbr) {
          const oppCircle = document.createElement('div');
          oppCircle.className = `vertical-opponent-circle ${statusClass}`;
          
          const oppImg = document.createElement('img');
          oppImg.src = `https://a.espncdn.com/i/teamlogos/mlb/500/${oppAbbr.toLowerCase()}.png`;
          oppImg.style.cssText = 'width: 14px; height: 14px; object-fit: contain;';
          oppImg.onerror = () => {
            oppCircle.innerText = oppAbbr.substring(0, 2);
          };
          oppCircle.appendChild(oppImg);
          node.appendChild(oppCircle);
        }

        // Metadata Text below node (Win/Loss Score, Live Score, or Start Time)
        if (metadataText) {
          const metaDiv = document.createElement('div');
          metaDiv.className = `vertical-node-metadata ${statusClass}`;
          metaDiv.innerText = metadataText;
          node.appendChild(metaDiv);
        }

        contentBox.appendChild(node);

        if (isFavorite) {
          favoriteNodeEl = node;
        }
      });
    });

    scrollArea.appendChild(contentBox);

    // Interaction & Scroll Behavior Requirement:
    // Initial Load: Mount at top of standings, then auto-scroll down to favorite team centered.
    scrollArea.scrollTop = 0;

    setTimeout(() => {
      if (favoriteNodeEl) {
        const targetY = favoriteNodeEl.offsetTop - (scrollArea.clientHeight / 2) + 20;
        scrollArea.scrollTo({
          top: Math.max(0, targetY),
          behavior: 'smooth'
        });
      }
    }, 350);
  }

  renderTimeline();

  return container;
}
