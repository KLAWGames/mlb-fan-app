import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useScroll, Text, Html } from '@react-three/drei';
import * as THREE from 'three';

// Lightweight particle celebration system (Confetti)
function Confetti({ active }) {
  const count = 120;
  const meshRef = useRef();

  const dummy = useMemo(() => new THREE.Object3D(), []);
  
  // Create randomized particle data
  const particles = useMemo(() => {
    const temp = [];
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 5;
      const y = -4 + Math.random() * 2;
      const z = (Math.random() - 0.5) * 3;
      
      const velocityY = 3.5 + Math.random() * 4;
      const velocityX = (Math.random() - 0.5) * 2.5;
      const velocityZ = (Math.random() - 0.5) * 1.5;
      
      const rotSpeedX = Math.random() * 5;
      const rotSpeedY = Math.random() * 5;
      
      const color = new THREE.Color();
      const colors = ['#f59e0b', '#d97706', '#3b82f6', '#10b981', '#ef4444', '#ec4899'];
      color.set(colors[Math.floor(Math.random() * colors.length)]);

      temp.push({ x, y, z, vx: velocityX, vy: velocityY, vz: velocityZ, rx: rotSpeedX, ry: rotSpeedY, color });
    }
    return temp;
  }, []);

  useFrame((state, delta) => {
    if (!active) return;
    particles.forEach((p, i) => {
      // Apply simple velocity and gravity
      p.y += p.vy * delta;
      p.x += p.vx * delta;
      p.z += p.vz * delta;
      p.vy -= 9.8 * delta; // Gravity

      // Rotation
      p.rx += delta * 4;
      p.ry += delta * 2;

      // Reset when falling low
      if (p.y < -6) {
        p.x = (Math.random() - 0.5) * 3;
        p.y = -3;
        p.z = (Math.random() - 0.5) * 2;
        p.vy = 4 + Math.random() * 5;
        p.vx = (Math.random() - 0.5) * 2;
      }

      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(p.rx, p.ry, 0);
      dummy.scale.set(0.12, 0.05, 0.1);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
      meshRef.current.setColorAt(i, p.color);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true;
    }
  });

  return (
    <instancedMesh ref={meshRef} args={[null, null, count]} visible={active}>
      <boxGeometry />
      <meshBasicMaterial side={THREE.DoubleSide} />
    </instancedMesh>
  );
}

// Lightweight somber rain system
function Rain({ active }) {
  const count = 180;
  const pointsRef = useRef();

  const [positions, velocities] = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const vels = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 8; // x
      pos[i * 3 + 1] = 2 + Math.random() * 5; // y
      pos[i * 3 + 2] = (Math.random() - 0.5) * 5; // z
      vels[i] = 4 + Math.random() * 4; // speed falling down
    }
    return [pos, vels];
  }, []);

  useFrame((state, delta) => {
    if (!active) return;
    const posAttr = pointsRef.current.geometry.attributes.position;
    for (let i = 0; i < count; i++) {
      let y = posAttr.getY(i);
      y -= velocities[i] * delta;
      
      // Reset at bottom
      if (y < -4) {
        y = 4 + Math.random() * 2;
        posAttr.setX(i, (Math.random() - 0.5) * 8);
      }
      posAttr.setY(i, y);
    }
    posAttr.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} visible={active}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial color="#556677" size={0.06} transparent opacity={0.6} />
    </points>
  );
}

export function GameInningsAnimation({ trackedGame }) {
  const scroll = useScroll();
  
  const leftCardRef = useRef();
  const rightCardRef = useRef();

  // Floating Micro-Animation (Sway)
  useFrame((state) => {
    const elapsed = state.clock.getElapsedTime();
    if (leftCardRef.current) {
      leftCardRef.current.position.y = Math.sin(elapsed * 1.5) * 0.08;
      leftCardRef.current.rotation.y = Math.sin(elapsed * 0.8) * 0.04;
    }
    if (rightCardRef.current) {
      rightCardRef.current.position.y = Math.cos(elapsed * 1.5) * 0.08;
      rightCardRef.current.rotation.y = Math.cos(elapsed * 0.8) * 0.04;
    }
  });

  if (!trackedGame || !trackedGame.opponent) {
    // Off day view
    return (
      <group>
        <mesh position={[0, 0, 0]}>
          <boxGeometry args={[4, 2, 0.1]} />
          <meshStandardMaterial color="#1a2235" roughness={0.3} metalness={0.8} />
        </mesh>
        <Text
          position={[0, 0.3, 0.1]}
          fontSize={0.28}
          color="#f59e0b"
          anchorX="center"
          anchorY="middle"
        >
          Scheduled Off-Day
        </Text>
        <Text
          position={[0, -0.3, 0.1]}
          fontSize={0.16}
          color="#a0aec0"
          anchorX="center"
          anchorY="middle"
        >
          No games played yesterday.
        </Text>
      </group>
    );
  }

  // Extract game details
  const { opponent, isAway, trackedScore, oppScore, isWin, innings } = trackedGame;
  
  // Calculate scoreboard state based on scroll
  // Active range: offset 0 to 0.4
  // We want to map offset 0.0 -> 0.35 to inning progression 1 to 9, 
  // and 0.35 -> 0.4 to final winner showcase.
  const getProgressState = () => {
    const offset = scroll.offset;
    if (offset >= 0.4) {
      return { inningNum: innings.length, currentAway: isAway ? trackedScore : oppScore, currentHome: isAway ? oppScore : trackedScore, isFinal: true };
    }
    
    // Inning progression range
    const innerProgress = Math.min(offset / 0.33, 1.0); // 0 to 1
    const currentInningLimit = Math.max(1, Math.ceil(innerProgress * innings.length));
    
    let curAway = 0;
    let curHome = 0;
    for (let i = 0; i < currentInningLimit; i++) {
      const inn = innings[i];
      if (!inn) break;
      curAway += inn.away;
      curHome += inn.home;
    }

    const isFinal = innerProgress >= 0.95;
    return {
      inningNum: currentInningLimit,
      currentAway: curAway,
      currentHome: curHome,
      isFinal
    };
  };

  const { inningNum, currentAway, currentHome, isFinal } = getProgressState();

  const showConfetti = isFinal && isWin;
  const showRain = isFinal && !isWin;

  const awayTeamColor = isAway ? '#f59e0b' : (opponent.primaryColor || '#999');
  const homeTeamColor = isAway ? (opponent.primaryColor || '#999') : '#f59e0b';
  const awayName = isAway ? 'My Team' : (opponent.abbreviation || 'OPP');
  const homeName = isAway ? (opponent.abbreviation || 'OPP') : 'My Team';

  return (
    <group>
      {/* Lights highlighting the head-to-head match */}
      <spotLight position={[0, 4, 2]} angle={0.6} penumbra={1} intensity={1} castShadow={false} />

      {/* Particle Effects based on Winner */}
      <Confetti active={showConfetti} />
      <Rain active={showRain} />

      {/* Left Card: Away Team */}
      <group ref={leftCardRef} position={[-2.2, 0, 0]}>
        <mesh>
          <planeGeometry args={[1.5, 2.2]} />
          <meshStandardMaterial color="#111827" roughness={0.4} metalness={0.2} />
        </mesh>
        {/* Border */}
        <mesh position={[0, 0, -0.01]}>
          <planeGeometry args={[1.56, 2.26]} />
          <meshBasicMaterial color={awayTeamColor} />
        </mesh>
        <Text
          position={[0, 0.6, 0.05]}
          fontSize={0.25}
          color={awayTeamColor}
        >
          {awayName}
        </Text>
        <Text
          position={[0, -0.2, 0.05]}
          fontSize={0.7}
          color="#ffffff"
        >
          {currentAway}
        </Text>
        <Text
          position={[0, -0.8, 0.05]}
          fontSize={0.14}
          color="#718096"
        >
          AWAY
        </Text>
      </group>

      {/* VS Indicator in Center */}
      <group position={[0, 0.5, 0.2]}>
        <Text
          fontSize={0.3}
          color="#a0aec0"
        >
          VS
        </Text>
      </group>

      {/* Center Scoreboard Status */}
      <group position={[0, -0.4, 0.2]}>
        <Text
          position={[0, 0.2, 0]}
          fontSize={0.16}
          color="#e2e8f0"
        >
          {isFinal ? 'FINAL' : `INNING ${inningNum}`}
        </Text>
        
        {isFinal && (
          <Text
            position={[0, -0.2, 0]}
            fontSize={0.22}
            color={isWin ? '#10b981' : '#ef4444'}
          >
            {isWin ? '🏆 WIN!' : '☔ LOSS'}
          </Text>
        )}
      </group>

      {/* Right Card: Home Team */}
      <group ref={rightCardRef} position={[2.2, 0, 0]}>
        <mesh>
          <planeGeometry args={[1.5, 2.2]} />
          <meshStandardMaterial color="#111827" roughness={0.4} metalness={0.2} />
        </mesh>
        {/* Border */}
        <mesh position={[0, 0, -0.01]}>
          <planeGeometry args={[1.56, 2.26]} />
          <meshBasicMaterial color={homeTeamColor} />
        </mesh>
        <Text
          position={[0, 0.6, 0.05]}
          fontSize={0.25}
          color={homeTeamColor}
        >
          {homeName}
        </Text>
        <Text
          position={[0, -0.2, 0.05]}
          fontSize={0.7}
          color="#ffffff"
        >
          {currentHome}
        </Text>
        <Text
          position={[0, -0.8, 0.05]}
          fontSize={0.14}
          color="#718096"
        >
          HOME
        </Text>
      </group>
    </group>
  );
}
