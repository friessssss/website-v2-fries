'use client';

import * as THREE from 'three';

type ConnectorPortProps = {
  position: THREE.Vector3;
  label: string;
  color: string;
};

function ConnectorPort({ position, label, color }: ConnectorPortProps) {
  return (
    <group position={position}>
      {/* Main connector port */}
      <mesh>
        <boxGeometry args={[0.08, 0.08, 0.05]} />
        <meshStandardMaterial
          color="#2a2a2a"
          metalness={0.8}
          roughness={0.3}
        />
      </mesh>
      
      {/* Pin/contact inside */}
      <mesh position={[0, 0, 0.03]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.015, 0.015, 0.04, 8]} />
        <meshStandardMaterial
          color={color}
          metalness={0.9}
          roughness={0.2}
          emissive={color}
          emissiveIntensity={0.3}
        />
      </mesh>
      
      {/* Subtle glow around pin */}
      <mesh position={[0, 0, 0.04]}>
        <sphereGeometry args={[0.025, 16, 16]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.2}
        />
      </mesh>
      
      {/* Label - removed to prevent loading issues */}
    </group>
  );
}

type ConnectorBoxProps = {
  position: THREE.Vector3;
  label: string;
  ports: { position: THREE.Vector3; label: string; color: string }[];
};

export function ConnectorBox({ position, label, ports }: ConnectorBoxProps) {
  // Calculate box size based on number of ports
  const numPorts = ports.length;
  const portSpacing = 0.15;
  const height = numPorts * portSpacing + 0.1;

  return (
    <group position={position}>
      {/* Main connector housing */}
      <mesh>
        <boxGeometry args={[0.25, height, 0.12]} />
        <meshStandardMaterial
          color="#3a3a3a"
          metalness={0.6}
          roughness={0.4}
        />
      </mesh>
      
      {/* Connector label - removed to prevent loading issues */}
      
      {/* Individual ports */}
      {ports.map((port, index) => {
        const yOffset = (index - (numPorts - 1) / 2) * portSpacing;
        const portPos = new THREE.Vector3(
          port.position.x,
          port.position.y + yOffset,
          port.position.z,
        );
        return (
          <ConnectorPort
            key={port.label}
            position={portPos}
            label={port.label}
            color={port.color}
          />
        );
      })}
    </group>
  );
}

type ECUConnectorProps = {
  position: THREE.Vector3;
};

export function ECUConnector({ position }: ECUConnectorProps) {
  // Ports on top (for CAN) and bottom (for power/LIN)
  const portsTop = [
    { position: new THREE.Vector3(0.1, 0.35, 0), label: 'CAN H', color: '#FFD700' },
    { position: new THREE.Vector3(-0.1, 0.35, 0), label: 'CAN L', color: '#00FF00' },
  ];
  
  const portsBottom = [
    { position: new THREE.Vector3(0.15, -0.35, 0), label: '+12V', color: '#FF0000' },
    { position: new THREE.Vector3(0, -0.35, 0), label: 'GND', color: '#222222' },
    { position: new THREE.Vector3(-0.15, -0.35, 0), label: 'LIN', color: '#8B00FF' },
  ];

  return (
    <group position={position}>
      {/* ECU Box - rotated to be horizontal */}
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <boxGeometry args={[0.7, 1.2, 0.15]} />
        <meshStandardMaterial
          color="#1a1a1a"
          metalness={0.7}
          roughness={0.3}
        />
      </mesh>
      
      {/* ECU Label - removed to prevent loading issues */}
      
      {/* Top Ports (CAN) */}
      {portsTop.map((port) => (
        <ConnectorPort
          key={port.label}
          position={port.position}
          label={port.label}
          color={port.color}
        />
      ))}
      
      {/* Bottom Ports (Power/LIN) */}
      {portsBottom.map((port) => (
        <ConnectorPort
          key={port.label}
          position={port.position}
          label={port.label}
          color={port.color}
        />
      ))}
    </group>
  );
}

type DeviceConnectorProps = {
  position: THREE.Vector3;
  label: string;
  ports: { label: string; color: string }[];
};

export function DeviceConnector({ position, label, ports }: DeviceConnectorProps) {
  const numPorts = ports.length;
  const portSpacing = 0.15;
  const width = numPorts * portSpacing + 0.3;

  return (
    <group position={position}>
      {/* Device Box - rotated to be horizontal */}
      <mesh rotation={[0, 0, Math.PI / 2]}>
        <boxGeometry args={[0.35, width, 0.12]} />
        <meshStandardMaterial
          color="#2a2a2a"
          metalness={0.6}
          roughness={0.4}
        />
      </mesh>
      
      {/* Device Label - removed to prevent loading issues */}
      
      {/* Ports - positioned horizontally at bottom */}
      {ports.map((port, index) => {
        const xOffset = (index - (numPorts - 1) / 2) * portSpacing;
        const portPos = new THREE.Vector3(xOffset, -0.18, 0);
        return (
          <ConnectorPort
            key={port.label}
            position={portPos}
            label={port.label}
            color={port.color}
          />
        );
      })}
    </group>
  );
}

