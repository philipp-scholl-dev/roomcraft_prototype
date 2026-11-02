const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppInstance } = require('./harness');

test('Milestone 4 Round 2 Adversarial Challenger Empirical Sweep', async (t) => {
    const app = createAppInstance();
    const { SmartSnapping, CollisionEngine, BOMCalculator, ExportManager, State } = app;

    // =========================================================================
    // PART 1: DIVERSE FURNITURE NAMING & BOM PRICING VERIFICATION
    // =========================================================================
    await t.test('Part 1.1: Exact and diverse furniture naming guideline prices', () => {
        const requiredTestCases = [
            { name: 'Couchtisch', expectedPrice: 220 },
            { name: 'Couchtisch-Set', expectedPrice: 220 },
            { name: 'Couch', expectedPrice: 1250 },
            { name: 'Sofa', expectedPrice: 1250 },
            { name: 'Lounge-Sessel', expectedPrice: 420 },
            { name: 'TV-Lowboard', expectedPrice: 390 }, // Critical: contains 'tv' (650), must match tv-lowboard (390)
            { name: 'Esstisch', expectedPrice: 490 },
            { name: 'Schreibtisch', expectedPrice: 340 }
        ];

        const furnitureItems = requiredTestCases.map((tc, idx) => ({
            id: `f_req_${idx}`,
            name: tc.name,
            w: 100,
            l: 60,
            h: 75
        }));

        const state = {
            room: { width: 800, depth: 600, height: 260, pitches: {} },
            elements: [],
            installations: [],
            furniture: furnitureItems
        };

        const bom = BOMCalculator.calculate(state);

        for (const tc of requiredTestCases) {
            const entry = bom.furniture.find(f => f.name === tc.name);
            assert.ok(entry, `Entry for ${tc.name} must exist in BOM`);
            assert.equal(
                entry.unitPrice,
                tc.expectedPrice,
                `Unit price for '${tc.name}' must be ${tc.expectedPrice} EUR, but got ${entry.unitPrice} EUR`
            );
        }
    });

    await t.test('Part 1.2: Adversarial substring precedence & compound naming matrix', () => {
        const extendedCases = [
            // Substring shadowing checks
            { name: 'couchtisch', expected: 220 },
            { name: 'COUCHTISCH', expected: 220 },
            { name: 'Couchtisch Modern Glas', expected: 220 },
            { name: 'Kleiner Couchtisch', expected: 220 },
            { name: 'Couchtisch 2er-Set', expected: 220 },
            { name: 'couch', expected: 1250 },
            { name: 'COUCH', expected: 1250 },
            { name: 'Designer Couch 3-Sitzer', expected: 1250 },
            { name: 'Eckcouch mit Bettfunktion', expected: 1250 },
            { name: 'Sofa', expected: 1250 },
            { name: 'Wohnzimmer-Sofa', expected: 1250 },

            // TV vs TV-Lowboard shadowing checks: 'tv-lowboard' (390) vs 'tv' (650)
            { name: 'TV-Lowboard', expected: 390 },
            { name: 'tv-lowboard', expected: 390 },
            { name: 'Modernes TV-Lowboard 180cm', expected: 390 },
            { name: 'Lowboard', expected: 390 },
            { name: 'Sideboard / Lowboard', expected: 390 },
            { name: 'TV', expected: 650 },
            { name: 'Smart TV 65 Zoll', expected: 650 },
            { name: 'Fernseher', expected: 650 },
            { name: 'OLED Fernseher', expected: 650 },

            // Tisch variations
            { name: 'Esstisch', expected: 490 },
            { name: 'Großer Esstisch Eiche massiv', expected: 490 },
            { name: 'Schreibtisch', expected: 340 },
            { name: 'Büro-Schreibtisch höhenverstellbar', expected: 340 },
            { name: 'Nachttisch', expected: 110 },
            { name: 'Nachttisch Weiß', expected: 110 },

            // Sessel variations: 'lounge-sessel' (420) vs 'sessel' (420)
            { name: 'Lounge-Sessel', expected: 420 },
            { name: 'Leder-Sessel', expected: 420 },
            { name: 'Ohrensessel', expected: 420 },

            // Bed and Wardrobe variations
            { name: 'Doppelbett', expected: 850 },
            { name: 'Boxspring-Doppelbett', expected: 850 },
            { name: 'Bett 140x200', expected: 850 },
            { name: 'Kleiderschrank', expected: 680 },
            { name: 'Schrank mit Schiebetüren', expected: 680 },

            // Lighting, plants, shelves, fallback
            { name: 'Bogenleuchte', expected: 180 },
            { name: 'Stehlampe', expected: 180 },
            { name: 'Deckenleuchte', expected: 180 },
            { name: 'Zimmerpflanze Monstera', expected: 65 },
            { name: 'Pflanze', expected: 65 },
            { name: 'Wandregal', expected: 280 },
            { name: 'Raumteiler Regal', expected: 280 },
            { name: 'Wollteppich', expected: 190 },
            { name: 'Esszimmerstuhl', expected: 95 },
            { name: 'Völlig unbekanntes Kunstobjekt', expected: 150 } // fallback
        ];

        for (const item of extendedCases) {
            const state = {
                room: { width: 500, depth: 400, height: 250, pitches: {} },
                elements: [],
                installations: [],
                furniture: [{ name: item.name, w: 80, l: 80, h: 50 }]
            };
            const bom = BOMCalculator.calculate(state);
            assert.equal(bom.furniture.length, 1);
            assert.equal(
                bom.furniture[0].unitPrice,
                item.expected,
                `Item '${item.name}' should price at ${item.expected} EUR, got ${bom.furniture[0].unitPrice} EUR`
            );
        }
    });

    // =========================================================================
    // PART 2: 1,000 SMART SNAPPING ITERATIONS WITH ARBITRARY ANGLES
    // =========================================================================
    await t.test('Part 2: 1,000 Smart Snapping & Boundary Clamping iterations under arbitrary angles', () => {
        const rooms = [
            { width: 300, depth: 300 },
            { width: 450, depth: 350 },
            { width: 600, depth: 500 },
            { width: 850, depth: 700 },
            { width: 1200, depth: 950 }
        ];

        // Seeded pseudo-random generator for 100% reproducible adversarial test runs
        let seed = 42;
        function pseudoRandom() {
            seed = (seed * 1664525 + 1013904223) % 4294967296;
            return seed / 4294967296;
        }

        let totalIterations = 0;
        let snapCountX = 0;
        let snapCountY = 0;
        let wallClampingCount = 0;

        const TOTAL_TARGET_ITERATIONS = 1000;

        for (let iter = 0; iter < TOTAL_TARGET_ITERATIONS; iter++) {
            totalIterations++;

            // Select room
            const room = rooms[iter % rooms.length];

            // Arbitrary dimensions: width in [25, 140], length in [25, 140]
            const w = 25 + Math.floor(pseudoRandom() * 115);
            const l = 25 + Math.floor(pseudoRandom() * 115);
            const shape = pseudoRandom() < 0.25 ? 'circle' : 'rect';

            // Arbitrary rotation: full 360-degree float range plus negative and multi-turn angles (-360 to +720)
            const rotation = (pseudoRandom() * 1080) - 360;

            const dummyItem = { id: `drag_${iter}`, shape, w, l, rotation };
            const ext = SmartSnapping.getExtents(dummyItem);

            // Mathematical verification of getExtents
            if (shape === 'circle') {
                assert.equal(ext.halfSpanX, w / 2);
                assert.equal(ext.halfSpanY, w / 2);
            } else {
                const rotRad = (rotation * Math.PI) / 180;
                const expectedHalfX = (w / 2) * Math.abs(Math.cos(rotRad)) + (l / 2) * Math.abs(Math.sin(rotRad));
                const expectedHalfY = (w / 2) * Math.abs(Math.sin(rotRad)) + (l / 2) * Math.abs(Math.cos(rotRad));
                assert.ok(
                    Math.abs(ext.halfSpanX - expectedHalfX) < 1e-9,
                    `getExtents halfSpanX mismatch at rot=${rotation}`
                );
                assert.ok(
                    Math.abs(ext.halfSpanY - expectedHalfY) < 1e-9,
                    `getExtents halfSpanY mismatch at rot=${rotation}`
                );
            }

            // Sibling obstacle inside room
            const siblings = [
                {
                    id: 'sib_center',
                    name: 'Sibling-Center',
                    shape: 'rect',
                    w: 70,
                    l: 70,
                    x: room.width / 2,
                    y: room.depth / 2,
                    rotation: 0
                }
            ];

            // Compute valid interior bounds for placing item
            const minInteriorX = ext.halfSpanX + 0.1;
            const maxInteriorX = room.width - ext.halfSpanX - 0.1;
            const minInteriorY = ext.halfSpanY + 0.1;
            const maxInteriorY = room.depth - ext.halfSpanY - 0.1;

            if (minInteriorX >= maxInteriorX || minInteriorY >= maxInteriorY) {
                // Item does not fit within room with margins, continue to next iteration
                continue;
            }

            let testX, testY;
            const mode = iter % 7;
            if (mode === 0) {
                // Near left wall (within snap threshold 10cm)
                testX = Math.min(maxInteriorX, minInteriorX + (pseudoRandom() * 9.0));
                testY = minInteriorY + pseudoRandom() * (maxInteriorY - minInteriorY);
            } else if (mode === 1) {
                // Near right wall (within snap threshold 10cm)
                testX = Math.max(minInteriorX, maxInteriorX - (pseudoRandom() * 9.0));
                testY = minInteriorY + pseudoRandom() * (maxInteriorY - minInteriorY);
            } else if (mode === 2) {
                // Near top wall (within snap threshold 10cm)
                testX = minInteriorX + pseudoRandom() * (maxInteriorX - minInteriorX);
                testY = Math.min(maxInteriorY, minInteriorY + (pseudoRandom() * 9.0));
            } else if (mode === 3) {
                // Near bottom wall (within snap threshold 10cm)
                testX = minInteriorX + pseudoRandom() * (maxInteriorX - minInteriorX);
                testY = Math.max(minInteriorY, maxInteriorY - (pseudoRandom() * 9.0));
            } else if (mode === 4) {
                // Near room center
                const candX = (room.width / 2) + (pseudoRandom() * 16 - 8);
                const candY = (room.depth / 2) + (pseudoRandom() * 16 - 8);
                testX = Math.max(minInteriorX, Math.min(maxInteriorX, candX));
                testY = Math.max(minInteriorY, Math.min(maxInteriorY, candY));
            } else if (mode === 5) {
                // Near sibling edge (if it fits within interior bounds)
                const sibExt = SmartSnapping.getExtents(siblings[0]);
                const candRight = siblings[0].x + sibExt.halfSpanX + ext.halfSpanX + (pseudoRandom() * 9.0);
                const candLeft = siblings[0].x - sibExt.halfSpanX - ext.halfSpanX - (pseudoRandom() * 9.0);
                if (candRight <= maxInteriorX && candRight >= minInteriorX) {
                    testX = candRight;
                } else if (candLeft >= minInteriorX && candLeft <= maxInteriorX) {
                    testX = candLeft;
                } else {
                    testX = minInteriorX + pseudoRandom() * (maxInteriorX - minInteriorX);
                }
                testY = Math.max(minInteriorY, Math.min(maxInteriorY, siblings[0].y));
            } else {
                // Completely random interior position
                testX = minInteriorX + pseudoRandom() * (maxInteriorX - minInteriorX);
                testY = minInteriorY + pseudoRandom() * (maxInteriorY - minInteriorY);
            }

            const itemToTest = {
                id: `drag_${iter}`,
                name: `Item_${iter}`,
                shape,
                w,
                l,
                x: testX,
                y: testY,
                rotation
            };

            // Initial placement MUST be valid inside the room
            const initialCollision = CollisionEngine.checkWallCollision(itemToTest, room);
            assert.equal(
                initialCollision,
                false,
                `Iteration ${iter}: Generated test position must be inside room before snap: x=${testX}, y=${testY}, rot=${rotation.toFixed(2)}°`
            );

            // Execute computeSnap
            const snap = SmartSnapping.computeSnap(itemToTest, siblings, room, 10);

            // Invariant 1: Structural validity & finite numbers
            assert.ok(snap && typeof snap === 'object', `Iteration ${iter}: snap must be object`);
            assert.ok(Number.isFinite(snap.snappedX), `Iteration ${iter}: snappedX must be finite`);
            assert.ok(Number.isFinite(snap.snappedY), `Iteration ${iter}: snappedY must be finite`);
            assert.ok(Array.isArray(snap.guides), `Iteration ${iter}: guides must be array`);
            assert.ok(typeof snap.snappedAxes.x === 'boolean', `Iteration ${iter}: snappedAxes.x must be boolean`);
            assert.ok(typeof snap.snappedAxes.y === 'boolean', `Iteration ${iter}: snappedAxes.y must be boolean`);

            if (snap.snappedAxes.x) snapCountX++;
            if (snap.snappedAxes.y) snapCountY++;

            // Invariant 2: Guide validity
            for (const g of snap.guides) {
                assert.ok(Number.isFinite(g.x1) && Number.isFinite(g.y1) && Number.isFinite(g.x2) && Number.isFinite(g.y2));
                assert.ok(g.axis === 'x' || g.axis === 'y');
                assert.ok(typeof g.label === 'string' && g.label.length > 0);
                assert.ok(['room-center', 'wall', 'furniture-center', 'furniture-edge'].includes(g.type));
            }

            // Invariant 3: Clamping and boundary safety
            const snappedCandidate = { ...itemToTest, x: snap.snappedX, y: snap.snappedY };
            const wallCollision = CollisionEngine.checkWallCollision(snappedCandidate, room);
            assert.equal(
                wallCollision,
                false,
                `Iteration ${iter}: Snapping created false wall collision! rot=${rotation.toFixed(2)}°, shape=${shape}, x=${snap.snappedX}, y=${snap.snappedY}, extX=${ext.halfSpanX}, roomW=${room.width}`
            );

            // Invariant 4: Editor2D integration test: CollisionEngine.clampFurnitureToRoom
            const finalItem = { ...snappedCandidate };
            const didClamp = CollisionEngine.clampFurnitureToRoom(finalItem, room);
            if (didClamp) wallClampingCount++;

            // After clamping, checkWallCollision must ALWAYS be strictly false
            const clampedWallColl = CollisionEngine.checkWallCollision(finalItem, room);
            assert.equal(
                clampedWallColl,
                false,
                `Iteration ${iter}: Clamped item must never collide with wall! rot=${rotation.toFixed(2)}°`
            );
        }

        assert.ok(totalIterations >= 1000, `Must execute at least 1,000 iterations (ran ${totalIterations})`);
        assert.ok(snapCountX > 200, `Must achieve significant X snaps (achieved ${snapCountX}/${totalIterations})`);
        assert.ok(snapCountY > 200, `Must achieve significant Y snaps (achieved ${snapCountY}/${totalIterations})`);
    });

    // =========================================================================
    // PART 3: CORNER CASES & EXTREME BOUNDARY CONDITIONS
    // =========================================================================
    await t.test('Part 3: Extreme boundary conditions & rotation limits', () => {
        const room = { width: 500, depth: 400 };

        // Test extreme rotation angles (large numbers, precision)
        const extremeAngles = [36000, -72000, 0.0001, 89.9999, 180.0001, -359.9999];
        for (const angle of extremeAngles) {
            const item = { id: 'ext', name: 'Tisch', shape: 'rect', w: 100, l: 60, x: 250, y: 200, rotation: angle };
            const ext = SmartSnapping.getExtents(item);
            assert.ok(Number.isFinite(ext.halfSpanX));
            assert.ok(Number.isFinite(ext.halfSpanY));
            const snap = SmartSnapping.computeSnap(item, [], room, 10);
            assert.ok(Number.isFinite(snap.snappedX));
            assert.ok(Number.isFinite(snap.snappedY));
        }

        // Test furniture with missing attributes (defaults resilience)
        const partialItem = { x: 100, y: 100 };
        const extPartial = SmartSnapping.getExtents(partialItem);
        assert.equal(extPartial.halfSpanX, 0);
        assert.equal(extPartial.halfSpanY, 0);

        const snapPartial = SmartSnapping.computeSnap(partialItem, [], room, 10);
        assert.equal(snapPartial.snappedX, 100);
        assert.equal(snapPartial.snappedY, 100);

        // Test null/undefined resilience
        const snapNull = SmartSnapping.computeSnap(null, [], room, 10);
        assert.equal(snapNull.snappedX, 0);
        assert.equal(snapNull.snappedY, 0);
    });
});
