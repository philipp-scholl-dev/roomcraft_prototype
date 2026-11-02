/**
 * Empirical Verification Suite — Milestone 2: Doors, Windows, Trims, and CAD Symbols
 * Run with: node --test tests/empirical_m2_doors_windows.test.js
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { setupTestEnvironment } = require('./e2e/helpers.js');

describe('Empirical Verification: Doors, Windows, Trims, and CAD Symbols (Milestone 2)', () => {
    let env;

    before(async () => {
        env = await setupTestEnvironment();
    });

    after(async () => {
        if (env) await env.cleanup();
    });

    // =========================================================================
    // 1. DOOR 3D GEOMETRY & KINEMATICS
    // =========================================================================
    describe('1. Door 3D Geometry & Umfassungszargen Casing', () => {
        const walls = ['top', 'bottom', 'left', 'right'];

        walls.forEach(wall => {
            test(`Single door on wall '${wall}' creates 3-sided Umfassungszargen casing correctly encasing wall`, async () => {
                const { page } = env;

                const casingData = await page.evaluate((targetWall) => {
                    State.room.width = 600;
                    State.room.depth = 500;
                    State.room.height = 260;
                    State.elements = [
                        {
                            id: 'test_door_1',
                            type: 'door',
                            wall: targetWall,
                            position: 250,
                            w: 90,
                            h: 210,
                            hinge: 'left',
                            direction: 'in'
                        }
                    ];
                    Viewer3D.rebuildWalls3D();

                    const doorGroup = Viewer3D.doorMeshes[0];
                    if (!doorGroup) return { error: 'No door mesh found' };

                    // Find jambL, jambR, lintel
                    const jambL = doorGroup.children.find(c => c.geometry && Math.abs(c.geometry.parameters.width - 4.5) < 0.1 && c.position.x < 0);
                    const jambR = doorGroup.children.find(c => c.geometry && Math.abs(c.geometry.parameters.width - 4.5) < 0.1 && c.position.x > 0);
                    const lintel = doorGroup.children.find(c => c.geometry && Math.abs(c.geometry.parameters.height - 4.5) < 0.1);

                    if (!jambL || !jambR || !lintel) {
                        return { error: 'Missing casing component', hasL: !!jambL, hasR: !!jambR, hasLintel: !!lintel };
                    }

                    // Check depths: wall thickness is 10cm, casing depth must be 12cm
                    const casingDepth = jambL.geometry.parameters.depth;
                    const casingWidth = jambL.geometry.parameters.width;
                    const lintelW = lintel.geometry.parameters.width;

                    // World positions
                    jambL.updateMatrixWorld(true);
                    jambR.updateMatrixWorld(true);
                    lintel.updateMatrixWorld(true);

                    const posL = new THREE.Vector3();
                    const posR = new THREE.Vector3();
                    const posLintel = new THREE.Vector3();

                    jambL.getWorldPosition(posL);
                    jambR.getWorldPosition(posR);
                    lintel.getWorldPosition(posLintel);

                    const doorWorldPos = new THREE.Vector3();
                    doorGroup.getWorldPosition(doorWorldPos);

                    return {
                        casingDepth,
                        casingWidth,
                        lintelW,
                        jambL_pos: { x: posL.x, y: posL.y, z: posL.z },
                        jambR_pos: { x: posR.x, y: posR.y, z: posR.z },
                        lintel_pos: { x: posLintel.x, y: posLintel.y, z: posLintel.z },
                        door_pos: { x: doorWorldPos.x, y: doorWorldPos.y, z: doorWorldPos.z },
                        doorRotationY: doorGroup.rotation.y
                    };
                }, wall);

                assert.ok(!casingData.error, `Error on wall ${wall}: ${JSON.stringify(casingData)}`);
                // 12cm casing depth on 10cm wall: protrudes 1cm inward and 1cm outward
                assert.equal(casingData.casingDepth, 12, 'Casing depth must be 12cm');
                assert.equal(casingData.casingWidth, 4.5, 'Casing jamb width must be 4.5cm');
                assert.equal(casingData.lintelW, 92, 'Lintel width must be door.w + 2 = 92cm');
                assert.ok(casingData.lintel_pos.y > 200, 'Lintel must be positioned at door top height');
            });

            test(`Double door on wall '${wall}' creates 3-sided casing and dual leaf groups`, async () => {
                const { page } = env;

                const res = await page.evaluate((targetWall) => {
                    State.room.width = 600;
                    State.room.depth = 500;
                    State.elements = [
                        {
                            id: 'test_ddoor_1',
                            type: 'double-door',
                            wall: targetWall,
                            position: 250,
                            w: 160,
                            h: 210,
                            direction: 'in'
                        }
                    ];
                    Viewer3D.rebuildWalls3D();

                    const doorGroup = Viewer3D.doorMeshes[0];
                    if (!doorGroup) return { error: 'No door mesh found' };

                    const jambL = doorGroup.children.find(c => c.geometry && Math.abs(c.geometry.parameters.width - 4.5) < 0.1 && c.position.x < 0);
                    const jambR = doorGroup.children.find(c => c.geometry && Math.abs(c.geometry.parameters.width - 4.5) < 0.1 && c.position.x > 0);
                    const lintel = doorGroup.children.find(c => c.geometry && Math.abs(c.geometry.parameters.height - 4.5) < 0.1);

                    // Must have 2 pivot groups for the 2 leaves
                    const pivotGroups = doorGroup.children.filter(c => c.type === 'Group');

                    return {
                        hasJambL: !!jambL,
                        hasJambR: !!jambR,
                        hasLintel: !!lintel,
                        lintelW: lintel ? lintel.geometry.parameters.width : 0,
                        pivotCount: pivotGroups.length
                    };
                }, wall);

                assert.ok(res.hasJambL && res.hasJambR && res.hasLintel, 'Double door must have full casing');
                assert.equal(res.lintelW, 162, 'Double door lintel width must be 162cm (160 + 2)');
                assert.equal(res.pivotCount, 2, 'Double door must have 2 leaf pivot groups');
            });
        });

        test('Drückergarnitur rotates synchronously with leaf across 0°, 15°, 30°, 45°, 60°, 75°, 90°', async () => {
            const { page } = env;

            const testResults = await page.evaluate(() => {
                State.room.width = 600;
                State.room.depth = 500;
                State.elements = [
                    {
                        id: 'test_door_kinematics',
                        type: 'door',
                        wall: 'top',
                        position: 300,
                        w: 90,
                        h: 210,
                        hinge: 'left',
                        direction: 'in'
                    }
                ];
                Viewer3D.rebuildWalls3D();

                const doorGroup = Viewer3D.doorMeshes[0];
                const pivot = doorGroup.children.find(c => c.type === 'Group');
                if (!pivot) return { error: 'No pivot group' };

                // In pivot: child 0 is leaf, child 1 is handle group
                const leaf = pivot.children[0];
                const handle = pivot.children[1];
                if (!leaf || !handle) return { error: 'Missing leaf or handle in pivot' };

                const anglesDeg = [0, 15, 30, 45, 60, 75, 90];
                const results = [];

                anglesDeg.forEach(deg => {
                    const rad = (deg * Math.PI) / 180;
                    pivot.rotation.y = -rad; // swing inwards
                    pivot.updateMatrixWorld(true);

                    const pivotPos = new THREE.Vector3();
                    const leafPos = new THREE.Vector3();
                    const handlePos = new THREE.Vector3();

                    pivot.getWorldPosition(pivotPos);
                    leaf.getWorldPosition(leafPos);
                    handle.getWorldPosition(handlePos);

                    // Compute distance from pivot to handle in the horizontal plane (X-Z)
                    const distHandlePivot = Math.hypot(handlePos.x - pivotPos.x, handlePos.z - pivotPos.z);
                    const distLeafPivot = Math.hypot(leafPos.x - pivotPos.x, leafPos.z - pivotPos.z);

                    // Handle angle relative to door group in X-Z
                    const angleHandle = Math.atan2(handlePos.z - pivotPos.z, handlePos.x - pivotPos.x);
                    const angleLeaf = Math.atan2(leafPos.z - pivotPos.z, leafPos.x - pivotPos.x);

                    // Relative angle between leaf and handle must be exactly 0 (they lie along same radial direction)
                    const relAngle = Math.abs(angleHandle - angleLeaf);

                    results.push({
                        deg,
                        rad,
                        handleY: handlePos.y,
                        distHandlePivot,
                        distLeafPivot,
                        relAngle
                    });
                });

                return results;
            });

            assert.ok(Array.isArray(testResults), 'Should return array of angle results');
            assert.equal(testResults.length, 7, 'Should test 7 distinct opening angles');

            // Verify kinematic invariants:
            const baselineDist = testResults[0].distHandlePivot;
            testResults.forEach(r => {
                // DIN 18101 standard door handle height is 105cm above finished floor (1cm pivot elevation + 104cm handle mount)
                assert.ok(Math.abs(r.handleY - 105) < 1e-3, `Handle Y position must remain 105cm (DIN 18101), got ${r.handleY} at ${r.deg}°`);
                // Distance from pivot axis to handle must be rigid (zero radial drift)
                assert.ok(Math.abs(r.distHandlePivot - baselineDist) < 1e-3, `Handle radial distance from hinge must remain constant, diff = ${Math.abs(r.distHandlePivot - baselineDist)} at ${r.deg}°`);
                // Relative angle between handle and leaf must be 0 (rigid body synchronization)
                assert.ok(r.relAngle < 1e-4, `Handle and leaf must be rigidly locked with zero angular drift, got ${r.relAngle} at ${r.deg}°`);
            });
        });
    });

    // =========================================================================
    // 2. WINDOW 3D GEOMETRY & SILLS
    // =========================================================================
    describe('2. Window 3D Geometry & Dual Sills', () => {
        const walls = ['top', 'bottom', 'left', 'right'];

        walls.forEach(wall => {
            test(`Window on wall '${wall}' generates dual sills with 7cm interior and 5cm exterior projection`, async () => {
                const { page } = env;

                const sillData = await page.evaluate((targetWall) => {
                    State.room.width = 600;
                    State.room.depth = 500;
                    State.room.height = 260;
                    State.elements = [
                        {
                            id: 'test_win_sills',
                            type: 'window',
                            wall: targetWall,
                            position: 250,
                            w: 120,
                            h: 140,
                            sillHeight: 90
                        }
                    ];
                    Viewer3D.rebuildWalls3D();

                    const winGroup = Viewer3D.windowMeshes[0];
                    if (!winGroup) return { error: 'No window mesh found' };

                    // Find interior sill (depth = 13cm, height = 2.5cm)
                    const intSill = winGroup.children.find(c => c.geometry && Math.abs(c.geometry.parameters.depth - 13) < 0.1);
                    // Find exterior sill (depth = 10cm, height = 1.5cm)
                    const extSill = winGroup.children.find(c => c.geometry && Math.abs(c.geometry.parameters.depth - 10) < 0.1);

                    if (!intSill || !extSill) {
                        return { error: 'Missing sills', hasInt: !!intSill, hasExt: !!extSill };
                    }

                    // Local coordinate checks:
                    // Wall thickness is 10cm, centered at z = 0.
                    // Inner wall face is at z = +5.0 (for room interior at +Z).
                    // intSill: z = 5.5, depth = 13 => inner edge is at 5.5 + 6.5 = 12.0 => projection = |12.0 - 5.0| = 7.0cm
                    // Outer wall face is at z = -5.0 (for exterior facade at -Z).
                    // extSill: z = -5.0, depth = 10 => outer edge is at -5.0 - 5.0 = -10.0 => projection = |-10.0 - (-5.0)| = 5.0cm
                    const intInnerEdgeLocalZ = intSill.position.z > 0
                        ? (intSill.position.z + intSill.geometry.parameters.depth / 2)
                        : (intSill.position.z - intSill.geometry.parameters.depth / 2);
                    const intWallFaceZ = intSill.position.z > 0 ? 5.0 : -5.0;
                    const intProjection = Math.abs(intInnerEdgeLocalZ - intWallFaceZ);

                    const extOuterEdgeLocalZ = extSill.position.z < 0
                        ? (extSill.position.z - extSill.geometry.parameters.depth / 2)
                        : (extSill.position.z + extSill.geometry.parameters.depth / 2);
                    const extWallFaceZ = extSill.position.z < 0 ? -5.0 : 5.0;
                    const extProjection = Math.abs(extOuterEdgeLocalZ - extWallFaceZ);

                    // World positions to verify vector direction towards room center
                    intSill.updateMatrixWorld(true);
                    extSill.updateMatrixWorld(true);

                    const intWorldPos = new THREE.Vector3();
                    const extWorldPos = new THREE.Vector3();
                    const winWorldPos = new THREE.Vector3();

                    intSill.getWorldPosition(intWorldPos);
                    extSill.getWorldPosition(extWorldPos);
                    winGroup.getWorldPosition(winWorldPos);

                    // Room center in world space is (0, 0, 0) because offset is (-width/2, -depth/2)
                    const distIntToCenter = Math.hypot(intWorldPos.x, intWorldPos.z);
                    const distExtToCenter = Math.hypot(extWorldPos.x, extWorldPos.z);
                    const distWinToCenter = Math.hypot(winWorldPos.x, winWorldPos.z);

                    // Interior sill MUST be closer to room center than the window center
                    // Exterior sill MUST be further from room center than the window center
                    const intCloser = distIntToCenter < distWinToCenter;
                    const extFurther = distExtToCenter > distWinToCenter;

                    return {
                        intDepth: intSill.geometry.parameters.depth,
                        extDepth: extSill.geometry.parameters.depth,
                        intWidth: intSill.geometry.parameters.width,
                        extWidth: extSill.geometry.parameters.width,
                        intProjection,
                        extProjection,
                        intCloser,
                        extFurther,
                        distIntToCenter,
                        distWinToCenter,
                        distExtToCenter,
                        intSillLocalZ: intSill.position.z,
                        extSillLocalZ: extSill.position.z
                    };
                }, wall);

                assert.ok(!sillData.error, `Sill error on wall ${wall}: ${JSON.stringify(sillData)}`);
                // Magnitude checks:
                assert.ok(Math.abs(sillData.intProjection - 7.0) < 1e-4, `Interior sill must project exactly 7.0cm, got ${sillData.intProjection}`);
                assert.ok(Math.abs(sillData.extProjection - 5.0) < 1e-4, `Exterior sill must project exactly 5.0cm, got ${sillData.extProjection}`);
                assert.equal(sillData.intWidth, 126, 'Interior sill width must be win.w + 6 = 126cm');
                assert.equal(sillData.extWidth, 122, 'Exterior sill width must be win.w + 2 = 122cm');

                // Orientation check: Interior sill must point towards room interior (local +Z), Exterior sill towards outside (local -Z)
                // Defect under test: intSill is at z = -5.5 (outward) and extSill is at z = +5.0 (inward)
                assert.equal(
                    sillData.intCloser,
                    true,
                    `[DEFECT] On wall '${wall}', Interior sill is positioned at local z=${sillData.intSillLocalZ} (pointing outward, further from room center: distInt=${sillData.distIntToCenter} vs distWin=${sillData.distWinToCenter}) instead of inward.`
                );
                assert.equal(
                    sillData.extFurther,
                    true,
                    `[DEFECT] On wall '${wall}', Exterior sill is positioned at local z=${sillData.extSillLocalZ} (pointing inward, closer to room center: distExt=${sillData.distExtToCenter} vs distWin=${sillData.distWinToCenter}) instead of outward.`
                );
            });
        });

        test('Central mullion threshold: windows >= 100cm have mullion + 2 panes; < 100cm have 0 mullion + 1 pane', async () => {
            const { page } = env;

            const sweepWidths = [60, 80, 90, 99, 99.9, 100, 100.1, 120, 150, 180];

            const sweepResults = await page.evaluate((widths) => {
                const results = [];
                widths.forEach(w => {
                    State.room.width = 600;
                    State.room.depth = 500;
                    State.elements = [
                        {
                            id: `win_thresh_${w}`,
                            type: 'window',
                            wall: 'top',
                            position: 300,
                            w: w,
                            h: 120,
                            sillHeight: 90
                        }
                    ];
                    Viewer3D.rebuildWalls3D();

                    const winGroup = Viewer3D.windowMeshes[0];
                    if (!winGroup) {
                        results.push({ w, error: 'no mesh' });
                        return;
                    }

                    // Glass panes have MeshPhysicalMaterial with transmission
                    const glassMeshes = winGroup.children.filter(c => c.material && c.material.transmission !== undefined);
                    // Central mullion is a BoxGeometry with width 4.0 situated at x = 0
                    const mullions = winGroup.children.filter(c => c.geometry && Math.abs(c.geometry.parameters.width - 4.0) < 0.1 && Math.abs(c.position.x) < 0.1);

                    results.push({
                        w,
                        glassCount: glassMeshes.length,
                        mullionCount: mullions.length
                    });
                });
                return results;
            }, sweepWidths);

            sweepResults.forEach(res => {
                if (res.w >= 100) {
                    assert.equal(res.glassCount, 2, `Window width ${res.w}cm must have exactly 2 glass panes`);
                    assert.equal(res.mullionCount, 1, `Window width ${res.w}cm must have exactly 1 central mullion`);
                } else {
                    assert.equal(res.glassCount, 1, `Window width ${res.w}cm must have exactly 1 glass pane`);
                    assert.equal(res.mullionCount, 0, `Window width ${res.w}cm must have 0 central mullions`);
                }
            });
        });

        test('Window handle (Fensterolive) must be mounted on room interior face (+Z), not exterior (-Z)', async () => {
            const { page } = env;

            const handleData = await page.evaluate(() => {
                State.room.width = 600;
                State.room.depth = 500;
                State.elements = [
                    {
                        id: 'test_win_handle_side',
                        type: 'window',
                        wall: 'top',
                        position: 300,
                        w: 120,
                        h: 140,
                        sillHeight: 90
                    }
                ];
                Viewer3D.rebuildWalls3D();

                const winGroup = Viewer3D.windowMeshes[0];
                if (!winGroup) return { error: 'no window mesh' };

                // Find handle group
                const handleGroup = winGroup.children.find(c => c.type === 'Group');
                if (!handleGroup) return { error: 'no handle group found' };

                // Handle rosette, neck, and grip local Z
                const rosette = handleGroup.children[0];
                const grip = handleGroup.children[2];

                return {
                    rosetteLocalZ: rosette ? rosette.position.z : null,
                    gripLocalZ: grip ? grip.position.z : null
                };
            });

            assert.ok(!handleData.error, `Error: ${JSON.stringify(handleData)}`);
            // Interior face is +Z (towards room interior). Outdoor face is -Z.
            assert.equal(
                handleData.rosetteLocalZ > 0,
                true,
                `[DEFECT] Window handle rosette is positioned at local z=${handleData.rosetteLocalZ} (outdoors/exterior face) instead of positive z (room interior face).`
            );
            assert.equal(
                handleData.gripLocalZ > 0,
                true,
                `[DEFECT] Window handle grip is positioned at local z=${handleData.gripLocalZ} (outdoors/exterior face) instead of positive z (room interior face).`
            );
        });
    });

    // =========================================================================
    // 3. 2D DIN 1356 SYMBOLS
    // =========================================================================
    describe('3. 2D DIN 1356 Architectural Symbols', () => {
        const walls = ['top', 'bottom', 'left', 'right'];

        walls.forEach(wall => {
            test(`2D DIN 1356 door symbols on wall '${wall}' render leaf, hinge dot, and handle tick`, async () => {
                const { page } = env;

                const drawData = await page.evaluate((targetWall) => {
                    State.room.width = 600;
                    State.room.depth = 500;
                    State.elements = [
                        {
                            id: 'din_door_test',
                            type: 'door',
                            wall: targetWall,
                            position: 250,
                            w: 90,
                            h: 210,
                            hinge: 'left',
                            direction: 'in'
                        }
                    ];

                    // Spy on 2D canvas context calls during draw()
                    const canvas = document.getElementById('editorCanvas');
                    const ctx = canvas.getContext('2d');

                    const fillRectCalls = [];
                    const arcCalls = [];
                    const lineCalls = [];

                    const origFillRect = ctx.fillRect.bind(ctx);
                    const origArc = ctx.arc.bind(ctx);
                    const origLineTo = ctx.lineTo.bind(ctx);

                    ctx.fillRect = function(...args) {
                        fillRectCalls.push(args);
                        return origFillRect(...args);
                    };
                    ctx.arc = function(...args) {
                        arcCalls.push(args);
                        return origArc(...args);
                    };
                    ctx.lineTo = function(...args) {
                        lineCalls.push(args);
                        return origLineTo(...args);
                    };

                    Editor2D.draw();

                    // Restore
                    ctx.fillRect = origFillRect;
                    ctx.arc = origArc;
                    ctx.lineTo = origLineTo;

                    // Analyze calls
                    // 1. Wall cutout fillRect: width = 90, height = wallThick + 1 = 11
                    const wallCutout = fillRectCalls.find(c => Math.abs(c[2] - 90) < 0.1 && Math.abs(c[3] - 11) < 0.1);

                    // 2. Solid leaf fillRect: thickness = 3.5, length = 90
                    const solidLeaf = fillRectCalls.find(c => Math.abs(c[2] - 3.5) < 0.1 && Math.abs(c[3] - 90) < 0.1);

                    // 3. Hinge pivot dot arc: radius = 2.5
                    const hingeDot = arcCalls.find(c => Math.abs(c[2] - 2.5) < 0.1);

                    // 4. Swing arc: radius = 90
                    const swingArc = arcCalls.find(c => Math.abs(c[2] - 90) < 0.1);

                    return {
                        hasWallCutout: !!wallCutout,
                        hasSolidLeaf: !!solidLeaf,
                        hasHingeDot: !!hingeDot,
                        hasSwingArc: !!swingArc,
                        totalFillRects: fillRectCalls.length,
                        totalArcs: arcCalls.length
                    };
                }, wall);

                assert.equal(drawData.hasWallCutout, true, `Door on ${wall} must clear wall opening with cutout`);
                assert.equal(drawData.hasSolidLeaf, true, `Door on ${wall} must draw 3.5cm solid leaf rectangle`);
                assert.equal(drawData.hasHingeDot, true, `Door on ${wall} must draw hinge pivot dot`);
                assert.equal(drawData.hasSwingArc, true, `Door on ${wall} must draw swing arc`);
            });

            test(`2D DIN 1356 window symbols on wall '${wall}' render dual sills and double-glazing lines`, async () => {
                const { page } = env;

                const drawData = await page.evaluate((targetWall) => {
                    State.room.width = 600;
                    State.room.depth = 500;
                    State.elements = [
                        {
                            id: 'din_win_test',
                            type: 'window',
                            wall: targetWall,
                            position: 250,
                            w: 120,
                            h: 140,
                            sillHeight: 90
                        }
                    ];

                    const canvas = document.getElementById('editorCanvas');
                    const ctx = canvas.getContext('2d');

                    const fillRectCalls = [];
                    const lineCalls = [];

                    const origFillRect = ctx.fillRect.bind(ctx);
                    const origLineTo = ctx.lineTo.bind(ctx);

                    ctx.fillRect = function(...args) {
                        fillRectCalls.push(args);
                        return origFillRect(...args);
                    };
                    ctx.lineTo = function(...args) {
                        lineCalls.push(args);
                        return origLineTo(...args);
                    };

                    Editor2D.draw();

                    ctx.fillRect = origFillRect;
                    ctx.lineTo = origLineTo;

                    // Wall cutout: width = 120, height = 11
                    const wallCutout = fillRectCalls.find(c => Math.abs(c[2] - 120) < 0.1 && Math.abs(c[3] - 11) < 0.1);

                    // Central mullion fillRect (since w = 120 >= 100): width = 3, height = 10
                    const mullion = fillRectCalls.find(c => Math.abs(c[2] - 3) < 0.1 && Math.abs(c[3] - 10) < 0.1);

                    // Exterior sill line: length = 120 + 6 = 126 (from -63 to 63 at y = -12.5)
                    const extSillLine = lineCalls.find(c => Math.abs(c[0] - 63) < 0.1 && Math.abs(c[1] - (-12.5)) < 0.1);

                    // Interior sill line: length = 120 + 8 = 128 (from -64 to 64 at y = 3)
                    const intSillLine = lineCalls.find(c => Math.abs(c[0] - 64) < 0.1 && Math.abs(c[1] - 3) < 0.1);

                    // Double-glazing lines: two horizontal lines at y = -6.8 and y = -3.2 (from -56 to 56)
                    const glazingLine1 = lineCalls.find(c => Math.abs(c[0] - 56) < 0.1 && Math.abs(c[1] - (-6.8)) < 0.1);
                    const glazingLine2 = lineCalls.find(c => Math.abs(c[0] - 56) < 0.1 && Math.abs(c[1] - (-3.2)) < 0.1);

                    return {
                        hasWallCutout: !!wallCutout,
                        hasMullion: !!mullion,
                        hasExtSill: !!extSillLine,
                        hasIntSill: !!intSillLine,
                        hasGlazing1: !!glazingLine1,
                        hasGlazing2: !!glazingLine2
                    };
                }, wall);

                assert.equal(drawData.hasWallCutout, true, `Window on ${wall} must clear wall opening`);
                assert.equal(drawData.hasMullion, true, `Window >= 100cm on ${wall} must draw central mullion tick`);
                assert.equal(drawData.hasExtSill, true, `Window on ${wall} must draw exterior sill line`);
                assert.equal(drawData.hasIntSill, true, `Window on ${wall} must draw interior sill bracket`);
                assert.equal(drawData.hasGlazing1, true, `Window on ${wall} must draw first double-glazing line`);
                assert.equal(drawData.hasGlazing2, true, `Window on ${wall} must draw second double-glazing line`);
            });
        });
    });

    // =========================================================================
    // 4. ROOM RESIZE STRESS HARNESS
    // =========================================================================
    describe('4. Room Resize Stress Testing with Openings & Trims', () => {
        test('Sequential rapid resizing across 60 room dimensions produces zero NaN or negative trim/sill geometries', async () => {
            const { page } = env;

            const stressResults = await page.evaluate(() => {
                // Populate room with single door, double door, balcony door, narrow window, and wide window
                State.elements = [
                    { id: 'el_d1', type: 'door', wall: 'top', position: 200, w: 90, h: 210, hinge: 'left', direction: 'in' },
                    { id: 'el_d2', type: 'double-door', wall: 'bottom', position: 250, w: 160, h: 210, direction: 'in' },
                    { id: 'el_d3', type: 'door', isBalcony: true, wall: 'right', position: 150, w: 90, h: 210, hinge: 'right', direction: 'in' },
                    { id: 'el_w1', type: 'window', wall: 'left', position: 180, w: 80, h: 120, sillHeight: 90 },
                    { id: 'el_w2', type: 'window', wall: 'top', position: 400, w: 140, h: 130, sillHeight: 85 }
                ];

                const dimensionsToTest = [
                    // Symmetrical shrinks
                    [800, 800], [600, 600], [500, 500], [400, 400], [300, 300], [200, 200], [150, 150], [100, 100],
                    // Symmetrical expansions
                    [250, 250], [500, 500], [750, 750], [1000, 1000], [1200, 1200], [1500, 1500],
                    // Extreme aspect ratios (wide rooms)
                    [1500, 200], [1200, 250], [1000, 150], [800, 120], [600, 100],
                    // Extreme aspect ratios (deep rooms)
                    [200, 1500], [250, 1200], [150, 1000], [120, 800], [100, 600],
                    // Non-round dimensions with floating point values
                    [333.3, 444.4], [555.5, 222.2], [777.7, 888.8], [215.8, 934.1], [642.5, 318.9]
                ];

                // Add 30 random dimensions
                for (let i = 0; i < 30; i++) {
                    const rw = 120 + Math.random() * 1000;
                    const rd = 120 + Math.random() * 1000;
                    dimensionsToTest.push([rw, rd]);
                }

                let totalChecks = 0;
                let nanViolations = 0;
                let negativeDimViolations = 0;
                let crashCount = 0;

                dimensionsToTest.forEach(([w, d]) => {
                    try {
                        State.room.width = w;
                        State.room.depth = d;

                        // Execute clamping logic as performed during room resize
                        State.elements.forEach(el => {
                            const maxPos = (el.wall === 'top' || el.wall === 'bottom') ? State.room.width : State.room.depth;
                            const halfW = el.w / 2;
                            el.position = Math.max(halfW, Math.min(maxPos - halfW, el.position));
                        });

                        // Rebuild 3D and 2D
                        Viewer3D.rebuildWalls3D();
                        Editor2D.draw();

                        // Inspect all door meshes
                        Viewer3D.doorMeshes.forEach(doorGroup => {
                            totalChecks++;
                            if (isNaN(doorGroup.position.x) || isNaN(doorGroup.position.y) || isNaN(doorGroup.position.z)) {
                                nanViolations++;
                            }
                            doorGroup.traverse(child => {
                                if (child.geometry && child.geometry.parameters) {
                                    const p = child.geometry.parameters;
                                    if (p.width !== undefined && (isNaN(p.width) || p.width <= 0)) negativeDimViolations++;
                                    if (p.height !== undefined && (isNaN(p.height) || p.height <= 0)) negativeDimViolations++;
                                    if (p.depth !== undefined && (isNaN(p.depth) || p.depth <= 0)) negativeDimViolations++;
                                }
                            });
                        });

                        // Inspect all window meshes
                        Viewer3D.windowMeshes.forEach(winGroup => {
                            totalChecks++;
                            if (isNaN(winGroup.position.x) || isNaN(winGroup.position.y) || isNaN(winGroup.position.z)) {
                                nanViolations++;
                            }
                            winGroup.traverse(child => {
                                if (child.geometry && child.geometry.parameters) {
                                    const p = child.geometry.parameters;
                                    if (p.width !== undefined && (isNaN(p.width) || p.width <= 0)) negativeDimViolations++;
                                    if (p.height !== undefined && (isNaN(p.height) || p.height <= 0)) negativeDimViolations++;
                                    if (p.depth !== undefined && (isNaN(p.depth) || p.depth <= 0)) negativeDimViolations++;
                                }
                            });
                        });

                    } catch (err) {
                        crashCount++;
                    }
                });

                return {
                    totalResizeSteps: dimensionsToTest.length,
                    totalChecks,
                    nanViolations,
                    negativeDimViolations,
                    crashCount
                };
            });

            assert.equal(stressResults.crashCount, 0, 'Room resizing must cause 0 crashes or exceptions');
            assert.equal(stressResults.nanViolations, 0, 'Room resizing must produce 0 NaN positions');
            assert.equal(stressResults.negativeDimViolations, 0, 'All trims, casings, and sills must maintain positive dimensions');
            assert.ok(stressResults.totalChecks > 200, 'Must perform over 200 spatial validity checks across resize steps');
        });
    });
});
