/**
 * RoomCraft — Milestone 3 Empirical Challenger Verification Suite: 3D Raycaster & Selection
 * 
 * Exhaustive empirical verification of:
 * 1. 3D Ray intersections across multiple camera pitch angles (30°, 45°, 60°) and azimuth angles
 *    (0°, 90°, 180°, 270°) targeting diverse child meshes (table legs, cushions, lampshade, staged books, slats, plant leaves).
 * 2. Complete upward scene graph resolution from deeply nested child meshes to root furniture domain entity.
 * 3. Deselection triggers: empty floor plane click and background sky click.
 * 4. Pointer event disambiguation: stationary click vs orbit drag vs long press vs mouse button filtering.
 * 5. Selection wireframe lifecycle: single wireframe invariant, switch cleanup, deselect cleanup, raycast immunity.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { setupTestEnvironment } = require('./e2e/helpers');

describe('Empirical Challenger: 3D Direct Raycaster & Selection System', () => {
    let env;

    before(async () => {
        env = await setupTestEnvironment();
        // Activate 3D Viewport
        await env.page.click('#btn-view-3d');
        // Ensure 3D canvas and renderer are ready
        await env.page.waitForFunction(() => typeof Viewer3D !== 'undefined' && Viewer3D.renderer && Viewer3D.scene);
    });

    after(async () => {
        if (env) await env.cleanup();
    });

    test('Empirical Check 1: Multi-Angle (30°, 45°, 60° pitch) & Azimuth Raycasting against Child Meshes', async () => {
        const { page } = env;

        const results = await page.evaluate(() => {
            // Helper to cleanly reset scene and furniture without triggering phantom resurrects
            const clearScene = () => {
                selectItem(null, null);
                if (State.furniture && State.furniture.length > 0) {
                    State.furniture.forEach(f => Viewer3D.removeFurniture3D(f));
                }
                State.furniture = [];
                Viewer3D.furnitureMeshes.forEach(g => Viewer3D.scene.remove(g));
                Viewer3D.furnitureMeshes.clear();
            };

            const presetsToTest = [
                {
                    key: 'arc-lamp',
                    locateTargets: (group, f) => {
                        let shade = null;
                        let base = null;
                        group.traverse(c => {
                            if (c.isMesh && c.geometry && c.geometry.parameters) {
                                if (c.geometry.parameters.radius === Math.min(f.w * 0.4, 18)) shade = c;
                                if (c.geometry.parameters.height === 5) base = c;
                            }
                        });
                        return [
                            { label: 'ArcLamp_Shade', mesh: shade },
                            { label: 'ArcLamp_Base', mesh: base }
                        ];
                    }
                },
                {
                    key: 'lounge-chair',
                    locateTargets: (group) => {
                        let cushion = null;
                        let leg = null;
                        group.traverse(c => {
                            if (c.isMesh && c.geometry && c.geometry.parameters) {
                                if (c.geometry.parameters.height === 14) cushion = c;
                                if (c.geometry.parameters.radiusTop === 0.9) leg = c;
                            }
                        });
                        return [
                            { label: 'LoungeChair_Cushion', mesh: cushion },
                            { label: 'LoungeChair_Leg', mesh: leg }
                        ];
                    }
                },
                {
                    key: 'nightstand',
                    locateTargets: (group) => {
                        let book = null;
                        let hairpin = null;
                        group.traverse(c => {
                            if (c.isMesh && c.geometry && c.geometry.parameters) {
                                if (c.geometry.parameters.width === 16 && c.geometry.parameters.depth === 22) book = c;
                                if (c.geometry.parameters.radiusTop === 0.6) hairpin = c;
                            }
                        });
                        return [
                            { label: 'Nightstand_Book', mesh: book },
                            { label: 'Nightstand_HairpinLeg', mesh: hairpin }
                        ];
                    }
                },
                {
                    key: 'coffee-table-set',
                    locateTargets: (group) => {
                        let coffeeBook = null;
                        let secondaryTop = null;
                        group.traverse(c => {
                            if (c.isMesh && c.geometry && c.geometry.parameters) {
                                if (c.geometry.parameters.width === 14 && c.geometry.parameters.height === 0.8) coffeeBook = c;
                                if (c.geometry.parameters.radiusTop === 20) secondaryTop = c;
                            }
                        });
                        return [
                            { label: 'CoffeeTable_Book', mesh: coffeeBook },
                            { label: 'CoffeeTable_SecondaryTop', mesh: secondaryTop }
                        ];
                    }
                }
            ];

            const pitches = [30, 45, 60];
            const azimuths = [0, 90, 180, 270];
            const checkLog = [];
            let totalTargetsFound = 0;

            const dom = Viewer3D.renderer.domElement;
            const rect = dom.getBoundingClientRect();
            const clientX = rect.left + rect.width / 2;
            const clientY = rect.top + rect.height / 2;

            presetsToTest.forEach((cfg, idx) => {
                clearScene();

                const p = Presets[cfg.key];
                const f = {
                    id: `emp_f_${idx + 1}_${cfg.key}`,
                    presetKey: cfg.key,
                    name: p.name,
                    shape: p.shape,
                    w: p.w,
                    l: p.l,
                    h: p.h,
                    x: 250, // Squarely centered in room
                    y: 200,
                    rotation: 0,
                    elevation: 0,
                    color: p.color,
                    color3d: p.color3d
                };
                State.furniture.push(f);
                Viewer3D.updateFurniture3D(f);

                const group = Viewer3D.furnitureMeshes.get(f);
                const targets = cfg.locateTargets(group, f);

                targets.forEach(target => {
                    if (!target.mesh) return;
                    totalTargetsFound++;

                    target.mesh.geometry.computeBoundingBox();
                    const worldCenter = new THREE.Vector3();
                    target.mesh.geometry.boundingBox.getCenter(worldCenter);
                    target.mesh.localToWorld(worldCenter);

                    pitches.forEach(pitchDeg => {
                        azimuths.forEach(azimDeg => {
                            const pitchRad = (pitchDeg * Math.PI) / 180;
                            const azimRad = (azimDeg * Math.PI) / 180;
                            const R = 75; // Inside room bounds

                            const camX = worldCenter.x + R * Math.cos(pitchRad) * Math.cos(azimRad);
                            const camY = worldCenter.y + R * Math.sin(pitchRad);
                            const camZ = worldCenter.z + R * Math.cos(pitchRad) * Math.sin(azimRad);

                            Viewer3D.controls.target.copy(worldCenter);
                            Viewer3D.camera.position.set(camX, camY, camZ);
                            Viewer3D.controls.update();
                            Viewer3D.camera.updateMatrixWorld();

                            // Deselect first to ensure clean state transition
                            selectItem(null, null);

                            // Trigger click at viewport center
                            dom.dispatchEvent(new PointerEvent('pointerdown', { clientX, clientY, button: 0 }));
                            dom.dispatchEvent(new PointerEvent('pointerup', { clientX: clientX + 1, clientY: clientY + 1, button: 0 }));

                            const selected = State.selectedItem;
                            const ok = selected && selected.id === f.id;

                            checkLog.push({
                                target: target.label,
                                pitch: pitchDeg,
                                azimuth: azimDeg,
                                expectedId: f.id,
                                actualId: selected ? selected.id : null,
                                pass: ok
                            });
                        });
                    });
                });
            });

            return {
                targetsTested: totalTargetsFound,
                totalChecks: checkLog.length,
                passedChecks: checkLog.filter(c => c.pass).length,
                failures: checkLog.filter(c => !c.pass)
            };
        });

        assert.ok(results.targetsTested >= 6, `Must test at least 6 distinct child mesh targets, got ${results.targetsTested}`);
        assert.strictEqual(
            results.passedChecks,
            results.totalChecks,
            `All ${results.totalChecks} multi-angle child mesh raycast checks must pass. Failures: ${JSON.stringify(results.failures)}`
        );
    });

    test('Empirical Check 2: Empty Floor Click and Sky Click Deselection', async () => {
        const { page } = env;

        const results = await page.evaluate(() => {
            selectItem(null, null);
            State.furniture.forEach(f => Viewer3D.removeFurniture3D(f));
            State.furniture = [];
            Viewer3D.furnitureMeshes.clear();

            const p = Presets['sofa'];
            const f = {
                id: 'emp_floor_sofa',
                presetKey: 'sofa',
                name: p.name,
                shape: p.shape,
                w: p.w,
                l: p.l,
                h: p.h,
                x: 250,
                y: 200,
                rotation: 0,
                elevation: 0
            };
            State.furniture.push(f);
            Viewer3D.updateFurniture3D(f);

            const checks = [];

            // 1. Select furniture
            selectItem(f, 'furniture');
            checks.push({ step: 'init_select', selectedId: State.selectedItem ? State.selectedItem.id : null, pass: State.selectedItem === f });

            // 2. Click empty floor plane: point camera at floor at room corner (30, 30)
            const floorPt = new THREE.Vector3(30 - State.room.width / 2, 0, 30 - State.room.depth / 2);
            Viewer3D.controls.target.copy(floorPt);
            Viewer3D.camera.position.set(floorPt.x, 100, floorPt.z + 40);
            Viewer3D.controls.update();
            Viewer3D.camera.updateMatrixWorld();

            const rect = Viewer3D.renderer.domElement.getBoundingClientRect();
            const clientX = rect.left + rect.width / 2;
            const clientY = rect.top + rect.height / 2;
            const dom = Viewer3D.renderer.domElement;

            dom.dispatchEvent(new PointerEvent('pointerdown', { clientX, clientY, button: 0 }));
            dom.dispatchEvent(new PointerEvent('pointerup', { clientX: clientX + 1, clientY: clientY + 1, button: 0 }));

            checks.push({
                step: 'floor_click_deselect',
                selectedId: State.selectedItem ? State.selectedItem.id : null,
                pass: State.selectedItem === null
            });

            // 3. Select furniture again
            selectItem(f, 'furniture');
            checks.push({ step: 'reselect', selectedId: State.selectedItem ? State.selectedItem.id : null, pass: State.selectedItem === f });

            // 4. Click sky / empty space: point camera upwards at y = 3000
            const skyPt = new THREE.Vector3(0, 3000, 0);
            Viewer3D.controls.target.copy(skyPt);
            Viewer3D.camera.position.set(0, 400, 400);
            Viewer3D.controls.update();
            Viewer3D.camera.updateMatrixWorld();

            dom.dispatchEvent(new PointerEvent('pointerdown', { clientX, clientY, button: 0 }));
            dom.dispatchEvent(new PointerEvent('pointerup', { clientX: clientX + 1, clientY: clientY + 1, button: 0 }));

            checks.push({
                step: 'sky_click_deselect',
                selectedId: State.selectedItem ? State.selectedItem.id : null,
                pass: State.selectedItem === null
            });

            return checks;
        });

        results.forEach(c => {
            assert.strictEqual(c.pass, true, `Step ${c.step} failed: selectedId is ${c.selectedId}`);
        });
    });

    test('Empirical Check 3: Adversarial Pointer Event Disambiguation', async () => {
        const { page } = env;

        const results = await page.evaluate(async () => {
            selectItem(null, null);
            State.furniture.forEach(f => Viewer3D.removeFurniture3D(f));
            State.furniture = [];
            Viewer3D.furnitureMeshes.clear();

            const p = Presets['sofa'];
            const f = {
                id: 'emp_disambig_sofa',
                presetKey: 'sofa',
                name: p.name,
                shape: p.shape,
                w: p.w,
                l: p.l,
                h: p.h,
                x: 250,
                y: 200,
                rotation: 0,
                elevation: 0
            };
            State.furniture.push(f);
            Viewer3D.updateFurniture3D(f);

            const group = Viewer3D.furnitureMeshes.get(f);
            let targetMesh = null;
            group.traverse(c => { if (c.isMesh && !targetMesh) targetMesh = c; });
            targetMesh.geometry.computeBoundingBox();
            const center = new THREE.Vector3();
            targetMesh.geometry.boundingBox.getCenter(center);
            targetMesh.localToWorld(center);

            Viewer3D.controls.target.copy(center);
            Viewer3D.camera.position.set(center.x, center.y + 100, center.z + 80);
            Viewer3D.controls.update();
            Viewer3D.camera.updateMatrixWorld();

            const rect = Viewer3D.renderer.domElement.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const dom = Viewer3D.renderer.domElement;

            const runGesture = (btnDown, btnUp, dx, dy, timeOffset) => {
                selectItem(null, null); // Start unselected
                dom.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, button: btnDown }));
                if (Viewer3D.pointerDownTime && timeOffset) {
                    Viewer3D.pointerDownTime = performance.now() - timeOffset;
                }
                dom.dispatchEvent(new PointerEvent('pointerup', { clientX: cx + dx, clientY: cy + dy, button: btnUp }));
                return State.selectedItem ? State.selectedItem.id : null;
            };

            const checks = [];

            // A. Stationary click: 2px movement in 50ms -> MUST SELECT
            const r1 = runGesture(0, 0, 2, 0, 50);
            checks.push({ name: 'stationary_click_50ms', expected: f.id, actual: r1, pass: r1 === f.id });

            // B. Camera orbit drag: 15px movement in 200ms -> MUST NOT SELECT
            const r2 = runGesture(0, 0, 15, 0, 200);
            checks.push({ name: 'orbit_drag_15px', expected: null, actual: r2, pass: r2 === null });

            // C. Prolonged hold / long press: 2px movement in 600ms -> MUST NOT SELECT
            const r3 = runGesture(0, 0, 2, 0, 600);
            checks.push({ name: 'long_press_600ms', expected: null, actual: r3, pass: r3 === null });

            // D. Right-click: button 2 -> MUST NOT SELECT
            const r4 = runGesture(2, 2, 0, 0, 50);
            checks.push({ name: 'right_click_button2', expected: null, actual: r4, pass: r4 === null });

            // E. Middle-click: button 1 -> MUST NOT SELECT
            const r5 = runGesture(1, 1, 0, 0, 50);
            checks.push({ name: 'middle_click_button1', expected: null, actual: r5, pass: r5 === null });

            // F. Boundary valid: distance 5px (3, 4), duration 340ms <= 350ms -> MUST SELECT
            const r6 = runGesture(0, 0, 3, 4, 340);
            checks.push({ name: 'boundary_5px_340ms', expected: f.id, actual: r6, pass: r6 === f.id });

            // G. Boundary distance exceeded: distance 5.2px, 50ms -> MUST NOT SELECT
            const r7 = runGesture(0, 0, 5.2, 0, 50);
            checks.push({ name: 'boundary_distance_5.2px', expected: null, actual: r7, pass: r7 === null });

            // H. Boundary duration exceeded: 2px, duration 360ms > 350ms -> MUST NOT SELECT
            const r8 = runGesture(0, 0, 2, 0, 360);
            checks.push({ name: 'boundary_duration_360ms', expected: null, actual: r8, pass: r8 === null });

            return checks;
        });

        results.forEach(c => {
            assert.strictEqual(c.pass, true, `Gesture test "${c.name}" failed: expected ${c.expected}, got ${c.actual}`);
        });
    });

    test('Empirical Check 4: Selection Wireframe Lifecycle & Raycast Neutralization', async () => {
        const { page } = env;

        const results = await page.evaluate(() => {
            selectItem(null, null);
            State.furniture.forEach(f => Viewer3D.removeFurniture3D(f));
            State.furniture = [];
            Viewer3D.furnitureMeshes.clear();

            const presets = ['bed', 'wardrobe', 'desk'];
            const items = presets.map((k, i) => {
                const p = Presets[k];
                const f = {
                    id: `emp_wireframe_${k}_${i}`,
                    presetKey: k,
                    name: p.name,
                    shape: p.shape,
                    w: p.w,
                    l: p.l,
                    h: p.h,
                    x: 150 + i * 100,
                    y: 200,
                    rotation: 0,
                    elevation: 0
                };
                State.furniture.push(f);
                Viewer3D.updateFurniture3D(f);
                return f;
            });

            const [fA, fB, fC] = items;
            const gA = Viewer3D.furnitureMeshes.get(fA);
            const gB = Viewer3D.furnitureMeshes.get(fB);
            const gC = Viewer3D.furnitureMeshes.get(fC);

            const countIndicators = (g) => g ? g.children.filter(c => c.name === 'selectionIndicator').length : 0;

            const lifecycleLog = [];

            // 1. Initial Deselected State
            selectItem(null, null);
            lifecycleLog.push({
                stage: 'initial',
                active: State.selectedItem ? State.selectedItem.id : null,
                countA: countIndicators(gA),
                countB: countIndicators(gB),
                countC: countIndicators(gC),
                pass: countIndicators(gA) === 0 && countIndicators(gB) === 0 && countIndicators(gC) === 0
            });

            // 2. Select Item A -> exactly 1 wireframe on A, 0 on B and C
            selectItem(fA, 'furniture');
            const indA = gA.children.find(c => c.name === 'selectionIndicator');
            const dummyHits = [];
            if (indA && typeof indA.raycast === 'function') {
                indA.raycast({}, dummyHits);
            }

            lifecycleLog.push({
                stage: 'select_A',
                active: State.selectedItem ? State.selectedItem.id : null,
                countA: countIndicators(gA),
                countB: countIndicators(gB),
                countC: countIndicators(gC),
                raycastNeutralized: dummyHits.length === 0,
                pass: countIndicators(gA) === 1 && countIndicators(gB) === 0 && countIndicators(gC) === 0 && dummyHits.length === 0
            });

            // 3. Select Item B -> wireframe on B, stripped from A
            selectItem(fB, 'furniture');
            lifecycleLog.push({
                stage: 'select_B',
                active: State.selectedItem ? State.selectedItem.id : null,
                countA: countIndicators(gA),
                countB: countIndicators(gB),
                countC: countIndicators(gC),
                pass: countIndicators(gA) === 0 && countIndicators(gB) === 1 && countIndicators(gC) === 0
            });

            // 4. Repeated selection on Item B -> must not accumulate duplicate wireframes
            selectItem(fB, 'furniture');
            lifecycleLog.push({
                stage: 'reselect_B',
                active: State.selectedItem ? State.selectedItem.id : null,
                countA: countIndicators(gA),
                countB: countIndicators(gB),
                countC: countIndicators(gC),
                pass: countIndicators(gA) === 0 && countIndicators(gB) === 1 && countIndicators(gC) === 0
            });

            // 5. Select Item C
            selectItem(fC, 'furniture');
            lifecycleLog.push({
                stage: 'select_C',
                active: State.selectedItem ? State.selectedItem.id : null,
                countA: countIndicators(gA),
                countB: countIndicators(gB),
                countC: countIndicators(gC),
                pass: countIndicators(gA) === 0 && countIndicators(gB) === 0 && countIndicators(gC) === 1
            });

            // 6. Switch back to Item A
            selectItem(fA, 'furniture');
            lifecycleLog.push({
                stage: 'select_A_again',
                active: State.selectedItem ? State.selectedItem.id : null,
                countA: countIndicators(gA),
                countB: countIndicators(gB),
                countC: countIndicators(gC),
                pass: countIndicators(gA) === 1 && countIndicators(gB) === 0 && countIndicators(gC) === 0
            });

            // 7. Deselect -> zero wireframes remain across all items
            selectItem(null, null);
            lifecycleLog.push({
                stage: 'deselection',
                active: State.selectedItem ? State.selectedItem.id : null,
                countA: countIndicators(gA),
                countB: countIndicators(gB),
                countC: countIndicators(gC),
                pass: countIndicators(gA) === 0 && countIndicators(gB) === 0 && countIndicators(gC) === 0
            });

            return lifecycleLog;
        });

        results.forEach(step => {
            assert.strictEqual(step.pass, true, `Lifecycle stage "${step.stage}" failed: counts [A:${step.countA}, B:${step.countB}, C:${step.countC}]`);
        });
    });
});
