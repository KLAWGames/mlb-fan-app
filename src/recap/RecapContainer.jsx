import React, { useState, useEffect } from 'react';
import { RecapThreeCanvas } from './RecapThreeCanvas.jsx';
import { RecapOverlayUI } from './RecapOverlayUI.jsx';

export function RecapContainer({
  activeTeamId,
  yesterdaySchedule = [],
  yesterdayStandings,
  dayBeforeStandings,
  teamsData,
  onClose
}) {
  const [trackedGame, setTrackedGame] = useState(null);
  const [raceTeams, setRaceTeams] = useState([]);
  const [gamesPlayedCount, setGamesPlayedCount] = useState(0);

  useEffect(() => {
    // 1. Find the tracked team's game from yesterday
    const activeIdNum = parseInt(activeTeamId, 10);
    const game = yesterdaySchedule.find(
      g => g.teams?.away?.team?.id === activeIdNum || g.teams?.home?.team?.id === activeIdNum
    );
    
    if (game) {
      // Normalize game details
      const isAway = game.teams.away.team.id === activeIdNum;
      const opponent = isAway ? game.teams.home.team : game.teams.away.team;
      const trackedScore = isAway ? game.teams.away.score : game.teams.home.score;
      const oppScore = isAway ? game.teams.home.score : game.teams.away.score;
      const isWin = trackedScore > oppScore;
      
      // Load inning-by-inning linescore if available
      const innings = game.linescore?.innings || [];
      const formattedInnings = innings.map(inn => ({
        num: inn.num,
        away: inn.away?.runs !== undefined ? inn.away.runs : 0,
        home: inn.home?.runs !== undefined ? inn.home.runs : 0
      }));

      setTrackedGame({
        raw: game,
        opponent,
        isAway,
        trackedScore,
        oppScore,
        isWin,
        innings: formattedInnings.length > 0 ? formattedInnings : [
          { num: 1, away: 0, home: 0 },
          { num: 2, away: 0, home: 0 },
          { num: 3, away: 0, home: 0 },
          { num: 4, away: 0, home: 0 },
          { num: 5, away: 0, home: 0 },
          { num: 6, away: 0, home: 0 },
          { num: 7, away: 0, home: 0 },
          { num: 8, away: 0, home: 0 },
          { num: 9, away: isAway ? trackedScore : oppScore, home: isAway ? oppScore : trackedScore }
        ]
      });
    } else {
      setTrackedGame({
        raw: null,
        opponent: null,
        isAway: false,
        trackedScore: 0,
        oppScore: 0,
        isWin: false,
        innings: []
      });
    }

    // 2. Select the Wild Card contenders for the horse race
    if (dayBeforeStandings && dayBeforeStandings.teamsMap) {
      const activeTeamInfo = dayBeforeStandings.teamsMap[activeIdNum] || teamsData[activeIdNum];
      const leagueId = activeTeamInfo?.leagueId || 103; // Default AL
      const leagueTeamsList = dayBeforeStandings.leagueTeams[leagueId] || [];
      
      // Filter out division leaders to get Wild Card pool
      const wcPool = leagueTeamsList.filter(t => !t.divisionLeader);
      
      // Sort by games back descending (starting position)
      wcPool.sort((a, b) => a.wildCardGamesBack - b.wildCardGamesBack);
      
      const activeWcIndex = wcPool.findIndex(t => t.id === activeIdNum);
      let selectedContenders = [];

      if (activeWcIndex === -1) {
        // Tracked team is a division leader (not in WC pool).
        // Show top 5 wild card contenders, and append tracked team for interest.
        selectedContenders = [...wcPool.slice(0, 5)];
        const mainTeamFromStandings = dayBeforeStandings.teamsMap[activeIdNum];
        if (mainTeamFromStandings && !selectedContenders.some(t => t.id === activeIdNum)) {
          selectedContenders.push(mainTeamFromStandings);
        }
      } else {
        // Tracked team is in WC pool.
        // Include: all teams ahead, the team itself, and 2 teams behind.
        const ahead = wcPool.slice(0, activeWcIndex);
        const self = wcPool[activeWcIndex];
        const behind = wcPool.slice(activeWcIndex + 1, activeWcIndex + 3);
        selectedContenders = [...ahead, self, ...behind];
      }

      // Map starting and ending positions for the horse race
      const maxGamesBack = Math.max(...selectedContenders.map(t => t.wildCardGamesBack), 6.0) + 1.0;

      const raceTeamsData = selectedContenders.map((team, idx) => {
        const teamId = team.id;
        const yesterdayTeamInfo = yesterdayStandings?.teamsMap[teamId] || team;
        
        // Starting pos: MaxGamesBack - dayBeforeGamesBack (higher is further advanced)
        const startPos = maxGamesBack - team.wildCardGamesBack;
        // Ending pos: MaxGamesBack - yesterdayGamesBack
        const endPos = maxGamesBack - yesterdayTeamInfo.wildCardGamesBack;
        
        // Find if they won/lost yesterday
        const teamGame = yesterdaySchedule.find(
          g => g.teams?.away?.team?.id === teamId || g.teams?.home?.team?.id === teamId
        );
        let outcome = 'NO_GAME';
        let runMargin = 0;
        if (teamGame && teamGame.status?.statusCode === 'F') {
          const isAway = teamGame.teams.away.team.id === teamId;
          const score = isAway ? teamGame.teams.away.score : teamGame.teams.home.score;
          const oppScore = isAway ? teamGame.teams.home.score : teamGame.teams.away.score;
          runMargin = score - oppScore;
          outcome = score > oppScore ? 'WIN' : 'LOSS';
        }

        return {
          id: teamId,
          name: team.name,
          shortName: team.shortName || team.name,
          abbreviation: team.abbreviation,
          primaryColor: team.primaryColor || '#999',
          textColor: team.textColor || '#fff',
          startPos,
          endPos,
          outcome,
          runMargin,
          gamesBackStart: team.wildCardGamesBack,
          gamesBackEnd: yesterdayTeamInfo.wildCardGamesBack
        };
      });

      // Sort by starting games back to lay out tracks top-to-bottom
      raceTeamsData.sort((a, b) => a.gamesBackStart - b.gamesBackStart);
      setRaceTeams(raceTeamsData);
    }
    
    setGamesPlayedCount(yesterdaySchedule.length);
  }, [activeTeamId, yesterdaySchedule, yesterdayStandings, dayBeforeStandings, teamsData]);

  return (
    <div style={styles.fullscreen}>
      {/* 3D WebGL Canvas Layer (includes HTML Overlay internally) */}
      <RecapThreeCanvas 
        trackedGame={trackedGame} 
        raceTeams={raceTeams} 
        activeTeamId={parseInt(activeTeamId, 10)}
        onClose={onClose}
        gamesCount={gamesPlayedCount}
      />
    </div>
  );
}

const styles = {
  fullscreen: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100vw',
    height: '100vh',
    background: '#070a13',
    fontFamily: '"Outfit", "Inter", sans-serif',
    color: '#ffffff',
    overflow: 'hidden',
    zIndex: 10000
  }
};
