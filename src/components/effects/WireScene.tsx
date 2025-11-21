"use client";

import { Suspense, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

type WireProps = {
  color: string;
  offset: number;
  amplitude?: number;
};

function Wire({ color, offset, amplitude = 0.3 }: WireProps) {
  const resolution = 220;
  const positions = useMemo(() => {
    const arr = new Float32Array(resolution * 3);
    for (let i = 0; i < resolution; i += 1) {
      const t = i / (resolution - 1);
      const x = THREE.MathUtils.lerp(-4, 4, t);
      arr[i * 3] = x;
      arr[i * 3 + 1] = 0;
      arr[i * 3 + 2] = 0;
    }
    return arr;
  }, [resolution]);

  const attributeRef = useRef<THREE.BufferAttribute | null>(null);

  useFrame(({ clock, pointer }) => {
    const time = clock.getElapsedTime();
    const pointerInfluence = pointer.y * 0.8;

    for (let i = 0; i < resolution; i += 1) {
      const x = positions[i * 3];
      positions[i * 3 + 1] =
        Math.sin(x * 1.2 + time * 1.2 + offset) * amplitude + pointerInfluence;
      positions[i * 3 + 2] =
        Math.cos(x * 0.9 + time * 0.8 + offset) * amplitude * 0.5 + pointer.x;
    }

    if (attributeRef.current) {
      attributeRef.current.needsUpdate = true;
    }
  });

  return (
    <line>
      <bufferGeometry>
        <bufferAttribute
          ref={attributeRef}
          attach="attributes-position"
          array={positions}
          count={resolution}
          itemSize={3}
        />
      </bufferGeometry>
      <lineBasicMaterial color={color} linewidth={2} transparent opacity={0.8} />
    </line>
  );
}

export default function WireScene() {
  return (
    <div className="absolute inset-x-0 top-0 h-[520px]">
      <Canvas camera={{ position: [0, 0, 7], fov: 45 }} gl={{ alpha: true }}>
        <color attach="background" args={["transparent"]} />
        <ambientLight intensity={0.2} />
        <Suspense fallback={null}>
          <Wire color="#6df5d9" offset={0} amplitude={0.35} />
          <Wire color="#ff7fd1" offset={1.2} amplitude={0.28} />
          <Wire color="#ffee7a" offset={2.4} amplitude={0.22} />
        </Suspense>
      </Canvas>
    </div>
  );
}

