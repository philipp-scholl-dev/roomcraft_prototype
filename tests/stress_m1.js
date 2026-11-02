/**
 * RoomCraft Milestone 1 Adversarial Empirical Stress Test Suite
 * Author: challenger_m1_1 (Empirical Collision Stress-Tester)
 * 
 * Verifies:
 * 1. SAT Collision between arbitrary OBBs:
 *    - Randomly rotated overlapping rectangles (10,000 pairs)
 *    - Flush / adjacent non-overlapping rectangles at arbitrary rotation angles (empirical false positive test)
 *    - Circle vs Circle at multiple angles (empirical false positive and overlap test)
 *    - Circle vs OBB at multiple angles with analytical ground-truth oracle
 * 2. Boundary Clamping:
 *    - Extreme drag positions (-1000, 50000, -1e6, +1e6)
 *    - Arbitrary rotated angles (37.5°, 123°, 359°, full 360° sweep)
 *    - Oversized shapes (spanX >= room.width or spanY >= room.depth)
 * 3. Elevation, Rug, TV, and settings edge cases
 */

const app = require('../app.js');

const {
    CollisionEngine,
    Vector2D,
    getFurnitureCorners,
    State
} = app;

let totalChecks = 0;
let passedChecks = 0;
let failedChecks = 0;
const findings = [];

function recordResult(section, testName, passed, details = '') {
    totalChecks++;
    if (passed) {
        passedChecks++;
    } else {
        failedChecks++;
        findings.push({ section, testName, details });
        console.error(`  [FAIL] ${section} - ${testName}: ${details}`);
    }
}

console.log('='.repeat(80));
console.log('  MILESTONE 1 ADVERSARIAL EMPIRICAL STRESS TEST HARNESS');
console.log('='.repeat(80));

// ============================================================================
// SUITE 1: SAT COLLISION BETWEEN ARBITRARY OBBs
// ============================================================================
console.log('\n--- SUITE 1: SAT Collision Between Arbitrary OBBs ---');

// 1.1 Property Test: Overlapping Rectangles (10,000 randomized pairs)
{
    let detected = 0;
    const N = 10000;
    for (let i = 0; i < N; i++) {
        const px = 100 + Math.random() * 300;
        const py = 100 + Math.random() * 200;

        const w1 = 20 + Math.random() * 150;
        const l1 = 20 + Math.random() * 150;
        const rot1 = Math.random() * 360;
        const rad1 = (rot1 * Math.PI) / 180;
        const lx1 = (Math.random() - 0.5) * w1 * 0.7;
        const ly1 = (Math.random() - 0.5) * l1 * 0.7;
        const ax = px - (lx1 * Math.cos(rad1) - ly1 * Math.sin(rad1));
        const ay = py - (lx1 * Math.sin(rad1) + ly1 * Math.cos(rad1));

        const w2 = 20 + Math.random() * 150;
        const l2 = 20 + Math.random() * 150;
        const rot2 = Math.random() * 360;
        const rad2 = (rot2 * Math.PI) / 180;
        const lx2 = (Math.random() - 0.5) * w2 * 0.7;
        const ly2 = (Math.random() - 0.5) * l2 * 0.7;
        const bx = px - (lx2 * Math.cos(rad2) - ly2 * Math.sin(rad2));
        const by = py - (lx2 * Math.sin(rad2) + ly2 * Math.cos(rad2));

        const f1 = { shape: 'rect', x: ax, y: ay, w: w1, l: l1, h: 70, elevation: 0, rotation: rot1, collisionEnabled: true };
        const f2 = { shape: 'rect', x: bx, y: by, w: w2, l: l2, h: 70, elevation: 0, rotation: rot2, collisionEnabled: true };

        if (CollisionEngine.checkFurnitureCollision(f1, f2)) {
            detected++;
        }
    }
    recordResult(
        'SAT OBB',
        '10,000 guaranteed-overlapping OBB pairs are detected',
        detected === N,
        `Detected ${detected}/${N} (${((detected/N)*100).toFixed(1)}%)`
    );
}

// 1.2 Corner Penetration Stress Test (1,000 pairs)
{
    let cornerDetected = 0;
    const N = 1000;
    for (let i = 0; i < N; i++) {
        const ax = 200, ay = 200, w1 = 80, l1 = 60, rot1 = Math.random() * 360;
        const f1 = { shape: 'rect', x: ax, y: ay, w: w1, l: l1, h: 70, elevation: 0, rotation: rot1, collisionEnabled: true };

        const rad1 = (rot1 * Math.PI) / 180;
        const lx = (Math.random() - 0.5) * (w1 - 10);
        const ly = (Math.random() - 0.5) * (l1 - 10);
        const px = ax + lx * Math.cos(rad1) - ly * Math.sin(rad1);
        const py = ay + lx * Math.sin(rad1) + ly * Math.cos(rad1);

        const w2 = 50, l2 = 50, rot2 = Math.random() * 360;
        const rad2 = (rot2 * Math.PI) / 180;
        const c0x = -w2 / 2 * Math.cos(rad2) - (-l2 / 2) * Math.sin(rad2);
        const c0y = -w2 / 2 * Math.sin(rad2) + (-l2 / 2) * Math.cos(rad2);
        const bx = px - c0x;
        const by = py - c0y;

        const f2 = { shape: 'rect', x: bx, y: by, w: w2, l: l2, h: 70, elevation: 0, rotation: rot2, collisionEnabled: true };
        if (CollisionEngine.checkFurnitureCollision(f1, f2)) {
            cornerDetected++;
        }
    }
    recordResult(
        'SAT OBB',
        '1,000 corner penetrations detected',
        cornerDetected === N,
        `Detected ${cornerDetected}/${N}`
    );
}

// 1.3 Flush / Adjacent Rectangles False Positive Test (10,000 pairs at arbitrary angles)
// Two rectangles touch flush along an edge without overlapping
{
    let falsePositives = 0;
    const N = 10000;
    for (let i = 0; i < N; i++) {
        const rot = Math.random() * 360;
        const rad = (rot * Math.PI) / 180;
        const w1 = 20 + Math.random() * 100;
        const l1 = 20 + Math.random() * 100;
        const w2 = 20 + Math.random() * 100;
        const l2 = 20 + Math.random() * 100;
        const ax = 200, ay = 200;
        const dist = (w1 + w2) / 2;
        const bx = ax + dist * Math.cos(rad);
        const by = ay + dist * Math.sin(rad);

        const f1 = { shape: 'rect', x: ax, y: ay, w: w1, l: l1, h: 70, elevation: 0, rotation: rot, collisionEnabled: true };
        const f2 = { shape: 'rect', x: bx, y: by, w: w2, l: l2, h: 70, elevation: 0, rotation: rot, collisionEnabled: true };

        if (CollisionEngine.checkFurnitureCollision(f1, f2)) {
            falsePositives++;
        }
    }
    recordResult(
        'SAT OBB',
        'Flush touching rectangles at arbitrary rotation do not trigger false positive',
        falsePositives === 0,
        `False positives: ${falsePositives}/${N} (${((falsePositives/N)*100).toFixed(2)}%) due to floating point roundoff in checkOBBvsOBB without epsilon`
    );
}

// 1.4 Separated Rectangles with positive gap (1e-6 cm to 1.0 cm)
{
    let sepFailures = 0;
    const gaps = [1e-6, 1e-4, 1e-3, 0.01, 0.1, 1.0];
    const N = 1000;
    for (let gap of gaps) {
        for (let i = 0; i < N; i++) {
            const rot = Math.random() * 360;
            const rad = (rot * Math.PI) / 180;
            const w1 = 80, l1 = 60, w2 = 80, l2 = 60;
            const dist = (w1 + w2) / 2 + gap;
            const f1 = { shape: 'rect', x: 200, y: 200, w: w1, l: l1, h: 70, elevation: 0, rotation: rot, collisionEnabled: true };
            const f2 = { shape: 'rect', x: 200 + dist * Math.cos(rad), y: 200 + dist * Math.sin(rad), w: w2, l: l2, h: 70, elevation: 0, rotation: rot, collisionEnabled: true };
            if (CollisionEngine.checkFurnitureCollision(f1, f2)) {
                sepFailures++;
            }
        }
    }
    recordResult(
        'SAT OBB',
        'Separated rectangles with positive gap never false positive',
        sepFailures === 0,
        `Failures: ${sepFailures}`
    );
}

// 1.5 Circle vs Circle Stress Tests
{
    // Concentric
    const c1 = { shape: 'circle', x: 200, y: 200, w: 80, h: 50, elevation: 0, collisionEnabled: true };
    const cConc = { shape: 'circle', x: 200, y: 200, w: 40, h: 50, elevation: 0, collisionEnabled: true };
    recordResult('Circle-Circle', 'Concentric circles collide', CollisionEngine.checkFurnitureCollision(c1, cConc) === true);

    // Overlapping
    const cOver = { shape: 'circle', x: 250, y: 200, w: 80, h: 50, elevation: 0, collisionEnabled: true };
    recordResult('Circle-Circle', 'Overlapping circles collide', CollisionEngine.checkFurnitureCollision(c1, cOver) === true);

    // Flush touching circles across 10,000 random angles
    let circleFlushFP = 0;
    const N = 10000;
    for (let i = 0; i < N; i++) {
        const rot = Math.random() * 360;
        const rad = (rot * Math.PI) / 180;
        const r1 = 30 + Math.random() * 50;
        const r2 = 30 + Math.random() * 50;
        const ca = { x: 200, y: 200 };
        const dist = r1 + r2;
        const cb = { x: ca.x + dist * Math.cos(rad), y: ca.y + dist * Math.sin(rad) };
        if (CollisionEngine.checkCircleVsCircle(ca, r1, cb, r2)) {
            circleFlushFP++;
        }
    }
    recordResult(
        'Circle-Circle',
        'Flush touching circles do not false positive',
        circleFlushFP === 0,
        `False positives: ${circleFlushFP}/${N} (${((circleFlushFP/N)*100).toFixed(2)}%) due to floating point roundoff in distSq < radSum*radSum`
    );
}

// 1.6 Circle vs OBB Multi-Angle Stress Test with Analytical Oracle (5,000 cases)
{
    let circleOBBMatches = 0;
    const N = 5000;
    for (let i = 0; i < N; i++) {
        const rectW = 40 + Math.random() * 100;
        const rectL = 40 + Math.random() * 100;
        const rectRot = Math.random() * 360;
        const rect = { shape: 'rect', x: 200, y: 200, w: rectW, l: rectL, h: 60, elevation: 0, rotation: rectRot, collisionEnabled: true };

        const circleRadius = 15 + Math.random() * 50;
        const circleDiam = circleRadius * 2;

        const distanceOffset = (Math.random() - 0.5) * 60;
        const pickType = Math.random();
        let anchorX = (rectW / 2);
        let anchorY = (pickType < 0.5) ? (Math.random() - 0.5) * rectL : (rectL / 2);

        const dirAngle = Math.random() * 2 * Math.PI;
        const targetDist = circleRadius + distanceOffset;
        const localCircleX = anchorX + targetDist * Math.cos(dirAngle);
        const localCircleY = anchorY + targetDist * Math.sin(dirAngle);

        const rad = (rectRot * Math.PI) / 180;
        const worldCircleX = 200 + localCircleX * Math.cos(rad) - localCircleY * Math.sin(rad);
        const worldCircleY = 200 + localCircleX * Math.sin(rad) + localCircleY * Math.cos(rad);

        const circle = { shape: 'circle', x: worldCircleX, y: worldCircleY, w: circleDiam, h: 60, elevation: 0, collisionEnabled: true };

        // Analytical ground truth distance
        const dx = worldCircleX - 200;
        const dy = worldCircleY - 200;
        const invRad = -rad;
        const lx = dx * Math.cos(invRad) - dy * Math.sin(invRad);
        const ly = dx * Math.sin(invRad) + dy * Math.cos(invRad);
        const cx = Math.max(-rectW / 2, Math.min(rectW / 2, lx));
        const cy = Math.max(-rectL / 2, Math.min(rectL / 2, ly));
        const trueDistSq = (lx - cx) * (lx - cx) + (ly - cy) * (ly - cy);
        const expectedCollision = trueDistSq < circleRadius * circleRadius;

        const actualCol1 = CollisionEngine.checkFurnitureCollision(circle, rect);
        const actualCol2 = CollisionEngine.checkFurnitureCollision(rect, circle);

        if (actualCol1 === expectedCollision && actualCol2 === expectedCollision) {
            circleOBBMatches++;
        }
    }
    recordResult(
        'Circle-OBB',
        'Circle vs OBB matches analytical geometry oracle across 5,000 configurations (symmetric)',
        circleOBBMatches === N,
        `Matches: ${circleOBBMatches}/${N}`
    );
}

// ============================================================================
// SUITE 2: BOUNDARY CLAMPING
// ============================================================================
console.log('\n--- SUITE 2: Boundary Clamping ---');

const testRoom = { width: 500, depth: 400 };

// 2.1 Extreme Drag Positions (-1000, 50000, -1e6, +1e6)
{
    const extremePositions = [
        { x: -1000, y: -1000 },
        { x: -50000, y: -50000 },
        { x: 50000, y: 50000 },
        { x: 1000000, y: -1000000 },
        { x: -1000, y: 200 },
        { x: 50000, y: 200 },
        { x: 250, y: -1000 },
        { x: 250, y: 50000 }
    ];
    const angles = [0, 37.5, 45, 90, 123, 180, 270, 359];

    let extremeRectPass = 0;
    const totalRectCases = extremePositions.length * angles.length;

    for (let pos of extremePositions) {
        for (let angle of angles) {
            const item = { shape: 'rect', x: pos.x, y: pos.y, w: 80, l: 60, rotation: angle, collisionEnabled: true };
            CollisionEngine.clampFurnitureToRoom(item, testRoom);

            const corners = getFurnitureCorners(item);
            let inside = true;
            for (let c of corners) {
                if (c.x < -1e-6 || c.x > testRoom.width + 1e-6 || c.y < -1e-6 || c.y > testRoom.depth + 1e-6) {
                    inside = false;
                    break;
                }
            }
            if (inside) extremeRectPass++;
        }
    }
    recordResult(
        'Boundary Clamping',
        'Extreme positions (-1000..50000) & angles (37.5°, 123°, 359°): all corners stay inside bounds',
        extremeRectPass === totalRectCases,
        `${extremeRectPass}/${totalRectCases} pass`
    );

    let extremeCirclePass = 0;
    for (let pos of extremePositions) {
        const circle = { shape: 'circle', x: pos.x, y: pos.y, w: 60, l: 60, rotation: 0, collisionEnabled: true };
        CollisionEngine.clampFurnitureToRoom(circle, testRoom);
        const r = 30;
        const inside = (circle.x - r >= -1e-6 && circle.x + r <= testRoom.width + 1e-6 &&
                        circle.y - r >= -1e-6 && circle.y + r <= testRoom.depth + 1e-6);
        if (inside) extremeCirclePass++;
    }
    recordResult(
        'Boundary Clamping',
        'Extreme positions for circles: clamped inside room bounds',
        extremeCirclePass === extremePositions.length,
        `${extremeCirclePass}/${extremePositions.length} pass`
    );
}

// 2.2 10,000 Random Parametric Boundary Clamps
{
    let randomClampsPass = 0;
    const N = 10000;
    for (let i = 0; i < N; i++) {
        const rW = 100 + Math.random() * 900;
        const rD = 100 + Math.random() * 900;
        const rObj = { width: rW, depth: rD };

        const rot = Math.random() * 720 - 360;
        const w = 10 + Math.random() * Math.min(150, rW * 0.35);
        const l = 10 + Math.random() * Math.min(150, rD * 0.35);

        const initX = (Math.random() - 0.5) * 200000;
        const initY = (Math.random() - 0.5) * 200000;

        const item = { shape: 'rect', x: initX, y: initY, w, l, rotation: rot, collisionEnabled: true };
        CollisionEngine.clampFurnitureToRoom(item, rObj);

        const corners = getFurnitureCorners(item);
        const spanX = Math.max(...corners.map(c => c.x)) - Math.min(...corners.map(c => c.x));
        const spanY = Math.max(...corners.map(c => c.y)) - Math.min(...corners.map(c => c.y));

        if (spanX <= rW && spanY <= rD) {
            let inside = true;
            for (let c of corners) {
                if (c.x < -1e-5 || c.x > rW + 1e-5 || c.y < -1e-5 || c.y > rD + 1e-5) {
                    inside = false;
                    break;
                }
            }
            if (inside) randomClampsPass++;
        } else {
            // Span exceeds room: must be centered
            if (Math.abs(item.x - rW / 2) < 1e-5 || Math.abs(item.y - rD / 2) < 1e-5) {
                randomClampsPass++;
            }
        }
    }
    recordResult(
        'Boundary Clamping',
        '10,000 random parametric boundary clamps strictly satisfy room constraints',
        randomClampsPass === N,
        `${randomClampsPass}/${N} pass`
    );
}

// 2.3 Oversized Shapes Centering
{
    const wideItem = { shape: 'rect', x: 10, y: 200, w: 600, l: 80, rotation: 0, collisionEnabled: true };
    const modW = CollisionEngine.clampFurnitureToRoom(wideItem, testRoom);
    recordResult('Boundary Clamping', 'Oversized width item returns modified=true', modW === true);
    recordResult('Boundary Clamping', 'Oversized width item is centered at room.width / 2', wideItem.x === 250);

    const deepItem = { shape: 'rect', x: 250, y: 10, w: 80, l: 500, rotation: 0, collisionEnabled: true };
    const modD = CollisionEngine.clampFurnitureToRoom(deepItem, testRoom);
    recordResult('Boundary Clamping', 'Oversized depth item returns modified=true', modD === true);
    recordResult('Boundary Clamping', 'Oversized depth item is centered at room.depth / 2', deepItem.y === 200);
}

// ============================================================================
// SUITE 3: ELEVATION, RUGS, TV & COLLISIONENABLED CONSISTENCY
// ============================================================================
console.log('\n--- SUITE 3: Elevation, Rugs, TV & collisionEnabled ---');

// 3.1 TV Elevation Stacking & Collision Exemption
{
    State.room = { width: 500, depth: 400, height: 250, pitches: {} };
    const credenza = { id: 'sb', name: 'Lowboard', shape: 'rect', x: 200, y: 200, w: 180, l: 50, h: 45, elevation: 0, rotation: 0, collisionEnabled: true };
    const tv = { id: 'tv', name: 'OLED TV 65', shape: 'rect', x: 200, y: 200, w: 145, l: 15, h: 85, elevation: 0, tvSize: 65, rotation: 0, collisionEnabled: true };
    State.furniture = [credenza, tv];
    State.settings.collisionEnabled = true;

    CollisionEngine.updateAllCollisions();
    recordResult('Elevation', 'TV elevation auto-updated to surface height (45cm)', tv.elevation === 45);
    recordResult('Elevation', 'TV does not trigger collision with credenza underneath', tv.isColliding === false && credenza.isColliding === false);
}

// 3.2 Rug Exemption & Multi-Item Stacking
{
    const rug = { id: 'rug', name: 'Orientteppich', shape: 'rect', x: 200, y: 200, w: 250, l: 200, h: 2, elevation: 0, isRug: true, rotation: 0, collisionEnabled: true };
    const table = { id: 't', name: 'Esstisch', shape: 'rect', x: 200, y: 200, w: 160, l: 90, h: 75, elevation: 0, rotation: 0, collisionEnabled: true };
    State.furniture = [rug, table];

    CollisionEngine.updateAllCollisions();
    recordResult('Rug Exemption', 'Rug and table on top of rug do not collide', rug.isColliding === false && table.isColliding === false);
}

// 3.3 Vertical Elevation Clearance
{
    const desk = { shape: 'rect', x: 200, y: 200, w: 120, l: 80, h: 75, elevation: 0, rotation: 0, collisionEnabled: true };
    const wallUnit = { shape: 'rect', x: 200, y: 200, w: 120, l: 35, h: 40, elevation: 140, rotation: 0, collisionEnabled: true };
    recordResult('Elevation Clearance', 'Vertically separated items (top1 <= elev2) return false', CollisionEngine.checkFurnitureCollision(desk, wallUnit) === false);

    const overlappingShelf = { ...wallUnit, elevation: 50 };
    recordResult('Elevation Clearance', 'Vertically overlapping items return true', CollisionEngine.checkFurnitureCollision(desk, overlappingShelf) === true);
}

// 3.4 collisionEnabled Consistency Check (updateAllCollisions vs checkFurnitureCollision)
{
    const rawItem1 = { id: 'i1', name: 'Item 1', shape: 'rect', x: 200, y: 200, w: 80, l: 80, h: 75, elevation: 0, rotation: 0 /* collisionEnabled undefined */ };
    const rawItem2 = { id: 'i2', name: 'Item 2', shape: 'rect', x: 200, y: 200, w: 80, l: 80, h: 75, elevation: 0, rotation: 0 /* collisionEnabled undefined */ };
    
    // checkFurnitureCollision defaults collisionEnabled to true when undefined (line 392: f.collisionEnabled === false)
    const directCheck = CollisionEngine.checkFurnitureCollision(rawItem1, rawItem2);
    
    // updateAllCollisions checks `if (!f1.collisionEnabled) continue;` (line 638) which skips undefined!
    State.furniture = [rawItem1, rawItem2];
    State.settings.collisionEnabled = true;
    const updateResult = CollisionEngine.updateAllCollisions();
    
    const consistent = (directCheck === true && updateResult === true && rawItem1.isColliding === true);
    recordResult(
        'API Consistency',
        'updateAllCollisions handles undefined collisionEnabled consistently with checkFurnitureCollision',
        consistent,
        `directCheck=${directCheck}, updateResult=${updateResult}, rawItem1.isColliding=${rawItem1.isColliding} (updateAllCollisions skips items where collisionEnabled is undefined due to !f.collisionEnabled guard)`
    );
}

// ============================================================================
// SUMMARY & VERDICT
// ============================================================================
console.log('\n' + '='.repeat(80));
console.log('  CHALLENGER EMPIRICAL VERIFICATION REPORT');
console.log('='.repeat(80));
console.log(` Total Checks:  ${totalChecks}`);
console.log(` Passed:        ${passedChecks}`);
console.log(` Failed:        ${failedChecks}`);
console.log(` Success Rate:  ${((passedChecks / totalChecks) * 100).toFixed(2)}%`);
console.log('='.repeat(80));

if (findings.length > 0) {
    console.log('\nDefects / Empirical Failure Modes Discovered:');
    findings.forEach((f, idx) => {
        console.log(` ${idx + 1}. [${f.section}] ${f.testName}`);
        console.log(`    Evidence: ${f.details}`);
    });
}

// Exit code reflects whether critical defects were observed
if (failedChecks > 0) {
    process.exit(1);
} else {
    process.exit(0);
}
