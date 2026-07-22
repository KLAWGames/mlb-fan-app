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
        // Streak info
        streakType: tr.streak?.streakType || null,
        streakNumber: tr.streak?.streakNumber || 0,
        streakCode: tr.streak?.streakCode || '-',
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

  const divOutOfReach = target.gamesBack >= 7.0;

  // Initialize threat level for all 30 teams
  for (const tid in teamsMap) {
    const team = teamsMap[tid];
    let threat = 0;

    if (team.id === target.id) {
      // Favorite team itself
      threat = -1000;
    } else if (team.leagueId === target.leagueId) {
      // Same League
      const targetGb = target.wildCardGamesBack;
      const teamGb = team.wildCardGamesBack;
      const diff = teamGb - targetGb; // < 0 means ahead of target, > 0 means behind target in Wild Card
      
      const isSameDivision = team.divisionId === target.divisionId;

      if (divOutOfReach) {
        // Mode B: Division is out of reach (deficit >= 7.0 GB)
        if (team.divisionLeader) {
          // Division leaders are not our competitors since they don't take wild card spots
          threat = 5;
        } else {
          // Non-leader league teams in Wild Card
          if (diff < 0) {
            // Ahead of us in Wild Card -> Threat to catch!
            threat = 80 - (Math.abs(diff) * 2);
          } else {
            // Trailing us in Wild Card
            // User Rule: If trailing selected team by > 1.0 game, threat = 0 (does not matter)
            if (diff > 1.0) {
              threat = 0;
            } else {
              threat = 70 - (diff * 20); // Within 1.0 game -> Matters!
            }
          }
        }
      } else {
        // Mode A: Division is within reach (deficit < 7.0 GB)
        if (isSameDivision) {
          // SAME DIVISION
          if (target.divisionLeader) {
            // Target is leading division
            // 2nd place team or trailing division rivals
            const gamesBehind = team.gamesBack; // Since target has gamesBack = 0
            if (gamesBehind > 1.0) {
              threat = 0; // Trailing by > 1.0 game -> does not matter
            } else {
              threat = 100 - (gamesBehind * 25); // Within 1.0 game -> Primary threat!
            }
          } else {
            // Target is chasing division leader
            if (team.divisionLeader) {
              // Division leader is ahead of us -> Major threat to catch!
              threat = 98;
            } else if (team.divisionRank < target.divisionRank) {
              // Ahead of us in division -> Threat to catch!
              threat = 90 - (team.gamesBack * 2);
            } else {
              // Behind us in division
              const gamesBehind = team.gamesBack - target.gamesBack;
              if (gamesBehind > 1.0) {
                threat = 0; // Trailing by > 1.0 game -> does not matter
              } else {
                threat = 75 - (gamesBehind * 25); // Within 1.0 game -> Matters!
              }
            }
          }
        } else {
          // SAME LEAGUE, DIFFERENT DIVISION (Wild Card Rivals)
          if (team.divisionLeader) {
            threat = 40;
          } else {
            if (diff < 0) {
              // Ahead of us in Wild Card -> Threat to catch!
              threat = 75 - (Math.abs(diff) * 2);
            } else {
              // Trailing us in Wild Card
              if (diff > 1.0) {
                threat = 0; // Trailing by > 1.0 game -> does not matter
              } else {
                threat = 65 - (diff * 20); // Within 1.0 game -> Matters!
              }
            }
          }
        }
      }
    } else {
      // INTERLEAGUE (Different League)
      threat = 0;
    }

    // Bind minimum threat of 0 for non-target teams
    threatLevels[team.id] = team.id === target.id ? -1000 : Math.max(0, threat);
  }

  return threatLevels;
}

// Analyze matchups for a single favorite team
export function analyzeMatchups(games, processedStandings, favoriteTeamId) {
  if (!processedStandings || !processedStandings.teamsMap) return [];
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
        explanation = `Root for the ${favorite.shortName} today as they look to secure their division lead with a victory!`;
      } else {
        let wcText = "";
        if (favorite.isWildCardSpot) {
          wcText = ` (+${Math.abs(favorite.wildCardGamesBack).toFixed(1)} up in the Wild Card)`;
        } else {
          wcText = ` (${favorite.wildCardGamesBack.toFixed(1)} GB in the Wild Card)`;
        }
        explanation = `Root for the ${favorite.shortName} today as they look to close the division deficit (currently ${favorite.gamesBack.toFixed(1)} GB) and strengthen their Wild Card position${wcText}.`;
      }
      priority = 100;
    } else if (homeTeam.id === favoriteTeamId) {
      rootFor = "Home";
      if (favorite.divisionLeader) {
        explanation = `Root for the ${favorite.shortName} today as they look to secure their division lead with a victory!`;
      } else {
        let wcText = "";
        if (favorite.isWildCardSpot) {
          wcText = ` (+${Math.abs(favorite.wildCardGamesBack).toFixed(1)} up in the Wild Card)`;
        } else {
          wcText = ` (${favorite.wildCardGamesBack.toFixed(1)} GB in the Wild Card)`;
        }
        explanation = `Root for the ${favorite.shortName} today as they look to close the division deficit (currently ${favorite.gamesBack.toFixed(1)} GB) and strengthen their Wild Card position${wcText}.`;
      }
      priority = 100;
    } else {
      // Check for Wild Card frontrunner tempering override
      const isLeagueMatchup = awayTeam.leagueId === favorite.leagueId && homeTeam.leagueId === favorite.leagueId;
      const isBothWcRivals = isLeagueMatchup && !awayTeam.divisionLeader && !homeTeam.divisionLeader;
      const isBothAhead = isBothWcRivals && 
                          awayTeam.wildCardGamesBack < favorite.wildCardGamesBack && 
                          homeTeam.wildCardGamesBack < favorite.wildCardGamesBack;
      
      const awayAhead = favorite.wildCardGamesBack - awayTeam.wildCardGamesBack;
      const homeAhead = favorite.wildCardGamesBack - homeTeam.wildCardGamesBack;

      if (isBothAhead && awayAhead >= 5.0 && homeAhead < 4.0) {
        rootFor = "Home";
        priority = 60;
        explanation = `Both the ${awayTeam.shortName} and ${homeTeam.shortName} are ahead of the ${favorite.shortName} in the Wild Card standings. Since the ${awayTeam.shortName} have a large ${awayAhead.toFixed(1)} game lead, root for the ${homeTeam.shortName} today to temper that lead and keep the overall playoff race tight.`;
      } else if (isBothAhead && homeAhead >= 5.0 && awayAhead < 4.0) {
        rootFor = "Away";
        priority = 60;
        explanation = `Both the ${homeTeam.shortName} and ${awayTeam.shortName} are ahead of the ${favorite.shortName} in the Wild Card standings. Since the ${homeTeam.shortName} have a large ${homeAhead.toFixed(1)} game lead, root for the ${awayTeam.shortName} today to temper that lead and keep the overall playoff race tight.`;
      } else {
        // Simulate who to root for based on threat levels
        if (awayThreat === 0 && homeThreat === 0) {
          rootFor = "Neutral";
          explanation = `This matchup is between two teams in the other league. It does not affect the ${favorite.shortName}'s playoff standings.`;
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
          explanation = `Both teams represent a similar threat in the standings to the ${favorite.shortName}. A win either way is relatively neutral.`;
          priority = 10;
        }
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
      threats: { away: awayThreat, home: homeThreat },
      teams: game.teams
    };
  }).sort((a, b) => b.priority - a.priority); // Sort by relevance to the fan!
}

function generateExplanation(threatTeam, targetOpponent, favorite, isAwayThreat) {
  const isDivRival = threatTeam.divisionId === favorite.divisionId;
  const isWcRival = threatTeam.leagueId === favorite.leagueId && !isDivRival;
  
  const divOutOfReach = favorite.gamesBack >= 7.0;
  const favPossessive = favorite.shortName.endsWith('s') ? `${favorite.shortName}'` : `${favorite.shortName}'s`;

  if (divOutOfReach) {
    if (targetOpponent.divisionLeader) {
      return `With the division race out of reach (deficit of ${favorite.gamesBack.toFixed(1)} games), the ${favPossessive} primary focus is the Wild Card. Root for division leader the ${targetOpponent.shortName} to defeat the ${threatTeam.shortName} to help the ${favorite.shortName} gain ground in the Wild Card race.`;
    }
    
    // Both are WC rivals under Division Out of Reach
    const diff = threatTeam.wildCardGamesBack - favorite.wildCardGamesBack;
    const absDiff = Math.abs(diff);
    if (diff < 0) {
      return `The ${threatTeam.shortName} are currently ahead of the ${favorite.shortName} in the Wild Card race. Root for the ${targetOpponent.shortName} today: a loss by the ${threatTeam.shortName} will help the ${favorite.shortName} close the gap in the standings.`;
    } else {
      const isHot = threatTeam.streakType === 'wins' && threatTeam.streakNumber >= 3;
      const isCreeping = diff <= 1.5;
      if (isCreeping && isHot) {
        return `The ${threatTeam.shortName} are hot on a ${threatTeam.streakNumber}-game winning streak and creeping up just ${diff.toFixed(1)} games behind the ${favorite.shortName} in the Wild Card. Root for the ${targetOpponent.shortName} today to halt their momentum.`;
      }
      return `The ${threatTeam.shortName} are trailing the ${favorite.shortName} by ${diff.toFixed(1)} games in the Wild Card race. Root for the ${targetOpponent.shortName} to keep them at bay in the standings.`;
    }
  }

  if (isDivRival) {
    const currentGap = threatTeam.gamesBack - favorite.gamesBack;
    const absGap = Math.abs(currentGap);
    
    if (currentGap > 0) {
      // Favorite is ahead in division
      return `The ${favorite.shortName} are currently ${currentGap.toFixed(1)} games ahead of the ${threatTeam.shortName} in the division race. Root for the ${targetOpponent.shortName} today: a loss by the ${threatTeam.shortName} will extend the division lead to ${(currentGap + 0.5).toFixed(1)} games.`;
    } else if (currentGap < 0) {
      // Favorite is behind in division
      return `The ${favorite.shortName} are currently ${absGap.toFixed(1)} games behind division leader the ${threatTeam.shortName}. Root for the ${targetOpponent.shortName} today: a loss by the ${threatTeam.shortName} will cut the division deficit to ${(absGap - 0.5).toFixed(1)} games.`;
    } else {
      // Tied
      return `The ${favorite.shortName} are currently tied with division rival the ${threatTeam.shortName}. Root for the ${targetOpponent.shortName} today: a loss by the ${threatTeam.shortName} will push the ${favorite.shortName} 0.5 games ahead of them in the division race.`;
    }
  } else if (isWcRival) {
    if (favorite.divisionLeader) {
      const winsDiff = favorite.wins - threatTeam.wins;
      return `The ${favorite.shortName} are leading their division, but the ${threatTeam.shortName} is a threat in the league standings (currently ${winsDiff} wins behind them). Root for the ${targetOpponent.shortName} to help secure overall league seeding.`;
    } else if (threatTeam.divisionLeader) {
      return `Root for the ${targetOpponent.shortName}. Division leader the ${threatTeam.shortName} represents a potential threat in overall league playoff seeding.`;
    } else {
      const currentGap = threatTeam.wildCardGamesBack - favorite.wildCardGamesBack;
      const absGap = Math.abs(currentGap);
      
      if (currentGap > 0) {
        // Favorite is ahead in wildcard
        return `The ${favorite.shortName} are currently ${currentGap.toFixed(1)} games ahead of the ${threatTeam.shortName} in the Wild Card race. Root for the ${targetOpponent.shortName} today: a loss by the ${threatTeam.shortName} will widen the Wild Card cushion to ${(currentGap + 0.5).toFixed(1)} games.`;
      } else if (currentGap < 0) {
        // Favorite is behind in wildcard
        return `The ${favorite.shortName} are currently ${absGap.toFixed(1)} games behind the ${threatTeam.shortName} in the Wild Card standings. Root for the ${targetOpponent.shortName} today: a loss by the ${threatTeam.shortName} will shrink the margin to ${(absGap - 0.5).toFixed(1)} games.`;
      } else {
        // Tied
        return `The ${favorite.shortName} are currently tied with Wild Card rival the ${threatTeam.shortName}. Root for the ${targetOpponent.shortName} today: a loss by the ${threatTeam.shortName} will put the ${favorite.shortName} 0.5 games ahead of them in the Wild Card standings.`;
      }
    }
  }
  
  return `Root for the ${targetOpponent.shortName}. A loss by the ${threatTeam.shortName} is favorable for the ${favPossessive} overall playoff positioning.`;
}
