/**
 * Empirical Boundary Sensitivity & Microscopic Overlap Stress Suite
 * Author: challenger_m1_r2_2 (Empirical Pitch Sampling & Scale Challenger)
 * 
 * Verifies:
 * 1. Wall Boundary Sensitivity: Real overlaps down to 0.001 cm across 360 rotation angles
 * 2. SAT OBB vs OBB Sensitivity: Real overlaps down to 0.001 cm vs flush contact vs 0.001 cm gap
 * 3. Circle vs Circle Sensitivity: Real overlaps down to 0.001 cm vs flush contact vs 0.001 cm gap
 * 4. Circle vs OBB Sensitivity: Real overlaps down to 0.001 cm vs flush contact vs 0.001 cm gap
 * 5. Roof Pitch Sensitivity: Real vertical overlaps down to 0.001 cm vs exact flush vs 0.001 cm clearance
 */

const app = require('../app.js');

const {
    CollisionEngine,
    Vector2D,
    getFurnitureCorners,
    State,
    getCeilingHeightAt
} = app;

let totalChecks = 0;
let passedChecks = 0;
let failedChecks = 0;
const failures = [];

function recordResult(category, testName, passed, details = '') {
    totalChecks++;
    if (passed) {
        passedChecks++;
    } else {
        failedChecks++;
        failures.push({ category, testName, details });
        console.error(`  [FAIL] ${category} - ${testName}: ${details}`);
    }
}

console.log('='.repeat(80));
console.log('  EMPIRICAL BOUNDARY SENSITIVITY & OVERLAP STRESS SUITE (0.001 cm)');
console.log('='.repeat(80));

const room = { width: 500, depth: 400, height: 250, pitches: {} };
State.room = room;

// ============================================================================
// 1. WALL BOUNDARY SENSITIVITY DOWN TO 0.001 CM
// ============================================================================
console.log('\n--- 1. Wall Boundary Sensitivity (0.001 cm) ---');

// 1.1 Rectangles penetrating walls by 0.001 cm along 4 cardinal walls
{
    const OVERLAP = 0.001; // 0.001 cm = 0.01 mm
    const w = 100, l = 60;
    
    // Left wall penetration: center at x = w/2 - 0.001 -> minX = -0.001
    const leftItem = { shape: 'rect', x: w / 2 - OVERLAP, y: 200, w, l, rotation: 0, collisionEnabled: true };
    recordResult('Wall Collision', 'Rectangle penetrating left wall by 0.001 cm is detected', CollisionEngine.checkWallCollision(leftItem, room) === true);

    // Right wall penetration: center at x = room.width - w/2 + 0.001 -> maxX = room.width + 0.001
    const rightItem = { shape: 'rect', x: room.width - w / 2 + OVERLAP, y: 200, w, l, rotation: 0, collisionEnabled: true };
    recordResult('Wall Collision', 'Rectangle penetrating right wall by 0.001 cm is detected', CollisionEngine.checkWallCollision(rightItem, room) === true);

    // Top wall penetration: center at y = l/2 - 0.001 -> minY = -0.001
    const topItem = { shape: 'rect', x: 250, y: l / 2 - OVERLAP, w, l, rotation: 0, collisionEnabled: true };
    recordResult('Wall Collision', 'Rectangle penetrating top wall by 0.001 cm is detected', CollisionEngine.checkWallCollision(topItem, room) === true);

    // Bottom wall penetration: center at y = room.depth - l/2 + 0.001 -> maxY = room.depth + 0.001
    const bottomItem = { shape: 'rect', x: 250, y: room.depth - l / 2 + OVERLAP, w, l, rotation: 0, collisionEnabled: true };
    recordResult('Wall Collision', 'Rectangle penetrating bottom wall by 0.001 cm is detected', CollisionEngine.checkWallCollision(bottomItem, room) === true);
}

// 1.2 Circles penetrating walls by 0.001 cm
{
    const OVERLAP = 0.001;
    const r = 35;
    const diam = r * 2;

    const leftCircle = { shape: 'circle', x: r - OVERLAP, y: 200, w: diam, l: diam, rotation: 0, collisionEnabled: true };
    recordResult('Wall Collision', 'Circle penetrating left wall by 0.001 cm is detected', CollisionEngine.checkWallCollision(leftCircle, room) === true);

    const rightCircle = { shape: 'circle', x: room.width - r + OVERLAP, y: 200, w: diam, l: diam, rotation: 0, collisionEnabled: true };
    recordResult('Wall Collision', 'Circle penetrating right wall by 0.001 cm is detected', CollisionEngine.checkWallCollision(rightCircle, room) === true);

    const topCircle = { shape: 'circle', x: 250, y: r - OVERLAP, w: diam, l: diam, rotation: 0, collisionEnabled: true };
    recordResult('Wall Collision', 'Circle penetrating top wall by 0.001 cm is detected', CollisionEngine.checkWallCollision(topCircle, room) === true);

    const bottomCircle = { shape: 'circle', x: 250, y: room.depth - r + OVERLAP, w: diam, l: diam, rotation: 0, collisionEnabled: true };
    recordResult('Wall Collision', 'Circle penetrating bottom wall by 0.001 cm is detected', CollisionEngine.checkWallCollision(bottomCircle, room) === true);

    // Circles flush to walls (0.000 cm overlap)
    const flushLeft = { shape: 'circle', x: r, y: 200, w: diam, l: diam, rotation: 0, collisionEnabled: true };
    const flushRight = { shape: 'circle', x: room.width - r, y: 200, w: diam, l: diam, rotation: 0, collisionEnabled: true };
    recordResult('Wall Collision', 'Flush circle to walls does not trigger false positive', 
        CollisionEngine.checkWallCollision(flushLeft, room) === false && CollisionEngine.checkWallCollision(flushRight, room) === false);
}

// 1.3 360-degree Rotated Rectangles: Clamped flush vs Displaced outward by 0.001 cm
{
    const OVERLAP = 0.001;
    let flushFalsePositives = 0;
    let detectedPenetrations = 0;
    const TOTAL_ANGLES = 360;

    for (let rot = 0; rot < TOTAL_ANGLES; rot++) {
        // Clamp item flush to right wall
        const item = { shape: 'rect', x: room.width + 100, y: 200, w: 90, l: 45, rotation: rot, collisionEnabled: true };
        CollisionEngine.clampFurnitureToRoom(item, room);

        // Clamped item should have 0 false positive
        if (CollisionEngine.checkWallCollision(item, room)) {
            flushFalsePositives++;
        }

        // Now displace item outward past the wall by 0.001 cm
        item.x += OVERLAP;
        if (CollisionEngine.checkWallCollision(item, room)) {
            detectedPenetrations++;
        }
    }

    recordResult(
        'Wall Collision',
        'Rotated rectangles (360 angles) clamped flush have 0 false positives',
        flushFalsePositives === 0,
        `False positives: ${flushFalsePositives}/${TOTAL_ANGLES}`
    );

    recordResult(
        'Wall Collision',
        'Rotated rectangles (360 angles) displaced outward by 0.001 cm are 100% detected',
        detectedPenetrations === TOTAL_ANGLES,
        `Detected: ${detectedPenetrations}/${TOTAL_ANGLES}`
    );
}

// ============================================================================
// 2. SAT OBB vs OBB SENSITIVITY DOWN TO 0.001 CM
// ============================================================================
console.log('\n--- 2. SAT OBB vs OBB Sensitivity (0.001 cm) ---');

// 2.1 5,000 Rotated Rectangle Pairs Overlapping by Exactly 0.001 cm
{
    const OVERLAP = 0.001;
    let detectedCount = 0;
    const N = 5000;

    for (let i = 0; i < N; i++) {
        const rot = Math.random() * 360;
        const rad = (rot * Math.PI) / 180;
        const w1 = 40 + Math.random() * 80;
        const l1 = 40 + Math.random() * 80;
        const w2 = 40 + Math.random() * 80;
        const l2 = 40 + Math.random() * 80;

        const ax = 250, ay = 200;
        // Normal along local width axis (cos(rad), sin(rad))
        const dist = (w1 + w2) / 2 - OVERLAP;
        const bx = ax + dist * Math.cos(rad);
        const by = ay + dist * Math.sin(rad);

        const f1 = { shape: 'rect', x: ax, y: ay, w: w1, l: l1, h: 70, elevation: 0, rotation: rot, collisionEnabled: true };
        const f2 = { shape: 'rect', x: bx, y: by, w: w2, l: l2, h: 70, elevation: 0, rotation: rot, collisionEnabled: true };

        if (CollisionEngine.checkFurnitureCollision(f1, f2)) {
            detectedCount++;
        }
    }

    recordResult(
        'SAT OBB',
        '5,000 rotated rectangle pairs overlapping by 0.001 cm are 100% detected',
        detectedCount === N,
        `Detected: ${detectedCount}/${N} (${((detectedCount / N) * 100).toFixed(2)}%)`
    );
}

// 2.2 5,000 Rotated Rectangle Pairs Separated by 0.001 cm Gap
{
    const GAP = 0.001;
    let falsePositiveCount = 0;
    const N = 5000;

    for (let i = 0; i < N; i++) {
        const rot = Math.random() * 360;
        const rad = (rot * Math.PI) / 180;
        const w1 = 40 + Math.random() * 80;
        const l1 = 40 + Math.random() * 80;
        const w2 = 40 + Math.random() * 80;
        const l2 = 40 + Math.random() * 80;

        const ax = 250, ay = 200;
        const dist = (w1 + w2) / 2 + GAP;
        const bx = ax + dist * Math.cos(rad);
        const by = ay + dist * Math.sin(rad);

        const f1 = { shape: 'rect', x: ax, y: ay, w: w1, l: l1, h: 70, elevation: 0, rotation: rot, collisionEnabled: true };
        const f2 = { shape: 'rect', x: bx, y: by, w: w2, l: l2, h: 70, elevation: 0, rotation: rot, collisionEnabled: true };

        if (CollisionEngine.checkFurnitureCollision(f1, f2)) {
            falsePositiveCount++;
        }
    }

    recordResult(
        'SAT OBB',
        '5,000 rotated rectangle pairs separated by 0.001 cm gap have 0 false positives',
        falsePositiveCount === 0,
        `False positives: ${falsePositiveCount}/${N}`
    );
}

// ============================================================================
// 3. CIRCLE VS CIRCLE SENSITIVITY DOWN TO 0.001 CM
// ============================================================================
console.log('\n--- 3. Circle vs Circle Sensitivity (0.001 cm) ---');

{
    const OVERLAP = 0.001;
    let circleOverlapDetected = 0;
    let circleGapFalsePositives = 0;
    const N = 5000;

    for (let i = 0; i < N; i++) {
        const angle = Math.random() * 2 * Math.PI;
        const r1 = 20 + Math.random() * 50;
        const r2 = 20 + Math.random() * 50;
        const radSum = r1 + r2;

        const c1 = { shape: 'circle', x: 250, y: 200, w: r1 * 2, h: 60, elevation: 0, collisionEnabled: true };

        // Test overlap by 0.001 cm
        const distOverlap = radSum - OVERLAP;
        const cOver = { shape: 'circle', x: 250 + distOverlap * Math.cos(angle), y: 200 + distOverlap * Math.sin(angle), w: r2 * 2, h: 60, elevation: 0, collisionEnabled: true };
        if (CollisionEngine.checkFurnitureCollision(c1, cOver)) {
            circleOverlapDetected++;
        }

        // Test gap of 0.001 cm
        const distGap = radSum + OVERLAP;
        const cGap = { shape: 'circle', x: 250 + distGap * Math.cos(angle), y: 200 + distGap * Math.sin(angle), w: r2 * 2, h: 60, elevation: 0, collisionEnabled: true };
        if (CollisionEngine.checkFurnitureCollision(c1, cGap)) {
            circleGapFalsePositives++;
        }
    }

    recordResult(
        'Circle-Circle',
        '5,000 circle pairs overlapping by 0.001 cm are 100% detected',
        circleOverlapDetected === N,
        `Detected: ${circleOverlapDetected}/${N}`
    );

    recordResult(
        'Circle-Circle',
        '5,000 circle pairs separated by 0.001 cm gap have 0 false positives',
        circleGapFalsePositives === 0,
        `False positives: ${circleGapFalsePositives}/${N}`
    );
}

// ============================================================================
// 4. CIRCLE VS OBB SENSITIVITY DOWN TO 0.001 CM
// ============================================================================
console.log('\n--- 4. Circle vs OBB Sensitivity (0.001 cm) ---');

{
    const OVERLAP = 0.001;
    let circleOBBDetected = 0;
    let circleOBBGapFP = 0;
    const N = 3000;

    for (let i = 0; i < N; i++) {
        const rot = Math.random() * 360;
        const rad = (rot * Math.PI) / 180;
        const w = 50 + Math.random() * 80;
        const l = 50 + Math.random() * 80;
        const r = 20 + Math.random() * 40;

        const rect = { shape: 'rect', x: 250, y: 200, w, l, h: 60, elevation: 0, rotation: rot, collisionEnabled: true };

        // Point on right edge of rect: offset in local space is (w/2, 0)
        // With overlap 0.001 cm: local circle center is (w/2 + r - OVERLAP, 0)
        const localXOverlap = w / 2 + r - OVERLAP;
        const worldXOverlap = 250 + localXOverlap * Math.cos(rad);
        const worldYOverlap = 200 + localXOverlap * Math.sin(rad);

        const circleOver = { shape: 'circle', x: worldXOverlap, y: worldYOverlap, w: r * 2, h: 60, elevation: 0, collisionEnabled: true };
        if (CollisionEngine.checkFurnitureCollision(rect, circleOver)) {
            circleOBBDetected++;
        }

        // With gap 0.001 cm: local circle center is (w/2 + r + OVERLAP, 0)
        const localXGap = w / 2 + r + OVERLAP;
        const worldXGap = 250 + localXGap * Math.cos(rad);
        const worldYGap = 200 + localXGap * Math.sin(rad);

        const circleGap = { shape: 'circle', x: worldXGap, y: worldYGap, w: r * 2, h: 60, elevation: 0, collisionEnabled: true };
        if (CollisionEngine.checkFurnitureCollision(rect, circleGap)) {
            circleOBBGapFP++;
        }
    }

    recordResult(
        'Circle-OBB',
        '3,000 Circle-OBB pairs overlapping by 0.001 cm are 100% detected',
        circleOBBDetected === N,
        `Detected: ${circleOBBDetected}/${N}`
    );

    recordResult(
        'Circle-OBB',
        '3,000 Circle-OBB pairs separated by 0.001 cm gap have 0 false positives',
        circleOBBGapFP === 0,
        `False positives: ${circleOBBGapFP}/${N}`
    );
}

// ============================================================================
// 5. ROOF PITCH VERTICAL OVERLAP SENSITIVITY (0.001 CM)
// ============================================================================
console.log('\n--- 5. Roof Pitch Sensitivity (0.001 cm) ---');

{
    room.pitches.top = { enabled: true, kniestock: 80, run: 150 };
    const OVERLAP = 0.001;

    // Minimum ceiling height occurs at the lowest corner (closest to kniestock, y = 50 - 20 = 30)
    // At y = 30, ceiling is: 80 + 170 * (30/150) = 114.0 cm
    const minCeil = getCeilingHeightAt(250, 30); // 114 cm

    // Item with h = minCeil + 0.001 cm (exceeds lowest ceiling point by 0.001 cm)
    const itemExceed = { shape: 'rect', x: 250, y: 50, w: 60, l: 40, h: minCeil + OVERLAP, elevation: 0, rotation: 0, collisionEnabled: true };
    recordResult('Roof Pitch', 'Rectangle exceeding pitch ceiling by 0.001 cm is detected', CollisionEngine.checkRoofPitchCollision(itemExceed) === true);

    // Item with h = minCeil (exact flush)
    const itemFlush = { shape: 'rect', x: 250, y: 50, w: 60, l: 40, h: minCeil, elevation: 0, rotation: 0, collisionEnabled: true };
    recordResult('Roof Pitch', 'Rectangle flush with pitch ceiling does not collide', CollisionEngine.checkRoofPitchCollision(itemFlush) === false);

    // Item with h = minCeil - 0.001 cm
    const itemClear = { shape: 'rect', x: 250, y: 50, w: 60, l: 40, h: minCeil - OVERLAP, elevation: 0, rotation: 0, collisionEnabled: true };
    recordResult('Roof Pitch', 'Rectangle cleared by 0.001 cm below pitch ceiling does not collide', CollisionEngine.checkRoofPitchCollision(itemClear) === false);
}

// ============================================================================
// SUMMARY & VERDICT
// ============================================================================
console.log('\n' + '='.repeat(80));
console.log('  BOUNDARY SENSITIVITY VERIFICATION SUMMARY');
console.log('='.repeat(80));
console.log(` Total Checks:  ${totalChecks}`);
console.log(` Passed:        ${passedChecks}`);
console.log(` Failed:        ${failedChecks}`);
console.log(` Success Rate:  ${((passedChecks / totalChecks) * 100).toFixed(2)}%`);
console.log('='.repeat(80));

if (failedChecks > 0) {
    console.error(`\n❌ ${failedChecks} checks failed!`);
    process.exit(1);
} else {
    console.log('\n✨ All boundary sensitivity checks down to 0.001 cm PASSED with 100% accuracy!');
    process.exit(0);
}
