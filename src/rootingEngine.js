// Core engine to calculate playoff standing impacts and determine who to root for in daily games.

import { teamsData } from './teamsData.js';

// Parse raw standings from MLB Stats API into a rich, structured format with computed Wild Card standings
export function processStandings(rawStandings) {
  const teamsMap = {};
  const leagueTeams = { 103: [], 104: [] };
  const divisionTeams = {};

  if (!rawStandings || !rawStandings.records) return { teamsMap, leagueTeams, divisionTeams };

  // Parse raw records
  for (const record of rawStandings.records) {
    const divId = record.division.id;
    const leagueId = record.league.id;

    if (!divisionTeams[divId]) divisionTeams[divId] = [];

    for (const tr of record.teamRecords) {
      const teamId = tr.team.id;
      const staticInfo = teamsData[teamId] || {
        id: teamId,
        name: tr.team.name,
        shortName: tr.team.name,
        abbreviation: "MLB",
        divisionId: divId,
        divisionName: "Unknown",
        leagueId: leagueId,
        primaryColor: "#082C5C",
        secondaryColor: "#C4CED4",
        textColor: "#FFFFFF"
      };

      const teamRec = {
        ...staticInfo,
        wins: tr.wins,
        losses: tr.losses,
        pct: tr.wins + tr.losses > 0 ? (tr.wins / (tr.wins + tr.losses)).toFixed(3) : "0.000",
        divisionRank: parseInt(tr.divisionRank, 10) || 5,
        gamesBack: tr.gamesBack === "-" ? 0 : parseFloat(tr.gamesBack) || 0,
        divisionLeader: tr.divisionLeader || tr.divisionRank === "1",
        apiMagicNumber: tr.magicNumber || null,
        apiLeagueRank: tr.leagueRank || null,
        apiWildCardRank: tr.wildCardRank || null,
        // Placeholders to be computed
        wildCardRank: null,
        wildCardGamesBack: 0,
        isWildCardSpot: false,
        divisionMagicNumber: null,
        wildCardMagicNumber: null
      };

      teamsMap[teamId] = teamRec;
      leagueTeams[leagueId].push(teamRec);
      divisionTeams[divId].push(teamRec);
    }
  }

  // Sort each division by wins descending, then losses ascending
  for (const divId in divisionTeams) {
    divisionTeams[divId].sort((a, b) => b.wins - a.wins || a.losses - b.losses);
    // Recalculate rank and games back relative to division leader
    const leader = divisionTeams[divId][0];
    divisionTeams[divId].forEach((team, idx) => {
      team.divisionRank = idx + 1;
      team.divisionLeaderName = leader.name;
      if (idx === 0) {
        team.gamesBack = 0;
        team.divisionLeader = true;
      } else {
        team.gamesBack = ((leader.wins - team.wins) + (team.losses - leader.losses)) / 2;
        team.divisionLeader = false;
      }
    });

    // Compute Division Magic Number for the leader
    if (divisionTeams[divId].length > 1) {
      const leader = divisionTeams[divId][0];
      const secondPlace = divisionTeams[divId][1];
      const mn = 163 - leader.wins - secondPlace.losses;
      if (mn <= 162 && mn > 0) {
        leader.divisionMagicNumber = mn;
        leader.divisionChallengerName = secondPlace.name;
      }
    }
  }

  // Process Wild Card for both leagues (103 = AL, 104 = NL)
  [103, 104].forEach(leagueId => {
    const allLeague = leagueTeams[leagueId];
    // Wild Card pool: teams that are NOT division leaders
    const wcPool = allLeague.filter(t => !t.divisionLeader);
    // Sort pool by winning percentage (descending), then by official API rankings
    wcPool.sort((a, b) => {
      const pctA = parseFloat(a.pct);
      const pctB = parseFloat(b.pct);
      if (Math.abs(pctA - pctB) > 0.0005) {
        return pctB - pctA;
      }
      
      // If win percentage is tied, check official leagueRank/wildCardRank from API
      const rankA = parseInt(a.apiLeagueRank, 10);
      const rankB = parseInt(b.apiLeagueRank, 10);
      if (!isNaN(rankA) && !isNaN(rankB)) {
        return rankA - rankB; // Lower rank (e.g. 4) is better than higher rank (e.g. 5)
      }
      
      // Fallback
      return b.wins - a.wins || a.losses - b.losses;
    });

    // Cutoff team is the 3rd wildcard team (index 2 in sorted pool)
    const cutoffTeam = wcPool[2];
    const firstOutTeam = wcPool[3]; // 4th wildcard team (index 3)

    wcPool.forEach((team, idx) => {
      team.wildCardRank = idx + 1;
      team.isWildCardSpot = idx < 3; // Top 3 spots qualify

      if (cutoffTeam) {
        team.wildCardCutoffName = cutoffTeam.name;
        // Compute games back relative to the cutoff (3rd spot)
        // If team is in a wildcard spot, they are "ahead" of cutoff (represented by negative GB)
        const gb = ((cutoffTeam.wins - team.wins) + (team.losses - cutoffTeam.losses)) / 2;
        team.wildCardGamesBack = gb;
      }

      // Compute Wild Card Magic Number if holding a spot
      if (team.isWildCardSpot && firstOutTeam) {
        const mn = 163 - team.wins - firstOutTeam.losses;
        if (mn <= 162 && mn > 0) {
          team.wildCardMagicNumber = mn;
          team.wildCardChallengerName = firstOutTeam.name;
        }
      }
    });
  });

  return { teamsMap, leagueTeams, divisionTeams };
}

// Generate Threat Level (Rivalry Index) for all teams relative to a target team
export function calculateThreatLevels(teamsMap, targetTeamId) {
  const threatLevels = {};
  const target = teamsMap[targetTeamId];

  if (!target) return threatLevels;

  // Initialize threat level for all 30 teams
  for (const tid in teamsMap) {
    const team = teamsMap[tid];
    let threat = 0;

    if (team.id === target.id) {
      // Favorite team itself (very negative threat, we want them to win!)
      threat = -1000;
    } else if (team.leagueId === target.leagueId) {
      // Same League
      if (team.divisionId === target.divisionId) {
        // SAME DIVISION (Highest threat)
        if (target.divisionLeader) {
          // We are leading division. The 2nd place team is our primary threat
          if (team.divisionRank === 2) {
            threat = 100;
          } else {
            threat = 85 - (team.gamesBack * 2);
          }
        } else {
          // We are chasing the leader. The division leader is our primary threat
          if (team.divisionLeader) {
            threat = 98;
          } else if (team.divisionRank < target.divisionRank) {
            // Team is ahead of us in division
            threat = 90 - (team.gamesBack * 2);
          } else {
            // Team is behind us in division
            threat = 45 - (team.gamesBack * 2);
          }
        }
      } else {
        // SAME LEAGUE, DIFFERENT DIVISION (Wild Card Rivals)
        // Check if they are in the Wild Card race
        const targetGb = target.wildCardGamesBack; // games back (positive) or ahead (negative)
        const teamGb = team.wildCardGamesBack;

        // If team is ahead of us in Wild Card
        if (teamGb < targetGb) {
          // We want them to lose so we can catch them
          threat = 75 - (Math.abs(teamGb - targetGb) * 2);
        } else {
          // They are behind us. We want them to lose so they don't catch us
          threat = 65 - (Math.abs(teamGb - targetGb) * 2);
        }
      }
    } else {
      // INTERLEAGUE (Different League)
      // Standard interleague games don't threaten us directly, unless playing a rival.
      threat = 0;
    }

    // Bind minimum threat of 0 for non-target teams
    threatLevels[team.id] = team.id === target.id ? -1000 : Math.max(0, threat);
  }

  return threatLevels;
}

// Analyze matchups for a single favorite team
export function analyzeMatchups(games, processedStandings, favoriteTeamId) {
  const { teamsMap } = processedStandings;
  const favorite = teamsMap[favoriteTeamId];
  if (!favorite) return [];

  const threats = calculateThreatLevels(teamsMap, favoriteTeamId);

  return games.map(game => {
    const awayTeam = teamsMap[game.teams.away.team.id] || { id: game.teams.away.team.id, name: game.teams.away.team.name, shortName: game.teams.away.team.name, abbreviation: "AWY" };
    const homeTeam = teamsMap[game.teams.home.team.id] || { id: game.teams.home.team.id, name: game.teams.home.team.name, shortName: game.teams.home.team.name, abbreviation: "HOM" };

    const awayThreat = threats[awayTeam.id] || 0;
    const homeThreat = threats[homeTeam.id] || 0;

    let rootFor = "Neutral";
    let explanation = "";
    let priority = 0; // Importance of the game (0 to 100)

    if (awayTeam.id === favoriteTeamId) {
      rootFor = "Away";
      if (favorite.divisionLeader) {
        explanation = `This is your team! The ${favorite.shortName} are currently leading the division. Root for a big win today to secure the lead!`;
      } else {
        let wcText = "";
        if (favorite.isWildCardSpot) {
          wcText = ` (+${Math.abs(favorite.wildCardGamesBack).toFixed(1)} up in the Wild Card)`;
        } else {
          wcText = ` (${favorite.wildCardGamesBack.toFixed(1)} GB in the Wild Card)`;
        }
        explanation = `This is your team! The ${favorite.shortName} are currently ${favorite.gamesBack.toFixed(1)} GB in the division${wcText}. Root for a big win today to catch up!`;
      }
      priority = 100;
    } else if (homeTeam.id === favoriteTeamId) {
      rootFor = "Home";
      if (favorite.divisionLeader) {
        explanation = `This is your team! The ${favorite.shortName} are currently leading the division. Root for a big win today to secure the lead!`;
      } else {
        let wcText = "";
        if (favorite.isWildCardSpot) {
          wcText = ` (+${Math.abs(favorite.wildCardGamesBack).toFixed(1)} up in the Wild Card)`;
        } else {
          wcText = ` (${favorite.wildCardGamesBack.toFixed(1)} GB in the Wild Card)`;
        }
        explanation = `This is your team! The ${favorite.shortName} are currently ${favorite.gamesBack.toFixed(1)} GB in the division${wcText}. Root for a big win today to catch up!`;
      }
      priority = 100;
    } else {
      // Simulate who to root for
      if (awayThreat === 0 && homeThreat === 0) {
        rootFor = "Neutral";
        explanation = "This matchup is between two teams in the other league. It does not affect your playoff standings.";
        priority = 0;
      } else if (awayThreat > homeThreat) {
        // We want Away to lose, so root for Home
        rootFor = "Home";
        priority = Math.round(awayThreat - homeThreat);
        explanation = generateExplanation(awayTeam, homeTeam, favorite, true);
      } else if (homeThreat > awayThreat) {
        // We want Home to lose, so root for Away
        rootFor = "Away";
        priority = Math.round(homeThreat - awayThreat);
        explanation = generateExplanation(homeTeam, awayTeam, favorite, false);
      } else {
        // Equal threats
        rootFor = "Neutral";
        explanation = "Both teams represent a similar threat in the standings. A win either way is relatively neutral.";
        priority = 10;
      }
    }

    return {
      gamePk: game.gamePk,
      gameDate: game.gameDate,
      status: game.status,
      awayTeam,
      homeTeam,
      awayScore: game.teams.away.score,
      homeScore: game.teams.home.score,
      rootFor,
      explanation,
      priority,
      threats: { away: awayThreat, home: homeThreat }
    };
  }).sort((a, b) => b.priority - a.priority); // Sort by relevance to the fan!
}

function generateExplanation(threatTeam, targetOpponent, favorite, isAwayThreat) {
  const isDivRival = threatTeam.divisionId === favorite.divisionId;
  const isWcRival = threatTeam.leagueId === favorite.leagueId && !isDivRival;
  
  if (isDivRival) {
    const currentGap = threatTeam.gamesBack - favorite.gamesBack;
    const absGap = Math.abs(currentGap);
    
    if (currentGap > 0) {
      // Favorite is ahead in division
      return `The ${favorite.shortName} are currently ${currentGap.toFixed(1)} games ahead of ${threatTeam.shortName} in the division race. Root for ${targetOpponent.shortName} today: a loss by ${threatTeam.shortName} will extend the division lead to ${(currentGap + 0.5).toFixed(1)} games.`;
    } else if (currentGap < 0) {
      // Favorite is behind in division
      return `The ${favorite.shortName} are currently ${absGap.toFixed(1)} games behind division leader ${threatTeam.shortName}. Root for ${targetOpponent.shortName} today: a loss by ${threatTeam.shortName} will cut the division deficit to ${(absGap - 0.5).toFixed(1)} games.`;
    } else {
      // Tied
      return `The ${favorite.shortName} are currently tied with division rival ${threatTeam.shortName}. Root for ${targetOpponent.shortName} today: a loss by ${threatTeam.shortName} will push the ${favorite.shortName} 0.5 games ahead of them in the division race.`;
    }
  } else if (isWcRival) {
    if (favorite.divisionLeader) {
      const winsDiff = favorite.wins - threatTeam.wins;
      return `The ${favorite.shortName} are leading their division, but ${threatTeam.shortName} is a threat in the league standings (currently ${winsDiff} wins behind them). Root for ${targetOpponent.shortName} to help secure overall league seeding.`;
    } else if (threatTeam.divisionLeader) {
      return `Root for ${targetOpponent.shortName}. Division leader ${threatTeam.shortName} represents a potential threat in overall league playoff seeding.`;
    } else {
      const currentGap = threatTeam.wildCardGamesBack - favorite.wildCardGamesBack;
      const absGap = Math.abs(currentGap);
      
      if (currentGap > 0) {
        // Favorite is ahead in wildcard
        return `The ${favorite.shortName} are currently ${currentGap.toFixed(1)} games ahead of ${threatTeam.shortName} in the Wild Card race. Root for ${targetOpponent.shortName} today: a loss by ${threatTeam.shortName} will widen the Wild Card cushion to ${(currentGap + 0.5).toFixed(1)} games.`;
      } else if (currentGap < 0) {
        // Favorite is behind in wildcard
        return `The ${favorite.shortName} are currently ${absGap.toFixed(1)} games behind ${threatTeam.shortName} in the Wild Card standings. Root for ${targetOpponent.shortName} today: a loss by ${threatTeam.shortName} will shrink the margin to ${(absGap - 0.5).toFixed(1)} games.`;
      } else {
        // Tied
        return `The ${favorite.shortName} are currently tied with Wild Card rival ${threatTeam.shortName}. Root for ${targetOpponent.shortName} today: a loss by ${threatTeam.shortName} will put the ${favorite.shortName} 0.5 games ahead of them in the Wild Card standings.`;
      }
    }
  }
  
  return `Root for ${targetOpponent.shortName}. A loss by ${threatTeam.shortName} is favorable for the ${favorite.shortName}'s overall playoff positioning.`;
}
