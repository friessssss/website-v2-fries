'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useRef, useState, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { WirePhysicsSystem } from './WirePhysics';

type InteractiveWireProps = {
  startPos: THREE.Vector3;
  endPos: THREE.Vector3;
  color: string;
  label: string;
  numPoints?: number;
  wireSystemsRef?: React.MutableRefObject<any[]>; // Shared ref for all wire systems
  wireIndex?: number; // Index of this wire in the systems array
  allPorts?: THREE.Vector3[]; // All available port positions
};

// Particle effect for unplug/replug visual feedback
type Particle = {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  scale: number;
};

export default function InteractiveWire({
  startPos,
  endPos,
  color,
  label,
  numPoints = 16, // Reduced points for stiffer wires (less segments = less flex)
  wireSystemsRef,
  wireIndex,
  allPorts = [],
}: InteractiveWireProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragPointIndex, setDragPointIndex] = useState<number | null>(null);
  const { camera, raycaster, gl } = useThree();
  
  // Unplugging system state
  const [isStartPlugged, setIsStartPlugged] = useState(true);
  const [isEndPlugged, setIsEndPlugged] = useState(true);
  const [currentStartPos, setCurrentStartPos] = useState(startPos.clone());
  const [currentEndPos, setCurrentEndPos] = useState(endPos.clone());
  const [nearStartEndpoint, setNearStartEndpoint] = useState(false);
  const [nearEndEndpoint, setNearEndEndpoint] = useState(false);
  const [nearPort, setNearPort] = useState<THREE.Vector3 | null>(null);
  
  // Particle effects
  const [particles, setParticles] = useState<Particle[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  
  // Track scroll velocity for subtle wire movement
  const lastScrollY = useRef(0);
  const scrollVelocity = useRef(0);
  
  // Helper function to create particle burst
  const createParticleBurst = (position: THREE.Vector3, isUnplug: boolean) => {
    const newParticles: Particle[] = [];
    const particleCount = isUnplug ? 8 : 12;
    
    for (let i = 0; i < particleCount; i++) {
      const angle = (Math.PI * 2 * i) / particleCount;
      const speed = isUnplug ? 0.05 : 0.08;
      const velocity = new THREE.Vector3(
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        (Math.random() - 0.5) * speed * 0.5
      );
      
      newParticles.push({
        position: position.clone(),
        velocity,
        life: 1.0,
        maxLife: 1.0,
        scale: 0.03 + Math.random() * 0.02,
      });
    }
    
    particlesRef.current = [...particlesRef.current, ...newParticles];
    setParticles(particlesRef.current);
  };
  
  // Helper function to find nearest port
  const findNearestPort = (position: THREE.Vector3, maxDistance: number = 0.4): THREE.Vector3 | null => {
    let nearestPort: THREE.Vector3 | null = null;
    let minDistance = maxDistance;
    
    for (const port of allPorts) {
      const distance = position.distanceTo(port);
      if (distance < minDistance) {
        minDistance = distance;
        nearestPort = port;
      }
    }
    
    return nearestPort;
  };
  
  // Create physics system
  const physicsSystem = useMemo(() => {
    const system = new WirePhysicsSystem(numPoints, startPos, endPos);
    // Ensure endpoints start at correct positions and are fixed
    system.points[0].setPosition(startPos.x, startPos.y, startPos.z);
    system.points[0].setFixed(true);
    const lastIndex = system.points.length - 1;
    system.points[lastIndex].setPosition(endPos.x, endPos.y, endPos.z);
    system.points[lastIndex].setFixed(true);
    return system;
  }, [numPoints, startPos, endPos]);

  // Register this wire's physics system for collision detection
  useEffect(() => {
    if (wireSystemsRef && wireIndex !== undefined) {
      wireSystemsRef.current[wireIndex] = physicsSystem;
    }
  }, [physicsSystem, wireSystemsRef, wireIndex]);

  // Mouse tracking
  const mouseRef = useRef(new THREE.Vector2());
  const planeRef = useRef(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0));
  const intersectionPoint = useRef(new THREE.Vector3());

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      mouseRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouseRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      // Update cursor on hover and detect proximity to endpoints
      if (!isDragging) {
        raycaster.setFromCamera(mouseRef.current, camera);
        if (meshRef.current) {
          const intersects = raycaster.intersectObject(meshRef.current);
          gl.domElement.style.cursor = intersects.length > 0 ? 'grab' : 'default';
          
          // Check proximity to endpoints for visual feedback
          if (intersects.length > 0) {
            const point = intersects[0].point;
            const startDistance = point.distanceTo(currentStartPos);
            const endDistance = point.distanceTo(currentEndPos);
            const highlightThreshold = 0.35;
            
            setNearStartEndpoint(startDistance < highlightThreshold && isStartPlugged);
            setNearEndEndpoint(endDistance < highlightThreshold && isEndPlugged);
          } else {
            setNearStartEndpoint(false);
            setNearEndEndpoint(false);
          }
        }
      }
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return; // Only left click
      
      // Update raycaster
      raycaster.setFromCamera(mouseRef.current, camera);
      
      // Check if clicking on this wire
      if (meshRef.current) {
        const intersects = raycaster.intersectObject(meshRef.current);
        if (intersects.length > 0) {
          setIsDragging(true);
          gl.domElement.style.cursor = 'grabbing';
          const point = intersects[0].point;
          const nearestIndex = physicsSystem.getNearestPointIndex(point);
          setDragPointIndex(nearestIndex);
          
          // Check if dragging near endpoints for unplugging
          const startDistance = point.distanceTo(currentStartPos);
          const endDistance = point.distanceTo(currentEndPos);
          const unplugThreshold = 0.3;
          
          // Unplug start endpoint if dragging near it
          if (startDistance < unplugThreshold && isStartPlugged) {
            setIsStartPlugged(false);
            physicsSystem.setEndpointFixed(0, false);
            createParticleBurst(currentStartPos, true);
          }
          
          // Unplug end endpoint if dragging near it
          if (endDistance < unplugThreshold && isEndPlugged) {
            setIsEndPlugged(false);
            physicsSystem.setEndpointFixed(-1, false);
            createParticleBurst(currentEndPos, true);
          }
          
          event.preventDefault();
        }
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      setDragPointIndex(null);
      gl.domElement.style.cursor = 'default';
    };
    
    // Track scroll velocity for wire movement
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      scrollVelocity.current = currentScrollY - lastScrollY.current;
      lastScrollY.current = currentScrollY;
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      
      const touch = event.touches[0];
      const rect = gl.domElement.getBoundingClientRect();
      mouseRef.current.x = ((touch.clientX - rect.left) / rect.width) * 2 - 1;
      mouseRef.current.y = -((touch.clientY - rect.top) / rect.height) * 2 + 1;
      
      raycaster.setFromCamera(mouseRef.current, camera);
      
      if (meshRef.current) {
        const intersects = raycaster.intersectObject(meshRef.current);
        if (intersects.length > 0) {
          setIsDragging(true);
          const point = intersects[0].point;
          const nearestIndex = physicsSystem.getNearestPointIndex(point);
          setDragPointIndex(nearestIndex);
          
          // Check if dragging near endpoints for unplugging
          const startDistance = point.distanceTo(currentStartPos);
          const endDistance = point.distanceTo(currentEndPos);
          const unplugThreshold = 0.3;
          
          // Unplug start endpoint if dragging near it
          if (startDistance < unplugThreshold && isStartPlugged) {
            setIsStartPlugged(false);
            physicsSystem.setEndpointFixed(0, false);
            createParticleBurst(currentStartPos, true);
          }
          
          // Unplug end endpoint if dragging near it
          if (endDistance < unplugThreshold && isEndPlugged) {
            setIsEndPlugged(false);
            physicsSystem.setEndpointFixed(-1, false);
            createParticleBurst(currentEndPos, true);
          }
          
          event.preventDefault();
        }
      }
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1 || !isDragging) return;
      
      const touch = event.touches[0];
      const rect = gl.domElement.getBoundingClientRect();
      mouseRef.current.x = ((touch.clientX - rect.left) / rect.width) * 2 - 1;
      mouseRef.current.y = -((touch.clientY - rect.top) / rect.height) * 2 + 1;
      
      event.preventDefault();
    };

    const handleTouchEnd = () => {
      setIsDragging(false);
      setDragPointIndex(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchstart', handleTouchStart, { passive: false });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('scroll', handleScroll);
    };
  }, [camera, raycaster, physicsSystem, gl, isDragging]);

  // Track if wire is settled to optimize updates
  const lastUpdateTime = useRef(0);
  const updateThreshold = 1 / 60; // 60 FPS cap

  // Update physics and geometry
  useFrame((state, delta) => {
    // Limit updates to 60 FPS
    lastUpdateTime.current += delta;
    if (lastUpdateTime.current < updateThreshold && !isDragging && particlesRef.current.length === 0) {
      return;
    }
    lastUpdateTime.current = 0;
    
    // Update particles
    if (particlesRef.current.length > 0) {
      particlesRef.current = particlesRef.current.filter((particle) => {
        particle.life -= delta * 2;
        particle.position.add(particle.velocity);
        particle.velocity.multiplyScalar(0.95); // Damping
        particle.velocity.y -= 0.002; // Gravity
        return particle.life > 0;
      });
      setParticles([...particlesRef.current]);
    }

    // Very minimal scroll effect for stiff wires
    if (!isDragging && Math.abs(scrollVelocity.current) > 5) {
      const middleIndex = Math.floor(physicsSystem.points.length / 2);
      const scrollForce = new THREE.Vector3(
        scrollVelocity.current * 0.00003,
        scrollVelocity.current * -0.00001,
        0
      );
      physicsSystem.applyForceToPoint(middleIndex, scrollForce);
    }
    
    // Fast decay of scroll velocity
    scrollVelocity.current *= 0.7;

    // Update endpoint positions for display - read from physics system
    // Don't force position updates every frame, let fixed flag handle it
    setCurrentStartPos(physicsSystem.getEndpointPosition(0));
    setCurrentEndPos(physicsSystem.getEndpointPosition(-1));

    // Handle dragging - moderate force for stiffer wire feel
    if (isDragging && dragPointIndex !== null) {
      raycaster.setFromCamera(mouseRef.current, camera);
      raycaster.ray.intersectPlane(planeRef.current, intersectionPoint.current);
      
      const currentPos = physicsSystem.points[dragPointIndex].position;
      const force = new THREE.Vector3()
        .subVectors(intersectionPoint.current, currentPos)
        .multiplyScalar(0.5); // Increased responsiveness for better feel
      
      physicsSystem.applyForceToPoint(dragPointIndex, force);
      
      // Magnetic snapping to ports for unplugged endpoints
      const isStartEndpoint = dragPointIndex === 0;
      const isEndEndpoint = dragPointIndex === physicsSystem.points.length - 1;
      
      if ((isStartEndpoint && !isStartPlugged) || (isEndEndpoint && !isEndPlugged)) {
        const nearestPort = findNearestPort(currentPos, 0.4);
        setNearPort(nearestPort);
        
        if (nearestPort) {
          // Apply magnetic attraction force
          const attractionForce = new THREE.Vector3()
            .subVectors(nearestPort, currentPos)
            .multiplyScalar(0.3);
          physicsSystem.applyForceToPoint(dragPointIndex, attractionForce);
          
          // Snap and replug if very close
          const snapDistance = 0.15;
          if (currentPos.distanceTo(nearestPort) < snapDistance) {
            if (isStartEndpoint) {
              setIsStartPlugged(true);
              physicsSystem.setEndpointFixed(0, true);
              physicsSystem.points[0].setPosition(nearestPort.x, nearestPort.y, nearestPort.z);
              setCurrentStartPos(nearestPort.clone());
              createParticleBurst(nearestPort, false);
            } else if (isEndEndpoint) {
              setIsEndPlugged(true);
              physicsSystem.setEndpointFixed(-1, true);
              const lastIndex = physicsSystem.points.length - 1;
              physicsSystem.points[lastIndex].setPosition(nearestPort.x, nearestPort.y, nearestPort.z);
              setCurrentEndPos(nearestPort.clone());
              createParticleBurst(nearestPort, false);
            }
            setIsDragging(false);
            setDragPointIndex(null);
          }
        }
      } else {
        setNearPort(null);
      }
    } else {
      setNearPort(null);
    }

    // Strong wire-to-wire collision with bounce - wires CANNOT pass through each other
    if (wireSystemsRef && wireSystemsRef.current.length > 0) {
      const collisionRadius = 0.22; // Larger detection radius for thick stiff wires
      const repulsionStrength = 0.25; // Strong repulsion for satisfying push interactions
      const bounceStrength = 0.1; // Good bounce on collision for impact feel
      
      for (let i = 1; i < physicsSystem.points.length - 1; i++) {
        const point = physicsSystem.points[i];
        if (point.isFixed) continue;
        
        // Check against all other wires
        for (let w = 0; w < wireSystemsRef.current.length; w++) {
          const otherSystem = wireSystemsRef.current[w];
          if (!otherSystem || otherSystem === physicsSystem) continue;
          
          for (let j = 1; j < otherSystem.points.length - 1; j++) {
            const otherPoint = otherSystem.points[j];
            const distance = point.position.distanceTo(otherPoint.position);
            
            if (distance < collisionRadius && distance > 0.001) {
              // Calculate strong repulsion direction
              const repulsion = new THREE.Vector3()
                .subVectors(point.position, otherPoint.position)
                .normalize();
              
              // Exponential repulsion - much stronger when very close
              const penetration = collisionRadius - distance;
              const force = repulsionStrength * Math.pow(penetration / collisionRadius, 2);
              
              // Add bounce based on relative velocity
              const relativeVelocity = new THREE.Vector3()
                .subVectors(point.velocity, otherPoint.velocity)
                .dot(repulsion);
              
              const bounce = Math.max(0, -relativeVelocity) * bounceStrength;
              
              repulsion.multiplyScalar(force + bounce);
              
              // Apply strong repulsion force with bounce
              physicsSystem.applyForceToPoint(i, repulsion);
              
              // Create subtle particle effect on strong collision
              if (penetration > collisionRadius * 0.6 && Math.random() > 0.97) {
                const collisionPoint = new THREE.Vector3()
                  .addVectors(point.position, otherPoint.position)
                  .multiplyScalar(0.5);
                
                // Create 2-3 small particles
                for (let p = 0; p < 2; p++) {
                  const particleVel = new THREE.Vector3(
                    (Math.random() - 0.5) * 0.03,
                    (Math.random() - 0.5) * 0.03,
                    (Math.random() - 0.5) * 0.02
                  );
                  particlesRef.current.push({
                    position: collisionPoint.clone(),
                    velocity: particleVel,
                    life: 0.5,
                    maxLife: 0.5,
                    scale: 0.015,
                  });
                }
              }
            }
          }
        }
      }
    }

    // Update physics
    physicsSystem.update(delta);

    // Update wire geometry - SUPER THICK wires for playful, substantial presence
    if (meshRef.current) {
      const positions = physicsSystem.getPositions();
      const curve = new THREE.CatmullRomCurve3(positions);
      const tubeGeometry = new THREE.TubeGeometry(curve, 64, 0.08, 12, false);
      
      if (meshRef.current.geometry) {
        meshRef.current.geometry.dispose();
      }
      meshRef.current.geometry = tubeGeometry;
    }
  });

  return (
    <group>
      <mesh ref={meshRef}>
        <meshPhongMaterial
          color={color}
          shininess={isDragging ? 50 : 30}
          specular={isDragging ? 0x666666 : 0x444444}
          emissive={color}
          emissiveIntensity={isDragging ? 0.3 : (nearPort ? 0.25 : 0.08)}
        />
      </mesh>
      
      {/* Glow at connection points - extra large for super thick wires */}
      <mesh position={currentStartPos}>
        <sphereGeometry args={[0.1, 16, 16]} />
        <meshBasicMaterial 
          color={color}
          opacity={isStartPlugged ? 1.0 : 0.7}
          transparent={!isStartPlugged}
        />
      </mesh>
      <mesh position={currentEndPos}>
        <sphereGeometry args={[0.1, 16, 16]} />
        <meshBasicMaterial 
          color={color}
          opacity={isEndPlugged ? 1.0 : 0.7}
          transparent={!isEndPlugged}
        />
      </mesh>
      
      {/* Outer glow effect at connection points */}
      <mesh position={currentStartPos}>
        <sphereGeometry args={[nearStartEndpoint ? 0.2 : 0.15, 16, 16]} />
        <meshBasicMaterial 
          color={color} 
          transparent 
          opacity={nearStartEndpoint ? 0.6 : (isStartPlugged ? 0.3 : 0.15)}
        />
      </mesh>
      <mesh position={currentEndPos}>
        <sphereGeometry args={[nearEndEndpoint ? 0.2 : 0.15, 16, 16]} />
        <meshBasicMaterial 
          color={color} 
          transparent 
          opacity={nearEndEndpoint ? 0.6 : (isEndPlugged ? 0.3 : 0.15)}
        />
      </mesh>
      
      {/* Port highlight when near */}
      {nearPort && (
        <>
          <mesh position={nearPort}>
            <sphereGeometry args={[0.12, 16, 16]} />
            <meshBasicMaterial 
              color={color}
              transparent 
              opacity={0.4}
            />
          </mesh>
          <mesh position={nearPort}>
            <sphereGeometry args={[0.18, 16, 16]} />
            <meshBasicMaterial 
              color={color}
              transparent 
              opacity={0.2}
            />
          </mesh>
        </>
      )}
      
      {/* Particle effects */}
      {particles.map((particle, index) => (
        <mesh key={index} position={particle.position}>
          <sphereGeometry args={[particle.scale, 8, 8]} />
          <meshBasicMaterial 
            color={color}
            transparent
            opacity={particle.life * 0.8}
          />
        </mesh>
      ))}
    </group>
  );
}

