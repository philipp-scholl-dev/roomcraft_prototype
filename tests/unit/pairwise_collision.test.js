const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createAppInstance } = require('../harness');

describe('Milestone 1 — Pairwise SAT Furniture Collision (Feature 1)', () => {
    let app;

    beforeEach(() => {
        app = createAppInstance();
        app.State.room.width = 500;
        app.State.room.depth = 400;
        app.State.room.height = 250;
        app.State.furniture = [];
        app.State.settings.collisionEnabled = true;
    });

    describe('checkFurnitureCollision Pairwise Tests', () => {
        test('Two non-overlapping rectangles return false', () => {
            const f1 = { shape: 'rect', x: 100, y: 100, w: 60, l: 60, h: 70, elevation: 0, rotation: 0 };
            const f2 = { shape: 'rect', x: 250, y: 100, w: 60, l: 60, h: 70, elevation: 0, rotation: 0 };
            assert.equal(app.CollisionEngine.checkFurnitureCollision(f1, f2), false);
        });

        test('Two overlapping axis-aligned rectangles return true', () => {
            const f1 = { shape: 'rect', x: 100, y: 100, w: 80, l: 80, h: 70, elevation: 0, rotation: 0 };
            const f2 = { shape: 'rect', x: 140, y: 120, w: 80, l: 80, h: 70, elevation: 0, rotation: 0 };
            assert.equal(app.CollisionEngine.checkFurnitureCollision(f1, f2), true);
        });

        test('Two rotated rectangles (OBB SAT) overlapping at corner return true', () => {
            const f1 = { shape: 'rect', x: 100, y: 100, w: 40, l: 120, h: 70, elevation: 0, rotation: 45 };
            const f2 = { shape: 'rect', x: 160, y: 100, w: 40, l: 120, h: 70, elevation: 0, rotation: 0 };
            assert.equal(app.CollisionEngine.checkFurnitureCollision(f1, f2), true);
        });

        test('Two touching rectangles sharing edge do not falsely report collision', () => {
            // f1 from x = 20 to 80 (center 50, w 60), f2 from x = 80 to 140 (center 110, w 60)
            const f1 = { shape: 'rect', x: 50, y: 100, w: 60, l: 60, h: 70, elevation: 0, rotation: 0 };
            const f2 = { shape: 'rect', x: 110, y: 100, w: 60, l: 60, h: 70, elevation: 0, rotation: 0 };
            assert.equal(app.CollisionEngine.checkFurnitureCollision(f1, f2), false);
        });

        test('Circle vs Circle distance penetration and separation', () => {
            const c1 = { shape: 'circle', x: 100, y: 100, w: 60, h: 50, elevation: 0, rotation: 0 };
            const c2Overlap = { shape: 'circle', x: 145, y: 100, w: 60, h: 50, elevation: 0, rotation: 0 };
            const c2Separate = { shape: 'circle', x: 170, y: 100, w: 60, h: 50, elevation: 0, rotation: 0 };

            assert.equal(app.CollisionEngine.checkFurnitureCollision(c1, c2Overlap), true);
            assert.equal(app.CollisionEngine.checkFurnitureCollision(c1, c2Separate), false);
        });

        test('Circle vs rotated OBB penetration', () => {
            const circle = { shape: 'circle', x: 100, y: 50, w: 50, h: 50, elevation: 0, rotation: 0 };
            const rect = { shape: 'rect', x: 100, y: 100, w: 60, l: 60, h: 70, elevation: 0, rotation: 0 };

            assert.equal(app.CollisionEngine.checkFurnitureCollision(circle, rect), true);
        });

        test('Rug exemption: sofa on top of rug does not trigger collision', () => {
            const rug = {
                name: 'Wollteppich',
                shape: 'rect',
                x: 200,
                y: 200,
                w: 240,
                l: 180,
                h: 2,
                elevation: 0,
                isRug: true,
                rotation: 0
            };
            const sofa = {
                name: 'Ecksofa',
                shape: 'rect',
                x: 200,
                y: 200,
                w: 220,
                l: 160,
                h: 85,
                elevation: 0,
                rotation: 0
            };
            assert.equal(app.CollisionEngine.checkFurnitureCollision(sofa, rug), false);
            assert.equal(app.CollisionEngine.checkFurnitureCollision(rug, sofa), false);
        });

        test('Rug identified by name substring is also exempt', () => {
            const rugByName = {
                name: 'Grosser Orientteppich Perser',
                shape: 'rect',
                x: 200,
                y: 200,
                w: 200,
                l: 150,
                h: 2,
                elevation: 0,
                rotation: 0
            };
            const table = {
                name: 'Esstisch',
                shape: 'rect',
                x: 200,
                y: 200,
                w: 160,
                l: 90,
                h: 75,
                elevation: 0,
                rotation: 0
            };
            assert.equal(app.CollisionEngine.checkFurnitureCollision(table, rugByName), false);
        });

        test('Vertical elevation separation prevents collision', () => {
            // Desk on floor: h = 75, elevation = 0 -> top = 75
            const desk = { shape: 'rect', x: 200, y: 200, w: 120, l: 80, h: 75, elevation: 0, rotation: 0 };
            // Wall shelf: h = 40, elevation = 120 -> bottom = 120 > 75.1 -> no collision
            const shelf = { shape: 'rect', x: 200, y: 200, w: 120, l: 40, h: 40, elevation: 120, rotation: 0 };
            assert.equal(app.CollisionEngine.checkFurnitureCollision(desk, shelf), false);

            // Lower shelf: elevation = 60 -> bottom = 60 < 75 -> collision!
            const lowShelf = { ...shelf, elevation: 60 };
            assert.equal(app.CollisionEngine.checkFurnitureCollision(desk, lowShelf), true);
        });

        test('TV exemption: TV sitting on sideboard is exempt from collision', () => {
            const sideboard = { name: 'Sideboard', shape: 'rect', x: 200, y: 200, w: 180, l: 45, h: 60, elevation: 0, rotation: 0 };
            const tv = { name: 'Smart TV 65 Zoll', shape: 'rect', x: 200, y: 200, w: 145, l: 15, h: 80, elevation: 60, tvSize: 65, rotation: 0 };
            assert.equal(app.CollisionEngine.checkFurnitureCollision(sideboard, tv), false);
        });

        test('collisionEnabled flag disables collision checks when false', () => {
            const f1 = { shape: 'rect', x: 100, y: 100, w: 80, l: 80, h: 70, elevation: 0, rotation: 0, collisionEnabled: false };
            const f2 = { shape: 'rect', x: 110, y: 100, w: 80, l: 80, h: 70, elevation: 0, rotation: 0, collisionEnabled: true };
            assert.equal(app.CollisionEngine.checkFurnitureCollision(f1, f2), false);
        });
    });

    describe('updateAllCollisions Pairwise Integration', () => {
        test('updateAllCollisions detects overlapping furniture and flags both items', () => {
            const f1 = { id: 'f1', name: 'Sofa', shape: 'rect', x: 150, y: 150, w: 120, l: 80, h: 75, collisionEnabled: true, isColliding: false };
            const f2 = { id: 'f2', name: 'Table', shape: 'rect', x: 180, y: 160, w: 100, l: 60, h: 75, collisionEnabled: true, isColliding: false };
            const f3 = { id: 'f3', name: 'Wardrobe', shape: 'rect', x: 400, y: 300, w: 80, l: 60, h: 200, collisionEnabled: true, isColliding: false };

            app.State.furniture = [f1, f2, f3];
            const hasCollision = app.CollisionEngine.updateAllCollisions();

            assert.equal(hasCollision, true);
            assert.equal(f1.isColliding, true);
            assert.equal(f2.isColliding, true);
            assert.equal(f3.isColliding, false);
        });

        test('Disabling collisionEnabled in settings resets all collision flags', () => {
            const f1 = { id: 'f1', name: 'Sofa', shape: 'rect', x: 150, y: 150, w: 120, l: 80, h: 75, collisionEnabled: true, isColliding: true };
            const f2 = { id: 'f2', name: 'Table', shape: 'rect', x: 180, y: 160, w: 100, l: 60, h: 75, collisionEnabled: true, isColliding: true };
            app.State.furniture = [f1, f2];

            app.State.settings.collisionEnabled = false;
            const hasCollision = app.CollisionEngine.updateAllCollisions();

            assert.equal(hasCollision, false);
            assert.equal(f1.isColliding, false);
            assert.equal(f2.isColliding, false);
        });
    });
});
