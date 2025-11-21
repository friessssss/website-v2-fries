import { Canvas, useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import { useMemo, useRef } from "react";
import * as THREE from "three";

const wireConfigs = [
  { label: "CAN HI", color: "#d0ff54", height: 1.2, phase: 0, amplitude: 0.25 },
  { label: "CAN LO", color: "#7bffea", height: 0.4, phase: 1.4, amplitude: 0.22 },
  { label: "+12V", color: "#ffae00", height: -0.4, phase: 2.2, amplitude: 0.2 },
  { label: "GND", color: "#ff7bf1", height: -1.2, phase: 3.1, amplitude: 0.18 },
  { label: "LIN", color: "#75a6ff", height: -2.0, phase: 4.3, amplitude: 0.16 },
];

type WireProps = {
  config: (typeof wireConfigs)[number];
  pointer: React.MutableRefObject<THREE.Vector2>;
  timeRef: React.MutableRefObject<number>;
};

function Wire({ config, pointer, timeRef }: WireProps) {
  const resolution = 180;
  const lineRef = useRef<THREE.Line>(null);
  const basePositions = useMemo(() => {
    const arr = new Float32Array(resolution * 3);
    for (let i = 0; i < resolution; i += 1) {
      const t = i / (resolution - 1);
      arr[i * 3] = THREE.MathUtils.lerp(-4, 4, t);
      arr[i * 3 + 1] = config.height;
      arr[i * 3 + 2] = 0;
    }
    return arr;
  }, [config.height, resolution]);

  useFrame((_, delta) => {
    if (!lineRef.current) return;
    const { geometry } = lineRef.current;
    const positions = geometry.attributes.position.array as Float32Array;
    timeRef.current += delta;
    const pointerInfluence = pointer.current.length() > 0 ? pointer.current.y * 0.5 : 0;

    for (let i = 0; i < resolution; i += 1) {
      const baseX = basePositions[i * 3];
      const wave =
        Math.sin(baseX * 1.4 + timeRef.current * 1.2 + config.phase) * config.amplitude;
      const pull =
        Math.exp(-Math.abs(baseX - pointer.current.x)) * pointerInfluence * 0.4;
      positions[i * 3] = baseX;
      positions[i * 3 + 1] = config.height + wave + pull;
      positions[i * 3 + 2] =
        Math.cos(baseX * 0.9 + timeRef.current * 0.9 + config.phase) * config.amplitude * 0.6;
    }

    geometry.attributes.position.needsUpdate = true;
  });

  return (
    <group>
      <line ref={lineRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            array={basePositions.slice()}
            count={resolution}
            itemSize={3}
          />
        </bufferGeometry>
        <lineBasicMaterial color={config.color} linewidth={2} transparent opacity={0.9} />
      </line>
      <Html position={[3.6, config.height + 0.3, 0]} transform>
        <div className="rounded-full bg-black/60 px-3 py-1 text-xs font-semibold uppercase tracking-[0.4em] text-white shadow-[0.3rem_0.3rem_0_#04030d] backdrop-blur">
          {config.label}
        </div>
      </Html>
    </group>
  );
}

function PointerTracker({
  pointer,
  target,
}: {
  pointer: React.MutableRefObject<THREE.Vector2>;
  target: React.MutableRefObject<THREE.Vector2>;
}) {
  useFrame(() => {
    pointer.current.lerp(target.current, 0.08);
  });
  return null;
}

export default function InteractiveWires() {
  const pointer = useRef(new THREE.Vector2(0, 0));
  const pointerTarget = useRef(new THREE.Vector2(0, 0));
  const timeRef = useRef(0);

  return (
    <div className="absolute inset-0">
      <Canvas camera={{ position: [0, 0, 7], fov: 45 }} gl={{ alpha: true }}>
        <color attach="background" args={["transparent"]} />
        <ambientLight intensity={0.15} />
        <PointerTracker pointer={pointer} target={pointerTarget} />
        {wireConfigs.map((config) => (
          <Wire key={config.label} config={config} pointer={pointer} timeRef={timeRef} />
        ))}
        <mesh
          position={[0, 0, -1]}
          onPointerMove={(event) => {
            pointerTarget.current.set(event.point.x, event.point.y);
          }}
          onPointerLeave={() => pointerTarget.current.set(0, 0)}
        >
          <planeGeometry args={[20, 10]} />
          <meshBasicMaterial transparent opacity={0} />
        </mesh>
      </Canvas>
    </div>
  );
}

