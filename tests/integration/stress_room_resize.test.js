const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createAppInstance } = require('../harness');

describe('Empirical Challenger: Dynamic Room Resizing Stress Suite', () => {
    let app;

    beforeEach(() => {
        app = createAppInstance();
        app.State.room.width = 800;
        app.State.room.depth = 800;
        app.State.room.height = 250;
        app.State.furniture = [];
        app.State.elements = [];
        app.State.installations = [];
        app.State.settings.collisionEnabled = true;
    });

    describe('Dynamic Room Resizing: 800x800 down to 200x200 with 20 placed furniture items', () => {
        test('Every single item of 20 diverse items is clamped within new 200x200 boundaries', () => {
            const items = [
                { id: 'f1', name: 'Desk', shape: 'rect', x: 750, y: 750, w: 140, l: 70, h: 75, rotation: 0 },
                { id: 'f2', name: 'Bed Single', shape: 'rect', x: 700, y: 700, w: 100, l: 200, h: 50, rotation: 90 },
                { id: 'f3', name: 'Round Table', shape: 'circle', x: 740, y: 740, w: 100, l: 100, h: 75, rotation: 0 },
                { id: 'f4', name: 'Wardrobe', shape: 'rect', x: 750, y: 300, w: 120, l: 60, h: 200, rotation: 45 },
                { id: 'f5', name: 'Shelf', shape: 'rect', x: 300, y: 750, w: 100, l: 35, h: 180, rotation: 30 },
                { id: 'f6', name: 'Armchair', shape: 'rect', x: 650, y: 650, w: 85, l: 85, h: 80, rotation: 15 },
                { id: 'f7', name: 'Nightstand', shape: 'rect', x: 780, y: 100, w: 45, l: 40, h: 50, rotation: 0 },
                { id: 'f8', name: 'TV Unit', shape: 'rect', x: 100, y: 780, w: 150, l: 45, h: 50, rotation: 60 },
                { id: 'f9', name: 'Small Table', shape: 'circle', x: 760, y: 500, w: 60, l: 60, h: 45, rotation: 0 },
                { id: 'f10', name: 'Plant', shape: 'rect', x: 780, y: 780, w: 40, l: 40, h: 80, rotation: 0 },
                { id: 'f11', name: 'Sofa 2', shape: 'rect', x: 600, y: 600, w: 160, l: 90, h: 85, rotation: 0 },
                { id: 'f12', name: 'Lounge Chair', shape: 'rect', x: 700, y: 400, w: 80, l: 80, h: 90, rotation: 75 },
                { id: 'f13', name: 'Coffee Table', shape: 'rect', x: 550, y: 550, w: 90, l: 60, h: 45, rotation: 120 },
                { id: 'f14', name: 'Cabinet', shape: 'rect', x: 720, y: 200, w: 100, l: 40, h: 120, rotation: 180 },
                { id: 'f15', name: 'Dining Chair', shape: 'rect', x: 400, y: 760, w: 50, l: 50, h: 90, rotation: 210 },
                { id: 'f16', name: 'Stool', shape: 'circle', x: 770, y: 680, w: 40, l: 40, h: 45, rotation: 0 },
                { id: 'f17', name: 'Ottoman', shape: 'rect', x: 620, y: 480, w: 70, l: 70, h: 45, rotation: 240 },
                { id: 'f18', name: 'Floor Lamp', shape: 'circle', x: 780, y: 40, w: 40, l: 40, h: 160, rotation: 0 },
                { id: 'f19', name: 'Bookcase', shape: 'rect', x: 40, y: 780, w: 80, l: 30, h: 200, rotation: 270 },
                { id: 'f20', name: 'Side Table', shape: 'rect', x: 770, y: 620, w: 50, l: 50, h: 55, rotation: 315 }
            ];
            app.State.furniture = items;
            assert.equal(app.State.furniture.length, 20);

            // Shrink room from 800x800 to 200x200
            app.State.room.width = 200;
            app.State.room.depth = 200;

            // Execute room-resize clamping
            app.State.furniture.forEach(f => {
                app.CollisionEngine.clampFurnitureToRoom(f, app.State.room);
            });

            // Verify 0 false positive wall collisions after room resize
            const wallCollisions = items.filter(f => app.CollisionEngine.checkWallCollision(f));
            assert.equal(wallCollisions.length, 0, 'All 20 clamped items must produce 0 false positive wall collisions');

            // Verify spatial clamping for all 20 items (with IEEE-754 epsilon tolerance of 1e-6 cm)
            const EPSILON = 1e-6;
            items.forEach(f => {
                if (f.shape === 'circle') {
                    const r = f.w / 2;
                    assert.ok(f.x - r >= -EPSILON, `${f.name} circle left edge ${f.x - r} >= 0`);
                    assert.ok(f.x + r <= 200 + EPSILON, `${f.name} circle right edge ${f.x + r} <= 200`);
                    assert.ok(f.y - r >= -EPSILON, `${f.name} circle top edge ${f.y - r} >= 0`);
                    assert.ok(f.y + r <= 200 + EPSILON, `${f.name} circle bottom edge ${f.y + r} <= 200`);
                } else {
                    const corners = app.getFurnitureCorners(f);
                    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                    corners.forEach(c => {
                        if (c.x < minX) minX = c.x;
                        if (c.x > maxX) maxX = c.x;
                        if (c.y < minY) minY = c.y;
                        if (c.y > maxY) maxY = c.y;
                    });
                    const spanX = maxX - minX;
                    const spanY = maxY - minY;

                    if (spanX <= 200) {
                        assert.ok(minX >= -EPSILON, `${f.name} minX ${minX} >= 0`);
                        assert.ok(maxX <= 200 + EPSILON, `${f.name} maxX ${maxX} <= 200`);
                    } else {
                        // Oversized items must be centered
                        assert.ok(Math.abs(f.x - 100) < EPSILON, `${f.name} centered on X`);
                    }

                    if (spanY <= 200) {
                        assert.ok(minY >= -EPSILON, `${f.name} minY ${minY} >= 0`);
                        assert.ok(maxY <= 200 + EPSILON, `${f.name} maxY ${maxY} <= 200`);
                    } else {
                        // Oversized items must be centered
                        assert.ok(Math.abs(f.y - 100) < EPSILON, `${f.name} centered on Y`);
                    }
                }
            });
        });

        test('Adversarial finding: Sub-nanometer floating-point overshoot causes false checkWallCollision positives', () => {
            app.State.room.width = 200;
            app.State.room.depth = 200;

            // Shelf at rotation 30 deg clamped to room boundaries
            const shelf = { id: 'f5', name: 'Shelf', shape: 'rect', x: 300, y: 750, w: 100, l: 35, h: 180, rotation: 30 };
            app.CollisionEngine.clampFurnitureToRoom(shelf, app.State.room);

            const corners = app.getFurnitureCorners(shelf);
            const corner2 = corners[2]; // Corner reaching the bottom boundary (maxY)

            // The corner exceeds 200cm by a microscopic sub-nanometer delta: ~5.68e-14 cm
            const overshoot = corner2.y - 200;
            assert.ok(overshoot > 0 && overshoot < 1e-12, `Demonstrates IEEE-754 precision overshoot: ${overshoot}`);

            // Because checkWallCollision has epsilon tolerance, false wall collision is eliminated
            const falseWallCollision = app.CollisionEngine.checkWallCollision(shelf);
            assert.equal(falseWallCollision, false, 'Verifies epsilon tolerance eliminates false wall collision');
        });

        test('Adversarial analysis: Quantifying false positive wall collision rate across 360 rotation angles', () => {
            app.State.room.width = 200;
            app.State.room.depth = 200;
            let falsePositivesMax = 0;
            let falsePositivesMin = 0;

            for (let rot = 0; rot < 360; rot++) {
                // Test clamp to max wall
                const itemMax = { id: 'item_max', shape: 'rect', x: 750, y: 750, w: 100, l: 60, h: 80, rotation: rot };
                app.CollisionEngine.clampFurnitureToRoom(itemMax, app.State.room);
                if (app.CollisionEngine.checkWallCollision(itemMax)) {
                    falsePositivesMax++;
                }

                // Test clamp to min wall (0, 0)
                const itemMin = { id: 'item_min', shape: 'rect', x: -100, y: -100, w: 100, l: 60, h: 80, rotation: rot };
                app.CollisionEngine.clampFurnitureToRoom(itemMin, app.State.room);
                if (app.CollisionEngine.checkWallCollision(itemMin)) {
                    falsePositivesMin++;
                }
            }

            // Confirms 0 false positives across all 360 rotation angles on both min and max boundaries
            assert.equal(falsePositivesMax, 0, '0 of 360 angles produce false wall collision on max wall');
            assert.equal(falsePositivesMin, 0, '0 of 360 angles produce false wall collision on min wall');
        });

        test('Progressive room resizing step-down: 800 -> 600 -> 400 -> 200 maintains valid clamping', () => {
            const f = { id: 'desk', shape: 'rect', x: 750, y: 750, w: 120, l: 60, h: 75, rotation: 0 };
            app.State.furniture = [f];

            const steps = [600, 400, 200];
            steps.forEach(size => {
                app.State.room.width = size;
                app.State.room.depth = size;
                app.CollisionEngine.clampFurnitureToRoom(f, app.State.room);

                // Desk halfW = 60, halfL = 30
                assert.equal(f.x, size - 60);
                assert.equal(f.y, size - 30);
                assert.equal(app.CollisionEngine.checkWallCollision(f), false);
            });
        });
    });
});
