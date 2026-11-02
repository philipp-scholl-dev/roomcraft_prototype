const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createAppInstance } = require('../harness');

describe('Milestone 1 — Roof Pitch Collision & Testing Bridge (Feature 4)', () => {
    let app;

    beforeEach(() => {
        app = createAppInstance();
        // Standard baseline room: 500 x 400 cm, 250 cm height
        app.State.room.width = 500;
        app.State.room.depth = 400;
        app.State.room.height = 250;
        app.State.room.pitches = {
            top: { enabled: false, kniestock: 80, run: 150 },
            bottom: { enabled: false, kniestock: 80, run: 150 },
            left: { enabled: false, kniestock: 80, run: 150 },
            right: { enabled: false, kniestock: 80, run: 150 }
        };
        app.State.furniture = [];
        app.State.settings.collisionEnabled = true;
    });

    describe('Ceiling Height Calculations (getCeilingHeightAt)', () => {
        test('Flat room returns uniform room height everywhere', () => {
            assert.equal(app.getCeilingHeightAt(0, 0), 250);
            assert.equal(app.getCeilingHeightAt(250, 200), 250);
            assert.equal(app.getCeilingHeightAt(500, 400), 250);
        });

        test('Top pitch calculates exact linear slope from kniestock to full height', () => {
            app.State.room.pitches.top = { enabled: true, kniestock: 80, run: 160 };
            // At wall (y = 0): kniestock = 80
            assert.equal(Math.round(app.getCeilingHeightAt(250, 0)), 80);
            // At quarter run (y = 40): 80 + 170 * (40/160) = 122.5
            assert.equal(Math.round(app.getCeilingHeightAt(250, 40)), 123);
            // At half run (y = 80): 80 + 170 * (80/160) = 165
            assert.equal(Math.round(app.getCeilingHeightAt(250, 80)), 165);
            // At end of run (y = 160): full height = 250
            assert.equal(Math.round(app.getCeilingHeightAt(250, 160)), 250);
            // Beyond run (y = 200): full height = 250
            assert.equal(Math.round(app.getCeilingHeightAt(250, 200)), 250);
        });

        test('Intersecting pitches (Top + Left) return lower ceiling envelope', () => {
            app.State.room.pitches.top = { enabled: true, kniestock: 80, run: 150 };
            app.State.room.pitches.left = { enabled: true, kniestock: 100, run: 200 };

            // In corner (x = 50, y = 50):
            // Top pitch gives: 80 + (250 - 80) * (50/150) = 136.67
            // Left pitch gives: 100 + (250 - 100) * (50/200) = 137.5
            // getCeilingHeightAt should select the minimum (136.67)
            const h = app.getCeilingHeightAt(50, 50);
            assert.equal(Math.round(h), 137);
        });
    });

    describe('Rectangular Furniture Collision (checkRoofPitchCollision)', () => {
        test('Low furniture under pitch fits without collision', () => {
            app.State.room.pitches.top = { enabled: true, kniestock: 80, run: 150 };
            const bed = {
                shape: 'rect',
                x: 250,
                y: 50,
                w: 180,
                l: 200,
                h: 60,
                elevation: 0,
                rotation: 0
            };
            assert.equal(app.CollisionEngine.checkRoofPitchCollision(bed), false);
        });

        test('Tall wardrobe under pitch triggers collision', () => {
            app.State.room.pitches.top = { enabled: true, kniestock: 80, run: 150 };
            // Wardrobe height 210cm at y = 50 (local ceiling ~137cm)
            const wardrobe = {
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
        });

        test('Tall wardrobe placed in room center clear of pitch reports no collision', () => {
            app.State.room.pitches.top = { enabled: true, kniestock: 80, run: 150 };
            const wardrobe = {
                shape: 'rect',
                x: 250,
                y: 250,
                w: 150,
                l: 60,
                h: 210,
                elevation: 0,
                rotation: 0
            };
            assert.equal(app.CollisionEngine.checkRoofPitchCollision(wardrobe), false);
        });

        test('Rotated furniture corners extending into pitch zone are detected', () => {
            app.State.room.pitches.top = { enabled: true, kniestock: 80, run: 150 };
            // Long item (w = 200, l = 40, h = 180) at y = 140
            // When unrotated (rotation 0): y range is [120, 160], at y = 120 ceil is 80+170*(120/150) = 216 > 180 -> fits
            const itemUnrotated = { shape: 'rect', x: 250, y: 140, w: 200, l: 40, h: 180, rotation: 0 };
            assert.equal(app.CollisionEngine.checkRoofPitchCollision(itemUnrotated), false);

            // When rotated 90 degrees: y range becomes [40, 240], corner reaches y = 40 (ceil is ~125cm < 180cm) -> collides!
            const itemRotated = { ...itemUnrotated, rotation: 90 };
            assert.equal(app.CollisionEngine.checkRoofPitchCollision(itemRotated), true);
        });

        test('Vertical elevation correctly adds to height in pitch collision', () => {
            app.State.room.pitches.top = { enabled: true, kniestock: 80, run: 150 };
            // Low shelf (h = 50) on floor at y = 60: totalHeight = 50 < ceil (148) -> false
            const shelfFloor = { shape: 'rect', x: 250, y: 60, w: 100, l: 40, h: 50, elevation: 0, rotation: 0 };
            assert.equal(app.CollisionEngine.checkRoofPitchCollision(shelfFloor), false);

            // Wall-mounted shelf with elevation = 110: totalHeight = 160 > ceil (148) -> true!
            const shelfMounted = { ...shelfFloor, elevation: 110 };
            assert.equal(app.CollisionEngine.checkRoofPitchCollision(shelfMounted), true);
        });

        test('Defensively handles f.height property without resulting in NaN', () => {
            app.State.room.pitches.top = { enabled: true, kniestock: 80, run: 150 };
            const itemWithHeightProp = {
                shape: 'rect',
                x: 250,
                y: 50,
                w: 100,
                l: 60,
                height: 210, // 'height' instead of 'h'
                rotation: 0
            };
            assert.equal(app.CollisionEngine.checkRoofPitchCollision(itemWithHeightProp), true);
        });

        test('Exempts obstacles (columns/chimneys) and rugs from pitch collision', () => {
            app.State.room.pitches.top = { enabled: true, kniestock: 0, run: 150 };
            const chimney = { shape: 'rect', x: 250, y: 10, w: 50, l: 50, h: 250, isObstacle: true };
            const rug = { shape: 'rect', x: 250, y: 10, w: 120, l: 80, h: 2, isRug: true };

            assert.equal(app.CollisionEngine.checkRoofPitchCollision(chimney), false);
            assert.equal(app.CollisionEngine.checkRoofPitchCollision(rug), false);
        });
    });

    describe('Circular Furniture Collision & Diagonal Coverage', () => {
        test('Low circular coffee table fits under pitch', () => {
            app.State.room.pitches.top = { enabled: true, kniestock: 80, run: 150 };
            const roundTable = { shape: 'circle', x: 250, y: 60, w: 80, h: 45, rotation: 0 };
            assert.equal(app.CollisionEngine.checkRoofPitchCollision(roundTable), false);
        });

        test('Tall circular lamp under pitch triggers collision', () => {
            app.State.room.pitches.top = { enabled: true, kniestock: 80, run: 150 };
            const floorLamp = { shape: 'circle', x: 250, y: 60, w: 50, h: 180, rotation: 0 };
            assert.equal(app.CollisionEngine.checkRoofPitchCollision(floorLamp), true);
        });

        test('Diagonal perimeter points catch partial pitch penetration', () => {
            // Partial pitch active only from x = 100 to x = 300
            app.State.room.pitches.top = { enabled: true, kniestock: 80, run: 150, start: 100, end: 300 };
            // Circle centered at (75, 50) with radius 40 and height 130
            // Cardinal points miss low ceiling, but 45-degree diagonal point penetrates eaves
            const circle = { shape: 'circle', x: 75, y: 50, w: 80, h: 130, rotation: 0 };
            assert.equal(app.CollisionEngine.checkRoofPitchCollision(circle), true);
        });
    });

    describe('updateAllCollisions() State Integration', () => {
        test('updateAllCollisions flags colliding furniture in State without DOM error', () => {
            app.State.room.pitches.top = { enabled: true, kniestock: 80, run: 150 };
            const f1 = { id: 'f1', name: 'Wardrobe', shape: 'rect', x: 250, y: 40, w: 100, l: 60, h: 210, collisionEnabled: true, isColliding: false };
            const f2 = { id: 'f2', name: 'Bed', shape: 'rect', x: 250, y: 250, w: 180, l: 200, h: 60, collisionEnabled: true, isColliding: false };
            app.State.furniture = [f1, f2];

            const hasCollision = app.CollisionEngine.updateAllCollisions();
            assert.equal(hasCollision, true);
            assert.equal(f1.isColliding, true);
            assert.equal(f2.isColliding, false);
        });
    });
});
