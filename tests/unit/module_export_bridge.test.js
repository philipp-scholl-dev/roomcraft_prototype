const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../../app.js');

describe('Node.js Direct Module Export Bridge', () => {
    test('Exports all architectural and physics symbols directly to Node.js', () => {
        assert.ok(app.State, 'State should be exported');
        assert.ok(app.History, 'History should be exported');
        assert.ok(app.CollisionEngine, 'CollisionEngine should be exported');
        assert.ok(app.Vector2D, 'Vector2D should be exported');
        assert.equal(typeof app.getCeilingHeightAt, 'function');
        assert.equal(typeof app.getFurnitureCorners, 'function');
        assert.equal(typeof app.CollisionEngine.clampFurnitureToRoom, 'function');
        assert.equal(typeof app.CollisionEngine.checkFurnitureCollision, 'function');
        assert.equal(typeof app.CollisionEngine.checkRoofPitchCollision, 'function');
        assert.equal(typeof app.CollisionEngine.updateAllCollisions, 'function');
    });

    test('Direct CollisionEngine.clampFurnitureToRoom execution without DOM', () => {
        const room = { width: 400, depth: 300 };
        const f = { shape: 'rect', x: -10, y: 350, w: 100, l: 80, rotation: 0 };
        const adjusted = app.CollisionEngine.clampFurnitureToRoom(f, room);

        assert.equal(adjusted, true);
        assert.equal(f.x, 50); // halfW = 50, clamped to minX = 0
        assert.equal(f.y, 260); // 300 - 40 = 260
    });

    test('Direct CollisionEngine.checkFurnitureCollision execution without DOM', () => {
        const f1 = { shape: 'rect', x: 100, y: 100, w: 50, l: 50, h: 50, elevation: 0, rotation: 0 };
        const f2 = { shape: 'rect', x: 120, y: 100, w: 50, l: 50, h: 50, elevation: 0, rotation: 0 };
        assert.equal(app.CollisionEngine.checkFurnitureCollision(f1, f2), true);
    });
});
