/**
 * Empirical Challenger M1 R2 Verification Suite
 * Stress-testing SAT separation, flush contacts, and boundary clamping.
 */

const assert = require('assert');
const app = require('../app.js');

const {
    CollisionEngine,
    Vector2D,
    getFurnitureCorners,
    State,
    getCeilingHeightAt
} = app;

console.log('='.repeat(80));
console.log('  CHALLENGER M1 R2: ADVERSARIAL SWEEP & TOLERANCE STRESS TEST');
console.log('='.repeat(80));

let totalAsserts = 0;
let passedAsserts = 0;
let failedAsserts = 0;

function check(label, condition, details = '') {
    totalAsserts++;
    if (condition) {
        passedAsserts++;
        console.log(`  [PASS] ${label}`);
    } else {
        failedAsserts++;
        console.error(`  [FAIL] ${label} - ${details}`);
    }
}

// ============================================================================
// 1. ROTATED FLUSH RECTANGLES SWEEP (10,000 cases)
// ============================================================================
console.log('\n--- 1. Rotated Flush Rectangles (10,000 cases) ---');
{
    let falsePositives = 0;
    const N = 10000;

    for (let i = 0; i < N; i++) {
        const rot = Math.random() * 360;
        const rad = (rot * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        // Aspect ratios and sizes
        const w1 = 10 + Math.random() * 200;
        const l1 = 10 + Math.random() * 200;
        const w2 = 10 + Math.random() * 200;
        const l2 = 10 + Math.random() * 200;

        const ax = 500, ay = 500;

        // Choose flush along width (axis 1) or length (axis 2)
        const alongWidth = Math.random() < 0.5;
        let bx, by;

        if (alongWidth) {
            // Normal is local X axis rotated: (cos, sin)
            const dist = (w1 + w2) / 2;
            // Tangent is local Y axis rotated: (-sin, cos)
            // Lateral shift along shared contact edge: must keep them in contact or disjoint, not overlapping
            const maxLateralOverlap = (l1 + l2) / 2;
            const lateralShift = (Math.random() - 0.5) * (maxLateralOverlap * 0.95);

            bx = ax + dist * cos - lateralShift * sin;
            by = ay + dist * sin + lateralShift * cos;
        } else {
            // Normal is local Y axis rotated: (-sin, cos)
            const dist = (l1 + l2) / 2;
            // Tangent is local X axis rotated: (cos, sin)
            const maxLateralOverlap = (w1 + w2) / 2;
            const lateralShift = (Math.random() - 0.5) * (maxLateralOverlap * 0.95);

            bx = ax - dist * sin + lateralShift * cos;
            by = ay + dist * cos + lateralShift * sin;
        }

        const f1 = {
            shape: 'rect',
            x: ax,
            y: ay,
            w: w1,
            l: l1,
            h: 80,
            elevation: 0,
            rotation: rot,
            collisionEnabled: true
        };

        const f2 = {
            shape: 'rect',
            x: bx,
            y: by,
            w: w2,
            l: l2,
            h: 80,
            elevation: 0,
            rotation: rot,
            collisionEnabled: true
        };

        if (CollisionEngine.checkFurnitureCollision(f1, f2)) {
            falsePositives++;
        }
    }

    check(
        '10,000 rotated flush rectangles produce 0 false positives',
        falsePositives === 0,
        `False positives: ${falsePositives}/${N} (${((falsePositives / N) * 100).toFixed(2)}%)`
    );
}

// ============================================================================
// 2. FLUSH CIRCLES SWEEP (10,000 cases)
// ============================================================================
console.log('\n--- 2. Flush Circles Sweep (10,000 cases) ---');
{
    let falsePositives = 0;
    const N = 10000;

    for (let i = 0; i < N; i++) {
        const rot = Math.random() * 360;
        const rad = (rot * Math.PI) / 180;
        const r1 = 5 + Math.random() * 150;
        const r2 = 5 + Math.random() * 150;

        const ax = 500, ay = 500;
        const dist = r1 + r2;
        const bx = ax + dist * Math.cos(rad);
        const by = ay + dist * Math.sin(rad);

        const c1 = {
            shape: 'circle',
            x: ax,
            y: ay,
            w: r1 * 2,
            l: r1 * 2,
            h: 60,
            elevation: 0,
            collisionEnabled: true
        };

        const c2 = {
            shape: 'circle',
            x: bx,
            y: by,
            w: r2 * 2,
            l: r2 * 2,
            h: 60,
            elevation: 0,
            collisionEnabled: true
        };

        if (CollisionEngine.checkFurnitureCollision(c1, c2)) {
            falsePositives++;
        }
    }

    check(
        '10,000 flush touching circles produce 0 false positives',
        falsePositives === 0,
        `False positives: ${falsePositives}/${N} (${((falsePositives / N) * 100).toFixed(2)}%)`
    );
}

// ============================================================================
// 3. FLUSH CIRCLE VS ROTATED OBB SWEEP (10,000 cases)
// ============================================================================
console.log('\n--- 3. Flush Circle vs Rotated OBB Sweep (10,000 cases) ---');
{
    let falsePositives = 0;
    const N = 10000;

    for (let i = 0; i < N; i++) {
        const rectW = 20 + Math.random() * 150;
        const rectL = 20 + Math.random() * 150;
        const rectRot = Math.random() * 360;
        const rad = (rectRot * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        const r = 10 + Math.random() * 60;
        const rectX = 500, rectY = 500;

        // Choose edge-tangent or vertex-tangent
        const isCorner = Math.random() < 0.3;
        let localCX, localCY;

        if (isCorner) {
            // Tangent to one of the 4 corners at angle phi
            const cornerSignX = Math.random() < 0.5 ? 1 : -1;
            const cornerSignY = Math.random() < 0.5 ? 1 : -1;
            const cornerX = cornerSignX * (rectW / 2);
            const cornerY = cornerSignY * (rectL / 2);

            // Vector pointing outward from corner
            const phi = Math.random() * Math.PI * 0.5; // in quadrant
            const outX = cornerSignX * Math.cos(phi);
            const outY = cornerSignY * Math.sin(phi);

            localCX = cornerX + r * outX;
            localCY = cornerY + r * outY;
        } else {
            // Tangent to edge
            const onXEdge = Math.random() < 0.5;
            if (onXEdge) {
                const signX = Math.random() < 0.5 ? 1 : -1;
                localCX = signX * (rectW / 2 + r);
                localCY = (Math.random() - 0.5) * rectL * 0.9;
            } else {
                const signY = Math.random() < 0.5 ? 1 : -1;
                localCY = signY * (rectL / 2 + r);
                localCX = (Math.random() - 0.5) * rectW * 0.9;
            }
        }

        const worldCX = rectX + localCX * cos - localCY * sin;
        const worldCY = rectY + localCX * sin + localCY * cos;

        const rect = {
            shape: 'rect',
            x: rectX,
            y: rectY,
            w: rectW,
            l: rectL,
            h: 70,
            elevation: 0,
            rotation: rectRot,
            collisionEnabled: true
        };

        const circle = {
            shape: 'circle',
            x: worldCX,
            y: worldCY,
            w: r * 2,
            l: r * 2,
            h: 70,
            elevation: 0,
            collisionEnabled: true
        };

        if (CollisionEngine.checkFurnitureCollision(rect, circle) || CollisionEngine.checkFurnitureCollision(circle, rect)) {
            falsePositives++;
        }
    }

    check(
        '10,000 flush circle vs rotated OBB produce 0 false positives',
        falsePositives === 0,
        `False positives: ${falsePositives}/${N} (${((falsePositives / N) * 100).toFixed(2)}%)`
    );
}

// ============================================================================
// 4. BOUNDARY CLAMPING SWEEP ACROSS 360 ANGLES
// ============================================================================
console.log('\n--- 4. Boundary Clamping Sweep Across 360 Angles ---');
{
    const rooms = [
        { width: 500, depth: 400 },
        { width: 800, depth: 800 },
        { width: 300, depth: 250 },
        { width: 1200, depth: 300 }
    ];

    const testOffsets = [
        [-500, -500],
        [-10, 200],
        [200, -10],
        [1500, 1500],
        [500, 2000],
        [-0.001, 100],
        [100, -0.001],
        [-1e5, 1e5]
    ];

    let totalClampingChecks = 0;
    let falsePositiveWallCollisions = 0;
    let outOfBoundsCorners = 0;

    for (let room of rooms) {
        for (let angle = 0; angle < 360; angle++) {
            for (let [ox, oy] of testOffsets) {
                // Rectangular item
                const item = {
                    shape: 'rect',
                    x: ox,
                    y: oy,
                    w: 80,
                    l: 120,
                    rotation: angle,
                    collisionEnabled: true
                };

                CollisionEngine.clampFurnitureToRoom(item, room);
                totalClampingChecks++;

                if (CollisionEngine.checkWallCollision(item, room)) {
                    falsePositiveWallCollisions++;
                }

                const corners = getFurnitureCorners(item);
                for (let c of corners) {
                    if (c.x < -1e-4 || c.x > room.width + 1e-4 || c.y < -1e-4 || c.y > room.depth + 1e-4) {
                        outOfBoundsCorners++;
                    }
                }
            }

            // Circle item
            const circle = {
                shape: 'circle',
                x: -50,
                y: -50,
                w: 70,
                l: 70,
                rotation: angle,
                collisionEnabled: true
            };
            CollisionEngine.clampFurnitureToRoom(circle, room);
            totalClampingChecks++;

            if (CollisionEngine.checkWallCollision(circle, room)) {
                falsePositiveWallCollisions++;
            }
        }
    }

    check(
        `Boundary clamping across 360° (${totalClampingChecks} checks) produces 0 false positive wall collisions`,
        falsePositiveWallCollisions === 0,
        `Wall collisions on clamped items: ${falsePositiveWallCollisions}/${totalClampingChecks}`
    );

    check(
        'Clamped corners strictly satisfy room boundary limits within tolerance',
        outOfBoundsCorners === 0,
        `Out of bounds corners: ${outOfBoundsCorners}`
    );
}

// ============================================================================
// 5. SENSITIVITY ORACLE (Zero False Negatives for Real Overlaps)
// ============================================================================
console.log('\n--- 5. Sensitivity Oracle (True Overlaps & Crossings) ---');
{
    const room = { width: 500, depth: 400 };

    // 5.1 OBB Real Overlap Sensitivity (from 0.001cm to 1.0cm)
    const penetrations = [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1.0];
    let detectedPenetrations = 0;

    for (let pen of penetrations) {
        for (let angle = 0; angle < 360; angle += 15) {
            const rad = (angle * Math.PI) / 180;
            const w1 = 80, l1 = 60, w2 = 80, l2 = 60;
            // Overlapping by `pen` cm
            const dist = (w1 + w2) / 2 - pen;
            const f1 = { shape: 'rect', x: 250, y: 200, w: w1, l: l1, h: 70, elevation: 0, rotation: angle, collisionEnabled: true };
            const f2 = { shape: 'rect', x: 250 + dist * Math.cos(rad), y: 200 + dist * Math.sin(rad), w: w2, l: l2, h: 70, elevation: 0, rotation: angle, collisionEnabled: true };

            if (CollisionEngine.checkFurnitureCollision(f1, f2)) {
                detectedPenetrations++;
            }
        }
    }
    const totalPenCases = penetrations.length * (360 / 15);
    check(
        'OBB genuine penetrations (>= 0.001 cm) are 100% detected',
        detectedPenetrations === totalPenCases,
        `Detected: ${detectedPenetrations}/${totalPenCases}`
    );

    // 5.2 Circle Real Overlap Sensitivity
    let detectedCirclePen = 0;
    for (let pen of penetrations) {
        for (let angle = 0; angle < 360; angle += 15) {
            const rad = (angle * Math.PI) / 180;
            const r1 = 30, r2 = 40;
            const dist = (r1 + r2) - pen;
            const c1 = { shape: 'circle', x: 250, y: 200, w: r1 * 2, h: 60, elevation: 0, collisionEnabled: true };
            const c2 = { shape: 'circle', x: 250 + dist * Math.cos(rad), y: 200 + dist * Math.sin(rad), w: r2 * 2, h: 60, elevation: 0, collisionEnabled: true };

            if (CollisionEngine.checkFurnitureCollision(c1, c2)) {
                detectedCirclePen++;
            }
        }
    }
    check(
        'Circle genuine penetrations (>= 0.001 cm) are 100% detected',
        detectedCirclePen === totalPenCases,
        `Detected: ${detectedCirclePen}/${totalPenCases}`
    );

    // 5.3 Wall Collision Real Crossing Sensitivity
    let detectedWallCrossings = 0;
    const crossings = [0.001, 0.01, 0.1, 1.0];
    for (let c of crossings) {
        // Item poking past left wall by c
        const leftItem = { shape: 'rect', x: 40 - c, y: 200, w: 80, l: 60, rotation: 0 };
        if (CollisionEngine.checkWallCollision(leftItem, room)) detectedWallCrossings++;

        // Item poking past right wall by c
        const rightItem = { shape: 'rect', x: room.width - 40 + c, y: 200, w: 80, l: 60, rotation: 0 };
        if (CollisionEngine.checkWallCollision(rightItem, room)) detectedWallCrossings++;

        // Item poking past top wall by c
        const topItem = { shape: 'rect', x: 200, y: 30 - c, w: 80, l: 60, rotation: 0 };
        if (CollisionEngine.checkWallCollision(topItem, room)) detectedWallCrossings++;

        // Item poking past bottom wall by c
        const bottomItem = { shape: 'rect', x: 200, y: room.depth - 30 + c, w: 80, l: 60, rotation: 0 };
        if (CollisionEngine.checkWallCollision(bottomItem, room)) detectedWallCrossings++;
    }
    check(
        'Wall boundary crossings (>= 0.001 cm) are 100% detected across all 4 walls',
        detectedWallCrossings === crossings.length * 4,
        `Detected: ${detectedWallCrossings}/${crossings.length * 4}`
    );
}

// ============================================================================
// 6. ROOF PITCH 32-POINT SAMPLING RESOLUTION
// ============================================================================
console.log('\n--- 6. Roof Pitch 32-Point Angular Coverage ---');
{
    // Setup attic room with top pitch
    State.room = {
        width: 500,
        depth: 400,
        height: 250,
        pitches: {
            top: {
                enabled: true,
                run: 150,
                kniestock: 80,
                start: 100,
                end: 400
            }
        }
    };

    // Circular table at partial pitch boundary
    const circleTable = {
        shape: 'circle',
        x: 61,
        y: 20,
        w: 80,
        h: 95,
        elevation: 0,
        collisionEnabled: true
    };

    const collides = CollisionEngine.checkRoofPitchCollision(circleTable);
    check(
        '32-point sampling detects partial pitch penetration sliver (348.75°)',
        collides === true,
        `Expected true, got ${collides}`
    );

    // Obstacle and rug exemption under roof pitches
    const obstacle = { ...circleTable, isObstacle: true };
    const rug = { ...circleTable, isRug: true };
    check(
        'Obstacles and rugs remain exempt from roof pitch collision',
        CollisionEngine.checkRoofPitchCollision(obstacle) === false &&
        CollisionEngine.checkRoofPitchCollision(rug) === false
    );
}

// ============================================================================
// SUMMARY
// ============================================================================
console.log('\n' + '='.repeat(80));
console.log('  CHALLENGER VERIFICATION SUMMARY');
console.log('='.repeat(80));
console.log(` Total Assertions: ${totalAsserts}`);
console.log(` Passed:           ${passedAsserts}`);
console.log(` Failed:           ${failedAsserts}`);
console.log(` Pass Rate:        ${((passedAsserts / totalAsserts) * 100).toFixed(2)}%`);
console.log('='.repeat(80));

if (failedAsserts > 0) {
    process.exit(1);
} else {
    process.exit(0);
}
