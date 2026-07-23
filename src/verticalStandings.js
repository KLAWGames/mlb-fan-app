// Vertical Standings Timeline Experience Component

import { teamsData } from './teamsData.js';

function getTeamLogoUrl(abbr) {
  if (!abbr) return 'https://a.espncdn.com/i/teamlogos/mlb/500/mlb.png';
  const raw = abbr.toUpperCase();
  const espnLogoMap = {
    'AZ': 'ari',
    'ARI': 'ari',
    'CWS': 'chw',
    'CHW': 'chw',
    'ATH': 'oak',
    'OAK': 'oak',
    'WSH': 'was',
    'WAS': 'was',
    'KC': 'kc',
    'KCR': 'kc',
    'SD': 'sd',
    'SDP': 'sd',
    'SF': 'sf',
    'SFG': 'sf',
    'TB': 'tb',
    'TBR': 'tb'
  };
  const logoCode = espnLogoMap[raw] || raw.toLowerCase();
  return `https://a.espncdn.com/i/teamlogos/mlb/500/${logoCode}.png`;
}

export function createVerticalStandingsView(state, onBack, callbacks = {}) {
  const container = document.createElement('div');
  container.className = 'vertical-standings-container';

  // Determine initial league (AL = 103, NL = 104) based on active team if present
  let activeLeagueId = 103;
  if (state.activeTeamId && teamsData[state.activeTeamId]) {
    activeLeagueId = teamsData[state.activeTeamId].leagueId || 103;
  }

  // Snapshot mode: 'yesterday-start' | 'yesterday-end' | 'today-live'
  let activeSnapshotMode = 'today-live';
  let isPlayingAnimation = false;
  let cancelAnimationRequested = false;

  // Header Bar
  const header = document.createElement('div');
  header.className = 'vertical-standings-header';

  const leftGroup = document.createElement('div');
  leftGroup.style.cssText = 'display: flex; align-items: center; gap: 10px;';

  const backBtn = document.createElement('button');
  backBtn.style.cssText = 'background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.2); color: #fff; padding: 6px 12px; border-radius: 8px; font-weight: 700; font-size: 13px; cursor: pointer; display: flex; align-items: center; gap: 4px;';
  backBtn.innerHTML = '← Back';
  if (!onBack) {
    backBtn.style.display = 'none';
  } else {
    backBtn.addEventListener('click', () => {
      if (isPlayingAnimation) cancelAnimationRequested = true;
      if (onBack) onBack();
    });
  }
  leftGroup.appendChild(backBtn);

  const activeTeamObj = teamsData[state.activeTeamId] || (state.selectedTeamIds && teamsData[state.selectedTeamIds[0]]) || Object.values(teamsData)[0];

  const teamTitleContainer = document.createElement('div');
  teamTitleContainer.style.cssText = 'display: flex; align-items: center; gap: 8px;';

  if (activeTeamObj) {
    const logoBadge = document.createElement('div');
    logoBadge.style.cssText = 'width: 26px; height: 26px; border-radius: 50%; background: #ffffff; display: flex; align-items: center; justify-content: center; padding: 2px; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3); flex-shrink: 0;';
    
    const logoImg = document.createElement('img');
    logoImg.src = getTeamLogoUrl(activeTeamObj.abbreviation);
    logoImg.style.cssText = 'width: 100%; height: 100%; object-fit: contain;';
    logoBadge.appendChild(logoImg);
    teamTitleContainer.appendChild(logoBadge);

    const teamTitleName = document.createElement('span');
    teamTitleName.style.cssText = 'font-family: var(--font-title); font-weight: 800; font-size: 15px; color: var(--text-primary); letter-spacing: -0.01em;';
    teamTitleName.innerText = activeTeamObj.name;
    teamTitleContainer.appendChild(teamTitleName);
  } else {
    const title = document.createElement('span');
    title.style.cssText = 'font-family: var(--font-title); font-weight: 800; font-size: 15px; color: var(--text-primary);';
    title.innerText = 'MLB Standings';
    teamTitleContainer.appendChild(title);
  }

  leftGroup.appendChild(teamTitleContainer);

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
      if (isPlayingAnimation) cancelAnimationRequested = true;
      activeLeagueId = 103;
      updateToggleStyle();
      renderTimeline();
    }
  });

  nlBtn.addEventListener('click', () => {
    if (activeLeagueId !== 104) {
      if (isPlayingAnimation) cancelAnimationRequested = true;
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

  // Motion Control Bar (Snapshot Selectors & Motion Replay Button)
  const motionBar = document.createElement('div');
  motionBar.className = 'vertical-standings-motion-bar';

  const snapshotGroup = document.createElement('div');
  snapshotGroup.className = 'motion-snapshots-group';

  const btnYestStart = document.createElement('button');
  btnYestStart.className = 'motion-snapshot-btn';
  btnYestStart.innerText = 'Yest. Start';

  const btnYestEnd = document.createElement('button');
  btnYestEnd.className = 'motion-snapshot-btn';
  btnYestEnd.innerText = 'Yest. End';

  const btnTodayLive = document.createElement('button');
  btnTodayLive.className = 'motion-snapshot-btn active';
  btnTodayLive.innerText = 'Today Live';

  const updateSnapshotBtnStyles = () => {
    btnYestStart.className = `motion-snapshot-btn ${activeSnapshotMode === 'yesterday-start' ? 'active' : ''}`;
    btnYestEnd.className = `motion-snapshot-btn ${activeSnapshotMode === 'yesterday-end' ? 'active' : ''}`;
    btnTodayLive.className = `motion-snapshot-btn ${activeSnapshotMode === 'today-live' ? 'active' : ''}`;
  };

  btnYestStart.addEventListener('click', () => {
    if (isPlayingAnimation) cancelAnimationRequested = true;
    activeSnapshotMode = 'yesterday-start';
    updateSnapshotBtnStyles();
    updateNodesPosition(false, true);
  });

  btnYestEnd.addEventListener('click', () => {
    if (isPlayingAnimation) cancelAnimationRequested = true;
    activeSnapshotMode = 'yesterday-end';
    updateSnapshotBtnStyles();
    updateNodesPosition(false, true);
  });

  btnTodayLive.addEventListener('click', () => {
    if (isPlayingAnimation) cancelAnimationRequested = true;
    activeSnapshotMode = 'today-live';
    updateSnapshotBtnStyles();
    updateNodesPosition(false, true);
  });

  snapshotGroup.appendChild(btnYestStart);
  snapshotGroup.appendChild(btnYestEnd);
  snapshotGroup.appendChild(btnTodayLive);
  motionBar.appendChild(snapshotGroup);

  // Play / Stop Shift Button
  const playMotionBtn = document.createElement('button');
  playMotionBtn.className = 'motion-play-btn';
  playMotionBtn.innerHTML = '▶ Play Shift';

  playMotionBtn.addEventListener('click', () => {
    if (isPlayingAnimation) {
      cancelAnimationRequested = true;
    } else {
      runMotionReplaySequence();
    }
  });

  motionBar.appendChild(playMotionBtn);
  container.appendChild(motionBar);

  // Banner status for key legend & motion replay info
  const infoBanner = document.createElement('div');
  infoBanner.className = 'vertical-standings-key-box';
  infoBanner.innerText = 'Viewing Live Standings (2:00 AM daily schedule rollover). Tap "Play Shift" to watch guided region animations.';
  container.appendChild(infoBanner);

  // Scroll Area for Timeline
  const scrollArea = document.createElement('div');
  scrollArea.className = 'vertical-standings-scroll-area';
  container.appendChild(scrollArea);

  // References for live nodes and snapshot calculations
  let teamNodesMap = {};
  let tickLabelElements = [];
  let globalZeroLineY = 0;
  let globalPxPerGB = 130;
  let maxGBAheadVal = 2.5;
  let minGBBehindVal = -5.0;

  // Helper to extract snapshot dataset by mode
  function getSnapshotDataset(mode) {
    if (mode === 'yesterday-start') {
      return {
        processed: state.processedStandingsDayBeforeYesterday || state.processedStandingsYesterday || state.processedStandings,
        schedule: state.rawScheduleYesterday || [],
        isPreGame: true
      };
    } else if (mode === 'yesterday-end') {
      return {
        processed: state.processedStandingsYesterday || state.processedStandings,
        schedule: state.rawScheduleYesterday || [],
        isPreGame: false
      };
    } else {
      return {
        processed: state.processedStandings,
        schedule: state.rawSchedule || [],
        isPreGame: false
      };
    }
  }

  function computeSnapshotData(processedData) {
    const leagueTeams = processedData?.leagueTeams?.[activeLeagueId] || [];
    if (leagueTeams.length === 0) return { teamsWithPos: [], cutoffTeam: null };

    const wcPool = leagueTeams.filter(t => !t.divisionLeader).sort((a, b) => {
      const pctA = parseFloat(a.pct || 0);
      const pctB = parseFloat(b.pct || 0);
      if (Math.abs(pctA - pctB) > 0.0005) return pctB - pctA;
      return b.wins - a.wins || a.losses - b.losses;
    });

    const cutoffTeam = wcPool[2] || wcPool[wcPool.length - 1] || leagueTeams[0];

    const teamsWithPos = leagueTeams.map(team => {
      const gbRel = ((team.wins - cutoffTeam.wins) + (cutoffTeam.losses - team.losses)) / 2;
      return {
        ...team,
        gbRel
      };
    });

    return { teamsWithPos, cutoffTeam };
  }

  // Detect teams that gained/lost ground or tied between snapA and snapB
  function getMovingTeams(snapA, snapB) {
    const gbGroupsA = {};
    snapA.teamsWithPos.forEach(t => {
      const k = t.gbRel.toFixed(1);
      gbGroupsA[k] = (gbGroupsA[k] || 0) + 1;
    });

    const gbGroupsB = {};
    snapB.teamsWithPos.forEach(t => {
      const k = t.gbRel.toFixed(1);
      gbGroupsB[k] = (gbGroupsB[k] || 0) + 1;
    });

    return snapB.teamsWithPos.map(teamB => {
      const teamA = snapA.teamsWithPos.find(t => parseInt(t.id, 10) === parseInt(teamB.id, 10));
      const gbA = teamA ? teamA.gbRel : teamB.gbRel;
      const gbB = teamB.gbRel;
      const diff = gbB - gbA;

      const isTiedB = (gbGroupsB[gbB.toFixed(1)] || 0) > 1;
      const isTiedA = (gbGroupsA[gbA.toFixed(1)] || 0) > 1;

      const moved = Math.abs(diff) >= 0.25 || (isTiedB && !isTiedA);

      let shiftLabel = '';
      let shiftClass = '';
      if (diff > 0) {
        shiftLabel = `+${diff.toFixed(1)} GB 📈`;
        shiftClass = 'gain';
      } else if (diff < 0) {
        shiftLabel = `${diff.toFixed(1)} GB 📉`;
        shiftClass = 'loss';
      } else if (isTiedB) {
        shiftLabel = 'TIED 🤝';
        shiftClass = 'tie';
      }

      return {
        ...teamB,
        gbRelStart: gbA,
        gbRelEnd: gbB,
        diff,
        moved,
        shiftLabel,
        shiftClass
      };
    }).filter(t => t.moved);
  }

  // Group moving teams into visible spatial clusters sorted strictly top to bottom (best teams at 1st place first)
  function groupMoversIntoClusters(movers) {
    if (movers.length === 0) return [];
    
    // Sort movers by vertical position (smallest Y = top of page = best team at 1st place)
    const sorted = [...movers].sort((a, b) => {
      const yA = globalZeroLineY - (a.gbRel * globalPxPerGB);
      const yB = globalZeroLineY - (b.gbRel * globalPxPerGB);
      return yA - yB;
    });

    const clusters = [];
    sorted.forEach(team => {
      const teamY = globalZeroLineY - (team.gbRel * globalPxPerGB);
      let cluster = clusters.find(c => Math.abs(c.centerY - teamY) < 220);
      if (!cluster) {
        cluster = { centerY: teamY, teams: [] };
        clusters.push(cluster);
      }
      cluster.teams.push(team);
      cluster.centerY = cluster.teams.reduce((sum, t) => sum + (globalZeroLineY - (t.gbRel * globalPxPerGB)), 0) / cluster.teams.length;
    });

    // Ensure clusters array is strictly ordered from top (best teams) to bottom
    clusters.sort((a, b) => a.centerY - b.centerY);

    return clusters;
  }

  // Main Timeline Rendering Function
  function renderTimeline() {
    scrollArea.innerHTML = '';
    teamNodesMap = {};
    tickLabelElements = [];

    const datasetToday = getSnapshotDataset('today-live');
    const datasetYestEnd = getSnapshotDataset('yesterday-end');
    const datasetYestStart = getSnapshotDataset('yesterday-start');

    const snapToday = computeSnapshotData(datasetToday.processed);
    const snapYestEnd = computeSnapshotData(datasetYestEnd.processed);
    const snapYestStart = computeSnapshotData(datasetYestStart.processed);

    if (snapToday.teamsWithPos.length === 0) {
      const emptyMsg = document.createElement('div');
      emptyMsg.style.cssText = 'padding: 40px; text-align: center; color: #94a3b8; font-size: 14px;';
      emptyMsg.innerText = 'Standings data loading or unavailable...';
      scrollArea.appendChild(emptyMsg);
      return;
    }

    // Determine global maxGBAhead and minGBBehind across all 3 snapshots to keep axis static
    const allGBs = [
      ...snapToday.teamsWithPos.map(t => t.gbRel),
      ...snapYestEnd.teamsWithPos.map(t => t.gbRel),
      ...snapYestStart.teamsWithPos.map(t => t.gbRel)
    ];

    maxGBAheadVal = Math.ceil(Math.max(...allGBs, 2.5) * 2) / 2 + 1.0;
    minGBBehindVal = Math.floor(Math.min(...allGBs, -5.0) * 2) / 2 - 1.0;

    globalPxPerGB = 160;
    const topPadding = 80;
    const bottomPadding = 120;

    globalZeroLineY = topPadding + (maxGBAheadVal * globalPxPerGB);
    const totalHeight = globalZeroLineY + (Math.abs(minGBBehindVal) * globalPxPerGB) + bottomPadding;

    // Find max allocated columns across all 3 snapshots to compute contentBox minWidth
    let maxColsOverall = 1;
    [snapToday, snapYestEnd, snapYestStart].forEach(snap => {
      const assign = computeContinuousTeamColumns(snap.teamsWithPos);
      const cols = Object.values(assign).map(a => a.col);
      const m = cols.length > 0 ? Math.max(...cols) + 1 : 1;
      if (m > maxColsOverall) maxColsOverall = m;
    });

    const minContentWidth = Math.max(400, 78 + (maxColsOverall * 116) + 30);
    const contentBox = document.createElement('div');
    contentBox.style.cssText = `position: relative; min-width: ${minContentWidth}px; width: ${minContentWidth}px; min-height: ${totalHeight}px; height: ${totalHeight}px;`;

    // 1. Continuous Vertical Axis Line
    const axis = document.createElement('div');
    axis.className = 'vertical-timeline-axis';
    contentBox.appendChild(axis);

    // 2. Render Static Ticks and Left Axis Labels
    for (let gb = maxGBAheadVal; gb >= minGBBehindVal; gb -= 0.5) {
      const y = globalZeroLineY - (gb * globalPxPerGB);
      const isMajor = Math.abs(gb % 1) < 0.01;

      const tick = document.createElement('div');
      tick.className = `vertical-timeline-tick ${isMajor ? 'vertical-timeline-tick-major' : ''}`;
      tick.style.top = `${y}px`;
      contentBox.appendChild(tick);

      const gbKey = gb.toFixed(1);
      const isZero = Math.abs(gb) < 0.01;

      const label = document.createElement('div');
      label.className = `vertical-timeline-tick-label ${isZero ? 'div-leader' : ''}`;
      label.style.top = `${y}px`;
      label.setAttribute('data-gb', gbKey);

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
      tickLabelElements.push({ el: label, gbKey, isZero });
    }

    // 3. Render Zero Cutoff Line (0.0 GB)
    const cutoffLine = document.createElement('div');
    cutoffLine.className = 'vertical-cutoff-line';
    cutoffLine.style.top = `${globalZeroLineY}px`;
    contentBox.appendChild(cutoffLine);

    // 4. Create DOM elements for all unique teams in the active league
    const baseTeams = snapToday.teamsWithPos;
    baseTeams.forEach(team => {
      const node = document.createElement('div');
      node.className = 'vertical-team-node';
      node.setAttribute('data-team-id', team.id);

      if (team.id === state.activeTeamId) {
        node.classList.add('favorite');
      }

      contentBox.appendChild(node);
      teamNodesMap[team.id] = node;
    });

    scrollArea.appendChild(contentBox);

    // Initial position update based on activeSnapshotMode
    updateNodesPosition(false);

    // Initial auto-scroll down to favorite team
    scrollArea.scrollTop = 0;
    setTimeout(() => {
      scrollToTeamNode(state.activeTeamId);
    }, 350);
  }

  // Scroll camera to center on a specific team node
  function scrollToTeamNode(teamId) {
    const node = teamNodesMap[teamId];
    if (node) {
      const targetY = node.offsetTop - (scrollArea.clientHeight / 2) + 20;
      scrollArea.scrollTo({
        top: Math.max(0, targetY),
        behavior: 'smooth'
      });
    }
  }

  function getDivisionLetter(team) {
    const divName = team.divisionName || (teamsData[team.id] ? teamsData[team.id].divisionName : '') || '';
    if (divName.includes('East')) return 'E';
    if (divName.includes('Central')) return 'C';
    if (divName.includes('West')) return 'W';
    return '';
  }

  function parseGameData(game, teamIdNum, dataset) {
    if (!game) {
      return {
        statusClass: 'upcoming',
        metadataText: 'Off Day',
        oppAbbr: '',
        isInterleague: false,
        oppLeagueId: null,
        teamScore: null,
        oppScore: null
      };
    }

    const awayId = parseInt(game.teams?.away?.team?.id, 10);
    const isAway = awayId === teamIdNum;
    const oppTeamObj = isAway ? game.teams.home.team : game.teams.away.team;
    const oppTeamId = parseInt(oppTeamObj?.id, 10);

    let oppAbbr = '';
    let oppLeagueId = null;

    const oppStatic = teamsData[oppTeamId];
    if (oppStatic) {
      oppAbbr = oppStatic.abbreviation;
      oppLeagueId = oppStatic.leagueId;
    } else if (oppTeamObj?.name) {
      const found = Object.values(teamsData).find(t => 
        t.name.toLowerCase().includes(oppTeamObj.name.toLowerCase()) || 
        oppTeamObj.name.toLowerCase().includes(t.name.toLowerCase())
      );
      oppAbbr = found ? found.abbreviation : (oppTeamObj.triCode || oppTeamObj.name.substring(0, 3).toUpperCase());
      oppLeagueId = found ? found.leagueId : null;
    }

    const teamLeagueId = teamsData[teamIdNum]?.leagueId || (state.processedStandings?.teamsMap?.[teamIdNum]?.leagueId);
    const isInterleague = Boolean(teamLeagueId && oppLeagueId && teamLeagueId !== oppLeagueId);

    const detailedState = game.status?.detailedState || '';
    const statusCode = game.status?.statusCode || '';
    const teamScore = isAway ? game.teams.away.score : game.teams.home.score;
    const oppScore = isAway ? game.teams.home.score : game.teams.away.score;

    let statusClass = 'upcoming';
    let metadataText = '';

    if (dataset && dataset.isPreGame) {
      statusClass = 'upcoming';
      if (game.gameDate) {
        const d = new Date(game.gameDate);
        const hours = d.getHours() % 12 || 12;
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const ampm = d.getHours() >= 12 ? 'P' : 'A';
        metadataText = `Start: ${hours}:${minutes}${ampm}`;
      } else {
        metadataText = 'Pre-Game';
      }
    } else if (detailedState.includes('Postponed') || statusCode === 'D' || statusCode === 'DI' || statusCode === 'DR' || detailedState.includes('Cancelled') || detailedState.includes('Suspended')) {
      statusClass = 'postponed';
      metadataText = detailedState.includes('Postponed') ? 'Postponed' : (detailedState || 'Postponed');
    } else if (statusCode === 'F' || detailedState.includes('Final') || detailedState.includes('Completed')) {
      if (teamScore !== null && teamScore !== undefined && oppScore !== null && oppScore !== undefined) {
        const isWin = teamScore > oppScore;
        statusClass = isWin ? 'win' : 'loss';
        metadataText = isWin ? `Won: ${teamScore} - ${oppScore}` : `Lost: ${teamScore} - ${oppScore}`;
      } else {
        statusClass = 'win';
        metadataText = 'Final';
      }
    } else if (statusCode === 'I' || detailedState.includes('In Progress') || detailedState.includes('Live')) {
      statusClass = 'live';
      const inn = game.linescore?.currentInningOrdinal ? `${game.linescore.currentInningOrdinal} INN` : 'LIVE';
      if (teamScore !== null && teamScore !== undefined && oppScore !== null && oppScore !== undefined) {
        metadataText = `${teamScore} - ${oppScore} (${inn})`;
      } else {
        metadataText = `LIVE - ${inn}`;
      }
    } else {
      statusClass = 'upcoming';
      if (game.gameDate) {
        const d = new Date(game.gameDate);
        const hours = d.getHours() % 12 || 12;
        const minutes = String(d.getMinutes()).padStart(2, '0');
        const ampm = d.getHours() >= 12 ? 'P' : 'A';
        metadataText = `Start: ${hours}:${minutes}${ampm}`;
      } else {
        metadataText = 'Scheduled';
      }
    }

    return { statusClass, metadataText, oppAbbr, isInterleague, oppLeagueId, teamScore, oppScore, game };
  }

  function createDhGameGroup(gData, gameNum) {
    const group = document.createElement('div');
    group.className = `dh-game-group dh-game-${gameNum}`;

    if (gData.oppAbbr) {
      const oppCircle = document.createElement('div');
      oppCircle.className = `vertical-opponent-circle ${gData.statusClass}`;
      
      if (gData.isInterleague && gData.oppLeagueId) {
        oppCircle.classList.add('interleague-cycle');
        const oppLeagueCode = gData.oppLeagueId === 103 ? 'AL' : 'NL';
        oppCircle.title = `G${gameNum} Interleague vs ${oppLeagueCode} (${gData.oppAbbr})`;

        const oppTeamImg = document.createElement('img');
        oppTeamImg.className = 'opp-team-logo';
        oppTeamImg.src = getTeamLogoUrl(gData.oppAbbr);

        const oppLeagueImg = document.createElement('img');
        oppLeagueImg.className = 'opp-league-logo';
        const oppLeagueSvg = gData.oppLeagueId === 103 
          ? 'https://www.mlbstatic.com/team-logos/league-on-light/103.svg' 
          : 'https://www.mlbstatic.com/team-logos/league-on-light/104.svg';
        oppLeagueImg.src = oppLeagueSvg;

        oppCircle.appendChild(oppTeamImg);
        oppCircle.appendChild(oppLeagueImg);
      } else {
        const oppImg = document.createElement('img');
        oppImg.src = getTeamLogoUrl(gData.oppAbbr);
        oppImg.style.cssText = 'width: 16px; height: 16px; object-fit: contain;';
        oppCircle.appendChild(oppImg);
      }
      group.appendChild(oppCircle);
    }

    if (gData.metadataText) {
      const metaDiv = document.createElement('div');
      metaDiv.className = `vertical-node-metadata ${gData.statusClass}`;
      metaDiv.innerText = `DH G${gameNum}: ${gData.metadataText}`;
      group.appendChild(metaDiv);
    }

    return group;
  }

  // Compute horizontal column assignment for all teams using exact Games Back (gbRel) Y positions
  function computeContinuousTeamColumns(teamsWithPos) {
    if (!teamsWithPos || teamsWithPos.length === 0) return {};

    // Sort teams by gbRel descending (best teams at top of standings first)
    const sorted = [...teamsWithPos].sort((a, b) => b.gbRel - a.gbRel);

    const columnYPositions = {}; // colIndex -> array of Y positions
    const assignments = {}; // teamId -> { col, exactY, gbRel }

    // Minimum vertical spacing between box centers to avoid ANY visual collision.
    // Full node visual footprint: 38px height + 8px padding/border + ~18px metadata pill below + ~8px badges above = ~72px.
    // Use 80px clearance to guarantee zero overlap including metadata pills.
    const minVerticalClearance = 80;

    sorted.forEach(team => {
      // Calculate exact continuous Y position corresponding to exact Games Back
      const exactY = globalZeroLineY - (team.gbRel * globalPxPerGB) - 19;

      let assignedCol = 0;
      while (true) {
        const positions = columnYPositions[assignedCol] || [];
        const hasCollision = positions.some(prevY => Math.abs(prevY - exactY) < minVerticalClearance);

        if (!hasCollision) {
          if (!columnYPositions[assignedCol]) columnYPositions[assignedCol] = [];
          columnYPositions[assignedCol].push(exactY);
          
          const item = {
            col: assignedCol,
            exactY: exactY,
            gbRel: team.gbRel
          };
          assignments[team.id] = item;
          assignments[String(team.id)] = item;
          assignments[parseInt(team.id, 10)] = item;
          break;
        }

        assignedCol++; // Shift to next column if vertical clearance in current column is < 48px
      }
    });

    return assignments;
  }

  // Position a single team node for a target snapshot mode with automatic left-alignment re-indexing
  function setSingleTeamPosition(teamId, mode) {
    const dataset = getSnapshotDataset(mode);
    const snapData = computeSnapshotData(dataset.processed);
    const schedule = dataset.schedule;

    const team = snapData.teamsWithPos.find(t => parseInt(t.id, 10) === parseInt(teamId, 10));
    if (!team) return;

    const node = teamNodesMap[team.id];
    if (!node) return;

    const assignments = computeContinuousTeamColumns(snapData.teamsWithPos);
    const info = assignments[team.id] || assignments[String(team.id)] || assignments[parseInt(team.id, 10)] || { 
      col: 0, 
      exactY: globalZeroLineY - (team.gbRel * globalPxPerGB) - 19, 
      gbRel: team.gbRel 
    };

    const yPos = info.exactY;
    const xPos = 78 + (info.col * 116);

    node.style.top = `${yPos}px`;
    node.style.left = `${xPos}px`;

    node.innerHTML = '';

    if (team.divisionLeader) {
      const leaderBadge = document.createElement('div');
      leaderBadge.className = 'vertical-div-leader-badge';
      leaderBadge.innerHTML = `${team.divisionName || 'Division Leader'} ⭐`;
      node.appendChild(leaderBadge);
    }

    const teamIdNum = parseInt(team.id, 10);
    const teamGames = schedule.filter(g => {
      const awayId = parseInt(g.teams?.away?.team?.id, 10);
      const homeId = parseInt(g.teams?.home?.team?.id, 10);
      return awayId === teamIdNum || homeId === teamIdNum;
    });

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
        if (num >= 4) streakTag = `🔥 W${num}`;
      } else if (team.streakCode.startsWith('L')) {
        const num = parseInt(team.streakCode.substring(1), 10);
        if (num >= 4) streakTag = `❄️ L${num}`;
      }
    }

    if (teamGames.length > 1) {
      // MULTI-GAME / DOUBLEHEADER DAY!
      const g1Data = parseGameData(teamGames[0], teamIdNum, dataset);
      const g2Data = parseGameData(teamGames[1], teamIdNum, dataset);

      node.className = `vertical-team-node doubleheader-node dh-border-cycle-${g1Data.statusClass}-${g2Data.statusClass}`;
      if (team.id === state.activeTeamId) node.classList.add('favorite');

      if (streakTag) {
        const streakBadge = document.createElement('div');
        streakBadge.className = `vertical-streak-badge ${streakTypeClass || 'hot'}`;
        streakBadge.innerText = streakTag;
        node.appendChild(streakBadge);
      }

      const logoBadge = document.createElement('div');
      logoBadge.style.cssText = 'width: 24px; height: 24px; border-radius: 50%; background: #ffffff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; padding: 2px; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);';
      const logoImg = document.createElement('img');
      logoImg.src = getTeamLogoUrl(team.abbreviation);
      logoImg.alt = team.abbreviation;
      logoImg.style.cssText = 'width: 100%; height: 100%; object-fit: contain;';
      logoBadge.appendChild(logoImg);
      node.appendChild(logoBadge);

      const abbrContainer = document.createElement('div');
      abbrContainer.className = 'vertical-team-abbr-container';
      
      const abbrSpan = document.createElement('span');
      abbrSpan.style.cssText = 'font-family: var(--font-title); font-weight: 800; font-size: 13px; color: #ffffff; line-height: 1;';
      abbrSpan.innerText = team.abbreviation;
      abbrContainer.appendChild(abbrSpan);

      const fuseBar = document.createElement('div');
      fuseBar.className = 'fuse-timer-bar';
      const fuseProgress = document.createElement('div');
      fuseProgress.className = 'fuse-timer-progress';
      fuseBar.appendChild(fuseProgress);
      abbrContainer.appendChild(fuseBar);

      node.appendChild(abbrContainer);

      const divLetter = getDivisionLetter(team);
      if (divLetter) {
        const divBadge = document.createElement('div');
        divBadge.className = 'vertical-division-code';
        divBadge.innerText = divLetter;
        node.appendChild(divBadge);
      }

      const dhContentWrapper = document.createElement('div');
      dhContentWrapper.className = 'vertical-dh-content-wrapper';

      const g1Group = createDhGameGroup(g1Data, 1);
      const g2Group = createDhGameGroup(g2Data, 2);

      dhContentWrapper.appendChild(g1Group);
      dhContentWrapper.appendChild(g2Group);
      node.appendChild(dhContentWrapper);

    } else {
      // SINGLE GAME (or 0 games)
      const gameData = parseGameData(teamGames[0], teamIdNum, dataset);

      node.className = 'vertical-team-node ' + gameData.statusClass;
      if (team.id === state.activeTeamId) node.classList.add('favorite');

      if (streakTag) {
        const streakBadge = document.createElement('div');
        streakBadge.className = `vertical-streak-badge ${streakTypeClass || 'hot'}`;
        streakBadge.innerText = streakTag;
        node.appendChild(streakBadge);
      }

      const logoBadge = document.createElement('div');
      logoBadge.style.cssText = 'width: 24px; height: 24px; border-radius: 50%; background: #ffffff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; padding: 2px; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);';
      const logoImg = document.createElement('img');
      logoImg.src = getTeamLogoUrl(team.abbreviation);
      logoImg.alt = team.abbreviation;
      logoImg.style.cssText = 'width: 100%; height: 100%; object-fit: contain;';
      logoBadge.appendChild(logoImg);
      node.appendChild(logoBadge);

      const abbrSpan = document.createElement('span');
      abbrSpan.style.cssText = 'font-family: var(--font-title); font-weight: 800; font-size: 13px; color: #ffffff;';
      abbrSpan.innerText = team.abbreviation;
      node.appendChild(abbrSpan);

      const divLetter = getDivisionLetter(team);
      if (divLetter) {
        const teamDivId = team.divisionId || (teamsData[team.id] ? teamsData[team.id].divisionId : null);
        const teamDivName = team.divisionName || (teamsData[team.id] ? teamsData[team.id].divisionName : null);
        const hasCloseRival = snapData.teamsWithPos.some(other => {
          if (parseInt(other.id, 10) === teamIdNum) return false;
          const otherDivId = other.divisionId || (teamsData[other.id] ? teamsData[other.id].divisionId : null);
          const otherDivName = other.divisionName || (teamsData[other.id] ? teamsData[other.id].divisionName : null);
          const sameDiv = (teamDivId && otherDivId && teamDivId === otherDivId) ||
                          (teamDivName && otherDivName && teamDivName === otherDivName);
          if (!sameDiv) return false;
          return Math.abs(team.gbRel - other.gbRel) <= 1.0;
        });

        const divBadge = document.createElement('div');
        divBadge.className = `vertical-division-code ${hasCloseRival ? 'pulse-rivalry' : ''}`;
        divBadge.innerText = divLetter;
        node.appendChild(divBadge);
      }

      if (gameData.oppAbbr) {
        const oppCircle = document.createElement('div');
        oppCircle.className = `vertical-opponent-circle ${gameData.statusClass} ${gameData.isInterleague ? 'interleague-cycle' : ''}`;

        if (gameData.isInterleague) {
          const oppTeamImg = document.createElement('img');
          oppTeamImg.src = getTeamLogoUrl(gameData.oppAbbr);
          oppTeamImg.className = 'opp-team-logo';

          const oppLeagueImg = document.createElement('img');
          oppLeagueImg.className = 'opp-league-logo';
          const oppLeagueSvg = gameData.oppLeagueId === 103 
            ? 'https://www.mlbstatic.com/team-logos/league-on-light/103.svg' 
            : 'https://www.mlbstatic.com/team-logos/league-on-light/104.svg';
          oppLeagueImg.src = oppLeagueSvg;

          oppCircle.appendChild(oppTeamImg);
          oppCircle.appendChild(oppLeagueImg);
        } else {
          const oppImg = document.createElement('img');
          oppImg.src = getTeamLogoUrl(gameData.oppAbbr);
          oppImg.style.cssText = 'width: 16px; height: 16px; object-fit: contain;';
          oppCircle.appendChild(oppImg);
        }
        node.appendChild(oppCircle);
      }

      if (gameData.metadataText) {
        const metaDiv = document.createElement('div');
        metaDiv.className = `vertical-node-metadata ${gameData.statusClass}`;
        metaDiv.innerText = gameData.metadataText;
        node.appendChild(metaDiv);
      }
    }

    node.style.cursor = 'pointer';
    node.onclick = (e) => {
      e.stopPropagation();
      let activeGame = teamGames[0] || null;
      if (teamGames.length > 1) {
        const cycleMs = 6000;
        const progress = (Date.now() % cycleMs);
        activeGame = progress < 3000 ? teamGames[0] : teamGames[1];
      }
      showTeamActionModal(team, activeGame, mode, teamGames);
    };
  }

  // Interactive Team Action & Game Matchup Modal
  function showTeamActionModal(team, game, mode, teamGames = []) {
    let currentOppAbbr = ''; // Scoped at modal level to prevent ReferenceErrors

    const targetTeamObj = teamsData[team.id] || team;
    const teamPrimary = targetTeamObj.primaryColor || '#00e5ff';
    const teamSecondary = targetTeamObj.secondaryColor || '#0284c7';
    const teamTextColor = targetTeamObj.textColor || '#ffffff';

    const backdrop = document.createElement('div');
    backdrop.className = 'vertical-modal-backdrop';

    const modal = document.createElement('div');
    modal.className = 'vertical-team-action-card';
    modal.style.borderTop = `5px solid ${teamPrimary}`;
    modal.style.boxShadow = `0 10px 30px rgba(0, 0, 0, 0.5), 0 0 20px ${teamPrimary}35`;

    // Helper to open a sub-experience and return to Team Action Modal smoothly when closed
    const openSubView = (callbackFn, arg) => {
      if (!callbackFn) return;
      
      // Smoothly scale & fade out the action modal
      backdrop.classList.add('sub-open');

      // Trigger the sub-experience modal
      callbackFn(arg);

      // Listen for when sub-modal is removed from body and smoothly scale & fade back in
      const observer = new MutationObserver(() => {
        const activeModal = document.querySelector('.recap-backdrop, .modal-overlay, .game-analytics-modal');
        if (!activeModal) {
          observer.disconnect();
          if (backdrop && document.body.contains(backdrop)) {
            backdrop.classList.remove('sub-open');
          }
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
    };

    // Modal Header
    const header = document.createElement('div');
    header.style.cssText = `display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-radius: 12px; margin-bottom: 16px; background: linear-gradient(135deg, ${teamPrimary} 0%, ${teamSecondary} 100%); color: ${teamTextColor}; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3); border: 1.5px solid rgba(255, 255, 255, 0.25);`;

    const teamHeaderInfo = document.createElement('div');
    teamHeaderInfo.style.cssText = 'display: flex; align-items: center; gap: 12px;';

    const logoDisc = document.createElement('div');
    logoDisc.style.cssText = 'width: 44px; height: 44px; border-radius: 50%; background: #ffffff; display: flex; align-items: center; justify-content: center; padding: 4px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35); flex-shrink: 0;';

    const logoImg = document.createElement('img');
    logoImg.src = getTeamLogoUrl(team.abbreviation);
    logoImg.style.cssText = 'width: 100%; height: 100%; object-fit: contain;';
    logoDisc.appendChild(logoImg);
    teamHeaderInfo.appendChild(logoDisc);

    const teamTitleBox = document.createElement('div');
    teamTitleBox.innerHTML = `
      <div style="font-family: var(--font-title); font-size: 18px; font-weight: 900; color: #ffffff;">${team.name || team.abbreviation}</div>
      <div style="font-size: 11.5px; color: rgba(255, 255, 255, 0.85); font-weight: 700;">${team.wins}-${team.losses} | ${team.divisionName || 'MLB Division'}</div>
    `;
    teamHeaderInfo.appendChild(teamTitleBox);
    header.appendChild(teamHeaderInfo);

    const closeBtn = document.createElement('button');
    closeBtn.style.cssText = 'background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.2); color: #fff; width: 32px; height: 32px; border-radius: 50%; font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s ease;';
    closeBtn.innerText = '✕';
    closeBtn.addEventListener('click', () => backdrop.remove());
    header.appendChild(closeBtn);
    modal.appendChild(header);

    // Game Matchup & Full Line Score Box Score Section Container
    let selectedGame = game;
    if (!selectedGame && teamGames && teamGames.length > 0) {
      selectedGame = teamGames[0];
    }
    if (!selectedGame) {
      const teamIdNum = parseInt(team.id, 10);
      const allSchedules = [
        ...(state.rawSchedule || []),
        ...(state.rawScheduleYesterday || []),
        ...(state.rawScheduleDayBeforeYesterday || [])
      ];
      selectedGame = allSchedules.find(g => {
        const awayId = parseInt(g.teams?.away?.team?.id, 10);
        const homeId = parseInt(g.teams?.home?.team?.id, 10);
        return awayId === teamIdNum || homeId === teamIdNum;
      });
    }

    const matchupContainer = document.createElement('div');
    matchupContainer.className = 'vertical-modal-matchup-container';

    function renderMatchupCard(targetGame) {
      matchupContainer.innerHTML = '';
      if (!targetGame) return;

      const dataset = getSnapshotDataset(mode);
      const teamIdNum = parseInt(team.id, 10);

      // If Doubleheader, render Game Switcher Tabs
      if (teamGames && teamGames.length > 1) {
        const tabRow = document.createElement('div');
        tabRow.style.cssText = 'display: flex; gap: 8px; margin-bottom: 12px; background: rgba(0, 0, 0, 0.4); padding: 4px; border-radius: 8px; border: 1px solid rgba(0, 229, 255, 0.2);';

        teamGames.forEach((g, idx) => {
          const gData = parseGameData(g, teamIdNum, dataset);
          const btn = document.createElement('button');
          const isActive = targetGame && (g.gamePk === targetGame.gamePk || g.id === targetGame.id);
          btn.style.cssText = `flex: 1; padding: 6px 8px; border-radius: 6px; font-size: 11px; font-weight: 800; border: none; cursor: pointer; transition: all 0.2s ease; ${
            isActive 
              ? 'background: #00e5ff; color: #071318; box-shadow: 0 0 8px rgba(0, 229, 255, 0.4);' 
              : 'background: transparent; color: #94a3b8;'
          }`;
          btn.innerText = `DH Game ${idx + 1} (${gData.oppAbbr || 'VS'})`;
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            selectedGame = g;
            renderMatchupCard(g);
          });
          tabRow.appendChild(btn);
        });
        matchupContainer.appendChild(tabRow);
      }

      const matchupBox = document.createElement('div');
      matchupBox.className = 'vertical-modal-matchup-box';

      const awayObj = targetGame?.teams?.away;
      const homeObj = targetGame?.teams?.home;

      const isAway = parseInt(awayObj?.team?.id, 10) === teamIdNum;
      const oppTeamObj = isAway ? homeObj?.team : awayObj?.team;
      const oppTeamId = parseInt(oppTeamObj?.id, 10);

      currentOppAbbr = '';
      if (oppTeamId) {
        const oppStatic = teamsData[oppTeamId];
        if (oppStatic) {
          currentOppAbbr = oppStatic.abbreviation;
        } else if (oppTeamObj?.name) {
          const found = Object.values(teamsData).find(t => 
            t.name.toLowerCase().includes(oppTeamObj.name.toLowerCase()) || 
            oppTeamObj.name.toLowerCase().includes(t.name.toLowerCase())
          );
          currentOppAbbr = found ? found.abbreviation : (oppTeamObj.triCode || oppTeamObj.name.substring(0, 3).toUpperCase());
        }
      }

      const awayName = awayObj?.team?.name || 'Away';
      const homeName = homeObj?.team?.name || 'Home';
      const awayAbbr = teamsData[awayObj?.team?.id]?.abbreviation || (awayName !== 'Away' ? awayName.substring(0, 3).toUpperCase() : team.abbreviation);
      const homeAbbr = teamsData[homeObj?.team?.id]?.abbreviation || (homeName !== 'Home' ? homeName.substring(0, 3).toUpperCase() : (currentOppAbbr || 'OPP'));

      const awayScore = awayObj?.score !== null && awayObj?.score !== undefined ? awayObj.score : '-';
      const homeScore = homeObj?.score !== null && homeObj?.score !== undefined ? homeObj.score : '-';

      const statusText = targetGame?.status?.detailedState || 'Game Matchup';

      matchupBox.innerHTML = `
        <div style="font-size: 11px; font-weight: 800; color: var(--color-gold); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">Game Matchup & Box Score (${statusText})</div>
        <div style="display: flex; align-items: center; justify-content: space-around; background: var(--bg-card); padding: 12px; border-radius: 10px; border: 1px solid var(--border-glass-highlight);">
          <div style="text-align: center; display: flex; flex-direction: column; align-items: center;">
            <div style="width: 34px; height: 34px; border-radius: 50%; background: #ffffff; display: flex; align-items: center; justify-content: center; padding: 2px; box-shadow: 0 1px 4px rgba(0,0,0,0.4); margin-bottom: 4px;">
              <img src="${getTeamLogoUrl(awayAbbr)}" style="width: 100%; height: 100%; object-fit: contain;" />
            </div>
            <div style="font-weight: 800; font-size: 12px; color: var(--text-primary);">${awayAbbr}</div>
            <div style="font-size: 18px; font-weight: 900; color: var(--color-gold);">${awayScore}</div>
          </div>
          <div style="font-size: 13px; font-weight: 800; color: var(--text-muted);">VS</div>
          <div style="text-align: center; display: flex; flex-direction: column; align-items: center;">
            <div style="width: 34px; height: 34px; border-radius: 50%; background: #ffffff; display: flex; align-items: center; justify-content: center; padding: 2px; box-shadow: 0 1px 4px rgba(0,0,0,0.4); margin-bottom: 4px;">
              <img src="${getTeamLogoUrl(homeAbbr)}" style="width: 100%; height: 100%; object-fit: contain;" />
            </div>
            <div style="font-weight: 800; font-size: 12px; color: var(--text-primary);">${homeAbbr}</div>
            <div style="font-size: 18px; font-weight: 900; color: var(--color-gold);">${homeScore}</div>
          </div>
        </div>
      `;

      // Retrieve linescore if available
      let linescore = targetGame?.linescore;
      if (!linescore && targetGame?.gamePk) {
        const allRaw = [
          ...(state.rawSchedule || []),
          ...(state.rawScheduleYesterday || []),
          ...(state.rawScheduleDayBeforeYesterday || [])
        ];
        const foundRaw = allRaw.find(sg => sg.gamePk === targetGame.gamePk);
        if (foundRaw && foundRaw.linescore) {
          linescore = foundRaw.linescore;
        }
      }

      // 1. Inning-by-Inning Line Score Table
      if (linescore && linescore.innings && linescore.innings.length > 0) {
        const inningsList = linescore.innings;
        const totalInnings = Math.max(9, inningsList.length);

        let headerColsHtml = '';
        let awayColsHtml = '';
        let homeColsHtml = '';

        for (let i = 1; i <= totalInnings; i++) {
          headerColsHtml += `<th style="padding: 4px 6px; font-weight: 700; color: var(--text-muted);">${i}</th>`;
          const innData = inningsList.find(inn => inn.num === i);
          const awayRuns = innData?.away?.runs !== undefined ? innData.away.runs : '-';
          const homeRuns = innData?.home?.runs !== undefined ? innData.home.runs : '-';
          awayColsHtml += `<td style="padding: 4px 6px; font-weight: 600;">${awayRuns}</td>`;
          homeColsHtml += `<td style="padding: 4px 6px; font-weight: 600;">${homeRuns}</td>`;
        }

        const awayTotals = linescore.teams?.away || {};
        const homeTotals = linescore.teams?.home || {};

        const lineScoreTableHtml = `
          <div style="margin-top: 12px; overflow-x: auto; -webkit-overflow-scrolling: touch; border-radius: 8px; border: 1px solid var(--border-glass-highlight); background: var(--bg-card); padding: 8px 10px;">
            <table style="width: 100%; border-collapse: collapse; font-size: 11.5px; text-align: center; color: var(--text-primary); font-family: var(--font-body);">
              <thead>
                <tr style="border-bottom: 1px solid var(--border-glass); color: var(--text-muted); font-size: 10px; text-transform: uppercase; font-family: var(--font-title);">
                  <th style="text-align: left; padding: 4px 8px; font-weight: 800; min-width: 45px;">Team</th>
                  ${headerColsHtml}
                  <th style="padding: 4px 6px; font-weight: 900; color: var(--color-gold); border-left: 1px solid var(--border-glass);">R</th>
                  <th style="padding: 4px 6px; font-weight: 800; color: var(--text-secondary);">H</th>
                  <th style="padding: 4px 6px; font-weight: 800; color: var(--text-secondary);">E</th>
                </tr>
              </thead>
              <tbody>
                <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.05);">
                  <td style="text-align: left; padding: 6px 8px; font-weight: 800; color: var(--text-primary);">${awayAbbr}</td>
                  ${awayColsHtml}
                  <td style="padding: 6px; font-weight: 900; color: var(--color-gold); border-left: 1px solid var(--border-glass);">${awayTotals.runs ?? awayScore}</td>
                  <td style="padding: 6px; font-weight: 700; color: var(--text-secondary);">${awayTotals.hits ?? '-'}</td>
                  <td style="padding: 6px; font-weight: 700; color: var(--text-secondary);">${awayTotals.errors ?? '-'}</td>
                </tr>
                <tr>
                  <td style="text-align: left; padding: 6px 8px; font-weight: 800; color: var(--text-primary);">${homeAbbr}</td>
                  ${homeColsHtml}
                  <td style="padding: 6px; font-weight: 900; color: var(--color-gold); border-left: 1px solid var(--border-glass);">${homeTotals.runs ?? homeScore}</td>
                  <td style="padding: 6px; font-weight: 700; color: var(--text-secondary);">${homeTotals.hits ?? '-'}</td>
                  <td style="padding: 6px; font-weight: 700; color: var(--text-secondary);">${homeTotals.errors ?? '-'}</td>
                </tr>
              </tbody>
            </table>
          </div>
        `;

        matchupBox.insertAdjacentHTML('beforeend', lineScoreTableHtml);
      }

      // 2. Probable Pitchers (if pre-game)
      const awayPitcher = targetGame?.teams?.away?.probablePitcher?.fullName;
      const homePitcher = targetGame?.teams?.home?.probablePitcher?.fullName;
      if (awayPitcher || homePitcher) {
        const pitcherInfoHtml = `
          <div style="margin-top: 10px; padding: 8px 10px; background: var(--bg-card); border-radius: 8px; border: 1px solid var(--border-glass); font-size: 11px; display: flex; flex-direction: column; gap: 4px; color: var(--text-secondary);">
            <div style="font-weight: 800; font-size: 10px; text-transform: uppercase; color: var(--color-gold); font-family: var(--font-title);">Probable Pitchers</div>
            <div style="display: flex; justify-content: space-between;">
              <span><strong>${awayAbbr}:</strong> ${awayPitcher || 'TBD'}</span>
              <span><strong>${homeAbbr}:</strong> ${homePitcher || 'TBD'}</span>
            </div>
          </div>
        `;
        matchupBox.insertAdjacentHTML('beforeend', pitcherInfoHtml);
      }

      // 3. View Full Box Score & Pitcher Analytics Action Button
      if (callbacks && callbacks.openGameAnalytics) {
        const boxScoreBtn = document.createElement('button');
        boxScoreBtn.className = 'vertical-action-card-btn';
        boxScoreBtn.style.cssText = 'width: 100%; margin-top: 12px; padding: 10px 14px; background: linear-gradient(135deg, #00e5ff 0%, #0284c7 100%); color: #071318; border: none; border-radius: 10px; font-size: 12.5px; font-weight: 800; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 4px 12px rgba(0, 229, 255, 0.25); transition: all 0.2s ease; outline: none;';
        boxScoreBtn.innerHTML = `<span>📊</span> <span>Full Box Score & Pitcher Analytics</span>`;
        boxScoreBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          openSubView(callbacks.openGameAnalytics, targetGame);
        });
        matchupBox.appendChild(boxScoreBtn);
      }

      matchupContainer.appendChild(matchupBox);
    }

    renderMatchupCard(selectedGame);
    modal.appendChild(matchupContainer);

    // Quick Action Buttons
    const actionsHeader = document.createElement('div');
    actionsHeader.style.cssText = 'font-size: 11px; font-weight: 800; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin: 16px 0 10px 0;';
    actionsHeader.innerText = 'Team Quick Actions';
    modal.appendChild(actionsHeader);

    const actionGrid = document.createElement('div');
    actionGrid.className = 'vertical-action-grid';

    // 1. Games That Matter
    if (callbacks.openGamesThatMatter) {
      const btn = document.createElement('button');
      btn.className = 'vertical-action-card-btn';
      btn.innerHTML = `<span class="icon">🎯</span><div><div class="title">Games That Matter</div><div class="sub">Playoff race & rooting guide</div></div>`;
      btn.addEventListener('click', () => {
        openSubView(callbacks.openGamesThatMatter, team.id);
      });
      actionGrid.appendChild(btn);
    }

    // 2. Dual Team Calendar Buttons (Selected Team vs Opposing Team)
    if (callbacks.openTeamCalendar) {
      const calRow = document.createElement('div');
      calRow.style.cssText = 'display: flex; gap: 8px; width: 100%;';

      const btn1 = document.createElement('button');
      btn1.className = 'vertical-action-card-btn';
      btn1.style.cssText = 'flex: 1; padding: 10px 12px; gap: 8px; margin: 0; min-width: 0;';
      btn1.innerHTML = `<span class="icon" style="font-size: 18px;">📅</span><div style="min-width: 0;"><div class="title" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${team.abbreviation} Calendar</div><div class="sub" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Team schedule</div></div>`;
      btn1.addEventListener('click', () => {
        openSubView(callbacks.openTeamCalendar, teamsData[team.id] || team);
      });
      calRow.appendChild(btn1);

      let oppTeamObj = null;
      if (currentOppAbbr) {
        oppTeamObj = Object.values(teamsData).find(t => t.abbreviation.toLowerCase() === currentOppAbbr.toLowerCase());
      }

      if (oppTeamObj) {
        const btn2 = document.createElement('button');
        btn2.className = 'vertical-action-card-btn';
        btn2.style.cssText = 'flex: 1; padding: 10px 12px; gap: 8px; margin: 0; min-width: 0;';
        btn2.innerHTML = `<span class="icon" style="font-size: 18px;">📅</span><div style="min-width: 0;"><div class="title" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${currentOppAbbr} Calendar</div><div class="sub" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Opponent schedule</div></div>`;
        btn2.addEventListener('click', () => {
          openSubView(callbacks.openTeamCalendar, oppTeamObj);
        });
        calRow.appendChild(btn2);
      }

      actionGrid.appendChild(calRow);
    }

    // 3. Team Overview Modal (Run Differential Graph, Record, Last 10 & Stats)
    if (callbacks.openTeamOverview) {
      const btn = document.createElement('button');
      btn.className = 'vertical-action-card-btn';
      btn.innerHTML = `<span class="icon">📈</span><div><div class="title">Team Overview</div><div class="sub">Run diff graph, record, last 10 & stats</div></div>`;
      btn.addEventListener('click', () => {
        openSubView(callbacks.openTeamOverview, team.id);
      });
      actionGrid.appendChild(btn);
    }

    // 4. Who's Hot
    if (callbacks.openWhosHot) {
      const btn = document.createElement('button');
      btn.className = 'vertical-action-card-btn';
      btn.innerHTML = `<span class="icon">🔥</span><div><div class="title">Who's Hot</div><div class="sub">Hot hitters, pitchers & streaks</div></div>`;
      btn.addEventListener('click', () => {
        openSubView(callbacks.openWhosHot, team.id);
      });
      actionGrid.appendChild(btn);
    }

    // 5. What Happened Yesterday
    if (callbacks.openWhatHappenedYesterday) {
      const btn = document.createElement('button');
      btn.className = 'vertical-action-card-btn';
      btn.innerHTML = `<span class="icon">⏪</span><div><div class="title">What Happened Yesterday</div><div class="sub">Yesterday's full game recaps & scores</div></div>`;
      btn.addEventListener('click', () => {
        openSubView(callbacks.openWhatHappenedYesterday);
      });
      actionGrid.appendChild(btn);
    }

    modal.appendChild(actionGrid);

    backdrop.appendChild(modal);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) backdrop.remove();
    });

    document.body.appendChild(backdrop);
  }

  let manualPopInTimer = null;

  // Fade out old row labels for disappearing or changing rows
  function fadeOutOldLabels(targetMode) {
    if (manualPopInTimer) {
      clearTimeout(manualPopInTimer);
      manualPopInTimer = null;
    }
    const dataset = getSnapshotDataset(targetMode);
    const snapData = computeSnapshotData(dataset.processed);
    const targetActiveKeys = new Set(snapData.teamsWithPos.map(t => t.gbRel.toFixed(1)));

    tickLabelElements.forEach(({ el, gbKey, isZero }) => {
      const isNewActive = isZero || targetActiveKeys.has(gbKey);
      if (!isNewActive && el.style.display !== 'none') {
        el.classList.add('fade-out');
      }
    });
  }

  // Pop in new row labels AFTER team boxes arrive at their new location
  function popInNewLabels(targetMode) {
    const dataset = getSnapshotDataset(targetMode);
    const snapData = computeSnapshotData(dataset.processed);
    const targetActiveKeys = new Set(snapData.teamsWithPos.map(t => t.gbRel.toFixed(1)));

    tickLabelElements.forEach(({ el, gbKey, isZero }) => {
      const isNewActive = isZero || targetActiveKeys.has(gbKey);
      if (isNewActive) {
        const wasHidden = el.style.display === 'none' || el.classList.contains('fade-out');
        el.style.display = 'block';
        el.classList.remove('fade-out');
        if (wasHidden) {
          el.classList.add('pop-in');
          setTimeout(() => el.classList.remove('pop-in'), 450);
        }
      } else {
        el.style.display = 'none';
        el.classList.remove('fade-out');
      }
    });
  }

  // Step 1: Fade out old row labels for starting rows that will be vacated
  function fadeOldClusterLabels(clusterTeams, targetMode) {
    const dataset = getSnapshotDataset(targetMode);
    const snapData = computeSnapshotData(dataset.processed);
    const targetActiveKeys = new Set(snapData.teamsWithPos.map(t => t.gbRel.toFixed(1)));

    clusterTeams.forEach(team => {
      const startKey = team.gbRelStart !== undefined ? team.gbRelStart.toFixed(1) : null;
      if (startKey && !targetActiveKeys.has(startKey)) {
        const item = tickLabelElements.find(t => t.gbKey === startKey);
        if (item && !item.isZero) {
          item.el.classList.add('fade-out');
        }
      }
    });
  }

  // Step 3: Pop in new row labels AFTER team boxes arrive at their ending locations
  function popInClusterLabels(clusterTeams) {
    clusterTeams.forEach(team => {
      const endKey = team.gbRelEnd !== undefined ? team.gbRelEnd.toFixed(1) : team.gbRel.toFixed(1);
      const item = tickLabelElements.find(t => t.gbKey === endKey);
      if (item) {
        const wasHidden = item.el.style.display === 'none' || item.el.classList.contains('fade-out');
        item.el.style.display = 'block';
        item.el.classList.remove('fade-out');
        if (wasHidden) {
          item.el.classList.add('pop-in');
          setTimeout(() => item.el.classList.remove('pop-in'), 450);
        }
      }
    });
  }

  // Synchronize all left axis tick labels cleanly for a static snapshot mode with manual button support
  function updateNodesPosition(animateScroll = true, isManualButtonClick = false) {
    const dataset = getSnapshotDataset(activeSnapshotMode);
    const snapData = computeSnapshotData(dataset.processed);

    if (isManualButtonClick) {
      // 1. Fade out old labels for rows that are being vacated
      fadeOutOldLabels(activeSnapshotMode);

      // 2. Animate team node card positions to target snapshot
      snapData.teamsWithPos.forEach(team => {
        setSingleTeamPosition(team.id, activeSnapshotMode);
      });

      // 3. Pop in new labels AFTER team boxes arrive at their new location (~1250ms)
      manualPopInTimer = setTimeout(() => {
        popInNewLabels(activeSnapshotMode);
        manualPopInTimer = null;
      }, 1250);
    } else {
      popInNewLabels(activeSnapshotMode);

      snapData.teamsWithPos.forEach(team => {
        setSingleTeamPosition(team.id, activeSnapshotMode);
      });
    }

    if (animateScroll) {
      scrollToTeamNode(state.activeTeamId);
    }
  }

  // Guided Region Motion Replay: Always starts at top (best teams) and moves down section by section
  async function runMotionReplaySequence() {
    isPlayingAnimation = true;
    cancelAnimationRequested = false;

    playMotionBtn.innerHTML = '⏹ Stop';
    playMotionBtn.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
    playMotionBtn.style.color = '#ffffff';

    const snapYestStart = computeSnapshotData(getSnapshotDataset('yesterday-start').processed);
    const snapYestEnd = computeSnapshotData(getSnapshotDataset('yesterday-end').processed);
    const snapTodayLive = computeSnapshotData(getSnapshotDataset('today-live').processed);

    // PASS 1: Yesterday Standings Shift (Ordered Top to Bottom starting at 1st place)
    const moversYesterday = getMovingTeams(snapYestStart, snapYestEnd);
    const clustersYesterday = groupMoversIntoClusters(moversYesterday);

    // Baseline: Yesterday Start (Labels are 100% synced to Yesterday Start occupied rows)
    activeSnapshotMode = 'yesterday-start';
    updateSnapshotBtnStyles();
    updateNodesPosition(false);

    // Camera mounts at the very top of the standings (best teams)
    scrollArea.scrollTo({ top: 0, behavior: 'smooth' });
    await new Promise(r => setTimeout(r, 600));

    if (clustersYesterday.length === 0) {
      infoBanner.innerText = 'PASS 1/2: Yesterday Shift — No standings shifts yesterday.';
      await new Promise(r => setTimeout(r, 800));
    } else {
      infoBanner.innerText = `PASS 1/2: Yesterday Shift — Starting at top of standings (1st Place)...`;
      await new Promise(r => setTimeout(r, 600));

      for (let c = 0; c < clustersYesterday.length; c++) {
        if (cancelAnimationRequested) break;
        const cluster = clustersYesterday[c];
        const teamNames = cluster.teams.map(t => t.name).join(', ');

        infoBanner.innerText = `PASS 1/2 (Yesterday Region ${c + 1}/${clustersYesterday.length}): ${teamNames}`;

        // 1. Scroll camera smoothly to center this section in the viewport frame
        scrollArea.scrollTo({
          top: Math.max(0, cluster.centerY - (scrollArea.clientHeight / 2) + 20),
          behavior: 'smooth'
        });
        await new Promise(r => setTimeout(r, 600));
        if (cancelAnimationRequested) break;

        // 2. Attach focus glow rings to teams in this section BEFORE movement
        cluster.teams.forEach(team => {
          const node = teamNodesMap[team.id];
          if (node) {
            node.classList.add('animating-focus');
          }
        });

        // 3. STEP 1: OLD LABEL FADES AWAY BEFORE CARD MOVEMENT
        fadeOldClusterLabels(cluster.teams, 'yesterday-end');
        await new Promise(r => setTimeout(r, 300));
        if (cancelAnimationRequested) break;

        // 4. STEP 2: TEAM BOX MOVES TO NEW LOCATION!
        activeSnapshotMode = 'yesterday-end';
        updateSnapshotBtnStyles();
        cluster.teams.forEach(team => {
          setSingleTeamPosition(team.id, 'yesterday-end');
        });

        // Wait 1.25s for team boxes to physically glide and arrive at their new location
        await new Promise(r => setTimeout(r, 1250));
        if (cancelAnimationRequested) break;

        // 5. STEP 3: NEW LABEL POPS IN AFTER TEAM BOX ARRIVES AT NEW LOCATION!
        popInClusterLabels(cluster.teams);

        // Hold final positions for 1.2s so user can absorb the shift & scores!
        await new Promise(r => setTimeout(r, 1200));

        // 6. Clean up focus glow rings before moving to next section
        cluster.teams.forEach(team => {
          const node = teamNodesMap[team.id];
          if (node) {
            node.classList.remove('animating-focus');
          }
        });
      }
    }

    // PASS 2: Today Live Shift (Ordered Top to Bottom starting at 1st place)
    if (!cancelAnimationRequested) {
      const moversToday = getMovingTeams(snapYestEnd, snapTodayLive);
      const clustersToday = groupMoversIntoClusters(moversToday);

      activeSnapshotMode = 'yesterday-end';
      updateSnapshotBtnStyles();
      updateNodesPosition(false);

      // Return camera to top of standings (best teams) for Pass 2
      scrollArea.scrollTo({ top: 0, behavior: 'smooth' });
      await new Promise(r => setTimeout(r, 600));

      if (clustersToday.length === 0) {
        infoBanner.innerText = 'PASS 2/2: Today Live Shift — No standings shifts today yet.';
        await new Promise(r => setTimeout(r, 800));
      } else {
        infoBanner.innerText = `PASS 2/2: Today Live Shift — Starting at top of standings (1st Place)...`;
        await new Promise(r => setTimeout(r, 600));

        for (let c = 0; c < clustersToday.length; c++) {
          if (cancelAnimationRequested) break;
          const cluster = clustersToday[c];
          const teamNames = cluster.teams.map(t => t.name).join(', ');

          infoBanner.innerText = `PASS 2/2 (Today Live Region ${c + 1}/${clustersToday.length}): ${teamNames}`;

          // 1. Scroll camera smoothly to center this section in the viewport frame
          scrollArea.scrollTo({
            top: Math.max(0, cluster.centerY - (scrollArea.clientHeight / 2) + 20),
            behavior: 'smooth'
          });
          await new Promise(r => setTimeout(r, 600));
          if (cancelAnimationRequested) break;

          // 2. Attach focus glow rings to teams in this section BEFORE movement
          cluster.teams.forEach(team => {
            const node = teamNodesMap[team.id];
            if (node) {
              node.classList.add('animating-focus');
            }
          });

          // 3. STEP 1: OLD LABEL FADES AWAY BEFORE CARD MOVEMENT
          fadeOldClusterLabels(cluster.teams, 'today-live');
          await new Promise(r => setTimeout(r, 300));
          if (cancelAnimationRequested) break;

          // 4. STEP 2: TEAM BOX MOVES TO NEW LOCATION!
          activeSnapshotMode = 'today-live';
          updateSnapshotBtnStyles();
          cluster.teams.forEach(team => {
            setSingleTeamPosition(team.id, 'today-live');
          });

          // Wait 1.25s for team boxes to physically glide and arrive at their new location
          await new Promise(r => setTimeout(r, 1250));
          if (cancelAnimationRequested) break;

          // 5. STEP 3: NEW LABEL POPS IN AFTER TEAM BOX ARRIVES AT NEW LOCATION!
          popInClusterLabels(cluster.teams);

          // Hold final positions for 1.2s so user can absorb the shift & scores!
          await new Promise(r => setTimeout(r, 1200));

          // 6. Clean up focus glow rings before moving to next section
          cluster.teams.forEach(team => {
            const node = teamNodesMap[team.id];
            if (node) {
              node.classList.remove('animating-focus');
            }
          });
        }
      }
    }

    // Reset UI state to Today Live
    isPlayingAnimation = false;
    cancelAnimationRequested = false;
    activeSnapshotMode = 'today-live';
    updateSnapshotBtnStyles();
    updateNodesPosition(false);

    scrollToTeamNode(state.activeTeamId);

    playMotionBtn.innerHTML = '▶ Play Shift';
    playMotionBtn.style.background = 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)';
    playMotionBtn.style.color = '#000000';
    infoBanner.innerText = 'Replay complete! Tap any step or "Play Shift" to run again.';
  }

  renderTimeline();

  return container;
}
