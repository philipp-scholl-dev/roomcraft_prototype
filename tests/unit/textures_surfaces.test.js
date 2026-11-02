const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../../app.js');

test.describe('Milestone 2: Realistic Lighting & Textures (Unit Tests)', () => {

    test.describe('Feature 5: Three.js Realistic Renderer & Settings', () => {
        test('Default settings include ceiling lamp parameters', () => {
            assert.equal(typeof app.State.settings.ceilingLampsEnabled, 'boolean');
            assert.equal(app.State.settings.ceilingLampsEnabled, true);
            assert.equal(app.State.settings.ceilingLampIntensity, 1.0);
            assert.equal(app.State.settings.ceilingLampColor, '#ffeedd');
        });
    });

    test.describe('Feature 6: Ceiling Lamps Calculations & Grid Positioning', () => {
        test('Single center lamp for standard room (< 600cm x 600cm)', () => {
            const room = { width: 500, depth: 400, height: 250, pitches: { top: { enabled: false } } };
            const lamps = app.getCeilingLampPositions(room);
            assert.equal(lamps.length, 1);
            assert.equal(lamps[0].x, 250);
            assert.equal(lamps[0].y, 200);
        });

        test('2 lamps along X axis for wide room (width > 600cm, depth <= 600cm)', () => {
            const room = { width: 900, depth: 450, height: 260, pitches: { top: { enabled: false } } };
            const lamps = app.getCeilingLampPositions(room);
            assert.equal(lamps.length, 2);
            assert.equal(lamps[0].x, 225); // 900 * 0.5 / 2 = 225
            assert.equal(lamps[1].x, 675); // 900 * 1.5 / 2 = 675
            assert.equal(lamps[0].y, 225); // center depth
            assert.equal(lamps[1].y, 225);
        });

        test('2 lamps along Y (depth) axis for deep room (width <= 600cm, depth > 600cm)', () => {
            const room = { width: 450, depth: 900, height: 260, pitches: { top: { enabled: false } } };
            const lamps = app.getCeilingLampPositions(room);
            assert.equal(lamps.length, 2);
            assert.equal(lamps[0].x, 225); // center width
            assert.equal(lamps[1].x, 225);
            assert.equal(lamps[0].y, 225); // 900 * 0.5 / 2 = 225
            assert.equal(lamps[1].y, 675); // 900 * 1.5 / 2 = 675
        });

        test('4 lamps in a 2x2 grid for large room (width > 600cm, depth > 600cm)', () => {
            const room = { width: 900, depth: 900, height: 280, pitches: { top: { enabled: false } } };
            const lamps = app.getCeilingLampPositions(room);
            assert.equal(lamps.length, 4);
            const xs = lamps.map(l => l.x);
            const ys = lamps.map(l => l.y);
            assert.deepEqual(xs, [225, 225, 675, 675]);
            assert.deepEqual(ys, [225, 675, 225, 675]);
        });
    });

    test.describe('Feature 7: Procedural Floor Textures & Registry', () => {
        test('TextureRegistry contains 14 floor definitions (4 original + 10 procedural)', () => {
            const registry = app.TextureRegistry;
            assert.ok(registry && Array.isArray(registry.floors), 'TextureRegistry.floors must be an array');
            assert.ok(registry.floors.length >= 14, `Expected at least 14 floors, got ${registry.floors.length}`);

            const requiredProcedural = [
                'parquet_oak',
                'herringbone',
                'wood_ash',
                'wood_walnut',
                'tiles_gray',
                'marble_white',
                'concrete',
                'terrazzo',
                'tiles_slate',
                'carpet_warm'
            ];

            for (const key of requiredProcedural) {
                const found = registry.floors.find(f => f.id === key);
                assert.ok(found, `Floor ${key} must be in TextureRegistry.floors`);
                assert.equal(found.procedural, true, `${key} must have procedural=true`);
                assert.ok(found.name, `${key} must have a descriptive name`);
            }
        });

        test('Alias resolution handles legacy and german names (e.g. parkett_eiche)', () => {
            const registry = app.TextureRegistry;
            const oak = registry.floors.find(f => f.id === 'parquet_oak');
            assert.ok(oak, 'parquet_oak should exist');
            assert.ok(oak.aliases && oak.aliases.includes('parkett_eiche'), 'parquet_oak must have alias parkett_eiche');
            
            // TextureCache or alias resolution check
            assert.ok(app.TextureCache, 'TextureCache must exist');
        });

        test('TextureGenerator functions exist and have correct signatures', () => {
            const gen = app.TextureGenerator;
            assert.ok(gen, 'TextureGenerator must exist');
            assert.equal(typeof gen.createFloorTexture, 'function');
            assert.equal(typeof gen.createFloorBump, 'function');
            assert.equal(typeof gen.createWallPlasterBump, 'function');
            assert.equal(typeof gen.createDoorTexture, 'function');
            assert.equal(typeof gen.createDoorBump, 'function');
        });
    });

    test.describe('Feature 8: Wall & Ceiling Plaster Bump Mapping', () => {
        test('createWallPlasterBump creates or returns a plaster canvas', () => {
            const bumpCanvas = app.TextureGenerator.createWallPlasterBump();
            assert.ok(bumpCanvas, 'createWallPlasterBump should return a canvas or canvas descriptor');
            assert.ok(bumpCanvas.width >= 256);
            assert.ok(bumpCanvas.height >= 256);
        });
    });

    test.describe('Feature 9: Realistic Doors & Windows Details', () => {
        test('Door texture and bump generators return canvas or texture objects', () => {
            const doorTex = app.TextureGenerator.createDoorTexture('#ffffff');
            assert.ok(doorTex, 'Door texture canvas should exist');
            const doorBump = app.TextureGenerator.createDoorBump();
            assert.ok(doorBump, 'Door bump should exist');
        });
    });
});
