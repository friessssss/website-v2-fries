'use client';

import { Canvas, useFrame } from '@react-three/fiber';
import { useRef, useMemo } from 'react';
import * as THREE from 'three';

function TopographicLines() {
  const linesRef = useRef<THREE.Group[]>([]);
  
  // Function to create a single wild topographic line
  const createLineGeometry = () => {
    const points = [];
    const segments = 150;
    const radius = 25 + Math.random() * 15; // Much larger for full width
    
    // Wild random frequency multipliers for each line
    const freq1 = 1 + Math.random() * 6;
    const freq2 = 2 + Math.random() * 7;
    const freq3 = 1 + Math.random() * 5;
    const freq4 = 3 + Math.random() * 4;
    const amp1 = 0.6 + Math.random() * 1.5; // Very wild amplitudes
    const amp2 = 0.5 + Math.random() * 1.2;
    const amp3 = 0.4 + Math.random() * 1.0;
    const amp4 = 0.3 + Math.random() * 0.8;
    
    for (let j = 0; j < segments; j++) { // Don't include endpoint to avoid duplicate
      const angle = (j / segments) * Math.PI * 2;
      
      // Create very wild organic wavy pattern
      const noise = 
        Math.sin(angle * freq1) * amp1 + 
        Math.cos(angle * freq2) * amp2 +
        Math.sin(angle * freq3) * amp3 +
        Math.cos(angle * freq4) * amp4;
      const r = radius + noise;
      
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
      const z = Math.sin(angle * 3) * 0.6 + Math.cos(angle * 2) * 0.5;
      
      points.push(new THREE.Vector3(x, y, z));
    }
    
    // Create closed curve
    const curve = new THREE.CatmullRomCurve3(points, true); // true = closed curve
    const curvePoints = curve.getPoints(300);
    return new THREE.BufferGeometry().setFromPoints(curvePoints);
  };
  
  // Create initial lines
  const lines = useMemo(() => {
    const lineObjects = [];
    const numLines = 12; // Fewer lines
    
    for (let i = 0; i < numLines; i++) {
      lineObjects.push({
        geometry: createLineGeometry(),
        initialZ: -15 - i * 2.5, // More spacing between lines
      });
    }
    
    return lineObjects;
  }, []);
  
  // Animate lines converging toward center point, recycle when converged
  useFrame((state, delta) => {
    linesRef.current.forEach((lineGroup, index) => {
      if (!lineGroup) return;
      
      // Move lines toward convergence point (forward in Z)
      lineGroup.position.z += delta * 0.8; // Slower convergence
      
      // Scale down as they converge (shrinking effect)
      const distanceFromConvergence = Math.abs(lineGroup.position.z);
      const scale = Math.max(0.05, Math.min(1, distanceFromConvergence / 15));
      lineGroup.scale.setScalar(scale);
      
      // Fade out as they approach convergence
      const lineMaterial = (lineGroup.children[0] as any)?.material;
      if (lineMaterial) {
        lineMaterial.opacity = Math.max(0.15, Math.min(0.5, scale * 0.6));
      }
      
      // When line converges (gets very close), reset to back with new geometry
      if (lineGroup.position.z > 1) {
        lineGroup.position.z = -15 - Math.random() * 10; // Reset to back with more randomness
        lineGroup.scale.setScalar(1);
        
        // Create new geometry for recycled line
        const newGeometry = createLineGeometry();
        const line = lineGroup.children[0] as THREE.Line;
        if (line && line.geometry) {
          line.geometry.dispose();
          line.geometry = newGeometry;
        }
      }
      
      // Slow rotation for organic feel
      lineGroup.rotation.z = state.clock.getElapsedTime() * 0.04 + index * 0.05;
    });
  });
  
  return (
    <>
      {lines.map((line, index) => (
        <group
          key={index}
          ref={(el) => { if (el) linesRef.current[index] = el; }}
          position={[0, 0, line.initialZ]}
        >
          <line>
            <bufferGeometry attach="geometry" {...line.geometry} />
            <lineBasicMaterial
              attach="material"
              color="#10b981"
              transparent
              opacity={0.4}
              linewidth={6}
            />
          </line>
        </group>
      ))}
    </>
  );
}

export default function TopographicBackground() {
  return (
    <div className="absolute inset-0 -z-10">
      <Canvas
        camera={{ position: [0, 0, 25], fov: 70 }} // Pulled back and wider FOV
        gl={{ alpha: true, antialias: true }}
        style={{ background: 'transparent' }}
      >
        <ambientLight intensity={0.5} />
        <TopographicLines />
      </Canvas>
    </div>
  );
}

