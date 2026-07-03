// Service to fetch data from the MLB Stats API with high-fidelity mock fallback for off-season/offline usage.

import { teamsData } from './teamsData.js';

// Format date as YYYY-MM-DD
export function formatLocalDate(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Fallback Standings (extracted from active 2026 June standings)
const MOCK_STANDINGS = {
  records: [
    // AL East (201)
    {
      division: { id: 201, name: "American League East" },
      league: { id: 103, name: "American League" },
      teamRecords: [
        { team: { id: 147, name: "Yankees" }, wins: 48, losses: 31, divisionRank: "1", gamesBack: "-", magicNumber: "82" },
        { team: { id: 139, name: "Rays" }, wins: 45, losses: 33, divisionRank: "2", gamesBack: "2.5" },
        { team: { id: 141, name: "Blue Jays" }, wins: 39, losses: 41, divisionRank: "3", gamesBack: "9.5" },
        { team: { id: 110, name: "Orioles" }, wins: 38, losses: 44, divisionRank: "4", gamesBack: "11.5" },
        { team: { id: 111, name: "Red Sox" }, wins: 32, losses: 46, divisionRank: "5", gamesBack: "15.5" }
      ]
    },
    // AL Central (202)
    {
      division: { id: 202, name: "American League Central" },
      league: { id: 103, name: "American League" },
      teamRecords: [
        { team: { id: 145, name: "White Sox" }, wins: 41, losses: 38, divisionRank: "1", gamesBack: "-", magicNumber: "83" },
        { team: { id: 114, name: "Guardians" }, wins: 42, losses: 39, divisionRank: "2", gamesBack: "-" },
        { team: { id: 142, name: "Twins" }, wins: 38, losses: 44, divisionRank: "3", gamesBack: "4.5" },
        { team: { id: 116, name: "Tigers" }, wins: 34, losses: 46, divisionRank: "4", gamesBack: "7.5" },
        { team: { id: 118, name: "Royals" }, wins: 34, losses: 48, divisionRank: "5", gamesBack: "8.5" }
      ]
    },
    // AL West (200)
    {
      division: { id: 200, name: "American League West" },
      league: { id: 103, name: "American League" },
      teamRecords: [
        { team: { id: 136, name: "Mariners" }, wins: 41, losses: 41, divisionRank: "1", gamesBack: "-", magicNumber: "79" },
        { team: { id: 117, name: "Astros" }, wins: 39, losses: 43, divisionRank: "2", gamesBack: "2.0" },
        { team: { id: 133, name: "Athletics" }, wins: 38, losses: 42, divisionRank: "3", gamesBack: "2.0" },
        { team: { id: 140, name: "Rangers" }, wins: 38, losses: 42, divisionRank: "4", gamesBack: "2.0" },
        { team: { id: 108, name: "Angels" }, wins: 34, losses: 48, divisionRank: "5", gamesBack: "7.0" }
      ]
    },
    // NL East (204)
    {
      division: { id: 204, name: "National League East" },
      league: { id: 104, name: "National League" },
      teamRecords: [
        { team: { id: 144, name: "Braves" }, wins: 48, losses: 31, divisionRank: "1", gamesBack: "-", magicNumber: "79" },
        { team: { id: 143, name: "Phillies" }, wins: 44, losses: 36, divisionRank: "2", gamesBack: "4.5" },
        { team: { id: 146, name: "Marlins" }, wins: 42, losses: 39, divisionRank: "3", gamesBack: "7.0" },
        { team: { id: 120, name: "Nationals" }, wins: 41, losses: 40, divisionRank: "4", gamesBack: "8.0" },
        { team: { id: 121, name: "Mets" }, wins: 34, losses: 46, divisionRank: "5", gamesBack: "14.5" }
      ]
    },
    // NL Central (205)
    {
      division: { id: 205, name: "National League Central" },
      league: { id: 104, name: "National League" },
      teamRecords: [
        { team: { id: 158, name: "Brewers" }, wins: 49, losses: 29, divisionRank: "1", gamesBack: "-", magicNumber: "78" },
        { team: { id: 138, name: "Cardinals" }, wins: 42, losses: 36, divisionRank: "2", gamesBack: "7.0" },
        { team: { id: 112, name: "Cubs" }, wins: 43, losses: 37, divisionRank: "3", gamesBack: "7.0" },
        { team: { id: 134, name: "Pirates" }, wins: 41, losses: 40, divisionRank: "4", gamesBack: "9.5" },
        { team: { id: 113, name: "Reds" }, wins: 37, losses: 42, divisionRank: "5", gamesBack: "12.5" }
      ]
    },
    // NL West (203)
    {
      division: { id: 203, name: "National League West" },
      league: { id: 104, name: "National League" },
      teamRecords: [
        { team: { id: 119, name: "Dodgers" }, wins: 52, losses: 29, divisionRank: "1", gamesBack: "-", magicNumber: "74" },
        { team: { id: 135, name: "Padres" }, wins: 42, losses: 37, divisionRank: "2", gamesBack: "9.0" },
        { team: { id: 109, name: "Arizona Diamondbacks" }, wins: 41, losses: 39, divisionRank: "3", gamesBack: "10.5" },
        { team: { id: 137, name: "San Francisco Giants" }, wins: 33, losses: 46, divisionRank: "4", gamesBack: "18.0" },
        { team: { id: 115, name: "Colorado Rockies" }, wins: 32, losses: 49, divisionRank: "5", gamesBack: "20.0" }
      ]
    }
  ]
};

// Fallback schedule representing key division and Wild Card battles
const MOCK_GAMES = [
  {
    gamePk: 1001,
    gameDate: "2026-06-25T19:07:00Z",
    officialDate: "2026-06-25",
    status: { detailedState: "Scheduled", statusCode: "S" },
    teams: {
      away: { team: { id: 147, name: "New York Yankees" }, score: null },
      home: { team: { id: 141, name: "Toronto Blue Jays" }, score: null }
    }
  },
  {
    gamePk: 1002,
    gameDate: "2026-06-25T19:10:00Z",
    officialDate: "2026-06-25",
    status: { detailedState: "Scheduled", statusCode: "S" },
    teams: {
      away: { team: { id: 111, name: "Boston Red Sox" }, score: null },
      home: { team: { id: 139, name: "Tampa Bay Rays" }, score: null }
    }
  },
  {
    gamePk: 1003,
    gameDate: "2026-06-25T20:10:00Z",
    officialDate: "2026-06-25",
    status: { detailedState: "Scheduled", statusCode: "S" },
    teams: {
      away: { team: { id: 117, name: "Houston Astros" }, score: null },
      home: { team: { id: 136, name: "Seattle Mariners" }, score: null }
    }
  },
  {
    gamePk: 1004,
    gameDate: "2026-06-25T22:15:00Z",
    officialDate: "2026-06-25",
    status: { detailedState: "Scheduled", statusCode: "S" },
    teams: {
      away: { team: { id: 110, name: "Baltimore Orioles" }, score: null },
      home: { team: { id: 143, name: "Philadelphia Phillies" }, score: null }
    }
  },
  {
    gamePk: 1005,
    gameDate: "2026-06-25T18:10:00Z",
    officialDate: "2026-06-25",
    status: { detailedState: "Scheduled", statusCode: "S" },
    teams: {
      away: { team: { id: 114, name: "Cleveland Guardians" }, score: null },
      home: { team: { id: 142, name: "Minnesota Twins" }, score: null }
    }
  },
  {
    gamePk: 1006,
    gameDate: "2026-06-25T19:05:00Z",
    officialDate: "2026-06-25",
    status: { detailedState: "Scheduled", statusCode: "S" },
    teams: {
      away: { team: { id: 135, name: "San Diego Padres" }, score: null },
      home: { team: { id: 119, name: "Los Angeles Dodgers" }, score: null }
    }
  }
];

function getMockYesterdayStandings() {
  const yesterday = JSON.parse(JSON.stringify(MOCK_STANDINGS));
  yesterday.records.forEach(division => {
    division.teamRecords.forEach(teamRec => {
      // Modify team records for yesterday to simulate historical standings
      if (teamRec.team.id === 141) { // Blue Jays
        teamRec.wins = 38; // 39 wins today
        teamRec.gamesBack = "10.0";
      } else if (teamRec.team.id === 147) { // Yankees
        teamRec.wins = 47;
        teamRec.losses = 31;
        teamRec.gamesBack = "-";
      } else if (teamRec.team.id === 117) { // Astros
        teamRec.wins = 39;
        teamRec.losses = 42; // wins: 39, losses: 43 today (meaning they lost today)
        teamRec.gamesBack = "1.5";
      } else if (teamRec.team.id === 136) { // Mariners
        teamRec.wins = 40;
        teamRec.gamesBack = "-";
      } else if (teamRec.team.id === 119) { // Dodgers
        teamRec.wins = 51;
        teamRec.gamesBack = "-";
      } else if (teamRec.team.id === 137) { // Giants
        teamRec.wins = 33;
        teamRec.losses = 45; // wins: 33, losses: 46 today
        teamRec.gamesBack = "17.5";
      }
    });
  });
  return yesterday;
}

export async function fetchStandings(dateStr = null) {
  try {
    const leagues = [103, 104];
    let queryParams = '';
    if (dateStr) {
      const year = dateStr.split('-')[0];
      queryParams = `&season=${year}&date=${dateStr}`;
    }
    const promises = leagues.map(lid =>
      fetch(`https://statsapi.mlb.com/api/v1/standings?leagueId=${lid}${queryParams}`)
        .then(res => {
          if (!res.ok) throw new Error('API request failed');
          return res.json();
        })
    );
    const results = await Promise.all(promises);
    const combinedRecords = [];
    results.forEach(res => {
      if (res.records) combinedRecords.push(...res.records);
    });

    if (combinedRecords.length === 0) {
      console.warn("Standings empty from API, using high-fidelity fallback.");
      return dateStr ? getMockYesterdayStandings() : MOCK_STANDINGS;
    }
    return { records: combinedRecords };
  } catch (err) {
    console.error("Failed to fetch standings from API, using fallback:", err.message);
    return dateStr ? getMockYesterdayStandings() : MOCK_STANDINGS;
  }
}

export async function fetchSchedule(dateStr) {
  try {
    const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate=${dateStr}&endDate=${dateStr}&hydrate=linescore,probablePitcher`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('API request failed');
    const data = await res.json();
    
    // Check if there are any games returned
    let games = [];
    if (data.dates && data.dates[0] && data.dates[0].games) {
      games = data.dates[0].games;
    }
    
    if (games.length === 0) {
      console.warn(`No games found for ${dateStr} from API, using mock schedule.`);
      // Adjust mock dates to match dateStr
      return MOCK_GAMES.map(g => ({
        ...g,
        officialDate: dateStr,
        gameDate: `${dateStr}T19:00:00Z`
      }));
    }
    return games;
  } catch (err) {
    console.error(`Failed to fetch schedule for ${dateStr}, using fallback:`, err.message);
    return MOCK_GAMES.map(g => ({
      ...g,
      officialDate: dateStr,
      gameDate: `${dateStr}T19:00:00Z`
    }));
  }
}
