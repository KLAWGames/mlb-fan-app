import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useScroll, Text } from '@react-three/drei';
import * as THREE from 'three';

export function CarnivalHorseRace({ raceTeams = [], activeTeamId }) {
  const scroll = useScroll();
  
  // Calculate scaling for track positions (maps standings values to coordinates between -2.8 and 2.8)
  const scaleBounds = useMemo(() => {
    if (raceTeams.length === 0) return { min: 0, max: 1 };
    const allPositions = raceTeams.flatMap(t => [t.startPos, t.endPos]);
    const min = Math.min(...allPositions);
    const max = Math.max(...allPositions);
    return { min, max };
  }, [raceTeams]);

  const getPhysicsX = (posVal) => {
    const { min, max } = scaleBounds;
    if (max === min) return 0;
    // Map to track coordinates: left side is -2.6, right side is 2.2
    return -2.6 + ((posVal - min) / (max - min)) * 4.8;
  };

  return (
    <group>
      {/* Light for the race tracks */}
      <directionalLight position={[0, 5, 2]} intensity={0.6} />

      {/* Title board in 3D */}
      <Text
        position={[0, 2.5, -0.5]}
        fontSize={0.28}
        color="#f59e0b"
      >
        🎡 Playoff Race Derby 🎡
      </Text>

      {/* Starting Gate (vertical wood post) */}
      <mesh position={[-2.75, 0, -0.1]}>
        <boxGeometry args={[0.08, 4.5, 0.1]} />
        <meshStandardMaterial color="#4a3b32" roughness={0.9} />
      </mesh>
      
      {/* Finish Gate (checkered post) */}
      <mesh position={[2.35, 0, -0.1]}>
        <boxGeometry args={[0.08, 4.5, 0.1]} />
        <meshStandardMaterial color="#888888" roughness={0.4} />
      </mesh>
      <Text
        position={[2.35, 2.4, 0.1]}
        fontSize={0.12}
        color="#a0aec0"
      >
        FINISH
      </Text>

      {/* Render Lanes and Horses */}
      {raceTeams.map((team, idx) => {
        // Calculate lane Y offset (center-aligned vertically)
        const laneCount = raceTeams.length;
        const spacing = 0.52;
        const laneY = (idx - (laneCount - 1) / 2) * -spacing;
        const isTracked = team.id === activeTeamId;

        return (
          <RaceLane 
            key={team.id}
            team={team} 
            laneY={laneY} 
            isTracked={isTracked} 
            getPhysicsX={getPhysicsX}
            scroll={scroll}
            idx={idx}
          />
        );
      })}
    </group>
  );
}

function RaceLane({ team, laneY, isTracked, getPhysicsX, scroll, idx }) {
  const horseRef = useRef();

  useFrame((state) => {
    const elapsed = state.clock.getElapsedTime();
    // Scroll progress for Page 2 (from 0.4 to 0.85 of timeline)
    const localProgress = Math.max(0, Math.min(1, (scroll.offset - 0.4) / 0.45));
    
    // Interpolate horse X position
    const startX = getPhysicsX(team.startPos);
    const endX = getPhysicsX(team.endPos);
    const currentX = THREE.MathUtils.lerp(startX, endX, localProgress);
    
    if (horseRef.current) {
      horseRef.current.position.x = currentX;
      
      // Calculate bobbing speed based on scrolling speed
      const scrollSpeed = Math.abs(scroll.delta);
      const bob = Math.abs(Math.sin(elapsed * 16 + idx)) * Math.min(0.12, scrollSpeed * 8);
      horseRef.current.position.y = bob;

      // Slight tilt forward when moving
      horseRef.current.rotation.z = -Math.min(0.2, scrollSpeed * 3);
    }
  });

  const startX = getPhysicsX(team.startPos);
  const endX = getPhysicsX(team.endPos);
  const teamColor = team.primaryColor || '#a0aec0';

  return (
    <group position={[0, laneY, 0]}>
      {/* Lane background track line */}
      <mesh position={[-0.2, -0.15, -0.05]} rotation={[0, 0, 0]}>
        <boxGeometry args={[5.2, 0.03, 0.02]} />
        <meshBasicMaterial color={isTracked ? '#2d3748' : '#1a202c'} />
      </mesh>

      {/* Subtly highlight start to end path */}
      <mesh position={[(startX + endX)/2, -0.13, -0.04]}>
        <planeGeometry args={[Math.max(0.01, Math.abs(endX - startX)), 0.02]} />
        <meshBasicMaterial color={teamColor} transparent opacity={0.3} />
      </mesh>

      {/* Team Name Label on the left */}
      <Text
        position={[-3.3, 0, 0]}
        fontSize={0.15}
        color={isTracked ? '#f59e0b' : '#a0aec0'}
        anchorX="right"
        anchorY="middle"
      >
        {team.abbreviation} {isTracked ? '★' : ''}
      </Text>

      {/* Horse / Marker Group */}
      <group ref={horseRef}>
        {/* Horse Base Marker */}
        <mesh>
          <capsuleGeometry args={[0.08, 0.15, 4, 8]} />
          <meshStandardMaterial color={teamColor} roughness={0.3} metalness={0.7} />
        </mesh>
        
        {/* Highlight ring for our tracked team */}
        {isTracked && (
          <mesh position={[0, 0, -0.02]}>
            <ringGeometry args={[0.13, 0.16, 16]} />
            <meshBasicMaterial color="#f59e0b" side={THREE.DoubleSide} />
          </mesh>
        )}

        {/* Small floating bubble above the horse showing outcome */}
        {team.outcome !== 'NO_GAME' && (
          <mesh position={[0, 0.28, 0]} rotation={[0, 0, 0]}>
            <sphereGeometry args={[0.05, 8, 8]} />
            <meshBasicMaterial color={team.outcome === 'WIN' ? '#10b981' : '#ef4444'} />
          </mesh>
        )}
      </group>

      {/* Starting Position Marker */}
      <mesh position={[startX, -0.15, 0]}>
        <boxGeometry args={[0.04, 0.12, 0.04]} />
        <meshBasicMaterial color="#4a5568" />
      </mesh>
    </group>
  );
}
