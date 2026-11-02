const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createAppInstance } = require('../harness');

describe('Room Boundary & Wall Clamping (Unit Tests)', () => {

    describe('checkWallCollision boundary tests', () => {
        test('Furniture completely inside room bounds does not collide with walls', () => {
            const app = createAppInstance();
            app.State.room.width = 500;
            app.State.room.depth = 400;

            const item = {
                shape: 'rect',
                x: 250,
                y: 200,
                w: 120,
                l: 80,
                rotation: 0
            };

            assert.equal(app.CollisionEngine.checkWallCollision(item), false);
        });

        test('Furniture exceeding room boundaries triggers wall collision', () => {
            const app = createAppInstance();
            app.State.room.width = 500;
            app.State.room.depth = 400;

            // Exceeds left wall (minX < 0)
            const itemLeft = { shape: 'rect', x: 40, y: 200, w: 100, l: 80, rotation: 0 };
            assert.equal(app.CollisionEngine.checkWallCollision(itemLeft), true);

            // Exceeds right wall (maxX > 500)
            const itemRight = { shape: 'rect', x: 460, y: 200, w: 100, l: 80, rotation: 0 };
            assert.equal(app.CollisionEngine.checkWallCollision(itemRight), true);

            // Exceeds top wall (minY < 0)
            const itemTop = { shape: 'rect', x: 250, y: 30, w: 100, l: 80, rotation: 0 };
            assert.equal(app.CollisionEngine.checkWallCollision(itemTop), true);

            // Exceeds bottom wall (maxY > 400)
            const itemBottom = { shape: 'rect', x: 250, y: 370, w: 100, l: 80, rotation: 0 };
            assert.equal(app.CollisionEngine.checkWallCollision(itemBottom), true);
        });

        test('Rotated furniture corners extending outside room are detected', () => {
            const app = createAppInstance();
            app.State.room.width = 500;
            app.State.room.depth = 400;

            // Long furniture near top wall: center at y = 60, unrotated halfL is 50 -> minY = 10 (inside!)
            const item = {
                shape: 'rect',
                x: 250,
                y: 60,
                w: 160,
                l: 60,
                rotation: 0
            };
            assert.equal(app.CollisionEngine.checkWallCollision(item), false);

            // When rotated 45 degrees, half-diagonal is sqrt(80^2 + 30^2) = 85.4cm -> top corner is at 60 - 85.4 < 0 (outside!)
            const rotatedItem = { ...item, rotation: 45 };
            assert.equal(app.CollisionEngine.checkWallCollision(rotatedItem), true);
        });

        test('Circle furniture boundary collision checks perimeter correctly', () => {
            const app = createAppInstance();
            app.State.room.width = 500;
            app.State.room.depth = 400;

            // Diameter 100 -> radius 50. Center at x = 40 -> left edge at -10 < 0
            const circleOutside = { shape: 'circle', x: 40, y: 200, w: 100, l: 100, rotation: 0 };
            assert.equal(app.CollisionEngine.checkWallCollision(circleOutside), true);

            // Center at x = 60 -> left edge at 10 > 0
            const circleInside = { shape: 'circle', x: 60, y: 200, w: 100, l: 100, rotation: 0 };
            assert.equal(app.CollisionEngine.checkWallCollision(circleInside), false);
        });
    });

    describe('getClosestWall and formatDim helpers', () => {
        test('getClosestWall identifies nearest wall taking orientation into account', () => {
            const app = createAppInstance();
            app.State.room.width = 500;
            app.State.room.depth = 400;

            // Furniture near top-left, closer to top wall
            const itemTop = { x: 100, y: 60, w: 80, l: 60, rotation: 0 };
            const resTop = app.getClosestWall(itemTop);
            assert.equal(resTop.wall, 'top');
            assert.equal(resTop.distance, 60 - 30); // 30cm to top wall

            // Rotated 90 degrees: w and l swap, so halfL becomes halfW (40)
            const itemRotated = { x: 100, y: 60, w: 80, l: 60, rotation: 90 };
            const resRotated = app.getClosestWall(itemRotated);
            assert.equal(resRotated.wall, 'top');
            assert.equal(resRotated.distance, 60 - 40); // 20cm to top wall
        });

        test('formatDim formats dimensions to 1 decimal place with defensive fallbacks', () => {
            const app = createAppInstance();

            assert.equal(app.formatDim(123.456), 123.5);
            assert.equal(app.formatDim(100), 100);
            assert.equal(app.formatDim(0), 0);
            assert.equal(app.formatDim(null), 0);
            assert.equal(app.formatDim(undefined), 0);
            assert.equal(app.formatDim(NaN), 0);
        });
    });

    describe('clampFurnitureToRoom boundary clamping tests', () => {
        test('Item already inside bounds is not modified and returns false', () => {
            const app = createAppInstance();
            const room = { width: 500, depth: 400 };
            const item = { shape: 'rect', x: 250, y: 200, w: 100, l: 80, rotation: 0 };

            const modified = app.CollisionEngine.clampFurnitureToRoom(item, room);
            assert.equal(modified, false);
            assert.equal(item.x, 250);
            assert.equal(item.y, 200);
        });

        test('Rectangle dragged past left wall is clamped flush to wall', () => {
            const app = createAppInstance();
            const room = { width: 500, depth: 400 };
            // halfW = 40, so leftmost vertex is x - 40. At x = 20, leftmost is -20 < 0
            const item = { shape: 'rect', x: 20, y: 200, w: 80, l: 60, rotation: 0 };

            const modified = app.CollisionEngine.clampFurnitureToRoom(item, room);
            assert.equal(modified, true);
            assert.equal(item.x, 40); // 20 - (-20) = 40
            assert.equal(item.y, 200);
        });

        test('Rectangle dragged past right wall is clamped flush to wall', () => {
            const app = createAppInstance();
            const room = { width: 500, depth: 400 };
            // halfW = 40. At x = 480, rightmost is 520 > 500
            const item = { shape: 'rect', x: 480, y: 200, w: 80, l: 60, rotation: 0 };

            const modified = app.CollisionEngine.clampFurnitureToRoom(item, room);
            assert.equal(modified, true);
            assert.equal(item.x, 460); // 500 - 40 = 460
        });

        test('Rectangle dragged past top and bottom walls is clamped on Y', () => {
            const app = createAppInstance();
            const room = { width: 500, depth: 400 };
            // Top wall: halfL = 30. At y = 10, top is -20 < 0
            const itemTop = { shape: 'rect', x: 250, y: 10, w: 80, l: 60, rotation: 0 };
            app.CollisionEngine.clampFurnitureToRoom(itemTop, room);
            assert.equal(itemTop.y, 30);

            // Bottom wall: At y = 390, bottom is 420 > 400
            const itemBottom = { shape: 'rect', x: 250, y: 390, w: 80, l: 60, rotation: 0 };
            app.CollisionEngine.clampFurnitureToRoom(itemBottom, room);
            assert.equal(itemBottom.y, 370);
        });

        test('Rotated rectangle corners stay strictly inside room boundaries', () => {
            const app = createAppInstance();
            const room = { width: 500, depth: 400 };
            // Rectangle w = 100, l = 100, rotated 45 degrees:
            // half-diagonal = sqrt(50^2 + 50^2) = 70.71cm.
            // Placed at (50, 50): minX = 50 - 70.71 = -20.71 < 0, minY = -20.71 < 0
            const item = { shape: 'rect', x: 50, y: 50, w: 100, l: 100, rotation: 45 };
            const modified = app.CollisionEngine.clampFurnitureToRoom(item, room);

            assert.equal(modified, true);
            // After clamp, all 4 corners must be >= 0 and <= room
            const corners = app.getFurnitureCorners(item);
            for (let c of corners) {
                assert.ok(c.x >= -1e-6, `Corner x ${c.x} should be >= 0`);
                assert.ok(c.x <= room.width + 1e-6, `Corner x ${c.x} should be <= room.width`);
                assert.ok(c.y >= -1e-6, `Corner y ${c.y} should be >= 0`);
                assert.ok(c.y <= room.depth + 1e-6, `Corner y ${c.y} should be <= room.depth`);
            }
        });

        test('Circle furniture is clamped based on radius', () => {
            const app = createAppInstance();
            const room = { width: 500, depth: 400 };
            // Diameter 100 -> radius 50. Placed at x = 20, y = 380
            const circle = { shape: 'circle', x: 20, y: 380, w: 100, l: 100, rotation: 0 };
            const modified = app.CollisionEngine.clampFurnitureToRoom(circle, room);

            assert.equal(modified, true);
            assert.equal(circle.x, 50); // radius = 50
            assert.equal(circle.y, 350); // 400 - 50 = 350
        });

        test('Oversized object exceeding room dimension is centered', () => {
            const app = createAppInstance();
            const smallRoom = { width: 150, depth: 200 };
            // Sofa width 200 > smallRoom.width 150
            const sofa = { shape: 'rect', x: 300, y: 100, w: 200, l: 80, rotation: 0 };
            app.CollisionEngine.clampFurnitureToRoom(sofa, smallRoom);

            assert.equal(sofa.x, 75); // Centered on width: 150 / 2 = 75
            assert.equal(sofa.y, 100);
        });

        test('Room resize shrinks room and all furniture items are clamped inside', () => {
            const app = createAppInstance();
            app.State.room.width = 500;
            app.State.room.depth = 400;

            const f1 = { id: 'f1', shape: 'rect', x: 450, y: 200, w: 60, l: 60, rotation: 0 };
            const f2 = { id: 'f2', shape: 'circle', x: 250, y: 380, w: 80, l: 80, rotation: 0 };
            app.State.furniture = [f1, f2];

            // User shrinks room width to 300 and depth to 250
            app.State.room.width = 300;
            app.State.room.depth = 250;

            app.State.furniture.forEach(f => {
                app.CollisionEngine.clampFurnitureToRoom(f, app.State.room);
            });

            // f1 halfW = 30 -> max x = 300 - 30 = 270
            assert.equal(f1.x, 270);
            assert.equal(f1.y, 200);

            // f2 radius = 40 -> max y = 250 - 40 = 210
            assert.equal(f2.x, 250);
            assert.equal(f2.y, 210);

            // Verify checkWallCollision returns false for both
            assert.equal(app.CollisionEngine.checkWallCollision(f1), false);
            assert.equal(app.CollisionEngine.checkWallCollision(f2), false);
        });
    });
});
