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
};

export default function InteractiveWire({
  startPos,
  endPos,
  color,
  label,
  numPoints = 22, // Extra points for super smooth playful curves on long wires
  wireSystemsRef,
  wireIndex,
}: InteractiveWireProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragPointIndex, setDragPointIndex] = useState<number | null>(null);
  const { camera, raycaster, gl } = useThree();
  
  // Track scroll velocity for subtle wire movement
  const lastScrollY = useRef(0);
  const scrollVelocity = useRef(0);
  
  // Create physics system
  const physicsSystem = useMemo(
    () => new WirePhysicsSystem(numPoints, startPos, endPos),
    [numPoints, startPos, endPos],
  );

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

      // Update cursor on hover
      if (!isDragging) {
        raycaster.setFromCamera(mouseRef.current, camera);
        if (meshRef.current) {
          const intersects = raycaster.intersectObject(meshRef.current);
          gl.domElement.style.cursor = intersects.length > 0 ? 'grab' : 'default';
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
    if (lastUpdateTime.current < updateThreshold && !isDragging) {
      return;
    }
    lastUpdateTime.current = 0;

    // Extremely subtle scroll effect - barely noticeable wire reaction
    if (!isDragging && Math.abs(scrollVelocity.current) > 2) {
      // Apply minimal force to middle points based on scroll velocity
      const middleIndex = Math.floor(physicsSystem.points.length / 2);
      const scrollForce = new THREE.Vector3(
        scrollVelocity.current * 0.0001,
        scrollVelocity.current * -0.00005,
        0
      );
      
      // Apply to middle point only
      physicsSystem.applyForceToPoint(middleIndex, scrollForce);
    }
    
    // Fast decay of scroll velocity
    scrollVelocity.current *= 0.7;

    // Update endpoints (in case they changed)
    physicsSystem.setEndpoints(startPos, endPos);

    // Handle dragging - moderate force for stiffer wire feel
    if (isDragging && dragPointIndex !== null) {
      raycaster.setFromCamera(mouseRef.current, camera);
      raycaster.ray.intersectPlane(planeRef.current, intersectionPoint.current);
      
      const currentPos = physicsSystem.points[dragPointIndex].position;
      const force = new THREE.Vector3()
        .subVectors(intersectionPoint.current, currentPos)
        .multiplyScalar(0.4); // Reduced for stiffer wire behavior
      
      physicsSystem.applyForceToPoint(dragPointIndex, force);
    }

    // Strong wire-to-wire collision - wires CANNOT pass through each other
    if (wireSystemsRef && wireSystemsRef.current.length > 0) {
      const collisionRadius = 0.22; // Much larger detection radius for thick wires
      const repulsionStrength = 0.18; // Even stronger repulsion force
      
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
              
              repulsion.multiplyScalar(force);
              
              // Apply strong repulsion force
              physicsSystem.applyForceToPoint(i, repulsion);
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
          emissiveIntensity={isDragging ? 0.3 : 0.08}
        />
      </mesh>
      
      {/* Glow at connection points - extra large for super thick wires */}
      <mesh position={startPos}>
        <sphereGeometry args={[0.1, 16, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh position={endPos}>
        <sphereGeometry args={[0.1, 16, 16]} />
        <meshBasicMaterial color={color} />
      </mesh>
      
      {/* Outer glow effect at connection points */}
      <mesh position={startPos}>
        <sphereGeometry args={[0.15, 16, 16]} />
        <meshBasicMaterial 
          color={color} 
          transparent 
          opacity={0.3}
        />
      </mesh>
      <mesh position={endPos}>
        <sphereGeometry args={[0.15, 16, 16]} />
        <meshBasicMaterial 
          color={color} 
          transparent 
          opacity={0.3}
        />
      </mesh>
    </group>
  );
}

