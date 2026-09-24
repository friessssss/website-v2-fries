'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

const GLYPHS = [' ', '.', '·', ':', '˙', '-', '=', '+', '*', 'x', '%', '#', '█', '@'];

// Rotating gallery: the torus knot is always first, then these models in order.
const GALLERY_MODELS = [
  '/models/AE1_exterior_windows.glb',
  '/models/AE1_exterior_nowindows.glb',
];
const GALLERY_INTERVAL_MS = 20000; // time each model is shown, including the dissolve into the next
const TRANSITION_MS = 1800; // duration of the dissolve between models
const MODEL_SCALE = 1.2; // loaded models' size relative to the torus knot
// Starting tilt so models first appear seen from slightly above
const MODEL_TILT_X = 0.35;
// Rotation speed per axis in radians per millisecond
const TORUS_SPIN = new THREE.Vector3(0.00009, 0.0003, 0);
const MODEL_SPIN = new THREE.Vector3(0.00011, 0.0003, 0.00007);
// Samples per glyph cell along each axis. Averaging them keeps fine detail
// (like the solar panels) from flickering as the model rotates.
const SAMPLES_PER_CELL = 4;
const MIN_COVERAGE = 0.35; // fraction of a cell the geometry must cover to draw a glyph
const DISSOLVE_EDGE = 0.12; // width of the scrambled band at the dissolve front

interface GalleryItem {
  object: THREE.Object3D;
  spin: THREE.Vector3;
}

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
      antialias: true,
      powerPreference: 'high-performance'
    });
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    // Move camera further back on mobile to make model appear smaller
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

    // Loaded models are scaled to match the torus knot's on-screen size
    geometry.computeBoundingBox();
    const torusSize = new THREE.Vector3();
    geometry.boundingBox!.getSize(torusSize);
    const targetSize = Math.max(torusSize.x, torusSize.y, torusSize.z);

    const gallery: GalleryItem[] = [{ object: mesh, spin: TORUS_SPIN }];
    let activeIndex = 0;
    let lastSwitch = 0;
    let isDisposed = false;

    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('/draco/');
    const gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(dracoLoader);

    // Center and normalize a loaded model inside a pivot so rotation happens around its middle
    const createGalleryModel = (model: THREE.Object3D): THREE.Object3D => {
      model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const childMesh = child as THREE.Mesh;
          const materials = Array.isArray(childMesh.material) ? childMesh.material : [childMesh.material];
          materials.forEach((m) => m.dispose());
          childMesh.material = material;
        }
      });

      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const scale = (targetSize * MODEL_SCALE) / Math.max(size.x, size.y, size.z);
      model.position.sub(center);

      const inner = new THREE.Group();
      inner.add(model);
      inner.scale.setScalar(scale);

      const pivot = new THREE.Group();
      pivot.add(inner);
      pivot.rotation.x = MODEL_TILT_X;
      pivot.visible = false;
      scene.add(pivot);
      return pivot;
    };

    const disposeObject = (object: THREE.Object3D) => {
      object.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          (child as THREE.Mesh).geometry.dispose();
        }
      });
    };

    // Load models in order so the gallery sequence is deterministic
    const loadedModels: (THREE.Object3D | null)[] = GALLERY_MODELS.map(() => null);
    GALLERY_MODELS.forEach((url, i) => {
      gltfLoader.load(
        url,
        (gltf) => {
          if (isDisposed) {
            disposeObject(gltf.scene);
            return;
          }
          loadedModels[i] = createGalleryModel(gltf.scene);
          // Append models that are ready, preserving order
          gallery.length = 1;
          loadedModels.forEach((object) => {
            if (object) gallery.push({ object, spin: MODEL_SPIN });
          });
        },
        undefined,
        (error) => console.error(`Failed to load gallery model ${url}`, error)
      );
    });

    // Add lighting for better depth perception
    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(0.5, 0.8, 0.3);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0x404040));

    let animationFrame = 0;
    let lastTime = 0;

    // Off-screen render is SAMPLES_PER_CELL x SAMPLES_PER_CELL pixels per glyph cell
    let sampleWidth = 0;
    let sampleHeight = 0;
    let pixels = new Uint8Array(0);
    // Per-cell averaged color and coverage (r, g, b, coverage) for the current and next gallery item
    let currentCells = new Float32Array(0);
    let nextCells = new Float32Array(0);
    // Per-cell order in which the dissolve front passes over the grid (0-1)
    let dissolveOrder = new Float32Array(0);

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

      // Render only as many pixels as we sample, covering the full glyph grid
      sampleWidth = columns * SAMPLES_PER_CELL;
      sampleHeight = rows * SAMPLES_PER_CELL;
      renderer.setSize(sampleWidth, sampleHeight, false);
      pixels = new Uint8Array(sampleWidth * sampleHeight * 4);
      currentCells = new Float32Array(columns * rows * 4);
      nextCells = new Float32Array(columns * rows * 4);
      buildDissolveOrder();

      // Adjust camera position based on screen size
      isMobile = width < 768;
      camera.position.z = isMobile ? 12 : 8;
      camera.aspect = columns / rows;
      camera.updateProjectionMatrix();
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

    // Blobby noise so the dissolve spreads in patches rather than uniform static
    const buildDissolveOrder = () => {
      const blobSize = 6; // in glyph cells
      dissolveOrder = new Float32Array(columns * rows);
      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < columns; x += 1) {
          const gx = x / blobSize;
          const gy = y / blobSize;
          const x0 = Math.floor(gx);
          const y0 = Math.floor(gy);
          const fx = smoothstep(0, 1, gx - x0);
          const fy = smoothstep(0, 1, gy - y0);
          // Offset the lattice so it doesn't correlate with the per-cell hash
          const n00 = hashCell(x0 + 1000, y0);
          const n10 = hashCell(x0 + 1001, y0);
          const n01 = hashCell(x0 + 1000, y0 + 1);
          const n11 = hashCell(x0 + 1001, y0 + 1);
          const top = n00 + (n10 - n00) * fx;
          const bottom = n01 + (n11 - n01) * fx;
          const blob = top + (bottom - top) * fy;
          dissolveOrder[y * columns + x] = blob * 0.75 + hashCell(x, y) * 0.25;
        }
      }
    };

    // Render a single gallery item and average its pixels into per-cell color and coverage
    const renderToCells = (item: GalleryItem, cells: Float32Array) => {
      gallery.forEach((other) => {
        other.object.visible = other === item;
      });
      renderer.render(scene, camera);

      const gl = renderer.getContext();
      gl.readPixels(0, 0, sampleWidth, sampleHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

      const samplesPerCell = SAMPLES_PER_CELL * SAMPLES_PER_CELL;
      for (let y = 0; y < rows; y += 1) {
        // WebGL rows start at the bottom
        const pixelRowStart = (rows - 1 - y) * SAMPLES_PER_CELL;
        for (let x = 0; x < columns; x += 1) {
          let r = 0;
          let g = 0;
          let b = 0;
          let a = 0;
          for (let sy = 0; sy < SAMPLES_PER_CELL; sy += 1) {
            let index = ((pixelRowStart + sy) * sampleWidth + x * SAMPLES_PER_CELL) * 4;
            for (let sx = 0; sx < SAMPLES_PER_CELL; sx += 1, index += 4) {
              r += pixels[index];
              g += pixels[index + 1];
              b += pixels[index + 2];
              a += pixels[index + 3];
            }
          }
          // Pixels are premultiplied by alpha, so divide by total alpha to recover the surface color
          const alphaScale = a > 0 ? 255 / a : 0;
          const cellIndex = (y * columns + x) * 4;
          cells[cellIndex] = r * alphaScale;
          cells[cellIndex + 1] = g * alphaScale;
          cells[cellIndex + 2] = b * alphaScale;
          cells[cellIndex + 3] = a / (255 * samplesPerCell);
        }
      }
    };

    const render = (time: number) => {
      const deltaTime = time - lastTime;
      lastTime = time;

      // Advance the gallery once the current item's time is up
      if (lastSwitch === 0) lastSwitch = time;
      let elapsed = time - lastSwitch;
      if (elapsed >= GALLERY_INTERVAL_MS) {
        activeIndex = (activeIndex + 1) % gallery.length;
        lastSwitch = time;
        elapsed = 0;
      }
      const activeItem = gallery[activeIndex] ?? gallery[0];
      // In the last TRANSITION_MS of each slot, dissolve into the next item
      const transitionStart = GALLERY_INTERVAL_MS - TRANSITION_MS;
      const nextItem =
        gallery.length > 1 && elapsed > transitionStart
          ? gallery[(activeIndex + 1) % gallery.length]
          : null;
      // Front sweeps past both ends so every cell starts fully old and ends fully new
      const dissolveFront = nextItem
        ? smoothstep(transitionStart, GALLERY_INTERVAL_MS, elapsed) * (1 + 2 * DISSOLVE_EDGE) - DISSOLVE_EDGE
        : 0;

      // Slowly rotate on all axes
      [activeItem, nextItem].forEach((item) => {
        if (!item) return;
        item.object.rotation.x += item.spin.x * deltaTime;
        item.object.rotation.y += item.spin.y * deltaTime;
        item.object.rotation.z += item.spin.z * deltaTime;
      });

      renderToCells(activeItem, currentCells);
      if (nextItem) renderToCells(nextItem, nextCells);

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

          const cellIndex = (y * columns + x) * 4;
          let r = currentCells[cellIndex];
          let g = currentCells[cellIndex + 1];
          let b = currentCells[cellIndex + 2];
          let coverage = currentCells[cellIndex + 3];
          let scrambledGlyph: string | null = null;

          if (nextItem) {
            const distanceToFront = dissolveOrder[y * columns + x] - dissolveFront;
            const nextCoverage = nextCells[cellIndex + 3];
            if (distanceToFront < -DISSOLVE_EDGE) {
              // Front has passed: show the next item
              r = nextCells[cellIndex];
              g = nextCells[cellIndex + 1];
              b = nextCells[cellIndex + 2];
              coverage = nextCoverage;
            } else if (distanceToFront <= DISSOLVE_EDGE) {
              // On the front: blend both shapes and scramble the glyph
              const mix = 0.5 - distanceToFront / (2 * DISSOLVE_EDGE);
              if (coverage < MIN_COVERAGE) {
                r = nextCells[cellIndex];
                g = nextCells[cellIndex + 1];
                b = nextCells[cellIndex + 2];
              } else if (nextCoverage >= MIN_COVERAGE) {
                r += (nextCells[cellIndex] - r) * mix;
                g += (nextCells[cellIndex + 1] - g) * mix;
                b += (nextCells[cellIndex + 2] - b) * mix;
              }
              coverage = Math.max(coverage, nextCoverage);
              const flicker = Math.floor(time / 70);
              scrambledGlyph = GLYPHS[1 + Math.floor(hashCell(x + flicker, y) * (GLYPHS.length - 1))];
            }
          }

          // Skip if no geometry at this position
          if (coverage < MIN_COVERAGE) continue;
          r = Math.round(r);
          g = Math.round(g);
          b = Math.round(b);

          // Calculate brightness for glyph selection
          const brightness = getBrightness(r, g, b);
          const glyphIndex = Math.min(
            GLYPHS.length - 1,
            Math.max(0, Math.floor(brightness * GLYPHS.length))
          );
          const glyph = scrambledGlyph ?? GLYPHS[glyphIndex];

          // Calculate mouse dissolution effect (skip on mobile)
          let opacity = 1;
          let offsetX = 0;
          let offsetY = 0;
          
          // Check current width to determine if mobile (in case of resize)
          const currentIsMobile = width < 768;
          if (!currentIsMobile) {
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
      // Always try to remove mouse listeners (safe even if not added)
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseleave', handleMouseLeave);
      isDisposed = true;
      geometry.dispose();
      loadedModels.forEach((object) => object && disposeObject(object));
      dracoLoader.dispose();
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
