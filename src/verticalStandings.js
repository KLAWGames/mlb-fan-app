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
    updateNodesPosition(true);
  });

  btnYestEnd.addEventListener('click', () => {
    if (isPlayingAnimation) cancelAnimationRequested = true;
    activeSnapshotMode = 'yesterday-end';
    updateSnapshotBtnStyles();
    updateNodesPosition(true);
  });

  btnTodayLive.addEventListener('click', () => {
    if (isPlayingAnimation) cancelAnimationRequested = true;
    activeSnapshotMode = 'today-live';
    updateSnapshotBtnStyles();
    updateNodesPosition(true);
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
  infoBanner.innerText = 'Viewing Live Standings. Tap "Play Shift" to watch simultaneous team movements.';
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
        diff,
        moved,
        shiftLabel,
        shiftClass
      };
    }).filter(t => t.moved);
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

  // Position a single team node for a target snapshot mode with automatic left-alignment re-indexing
  function setSingleTeamPosition(teamId, mode) {
    const dataset = getSnapshotDataset(mode);
    const snapData = computeSnapshotData(dataset.processed);
    const schedule = dataset.schedule;

    const team = snapData.teamsWithPos.find(t => parseInt(t.id, 10) === parseInt(teamId, 10));
    if (!team) return;

    const node = teamNodesMap[team.id];
    if (!node) return;

    // Group teams by exact gbRel to compute deterministic left-aligned column positions
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
  }

  // Update all team node positions simultaneously for full snapshot mode
  function updateNodesPosition(animateScroll = true) {
    const dataset = getSnapshotDataset(activeSnapshotMode);
    const snapData = computeSnapshotData(dataset.processed);

    const gbGroups = {};
    snapData.teamsWithPos.forEach(t => {
      const k = t.gbRel.toFixed(1);
      if (!gbGroups[k]) gbGroups[k] = [];
      gbGroups[k].push(t);
    });

    const activeRowKeys = new Set(Object.keys(gbGroups));
    tickLabelElements.forEach(({ el, gbKey, isZero }) => {
      if (isZero || activeRowKeys.has(gbKey)) {
        el.style.display = 'block';
      } else {
        el.style.display = 'none';
      }
    });

    snapData.teamsWithPos.forEach(team => {
      setSingleTeamPosition(team.id, activeSnapshotMode);
    });

    if (animateScroll) {
      scrollToTeamNode(state.activeTeamId);
    }
  }

  // Simultaneous Group Motion Replay: Interacting teams animate simultaneously in the exact same frame!
  async function runMotionReplaySequence() {
    isPlayingAnimation = true;
    cancelAnimationRequested = false;

    playMotionBtn.innerHTML = '⏹ Stop';
    playMotionBtn.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
    playMotionBtn.style.color = '#ffffff';

    const snapYestStart = computeSnapshotData(getSnapshotDataset('yesterday-start').processed);
    const snapYestEnd = computeSnapshotData(getSnapshotDataset('yesterday-end').processed);
    const snapTodayLive = computeSnapshotData(getSnapshotDataset('today-live').processed);

    // PASS 1: Yesterday Standings Shift (All Interacting Teams Animate Simultaneously)
    const moversYesterday = getMovingTeams(snapYestStart, snapYestEnd);

    // Set all teams to Yesterday Start baseline
    activeSnapshotMode = 'yesterday-start';
    updateSnapshotBtnStyles();
    updateNodesPosition(false);

    if (moversYesterday.length === 0) {
      infoBanner.innerText = 'PASS 1/2: Yesterday Shift — No standings shifts yesterday.';
      await new Promise(r => setTimeout(r, 900));
    } else {
      infoBanner.innerText = `PASS 1/2: Yesterday Shift — ${moversYesterday.length} teams shifting simultaneously yesterday...`;
      
      // Center camera on average focal region of moving teams
      const avgY = moversYesterday.reduce((acc, t) => acc + (globalZeroLineY - (t.gbRel * globalPxPerGB)), 0) / moversYesterday.length;
      scrollArea.scrollTo({ top: Math.max(0, avgY - scrollArea.clientHeight / 2), behavior: 'smooth' });
      await new Promise(r => setTimeout(r, 700));

      if (!cancelAnimationRequested) {
        // Attach shift pills and focus glows to ALL moving teams simultaneously
        moversYesterday.forEach(team => {
          const node = teamNodesMap[team.id];
          if (node) {
            node.classList.add('animating-focus');
            const badge = document.createElement('div');
            badge.className = `vertical-shift-pill ${team.shiftClass}`;
            badge.innerText = team.shiftLabel;
            node.appendChild(badge);
          }
        });

        // Trigger simultaneous position update for ALL teams to Yesterday End in one frame!
        activeSnapshotMode = 'yesterday-end';
        updateSnapshotBtnStyles();
        updateNodesPosition(false);

        await new Promise(r => setTimeout(r, 1800));

        // Clean up focus glows and shift pills
        moversYesterday.forEach(team => {
          const node = teamNodesMap[team.id];
          if (node) {
            node.classList.remove('animating-focus');
            const badge = node.querySelector('.vertical-shift-pill');
            if (badge) badge.remove();
          }
        });
      }
    }

    // PASS 2: Today Live Standings Shift (All Interacting Teams Animate Simultaneously)
    if (!cancelAnimationRequested) {
      const moversToday = getMovingTeams(snapYestEnd, snapTodayLive);

      if (moversToday.length === 0) {
        infoBanner.innerText = 'PASS 2/2: Today Live Shift — No standings shifts today yet.';
        await new Promise(r => setTimeout(r, 900));
      } else {
        infoBanner.innerText = `PASS 2/2: Today Live Shift — ${moversToday.length} teams shifting simultaneously today...`;

        const avgY = moversToday.reduce((acc, t) => acc + (globalZeroLineY - (t.gbRel * globalPxPerGB)), 0) / moversToday.length;
        scrollArea.scrollTo({ top: Math.max(0, avgY - scrollArea.clientHeight / 2), behavior: 'smooth' });
        await new Promise(r => setTimeout(r, 700));

        if (!cancelAnimationRequested) {
          // Attach shift pills and focus glows to ALL moving teams simultaneously
          moversToday.forEach(team => {
            const node = teamNodesMap[team.id];
            if (node) {
              node.classList.add('animating-focus');
              const badge = document.createElement('div');
              badge.className = `vertical-shift-pill ${team.shiftClass}`;
              badge.innerText = team.shiftLabel;
              node.appendChild(badge);
            }
          });

          // Trigger simultaneous position update for ALL teams to Today Live in one frame!
          activeSnapshotMode = 'today-live';
          updateSnapshotBtnStyles();
          updateNodesPosition(false);

          await new Promise(r => setTimeout(r, 1800));

          moversToday.forEach(team => {
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

    // Wrap Up Replay
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
