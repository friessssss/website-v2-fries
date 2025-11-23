'use client';

import { Canvas, useFrame } from '@react-three/fiber';
import { useRef, useMemo } from 'react';
import * as THREE from 'three';

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  varying vec2 vUv;
  uniform float uTime;
  uniform vec3 uColor;
  
  // Simplex 2D noise
  vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }

  float snoise(vec2 v){
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
             -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy) );
    vec2 x0 = v -   i + dot(i, C.xx);
    vec2 i1;
    i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod(i, 289.0);
    vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
    + i.x + vec3(0.0, i1.x, 1.0 ));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m ;
    m = m*m ;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  void main() {
    // Normalize UVs to maintain aspect ratio roughly (assuming square plane but screen is rect)
    // For a background, we can just use vUv directly, but scaling it down makes features larger
    vec2 uv = vUv * 2.5; 
    
    // Animate: Move the noise field over time
    float time = uTime * 0.02;
    vec2 move = vec2(time * 0.5, time * 0.2);
    
    // Layered noise for more organic shape
    float n = snoise(uv + move);
    n += 0.5 * snoise(uv * 2.0 - move);
    n += 0.25 * snoise(uv * 4.0 + move);
    
    // Normalize to 0-1 roughly
    float h = n * 0.5 + 0.5;
    
    // Create contour lines
    // Frequency determines how many lines
    float frequency = 15.0;
    
    // Basic saw wave pattern
    float pattern = fract(h * frequency);
    
    // Create sharp lines from the pattern
    // We want the line to be at the "edge" of the saw wave, e.g. near 0 or 1
    float lineThickness = 0.08; // Thickness of the line relative to the gap
    
    // Smoothstep for anti-aliased edges
    // We create a pulse where pattern is close to 0
    float line = smoothstep(0.0, lineThickness, pattern) - smoothstep(lineThickness, lineThickness * 2.0, pattern);
    
    // Alternative: use sine wave for smoother undulation
    // float line = smoothstep(0.95, 1.0, sin(h * frequency * 3.14159));
    
    // Distance based opacity fading at edges (optional vignette)
    float vignette = 1.0 - smoothstep(0.5, 1.5, length(vUv - 0.5));
    
    gl_FragColor = vec4(uColor, line * 0.4 * vignette + 0.05); // Add base opacity
  }
`;

function TopographicMap() {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  
  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    uColor: { value: new THREE.Color('#10b981') }, // Emerald 500
  }), []);

  useFrame((state) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value = state.clock.getElapsedTime();
    }
  });

  return (
    <mesh>
      {/* Large plane to cover the background */}
      <planeGeometry args={[20, 20]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent
        uniforms={uniforms}
      />
    </mesh>
  );
}

export default function TopographicBackground() {
  return (
    <div className="fixed inset-0 -z-10 opacity-30 pointer-events-none mix-blend-multiply">
      <Canvas
        camera={{ position: [0, 0, 5], fov: 50 }}
        gl={{ alpha: true, antialias: true }}
        style={{ background: 'transparent' }}
      >
        <TopographicMap />
      </Canvas>
    </div>
  );
}
