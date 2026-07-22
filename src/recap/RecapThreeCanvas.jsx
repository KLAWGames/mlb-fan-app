import React, { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { ScrollControls, useScroll, Stars } from '@react-three/drei';
import * as THREE from 'three';
import { GameInningsAnimation } from './GameInningsAnimation.jsx';
import { CarnivalHorseRace } from './CarnivalHorseRace.jsx';
import { RecapOverlayUI } from './RecapOverlayUI.jsx';

function ScrollTimeline({ trackedGame, raceTeams, activeTeamId, onClose, gamesCount }) {
  return (
    <>
      {/* Scene 1: Game Scoreboard at Y = 0 */}
      <group position={[0, 0, 0]}>
        <GameInningsAnimation trackedGame={trackedGame} />
      </group>
      
      {/* Scene 2: Horse Race Track at Y = -12 */}
      <group position={[0, -12, 0]}>
        <CarnivalHorseRace raceTeams={raceTeams} activeTeamId={activeTeamId} />
      </group>

      {/* HTML Overlay UI (projected inside canvas but fullscreen fixed) */}
      <RecapOverlayUI 
        trackedGame={trackedGame} 
        raceTeams={raceTeams} 
        activeTeamId={activeTeamId} 
        onClose={onClose}
        gamesCount={gamesCount}
      />
      
      {/* Camera Path Controller */}
      <CameraController />
    </>
  );
}

function CameraController() {
  const scroll = useScroll();
  const dummy = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();
  
  useFrame((state) => {
    const offset = scroll.offset; // 0 to 1
    
    let targetX = 0;
    let targetY = 0;
    let targetZ = 8.5;
    
    let lookX = 0;
    let lookY = 0;
    let lookZ = 0;

    if (offset < 0.4) {
      // Section 1: H2H Game
      const t = offset / 0.4;
      targetX = 0;
      targetY = 0;
      targetZ = THREE.MathUtils.lerp(8.5, 6.2, t);
      
      lookX = 0;
      lookY = 0;
      lookZ = 0;
    } else if (offset < 0.85) {
      // Section 2: Horse Race Panning
      const t = (offset - 0.4) / 0.45; // 0 to 1
      
      targetX = THREE.MathUtils.lerp(0, 1.8, t);
      targetY = THREE.MathUtils.lerp(0, -11.8, t);
      targetZ = THREE.MathUtils.lerp(6.2, 8.5, t);
      
      lookX = THREE.MathUtils.lerp(0, 0.8, t);
      lookY = THREE.MathUtils.lerp(0, -12.2, t);
      lookZ = 0;
    } else {
      // Section 3: Final Standings
      const t = (offset - 0.85) / 0.15;
      targetX = 1.8;
      targetY = THREE.MathUtils.lerp(-11.8, -12.4, t);
      targetZ = THREE.MathUtils.lerp(8.5, 9.8, t);
      
      lookX = 0.8;
      lookY = -12.2;
      lookZ = 0;
    }
    
    // Smooth transitions using lerp
    state.camera.position.lerp(dummy.set(targetX, targetY, targetZ), 0.1);
    
    // Calculate smooth lookAt target
    state.camera.lookAt(lookTarget.lerp(dummy.set(lookX, lookY, lookZ), 0.1));
  });
  
  return null;
}

export function RecapThreeCanvas({ trackedGame, raceTeams, activeTeamId, onClose, gamesCount }) {
  return (
    <div style={canvasStyles.canvasContainer}>
      <Canvas
        camera={{ position: [0, 0, 8.5], fov: 60 }}
        gl={{ antialias: true, alpha: false }}
      >
        <color attach="background" args={['#070a13']} />
        
        {/* Lights */}
        <ambientLight intensity={0.6} />
        <pointLight position={[10, 10, 10]} intensity={1.2} />
        <directionalLight position={[-10, 15, 5]} intensity={0.8} />
        <spotLight 
          position={[0, 15, 5]} 
          angle={0.4} 
          penumbra={1} 
          intensity={1.5} 
          castShadow={false}
        />

        {/* Ambient starry backdrop */}
        <Stars radius={100} depth={50} count={2000} factor={4} saturation={0.5} fade speed={1.5} />
        
        {/* Scroll Controls */}
        <ScrollControls pages={3.0} damping={0.25} infinite={false}>
          <ScrollTimeline 
            trackedGame={trackedGame} 
            raceTeams={raceTeams} 
            activeTeamId={activeTeamId} 
            onClose={onClose}
            gamesCount={gamesCount}
          />
        </ScrollControls>
      </Canvas>
    </div>
  );
}

const canvasStyles = {
  canvasContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'auto'
  }
};
