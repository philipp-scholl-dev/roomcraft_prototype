const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { setupTestEnvironment } = require('./e2e/helpers');

describe('Empirical M5 Challenger: Properties Drawer Non-Occlusion, Lifecycle & Visual Tour Verification', () => {
    let env;
    const consoleErrors = [];

    before(async () => {
        env = await setupTestEnvironment();
        const { page } = env;

        page.on('console', msg => {
            if (msg.type() === 'error') {
                consoleErrors.push(msg.text());
            }
        });
        page.on('pageerror', err => {
            consoleErrors.push(err.message || String(err));
        });
    });

    after(async () => {
        if (env) await env.cleanup();
    });

    // =========================================================================
    // SUITE 1: PROPERTIES DRAWER NON-OCCLUSION & SIDEBAR INTERACTION STRESS
    // =========================================================================
    test('Scope 1: Properties panel non-occlusion and sidebar interaction across viewports', async () => {
        const { page } = env;

        const viewports = [
            { width: 1440, height: 900, name: 'Desktop 1440p' },
            { width: 1280, height: 800, name: 'Laptop 1280p' },
            { width: 1024, height: 768, name: 'Tablet 1024p' }
        ];

        for (const vp of viewports) {
            await page.setViewportSize({ width: vp.width, height: vp.height });
            await page.waitForTimeout(150);

            // Select first furniture item to open #properties-panel
            const opened = await page.evaluate(() => {
                if (!State || !State.furniture || State.furniture.length === 0) return false;
                selectItem(State.furniture[0], 'furniture');
                const panel = document.getElementById('properties-panel');
                return panel && panel.classList.contains('active');
            });
            assert.equal(opened, true, `Properties panel must be active in ${vp.name}`);
            await page.waitForTimeout(250); // wait for CSS transform transition

            // Evaluate geometric bounding boxes and overlap
            const metrics = await page.evaluate(() => {
                const sidebar = document.querySelector('.sidebar');
                const panel = document.getElementById('properties-panel');

                const sbRect = sidebar.getBoundingClientRect();
                const pRect = panel.getBoundingClientRect();

                // Compute axis-aligned intersection rectangle
                const overlapW = Math.max(0, Math.min(sbRect.right, pRect.right) - Math.max(sbRect.left, pRect.left));
                const overlapH = Math.max(0, Math.min(sbRect.bottom, pRect.bottom) - Math.max(sbRect.top, pRect.top));
                const intersectionArea = overlapW * overlapH;

                // Hit-testing on sidebar tabs
                const tabs = Array.from(document.querySelectorAll('.tab-btn')).map(btn => {
                    const r = btn.getBoundingClientRect();
                    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                    const pointerEvents = window.getComputedStyle(btn).pointerEvents;
                    return {
                        id: btn.dataset.tab,
                        hitSelfOrChild: btn.contains(hit),
                        hitTag: hit ? hit.tagName : null,
                        pointerEvents
                    };
                });

                return {
                    sidebar: { left: sbRect.left, right: sbRect.right, width: sbRect.width },
                    panel: { left: pRect.left, right: pRect.right, width: pRect.width },
                    overlapW,
                    overlapH,
                    intersectionArea,
                    tabs
                };
            });

            // 1. Verify zero overlap between sidebar and properties drawer
            assert.equal(
                metrics.intersectionArea,
                0,
                `Properties panel must NOT overlap sidebar in ${vp.name} (overlap area: ${metrics.intersectionArea}px²)`
            );
            assert.ok(
                metrics.panel.left >= metrics.sidebar.right,
                `Properties panel left (${metrics.panel.left}px) must be >= sidebar right (${metrics.sidebar.right}px) in ${vp.name}`
            );

            // 2. Verify sidebar tabs remain clickable and hit-testable
            for (const tab of metrics.tabs) {
                assert.equal(
                    tab.hitSelfOrChild,
                    true,
                    `Sidebar tab ${tab.id} must be directly hit-testable while properties drawer is active in ${vp.name}`
                );
                assert.notEqual(
                    tab.pointerEvents,
                    'none',
                    `Sidebar tab ${tab.id} must not have pointer-events: none`
                );
            }

            // 3. Test actual click interaction on sidebar while drawer is active
            // Switch to Furniture tab
            await page.click('.tab-btn[data-tab="tab-furniture"]');
            const furnitureTabActive = await page.evaluate(() => {
                const tab = document.querySelector('.tab-btn[data-tab="tab-furniture"]');
                const panel = document.getElementById('tab-furniture');
                return tab.classList.contains('active') && panel.classList.contains('active');
            });
            assert.equal(furnitureTabActive, true, `Should switch to furniture tab while drawer is open in ${vp.name}`);

            // Switch to Room tab
            await page.click('.tab-btn[data-tab="tab-room"]');
            const roomTabActive = await page.evaluate(() => {
                const tab = document.querySelector('.tab-btn[data-tab="tab-room"]');
                const panel = document.getElementById('tab-room');
                return tab.classList.contains('active') && panel.classList.contains('active');
            });
            assert.equal(roomTabActive, true, `Should switch to room tab while drawer is open in ${vp.name}`);

            // Clean up selection for next iteration
            await page.evaluate(() => selectItem(null, null));
            await page.waitForTimeout(100);
        }
    });

    // =========================================================================
    // SUITE 2: 50-CYCLE LIFECYCLE & ESCAPE KEY / CLOSE / DELETE STRESS HARNESS
    // =========================================================================
    test('Scope 2: 50 rapid cycles of item selection, Escape key dismissal, close button, and deletion', async () => {
        const { page } = env;

        // Reset to default standard viewport (1440x900)
        await page.setViewportSize({ width: 1440, height: 900 });

        // Ensure 3D view initialized so Viewer3D meshes are tracked
        await page.click('#btn-view-split');
        await page.waitForTimeout(300);

        const TOTAL_CYCLES = 50;
        let escapeCyclesPassed = 0;
        let closeBtnCyclesPassed = 0;
        let deleteCyclesPassed = 0;
        let mixedCyclesPassed = 0;

        for (let cycle = 1; cycle <= TOTAL_CYCLES; cycle++) {
            if (cycle <= 15) {
                // -------------------------------------------------------------
                // Sub-tier A (Cycles 1-15): Escape Key Dismissal
                // -------------------------------------------------------------
                const selected = await page.evaluate((c) => {
                    const idx = (c - 1) % State.furniture.length;
                    const item = State.furniture[idx];
                    selectItem(item, 'furniture');
                    const panel = document.getElementById('properties-panel');
                    return {
                        itemId: item.id,
                        selectedItemMatches: State.selectedItem === item,
                        panelActive: panel && panel.classList.contains('active')
                    };
                }, cycle);

                assert.equal(selected.selectedItemMatches, true, `Cycle ${cycle}: State.selectedItem must match item`);
                assert.equal(selected.panelActive, true, `Cycle ${cycle}: #properties-panel must have .active`);

                // Press Escape Key
                await page.keyboard.press('Escape');

                const dismissed = await page.evaluate(() => {
                    const panel = document.getElementById('properties-panel');
                    return {
                        selectedItem: State.selectedItem,
                        panelActive: panel && panel.classList.contains('active')
                    };
                });

                assert.equal(dismissed.selectedItem, null, `Cycle ${cycle}: State.selectedItem must be null after Escape`);
                assert.equal(dismissed.panelActive, false, `Cycle ${cycle}: #properties-panel must lose .active after Escape`);
                escapeCyclesPassed++;

            } else if (cycle <= 30) {
                // -------------------------------------------------------------
                // Sub-tier B (Cycles 16-30): Close Button Dismissal (#close-properties)
                // -------------------------------------------------------------
                const selected = await page.evaluate((c) => {
                    const idx = (c - 1) % State.furniture.length;
                    const item = State.furniture[idx];
                    selectItem(item, 'furniture');
                    const panel = document.getElementById('properties-panel');
                    return {
                        itemId: item.id,
                        panelActive: panel && panel.classList.contains('active')
                    };
                }, cycle);

                assert.equal(selected.panelActive, true, `Cycle ${cycle}: #properties-panel must be active before close click`);

                // Click the close button
                await page.click('#close-properties');

                const closed = await page.evaluate(() => {
                    const panel = document.getElementById('properties-panel');
                    return {
                        selectedItem: State.selectedItem,
                        panelActive: panel && panel.classList.contains('active')
                    };
                });

                assert.equal(closed.selectedItem, null, `Cycle ${cycle}: State.selectedItem must be null after close button click`);
                assert.equal(closed.panelActive, false, `Cycle ${cycle}: #properties-panel must not have .active after close button click`);
                closeBtnCyclesPassed++;

            } else if (cycle <= 45) {
                // -------------------------------------------------------------
                // Sub-tier C (Cycles 31-45): Add Item -> Select -> Delete Item
                // -------------------------------------------------------------
                const beforeCount = await page.evaluate(() => State.furniture.length);

                // Add an item programmatically or select existing
                const addedInfo = await page.evaluate((c) => {
                    const newItem = {
                        id: `stress_item_${c}_${Date.now()}`,
                        name: `Stress Piece ${c}`,
                        shape: 'rect',
                        w: 80,
                        l: 80,
                        h: 75,
                        x: 100 + (c * 7) % 200,
                        y: 100 + (c * 11) % 200,
                        rotation: 0,
                        color: 'hsl(215, 60%, 45%)',
                        color3d: 'hsl(215, 60%, 45%)',
                        collisionEnabled: true
                    };
                    State.furniture.push(newItem);
                    if (Viewer3D.renderer) Viewer3D.updateFurniture3D(newItem);
                    selectItem(newItem, 'furniture');

                    const meshExists = Viewer3D.furnitureMeshes.has(newItem);
                    const panelActive = document.getElementById('properties-panel').classList.contains('active');

                    return {
                        id: newItem.id,
                        meshExists,
                        panelActive,
                        meshMapSize: Viewer3D.furnitureMeshes.size
                    };
                }, cycle);

                assert.equal(addedInfo.meshExists, true, `Cycle ${cycle}: 3D mesh must be instantiated`);
                assert.equal(addedInfo.panelActive, true, `Cycle ${cycle}: Properties drawer must open for new item`);

                // Perform deletion via Editor2D.deleteSelected()
                const deletionResult = await page.evaluate((itemId) => {
                    const itemToDelete = State.furniture.find(f => f.id === itemId);
                    Editor2D.deleteSelected();

                    const itemStillInState = State.furniture.some(f => f.id === itemId);
                    const meshStillInMap = Viewer3D.furnitureMeshes.has(itemToDelete);
                    const panelActive = document.getElementById('properties-panel').classList.contains('active');
                    const selectedItem = State.selectedItem;

                    // Audit 3D scene children for ghost meshes
                    let ghostMeshInScene = false;
                    Viewer3D.scene.traverse(node => {
                        if (node.userData && node.userData.furniture && node.userData.furniture.id === itemId) {
                            ghostMeshInScene = true;
                        }
                    });

                    return {
                        itemStillInState,
                        meshStillInMap,
                        ghostMeshInScene,
                        panelActive,
                        selectedItem,
                        meshMapSize: Viewer3D.furnitureMeshes.size,
                        stateFurnitureCount: State.furniture.length
                    };
                }, addedInfo.id);

                assert.equal(deletionResult.itemStillInState, false, `Cycle ${cycle}: Deleted item must be removed from State.furniture`);
                assert.equal(deletionResult.meshStillInMap, false, `Cycle ${cycle}: Mesh must be deleted from Viewer3D.furnitureMeshes map`);
                assert.equal(deletionResult.ghostMeshInScene, false, `Cycle ${cycle}: Zero ghost meshes in Viewer3D.scene`);
                assert.equal(deletionResult.panelActive, false, `Cycle ${cycle}: Properties drawer must close cleanly on delete`);
                assert.equal(deletionResult.selectedItem, null, `Cycle ${cycle}: State.selectedItem must be null`);
                assert.equal(
                    deletionResult.meshMapSize,
                    deletionResult.stateFurnitureCount,
                    `Cycle ${cycle}: 3D mesh map size (${deletionResult.meshMapSize}) must match State.furniture length (${deletionResult.stateFurnitureCount})`
                );
                deleteCyclesPassed++;

            } else {
                // -------------------------------------------------------------
                // Sub-tier D (Cycles 46-50): Mixed rapid stress sequences
                // -------------------------------------------------------------
                const burstResult = await page.evaluate((c) => {
                    // 1. Create and select
                    const item = {
                        id: `burst_${c}`,
                        name: `Burst ${c}`,
                        shape: 'rect',
                        w: 90,
                        l: 90,
                        h: 80,
                        x: 200,
                        y: 200,
                        rotation: 0,
                        color: '#ff0055',
                        collisionEnabled: true
                    };
                    State.furniture.push(item);
                    if (Viewer3D.renderer) Viewer3D.updateFurniture3D(item);
                    selectItem(item, 'furniture');

                    // 2. Modify properties
                    item.w = 110;
                    item.rotation = 45;
                    Viewer3D.updateFurniture3D(item);

                    // 3. Escape dismissal
                    selectItem(null, null);
                    const panelClosed1 = !document.getElementById('properties-panel').classList.contains('active');

                    // 4. Re-select
                    selectItem(item, 'furniture');
                    const panelOpen2 = document.getElementById('properties-panel').classList.contains('active');

                    // 5. Delete
                    Editor2D.deleteSelected();
                    const panelClosed2 = !document.getElementById('properties-panel').classList.contains('active');
                    const meshGone = !Viewer3D.furnitureMeshes.has(item);

                    return {
                        panelClosed1,
                        panelOpen2,
                        panelClosed2,
                        meshGone,
                        meshMapSize: Viewer3D.furnitureMeshes.size,
                        stateCount: State.furniture.length
                    };
                }, cycle);

                assert.equal(burstResult.panelClosed1, true, `Cycle ${cycle}: Panel must close on null select`);
                assert.equal(burstResult.panelOpen2, true, `Cycle ${cycle}: Panel must reopen on re-select`);
                assert.equal(burstResult.panelClosed2, true, `Cycle ${cycle}: Panel must close on delete`);
                assert.equal(burstResult.meshGone, true, `Cycle ${cycle}: Mesh must be purged`);
                assert.equal(burstResult.meshMapSize, burstResult.stateCount, `Cycle ${cycle}: Mesh map size must match state count`);
                mixedCyclesPassed++;
            }
        }

        assert.equal(escapeCyclesPassed, 15, 'All 15 Escape dismissal cycles must pass');
        assert.equal(closeBtnCyclesPassed, 15, 'All 15 Close button cycles must pass');
        assert.equal(deleteCyclesPassed, 15, 'All 15 Deletion cycles must pass');
        assert.equal(mixedCyclesPassed, 5, 'All 5 Mixed rapid burst cycles must pass');
        assert.equal(escapeCyclesPassed + closeBtnCyclesPassed + deleteCyclesPassed + mixedCyclesPassed, 50, 'Total 50 cycles must complete');

        // Audit final 3D scene state for zero ghost or orphaned meshes
        const finalAudit = await page.evaluate(() => {
            const stateIds = new Set(State.furniture.map(f => f.id));
            let ghostCount = 0;
            const ghostIds = [];

            Viewer3D.scene.traverse(node => {
                if (node.userData && node.userData.furniture) {
                    if (!stateIds.has(node.userData.furniture.id)) {
                        ghostCount++;
                        ghostIds.push(node.userData.furniture.id);
                    }
                }
            });

            return {
                furnitureCount: State.furniture.length,
                meshMapSize: Viewer3D.furnitureMeshes.size,
                ghostCount,
                ghostIds,
                selectedItem: State.selectedItem,
                panelActive: document.getElementById('properties-panel').classList.contains('active')
            };
        });

        assert.equal(finalAudit.ghostCount, 0, `Audit: Expected 0 ghost meshes, found ${finalAudit.ghostCount} (${finalAudit.ghostIds.join(', ')})`);
        assert.equal(finalAudit.meshMapSize, finalAudit.furnitureCount, 'Audit: Mesh map size must equal State.furniture length');
        assert.equal(finalAudit.selectedItem, null, 'Audit: State.selectedItem must be null at conclusion');
        assert.equal(finalAudit.panelActive, false, 'Audit: Properties panel must be closed at conclusion');
        assert.equal(consoleErrors.length, 0, `Zero console errors expected, but got: ${consoleErrors.join('; ')}`);
    });

    // =========================================================================
    // SUITE 3: VISUAL TOUR SCRIPT EXECUTION & SCREENSHOT ARTIFACT VERIFICATION
    // =========================================================================
    test('Scope 3: Visual tour screenshots exist, are >50KB, and valid PNG format', async () => {
        const screenshotDir = path.resolve(__dirname, 'artifacts/screenshots');
        const expectedScreenshots = [
            '01_2d_floorplan_dark.png',
            '02_2d_floorplan_light.png',
            '03_3d_realistic_view.png',
            '04_split_view_snapping_radar.png',
            '05_bom_modal_dialog.png',
            '06_properties_drawer_inspector.png'
        ];

        const MIN_SIZE_BYTES = 50 * 1024; // 50 KB = 51,200 bytes

        for (const filename of expectedScreenshots) {
            const filePath = path.join(screenshotDir, filename);
            assert.ok(fs.existsSync(filePath), `Screenshot file ${filename} must exist at ${filePath}`);

            const stat = fs.statSync(filePath);
            assert.ok(
                stat.size >= MIN_SIZE_BYTES,
                `Screenshot ${filename} size (${stat.size} bytes / ${(stat.size / 1024).toFixed(2)} KB) must be >= 50KB (${MIN_SIZE_BYTES} bytes)`
            );

            // Verify PNG magic bytes (\x89PNG\r\n\x1a\n)
            const buffer = Buffer.alloc(8);
            const fd = fs.openSync(filePath, 'r');
            fs.readSync(fd, buffer, 0, 8, 0);
            fs.closeSync(fd);

            const isPNG = buffer[0] === 0x89 &&
                          buffer[1] === 0x50 && // P
                          buffer[2] === 0x4e && // N
                          buffer[3] === 0x47 && // G
                          buffer[4] === 0x0d && // \r
                          buffer[5] === 0x0a && // \n
                          buffer[6] === 0x1a && // Ctrl-Z
                          buffer[7] === 0x0a;   // \n
            assert.equal(isPNG, true, `Screenshot ${filename} must be a valid PNG binary`);
        }
    });

    // =========================================================================
    // SUITE 4: ADVERSARIAL BOUNDARIES & HOSTILE INPUT RESILIENCE
    // =========================================================================
    test('Scope 4: Adversarial boundary stress: redundant dismissals, locked item handling, and dynamic resize', async () => {
        const { page } = env;

        // 1. Redundant Escape key when nothing is selected
        await page.evaluate(() => selectItem(null, null));
        await page.waitForTimeout(250); // wait for 0.18s CSS transition
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');
        const unselectedState = await page.evaluate(() => ({
            selected: State.selectedItem,
            panelActive: document.getElementById('properties-panel').classList.contains('active')
        }));
        assert.equal(unselectedState.selected, null);
        assert.equal(unselectedState.panelActive, false);

        // 2. Closed drawer pointer-events suppression and redundant event safety
        const pointerState = await page.evaluate(() => {
            const panel = document.getElementById('properties-panel');
            const closeBtn = document.getElementById('close-properties');
            const cs = window.getComputedStyle(panel);
            // Attempt redundant click via DOM API to verify no exceptions thrown
            if (closeBtn) closeBtn.click();
            return {
                pointerEvents: cs.pointerEvents,
                opacity: parseFloat(cs.opacity),
                panelActive: panel.classList.contains('active'),
                selectedItem: State.selectedItem
            };
        });
        assert.equal(pointerState.pointerEvents, 'none', 'Closed drawer must have pointer-events: none');
        assert.ok(pointerState.opacity < 0.05, 'Closed drawer must reach opacity ~0');
        assert.equal(pointerState.selectedItem, null, 'State.selectedItem must remain null');
        assert.equal(pointerState.panelActive, false, 'Panel must remain inactive');

        // 3. Locked furniture item dismissals
        const lockedTest = await page.evaluate(() => {
            if (!State.furniture || State.furniture.length === 0) return null;
            const item = State.furniture[0];
            item.locked = true;
            selectItem(item, 'furniture');
            const panel = document.getElementById('properties-panel');
            const nameInput = document.getElementById('prop-name');
            return {
                panelActive: panel && panel.classList.contains('active'),
                nameInputDisabled: nameInput ? nameInput.disabled : false
            };
        });
        assert.equal(lockedTest.panelActive, true, 'Drawer opens for locked item');
        assert.equal(lockedTest.nameInputDisabled, true, 'Inputs are disabled for locked item');

        // Escape dismissal of locked item
        await page.keyboard.press('Escape');
        const lockedEscapeResult = await page.evaluate(() => ({
            selected: State.selectedItem,
            panelActive: document.getElementById('properties-panel').classList.contains('active')
        }));
        assert.equal(lockedEscapeResult.selected, null, 'Locked item deselects via Escape');
        assert.equal(lockedEscapeResult.panelActive, false, 'Panel closes on locked item Escape');

        // Re-select locked item and test close button
        await page.evaluate(() => selectItem(State.furniture[0], 'furniture'));
        await page.click('#close-properties');
        const lockedCloseResult = await page.evaluate(() => {
            State.furniture[0].locked = false; // Restore unlocked state
            return {
                selected: State.selectedItem,
                panelActive: document.getElementById('properties-panel').classList.contains('active')
            };
        });
        assert.equal(lockedCloseResult.selected, null, 'Locked item deselects via close button');
        assert.equal(lockedCloseResult.panelActive, false, 'Panel closes on locked item close button');

        // 4. Dynamic window resizing while properties drawer is actively open
        await page.evaluate(() => selectItem(State.furniture[0], 'furniture'));

        const dynamicSizes = [
            { w: 1600, h: 900 },
            { w: 1440, h: 900 },
            { w: 1280, h: 800 },
            { w: 1024, h: 768 }
        ];

        for (const sz of dynamicSizes) {
            await page.setViewportSize({ width: sz.w, height: sz.h });
            await page.waitForTimeout(100);

            const check = await page.evaluate((viewportW) => {
                const sb = document.querySelector('.sidebar').getBoundingClientRect();
                const p = document.getElementById('properties-panel').getBoundingClientRect();

                const overlapW = Math.max(0, Math.min(sb.right, p.right) - Math.max(sb.left, p.left));
                const overlapH = Math.max(0, Math.min(sb.bottom, p.bottom) - Math.max(sb.top, p.top));
                const overlapArea = overlapW * overlapH;

                return {
                    overlapArea,
                    panelInsideWindow: p.right <= viewportW + 2 && p.left >= 0,
                    sidebarRight: sb.right,
                    panelLeft: p.left
                };
            }, sz.w);

            assert.equal(check.overlapArea, 0, `No overlap during dynamic resize to ${sz.w}x${sz.h}`);
            assert.ok(check.panelLeft >= check.sidebarRight, `Panel (${check.panelLeft}px) right of sidebar (${check.sidebarRight}px)`);
        }

        // Final cleanup
        await page.keyboard.press('Escape');
    });
});
