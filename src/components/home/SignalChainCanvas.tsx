'use client';

import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useState, useRef } from 'react';
import { Vector3 } from 'three';
import InteractiveWire from './InteractiveWire';
import { ECUConnector, DeviceConnector } from './WireConnector';

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
  const topLeftECUPosition = new Vector3(-1.2, 2.2, 0);  // Top Left - CAN Bus ECU
  const topRightECUPosition = new Vector3(1.2, 2.2, 0);  // Top Right - Power/LIN ECU

  // Wire endpoints - Y-shaped connections with spread out mounting points
  const wireConfigs = [
    // CAN High: Main ECU (bottom) to Top Left ECU - leftmost (no crossing!)
    {
      start: new Vector3(-0.45, -1.75, 0),
      end: new Vector3(-1.25, 1.75, 0),
      color: '#FFD700',
      label: 'CAN H',
    },
    // CAN Low: Main ECU to Top Left ECU - left center (no crossing!)
    {
      start: new Vector3(-0.25, -1.75, 0),
      end: new Vector3(-1.05, 1.75, 0),
      color: '#00FF00',
      label: 'CAN L',
    },
    // LIN: Main ECU to Top Right ECU - center
    {
      start: new Vector3(0, -1.75, 0),
      end: new Vector3(0.95, 1.75, 0),
      color: '#8B00FF',
      label: 'LIN',
    },
    // GND: Main ECU to Top Right ECU - right center
    {
      start: new Vector3(0.25, -1.75, 0),
      end: new Vector3(1.2, 1.75, 0),
      color: '#222222',
      label: 'GND',
    },
    // +12V: Main ECU to Top Right ECU - rightmost
    {
      start: new Vector3(0.45, -1.75, 0),
      end: new Vector3(1.4, 1.75, 0),
      color: '#FF0000',
      label: '+12V',
    },
  ];

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
      </group>

      {/* Top Left ECU - CAN Bus (ports at bottom) */}
      <group position={topLeftECUPosition}>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <boxGeometry args={[0.4, 0.7, 0.15]} />
          <meshStandardMaterial
            color="#2a2a2a"
            metalness={0.6}
            roughness={0.4}
          />
        </mesh>
      </group>

      {/* Top Right ECU - Power/LIN (ports at bottom) */}
      <group position={topRightECUPosition}>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <boxGeometry args={[0.4, 0.9, 0.15]} />
          <meshStandardMaterial
            color="#2a2a2a"
            metalness={0.6}
            roughness={0.4}
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
      
      {/* HTML Labels */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-between py-8">
        <div className="flex w-full justify-between px-12">
          <div className="text-xs font-semibold text-slate-700">CAN BUS</div>
          <div className="text-xs font-semibold text-slate-700">POWER/LIN</div>
        </div>
        <div className="text-xs font-bold text-slate-900">MAIN ECU</div>
      </div>
      
      {/* Playful hint text */}
      <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2">
        <div className="text-xs text-slate-400 animate-pulse">✨ Drag the wires!</div>
      </div>
      
      <div 
        className={`h-full w-full transition-opacity duration-500 ${
          isLoaded ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <Canvas
          camera={{
            position: [0, 0, 6.5],
            fov: 50,
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

