import React, { useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useScroll, Html } from '@react-three/drei';

export function RecapOverlayUI({ trackedGame, raceTeams, activeTeamId, onClose, gamesCount }) {
  const scroll = useScroll();
  const [offset, setOffset] = useState(0);

  // Sync scroll offset with React state for HTML updates
  useFrame(() => {
    if (Math.abs(scroll.offset - offset) > 0.005) {
      setOffset(scroll.offset);
    }
  });

  const getCommentary = () => {
    if (offset < 0.05) {
      return {
        title: "Yesterday's Recap",
        desc: "Scroll down to replay yesterday's games and see the playoff standings shift.",
        showScrollGuide: true
      };
    }
    
    if (offset < 0.4) {
      if (!trackedGame || !trackedGame.opponent) {
        return {
          title: "Off-Day Yesterday",
          desc: "Your tracked team had a rest day yesterday. Scroll down to see other games impact the race.",
          showScrollGuide: false
        };
      }
      
      const { opponent, isWin, trackedScore, oppScore } = trackedGame;
      const teamName = "My Team";
      const oppName = opponent.abbreviation || "OPP";
      const isFinal = offset > 0.35;
      
      return {
        title: isFinal ? "Game Completed" : "Game In Progress",
        desc: isFinal 
          ? (isWin ? `🏆 Victory! ${teamName} beat the ${oppName} ${trackedScore}-${oppScore}!` : `☔ Defeat. ${teamName} lost to the ${oppName} ${oppScore}-${trackedScore}.`)
          : `Live Inning updates: ${isAwayText(trackedGame)} vs ${oppName}. Score counting up...`,
        showScrollGuide: false
      };
    }

    if (offset < 0.85) {
      return {
        title: "Playoff Derby",
        desc: "Yesterday's outcomes are fueling the race! Watch the horses advance based on wins and losses.",
        showScrollGuide: false
      };
    }

    return {
      title: "Final Standings Established",
      desc: "All games completed. The final standings are set for today's match-ups.",
      showScrollGuide: false
    };
  };

  const isAwayText = (game) => {
    return game.isAway ? "Away" : "Home";
  };

  const { title, desc, showScrollGuide } = getCommentary();

  return (
    <Html fullscreen style={styles.htmlWrapper}>
      {/* 1. Header (Always Fixed) */}
      <div style={styles.header}>
        <div>
          <div style={styles.headerTitle}>Trajectory Recap</div>
          <div style={styles.headerSubtitle}>Yesterday's Daily Flash</div>
        </div>
        <button style={styles.skipBtn} onClick={onClose}>
          Skip Recap ✕
        </button>
      </div>

      {/* 2. Scroll-Linked Commentary Box (Bottom Center) */}
      {offset < 0.85 && (
        <div style={styles.commentaryCard}>
          <div style={styles.commentaryBadge}>{title}</div>
          <p style={styles.commentaryText}>{desc}</p>
          {showScrollGuide && (
            <div style={styles.scrollGuide}>
              <span style={styles.scrollText}>SCROLL DOWN</span>
              <span style={styles.scrollArrow}>↓</span>
            </div>
          )}
        </div>
      )}

      {/* 3. Inning Scoreboard overlay (during H2H scroll) */}
      {offset >= 0.05 && offset < 0.4 && trackedGame?.opponent && (
        <div style={styles.linescoreOverlay}>
          <div style={styles.linescoreHeader}>
            <span>Yesterday's Matchup</span>
            <span style={{ color: 'var(--color-gold)', fontWeight: 800 }}>
              {offset > 0.35 ? 'FINAL' : 'PLAYING'}
            </span>
          </div>
          <div style={styles.linescoreRow}>
            <span style={styles.teamAbbrev}>
              {trackedGame.isAway ? 'MY TEAM' : (trackedGame.opponent.abbreviation || 'OPP')}
            </span>
            <span style={styles.teamScore}>
              {offset > 0.35 
                ? (trackedGame.isAway ? trackedGame.trackedScore : trackedGame.oppScore)
                : Math.round(trackedGame.isAway ? (trackedGame.trackedScore * Math.min(1, (offset - 0.05) / 0.3)) : (trackedGame.oppScore * Math.min(1, (offset - 0.05) / 0.3)))}
            </span>
          </div>
          <div style={styles.linescoreRow}>
            <span style={styles.teamAbbrev}>
              {trackedGame.isAway ? (trackedGame.opponent.abbreviation || 'OPP') : 'MY TEAM'}
            </span>
            <span style={styles.teamScore}>
              {offset > 0.35 
                ? (trackedGame.isAway ? trackedGame.oppScore : trackedGame.trackedScore)
                : Math.round(trackedGame.isAway ? (trackedGame.oppScore * Math.min(1, (offset - 0.05) / 0.3)) : (trackedGame.trackedScore * Math.min(1, (offset - 0.05) / 0.3)))}
            </span>
          </div>
        </div>
      )}

      {/* 4. Final Summary Modal (Revealed at end of scroll) */}
      {offset >= 0.85 && (
        <div style={styles.summaryModal}>
          <h2 style={styles.summaryTitle}>🏁 Playoff Race Recap</h2>
          <p style={styles.summarySubtitle}>Standings Impact Summary ({gamesCount} games played)</p>
          
          <div style={styles.tableContainer}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Team</th>
                  <th style={styles.th}>Game</th>
                  <th style={styles.th}>Start GB</th>
                  <th style={styles.th}>End GB</th>
                  <th style={styles.th}>Change</th>
                </tr>
              </thead>
              <tbody>
                {raceTeams.map((team) => {
                  const isTracked = team.id === activeTeamId;
                  const diff = team.gamesBackEnd - team.gamesBackStart;
                  const diffText = diff === 0 ? '—' : (diff > 0 ? `+${diff.toFixed(1)}` : `${diff.toFixed(1)}`);
                  const diffColor = diff < 0 ? '#10b981' : (diff > 0 ? '#ef4444' : '#a0aec0');
                  
                  return (
                    <tr key={team.id} style={isTracked ? styles.trTracked : styles.tr}>
                      <td style={styles.td}>
                        <span style={{ ...styles.colorBadge, background: team.primaryColor }}></span>
                        {team.shortName} {isTracked ? '★' : ''}
                      </td>
                      <td style={styles.td}>
                        {team.outcome === 'WIN' && <span style={styles.badgeWin}>W ({team.runMargin})</span>}
                        {team.outcome === 'LOSS' && <span style={styles.badgeLoss}>L ({team.runMargin})</span>}
                        {team.outcome === 'NO_GAME' && <span style={styles.badgeOff}>Off</span>}
                      </td>
                      <td style={styles.td}>{team.gamesBackStart === 0 ? 'Ldr' : team.gamesBackStart.toFixed(1)}</td>
                      <td style={styles.td}>{team.gamesBackEnd === 0 ? 'Ldr' : team.gamesBackEnd.toFixed(1)}</td>
                      <td style={{ ...styles.td, color: diffColor, fontWeight: 700 }}>{diffText}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <button style={styles.actionBtn} onClick={onClose}>
            Go to Today's Dashboard →
          </button>
        </div>
      )}
    </Html>
  );
}

const styles = {
  htmlWrapper: {
    pointerEvents: 'none',
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    padding: '24px',
    boxSizing: 'border-box'
  },
  header: {
    pointerEvents: 'auto',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    width: '100%',
    background: 'linear-gradient(to bottom, rgba(7, 10, 19, 0.8) 0%, rgba(7, 10, 19, 0) 100%)',
    paddingBottom: '20px'
  },
  headerTitle: {
    fontSize: '20px',
    fontWeight: 900,
    color: '#ffffff',
    letterSpacing: '0.05em',
    textTransform: 'uppercase'
  },
  headerSubtitle: {
    fontSize: '11px',
    color: '#a0aec0',
    fontWeight: 500
  },
  skipBtn: {
    padding: '8px 14px',
    background: 'rgba(255, 255, 255, 0.08)',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    borderRadius: '20px',
    color: '#ffffff',
    fontSize: '12px',
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'background 0.2s',
    outline: 'none'
  },
  commentaryCard: {
    pointerEvents: 'auto',
    alignSelf: 'center',
    width: '90%',
    maxWidth: '480px',
    background: 'rgba(15, 23, 42, 0.75)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '16px',
    padding: '16px 20px',
    backdropFilter: 'blur(12px)',
    textAlign: 'center',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
    marginBottom: '32px'
  },
  commentaryBadge: {
    display: 'inline-block',
    fontSize: '10px',
    fontWeight: 800,
    color: '#f59e0b',
    background: 'rgba(245, 158, 11, 0.15)',
    padding: '3px 8px',
    borderRadius: '12px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: '8px'
  },
  commentaryText: {
    margin: 0,
    fontSize: '13.5px',
    lineHeight: '1.5',
    color: '#f7fafc',
    fontWeight: 500
  },
  scrollGuide: {
    marginTop: '10px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '2px'
  },
  scrollText: {
    fontSize: '9px',
    color: '#718096',
    fontWeight: 700,
    letterSpacing: '0.1em'
  },
  scrollArrow: {
    color: '#f59e0b',
    fontSize: '12px',
    fontWeight: 'bold',
    animation: 'bounce 1.5s infinite'
  },
  linescoreOverlay: {
    position: 'absolute',
    top: '100px',
    left: '24px',
    width: '180px',
    background: 'rgba(15, 23, 42, 0.8)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    borderRadius: '12px',
    padding: '12px',
    backdropFilter: 'blur(8px)',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
    pointerEvents: 'auto'
  },
  linescoreHeader: {
    fontSize: '10px',
    fontWeight: 700,
    color: '#718096',
    display: 'flex',
    justifyContent: 'space-between',
    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
    paddingBottom: '6px',
    marginBottom: '8px',
    textTransform: 'uppercase'
  },
  linescoreRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    margin: '4px 0'
  },
  teamAbbrev: {
    fontSize: '13px',
    fontWeight: 700,
    color: '#ffffff'
  },
  teamScore: {
    fontSize: '16px',
    fontWeight: 900,
    color: '#ffffff'
  },
  summaryModal: {
    pointerEvents: 'auto',
    margin: 'auto',
    width: '95%',
    maxWidth: '520px',
    background: 'rgba(11, 15, 25, 0.9)',
    border: '1px solid rgba(245, 158, 11, 0.25)',
    borderRadius: '24px',
    padding: '24px',
    backdropFilter: 'blur(16px)',
    boxShadow: '0 12px 40px rgba(0, 0, 0, 0.7)',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px'
  },
  summaryTitle: {
    margin: 0,
    fontSize: '22px',
    fontWeight: 900,
    color: '#ffffff'
  },
  summarySubtitle: {
    margin: 0,
    marginTop: '-8px',
    fontSize: '12px',
    color: '#718096',
    fontWeight: 600
  },
  tableContainer: {
    maxHeight: '260px',
    overflowY: 'auto',
    borderRadius: '12px',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    background: 'rgba(0, 0, 0, 0.2)'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '13px',
    color: '#ffffff'
  },
  th: {
    textAlign: 'left',
    padding: '10px 12px',
    background: 'rgba(255, 255, 255, 0.04)',
    color: '#718096',
    fontSize: '10px',
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    borderBottom: '1px solid rgba(255, 255, 255, 0.08)'
  },
  td: {
    padding: '10px 12px',
    textAlign: 'left',
    borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
    fontWeight: 500,
    verticalAlign: 'middle'
  },
  tr: {
    transition: 'background 0.2s'
  },
  trTracked: {
    background: 'rgba(245, 158, 11, 0.1)',
    borderLeft: '3px solid #f59e0b'
  },
  colorBadge: {
    display: 'inline-block',
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    marginRight: '8px',
    verticalAlign: 'middle'
  },
  badgeWin: {
    color: '#10b981',
    fontWeight: 800,
    fontSize: '11px',
    background: 'rgba(16, 185, 129, 0.1)',
    padding: '2px 6px',
    borderRadius: '4px'
  },
  badgeLoss: {
    color: '#ef4444',
    fontWeight: 800,
    fontSize: '11px',
    background: 'rgba(239, 68, 68, 0.1)',
    padding: '2px 6px',
    borderRadius: '4px'
  },
  badgeOff: {
    color: '#a0aec0',
    fontWeight: 600,
    fontSize: '11px',
    background: 'rgba(160, 174, 192, 0.1)',
    padding: '2px 6px',
    borderRadius: '4px'
  },
  actionBtn: {
    width: '100%',
    padding: '14px 18px',
    fontSize: '14px',
    fontWeight: 800,
    color: '#ffffff',
    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    border: 'none',
    borderRadius: '12px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    boxShadow: '0 4px 14px rgba(245, 158, 11, 0.3)',
    outline: 'none'
  }
};
