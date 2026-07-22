// Vertical Standings Timeline Experience Component

import { teamsData } from './teamsData.js';

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
  backBtn.addEventListener('click', () => {
    if (isPlayingAnimation) cancelAnimationRequested = true;
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

    globalPxPerGB = 130;
    const topPadding = 80;
    const bottomPadding = 120;

    globalZeroLineY = topPadding + (maxGBAheadVal * globalPxPerGB);
    const totalHeight = globalZeroLineY + (Math.abs(minGBBehindVal) * globalPxPerGB) + bottomPadding;

    // Find max tied teams across all 3 snapshots to compute contentBox minWidth
    let maxTiedInRow = 1;
    [snapToday, snapYestEnd, snapYestStart].forEach(snap => {
      const gbGroups = {};
      snap.teamsWithPos.forEach(t => {
        const k = t.gbRel.toFixed(1);
        gbGroups[k] = (gbGroups[k] || 0) + 1;
        if (gbGroups[k] > maxTiedInRow) maxTiedInRow = gbGroups[k];
      });
    });

    const minContentWidth = Math.max(375, 78 + (maxTiedInRow * 98) + 20);
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

  // Position a single team node for a target snapshot mode with automatic left-alignment re-indexing
  function setSingleTeamPosition(teamId, mode) {
    const dataset = getSnapshotDataset(mode);
    const snapData = computeSnapshotData(dataset.processed);
    const schedule = dataset.schedule;

    const team = snapData.teamsWithPos.find(t => parseInt(t.id, 10) === parseInt(teamId, 10));
    if (!team) return;

    const node = teamNodesMap[team.id];
    if (!node) return;

    const gbGroups = {};
    snapData.teamsWithPos.forEach(t => {
      const k = t.gbRel.toFixed(1);
      if (!gbGroups[k]) gbGroups[k] = [];
      gbGroups[k].push(t);
    });

    const gbKey = team.gbRel.toFixed(1);
    const group = gbGroups[gbKey] || [team];
    const colIdx = group.findIndex(t => parseInt(t.id, 10) === parseInt(team.id, 10));
    const col = colIdx >= 0 ? colIdx : 0;

    const yPos = globalZeroLineY - (team.gbRel * globalPxPerGB) - 19;
    const xPos = 78 + (col * 98);

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
    const game = schedule.find(g => {
      const awayId = parseInt(g.teams?.away?.team?.id, 10);
      const homeId = parseInt(g.teams?.home?.team?.id, 10);
      return awayId === teamIdNum || homeId === teamIdNum;
    });

    let statusClass = 'upcoming';
    let metadataText = '';
    let oppAbbr = '';
    let isWin = false;

    if (game) {
      const awayId = parseInt(game.teams?.away?.team?.id, 10);
      const isAway = awayId === teamIdNum;
      const oppTeamObj = isAway ? game.teams.home.team : game.teams.away.team;
      const oppTeamId = parseInt(oppTeamObj?.id, 10);

      const oppStatic = teamsData[oppTeamId];
      if (oppStatic) {
        oppAbbr = oppStatic.abbreviation;
      } else if (oppTeamObj?.name) {
        const found = Object.values(teamsData).find(t => 
          t.name.toLowerCase().includes(oppTeamObj.name.toLowerCase()) || 
          oppTeamObj.name.toLowerCase().includes(t.name.toLowerCase())
        );
        oppAbbr = found ? found.abbreviation : (oppTeamObj.triCode || oppTeamObj.name.substring(0, 3).toUpperCase());
      }

      const detailedState = game.status?.detailedState || '';
      const statusCode = game.status?.statusCode || '';
      const teamScore = isAway ? game.teams.away.score : game.teams.home.score;
      const oppScore = isAway ? game.teams.home.score : game.teams.away.score;

      if (dataset.isPreGame) {
        statusClass = 'upcoming';
        if (game.gameDate) {
          const d = new Date(game.gameDate);
          const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          metadataText = `Start: ${timeStr}`;
        } else {
          metadataText = 'Pre-Game';
        }
      } else if (detailedState.includes('Postponed') || statusCode === 'D' || statusCode === 'DI' || statusCode === 'DR' || detailedState.includes('Cancelled') || detailedState.includes('Suspended')) {
        statusClass = 'postponed';
        metadataText = detailedState.includes('Postponed') ? 'Postponed' : (detailedState || 'Postponed');
      } else if (statusCode === 'F' || detailedState.includes('Final') || detailedState.includes('Completed')) {
        if (teamScore !== null && oppScore !== null) {
          isWin = teamScore > oppScore;
          statusClass = isWin ? 'win' : 'loss';
          metadataText = isWin ? `Won: ${teamScore} - ${oppScore}` : `Lost: ${teamScore} - ${oppScore}`;
        } else {
          statusClass = 'win';
          metadataText = 'Final';
        }
      } else if (statusCode === 'I' || detailedState.includes('In Progress') || detailedState.includes('Live')) {
        statusClass = 'live';
        const inn = game.linescore?.currentInningOrdinal ? `${game.linescore.currentInningOrdinal} INN` : 'LIVE';
        if (teamScore !== null && oppScore !== null) {
          metadataText = `${teamScore} - ${oppScore} (${inn})`;
        } else {
          metadataText = `LIVE - ${inn}`;
        }
      } else {
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
      statusClass = 'upcoming';
      metadataText = 'Off Day';
    }

    node.className = 'vertical-team-node ' + statusClass;
    if (team.id === state.activeTeamId) {
      node.classList.add('favorite');
    }

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

    const logoBadge = document.createElement('div');
    logoBadge.style.cssText = 'width: 24px; height: 24px; border-radius: 50%; background: #ffffff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; padding: 2px; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);';

    const logoImg = document.createElement('img');
    logoImg.src = `https://a.espncdn.com/i/teamlogos/mlb/500/${team.abbreviation.toLowerCase()}.png`;
    logoImg.alt = team.abbreviation;
    logoImg.style.cssText = 'width: 100%; height: 100%; object-fit: contain;';
    logoImg.onerror = () => {
      const fallback = document.createElement('div');
      fallback.style.cssText = `width: 20px; height: 20px; border-radius: 50%; background: ${team.primaryColor}; color: ${team.textColor}; display: flex; align-items: center; justify-content: center; font-size: 8.5px; font-weight: 800;`;
      fallback.innerText = team.abbreviation.substring(0, 2);
      if (logoBadge.parentNode) logoBadge.replaceChild(fallback, logoImg);
    };
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

        const gbDiff = Math.abs(team.gbRel - other.gbRel);
        return gbDiff <= 1.0;
      });

      const divBadge = document.createElement('div');
      divBadge.className = `vertical-division-code ${hasCloseRival ? 'pulse-rivalry' : ''}`;
      divBadge.innerText = divLetter;
      node.appendChild(divBadge);
    }

    if (oppAbbr) {
      const oppCircle = document.createElement('div');
      oppCircle.className = `vertical-opponent-circle ${statusClass}`;
      
      const oppImg = document.createElement('img');
      oppImg.src = `https://a.espncdn.com/i/teamlogos/mlb/500/${oppAbbr.toLowerCase()}.png`;
      oppImg.style.cssText = 'width: 16px; height: 16px; object-fit: contain;';
      oppImg.onerror = () => {
        oppCircle.innerText = oppAbbr.substring(0, 2);
        oppCircle.style.color = '#0f172a';
        oppCircle.style.fontWeight = '900';
      };
      oppCircle.appendChild(oppImg);
      node.appendChild(oppCircle);
    }

    if (metadataText) {
      const metaDiv = document.createElement('div');
      metaDiv.className = `vertical-node-metadata ${statusClass}`;
      metaDiv.innerText = metadataText;
      node.appendChild(metaDiv);
    }

    node.style.cursor = 'pointer';
    node.onclick = (e) => {
      e.stopPropagation();
      showTeamActionModal(team, game, mode);
    };
  }

  // Interactive Team Action & Game Matchup Modal
  function showTeamActionModal(team, game, mode) {
    const backdrop = document.createElement('div');
    backdrop.className = 'vertical-modal-backdrop';

    const modal = document.createElement('div');
    modal.className = 'vertical-team-action-card';

    // Modal Header
    const header = document.createElement('div');
    header.style.cssText = 'display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(0, 229, 255, 0.2); padding-bottom: 12px; margin-bottom: 16px;';

    const teamHeaderInfo = document.createElement('div');
    teamHeaderInfo.style.cssText = 'display: flex; align-items: center; gap: 12px;';

    const logoDisc = document.createElement('div');
    logoDisc.style.cssText = 'width: 44px; height: 44px; border-radius: 50%; background: #ffffff; display: flex; align-items: center; justify-content: center; padding: 4px; box-shadow: 0 0 12px rgba(0, 229, 255, 0.3); flex-shrink: 0;';

    const logoImg = document.createElement('img');
    logoImg.src = `https://a.espncdn.com/i/teamlogos/mlb/500/${team.abbreviation.toLowerCase()}.png`;
    logoImg.style.cssText = 'width: 100%; height: 100%; object-fit: contain;';
    logoDisc.appendChild(logoImg);
    teamHeaderInfo.appendChild(logoDisc);

    const teamTitleBox = document.createElement('div');
    teamTitleBox.innerHTML = `
      <div style="font-family: var(--font-title); font-size: 18px; font-weight: 900; color: #ffffff;">${team.name || team.abbreviation}</div>
      <div style="font-size: 12px; color: #94a3b8; font-weight: 600;">${team.wins}-${team.losses} | ${team.divisionName || 'MLB Division'}</div>
    `;
    teamHeaderInfo.appendChild(teamTitleBox);
    header.appendChild(teamHeaderInfo);

    const closeBtn = document.createElement('button');
    closeBtn.style.cssText = 'background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.2); color: #fff; width: 32px; height: 32px; border-radius: 50%; font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s ease;';
    closeBtn.innerText = '✕';
    closeBtn.addEventListener('click', () => backdrop.remove());
    header.appendChild(closeBtn);
    modal.appendChild(header);

    // Game Matchup Section
    if (game) {
      const matchupBox = document.createElement('div');
      matchupBox.className = 'vertical-modal-matchup-box';

      const awayObj = game.teams?.away;
      const homeObj = game.teams?.home;

      const awayName = awayObj?.team?.name || 'Away';
      const homeName = homeObj?.team?.name || 'Home';
      const awayAbbr = teamsData[awayObj?.team?.id]?.abbreviation || awayName.substring(0, 3).toUpperCase();
      const homeAbbr = teamsData[homeObj?.team?.id]?.abbreviation || homeName.substring(0, 3).toUpperCase();

      const awayScore = awayObj?.score !== null && awayObj?.score !== undefined ? awayObj.score : '-';
      const homeScore = homeObj?.score !== null && homeObj?.score !== undefined ? homeObj.score : '-';

      const statusText = game.status?.detailedState || 'Scheduled';

      matchupBox.innerHTML = `
        <div style="font-size: 11px; font-weight: 800; color: #00e5ff; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">Game Matchup Info (${statusText})</div>
        <div style="display: flex; align-items: center; justify-content: space-around; background: rgba(0, 0, 0, 0.4); padding: 12px; border-radius: 10px; border: 1px solid rgba(0, 229, 255, 0.2);">
          <div style="text-align: center;">
            <img src="https://a.espncdn.com/i/teamlogos/mlb/500/${awayAbbr.toLowerCase()}.png" style="width: 28px; height: 28px; object-fit: contain; margin-bottom: 2px;" />
            <div style="font-weight: 800; font-size: 12px; color: #fff;">${awayAbbr}</div>
            <div style="font-size: 16px; font-weight: 900; color: #00e5ff;">${awayScore}</div>
          </div>
          <div style="font-size: 13px; font-weight: 800; color: #94a3b8;">VS</div>
          <div style="text-align: center;">
            <img src="https://a.espncdn.com/i/teamlogos/mlb/500/${homeAbbr.toLowerCase()}.png" style="width: 28px; height: 28px; object-fit: contain; margin-bottom: 2px;" />
            <div style="font-weight: 800; font-size: 12px; color: #fff;">${homeAbbr}</div>
            <div style="font-size: 16px; font-weight: 900; color: #00e5ff;">${homeScore}</div>
          </div>
        </div>
      `;

      if (callbacks.openGameAnalytics) {
        const analyticsBtn = document.createElement('button');
        analyticsBtn.className = 'vertical-action-btn primary';
        analyticsBtn.innerHTML = `<span>📊</span> <span>Open Game Analytics Center</span>`;
        analyticsBtn.addEventListener('click', () => {
          backdrop.remove();
          callbacks.openGameAnalytics(game);
        });
        matchupBox.appendChild(analyticsBtn);
      }

      modal.appendChild(matchupBox);
    }

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
        backdrop.remove();
        callbacks.openGamesThatMatter(team.id);
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
        backdrop.remove();
        callbacks.openTeamCalendar(teamsData[team.id] || team);
      });
      calRow.appendChild(btn1);

      let oppTeamObj = null;
      if (oppAbbr) {
        oppTeamObj = Object.values(teamsData).find(t => t.abbreviation.toLowerCase() === oppAbbr.toLowerCase());
      }

      if (oppTeamObj) {
        const btn2 = document.createElement('button');
        btn2.className = 'vertical-action-card-btn';
        btn2.style.cssText = 'flex: 1; padding: 10px 12px; gap: 8px; margin: 0; min-width: 0;';
        btn2.innerHTML = `<span class="icon" style="font-size: 18px;">📅</span><div style="min-width: 0;"><div class="title" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${oppAbbr} Calendar</div><div class="sub" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Opponent schedule</div></div>`;
        btn2.addEventListener('click', () => {
          backdrop.remove();
          callbacks.openTeamCalendar(oppTeamObj);
        });
        calRow.appendChild(btn2);
      }

      actionGrid.appendChild(calRow);
    }

    // 3. Team Overview
    if (callbacks.openTeamOverview) {
      const btn = document.createElement('button');
      btn.className = 'vertical-action-card-btn';
      btn.innerHTML = `<span class="icon">📈</span><div><div class="title">Team Overview</div><div class="sub">Main dashboard & team stats screen</div></div>`;
      btn.addEventListener('click', () => {
        backdrop.remove();
        callbacks.openTeamOverview(team.id);
      });
      actionGrid.appendChild(btn);
    }

    // 4. Who's Hot
    if (callbacks.openWhosHot) {
      const btn = document.createElement('button');
      btn.className = 'vertical-action-card-btn';
      btn.innerHTML = `<span class="icon">🔥</span><div><div class="title">Who's Hot</div><div class="sub">Hot hitters, pitchers & streaks</div></div>`;
      btn.addEventListener('click', () => {
        backdrop.remove();
        callbacks.openWhosHot(team.id);
      });
      actionGrid.appendChild(btn);
    }

    // 5. What Happened Yesterday
    if (callbacks.openWhatHappenedYesterday) {
      const btn = document.createElement('button');
      btn.className = 'vertical-action-card-btn';
      btn.innerHTML = `<span class="icon">⏪</span><div><div class="title">What Happened Yesterday</div><div class="sub">Yesterday's full game recaps & scores</div></div>`;
      btn.addEventListener('click', () => {
        backdrop.remove();
        callbacks.openWhatHappenedYesterday();
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

        // 2. Attach focus glow rings and shift pills to teams in this section BEFORE movement
        cluster.teams.forEach(team => {
          const node = teamNodesMap[team.id];
          if (node) {
            node.classList.add('animating-focus');
            const badge = document.createElement('div');
            badge.className = `vertical-shift-pill ${team.shiftClass}`;
            badge.innerText = team.shiftLabel;
            node.appendChild(badge);
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

        // 6. Clean up focus glow rings and shift pills before moving to next section
        cluster.teams.forEach(team => {
          const node = teamNodesMap[team.id];
          if (node) {
            node.classList.remove('animating-focus');
            const badge = node.querySelector('.vertical-shift-pill');
            if (badge) badge.remove();
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

          // 2. Attach focus glow rings and shift pills to teams in this section BEFORE movement
          cluster.teams.forEach(team => {
            const node = teamNodesMap[team.id];
            if (node) {
              node.classList.add('animating-focus');
              const badge = document.createElement('div');
              badge.className = `vertical-shift-pill ${team.shiftClass}`;
              badge.innerText = team.shiftLabel;
              node.appendChild(badge);
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

          // 6. Clean up focus glow rings and shift pills before moving to next section
          cluster.teams.forEach(team => {
            const node = teamNodesMap[team.id];
            if (node) {
              node.classList.remove('animating-focus');
              const badge = node.querySelector('.vertical-shift-pill');
              if (badge) badge.remove();
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
