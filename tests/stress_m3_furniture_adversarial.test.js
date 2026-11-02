/**
 * RoomCraft — Milestone 3 Adversarial Stress & Empirical Verification Test Suite
 * 
 * Conducts exhaustive stress-testing of:
 * 1. 2D Canvas drawing across randomized room sizes, rotations, positions, and elevations with strict NaN detection.
 * 2. 3D Procedural geometries in real Chromium WebGL (vertex counts, finite bounding boxes, PBR materials, PointLight).
 * 3. Roof pitch vertical collision physics under extreme kniestock heights (40cm to 120cm) and rotated OBBs.
 * 4. TV elevation stacking on TV-lowboard vs coffee tables vs floor vs rotated bounding boxes.
 * 5. High-frequency category filter pill DOM stress-testing in Chromium.
 * 6. Direct 3D Raycaster selection and highlight cleanup in Chromium.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { setupTestEnvironment } = require('./e2e/helpers');

// Helper to create an isolated sandbox for math, collision, and 2D canvas drawing checks
function createHeadlessSandbox() {
    const appPath = path.resolve(__dirname, '../app.js');
    const code = fs.readFileSync(appPath, 'utf8');

    let totalDrawCalls = 0;
    const recordedCalls = [];

    // Validates that all numeric arguments passed to Canvas2D methods are finite and not NaN
    function assertFiniteArgs(method, args) {
        totalDrawCalls++;
        for (let i = 0; i < args.length; i++) {
            const val = args[i];
            if (typeof val === 'number') {
                assert.ok(
                    Number.isFinite(val),
                    `Canvas2D.${method}() argument at index ${i} is not a finite number: ${val}`
                );
            }
        }
    }

    const mockCtx = {
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        font: '',
        textAlign: '',
        textBaseline: '',
        globalAlpha: 1,
        fillRect: (...args) => { assertFiniteArgs('fillRect', args); recordedCalls.push({ m: 'fillRect', args }); },
        strokeRect: (...args) => { assertFiniteArgs('strokeRect', args); recordedCalls.push({ m: 'strokeRect', args }); },
        clearRect: (...args) => { assertFiniteArgs('clearRect', args); },
        beginPath: () => { recordedCalls.push({ m: 'beginPath' }); },
        closePath: () => { recordedCalls.push({ m: 'closePath' }); },
        moveTo: (...args) => { assertFiniteArgs('moveTo', args); recordedCalls.push({ m: 'moveTo', args }); },
        lineTo: (...args) => { assertFiniteArgs('lineTo', args); recordedCalls.push({ m: 'lineTo', args }); },
        quadraticCurveTo: (...args) => { assertFiniteArgs('quadraticCurveTo', args); recordedCalls.push({ m: 'quadraticCurveTo', args }); },
        bezierCurveTo: (...args) => { assertFiniteArgs('bezierCurveTo', args); recordedCalls.push({ m: 'bezierCurveTo', args }); },
        arc: (...args) => { assertFiniteArgs('arc', args); recordedCalls.push({ m: 'arc', args }); },
        ellipse: (...args) => { assertFiniteArgs('ellipse', args); recordedCalls.push({ m: 'ellipse', args }); },
        fill: () => { recordedCalls.push({ m: 'fill' }); },
        stroke: () => { recordedCalls.push({ m: 'stroke' }); },
        save: () => {},
        restore: () => {},
        translate: (...args) => { assertFiniteArgs('translate', args); },
        rotate: (...args) => { assertFiniteArgs('rotate', args); },
        scale: (...args) => { assertFiniteArgs('scale', args); },
        setLineDash: (arr) => {
            if (Array.isArray(arr)) {
                arr.forEach(n => assert.ok(Number.isFinite(n), `setLineDash element is not finite: ${n}`));
            }
        },
        fillText: (...args) => {
            assert.ok(Number.isFinite(args[1]), 'fillText x is not finite');
            assert.ok(Number.isFinite(args[2]), 'fillText y is not finite');
        },
        strokeText: (...args) => {
            assert.ok(Number.isFinite(args[1]), 'strokeText x is not finite');
            assert.ok(Number.isFinite(args[2]), 'strokeText y is not finite');
        },
        measureText: (txt) => ({ width: (txt || '').length * 7 }),
        createLinearGradient: (...args) => {
            assertFiniteArgs('createLinearGradient', args);
            return { addColorStop: () => {} };
        },
        createRadialGradient: (...args) => {
            assertFiniteArgs('createRadialGradient', args);
            return { addColorStop: () => {} };
        },
        createPattern: () => null,
        drawImage: () => {}
    };

    const sandbox = {
        console,
        Math,
        Date,
        JSON,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Infinity,
        NaN,
        parseFloat,
        parseInt,
        isNaN,
        isFinite,
        Array,
        Object,
        String,
        Number,
        Boolean,
        RegExp,
        Map,
        Set,
        performance: { now: () => Date.now() },
        window: {
            addEventListener: () => {},
            removeEventListener: () => {},
            innerWidth: 1920,
            innerHeight: 1080
        },
        document: {
            addEventListener: () => {},
            removeEventListener: () => {},
            getElementById: () => null,
            querySelector: () => null,
            querySelectorAll: () => [],
            createElement: () => ({ style: {}, classList: { add() {}, remove() {}, contains() { return false; } } })
        },
        THREE: {
            Scene: class {},
            PerspectiveCamera: class {},
            WebGLRenderer: class {},
            Group: class { constructor() { this.children = []; } add(c) { this.children.push(c); } },
            Mesh: class { constructor(g, m) { this.geometry = g; this.material = m; } },
            BoxGeometry: class {},
            CylinderGeometry: class {},
            SphereGeometry: class {},
            CatmullRomCurve3: class {},
            TubeGeometry: class {},
            Shape: class { constructor() { this.curves = []; } moveTo() {} bezierCurveTo() {} },
            ShapeGeometry: class { constructor() { this.attributes = { position: { count: 0 } }; } },
            MeshStandardMaterial: class {},
            PointLight: class { constructor() { this.shadow = { mapSize: {} }; } },
            Vector2: class { constructor(x=0,y=0){this.x=x;this.y=y;} },
            Vector3: class { constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;} },
            Color: class {},
            DoubleSide: 2
        },
        lucide: { createIcons: () => {} }
    };
    sandbox.globalThis = sandbox;

    const exportSnippet = `
;globalThis.__RC_EXPORTS__ = {
    State,
    Vector2D,
    CollisionEngine,
    Presets,
    Editor2D,
    getCeilingHeightAt,
    getFurnitureCorners
};
`;

    vm.runInNewContext(code + exportSnippet, sandbox);
    return {
        app: sandbox.__RC_EXPORTS__,
        mockCtx,
        getDrawCallCount: () => totalDrawCalls
    };
}

describe('Adversarial Stress Suite: Milestone 3 Modern Furniture & Physics', () => {

    test('Empirical Stress 1: 2D Canvas rendering stability across randomized dimensions and rotations (Zero NaN)', () => {
        const { app, mockCtx, getDrawCallCount } = createHeadlessSandbox();
        const { Presets, Editor2D, State } = app;

        const modernKeys = [
            'lounge-chair',
            'bookshelf',
            'coffee-table-set',
            'tv-lowboard',
            'arc-lamp',
            'plant',
            'nightstand'
        ];

        const testRotations = [0, 37, 45, 90, 133, 180, 270, 359];
        const testElevations = [0, 25, 45, 80, 150];
        const roomConfigs = [
            { width: 300, depth: 250 },
            { width: 500, depth: 400 },
            { width: 900, depth: 750 }
        ];

        let executionCount = 0;

        modernKeys.forEach(presetKey => {
            const p = Presets[presetKey];
            assert.ok(p, `Preset ${presetKey} must be registered in Presets`);

            roomConfigs.forEach(room => {
                State.room.width = room.width;
                State.room.depth = room.depth;

                testRotations.forEach(rot => {
                    testElevations.forEach(elev => {
                        const item = {
                            id: `stress_${presetKey}_${rot}_${elev}`,
                            presetKey,
                            name: p.name,
                            shape: p.shape,
                            w: p.w,
                            l: p.l,
                            h: p.h,
                            x: room.width / 2 + (rot % 50) - 25,
                            y: room.depth / 2 + (elev % 30) - 15,
                            rotation: rot,
                            elevation: elev,
                            color: p.color,
                            isTable: p.isTable || false,
                            isLamp: p.isLamp || false,
                            isPlant: p.isPlant || false,
                            isNightstand: p.isNightstand || false,
                            tvSize: p.tvSize
                        };

                        State.furniture = [item];

                        // Must execute without any errors or NaNs passed to canvas
                        assert.doesNotThrow(() => {
                            Editor2D.drawFurniture(mockCtx);
                        }, `Failed drawing preset ${presetKey} at rot=${rot}, elev=${elev}`);

                        executionCount++;
                    });
                });
            });
        });

        const totalCalls = getDrawCallCount();
        assert.ok(executionCount >= 7 * 3 * 8 * 5, `Expected at least 840 configurations tested, got ${executionCount}`);
        assert.ok(totalCalls > 10000, `Expected over 10,000 canvas draw calls validated for NaN, got ${totalCalls}`);
    });

    test('Empirical Stress 2: Roof pitch collision boundary checks under tight ceilings and rotated angles', () => {
        const { app } = createHeadlessSandbox();
        const { CollisionEngine, State, Presets } = app;

        // Configure aggressive slanted ceiling on the TOP wall
        // kniestock = 80cm, run = 150cm, roomHeight = 250cm.
        // Ceiling height at y=0 is 80cm; at y=150cm is 250cm; beyond y=150cm is flat (250cm).
        State.room.width = 500;
        State.room.depth = 400;
        State.room.height = 250;
        State.room.pitches = {
            top: { enabled: true, kniestock: 80, run: 150 },
            bottom: { enabled: false },
            left: { enabled: false },
            right: { enabled: false }
        };

        // 1. Tall Arc Lamp (h = 210cm)
        const pLamp = Presets['arc-lamp'];
        const lamp = {
            ...pLamp,
            id: 'lamp_1',
            presetKey: 'arc-lamp',
            x: 200,
            y: 50, // Ceiling here is 80 + (50/150)*170 = 136.6cm. Lamp height 210cm MUST collide!
            rotation: 0,
            elevation: 0,
            collisionEnabled: true
        };
        assert.strictEqual(
            CollisionEngine.checkRoofPitchCollision(lamp),
            true,
            'Arc lamp (210cm) under 136cm ceiling must collide with pitch'
        );

        // Move lamp to flat room area (y = 250cm) -> Ceiling is 250cm >= 210cm -> NO collision
        lamp.y = 250;
        assert.strictEqual(
            CollisionEngine.checkRoofPitchCollision(lamp),
            false,
            'Arc lamp (210cm) in 250cm ceiling area must not collide with pitch'
        );

        // 2. Bookshelf (h = 160cm, w = 120cm, l = 38cm)
        const pShelf = Presets['bookshelf'];
        const shelf = {
            ...pShelf,
            id: 'shelf_1',
            presetKey: 'bookshelf',
            x: 200,
            y: 50,
            rotation: 0,
            elevation: 0,
            collisionEnabled: true
        };
        assert.strictEqual(
            CollisionEngine.checkRoofPitchCollision(shelf),
            true,
            'Bookshelf (160cm) under 136cm ceiling must collide with pitch'
        );

        // Move shelf towards flat zone where ceiling is 180cm (y = 89cm: 80 + 89/150*170 = 180.8cm)
        shelf.y = 120; // Ceiling is 80 + 120/150*170 = 216cm > 160cm
        assert.strictEqual(
            CollisionEngine.checkRoofPitchCollision(shelf),
            false,
            'Bookshelf (160cm) under 216cm ceiling must not collide'
        );

        // Test Rotation: Shelf at y = 80cm rotated 90 deg extends closer to y = 0
        // half length when rotated 90 is 120 / 2 = 60cm, so top edge reaches y = 80 - 60 = 20cm!
        // Ceiling at y = 20cm is 80 + 20/150*170 = 102.6cm < 160cm -> MUST COLLIDE!
        shelf.y = 80;
        shelf.rotation = 90;
        assert.strictEqual(
            CollisionEngine.checkRoofPitchCollision(shelf),
            true,
            'Bookshelf rotated 90deg reaching y=20cm under pitch must collide'
        );

        // 3. Nightstand (h = 52cm) and Lowboard (h = 45cm) under 80cm kniestock
        const pNight = Presets['nightstand'];
        const nightstand = {
            ...pNight,
            id: 'night_1',
            presetKey: 'nightstand',
            x: 200,
            y: 25, // Ceiling is 80 + 25/150*170 = 108cm > 52cm -> NO collision!
            rotation: 0,
            elevation: 0,
            collisionEnabled: true
        };
        assert.strictEqual(
            CollisionEngine.checkRoofPitchCollision(nightstand),
            false,
            'Nightstand (52cm) under 108cm ceiling must NOT collide'
        );

        const pLowboard = Presets['tv-lowboard'];
        const lowboard = {
            ...pLowboard,
            id: 'lowboard_1',
            presetKey: 'tv-lowboard',
            x: 200,
            y: 25,
            rotation: 0,
            elevation: 0,
            collisionEnabled: true
        };
        assert.strictEqual(
            CollisionEngine.checkRoofPitchCollision(lowboard),
            false,
            'Lowboard (45cm) under 108cm ceiling must NOT collide'
        );

        // Lower kniestock to extreme 40cm:
        State.room.pitches.top.kniestock = 40;
        // At y = 5cm, ceiling = 40 + (5/150)*210 = 47cm
        nightstand.y = 5; // 52cm > 47cm -> MUST COLLIDE
        lowboard.y = 5;   // 45cm < 47cm -> MUST NOT COLLIDE!
        assert.strictEqual(
            CollisionEngine.checkRoofPitchCollision(nightstand),
            true,
            'Nightstand (52cm) under 47cm ceiling must collide'
        );
        assert.strictEqual(
            CollisionEngine.checkRoofPitchCollision(lowboard),
            false,
            'Lowboard (45cm) under 47cm ceiling must not collide'
        );

        // 4. Circular Plant (w = 55cm, h = 135cm) 32-point perimeter test
        const pPlant = Presets['plant'];
        const plant = {
            ...pPlant,
            id: 'plant_1',
            presetKey: 'plant',
            x: 200,
            y: 80, // Center at 80cm, top edge at 80 - 27.5 = 52.5cm
            elevation: 0,
            collisionEnabled: true
        };
        // Ceiling at y = 52.5 is 40 + 52.5/150*210 = 113.5cm < 135cm -> MUST COLLIDE
        assert.strictEqual(
            CollisionEngine.checkRoofPitchCollision(plant),
            true,
            'Plant (135cm) whose top perimeter point exceeds ceiling must collide'
        );
    });

    test('Empirical Stress 3: TV elevation stacking and horizontal collision isolation', () => {
        const { app } = createHeadlessSandbox();
        const { CollisionEngine, State, Presets } = app;

        // Lowboard at center (250, 200), dimensions 180x45x45
        const pLowboard = Presets['tv-lowboard'];
        const lowboard = {
            id: 'f_lb',
            name: pLowboard.name,
            presetKey: 'tv-lowboard',
            shape: pLowboard.shape,
            w: pLowboard.w,
            l: pLowboard.l,
            h: pLowboard.h,
            x: 250,
            y: 200,
            rotation: 0,
            elevation: 0,
            collisionEnabled: true
        };

        // Coffee table at (100, 100), dimensions 100x65x42
        const pCoffee = Presets['coffee-table-set'];
        const coffeeTable = {
            id: 'f_coffee',
            name: pCoffee.name,
            presetKey: 'coffee-table-set',
            shape: pCoffee.shape,
            w: pCoffee.w,
            l: pCoffee.l,
            h: pCoffee.h,
            x: 100,
            y: 100,
            rotation: 0,
            elevation: 0,
            collisionEnabled: true
        };

        // Standard dining table at (400, 100), height 75cm
        const pTable = Presets['table'];
        const diningTable = {
            id: 'f_dining',
            name: pTable.name,
            presetKey: 'table',
            shape: pTable.shape,
            w: pTable.w,
            l: pTable.l,
            h: pTable.h,
            x: 400,
            y: 100,
            rotation: 0,
            elevation: 0,
            collisionEnabled: true
        };

        // 4 TV test instances
        const pTV = Presets['tv'];
        const tvOnLowboard = {
            id: 'tv_lb',
            name: pTV.name,
            presetKey: 'tv',
            shape: pTV.shape,
            w: pTV.w,
            l: pTV.l,
            h: pTV.h,
            x: 250,
            y: 200,
            rotation: 0,
            elevation: 0,
            tvSize: 55,
            collisionEnabled: true
        };

        const tvOnCoffee = {
            id: 'tv_cf',
            name: pTV.name,
            presetKey: 'tv',
            shape: pTV.shape,
            w: pTV.w,
            l: pTV.l,
            h: pTV.h,
            x: 100,
            y: 100,
            rotation: 0,
            elevation: 0,
            tvSize: 55,
            collisionEnabled: true
        };

        const tvOnDining = {
            id: 'tv_dn',
            name: pTV.name,
            presetKey: 'tv',
            shape: pTV.shape,
            w: pTV.w,
            l: pTV.l,
            h: pTV.h,
            x: 400,
            y: 100,
            rotation: 0,
            elevation: 0,
            tvSize: 55,
            collisionEnabled: true
        };

        const tvOnFloor = {
            id: 'tv_fl',
            name: pTV.name,
            presetKey: 'tv',
            shape: pTV.shape,
            w: pTV.w,
            l: pTV.l,
            h: pTV.h,
            x: 250,
            y: 350,
            rotation: 0,
            elevation: 0,
            tvSize: 55,
            collisionEnabled: true
        };

        State.furniture = [lowboard, coffeeTable, diningTable, tvOnLowboard, tvOnCoffee, tvOnDining, tvOnFloor];

        CollisionEngine.updateAllCollisions();

        // 1. Elevation assertions
        assert.strictEqual(tvOnLowboard.elevation, 45, 'TV on lowboard must be elevated to 45cm');
        assert.strictEqual(tvOnCoffee.elevation, 42, 'TV on coffee table must be elevated to 42cm');
        assert.strictEqual(tvOnDining.elevation, pTable.h, `TV on dining table must be elevated to table height (${pTable.h}cm)`);
        assert.strictEqual(tvOnFloor.elevation, 0, 'TV on floor must remain at elevation 0cm');

        // 2. Collision isolation
        assert.strictEqual(tvOnLowboard.isColliding, false, 'Stacked TV on lowboard must not flag collision');
        assert.strictEqual(tvOnCoffee.isColliding, false, 'Stacked TV on coffee table must not flag collision');
        assert.strictEqual(tvOnDining.isColliding, false, 'Stacked TV on dining table must not flag collision');
        assert.strictEqual(lowboard.isColliding, false, 'Supporting lowboard must not flag collision');

        // 3. Stacking on Rotated Lowboard
        lowboard.rotation = 45;
        // Point on rotated lowboard: local coords (dx=20, dy=0) rotated by 45deg:
        // x = 250 + 20*cos(45) = 264.14, y = 200 + 20*sin(45) = 214.14
        tvOnLowboard.x = 264.14;
        tvOnLowboard.y = 214.14;
        CollisionEngine.updateAllCollisions();
        assert.strictEqual(tvOnLowboard.elevation, 45, 'TV inside rotated 45deg lowboard footprint must be elevated to 45cm');

        // Move TV outside rotated lowboard footprint:
        tvOnLowboard.x = 250 + 80;
        tvOnLowboard.y = 200 + 80; // Distance = 113cm > lowboard halfL (22.5cm) along rotated axis
        CollisionEngine.updateAllCollisions();
        assert.strictEqual(tvOnLowboard.elevation, 0, 'TV outside rotated lowboard footprint must drop to floor (0cm)');
    });
});

describe('Adversarial Stress Suite: Real Browser Chromium Integration', () => {
    let env;

    before(async () => {
        env = await setupTestEnvironment();
    });

    after(async () => {
        if (env) await env.cleanup();
    });

    test('Empirical Stress 4: 3D Procedural Geometries (Vertex Counts, Finite Bounds, Non-Null Materials)', async () => {
        const { page } = env;

        // Switch to 3D View to activate WebGL context
        await page.click('#btn-view-3d');
        await page.waitForTimeout(300);

        // Evaluate all 7 presets directly in Chromium Three.js engine
        const results = await page.evaluate(() => {
            const keys = ['lounge-chair', 'bookshelf', 'coffee-table-set', 'tv-lowboard', 'arc-lamp', 'plant', 'nightstand'];
            const reports = {};

            keys.forEach(k => {
                const p = Presets[k];
                const dummyF = {
                    id: 'eval_' + k,
                    presetKey: k,
                    name: p.name,
                    shape: p.shape,
                    w: p.w,
                    l: p.l,
                    h: p.h,
                    x: 250,
                    y: 200,
                    rotation: 0,
                    elevation: 0,
                    color: p.color,
                    color3d: p.color3d,
                    isTable: p.isTable,
                    isLamp: p.isLamp,
                    isPlant: p.isPlant,
                    isNightstand: p.isNightstand
                };

                const group = new THREE.Group();
                Viewer3D.buildDetailedFurniture(dummyF, group, false);

                let meshCount = 0;
                let totalVertices = 0;
                let hasNaNBounds = false;
                let hasNullMaterial = false;
                let pointLightFound = false;

                function inspectObject(obj) {
                    if (obj instanceof THREE.Mesh) {
                        meshCount++;
                        if (obj.geometry) {
                            if (!obj.geometry.boundingBox) {
                                obj.geometry.computeBoundingBox();
                            }
                            const bb = obj.geometry.boundingBox;
                            if (bb) {
                                if (!Number.isFinite(bb.min.x) || !Number.isFinite(bb.max.x) ||
                                    !Number.isFinite(bb.min.y) || !Number.isFinite(bb.max.y) ||
                                    !Number.isFinite(bb.min.z) || !Number.isFinite(bb.max.z)) {
                                    hasNaNBounds = true;
                                }
                            }
                            if (obj.geometry.attributes && obj.geometry.attributes.position) {
                                totalVertices += obj.geometry.attributes.position.count;
                            }
                        }
                        if (!obj.material) {
                            hasNullMaterial = true;
                        }
                    } else if (obj instanceof THREE.PointLight) {
                        pointLightFound = true;
                    }

                    if (obj.children) {
                        obj.children.forEach(inspectObject);
                    }
                }

                inspectObject(group);

                reports[k] = {
                    meshCount,
                    totalVertices,
                    hasNaNBounds,
                    hasNullMaterial,
                    pointLightFound
                };
            });

            return reports;
        });

        const keys = ['lounge-chair', 'bookshelf', 'coffee-table-set', 'tv-lowboard', 'arc-lamp', 'plant', 'nightstand'];

        keys.forEach(k => {
            const rep = results[k];
            assert.ok(rep, `Report for preset ${k} must exist`);
            assert.ok(rep.meshCount >= 5, `Preset ${k} must have at least 5 meshes, got ${rep.meshCount}`);
            assert.ok(rep.totalVertices > 100, `Preset ${k} must have > 100 vertices, got ${rep.totalVertices}`);
            assert.strictEqual(rep.hasNaNBounds, false, `Preset ${k} has NaN bounding box coordinates!`);
            assert.strictEqual(rep.hasNullMaterial, false, `Preset ${k} has null materials!`);

            if (k === 'arc-lamp') {
                assert.strictEqual(rep.pointLightFound, true, 'Arc lamp must include a THREE.PointLight');
            }
            if (k === 'tv-lowboard') {
                assert.ok(rep.meshCount >= 40, `TV lowboard must have plinth, carcass, and 36 vertical wood slats (got ${rep.meshCount} meshes)`);
            }
        });
    });

    test('Empirical Stress 5: High-frequency catalog category filter pill DOM toggling (50 cycles)', async () => {
        const { page } = env;

        // Switch to 2D view
        await page.click('#btn-view-2d');

        // Make sure sidebar Elements tab is active to expose catalog
        await page.click('button[data-tab="tab-furniture"]');
        await page.waitForSelector('#furniture-category-filter');

        const categories = ['all', 'living', 'dining', 'bedroom', 'office', 'decor'];

        // Rapidly toggle category pills 50 times in pseudo-random order
        for (let i = 0; i < 50; i++) {
            const cat = categories[i % categories.length];
            await page.click(`.cat-pill[data-category="${cat}"]`);
        }

        // Verify that after 50 rapid toggles, DOM consistency is strictly intact:
        // 1. Verify "all" pill restores 100% visibility of all preset buttons
        await page.click('.cat-pill[data-category="all"]');
        const hiddenInAll = await page.$$eval(
            '.furniture-presets-grid .preset-btn',
            btns => btns.filter(b => b.style.display === 'none').length
        );
        assert.strictEqual(hiddenInAll, 0, 'No preset button should be hidden when "all" is active');

        // 2. Verify "living" filter hides non-living items like "bed"
        await page.click('.cat-pill[data-category="living"]');
        const bedHidden = await page.$eval(
            '.preset-btn[data-preset="bed"]',
            b => b.style.display === 'none'
        );
        const lowboardVisible = await page.$eval(
            '.preset-btn[data-preset="tv-lowboard"]',
            b => b.style.display !== 'none'
        );
        assert.strictEqual(bedHidden, true, 'Bed must be hidden in "living" category');
        assert.strictEqual(lowboardVisible, true, 'TV-Lowboard must be visible in "living" category');

        // 3. Verify "decor" filter shows arc lamp and plant, but hides desk
        await page.click('.cat-pill[data-category="decor"]');
        const lampVisible = await page.$eval(
            '.preset-btn[data-preset="arc-lamp"]',
            b => b.style.display !== 'none'
        );
        const plantVisible = await page.$eval(
            '.preset-btn[data-preset="plant"]',
            b => b.style.display !== 'none'
        );
        const deskHidden = await page.$eval(
            '.preset-btn[data-preset="desk"]',
            b => b.style.display === 'none'
        );
        assert.strictEqual(lampVisible, true, 'Arc lamp must be visible in "decor" category');
        assert.strictEqual(plantVisible, true, 'Plant must be visible in "decor" category');
        assert.strictEqual(deskHidden, true, 'Desk must be hidden in "decor" category');

        // Reset filter back to "all"
        await page.click('.cat-pill[data-category="all"]');
    });

    test('Empirical Stress 6: 3D Direct furniture selection, highlight management and deselection', async () => {
        const { page } = env;

        // Switch to 3D View
        await page.click('#btn-view-3d');
        await page.waitForTimeout(300);

        // Place two distinct modern presets into the room
        await page.evaluate(() => {
            State.furniture = [];
            const p1 = Presets['lounge-chair'];
            const f1 = {
                id: 'chair_3d_test',
                presetKey: 'lounge-chair',
                name: p1.name,
                shape: p1.shape,
                w: p1.w,
                l: p1.l,
                h: p1.h,
                x: 180,
                y: 200,
                rotation: 0,
                elevation: 0,
                color: p1.color,
                color3d: p1.color3d
            };

            const p2 = Presets['tv-lowboard'];
            const f2 = {
                id: 'board_3d_test',
                presetKey: 'tv-lowboard',
                name: p2.name,
                shape: p2.shape,
                w: p2.w,
                l: p2.l,
                h: p2.h,
                x: 320,
                y: 200,
                rotation: 0,
                elevation: 0,
                color: p2.color,
                color3d: p2.color3d
            };

            State.furniture.push(f1, f2);
            State.furniture.forEach(f => Viewer3D.updateFurniture3D(f));
        });

        // 1. Direct programmatic selection test
        await page.evaluate(() => {
            selectItem(State.furniture[0], 'furniture');
        });

        let selectionState = await page.evaluate(() => {
            const sel = State.selectedItem;
            const f1 = State.furniture[0];
            const g1 = Viewer3D.furnitureMeshes.get(f1);
            const indicator = g1 ? g1.children.find(c => c.name === 'selectionIndicator') : null;
            return {
                selectedId: sel ? sel.id : null,
                hasIndicator: Boolean(indicator)
            };
        });

        assert.strictEqual(selectionState.selectedId, 'chair_3d_test');
        assert.strictEqual(selectionState.hasIndicator, true, 'Lounge chair group must have selection indicator attached');

        // 2. Switch selection to TV lowboard
        await page.evaluate(() => {
            selectItem(State.furniture[1], 'furniture');
        });

        selectionState = await page.evaluate(() => {
            const sel = State.selectedItem;
            const f1 = State.furniture[0];
            const f2 = State.furniture[1];
            const g1 = Viewer3D.furnitureMeshes.get(f1);
            const g2 = Viewer3D.furnitureMeshes.get(f2);
            const ind1 = g1 ? g1.children.find(c => c.name === 'selectionIndicator') : null;
            const ind2 = g2 ? g2.children.find(c => c.name === 'selectionIndicator') : null;
            return {
                selectedId: sel ? sel.id : null,
                chairHasIndicator: Boolean(ind1),
                lowboardHasIndicator: Boolean(ind2)
            };
        });

        assert.strictEqual(selectionState.selectedId, 'board_3d_test');
        assert.strictEqual(selectionState.chairHasIndicator, false, 'Chair indicator must be removed when switching items');
        assert.strictEqual(selectionState.lowboardHasIndicator, true, 'Lowboard must have selection indicator');

        // 3. Deselection (e.g. Bare floor click or selectItem(null, null))
        await page.evaluate(() => {
            selectItem(null, null);
        });

        selectionState = await page.evaluate(() => {
            const sel = State.selectedItem;
            const f2 = State.furniture[1];
            const g2 = Viewer3D.furnitureMeshes.get(f2);
            const ind2 = g2 ? g2.children.find(c => c.name === 'selectionIndicator') : null;
            return {
                selectedId: sel ? sel.id : null,
                lowboardHasIndicator: Boolean(ind2)
            };
        });

        assert.strictEqual(selectionState.selectedId, null, 'Selected item should be null after deselection');
        assert.strictEqual(selectionState.lowboardHasIndicator, false, 'Selection indicator must be stripped on deselection');
    });

    test('Empirical Stress 7: 3D Canvas mouse pointer raycasting and orbit drag disambiguation', async () => {
        const { page } = env;

        // Switch to 3D View so #threeCanvasContainer is visible and sized
        await page.click('#btn-view-3d');
        await page.waitForTimeout(300);

        // Position camera to look directly from above room center down at lowboard
        await page.evaluate(() => {
            selectItem(null, null);
            Viewer3D.furnitureMeshes.forEach(m => Viewer3D.scene.remove(m));
            Viewer3D.furnitureMeshes.clear();
            State.furniture = [];
            const p = Presets['tv-lowboard'];
            const f = {
                id: 'board_click_target',
                presetKey: 'tv-lowboard',
                name: p.name,
                shape: p.shape,
                w: p.w,
                l: p.l,
                h: p.h,
                x: 250,
                y: 200,
                rotation: 0,
                elevation: 0,
                color: p.color,
                color3d: p.color3d
            };
            State.furniture = [f];
            Viewer3D.updateFurniture3D(f);
            Viewer3D.renderer.render(Viewer3D.scene, Viewer3D.camera);
        });

        const canvasRect = await page.evaluate(() => Viewer3D.renderer.domElement.getBoundingClientRect());
        const centerX = canvasRect.left + canvasRect.width / 2;
        const centerY = canvasRect.top + canvasRect.height / 2;

        // 1. Click directly on center of canvas where the lowboard is rendered
        await page.mouse.click(centerX, centerY);

        let selAfterClick = await page.evaluate(() => State.selectedItem ? State.selectedItem.id : null);
        assert.strictEqual(selAfterClick, 'board_click_target', 'Clean stationary click on lowboard must select it');

        // Deselect
        await page.evaluate(() => selectItem(null, null));

        // 2. Simulate camera orbit drag (mousedown, move 30px, mouseup)
        await page.mouse.move(centerX, centerY);
        await page.mouse.down();
        await page.mouse.move(centerX + 30, centerY + 30, { steps: 5 });
        await page.mouse.up();

        let selAfterDrag = await page.evaluate(() => State.selectedItem ? State.selectedItem.id : null);
        assert.strictEqual(selAfterDrag, null, 'Orbit drag (> 5px) must not select furniture');

        // 3. Click off to top-left corner (empty space/sky) -> ensures deselection
        await page.mouse.click(canvasRect.left + 20, canvasRect.top + 20);
        let selAfterSkyClick = await page.evaluate(() => State.selectedItem ? State.selectedItem.id : null);
        assert.strictEqual(selAfterSkyClick, null, 'Clicking empty space / sky must keep selection cleared');
    });

    test('Empirical Stress 8: Dual roof pitch (Giebel) and multi-tier surface elevation stacking', async () => {
        const { app } = createHeadlessSandbox();
        const { CollisionEngine, State, Presets } = app;

        // Setup dual roof pitch (Giebeldach: top & bottom pitches)
        State.room.width = 600;
        State.room.depth = 600;
        State.room.height = 260;
        State.room.pitches = {
            top: { enabled: true, kniestock: 70, run: 180 },
            bottom: { enabled: true, kniestock: 70, run: 180 },
            left: { enabled: false },
            right: { enabled: false }
        };

        // Arc lamp at top pitch boundary:
        // Top kniestock: y=0 is 70cm, y=180 is 260cm.
        // Arc lamp height is 210cm.
        // Pitch slope = (260 - 70) / 180 = 190 / 180 = 1.0555 cm/cm.
        // Ceiling at y = 60cm: 70 + 60 * (190/180) = 133.3cm < 210cm -> COLLISION!
        const lamp = {
            ...Presets['arc-lamp'],
            id: 'lamp_dual_top',
            presetKey: 'arc-lamp',
            x: 300,
            y: 60,
            rotation: 0,
            elevation: 0,
            collisionEnabled: true
        };
        assert.strictEqual(CollisionEngine.checkRoofPitchCollision(lamp), true, 'Lamp under top pitch must collide');

        // Bottom kniestock: y=600 is 70cm, y=420 is 260cm.
        // Ceiling at y = 540cm: distFromBottom = 600 - 540 = 60cm -> 133.3cm < 210cm -> COLLISION!
        lamp.y = 540;
        assert.strictEqual(CollisionEngine.checkRoofPitchCollision(lamp), true, 'Lamp under bottom pitch must collide');

        // Lamp in middle ridge zone (y = 300cm): ceiling is 260cm > 210cm -> NO COLLISION!
        lamp.y = 300;
        assert.strictEqual(CollisionEngine.checkRoofPitchCollision(lamp), false, 'Lamp in middle flat ridge must not collide');

        // Multi-tier stacking test:
        // Tier 1: TV-Lowboard at (300, 300), h = 45cm, elevation = 0
        const lowboard = {
            ...Presets['tv-lowboard'],
            id: 'tier1_lb',
            presetKey: 'tv-lowboard',
            x: 300,
            y: 300,
            rotation: 0,
            elevation: 0,
            collisionEnabled: true
        };

        // Tier 2: A soundbar / riser box on the lowboard, h = 15cm, elevation = 45cm
        const riser = {
            id: 'tier2_riser',
            name: 'Monitor-Riser',
            shape: 'rect',
            w: 80,
            l: 25,
            h: 15,
            x: 300,
            y: 300,
            rotation: 0,
            elevation: 45,
            collisionEnabled: true
        };

        // Tier 3: TV placed on top of riser
        const tv = {
            ...Presets['tv'],
            id: 'tier3_tv',
            presetKey: 'tv',
            x: 300,
            y: 300,
            rotation: 0,
            elevation: 0,
            tvSize: 65,
            collisionEnabled: true
        };

        State.furniture = [lowboard, riser, tv];
        CollisionEngine.updateAllCollisions();

        // The TV should calculate highestSurface = 45 + 15 = 60cm!
        assert.strictEqual(tv.elevation, 60, 'TV on multi-tier riser (45 + 15) must be elevated to 60cm');
        assert.strictEqual(tv.isColliding, false, 'Stacked TV on multi-tier surface must not flag collision');
    });
});

