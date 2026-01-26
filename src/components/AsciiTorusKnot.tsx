'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';

const GLYPHS = [' ', '.', '·', ':', '˙', '-', '=', '+', '*', 'x', '%', '#', '█', '@'];

interface MouseState {
  x: number;
  y: number;
  isActive: boolean;
}

interface DissolvedCell {
  x: number;
  y: number;
  timestamp: number;
  recoveryStart: number;
  offsetX: number;
  offsetY: number;
  dissolveStrength: number;
}

export default function AsciiTorusKnot() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mouseRef = useRef<MouseState>({ x: -1000, y: -1000, isActive: false });
  const dissolvedCellsRef = useRef<Map<string, DissolvedCell>>(new Map());

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    // Canvas dimensions
    let width = window.innerWidth;
    let height = window.innerHeight;
    let columns = 0;
    let rows = 0;
    let glyphSize = 14;
    let isMobile = width < 768;

    // Three.js setup - off-screen WebGL renderer
    const renderer = new THREE.WebGLRenderer({ 
      alpha: true, 
      antialias: false,
      powerPreference: 'high-performance'
    });
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    // Move camera further back on mobile to make model appear smaller
    const isMobile = width < 768;
    camera.position.z = isMobile ? 12 : 8;

    // Create torus knot geometry
    // Scale down geometry on mobile
    const radius = isMobile ? 0.8 : 1.5;
    const tube = isMobile ? 0.2 : 0.4;
    const geometry = new THREE.TorusKnotGeometry(
      radius,  // radius (smaller on mobile)
      tube,   // tube thickness (smaller on mobile)
      150,    // tubular segments
      20,     // radial segments
      2,      // p parameter
      3       // q parameter
    );

    // Use MeshNormalMaterial for automatic shading based on surface normals
    const material = new THREE.MeshNormalMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    // Add lighting for better depth perception
    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(0.5, 0.8, 0.3);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0x404040));

    let animationFrame = 0;
    let lastTime = 0;

    // Create an ImageData buffer to read from WebGL
    let imageData: ImageData;

    const updateSize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      width = window.innerWidth;
      height = window.innerHeight;
      glyphSize = width < 640 ? 12 : 14;

      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.font = `${glyphSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`;
      context.textBaseline = 'top';

      columns = Math.ceil(width / glyphSize);
      rows = Math.ceil(height / glyphSize);

      // Update renderer size
      renderer.setSize(width, height, false);
      
      // Adjust camera position based on screen size
      isMobile = width < 768;
      camera.position.z = isMobile ? 12 : 8;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();

      // Create buffer for reading pixels
      imageData = new ImageData(width, height);
    };

    // Smoothstep function (used for recovery animation)
    const smoothstep = (edge0: number, edge1: number, x: number): number => {
      const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
      return t * t * (3 - 2 * t);
    };

    // Gaussian falloff function - produces natural bell curve with no hard edges
    const gaussianFalloff = (distance: number, sigma: number): number => {
      return Math.exp(-(distance * distance) / (2 * sigma * sigma));
    };

    // Convert RGB to brightness for glyph selection
    const getBrightness = (r: number, g: number, b: number): number => {
      return (r * 0.299 + g * 0.587 + b * 0.114) / 255;
    };

    // Simple hash function for consistent randomness per cell
    const hashCell = (x: number, y: number): number => {
      let hash = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      hash = ((hash >> 16) ^ hash) * 0x45d9f3b;
      hash = ((hash >> 16) ^ hash) * 0x45d9f3b;
      hash = (hash >> 16) ^ hash;
      return (hash >>> 0) / 4294967296; // Normalize to 0-1
    };

    const render = (time: number) => {
      const deltaTime = time - lastTime;
      lastTime = time;

      // Rotate the torus knot (slower)
      const rotationSpeed = 0.0003;
      mesh.rotation.y += rotationSpeed * deltaTime;
      mesh.rotation.x += rotationSpeed * 0.3 * deltaTime;

      // Render 3D scene to WebGL
      renderer.render(scene, camera);

      // Read pixels from WebGL renderer
      const gl = renderer.getContext();
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

      // Clear canvas
      context.clearRect(0, 0, width, height);

      const mouseState = mouseRef.current;
      const dissolvedCells = dissolvedCellsRef.current;
      const currentTime = time;

      // Clean up old dissolved cells
      for (const [key, cell] of Array.from(dissolvedCells.entries())) {
        if (currentTime - cell.recoveryStart > 400) {
          dissolvedCells.delete(key);
        }
      }

      // Render ASCII characters by sampling the WebGL output
      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < columns; x += 1) {
          const cellKey = `${x},${y}`;
          
          // Calculate cell position in screen space
          const screenX = Math.floor(x * glyphSize + glyphSize / 2);
          const screenY = Math.floor(y * glyphSize + glyphSize / 2);

          // Sample pixel from WebGL render (flip Y coordinate)
          const pixelY = height - 1 - screenY;
          const pixelIndex = (pixelY * width + screenX) * 4;
          
          const r = pixels[pixelIndex];
          const g = pixels[pixelIndex + 1];
          const b = pixels[pixelIndex + 2];
          const a = pixels[pixelIndex + 3];

          // Skip if no geometry at this position
          if (a < 10) continue;

          // Calculate brightness for glyph selection
          const brightness = getBrightness(r, g, b);
          const glyphIndex = Math.min(
            GLYPHS.length - 1,
            Math.max(0, Math.floor(brightness * GLYPHS.length))
          );
          const glyph = GLYPHS[glyphIndex];

          // Calculate mouse dissolution effect (skip on mobile)
          let opacity = 1;
          let offsetX = 0;
          let offsetY = 0;
          
          if (!isMobile) {
            const mouseDistance = Math.hypot(screenX - mouseState.x, screenY - mouseState.y);
            
            // Add per-cell randomness for organic variation
            const cellRandom = hashCell(x, y);
            const cellRandom2 = hashCell(y, x); // Different seed for variety
            
            // Gaussian sigma controls the falloff width - larger = softer, wider influence
            // Add per-cell variation to break up the circular pattern
            const baseSigma = 70; // Base sigma for Gaussian
            const sigmaVariation = cellRandom * 30; // 0-30px variation per cell
            const sigma = baseSigma + sigmaVariation;
            
            // Calculate Gaussian influence - naturally fades to near-zero at edges
            const gaussianT = gaussianFalloff(mouseDistance, sigma);
            
            // Scale random variation by distance - outer pixels get more variation
            const distanceNoiseFactor = Math.min(1, mouseDistance / 100);
            const noiseScale = 0.15 + distanceNoiseFactor * 0.35; // 0.15 near center, up to 0.5 at edges
            
            // Apply random variation that increases with distance
            let dissolveT = gaussianT * (1 + (cellRandom - 0.5) * noiseScale);
            dissolveT = Math.max(0, Math.min(1, dissolveT));

            if (mouseState.isActive && dissolveT > 0.01) {
              // Fade opacity based on Gaussian influence
              opacity = 1 - (dissolveT * 0.9);

              // Calculate direction away from mouse
              const dx = screenX - mouseState.x;
              const dy = screenY - mouseState.y;
              const distance = Math.max(mouseDistance, 1);
              const dirX = dx / distance;
              const dirY = dy / distance;

              // Add slight angular variation to push direction (increases with distance)
              const angleVariation = (cellRandom2 - 0.5) * (0.3 + distanceNoiseFactor * 0.4);
              const cosAngle = Math.cos(angleVariation);
              const sinAngle = Math.sin(angleVariation);
              const variedDirX = dirX * cosAngle - dirY * sinAngle;
              const variedDirY = dirX * sinAngle + dirY * cosAngle;

              // Push characters outward - reduced base push for softer effect
              const basePush = dissolveT * 100;
              const pushVariation = 1 + (cellRandom - 0.5) * (0.4 + distanceNoiseFactor * 0.4);
              const pushDistance = basePush * pushVariation;
              
              offsetX = variedDirX * pushDistance;
              offsetY = variedDirY * pushDistance;

              // Track dissolved cells
              if (dissolveT > 0.05) {
                if (!dissolvedCells.has(cellKey)) {
                  dissolvedCells.set(cellKey, {
                    x,
                    y,
                    timestamp: currentTime,
                    recoveryStart: currentTime,
                    offsetX,
                    offsetY,
                    dissolveStrength: dissolveT,
                  });
                } else {
                  const cell = dissolvedCells.get(cellKey)!;
                  cell.timestamp = currentTime;
                  cell.offsetX = offsetX;
                  cell.offsetY = offsetY;
                  cell.dissolveStrength = dissolveT;
                }
              }
            } else if (!mouseState.isActive || dissolveT <= 0.01) {
              // Check if this cell is recovering
              if (dissolvedCells.has(cellKey)) {
                const cell = dissolvedCells.get(cellKey)!;
                const timeSinceLastDissolve = currentTime - cell.timestamp;

                // Start recovery after 100ms
                if (timeSinceLastDissolve > 100) {
                  if (cell.recoveryStart === cell.timestamp) {
                    cell.recoveryStart = currentTime;
                  }
                  
                  const recoveryProgress = Math.min(1, (currentTime - cell.recoveryStart) / 400);
                  opacity = recoveryProgress;
                  
                  // Ease back to original position
                  const easeProgress = recoveryProgress * recoveryProgress * (3 - 2 * recoveryProgress); // smoothstep
                  offsetX = cell.offsetX * (1 - easeProgress);
                  offsetY = cell.offsetY * (1 - easeProgress);
                } else {
                  // Still in dissolve state
                  opacity = 1 - cell.dissolveStrength;
                  offsetX = cell.offsetX;
                  offsetY = cell.offsetY;
                }
              }
            }
          }

          // Render the glyph if it's visible
          if (opacity > 0.02 && glyph !== ' ') {
            context.globalAlpha = opacity;
            context.fillStyle = `rgb(${r}, ${g}, ${b})`;
            context.fillText(glyph, x * glyphSize + offsetX, y * glyphSize + offsetY);
            context.globalAlpha = 1;
          }
        }
      }

      animationFrame = requestAnimationFrame(render);
    };

    // Mouse event handlers
    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current.x = e.clientX;
      mouseRef.current.y = e.clientY;
      mouseRef.current.isActive = true;
    };

    const handleMouseLeave = () => {
      mouseRef.current.isActive = false;
    };

    updateSize();
    animationFrame = requestAnimationFrame(render);
    window.addEventListener('resize', updateSize);
    
    // Only add mouse event listeners on desktop
    if (!isMobile) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseleave', handleMouseLeave);
    }

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', updateSize);
      if (!isMobile) {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseleave', handleMouseLeave);
      }
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 h-full w-full pointer-events-none"
      style={{ zIndex: 10 }}
      aria-hidden="true"
    />
  );
}
