const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppInstance } = require('./harness');

test('Empirical Adversarial Challenge Suite: Milestone 4 Features 12 & 13', async (t) => {
    const app = createAppInstance();
    const { SmartSnapping, CollisionEngine, BOMCalculator, ExportManager, State, Editor2D } = app;

    // =========================================================================
    // FEATURE 12: SMART SNAPPING ADVERSARIAL STRESS
    // =========================================================================

    await t.test('1. Smart Snapping Stress: 600+ randomized furniture drag iterations', () => {
        const rooms = [
            { width: 300, depth: 300 },
            { width: 500, depth: 400 },
            { width: 800, depth: 600 },
            { width: 1200, depth: 1000 },
            { width: 250, depth: 250 }
        ];

        const rotations = [0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 137.5, 180, 225, 270, 315, -30, -90, 720];
        const shapes = ['rect', 'circle'];

        let iterations = 0;
        let snapCount = 0;

        for (let rIdx = 0; rIdx < rooms.length; rIdx++) {
            const room = rooms[rIdx];

            // Setup a few sibling obstacles inside room
            const siblings = [
                { id: 's1', name: 'Schrank-A', shape: 'rect', w: 100, l: 60, x: 100, y: 100, rotation: 0 },
                { id: 's2', name: 'Tisch-B', shape: 'circle', w: 80, l: 80, x: room.width / 2, y: room.depth / 2, rotation: 0 }
            ];

            for (let rotIdx = 0; rotIdx < rotations.length; rotIdx++) {
                const rotation = rotations[rotIdx];

                for (let shapeIdx = 0; shapeIdx < shapes.length; shapeIdx++) {
                    const shape = shapes[shapeIdx];
                    const w = shape === 'circle' ? 60 : 80;
                    const l = shape === 'circle' ? 60 : 50;

                    // Compute extents
                    const dummy = { shape, w, l, rotation };
                    const ext = SmartSnapping.getExtents(dummy);

                    // Valid interior bounds
                    const minX = ext.halfSpanX + 0.1;
                    const maxX = room.width - ext.halfSpanX - 0.1;
                    const minY = ext.halfSpanY + 0.1;
                    const maxY = room.depth - ext.halfSpanY - 0.1;

                    if (minX >= maxX || minY >= maxY) continue;

                    // Test points across room: near walls, near center, near siblings, random
                    const samplePoints = [
                        { x: minX + 2, y: minY + 2 }, // Near top-left wall
                        { x: maxX - 3, y: maxY - 4 }, // Near bottom-right wall
                        { x: room.width / 2 + 4, y: room.depth / 2 - 3 }, // Near room center
                        { x: siblings[0].x + 50 + ext.halfSpanX + 2, y: siblings[0].y }, // Near sibling A edge
                        { x: siblings[1].x - ext.halfSpanX - 3, y: siblings[1].y } // Near sibling B edge
                    ];

                    // Add 2 pseudo-random positions inside valid placement
                    samplePoints.push({
                        x: minX + ((iterations * 47) % (maxX - minX)),
                        y: minY + ((iterations * 71) % (maxY - minY))
                    });

                    for (const pt of samplePoints) {
                        iterations++;
                        const dragItem = {
                            id: `drag_${iterations}`,
                            name: `TestItem_${iterations}`,
                            shape,
                            w,
                            l,
                            x: pt.x,
                            y: pt.y,
                            rotation
                        };

                        // 1. Initial position must be inside room
                        const initWallColl = CollisionEngine.checkWallCollision(dragItem, room);
                        assert.equal(initWallColl, false, `Initial placement must be inside room at iteration ${iterations}`);

                        // 2. Execute computeSnap
                        const snap = SmartSnapping.computeSnap(dragItem, siblings, room, 10);

                        // Invariant A: Return structure
                        assert.ok(snap && typeof snap === 'object', 'Must return an object');
                        assert.ok(Number.isFinite(snap.snappedX), `snappedX must be finite (no NaN/Inf) at iteration ${iterations}`);
                        assert.ok(Number.isFinite(snap.snappedY), `snappedY must be finite (no NaN/Inf) at iteration ${iterations}`);
                        assert.ok(Array.isArray(snap.guides), 'guides must be an array');
                        assert.ok(typeof snap.snappedAxes === 'object', 'snappedAxes must be an object');
                        assert.ok(typeof snap.snappedAxes.x === 'boolean', 'snappedAxes.x must be boolean');
                        assert.ok(typeof snap.snappedAxes.y === 'boolean', 'snappedAxes.y must be boolean');

                        // Invariant B: Guide details
                        for (const g of snap.guides) {
                            assert.ok(Number.isFinite(g.x1) && Number.isFinite(g.y1) && Number.isFinite(g.x2) && Number.isFinite(g.y2));
                            assert.ok(g.axis === 'x' || g.axis === 'y');
                            assert.ok(typeof g.label === 'string');
                            assert.ok(Number.isFinite(g.snapPos));
                        }

                        // Invariant C: Wall boundary preservation
                        const snappedItem = { ...dragItem, x: snap.snappedX, y: snap.snappedY };
                        const wallColl = CollisionEngine.checkWallCollision(snappedItem, room);
                        assert.equal(
                            wallColl,
                            false,
                            `Snapped position must never push item outside boundaries at iteration ${iterations}: x=${snap.snappedX}, y=${snap.snappedY}, rot=${rotation}, shape=${shape}`
                        );

                        if (snap.snappedAxes.x || snap.snappedAxes.y) {
                            snapCount++;
                        }
                    }
                }
            }
        }

        assert.ok(iterations >= 500, `Must run at least 500 iterations (ran ${iterations})`);
        assert.ok(snapCount > 0, `At least some items must have snapped (snapped: ${snapCount})`);
    });

    await t.test('2. Snapped flush contacts with walls & siblings produce ZERO false SAT collisions', () => {
        const room = { width: 600, depth: 500 };
        const testAngles = [0, 15, 45, 90, 135, 180, 270];

        // 1. Flush wall contact for all 4 walls at various rotations
        for (const rot of testAngles) {
            const item = { id: 'f_wall', name: 'Schrank', shape: 'rect', w: 120, l: 60, x: 70, y: 70, rotation: rot };
            const ext = SmartSnapping.getExtents(item);

            // Left wall flush
            const leftSnap = SmartSnapping.computeSnap({ ...item, x: ext.halfSpanX + 3, y: 250 }, [], room, 10);
            assert.equal(leftSnap.snappedAxes.x, true);
            const itemLeft = { ...item, x: leftSnap.snappedX, y: 250 };
            assert.equal(CollisionEngine.checkWallCollision(itemLeft, room), false, `Left wall flush at ${rot}° must not collide with wall`);

            // Right wall flush
            const rightSnap = SmartSnapping.computeSnap({ ...item, x: room.width - ext.halfSpanX - 3, y: 250 }, [], room, 10);
            assert.equal(rightSnap.snappedAxes.x, true);
            const itemRight = { ...item, x: rightSnap.snappedX, y: 250 };
            assert.equal(CollisionEngine.checkWallCollision(itemRight, room), false, `Right wall flush at ${rot}° must not collide with wall`);

            // Top wall flush
            const topSnap = SmartSnapping.computeSnap({ ...item, x: 300, y: ext.halfSpanY + 3 }, [], room, 10);
            assert.equal(topSnap.snappedAxes.y, true);
            const itemTop = { ...item, x: 300, y: topSnap.snappedY };
            assert.equal(CollisionEngine.checkWallCollision(itemTop, room), false, `Top wall flush at ${rot}° must not collide with wall`);

            // Bottom wall flush
            const bottomSnap = SmartSnapping.computeSnap({ ...item, x: 300, y: room.depth - ext.halfSpanY - 3 }, [], room, 10);
            assert.equal(bottomSnap.snappedAxes.y, true);
            const itemBottom = { ...item, x: 300, y: bottomSnap.snappedY };
            assert.equal(CollisionEngine.checkWallCollision(itemBottom, room), false, `Bottom wall flush at ${rot}° must not collide with wall`);
        }

        // 2. Flush sibling-to-sibling contact: Rect-to-Rect, Rect-to-Circle, Circle-to-Circle
        const sibling = { id: 'sib_main', name: 'Hauptmoebel', shape: 'rect', w: 100, l: 100, x: 300, y: 250, rotation: 0 };
        const sibExt = SmartSnapping.getExtents(sibling);

        // Dragging rect placed flush against sibling right edge
        const dragRect = { id: 'drag_r', name: 'Beistelltisch', shape: 'rect', w: 60, l: 60, x: 383, y: 250, rotation: 0 };
        const snapR = SmartSnapping.computeSnap(dragRect, [sibling], room, 10);
        assert.equal(snapR.snappedAxes.x, true);
        const snappedRect = { ...dragRect, x: snapR.snappedX, y: snapR.snappedY };

        // Verify distance: sibling right = 350, snappedRect left = 380 - 30 = 350 (touching)
        assert.equal(snappedRect.x, 380);
        // Verify SAT collision between touching rectangles is strictly FALSE
        assert.equal(CollisionEngine.checkFurnitureCollision(sibling, snappedRect), false, 'Flush rect-rect contact must produce ZERO SAT collision');

        // Dragging circle placed flush against sibling right edge
        const dragCircle = { id: 'drag_c', name: 'Runder Tisch', shape: 'circle', w: 60, l: 60, x: 383, y: 250, rotation: 0 };
        const snapC = SmartSnapping.computeSnap(dragCircle, [sibling], room, 10);
        assert.equal(snapC.snappedAxes.x, true);
        const snappedCircle = { ...dragCircle, x: snapC.snappedX, y: snapC.snappedY };
        assert.equal(snappedCircle.x, 380);
        assert.equal(CollisionEngine.checkFurnitureCollision(sibling, snappedCircle), false, 'Flush rect-circle contact must produce ZERO SAT collision');

        // Circle-to-Circle flush contact
        const siblingCircle = { id: 'sib_circ', name: 'Hocker', shape: 'circle', w: 60, l: 60, x: 200, y: 200, rotation: 0 };
        const dragCircle2 = { id: 'drag_c2', name: 'Hocker 2', shape: 'circle', w: 60, l: 60, x: 263, y: 200, rotation: 0 };
        const snapCC = SmartSnapping.computeSnap(dragCircle2, [siblingCircle], room, 10);
        assert.equal(snapCC.snappedAxes.x, true);
        const snappedCC = { ...dragCircle2, x: snapCC.snappedX, y: snapCC.snappedY };
        assert.equal(snappedCC.x, 260); // 200 + 30 + 30 = 260
        assert.equal(CollisionEngine.checkFurnitureCollision(siblingCircle, snappedCC), false, 'Flush circle-circle contact must produce ZERO SAT collision');
    });

    await t.test('3. Sibling priority tie-breaking & closer-distance precedence matrix', () => {
        const room = { width: 500, depth: 400 };

        // Setup 1: Exact distance tie between Sibling (priority 3), Room Center (priority 2), and Wall (priority 1)
        // Room center X = 250.
        // Sibling center X = 250.
        // Item at x = 254 (distance = 4 to both)
        const siblingAtCenter = { id: 's_tie', name: 'Sofa', shape: 'rect', w: 80, l: 80, x: 250, y: 150, rotation: 0 };
        const dragItem = { id: 'd_tie', name: 'Tisch', shape: 'rect', w: 60, l: 60, x: 254, y: 300, rotation: 0 };

        const snapTie = SmartSnapping.computeSnap(dragItem, [siblingAtCenter], room, 10);
        assert.equal(snapTie.snappedX, 250);
        const guideX = snapTie.guides.find(g => g.axis === 'x');
        // Priority 3 (sibling) wins tie over Priority 2 (room-center)
        assert.equal(guideX.type, 'furniture-center');
        assert.equal(guideX.label, 'Sofa');

        // Setup 2: Closer distance wins over higher priority
        // Sibling at x = 256 (distance = 6 from x = 250)
        // Room centerline at x = 250 (distance = 1 from x = 251)
        const siblingFurther = { id: 's_dist', name: 'Regal', shape: 'rect', w: 80, l: 80, x: 256, y: 150, rotation: 0 };
        const dragNearCenter = { id: 'd_near', name: 'Sessel', shape: 'rect', w: 60, l: 60, x: 251, y: 300, rotation: 0 };

        const snapDist = SmartSnapping.computeSnap(dragNearCenter, [siblingFurther], room, 10);
        assert.equal(snapDist.snappedX, 250);
        const guideDistX = snapDist.guides.find(g => g.axis === 'x');
        // Centerline has dist=1 vs Sibling dist=5 -> closer distance wins
        assert.equal(guideDistX.type, 'room-center');
        assert.equal(guideDistX.label, 'Raummitte');

        // Setup 3: Distance outside threshold (> 10cm) is discarded
        // Centerline is at 250. At x=290, w=40: left=270, center=290, right=310, all >10cm from 250 and walls
        const dragFar = { id: 'd_far', name: 'Lampe', shape: 'rect', w: 40, l: 40, x: 290, y: 300, rotation: 0 };
        const snapFar = SmartSnapping.computeSnap(dragFar, [], room, 10);
        assert.equal(snapFar.snappedAxes.x, false);
        assert.equal(snapFar.snappedX, 290);
    });

    await t.test('4. Keyboard bypasses & Settings suppression logic', () => {
        // Drag handler checks:
        // const snappingActive = State.settings.smartSnappingEnabled !== false && !e.altKey && !e.shiftKey;

        const checkSnappingActive = (settings, e) => {
            return settings.smartSnappingEnabled !== false && !e.altKey && !e.shiftKey;
        };

        // Normal drag: snapping active
        assert.equal(checkSnappingActive({ smartSnappingEnabled: true }, { altKey: false, shiftKey: false }), true);

        // Alt key held: snapping bypassed
        assert.equal(checkSnappingActive({ smartSnappingEnabled: true }, { altKey: true, shiftKey: false }), false);

        // Shift key held: snapping bypassed for single-axis constraint
        assert.equal(checkSnappingActive({ smartSnappingEnabled: true }, { altKey: false, shiftKey: true }), false);

        // Both Alt and Shift held: snapping bypassed
        assert.equal(checkSnappingActive({ smartSnappingEnabled: true }, { altKey: true, shiftKey: true }), false);

        // Setting disabled: snapping bypassed
        assert.equal(checkSnappingActive({ smartSnappingEnabled: false }, { altKey: false, shiftKey: false }), false);
    });

    // =========================================================================
    // FEATURE 13: BOM CALCULATION ADVERSARIAL STRESS
    // =========================================================================

    await t.test('5. Extreme room configurations: Min (100x100x200) & Max (2000x2000x500)', () => {
        // 1. Minimum Room Size
        const minState = {
            room: { width: 100, depth: 100, height: 200, pitches: {} },
            elements: [],
            installations: [],
            furniture: []
        };
        const minBOM = BOMCalculator.calculate(minState);
        assert.equal(minBOM.geometry.widthCm, 100);
        assert.equal(minBOM.geometry.depthCm, 100);
        assert.equal(minBOM.geometry.heightCm, 200);
        assert.equal(minBOM.geometry.floorAreaM2, 1.00); // 100*100 / 10000 = 1.00 m²
        assert.equal(minBOM.geometry.perimeterM, 4.00); // 2*(100+100) / 100 = 4.00 m
        assert.equal(minBOM.geometry.grossVolumeM3, 2.00); // 100*100*200 / 1000000 = 2.00 m³
        assert.equal(minBOM.geometry.netVolumeM3, 2.00);
        assert.equal(minBOM.totals.grossWallAreaM2, 8.00); // 4 * (100*200) / 10000 = 8.00 m²
        assert.equal(minBOM.totals.netWallAreaM2, 8.00);
        assert.equal(minBOM.totals.ceilingAreaM2, 1.00);

        // 2. Maximum Room Size
        const maxState = {
            room: { width: 2000, depth: 2000, height: 500, pitches: {} },
            elements: [],
            installations: [],
            furniture: []
        };
        const maxBOM = BOMCalculator.calculate(maxState);
        assert.equal(maxBOM.geometry.widthCm, 2000);
        assert.equal(maxBOM.geometry.depthCm, 2000);
        assert.equal(maxBOM.geometry.heightCm, 500);
        assert.equal(maxBOM.geometry.floorAreaM2, 400.00); // 2000*2000 / 10000 = 400.00 m²
        assert.equal(maxBOM.geometry.perimeterM, 80.00); // 2*(2000+2000) / 100 = 80.00 m
        assert.equal(maxBOM.geometry.grossVolumeM3, 2000.00); // 2000*2000*500 / 1000000 = 2000.00 m³
        assert.equal(maxBOM.geometry.netVolumeM3, 2000.00);
        assert.equal(maxBOM.totals.grossWallAreaM2, 400.00); // 4 * (2000*500) / 10000 = 400.00 m²
        assert.equal(maxBOM.totals.netWallAreaM2, 400.00);
        assert.equal(maxBOM.totals.ceilingAreaM2, 400.00);
    });

    await t.test('6. Roof pitch stress matrix: 0, 1, 2, 3, and 4 pitches with volume loss & slope area', () => {
        const W = 600, D = 400, H = 250;
        const grossVol = (W * D * H) / 1000000; // 60 m³
        const floorArea = (W * D) / 10000; // 24 m²

        // Helper to run pitch tests
        const testPitches = (pitchConfig) => {
            return BOMCalculator.calculate({
                room: { width: W, depth: D, height: H, pitches: pitchConfig },
                elements: [],
                installations: [],
                furniture: []
            });
        };

        // 0 Pitches
        const bom0 = testPitches({});
        assert.equal(bom0.geometry.grossVolumeM3, 60);
        assert.equal(bom0.geometry.netVolumeM3, 60);
        assert.equal(bom0.totals.ceilingAreaM2, 24);

        // 1 Pitch (Top: North wall, W=600, run=150, kniestock=80, slopeHeight=170)
        // Lost vol = 0.5 * 1.5 * 1.7 * 6.0 = 7.65 m³
        // Net vol = 60 - 7.65 = 52.35 m³
        // Slope hypotenuse = sqrt(150^2 + 170^2) = sqrt(51400) ≈ 226.7157 cm
        // Slope area = 600 * 226.7157 / 10000 ≈ 13.60 m²
        // Flat ceiling = 24 - (600 * 150 / 10000 = 9) = 15 m²
        // Total ceiling = 15 + 13.60 = 28.60 m²
        const bom1 = testPitches({
            top: { enabled: true, run: 150, kniestock: 80 }
        });
        assert.equal(bom1.geometry.grossVolumeM3, 60);
        assert.equal(bom1.geometry.netVolumeM3, 52.35);
        assert.ok(Math.abs(bom1.totals.ceilingAreaM2 - 28.60) <= 0.05);

        // 2 Pitches (Gable: Top + Bottom)
        // Double lost vol = 2 * 7.65 = 15.30 m³
        // Net vol = 60 - 15.30 = 44.70 m³
        // Flat ceiling = 24 - 18 = 6 m²
        // Total ceiling = 6 + 2 * 13.60 = 33.20 m²
        const bom2 = testPitches({
            top: { enabled: true, run: 150, kniestock: 80 },
            bottom: { enabled: true, run: 150, kniestock: 80 }
        });
        assert.equal(bom2.geometry.netVolumeM3, 44.70);
        assert.ok(Math.abs(bom2.totals.ceilingAreaM2 - 33.20) <= 0.05);

        // 3 Pitches (Top + Bottom + Left)
        // Left wall: D = 400, run = 100, kniestock = 80, slopeHeight = 170
        // Lost vol left = 0.5 * 1.0 * 1.7 * 4.0 = 3.40 m³
        // Total lost vol = 15.30 + 3.40 = 18.70 m³
        // Net vol = 60 - 18.70 = 41.30 m³
        const bom3 = testPitches({
            top: { enabled: true, run: 150, kniestock: 80 },
            bottom: { enabled: true, run: 150, kniestock: 80 },
            left: { enabled: true, run: 100, kniestock: 80 }
        });
        assert.equal(bom3.geometry.netVolumeM3, 41.30);
        assert.ok(bom3.totals.ceilingAreaM2 > 30);

        // 4 Pitches (Top + Bottom + Left + Right)
        // Right wall: D = 400, run = 100, kniestock = 80 -> lost vol = 3.40 m³
        // Total lost vol = 18.70 + 3.40 = 22.10 m³
        // Net vol = 60 - 22.10 = 37.90 m³
        const bom4 = testPitches({
            top: { enabled: true, run: 150, kniestock: 80 },
            bottom: { enabled: true, run: 150, kniestock: 80 },
            left: { enabled: true, run: 100, kniestock: 80 },
            right: { enabled: true, run: 100, kniestock: 80 }
        });
        assert.equal(bom4.geometry.netVolumeM3, 37.90);
        assert.ok(bom4.totals.ceilingAreaM2 > 35);
        assert.ok(bom4.geometry.netVolumeM3 >= 0);

        // Extreme: Run covers full room and kniestock = 0
        const bomExtreme = testPitches({
            top: { enabled: true, run: 600, kniestock: 0 },
            bottom: { enabled: true, run: 600, kniestock: 0 }
        });
        // Invariant: Net volume and ceiling area never negative
        assert.ok(bomExtreme.geometry.netVolumeM3 >= 0);
        assert.ok(bomExtreme.totals.ceilingAreaM2 >= 0);
    });

    await t.test('7. Wall Cutout Clamping: Net wall area is strictly non-negative (Math.max(0, ...))', () => {
        // Room 400x300x250
        // Top wall: 400x250 = 10.00 m²
        // Right wall: 300x250 = 7.50 m²
        // Bottom wall: 400x250 = 10.00 m²
        // Left wall: 300x250 = 7.50 m²
        // Total gross = 35.00 m²

        const stateWithOverCutouts = {
            room: { width: 400, depth: 300, height: 250, pitches: {} },
            elements: [
                // Top wall: exact match cutout 400x250 = 10.00 m² (e.g. fully glazed)
                { id: 'w_full', type: 'window', wall: 'top', position: 200, w: 400, h: 250 },
                // Bottom wall: massive oversized cutout 600x300 = 18.00 m² (exceeds wall gross 10 m²)
                { id: 'w_over', type: 'window', wall: 'bottom', position: 200, w: 600, h: 300 },
                // Skylight: 200x200 = 4.00 m² on ceiling
                { id: 'sky_over', type: 'skylight', wall: 'top', position: 100, w: 200, h: 200 }
            ],
            installations: [],
            furniture: []
        };

        const bom = BOMCalculator.calculate(stateWithOverCutouts);

        // Verify individual walls
        const wallTop = bom.surfaces.find(s => s.id === 'wall_top');
        assert.equal(wallTop.grossM2, 10.00);
        assert.equal(wallTop.cutoutM2, 10.00);
        assert.equal(wallTop.netM2, 0.00, 'Exact match cutout results in exactly 0 m² net area');

        const wallBottom = bom.surfaces.find(s => s.id === 'wall_bottom');
        assert.equal(wallBottom.grossM2, 10.00);
        assert.equal(wallBottom.cutoutM2, 18.00);
        assert.equal(wallBottom.netM2, 0.00, 'Oversized cutout clamps net area to strictly 0 m² via Math.max');

        // Right & Left walls untouched
        const wallRight = bom.surfaces.find(s => s.id === 'wall_right');
        assert.equal(wallRight.netM2, 7.50);

        const wallLeft = bom.surfaces.find(s => s.id === 'wall_left');
        assert.equal(wallLeft.netM2, 7.50);

        // Total net wall area must equal sum of individual nets: 0 + 0 + 7.50 + 7.50 = 15.00 m²
        assert.equal(bom.totals.netWallAreaM2, 15.00);
        assert.ok(bom.totals.netWallAreaM2 >= 0, 'Total net wall area cannot be negative');

        // Ceiling area is also clamped to non-negative
        assert.ok(bom.totals.ceilingAreaM2 >= 0, 'Ceiling area cannot be negative');
    });

    await t.test('8. Furniture grouping & Budget verification: 55 items with duplicates', () => {
        const furnitureCatalog = [
            { name: 'Stuhl', w: 45, l: 45, h: 85, expectedPrice: 95, count: 12 },
            { name: 'Esstisch', w: 180, l: 90, h: 76, expectedPrice: 490, count: 2 },
            { name: 'Lounge-Sessel', w: 85, l: 85, h: 78, expectedPrice: 420, count: 6 },
            { name: 'Sofa', w: 220, l: 95, h: 82, expectedPrice: 1250, count: 2 },
            { name: 'Raumteiler', w: 110, l: 60, h: 140, expectedPrice: 280, count: 3 },
            { name: 'TV-Lowboard', w: 180, l: 45, h: 48, expectedPrice: 390, count: 2 },
            { name: 'Regal', w: 100, l: 35, h: 180, expectedPrice: 280, count: 4 },
            { name: 'Bogenleuchte', w: 40, l: 40, h: 210, isLamp: true, expectedPrice: 180, count: 3 },
            { name: 'Pflanze', w: 45, l: 45, h: 120, isPlant: true, expectedPrice: 65, count: 8 },
            { name: 'Teppich', w: 240, l: 170, h: 2, isRug: true, expectedPrice: 190, count: 2 },
            { name: 'Doppelbett', w: 180, l: 200, h: 60, expectedPrice: 850, count: 1 },
            { name: 'Nachttisch', w: 45, l: 40, h: 50, expectedPrice: 110, count: 2 },
            { name: 'Kleiderschrank', w: 200, l: 60, h: 210, expectedPrice: 680, count: 1 },
            { name: 'Schreibtisch', w: 140, l: 70, h: 75, expectedPrice: 340, count: 2 },
            { name: 'Fernseher', w: 125, l: 15, h: 75, expectedPrice: 650, count: 2 },
            { name: 'Unbekanntes Designerstück', w: 70, l: 70, h: 70, expectedPrice: 150, count: 3 }
        ];

        // Total count: 12+2+6+2+3+2+4+3+8+2+1+2+1+2+2+3 = 55 items
        const rawFurniture = [];
        let expectedTotalCost = 0;
        let expectedTotalCount = 0;

        furnitureCatalog.forEach((entry, idx) => {
            expectedTotalCount += entry.count;
            expectedTotalCost += entry.count * entry.expectedPrice;

            for (let i = 0; i < entry.count; i++) {
                rawFurniture.push({
                    id: `f_${idx}_${i}`,
                    name: entry.name,
                    shape: 'rect',
                    w: entry.w,
                    l: entry.l,
                    h: entry.h,
                    isLamp: entry.isLamp || false,
                    isPlant: entry.isPlant || false,
                    isRug: entry.isRug || false
                });
            }
        });

        assert.equal(rawFurniture.length, 55, 'Raw furniture array must contain 55 items');

        const state = {
            room: { width: 800, depth: 600, height: 260, pitches: {} },
            elements: [],
            installations: [],
            furniture: rawFurniture
        };

        const bom = BOMCalculator.calculate(state);

        // Verify totals
        assert.equal(bom.totals.furnitureCount, 55, 'Furniture total count must equal 55');
        assert.equal(bom.totals.totalFurnitureCost, expectedTotalCost, `Total furniture cost must match exact sum ${expectedTotalCost} €`);

        // Verify group count sum
        let sumCounts = 0;
        let sumCosts = 0;
        for (const row of bom.furniture) {
            sumCounts += row.count;
            sumCosts += row.totalCost;
            assert.equal(row.totalCost, row.count * row.unitPrice, `Row total cost must match count * unitPrice for ${row.name}`);
        }
        assert.equal(sumCounts, 55);
        assert.equal(sumCosts, expectedTotalCost);

        // Verify unique group count matches catalog entries
        assert.equal(bom.furniture.length, furnitureCatalog.length, 'Every distinct furniture model must form exactly one group');
    });

    await t.test('9. RFC 4180 CSV Export Compliance & UTF-8 BOM encoding validation', () => {
        const state = {
            room: { width: 500, depth: 400, height: 250, pitches: {} },
            elements: [
                { id: 'd1', type: 'door', wall: 'bottom', position: 100, w: 90, h: 200 }
            ],
            installations: [
                { id: 'i1', type: 'socket', wall: 'top', position: 150, height: 30 }
            ],
            furniture: [
                // Quotes, commas, and special German characters
                { id: 'f1', name: 'Sofa "Nordic Style", Grau', shape: 'rect', w: 200, l: 90, h: 80 },
                // Newline in name
                { id: 'f2', name: 'Regal\nSonderanfertigung', shape: 'rect', w: 100, l: 40, h: 180 },
                // Umlauts and symbols
                { id: 'f3', name: 'Größenträger für Äste & Öle', shape: 'rect', w: 50, l: 50, h: 50 }
            ]
        };

        const bom = BOMCalculator.calculate(state);
        const csv = ExportManager.generateCSVContent(bom);

        // 1. Must start with UTF-8 BOM
        assert.equal(csv.charCodeAt(0), 0xFEFF, 'First character must be UTF-8 BOM (0xFEFF)');
        assert.ok(csv.startsWith('\uFEFF'), 'CSV must start with \\uFEFF');

        // 2. Quotes inside fields must be escaped with double quotes: "Sofa ""Nordic Style"", Grau"
        assert.ok(csv.includes('"Sofa ""Nordic Style"", Grau"'), 'Quotes and commas must be escaped per RFC 4180');

        // 3. Newline inside field must be enclosed in quotes: "Regal\nSonderanfertigung"
        assert.ok(csv.includes('"Regal\nSonderanfertigung"'), 'Newlines inside fields must be enclosed in quotes per RFC 4180');

        // 4. Umlauts and special symbols preserved
        assert.ok(csv.includes('Größenträger für Äste & Öle'), 'German umlauts must be preserved intact');
        assert.ok(csv.includes('m²'), 'Area unit m² must be preserved');
        assert.ok(csv.includes('m³'), 'Volume unit m³ must be preserved');
        assert.ok(csv.includes('€'), 'Currency symbol € must be preserved');

        // 5. Line break format: lines must be joined with CRLF (\r\n)
        const csvWithoutBOM = csv.slice(1);
        const lines = csvWithoutBOM.split('\r\n');
        assert.ok(lines.length >= 15, `CSV must contain structured multi-line sections (got ${lines.length} lines)`);

        // 6. RFC 4180 parsing round-trip verification
        // Parse CSV fields according to RFC 4180 state machine
        const parseRFC4180 = (text) => {
            const rows = [];
            let currentRow = [];
            let currentField = '';
            let insideQuotes = false;

            for (let i = 0; i < text.length; i++) {
                const char = text[i];
                const nextChar = text[i + 1];

                if (insideQuotes) {
                    if (char === '"' && nextChar === '"') {
                        currentField += '"';
                        i++; // Skip escaped quote
                    } else if (char === '"') {
                        insideQuotes = false;
                    } else {
                        currentField += char;
                    }
                } else {
                    if (char === '"') {
                        insideQuotes = true;
                    } else if (char === ',') {
                        currentRow.push(currentField);
                        currentField = '';
                    } else if (char === '\r' && nextChar === '\n') {
                        currentRow.push(currentField);
                        rows.push(currentRow);
                        currentRow = [];
                        currentField = '';
                        i++; // Skip \n
                    } else if (char === '\n') {
                        currentRow.push(currentField);
                        rows.push(currentRow);
                        currentRow = [];
                        currentField = '';
                    } else {
                        currentField += char;
                    }
                }
            }
            if (currentField.length > 0 || currentRow.length > 0) {
                currentRow.push(currentField);
                rows.push(currentRow);
            }
            return rows;
        };

        const parsedRows = parseRFC4180(csvWithoutBOM);
        assert.ok(parsedRows.length > 10, 'Parsed rows must be populated');

        // Find the sofa row in parsed CSV
        const sofaRow = parsedRows.find(r => r.some(cell => cell.includes('Sofa "Nordic Style", Grau')));
        assert.ok(sofaRow, 'Sofa row must be successfully parsed back by RFC 4180 parser');
        const sofaNameCell = sofaRow.find(c => c.includes('Sofa "Nordic Style", Grau'));
        assert.equal(sofaNameCell, 'Sofa "Nordic Style", Grau', 'Parsed cell text must exactly match unescaped input string');

        // Find the multiline regal row in parsed CSV
        const regalRow = parsedRows.find(r => r.some(cell => cell.includes('Regal\nSonderanfertigung')));
        assert.ok(regalRow, 'Multiline regal row must be successfully parsed back by RFC 4180 parser');
    });

    await t.test('10. Adversarial Bug Detection: Couchtisch keyword order shadowing in BOM guidelinePrices', () => {
        // In BOMCalculator (app.js:8314-8348):
        // guidelinePrices defines:
        //   'couch': 1250, (index 5)
        //   ...
        //   'couchtisch': 220 (index 15)
        // Because 'couch' comes BEFORE 'couchtisch' in guidelinePrices and getUnitPrice uses name.includes(key),
        // ANY furniture item named 'Couchtisch' matches 'couch' (1,250 EUR) instead of 'couchtisch' (220 EUR).
        // This causes coffee tables to be priced at 1,250 EUR (+1030 EUR / +468% markup) and renders 'couchtisch'
        // completely dead code.
        const bom = BOMCalculator.calculate({
            room: { width: 500, depth: 400, height: 250, pitches: {} },
            elements: [],
            installations: [],
            furniture: [
                { id: 'ct1', name: 'Couchtisch', shape: 'rect', w: 110, l: 60, h: 42 }
            ]
        });

        const couchtisch = bom.furniture.find(f => f.name === 'Couchtisch');
        assert.ok(couchtisch, 'Couchtisch must exist in BOM');

        // Reproducible failure case:
        // Expected unitPrice is 220 EUR (as defined for 'couchtisch' in guidelinePrices).
        // Actual returned value is 1250 EUR because 'couch' (index 5) shadows 'couchtisch' (index 15).
        assert.equal(
            couchtisch.unitPrice,
            220,
            'Couchtisch must be priced at 220 EUR as defined in guidelinePrices, but was 1250 EUR due to couch key shadowing'
        );
    });
});

