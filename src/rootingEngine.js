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
      }
    }
  }

  // Process Wild Card for both leagues (103 = AL, 104 = NL)
  [103, 104].forEach(leagueId => {
    const allLeague = leagueTeams[leagueId];
    // Wild Card pool: teams that are NOT division leaders
    const wcPool = allLeague.filter(t => !t.divisionLeader);
    // Sort pool by winning percentage (wins descending, losses ascending)
    wcPool.sort((a, b) => b.wins - a.wins || a.losses - b.losses);

    // Cutoff team is the 3rd wildcard team (index 2 in sorted pool)
    const cutoffTeam = wcPool[2];
    const firstOutTeam = wcPool[3]; // 4th wildcard team (index 3)

    wcPool.forEach((team, idx) => {
      team.wildCardRank = idx + 1;
      team.isWildCardSpot = idx < 3; // Top 3 spots qualify

      if (cutoffTeam) {
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
      explanation = "This is your team! Root for a big win today to boost your standing.";
      priority = 100;
    } else if (homeTeam.id === favoriteTeamId) {
      rootFor = "Home";
      explanation = "This is your team! Root for a big win today to boost your standing.";
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
  const relation = threatTeam.divisionId === favorite.divisionId ? "division" : "Wild Card";
  const locationText = isAwayThreat ? "Away" : "Home";

  if (threatTeam.divisionId === favorite.divisionId) {
    if (favorite.divisionLeader) {
      return `Root for ${targetOpponent.shortName}. A loss by division rival ${threatTeam.shortName} increases your lead in the ${relation} race.`;
    } else if (threatTeam.divisionLeader) {
      return `Root for ${targetOpponent.shortName}. A loss by division-leading ${threatTeam.shortName} helps you catch up in the division standings.`;
    } else {
      return `Root for ${targetOpponent.shortName}. A loss by division rival ${threatTeam.shortName} helps you climb the division rankings.`;
    }
  } else if (threatTeam.leagueId === favorite.leagueId) {
    return `Root for ${targetOpponent.shortName}. A loss by ${threatTeam.shortName} helps you gain ground in the competitive ${relation} playoff race.`;
  }
  
  return `Root for ${targetOpponent.shortName}. A loss by ${threatTeam.shortName} is favorable for your team's playoff positioning.`;
}
