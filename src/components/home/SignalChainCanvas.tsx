'use client';

import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useState, useRef, useMemo } from 'react';
import { Vector3 } from 'three';
import InteractiveWire from './InteractiveWire';
import { ECUConnector, DeviceConnector } from './WireConnector';

// Port positions for wire connections
export const PORT_POSITIONS = {
  mainECU: [
    new Vector3(-0.45, -1.75, 0),  // Port 0: CAN H
    new Vector3(-0.25, -1.75, 0),  // Port 1: CAN L
    new Vector3(0, -1.75, 0),      // Port 2: LIN
    new Vector3(0.25, -1.75, 0),   // Port 3: GND
    new Vector3(0.45, -1.75, 0),   // Port 4: +12V
  ],
  computer: [
    new Vector3(-1.25, 2.15, 0),   // Port 0: CAN H
    new Vector3(-1.05, 2.15, 0),   // Port 1: CAN L
  ],
  sensor: [
    new Vector3(0.95, 2.15, 0),    // Port 0: LIN
    new Vector3(1.2, 2.15, 0),     // Port 1: GND
    new Vector3(1.4, 2.15, 0),     // Port 2: +12V
  ],
};

// Flatten all ports into a single array for easier detection
export const ALL_PORTS = [
  ...PORT_POSITIONS.mainECU,
  ...PORT_POSITIONS.computer,
  ...PORT_POSITIONS.sensor,
];

function Scene() {
  const { camera, size } = useThree();
  
  // Shared reference for all wire physics systems for collision detection
  const wireSystemsRef = useRef<any[]>([]);

  // Adjust camera based on viewport size - zoomed out for Y-shaped layout
  useEffect(() => {
    if (size.width < 640) {
      // Mobile - zoom out more to see full Y shape
      camera.position.set(0, 0, 8);
    } else if (size.width < 1024) {
      // Tablet
      camera.position.set(0, 0, 7);
    } else {
      // Desktop
      camera.position.set(0, 0, 6.5);
    }
    camera.updateProjectionMatrix();
  }, [size, camera]);

  // Y-shaped layout - Main ECU at bottom, 2 ECUs at top
  const mainECUPosition = new Vector3(0, -2.2, 0);    // Bottom - Main ECU
  const topLeftECUPosition = new Vector3(-1.2, 2.6, 0);  // Top Left - Computer (moved up)
  const topRightECUPosition = new Vector3(1.2, 2.6, 0);  // Top Right - Sensor (moved up)

  // Wire endpoints - Y-shaped connections with spread out mounting points
  // Memoized to prevent recreation on every render (which would reset physics)
  const wireConfigs = useMemo(() => [
    // CAN High: Main ECU (bottom) to Computer - leftmost (no crossing!)
    {
      start: new Vector3(-0.45, -1.75, 0),
      end: new Vector3(-1.25, 2.15, 0),
      color: '#FFD700',
      label: 'CAN H',
    },
    // CAN Low: Main ECU to Computer - left center (no crossing!)
    {
      start: new Vector3(-0.25, -1.75, 0),
      end: new Vector3(-1.05, 2.15, 0),
      color: '#00FF00',
      label: 'CAN L',
    },
    // LIN: Main ECU to Sensor - center
    {
      start: new Vector3(0, -1.75, 0),
      end: new Vector3(0.95, 2.15, 0),
      color: '#8B00FF',
      label: 'LIN',
    },
    // GND: Main ECU to Sensor - right center
    {
      start: new Vector3(0.25, -1.75, 0),
      end: new Vector3(1.2, 2.15, 0),
      color: '#222222',
      label: 'GND',
    },
    // +12V: Main ECU to Sensor - rightmost
    {
      start: new Vector3(0.45, -1.75, 0),
      end: new Vector3(1.4, 2.15, 0),
      color: '#FF0000',
      label: '+12V',
    },
  ], []); // Empty deps - these positions never change

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 5, 5]} intensity={0.8} castShadow />
      <directionalLight position={[-5, -5, -5]} intensity={0.3} />
      <pointLight position={[0, 2, 2]} intensity={0.5} />
      <pointLight position={[0, -2, 2]} intensity={0.3} color="#8B00FF" />
      
      {/* Subtle background grid */}
      <mesh position={[0, 0, -0.5]} rotation={[0, 0, 0]}>
        <planeGeometry args={[8, 8]} />
        <meshBasicMaterial 
          color="#f8f9fa" 
          transparent 
          opacity={0.3}
        />
      </mesh>

      {/* Main ECU - Bottom (ports at top) */}
      <group position={mainECUPosition}>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <boxGeometry args={[0.8, 1.5, 0.18]} />
          <meshStandardMaterial
            color="#1a1a1a"
            metalness={0.7}
            roughness={0.3}
          />
        </mesh>
        
        {/* Port indicators on Main ECU */}
        {PORT_POSITIONS.mainECU.map((portPos, index) => (
          <mesh key={index} position={new Vector3(
            portPos.x - mainECUPosition.x,
            portPos.y - mainECUPosition.y + 0.05,
            0.1
          )}>
            <cylinderGeometry args={[0.04, 0.04, 0.02, 8]} />
            <meshStandardMaterial
              color="#0a0a0a"
              metalness={0.5}
              roughness={0.5}
            />
          </mesh>
        ))}
      </group>

      {/* Top Left ECU - Computer Model (ports at bottom) */}
      <group position={topLeftECUPosition}>
        {/* Monitor Screen */}
        <mesh position={[0, 0.05, 0]}>
          <boxGeometry args={[0.6, 0.45, 0.05]} />
          <meshStandardMaterial
            color="#1a1a1a"
            metalness={0.3}
            roughness={0.7}
          />
        </mesh>
        
        {/* Screen Display (glowing) */}
        <mesh position={[0, 0.05, 0.026]}>
          <boxGeometry args={[0.52, 0.37, 0.01]} />
          <meshStandardMaterial
            color="#3a5a7a"
            emissive="#1a3a5a"
            emissiveIntensity={0.4}
            metalness={0.1}
            roughness={0.2}
          />
        </mesh>
        
        {/* Monitor Bezel */}
        <mesh position={[0, 0.05, 0.026]}>
          <boxGeometry args={[0.62, 0.47, 0.01]} />
          <meshStandardMaterial
            color="#0a0a0a"
            metalness={0.5}
            roughness={0.5}
            transparent
            opacity={0.3}
          />
        </mesh>
        
        {/* Keyboard Base */}
        <mesh position={[0, -0.28, 0.02]}>
          <boxGeometry args={[0.55, 0.15, 0.08]} />
          <meshStandardMaterial
            color="#2a2a2a"
            metalness={0.4}
            roughness={0.6}
          />
        </mesh>
        
        {/* Keyboard Keys Detail */}
        <mesh position={[0, -0.27, 0.062]}>
          <boxGeometry args={[0.48, 0.12, 0.01]} />
          <meshStandardMaterial
            color="#1a1a1a"
            metalness={0.2}
            roughness={0.8}
          />
        </mesh>
        
        {/* Monitor Stand */}
        <mesh position={[0, -0.17, 0]}>
          <cylinderGeometry args={[0.04, 0.06, 0.1, 8]} />
          <meshStandardMaterial
            color="#2a2a2a"
            metalness={0.6}
            roughness={0.4}
          />
        </mesh>
        
        {/* Port indicators on keyboard base */}
        <mesh position={[-0.2, -0.28, 0.062]}>
          <sphereGeometry args={[0.015, 8, 8]} />
          <meshStandardMaterial
            color="#FFD700"
            emissive="#FFD700"
            emissiveIntensity={0.2}
          />
        </mesh>
        <mesh position={[-0.1, -0.28, 0.062]}>
          <sphereGeometry args={[0.015, 8, 8]} />
          <meshStandardMaterial
            color="#00FF00"
            emissive="#00FF00"
            emissiveIntensity={0.2}
          />
        </mesh>
      </group>

      {/* Top Right ECU - Backup Sensor/Dimmer Switch (ports at bottom) */}
      <group position={topRightECUPosition}>
        {/* Main Sensor Body - Cylindrical/Pill Shape */}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <capsuleGeometry args={[0.15, 0.4, 12, 16]} />
          <meshStandardMaterial
            color="#2a2a2a"
            metalness={0.3}
            roughness={0.6}
          />
        </mesh>
        
        {/* Sensor Face/Lens */}
        <mesh position={[0, 0.25, 0]}>
          <cylinderGeometry args={[0.12, 0.12, 0.03, 16]} />
          <meshStandardMaterial
            color="#1a1a2a"
            metalness={0.8}
            roughness={0.1}
            emissive="#1a1a3a"
            emissiveIntensity={0.3}
          />
        </mesh>
        
        {/* Sensor Lens Inner Circle */}
        <mesh position={[0, 0.265, 0]}>
          <cylinderGeometry args={[0.08, 0.08, 0.01, 16]} />
          <meshStandardMaterial
            color="#0a0a1a"
            metalness={0.9}
            roughness={0.05}
            emissive="#2a2a4a"
            emissiveIntensity={0.5}
          />
        </mesh>
        
        {/* Mounting Bracket Top */}
        <mesh position={[0, 0.1, -0.12]} rotation={[Math.PI / 6, 0, 0]}>
          <boxGeometry args={[0.08, 0.15, 0.02]} />
          <meshStandardMaterial
            color="#3a3a3a"
            metalness={0.5}
            roughness={0.5}
          />
        </mesh>
        
        {/* Mounting Bracket Bottom */}
        <mesh position={[0, -0.1, -0.12]} rotation={[-Math.PI / 6, 0, 0]}>
          <boxGeometry args={[0.08, 0.15, 0.02]} />
          <meshStandardMaterial
            color="#3a3a3a"
            metalness={0.5}
            roughness={0.5}
          />
        </mesh>
        
        {/* Wire Entry Point */}
        <mesh position={[0, -0.25, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.06, 0.08, 0.08, 8]} />
          <meshStandardMaterial
            color="#1a1a1a"
            metalness={0.4}
            roughness={0.6}
          />
        </mesh>
        
        {/* Port Indicators */}
        <mesh position={[0.05, -0.28, 0]}>
          <sphereGeometry args={[0.015, 8, 8]} />
          <meshStandardMaterial
            color="#8B00FF"
            emissive="#8B00FF"
            emissiveIntensity={0.2}
          />
        </mesh>
        <mesh position={[-0.05, -0.28, 0]}>
          <sphereGeometry args={[0.015, 8, 8]} />
          <meshStandardMaterial
            color="#222222"
            emissive="#444444"
            emissiveIntensity={0.1}
          />
        </mesh>
        <mesh position={[0.15, -0.28, 0]}>
          <sphereGeometry args={[0.015, 8, 8]} />
          <meshStandardMaterial
            color="#FF0000"
            emissive="#FF0000"
            emissiveIntensity={0.2}
          />
        </mesh>
      </group>

      {/* Interactive Wires */}
      {wireConfigs.map((config, index) => (
        <InteractiveWire
          key={config.label}
          startPos={config.start}
          endPos={config.end}
          color={config.color}
          label={config.label}
          wireSystemsRef={wireSystemsRef}
          wireIndex={index}
          allPorts={ALL_PORTS}
        />
      ))}
    </>
  );
}

export default function SignalChainCanvas() {
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    // Simulate load time for Three.js initialization
    const timer = setTimeout(() => setIsLoaded(true), 100);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="relative h-full w-full">
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-sm text-slate-400">Loading 3D scene...</div>
        </div>
      )}
      
      <div 
        className={`h-full w-full transition-opacity duration-500 ${
          isLoaded ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <Canvas
          camera={{
            position: [0, 0, 5.5],
            fov: 45,
          }}
          gl={{ 
            antialias: true, 
            alpha: true,
            powerPreference: 'high-performance',
          }}
          dpr={[1, 2]}
          performance={{ min: 0.5 }}
          style={{ background: 'transparent' }}
        >
          <Scene />
        </Canvas>
      </div>
    </div>
  );
}

