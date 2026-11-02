/**
 * RoomCraft — Milestone 3 Empirical Challenger Verification Suite:
 * Raycasting & Selection Lifecycle After Deletion Events
 * 
 * Exhaustively stress-tests:
 * 1. Exact-coordinate raycast invalidation after furniture deletion across all 7 new M3 presets + legacy presets:
 *    Raycasting at the exact coordinates of deleted items must hit floor or background, never deleted entities or phantom groups.
 * 2. Selection handoff to remaining items after single and cascading deletion events:
 *    Selecting an item, deleting it, and then clicking a remaining furniture item cleanly transfers selection and highlights the new item.
 * 3. Deselection by clicking empty floor plane or sky/background after deletion events.
 * 4. High-frequency adversarial randomized lifecycle stress harness (50 cycles) asserting scene graph & wireframe invariants.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { setupTestEnvironment } = require('./e2e/helpers');

describe('Empirical Challenger: 3D Raycasting & Selection Lifecycle After Deletion Events', () => {
    let env;

    before(async () => {
        env = await setupTestEnvironment();
        // Switch to 3D Viewport
        await env.page.click('#btn-view-3d');
        // Ensure 3D canvas and renderer are active
        await env.page.waitForFunction(() => typeof Viewer3D !== 'undefined' && Viewer3D.renderer && Viewer3D.scene);
    });

    after(async () => {
        if (env) await env.cleanup();
    });

    test('Empirical Check 1: Exact-Coordinate Raycast Invalidation After Furniture Deletion (All Presets)', async () => {
        const { page } = env;

        const results = await page.evaluate(() => {
            const clearScene = () => {
                selectItem(null, null);
                if (State.furniture && State.furniture.length > 0) {
                    State.furniture.forEach(f => Viewer3D.removeFurniture3D(f));
                }
                State.furniture = [];
                if (Viewer3D.furnitureMeshes) {
                    Viewer3D.furnitureMeshes.forEach(g => Viewer3D.scene.remove(g));
                    Viewer3D.furnitureMeshes.clear();
                }
            };

            const dom = Viewer3D.renderer.domElement;
            const rect = dom.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;

            const presetsToTest = [
                // 7 New M3 Presets
                'lounge-chair', 'bookshelf', 'coffee-table-set', 'tv-lowboard', 'arc-lamp', 'plant', 'nightstand',
                // Legacy Presets
                'chair', 'table', 'sofa', 'bed'
            ];

            const checkLog = [];

            presetsToTest.forEach((presetKey, idx) => {
                clearScene();

                const p = Presets[presetKey];
                const item = {
                    id: `emp_del_${presetKey}_${idx}`,
                    presetKey: presetKey,
                    name: p.name,
                    shape: p.shape,
                    w: p.w,
                    l: p.l,
                    h: p.h,
                    x: 250,
                    y: 200,
                    rotation: (idx * 30) % 360,
                    elevation: idx % 2 === 0 ? 0 : 20,
                    color: p.color,
                    color3d: p.color3d
                };

                State.furniture.push(item);
                Viewer3D.updateFurniture3D(item);
                Viewer3D.scene.updateMatrixWorld(true);

                const group = Viewer3D.furnitureMeshes.get(item);
                let targetMesh = null;
                group.traverse(c => {
                    if (c.isMesh && c.name !== 'selectionIndicator' && !targetMesh) {
                        targetMesh = c;
                    }
                });

                // Aim camera directly at the solid mesh component
                const worldTarget = new THREE.Vector3();
                targetMesh.geometry.computeBoundingBox();
                targetMesh.geometry.boundingBox.getCenter(worldTarget);
                targetMesh.localToWorld(worldTarget);

                Viewer3D.controls.target.copy(worldTarget);
                Viewer3D.camera.position.set(worldTarget.x, worldTarget.y + 60, worldTarget.z + 60);
                Viewer3D.controls.update();
                Viewer3D.camera.updateMatrixWorld();

                // 1. Click raycast to select the item
                dom.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, button: 0 }));
                dom.dispatchEvent(new PointerEvent('pointerup', { clientX: cx + 1, clientY: cy + 1, button: 0 }));

                const isSelectedBefore = State.selectedItem && State.selectedItem.id === item.id;
                const meshExistsBefore = Viewer3D.furnitureMeshes.has(item);
                const sceneHasGroupBefore = Viewer3D.scene.children.some(c => c.userData && c.userData.furniture === item);

                // 2. Delete the selected item via Editor2D.deleteSelected()
                Editor2D.deleteSelected();

                const inStateAfter = State.furniture.includes(item);
                const isSelectedAfter = State.selectedItem !== null;
                const meshExistsAfter = Viewer3D.furnitureMeshes.has(item);
                const sceneHasGroupAfter = Viewer3D.scene.children.some(c => c.userData && c.userData.furniture === item);

                // 3. Raycast at the EXACT same coordinates without moving camera or pointer
                // Direct Three.js raycaster check:
                const mouseVec = new THREE.Vector2(
                    ((cx - rect.left) / rect.width) * 2 - 1,
                    -((cy - rect.top) / rect.height) * 2 + 1
                );
                const raycaster = new THREE.Raycaster();
                raycaster.setFromCamera(mouseVec, Viewer3D.camera);

                const interactables = [];
                Viewer3D.furnitureMeshes.forEach(g => { if (g && g.visible !== false) interactables.push(g); });
                if (Viewer3D.wallMeshes) interactables.push(...Viewer3D.wallMeshes);
                if (Viewer3D.floorMesh) interactables.push(Viewer3D.floorMesh);

                const hits = raycaster.intersectObjects(interactables, true);
                const topHitObj = hits.length > 0 ? hits[0].object : null;

                // Check if any hit belongs to the deleted item
                const hitDeletedEntity = hits.some(h => {
                    let cur = h.object;
                    while (cur && cur !== Viewer3D.scene) {
                        if (cur.userData && (cur.userData.furniture === item || cur.userData.furnitureId === item.id)) {
                            return true;
                        }
                        cur = cur.parent;
                    }
                    return false;
                });

                // Top hit must be floorMesh
                const hitIsFloor = topHitObj === Viewer3D.floorMesh;

                // 4. Click event raycast on canvas at the exact coordinate
                dom.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, button: 0 }));
                dom.dispatchEvent(new PointerEvent('pointerup', { clientX: cx + 1, clientY: cy + 1, button: 0 }));

                const selectedAfterClick = State.selectedItem;
                const meshResurrected = Viewer3D.furnitureMeshes.has(item);

                // 5. Defensive check: direct updateFurniture3D invocation must NOT resurrect
                Viewer3D.updateFurniture3D(item);
                const meshResurrectedAfterDefensive = Viewer3D.furnitureMeshes.has(item);

                const pass = isSelectedBefore &&
                             meshExistsBefore &&
                             sceneHasGroupBefore &&
                             !inStateAfter &&
                             !isSelectedAfter &&
                             !meshExistsAfter &&
                             !sceneHasGroupAfter &&
                             !hitDeletedEntity &&
                             hitIsFloor &&
                             selectedAfterClick === null &&
                             !meshResurrected &&
                             !meshResurrectedAfterDefensive;

                checkLog.push({
                    preset: presetKey,
                    isSelectedBefore,
                    deletedCleanly: !inStateAfter && !isSelectedAfter && !meshExistsAfter && !sceneHasGroupAfter,
                    hitDeletedEntity,
                    hitIsFloor,
                    selectedAfterClick: selectedAfterClick ? selectedAfterClick.id : null,
                    meshResurrected,
                    meshResurrectedAfterDefensive,
                    pass
                });
            });

            return {
                totalPresets: presetsToTest.length,
                passedPresets: checkLog.filter(c => c.pass).length,
                failures: checkLog.filter(c => !c.pass)
            };
        });

        assert.strictEqual(
            results.passedPresets,
            results.totalPresets,
            `All ${results.totalPresets} presets must cleanly invalidate raycasting after deletion. Failures: ${JSON.stringify(results.failures)}`
        );
    });

    test('Empirical Check 2: Clean Selection Handoff to Remaining Furniture After Single & Cascading Deletions', async () => {
        const { page } = env;

        const results = await page.evaluate(() => {
            selectItem(null, null);
            State.furniture.forEach(f => Viewer3D.removeFurniture3D(f));
            State.furniture = [];
            Viewer3D.furnitureMeshes.clear();

            const pA = Presets['lounge-chair'];
            const itemA = { id: 'handoff_A', presetKey: 'lounge-chair', name: pA.name, shape: pA.shape, w: pA.w, l: pA.l, h: pA.h, x: 120, y: 150, rotation: 0, elevation: 0 };
            const pB = Presets['bookshelf'];
            const itemB = { id: 'handoff_B', presetKey: 'bookshelf', name: pB.name, shape: pB.shape, w: pB.w, l: pB.l, h: pB.h, x: 250, y: 200, rotation: 0, elevation: 0 };
            const pC = Presets['plant'];
            const itemC = { id: 'handoff_C', presetKey: 'plant', name: pC.name, shape: pC.shape, w: pC.w, l: pC.l, h: pC.h, x: 380, y: 250, rotation: 0, elevation: 0 };

            State.furniture = [itemA, itemB, itemC];
            Viewer3D.updateFurniture3D(itemA);
            Viewer3D.updateFurniture3D(itemB);
            Viewer3D.updateFurniture3D(itemC);
            Viewer3D.scene.updateMatrixWorld(true);

            const dom = Viewer3D.renderer.domElement;
            const rect = dom.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;

            const aimAndClickAt = (item) => {
                Viewer3D.scene.updateMatrixWorld(true);
                const group = Viewer3D.furnitureMeshes.get(item);
                let targetMesh = null;
                if (group) {
                    group.traverse(c => {
                        if (c.isMesh && c.name !== 'selectionIndicator' && !targetMesh) {
                            targetMesh = c;
                        }
                    });
                }

                let worldTarget;
                if (targetMesh) {
                    worldTarget = new THREE.Vector3();
                    targetMesh.geometry.computeBoundingBox();
                    targetMesh.geometry.boundingBox.getCenter(worldTarget);
                    targetMesh.localToWorld(worldTarget);
                } else {
                    worldTarget = new THREE.Vector3(
                        item.x + Viewer3D.roomOffset.x,
                        (item.elevation || 0) + item.h / 2,
                        item.y + Viewer3D.roomOffset.z
                    );
                }

                Viewer3D.controls.target.copy(worldTarget);
                Viewer3D.camera.position.set(worldTarget.x, worldTarget.y + 60, worldTarget.z + 60);
                Viewer3D.controls.update();
                Viewer3D.camera.updateMatrixWorld();

                dom.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, button: 0 }));
                dom.dispatchEvent(new PointerEvent('pointerup', { clientX: cx + 1, clientY: cy + 1, button: 0 }));
            };

            const countIndicators = (item) => {
                const group = Viewer3D.furnitureMeshes.get(item);
                if (!group) return 0;
                return group.children.filter(c => c.name === 'selectionIndicator').length;
            };

            const steps = [];

            // Step 1: Click Item A -> select Item A
            aimAndClickAt(itemA);
            steps.push({
                step: 'select_A',
                selectedId: State.selectedItem ? State.selectedItem.id : null,
                countA: countIndicators(itemA),
                countB: countIndicators(itemB),
                countC: countIndicators(itemC),
                pass: State.selectedItem === itemA && countIndicators(itemA) === 1 && countIndicators(itemB) === 0 && countIndicators(itemC) === 0
            });

            // Step 2: Delete Item A
            Editor2D.deleteSelected();
            steps.push({
                step: 'delete_A',
                selectedId: State.selectedItem ? State.selectedItem.id : null,
                countA: countIndicators(itemA),
                countB: countIndicators(itemB),
                countC: countIndicators(itemC),
                pass: State.selectedItem === null && countIndicators(itemA) === 0 && countIndicators(itemB) === 0 && countIndicators(itemC) === 0
            });

            // Step 3: Click Item B -> cleanly transfers selection to Item B
            aimAndClickAt(itemB);
            steps.push({
                step: 'select_B_after_delete_A',
                selectedId: State.selectedItem ? State.selectedItem.id : null,
                countA: countIndicators(itemA),
                countB: countIndicators(itemB),
                countC: countIndicators(itemC),
                pass: State.selectedItem === itemB && countIndicators(itemA) === 0 && countIndicators(itemB) === 1 && countIndicators(itemC) === 0
            });

            // Step 4: Click Item C -> cleanly switches selection to Item C
            aimAndClickAt(itemC);
            steps.push({
                step: 'switch_to_C',
                selectedId: State.selectedItem ? State.selectedItem.id : null,
                countA: countIndicators(itemA),
                countB: countIndicators(itemB),
                countC: countIndicators(itemC),
                pass: State.selectedItem === itemC && countIndicators(itemA) === 0 && countIndicators(itemB) === 0 && countIndicators(itemC) === 1
            });

            // Step 5: Delete Item C
            Editor2D.deleteSelected();
            steps.push({
                step: 'delete_C',
                selectedId: State.selectedItem ? State.selectedItem.id : null,
                countA: countIndicators(itemA),
                countB: countIndicators(itemB),
                countC: countIndicators(itemC),
                pass: State.selectedItem === null && countIndicators(itemA) === 0 && countIndicators(itemB) === 0 && countIndicators(itemC) === 0
            });

            // Step 6: Click back on Item B -> cleanly re-selects Item B
            aimAndClickAt(itemB);
            steps.push({
                step: 'reselect_B_after_delete_C',
                selectedId: State.selectedItem ? State.selectedItem.id : null,
                countA: countIndicators(itemA),
                countB: countIndicators(itemB),
                countC: countIndicators(itemC),
                pass: State.selectedItem === itemB && countIndicators(itemA) === 0 && countIndicators(itemB) === 1 && countIndicators(itemC) === 0
            });

            // Step 7: Delete Item B -> room empty
            Editor2D.deleteSelected();
            steps.push({
                step: 'delete_B',
                selectedId: State.selectedItem ? State.selectedItem.id : null,
                furnitureCount: State.furniture.length,
                furnitureMeshesSize: Viewer3D.furnitureMeshes.size,
                pass: State.selectedItem === null && State.furniture.length === 0 && Viewer3D.furnitureMeshes.size === 0
            });

            // Step 8: Click former locations of A, B, and C
            [itemA, itemB, itemC].forEach(item => {
                aimAndClickAt(item);
                steps.push({
                    step: `click_former_${item.id}`,
                    selectedId: State.selectedItem ? State.selectedItem.id : null,
                    pass: State.selectedItem === null && Viewer3D.furnitureMeshes.size === 0
                });
            });

            return steps;
        });

        results.forEach(step => {
            assert.strictEqual(step.pass, true, `Handoff step "${step.step}" failed: selectedId=${step.selectedId}`);
        });
    });

    test('Empirical Check 3: Deselecting by Clicking Empty Floor & Sky After Deletions', async () => {
        const { page } = env;

        const results = await page.evaluate(() => {
            selectItem(null, null);
            State.furniture.forEach(f => Viewer3D.removeFurniture3D(f));
            State.furniture = [];
            Viewer3D.furnitureMeshes.clear();

            const pS = Presets['sofa'];
            const itemSofa = { id: 'desel_sofa', presetKey: 'sofa', name: pS.name, shape: pS.shape, w: pS.w, l: pS.l, h: pS.h, x: 200, y: 180, rotation: 0, elevation: 0 };
            const pT = Presets['coffee-table-set'];
            const itemTable = { id: 'desel_table', presetKey: 'coffee-table-set', name: pT.name, shape: pT.shape, w: pT.w, l: pT.l, h: pT.h, x: 300, y: 250, rotation: 0, elevation: 0 };

            State.furniture = [itemSofa, itemTable];
            Viewer3D.updateFurniture3D(itemSofa);
            Viewer3D.updateFurniture3D(itemTable);
            Viewer3D.scene.updateMatrixWorld(true);

            const dom = Viewer3D.renderer.domElement;
            const rect = dom.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;

            const clickFloorCorner = () => {
                const floorPt = new THREE.Vector3(30 - State.room.width / 2, 0, 30 - State.room.depth / 2);
                Viewer3D.controls.target.copy(floorPt);
                Viewer3D.camera.position.set(floorPt.x, 100, floorPt.z + 40);
                Viewer3D.controls.update();
                Viewer3D.camera.updateMatrixWorld();

                dom.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, button: 0 }));
                dom.dispatchEvent(new PointerEvent('pointerup', { clientX: cx + 1, clientY: cy + 1, button: 0 }));
            };

            const clickSky = () => {
                const skyPt = new THREE.Vector3(0, 3500, 0);
                Viewer3D.controls.target.copy(skyPt);
                Viewer3D.camera.position.set(0, 400, 400);
                Viewer3D.controls.update();
                Viewer3D.camera.updateMatrixWorld();

                dom.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, button: 0 }));
                dom.dispatchEvent(new PointerEvent('pointerup', { clientX: cx + 1, clientY: cy + 1, button: 0 }));
            };

            const countAllIndicators = () => {
                let total = 0;
                Viewer3D.furnitureMeshes.forEach(g => {
                    if (g) total += g.children.filter(c => c.name === 'selectionIndicator').length;
                });
                return total;
            };

            const checks = [];

            // 1. Select Sofa, delete Sofa
            selectItem(itemSofa, 'furniture');
            Editor2D.deleteSelected();
            checks.push({ step: 'delete_sofa', selected: State.selectedItem, pass: State.selectedItem === null });

            // 2. Select Table
            selectItem(itemTable, 'furniture');
            checks.push({ step: 'select_table', selected: State.selectedItem ? State.selectedItem.id : null, indicators: countAllIndicators(), pass: State.selectedItem === itemTable && countAllIndicators() === 1 });

            // 3. Click empty floor -> Deselect table cleanly
            clickFloorCorner();
            checks.push({ step: 'click_floor_deselect', selected: State.selectedItem, indicators: countAllIndicators(), pass: State.selectedItem === null && countAllIndicators() === 0 });

            // 4. Select Table again, then delete Table
            selectItem(itemTable, 'furniture');
            Editor2D.deleteSelected();
            checks.push({ step: 'delete_table', selected: State.selectedItem, pass: State.selectedItem === null });

            // 5. Click floor again when scene is empty
            clickFloorCorner();
            checks.push({ step: 'click_floor_empty_scene', selected: State.selectedItem, indicators: countAllIndicators(), pass: State.selectedItem === null && countAllIndicators() === 0 });

            // 6. Click sky when scene is empty
            clickSky();
            checks.push({ step: 'click_sky_empty_scene', selected: State.selectedItem, indicators: countAllIndicators(), pass: State.selectedItem === null && countAllIndicators() === 0 });

            return checks;
        });

        results.forEach(c => {
            assert.strictEqual(c.pass, true, `Step ${c.step} failed: selected=${c.selected}, indicators=${c.indicators}`);
        });
    });

    test('Empirical Check 4: Adversarial Multi-Cycle Stress Harness (50 Randomized Lifecycle Cycles)', async () => {
        const { page } = env;

        const results = await page.evaluate(() => {
            const availableKeys = [
                'lounge-chair', 'bookshelf', 'coffee-table-set', 'tv-lowboard', 'arc-lamp', 'plant', 'nightstand',
                'chair', 'table', 'sofa', 'bed', 'wardrobe', 'desk'
            ];

            const dom = Viewer3D.renderer.domElement;
            const rect = dom.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;

            const clearAll = () => {
                selectItem(null, null);
                if (State.furniture && State.furniture.length > 0) {
                    State.furniture.forEach(f => Viewer3D.removeFurniture3D(f));
                }
                State.furniture = [];
                if (Viewer3D.furnitureMeshes) {
                    Viewer3D.furnitureMeshes.forEach(g => Viewer3D.scene.remove(g));
                    Viewer3D.furnitureMeshes.clear();
                }
            };

            const aimAndClickAt = (item) => {
                Viewer3D.scene.updateMatrixWorld(true);
                const group = Viewer3D.furnitureMeshes.get(item);
                let targetMesh = null;
                if (group) {
                    group.traverse(c => {
                        if (c.isMesh && c.name !== 'selectionIndicator' && !targetMesh) {
                            targetMesh = c;
                        }
                    });
                }

                let worldTarget;
                if (targetMesh) {
                    worldTarget = new THREE.Vector3();
                    targetMesh.geometry.computeBoundingBox();
                    targetMesh.geometry.boundingBox.getCenter(worldTarget);
                    targetMesh.localToWorld(worldTarget);
                } else {
                    worldTarget = new THREE.Vector3(
                        item.x + Viewer3D.roomOffset.x,
                        (item.elevation || 0) + item.h / 2,
                        item.y + Viewer3D.roomOffset.z
                    );
                }

                Viewer3D.controls.target.copy(worldTarget);
                // Position camera sufficiently close so ray doesn't intersect other furniture
                Viewer3D.camera.position.set(worldTarget.x, worldTarget.y + 45, worldTarget.z + 45);
                Viewer3D.controls.update();
                Viewer3D.camera.updateMatrixWorld();

                dom.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, button: 0 }));
                dom.dispatchEvent(new PointerEvent('pointerup', { clientX: cx + 1, clientY: cy + 1, button: 0 }));
            };

            let passedCycles = 0;
            const totalCycles = 50;
            const failureLog = [];

            for (let cycle = 0; cycle < totalCycles; cycle++) {
                clearAll();

                // Spawn 2 to 3 items well spaced in the room
                const count = 2 + (cycle % 2);
                const items = [];
                for (let i = 0; i < count; i++) {
                    const k = availableKeys[(cycle * 2 + i) % availableKeys.length];
                    const p = Presets[k];
                    const item = {
                        id: `cycle_${cycle}_item_${i}_${k}`,
                        presetKey: k,
                        name: p.name,
                        shape: p.shape,
                        w: p.w,
                        l: p.l,
                        h: p.h,
                        x: 100 + i * 160, // 160cm apart to avoid overlap/occlusion
                        y: 120 + i * 120,
                        rotation: (i * 45) % 360,
                        elevation: 0,
                        color: p.color,
                        color3d: p.color3d
                    };
                    State.furniture.push(item);
                    Viewer3D.updateFurniture3D(item);
                    items.push(item);
                }

                Viewer3D.scene.updateMatrixWorld(true);

                // Pick an item to select & delete
                const victim = items[0];
                const survivor = items[1];

                // Aim at victim and click
                aimAndClickAt(victim);
                const victimSelected = State.selectedItem === victim;

                // Delete victim
                Editor2D.deleteSelected();

                const deleteClean = !State.furniture.includes(victim) &&
                                    State.selectedItem === null &&
                                    !Viewer3D.furnitureMeshes.has(victim);

                // Raycast at victim's exact former position
                dom.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, button: 0 }));
                dom.dispatchEvent(new PointerEvent('pointerup', { clientX: cx + 1, clientY: cy + 1, button: 0 }));

                const noResurrectOnClick = State.selectedItem === null && !Viewer3D.furnitureMeshes.has(victim);

                // Now aim at survivor and click
                aimAndClickAt(survivor);
                const survivorSelected = State.selectedItem === survivor;

                // Click floor to deselect
                const floorPt = new THREE.Vector3(30 - State.room.width / 2, 0, 30 - State.room.depth / 2);
                Viewer3D.controls.target.copy(floorPt);
                Viewer3D.camera.position.set(floorPt.x, 100, floorPt.z + 40);
                Viewer3D.controls.update();
                Viewer3D.camera.updateMatrixWorld();

                dom.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, button: 0 }));
                dom.dispatchEvent(new PointerEvent('pointerup', { clientX: cx + 1, clientY: cy + 1, button: 0 }));

                const floorDeselected = State.selectedItem === null;

                // Defensive updateFurniture3D call on deleted victim
                Viewer3D.updateFurniture3D(victim);
                const defensiveNoResurrect = !Viewer3D.furnitureMeshes.has(victim);

                // Check scene graph invariants
                let totalIndicators = 0;
                Viewer3D.furnitureMeshes.forEach(g => {
                    if (g) totalIndicators += g.children.filter(c => c.name === 'selectionIndicator').length;
                });
                const meshSizeConsistent = Viewer3D.furnitureMeshes.size === State.furniture.length;

                const cyclePass = victimSelected &&
                                  deleteClean &&
                                  noResurrectOnClick &&
                                  survivorSelected &&
                                  floorDeselected &&
                                  defensiveNoResurrect &&
                                  totalIndicators === 0 &&
                                  meshSizeConsistent;

                if (cyclePass) {
                    passedCycles++;
                } else {
                    failureLog.push({
                        cycle,
                        victim: victim.id,
                        survivor: survivor.id,
                        victimSelected,
                        deleteClean,
                        noResurrectOnClick,
                        survivorSelected,
                        floorDeselected,
                        defensiveNoResurrect,
                        totalIndicators,
                        meshSizeConsistent
                    });
                }
            }

            return {
                totalCycles,
                passedCycles,
                failureLog
            };
        });

        assert.strictEqual(
            results.passedCycles,
            results.totalCycles,
            `All ${results.totalCycles} adversarial lifecycle stress cycles must pass. Failures: ${JSON.stringify(results.failureLog)}`
        );
    });
});
