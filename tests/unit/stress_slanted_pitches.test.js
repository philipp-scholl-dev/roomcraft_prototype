const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createAppInstance } = require('../harness');

describe('Empirical Challenger: Slanted Roof Pitches Stress Suite', () => {
    let app;

    beforeEach(() => {
        app = createAppInstance();
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

    describe('1. Single and Dual Intersecting Pitches Stress Tests', () => {
        test('Single pitch ceiling follows exact slope gradient and boundary transition', () => {
            app.State.room.pitches.top = { enabled: true, kniestock: 80, run: 160 };

            // At kneewall (y=0) -> 80cm
            assert.equal(Math.round(app.getCeilingHeightAt(250, 0)), 80);
            // Midpoint (y=80) -> 80 + (250-80)*(80/160) = 165cm
            assert.equal(Math.round(app.getCeilingHeightAt(250, 80)), 165);
            // Boundary (y=160) -> 250cm
            assert.equal(Math.round(app.getCeilingHeightAt(250, 160)), 250);
            // Beyond run (y=200) -> 250cm
            assert.equal(Math.round(app.getCeilingHeightAt(250, 200)), 250);
        });

        test('Dual intersecting corner pitches (Top + Left) enforce minimum ceiling envelope', () => {
            app.State.room.pitches.top = { enabled: true, kniestock: 80, run: 150 };
            app.State.room.pitches.left = { enabled: true, kniestock: 100, run: 200 };

            // In corner (x=50, y=50):
            // Top: 80 + 170 * (50/150) = 136.67
            // Left: 100 + 150 * (50/200) = 137.5
            // Envelope takes minimum: 136.67
            const ceilCorner = app.getCeilingHeightAt(50, 50);
            assert.equal(Math.round(ceilCorner), 137);

            // At item corner (x=30, y=30):
            // Top pitch gives 80 + 170 * (30/150) = 114cm.
            // Item with h=110 fits under corner
            const lowItem = { shape: 'rect', x: 50, y: 50, w: 40, l: 40, h: 110, rotation: 0 };
            assert.equal(app.CollisionEngine.checkRoofPitchCollision(lowItem), false);

            // Item with h=140 collides in corner (140 > 114)
            const tallItem = { shape: 'rect', x: 50, y: 50, w: 40, l: 40, h: 140, rotation: 0 };
            assert.equal(app.CollisionEngine.checkRoofPitchCollision(tallItem), true);
        });

        test('Dual opposite pitches (Top + Bottom) intersecting in room center', () => {
            app.State.room.depth = 300;
            app.State.room.pitches.top = { enabled: true, kniestock: 80, run: 180 };
            app.State.room.pitches.bottom = { enabled: true, kniestock: 80, run: 180 };

            // Center of room y = 150 (both pitches overlap!)
            // Top pitch d = 150 -> 80 + 170 * (150/180) = 221.67
            // Bottom pitch d = 300 - 150 = 150 -> 80 + 170 * (150/180) = 221.67
            const ceilCenter = app.getCeilingHeightAt(250, 150);
            assert.equal(Math.round(ceilCenter), 222);

            const wardrobeCenter = { shape: 'rect', x: 250, y: 150, w: 100, l: 60, h: 230, rotation: 0 };
            assert.equal(app.CollisionEngine.checkRoofPitchCollision(wardrobeCenter), true);
        });

        test('Quad-pitch mansard roof (Top, Bottom, Left, Right) evaluates all 4 slopes correctly', () => {
            app.State.room.width = 500;
            app.State.room.depth = 500;
            app.State.room.pitches = {
                top: { enabled: true, kniestock: 80, run: 150 },
                left: { enabled: true, kniestock: 100, run: 200 },
                bottom: { enabled: true, kniestock: 60, run: 180 },
                right: { enabled: true, kniestock: 90, run: 160 }
            };

            assert.equal(Math.round(app.getCeilingHeightAt(50, 50)), 137); // top-left
            assert.equal(Math.round(app.getCeilingHeightAt(450, 50)), 137); // top-right
            assert.equal(Math.round(app.getCeilingHeightAt(50, 450)), 113); // bottom-left
            assert.equal(Math.round(app.getCeilingHeightAt(250, 250)), 250); // center
        });
    });

    describe('2. Circular Tables near Partial Pitch Transitions', () => {
        test('Circular table completely outside partial pitch zone reports no collision', () => {
            app.State.room.pitches.top = { enabled: true, kniestock: 80, run: 150, start: 100, end: 300 };

            // Circle at x = 50, y = 30 with radius 30 (span in X: [20, 80], completely < 100)
            const circle = { shape: 'circle', x: 50, y: 30, w: 60, h: 150, rotation: 0 };
            assert.equal(app.CollisionEngine.checkRoofPitchCollision(circle), false);
        });

        test('Circular table crossing partial pitch boundary at cardinal point is detected', () => {
            app.State.room.pitches.top = { enabled: true, kniestock: 80, run: 150, start: 100, end: 300 };

            // Circle at x = 90, y = 30 with radius 30 (East point reaches x = 120, inside pitch)
            // Local ceiling at (120, 30) is 80 + 170 * (30/150) = 114cm
            const circle = { shape: 'circle', x: 90, y: 30, w: 60, h: 130, rotation: 0 };
            assert.equal(app.CollisionEngine.checkRoofPitchCollision(circle), true);
        });

        test('32-point perimeter sampling detects partial pitch penetration sliver at 348 degrees', () => {
            app.State.room.pitches.top = { enabled: true, kniestock: 80, run: 150, start: 100, end: 300 };

            // Circular table at x = 61, y = 20, diameter = 80 (radius = 40), height = 95
            // At 348 degrees (x = 100.12, y = 11.68), local ceiling is 93.2cm < table height 95cm!
            // 32-point sampling checks 348.75 deg where ceiling is 93.8cm < 95cm
            const table = { shape: 'circle', x: 61, y: 20, w: 80, h: 95, rotation: 0 };
            const detected = app.CollisionEngine.checkRoofPitchCollision(table);

            // Ground truth check at 348 degrees
            const rad = (348 * Math.PI) / 180;
            const trueX = table.x + 40 * Math.cos(rad);
            const trueY = table.y + 40 * Math.sin(rad);
            const trueCeil = app.getCeilingHeightAt(trueX, trueY);

            assert.ok(table.h > trueCeil, `Table height ${table.h} must physically exceed local ceiling ${trueCeil}`);
            assert.equal(detected, true, 'Circle sampling resolution must detect the 348-deg penetration sliver');
        });
    });

    describe('3. Rotated Tall Wardrobes near Kneewalls', () => {
        test('Unrotated tall wardrobe parallel to kneewall outside run fits without collision', () => {
            app.State.room.pitches.top = { enabled: true, kniestock: 80, run: 150 };

            // Wardrobe h=210 at y=160 (halfL = 30 -> y range [130, 190])
            // At y = 130, ceiling is 80 + 170 * (130/150) = 227.33 > 210 -> fits!
            const wardrobe = { shape: 'rect', x: 250, y: 160, w: 150, l: 60, h: 210, rotation: 0 };
            assert.equal(app.CollisionEngine.checkRoofPitchCollision(wardrobe), false);
        });

        test('Rotating tall wardrobe 90 degrees projects front corner into low ceiling, triggering collision', () => {
            app.State.room.pitches.top = { enabled: true, kniestock: 80, run: 150 };

            // Same wardrobe at y=160 rotated 90 deg -> halfW = 75, corner reaches y = 160 - 75 = 85
            // At y = 85, ceiling is 80 + 170 * (85/150) = 176.33 < 210 -> collides!
            const wardrobeRotated = { shape: 'rect', x: 250, y: 160, w: 150, l: 60, h: 210, rotation: 90 };
            assert.equal(app.CollisionEngine.checkRoofPitchCollision(wardrobeRotated), true);
        });

        test('Rotating wardrobe 45 degrees near kneewall corners accurately triggers collision on corner apex', () => {
            app.State.room.pitches.top = { enabled: true, kniestock: 80, run: 150 };

            // Wardrobe at y = 140, rotated 45 deg
            // Corner extends toward y = 0
            const wardrobe45 = { shape: 'rect', x: 250, y: 140, w: 120, l: 60, h: 200, rotation: 45 };
            assert.equal(app.CollisionEngine.checkRoofPitchCollision(wardrobe45), true);
        });

        test('1000 randomized rotated rectangles strictly inside room verify 100% detection rate', () => {
            app.State.room.pitches.top = { enabled: true, kniestock: 80, run: 180 };
            app.State.room.pitches.left = { enabled: true, kniestock: 100, run: 200 };

            let tested = 0;
            let missed = 0;

            for (let seed = 0; seed < 1000; seed++) {
                const rot = (seed * 37) % 360;
                const x = 50 + ((seed * 17) % 300);
                const y = 50 + ((seed * 23) % 250);
                const w = 40 + ((seed * 13) % 120);
                const l = 30 + ((seed * 19) % 60);
                const h = 80 + ((seed * 29) % 160);
                const rect = { shape: 'rect', x, y, w, l, h, rotation: rot };

                if (app.CollisionEngine.checkWallCollision(rect)) continue;
                tested++;

                // Ground truth via dense 10x10 grid
                const corners = app.getFurnitureCorners(rect);
                let gtColl = false;
                for (let u = 0; u <= 1; u += 0.1) {
                    for (let v = 0; v <= 1; v += 0.1) {
                        const px = (1 - u) * (1 - v) * corners[0].x + u * (1 - v) * corners[1].x + u * v * corners[2].x + (1 - u) * v * corners[3].x;
                        const py = (1 - u) * (1 - v) * corners[0].y + u * (1 - v) * corners[1].y + u * v * corners[2].y + (1 - u) * v * corners[3].y;
                        if (rect.h > app.getCeilingHeightAt(px, py)) {
                            gtColl = true;
                            break;
                        }
                    }
                    if (gtColl) break;
                }

                const engColl = app.CollisionEngine.checkRoofPitchCollision(rect);
                if (gtColl && !engColl) missed++;
            }

            assert.ok(tested > 800, `Must test high volume of valid items inside room (tested ${tested})`);
            assert.equal(missed, 0, 'Zero false negatives for valid items inside room boundaries');
        });
    });

    describe('4. Rugs and Obstacles under 0cm Kniestock Roof Pitches', () => {
        test('0cm kniestock pitch drops ceiling height to 0cm at wall boundary', () => {
            app.State.room.pitches.top = { enabled: true, kniestock: 0, run: 200 };

            assert.equal(app.getCeilingHeightAt(250, 0), 0);
            assert.equal(app.getCeilingHeightAt(250, 100), 125);
            assert.equal(app.getCeilingHeightAt(250, 200), 250);
        });

        test('Chimneys/Obstacles under 0cm kniestock roof pitch are strictly exempt', () => {
            app.State.room.pitches.top = { enabled: true, kniestock: 0, run: 200 };

            const chimney = { id: 'c1', name: 'Schornstein / Pfeiler', shape: 'rect', x: 250, y: 30, w: 40, l: 40, h: 250, isObstacle: true, collisionEnabled: true };
            assert.equal(app.CollisionEngine.checkRoofPitchCollision(chimney), false);
        });

        test('Rectangular and circular rugs under 0cm kniestock pitch are strictly exempt', () => {
            app.State.room.pitches.top = { enabled: true, kniestock: 0, run: 200 };

            const rugRect = { id: 'r1', name: 'Teppich (eckig)', shape: 'rect', x: 250, y: 60, w: 200, l: 100, h: 2, isRug: true, collisionEnabled: true };
            const rugCircle = { id: 'r2', name: 'Teppich (rund)', shape: 'circle', x: 250, y: 60, w: 100, l: 100, h: 2, isRug: true, collisionEnabled: true };

            assert.equal(app.CollisionEngine.checkRoofPitchCollision(rugRect), false);
            assert.equal(app.CollisionEngine.checkRoofPitchCollision(rugCircle), false);
        });

        test('Normal furniture under 0cm kniestock pitch collides even at low heights', () => {
            app.State.room.pitches.top = { enabled: true, kniestock: 0, run: 200 };

            // Low nightstand (h = 40) at y = 25 (local ceiling is 250 * 25/200 = 31.25cm < 40cm)
            const nightstand = { id: 'ns1', name: 'Nachttisch', shape: 'rect', x: 250, y: 25, w: 40, l: 30, h: 40, collisionEnabled: true };
            assert.equal(app.CollisionEngine.checkRoofPitchCollision(nightstand), true);
        });

        test('updateAllCollisions() integration preserves exemptions under 0cm kniestock', () => {
            app.State.room.pitches.top = { enabled: true, kniestock: 0, run: 200 };

            const chimney = { id: 'c1', name: 'Schornstein', shape: 'rect', x: 100, y: 30, w: 40, l: 40, h: 250, isObstacle: true, collisionEnabled: true };
            const rug = { id: 'r1', name: 'Teppich (eckig)', shape: 'rect', x: 350, y: 80, w: 120, l: 100, h: 2, isRug: true, collisionEnabled: true };
            const nightstand = { id: 'ns1', name: 'Nachttisch', shape: 'rect', x: 200, y: 25, w: 40, l: 30, h: 40, collisionEnabled: true };

            app.State.furniture = [chimney, rug, nightstand];
            const hasCollision = app.CollisionEngine.updateAllCollisions();

            assert.equal(hasCollision, true);
            assert.equal(chimney.isColliding, false, 'Chimney must remain non-colliding');
            assert.equal(rug.isColliding, false, 'Rug must remain non-colliding');
            assert.equal(nightstand.isColliding, true, 'Nightstand must be flagged colliding');
        });
    });
});
