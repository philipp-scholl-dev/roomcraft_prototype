const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createAppInstance } = require('../harness');

describe('Math & Physics Engine (Unit Tests)', () => {

    describe('Vector2D geometry', () => {
        test('Vector2D initialization and rotation invariants', () => {
            const { Vector2D } = createAppInstance();
            const v = new Vector2D(100, 0);

            // 0 degree rotation
            const v0 = v.rotate(0);
            assert.equal(Math.round(v0.x), 100);
            assert.equal(Math.round(v0.y), 0);

            // 90 degree counter-clockwise rotation
            const v90 = v.rotate(Math.PI / 2);
            assert.equal(Math.round(v90.x), 0);
            assert.equal(Math.round(v90.y), 100);

            // 180 degree rotation
            const v180 = v.rotate(Math.PI);
            assert.equal(Math.round(v180.x), -100);
            assert.equal(Math.round(v180.y), 0);

            // 360 degree rotation
            const v360 = v.rotate(2 * Math.PI);
            assert.equal(Math.round(v360.x), 100);
            assert.equal(Math.abs(v360.y) < 1e-9 ? 0 : v360.y, 0);
        });

        test('getFurnitureCorners computes unrotated and rotated OBB vertices correctly', () => {
            const { getFurnitureCorners } = createAppInstance();

            const rectUnrotated = {
                shape: 'rect',
                x: 200,
                y: 150,
                w: 100,
                l: 60,
                rotation: 0
            };
            const corners0 = getFurnitureCorners(rectUnrotated);
            assert.equal(corners0.length, 4);
            // Top-left (-50, -30) -> (150, 120)
            assert.equal(Math.round(corners0[0].x), 150);
            assert.equal(Math.round(corners0[0].y), 120);
            // Top-right (50, -30) -> (250, 120)
            assert.equal(Math.round(corners0[1].x), 250);
            assert.equal(Math.round(corners0[1].y), 120);
            // Bottom-right (50, 30) -> (250, 180)
            assert.equal(Math.round(corners0[2].x), 250);
            assert.equal(Math.round(corners0[2].y), 180);
            // Bottom-left (-50, 30) -> (150, 180)
            assert.equal(Math.round(corners0[3].x), 150);
            assert.equal(Math.round(corners0[3].y), 180);

            // Rotated 90 degrees: w and l swap axes
            const rectRot90 = { ...rectUnrotated, rotation: 90 };
            const corners90 = getFurnitureCorners(rectRot90);
            assert.equal(corners90.length, 4);
            // Center is still (200, 150)
            const avgX = (corners90[0].x + corners90[1].x + corners90[2].x + corners90[3].x) / 4;
            const avgY = (corners90[0].y + corners90[1].y + corners90[2].y + corners90[3].y) / 4;
            assert.equal(Math.round(avgX), 200);
            assert.equal(Math.round(avgY), 150);

            // Shape 'circle' has no polygon corners
            const circleItem = { shape: 'circle', x: 100, y: 100, w: 80, l: 80, rotation: 0 };
            const circleCorners = getFurnitureCorners(circleItem);
            assert.equal(circleCorners.length, 0);
        });
    });

    describe('SAT Collision Detection (OBB vs OBB)', () => {
        test('Separated bounding boxes report no collision', () => {
            const { CollisionEngine, getFurnitureCorners } = createAppInstance();

            const boxA = { shape: 'rect', x: 100, y: 100, w: 60, l: 60, rotation: 0 };
            const boxB = { shape: 'rect', x: 250, y: 100, w: 60, l: 60, rotation: 0 };

            const hit = CollisionEngine.checkOBBvsOBB(getFurnitureCorners(boxA), getFurnitureCorners(boxB));
            assert.equal(hit, false);
        });

        test('Directly overlapping bounding boxes report collision', () => {
            const { CollisionEngine, getFurnitureCorners } = createAppInstance();

            const boxA = { shape: 'rect', x: 100, y: 100, w: 80, l: 80, rotation: 0 };
            const boxB = { shape: 'rect', x: 120, y: 110, w: 80, l: 80, rotation: 0 };

            const hit = CollisionEngine.checkOBBvsOBB(getFurnitureCorners(boxA), getFurnitureCorners(boxB));
            assert.equal(hit, true);
        });

        test('Rotation-dependent SAT separating axis resolution', () => {
            const { CollisionEngine, getFurnitureCorners } = createAppInstance();

            // Two long thin boxes side-by-side that do not overlap when unrotated
            const boxA = { shape: 'rect', x: 100, y: 100, w: 30, l: 120, rotation: 0 };
            const boxB = { shape: 'rect', x: 150, y: 100, w: 30, l: 120, rotation: 0 };

            assert.equal(CollisionEngine.checkOBBvsOBB(getFurnitureCorners(boxA), getFurnitureCorners(boxB)), false);

            // When box A is rotated 45 degrees, its corners reach into box B
            const boxARotated = { ...boxA, rotation: 45 };
            assert.equal(CollisionEngine.checkOBBvsOBB(getFurnitureCorners(boxARotated), getFurnitureCorners(boxB)), true);
        });
    });

    describe('Circle & Hybrid Collision (Circle vs Circle / Circle vs OBB)', () => {
        test('Circle vs Circle distance thresholding', () => {
            const { CollisionEngine } = createAppInstance();

            // Centers at (100, 100) and (150, 100), radii 30 and 30 (sum = 60 > dist 50) => overlap
            const hitOverlap = CollisionEngine.checkCircleVsCircle({ x: 100, y: 100 }, 30, { x: 150, y: 100 }, 30);
            assert.equal(hitOverlap, true);

            // Distance 70 > sum 60 => no overlap
            const hitSeparate = CollisionEngine.checkCircleVsCircle({ x: 100, y: 100 }, 30, { x: 170, y: 100 }, 30);
            assert.equal(hitSeparate, false);
        });

        test('Circle vs OBB detection with rotation', () => {
            const { CollisionEngine } = createAppInstance();

            const circleCenter = { x: 100, y: 50 };
            const radius = 25;
            const rectCenter = { x: 100, y: 100 };
            const w = 60;
            const l = 60;

            // Unrotated rect: top edge at y = 100 - 30 = 70. Circle bottom at 50 + 25 = 75 => overlap
            const hit = CollisionEngine.checkCircleVsOBB(circleCenter, radius, rectCenter, w, l, 0);
            assert.equal(hit, true);

            // Circle further away at y = 30 (circle bottom at 55 < 70) => no overlap
            const miss = CollisionEngine.checkCircleVsOBB({ x: 100, y: 30 }, radius, rectCenter, w, l, 0);
            assert.equal(miss, false);
        });
    });

    describe('checkFurnitureCollision Rules (Elevation, TV, Rugs)', () => {
        test('Furniture vertical elevation clearance prevents collision', () => {
            const { CollisionEngine } = createAppInstance();

            // Table on floor: elev 0, height 75
            const table = {
                name: 'Table',
                shape: 'rect',
                x: 200,
                y: 200,
                w: 120,
                l: 80,
                h: 75,
                elevation: 0,
                rotation: 0
            };

            // Hanging wall cabinet above table: elev 140, height 50
            const cabinet = {
                name: 'Cabinet',
                shape: 'rect',
                x: 200,
                y: 200,
                w: 120,
                l: 80,
                h: 50,
                elevation: 140,
                rotation: 0
            };

            assert.equal(CollisionEngine.checkFurnitureCollision(table, cabinet), false);

            // If cabinet hangs lower (elev 70, so bottom 70 < table top 75) => collision
            const lowCabinet = { ...cabinet, elevation: 70 };
            assert.equal(CollisionEngine.checkFurnitureCollision(table, lowCabinet), true);
        });

        test('TV items and rugs are exempt from furniture collision', () => {
            const { CollisionEngine } = createAppInstance();

            const desk = {
                name: 'Desk',
                shape: 'rect',
                x: 200,
                y: 200,
                w: 140,
                l: 80,
                h: 76,
                elevation: 0,
                rotation: 0
            };

            const tv = {
                name: 'Fernseher (TV)',
                shape: 'rect',
                x: 200,
                y: 200,
                w: 120,
                l: 15,
                h: 78,
                tvSize: 55,
                elevation: 76,
                rotation: 0
            };

            const rug = {
                name: 'Teppich',
                shape: 'rect',
                x: 200,
                y: 200,
                w: 200,
                l: 150,
                h: 2,
                isRug: true,
                elevation: 0,
                rotation: 0
            };

            // TV on desk
            assert.equal(CollisionEngine.checkFurnitureCollision(desk, tv), false);
            // Rug under desk
            assert.equal(CollisionEngine.checkFurnitureCollision(desk, rug), false);
        });
    });

    describe('Ceiling Height & Roof Pitch Geometry', () => {
        test('getCeilingHeightAt calculates linear slope and kniestock boundary', () => {
            const app = createAppInstance();
            app.State.room.width = 500;
            app.State.room.depth = 400;
            app.State.room.height = 250;
            app.State.room.pitches.top = { enabled: true, kniestock: 80, run: 160 };
            app.State.room.pitches.bottom = { enabled: false, kniestock: 80, run: 150 };
            app.State.room.pitches.left = { enabled: false, kniestock: 80, run: 150 };
            app.State.room.pitches.right = { enabled: false, kniestock: 80, run: 150 };

            // At y = 0 (against top wall): height is kniestock = 80cm
            const hAt0 = app.getCeilingHeightAt(250, 0);
            assert.equal(Math.round(hAt0), 80);

            // At y = 80 (halfway through the run of 160cm):
            // height = 80 + (250 - 80) * (80 / 160) = 80 + 85 = 165cm
            const hMid = app.getCeilingHeightAt(250, 80);
            assert.equal(Math.round(hMid), 165);

            // At y = 160 (end of slant run): full room height = 250cm
            const hRunEnd = app.getCeilingHeightAt(250, 160);
            assert.equal(Math.round(hRunEnd), 250);

            // At y = 250 (flat part of the room): full room height = 250cm
            const hFlat = app.getCeilingHeightAt(250, 250);
            assert.equal(Math.round(hFlat), 250);
        });

        test('checkRoofPitchCollision flags tall furniture under steep pitch', () => {
            const app = createAppInstance();
            app.State.room.width = 500;
            app.State.room.depth = 400;
            app.State.room.height = 250;
            app.State.room.pitches.top = { enabled: true, kniestock: 80, run: 160 };

            // Wardrobe (height 210cm) placed close to top wall (y = 50):
            // At y = 50, ceiling is ~80 + 170*(50/160) = 133cm.
            // Wardrobe 210cm exceeds 133cm -> collision!
            const wardrobe = {
                name: 'Wardrobe',
                shape: 'rect',
                x: 250,
                y: 50,
                w: 150,
                l: 60,
                h: 210,
                elevation: 0,
                rotation: 0
            };
            assert.equal(app.CollisionEngine.checkRoofPitchCollision(wardrobe), true);

            // Low nightstand (height 45cm) placed in same spot:
            // 45cm < 133cm -> NO collision!
            const nightstand = {
                name: 'Nightstand',
                shape: 'rect',
                x: 250,
                y: 50,
                w: 50,
                l: 40,
                h: 45,
                elevation: 0,
                rotation: 0
            };
            assert.equal(app.CollisionEngine.checkRoofPitchCollision(nightstand), false);
        });
    });
});

require('./textures_surfaces.test.js');

