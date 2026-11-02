const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createAppInstance } = require('../harness');

describe('State & Workflow Integration Tests', () => {

    describe('Undo / Redo History Stack', () => {
        test('pushState records state transitions and prevents duplicate consecutive entries', () => {
            const app = createAppInstance();

            assert.equal(app.History.undoStack.length, 0);

            // Record initial state
            app.History.pushState();
            assert.equal(app.History.undoStack.length, 1);

            // Attempting to push identical state should be ignored
            app.History.pushState();
            assert.equal(app.History.undoStack.length, 1);

            // Mutate state by adding furniture item
            app.State.furniture.push({
                id: 'test_item_1',
                name: 'Test Desk',
                x: 100,
                y: 100,
                w: 120,
                l: 80,
                h: 75
            });

            app.History.pushState();
            assert.equal(app.History.undoStack.length, 2);
            assert.equal(app.History.redoStack.length, 0);
        });

        test('tempSnapshot commits only when actual modifications occurred', () => {
            const app = createAppInstance();

            app.History.saveTempSnapshot();
            // No changes made -> commit should not add to undo stack
            app.History.commitTempSnapshot();
            assert.equal(app.History.undoStack.length, 0);

            // Start drag snapshot, then mutate
            app.History.saveTempSnapshot();
            app.State.room.width = 650;
            app.History.commitTempSnapshot();
            assert.equal(app.History.undoStack.length, 1);
        });
    });

    describe('JSON Project Data Import & Export Round-trip', () => {
        test('applyProjectData reconstructs complete room architecture without data loss', () => {
            const app = createAppInstance();

            const customProject = {
                room: {
                    width: 620,
                    depth: 480,
                    height: 280,
                    pitches: {
                        top: { enabled: true, kniestock: 90, run: 140 },
                        right: { enabled: false, kniestock: 80, run: 150 },
                        bottom: { enabled: false, kniestock: 80, run: 150 },
                        left: { enabled: true, kniestock: 100, run: 120 }
                    },
                    wallColors: {
                        top: '#e0ded9',
                        right: '#ffffff',
                        bottom: '#ffffff',
                        left: '#e0ded9',
                        pitch: '#f5f5f5',
                        ceiling: '#fafafa'
                    },
                    floorTexture: 'parkett_eiche',
                    floorScale: 1.2
                },
                elements: [
                    { id: 'door_south', type: 'door', wall: 'bottom', position: 150, w: 90, h: 200 },
                    { id: 'window_north', type: 'window', wall: 'top', position: 300, w: 120, h: 120, sillHeight: 90 }
                ],
                installations: [
                    { id: 'socket_1', type: 'socket', wall: 'bottom', position: 80, height: 30 },
                    { id: 'switch_1', type: 'switch', wall: 'bottom', position: 210, height: 105 }
                ],
                furniture: [
                    { id: 'sofa_main', name: 'Sofa', shape: 'rect', x: 300, y: 250, w: 220, l: 95, h: 80, rotation: 0, color: '#445566', collisionEnabled: true },
                    { id: 'coffee_table', name: 'Table', shape: 'circle', x: 300, y: 350, w: 90, l: 90, h: 45, rotation: 0, color: '#887766', collisionEnabled: true }
                ]
            };

            // Apply project
            app.applyProjectData(customProject);

            // Invariants check
            assert.equal(app.State.room.width, 620);
            assert.equal(app.State.room.depth, 480);
            assert.equal(app.State.room.height, 280);
            assert.equal(app.State.room.floorTexture, 'parkett_eiche');
            assert.equal(app.State.room.pitches.left.enabled, true);
            assert.equal(app.State.elements.length, 2);
            assert.equal(app.State.installations.length, 2);
            assert.equal(app.State.furniture.length, 2);

            // Serialization round-trip
            const exportedJSON = JSON.stringify({
                room: app.State.room,
                furniture: app.State.furniture,
                elements: app.State.elements,
                installations: app.State.installations
            });

            const parsed = JSON.parse(exportedJSON);
            assert.deepEqual(parsed.room.width, customProject.room.width);
            assert.deepEqual(parsed.furniture.length, 2);
            assert.equal(parsed.furniture[0].id, 'sofa_main');
            assert.equal(parsed.furniture[1].shape, 'circle');
        });
    });

    describe('Presets Furniture Catalog Specification Integrity', () => {
        test('All presets provide valid dimensional geometries and standard attributes', () => {
            const app = createAppInstance();
            const presets = app.Presets;

            const expectedKeys = ['bed', 'wardrobe', 'desk', 'chair', 'sofa', 'table', 'tv', 'rug-rect', 'rug-circle'];
            for (const key of expectedKeys) {
                assert.ok(presets[key], `Preset "${key}" should exist in Presets`);
                const p = presets[key];
                assert.ok(p.name && typeof p.name === 'string', `${key} must have a name`);
                assert.ok(p.w > 0, `${key} width must be positive`);
                assert.ok(p.l > 0, `${key} length must be positive`);
                assert.ok(p.h > 0, `${key} height must be positive`);
                assert.ok(p.shape === 'rect' || p.shape === 'circle', `${key} shape must be rect or circle`);
                assert.ok(p.color, `${key} must have color defined`);
            }
        });
    });
});
