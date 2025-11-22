import { Vector3 } from 'three';

export class WirePoint {
  position: Vector3;
  previousPosition: Vector3;
  velocity: Vector3;
  isFixed: boolean;
  mass: number;

  constructor(x: number, y: number, z: number, isFixed: boolean = false) {
    this.position = new Vector3(x, y, z);
    this.previousPosition = new Vector3(x, y, z);
    this.velocity = new Vector3(0, 0, 0);
    this.isFixed = isFixed;
    this.mass = 1.0;
  }

  update(deltaTime: number, gravity: Vector3, damping: number) {
    if (this.isFixed) return;

    // Verlet integration
    const temp = this.position.clone();
    
    // Calculate velocity
    this.velocity.copy(this.position).sub(this.previousPosition);
    
    // Apply damping
    this.velocity.multiplyScalar(damping);
    
    // Update position
    this.position.add(this.velocity);
    
    // Apply gravity
    this.position.add(gravity.clone().multiplyScalar(deltaTime * deltaTime));
    
    this.previousPosition.copy(temp);
  }

  applyForce(force: Vector3) {
    if (this.isFixed) return;
    this.position.add(force);
  }

  setPosition(x: number, y: number, z: number) {
    this.position.set(x, y, z);
    this.previousPosition.set(x, y, z);
  }
}

export class WireConstraint {
  pointA: WirePoint;
  pointB: WirePoint;
  restLength: number;
  stiffness: number;

  constructor(pointA: WirePoint, pointB: WirePoint, stiffness: number = 0.8) {
    this.pointA = pointA;
    this.pointB = pointB;
    this.restLength = pointA.position.distanceTo(pointB.position);
    this.stiffness = stiffness;
  }

  solve() {
    const delta = new Vector3().subVectors(this.pointB.position, this.pointA.position);
    const currentLength = delta.length();
    
    if (currentLength === 0) return;
    
    const diff = (currentLength - this.restLength) / currentLength;
    const offset = delta.multiplyScalar(diff * this.stiffness * 0.5);
    
    if (!this.pointA.isFixed) {
      this.pointA.position.add(offset);
    }
    
    if (!this.pointB.isFixed) {
      this.pointB.position.sub(offset);
    }
  }
}

export class WirePhysicsSystem {
  points: WirePoint[];
  constraints: WireConstraint[];
  gravity: Vector3;
  damping: number;
  constraintIterations: number;

  constructor(
    numPoints: number,
    startPos: Vector3,
    endPos: Vector3,
    gravity: Vector3 = new Vector3(0, -0.6, 0), // Reduced gravity for stiffer wires
    damping: number = 0.95, // More damping for less floppy movement
  ) {
    this.points = [];
    this.constraints = [];
    this.gravity = gravity;
    this.damping = damping;
    this.constraintIterations = 5; // More iterations for stable collision with thick wires

    // Create points along a line from start to end
    for (let i = 0; i < numPoints; i++) {
      const t = i / (numPoints - 1);
      const x = startPos.x + (endPos.x - startPos.x) * t;
      const y = startPos.y + (endPos.y - startPos.y) * t;
      const z = startPos.z + (endPos.z - startPos.z) * t;
      
      // First and last points are fixed
      const isFixed = i === 0 || i === numPoints - 1;
      this.points.push(new WirePoint(x, y, z, isFixed));
    }

    // Create constraints between adjacent points with higher stiffness for less floppy wires
    for (let i = 0; i < numPoints - 1; i++) {
      this.constraints.push(new WireConstraint(this.points[i], this.points[i + 1], 0.9));
    }
  }

  update(deltaTime: number) {
    // Limit delta time to prevent instability
    const dt = Math.min(deltaTime, 0.016);

    // Update points
    for (const point of this.points) {
      point.update(dt, this.gravity, this.damping);
    }

    // Solve constraints multiple times for stability
    for (let i = 0; i < this.constraintIterations; i++) {
      for (const constraint of this.constraints) {
        constraint.solve();
      }
    }
  }

  applyForceToPoint(index: number, force: Vector3) {
    if (index >= 0 && index < this.points.length) {
      this.points[index].applyForce(force);
    }
  }

  getPositions(): Vector3[] {
    return this.points.map((point) => point.position.clone());
  }

  getNearestPointIndex(position: Vector3): number {
    let nearestIndex = 0;
    let minDistance = Infinity;

    for (let i = 0; i < this.points.length; i++) {
      const distance = this.points[i].position.distanceTo(position);
      if (distance < minDistance) {
        minDistance = distance;
        nearestIndex = i;
      }
    }

    return nearestIndex;
  }

  setEndpoints(startPos: Vector3, endPos: Vector3) {
    if (this.points.length > 0) {
      this.points[0].setPosition(startPos.x, startPos.y, startPos.z);
      this.points[this.points.length - 1].setPosition(endPos.x, endPos.y, endPos.z);
    }
  }
}

