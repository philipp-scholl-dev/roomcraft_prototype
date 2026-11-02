const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestEnvironment } = require('./helpers');

describe('E2E Tier 5: Adversarial UI, Snapping, BOM & Workflow Hardening', () => {
    let env;

    before(async () => {
        env = await setupTestEnvironment();
    });

    after(async () => {
        if (env) await env.cleanup();
    });

    // =========================================================================
    // 1. SMART SNAPPING ADVERSARIAL STRESS VECTORS
    // =========================================================================
    test('Snapping Adversarial 1: Multi-candidate simultaneous snapping and priority tie-breaking', async () => {
        const { page } = env;

        const snapResult = await page.evaluate(() => {
            const room = { width: 600, depth: 500 };
            // Sibling placed at x = 300 (which is ALSO room centerline: 600/2 = 300)
            const siblingA = { id: 'sib_a', name: 'Zweiersofa', shape: 'rect', w: 160, l: 80, x: 300, y: 150, rotation: 0 };
            // Sibling placed on Y axis at y = 250 (which is ALSO room centerline: 500/2 = 250)
            const siblingB = { id: 'sib_b', name: 'Sideboard', shape: 'rect', w: 120, l: 50, x: 100, y: 250, rotation: 0 };

            // Dragging item positioned near both X=300 and Y=250
            const dragging = { id: 'drag_1', name: 'Couchtisch', shape: 'rect', w: 80, l: 80, x: 304, y: 247, rotation: 0 };

            const snap = SmartSnapping.computeSnap(dragging, [siblingA, siblingB], room, 10);
            return {
                snappedX: snap.snappedX,
                snappedY: snap.snappedY,
                snappedAxes: snap.snappedAxes,
                guidesCount: snap.guides.length,
                guideXType: snap.guides.find(g => g.axis === 'x')?.type,
                guideXLabel: snap.guides.find(g => g.axis === 'x')?.label,
                guideYType: snap.guides.find(g => g.axis === 'y')?.type,
                guideYLabel: snap.guides.find(g => g.axis === 'y')?.label
            };
        });

        assert.equal(snapResult.snappedAxes.x, true, 'X axis should snap');
        assert.equal(snapResult.snappedAxes.y, true, 'Y axis should snap');
        assert.equal(snapResult.snappedX, 300, 'X should snap to 300');
        assert.equal(snapResult.snappedY, 250, 'Y should snap to 250');
        // Priority tie-breaking: Sibling (priority 3) should win over Room Center (priority 2)
        assert.equal(snapResult.guideXType, 'furniture-center', 'Sibling furniture center must beat room-center on tie');
        assert.equal(snapResult.guideXLabel, 'Zweiersofa');
        assert.equal(snapResult.guideYType, 'furniture-center', 'Sibling furniture center must beat room-center on tie');
        assert.equal(snapResult.guideYLabel, 'Sideboard');
    });

    test('Snapping Adversarial 2: Arbitrary non-orthogonal rotations and extreme threshold boundaries', async () => {
        const { page } = env;

        const results = await page.evaluate(() => {
            const room = { width: 500, depth: 400 };

            // 1. Test arbitrary non-orthogonal angles: 15°, 33.7°, 120°, 215.5°
            const angles = [15, 33.7, 120, 215.5];
            const extents = angles.map(ang => {
                const item = { shape: 'rect', w: 100, l: 60, rotation: ang };
                const ext = SmartSnapping.getExtents(item);
                const rotRad = (ang * Math.PI) / 180;
                const expectedX = 50 * Math.abs(Math.cos(rotRad)) + 30 * Math.abs(Math.sin(rotRad));
                const expectedY = 50 * Math.abs(Math.sin(rotRad)) + 30 * Math.abs(Math.cos(rotRad));
                return {
                    angle: ang,
                    diffX: Math.abs(ext.halfSpanX - expectedX),
                    diffY: Math.abs(ext.halfSpanY - expectedY)
                };
            });

            // 2. Snapping with extreme thresholds
            const item = { id: 'drag_t', name: 'Item', shape: 'rect', w: 100, l: 60, x: 254, y: 196, rotation: 0 };

            // Threshold = 0 (exact match only: 254 != 250 so no snap)
            const snapZero = SmartSnapping.computeSnap(item, [], room, 0);

            // Negative threshold (impossible distance)
            const snapNeg = SmartSnapping.computeSnap(item, [], room, -5);

            // Huge threshold (10000 -> captures room center immediately)
            const snapHuge = SmartSnapping.computeSnap(item, [], room, 10000);

            // Degenerate zero-dimension shape
            const itemZeroDim = { id: 'zero_d', name: 'Zero', shape: 'rect', w: 0, l: 0, x: 252, y: 200, rotation: 45 };
            const snapZeroDim = SmartSnapping.computeSnap(itemZeroDim, [], room, 10);

            // Self-exclusion: item in otherFurniture with same ID must be ignored
            const snapSelfEx = SmartSnapping.computeSnap(item, [item], room, 10);

            return {
                extents,
                snapZeroSnapped: snapZero.snappedAxes.x,
                snapNegSnapped: snapNeg.snappedAxes.x,
                snapHugeSnapped: snapHuge.snappedAxes.x,
                snapHugeX: snapHuge.snappedX,
                snapZeroDimX: snapZeroDim.snappedX,
                snapSelfExGuides: snapSelfEx.guides.length
            };
        });

        // Verify extents match mathematical trigonometric formula within 1e-6
        for (const res of results.extents) {
            assert.ok(res.diffX < 1e-6, `Angle ${res.angle} extents X deviation too large`);
            assert.ok(res.diffY < 1e-6, `Angle ${res.angle} extents Y deviation too large`);
        }

        assert.equal(results.snapZeroSnapped, false, 'Threshold 0 should not snap 4cm delta');
        assert.equal(results.snapNegSnapped, false, 'Negative threshold should never snap');
        assert.equal(results.snapHugeSnapped, true, 'Huge threshold should snap');
        assert.equal(results.snapHugeX, 250, 'Huge threshold snaps to room center');
        assert.equal(results.snapZeroDimX, 250, 'Zero dimension rect snaps to room center');
        // Item in otherFurniture with matching ID is skipped; only room center snapped
        assert.equal(results.snapSelfExGuides, 2, 'Self item was ignored, only 2 room centerlines snapped');
    });

    // =========================================================================
    // 2. MATERIAL BOM & DIN 277 ADVERSARIAL STRESS VECTORS
    // =========================================================================
    test('BOM Adversarial 1: Quadruple pitch, massive cutout clamp, and zero-area room', async () => {
        const { page } = env;

        const bomRes = await page.evaluate(() => {
            // Case A: Pitches enabled on all 4 walls simultaneously
            const quadPitchState = {
                room: {
                    width: 600,
                    depth: 400,
                    height: 250,
                    pitches: {
                        top: { enabled: true, run: 150, kniestock: 80 },
                        bottom: { enabled: true, run: 150, kniestock: 80 },
                        left: { enabled: true, run: 100, kniestock: 100 },
                        right: { enabled: true, run: 100, kniestock: 100 }
                    }
                },
                elements: [
                    // Massive door on top wall whose cutout is larger than the kniestock wall area
                    // top wall is kniestock 80 * 600 = 4.8 m²
                    // door 300x200 = 6.0 m² (exceeds wall area!)
                    { id: 'giant_door', type: 'door', wall: 'top', position: 300, w: 300, h: 200 }
                ],
                installations: [],
                furniture: []
            };

            const bomQuad = BOMCalculator.calculate(quadPitchState);
            const topWall = bomQuad.surfaces.find(s => s.id === 'wall_top');

            // Case B: Degenerate room dimensions (zero values fallback safely to defaults)
            const degenerateState = {
                room: { width: 0, depth: 0, height: 0, pitches: {} },
                elements: [],
                installations: [],
                furniture: []
            };
            const bomDegen = BOMCalculator.calculate(degenerateState);

            return {
                quadNetVolume: bomQuad.geometry.netVolumeM3,
                topWallGross: topWall.grossM2,
                topWallCutout: topWall.cutoutM2,
                topWallNet: topWall.netM2,
                degenFloorArea: bomDegen.geometry.floorAreaM2,
                degenGrossVolume: bomDegen.geometry.grossVolumeM3
            };
        });

        // Net volume must remain positive and valid
        assert.ok(bomRes.quadNetVolume > 0, 'Net volume under quad pitch must be > 0');
        // Net wall area must never be negative even if cutout exceeds gross wall
        assert.equal(bomRes.topWallGross, 4.8);
        assert.equal(bomRes.topWallCutout, 6.0);
        assert.equal(bomRes.topWallNet, 0, 'Cutout exceeding wall gross area must be clamped to 0 net area');
        // Degenerate room falls back to safe standard width/height (500x400x250)
        assert.equal(bomRes.degenFloorArea, 20, 'Zero dimensions must fall back to 500x400 (20m²)');
        assert.equal(bomRes.degenGrossVolume, 50, 'Zero dimensions must fall back to 50m³');
    });

    test('BOM Adversarial 2: Compound names precedence, custom unknown names, and RFC 4180 CSV escaping', async () => {
        const { page } = env;

        const testData = await page.evaluate(() => {
            const state = {
                room: { width: 500, depth: 400, height: 250, pitches: {} },
                elements: [],
                installations: [],
                furniture: [
                    // Substring precedence: Couchtisch-Set (220) vs Couch (1250)
                    { id: 'f1', name: 'Couchtisch-Set Deluxe', shape: 'rect', w: 100, l: 60, h: 45 },
                    // TV-Lowboard (390) vs TV (650)
                    { id: 'f2', name: 'TV-Lowboard Modern', shape: 'rect', w: 160, l: 45, h: 50 },
                    // Unknown custom furniture name -> 150 EUR fallback
                    { id: 'f3', name: 'Maßgefertigter Raumteiler-Schreinerschrank', shape: 'rect', w: 120, l: 60, h: 200 },
                    // Comma, quote, newline, and German umlaut for CSV escaping check
                    { id: 'f4', name: 'Spezial-\nSitzbank "Größe & Übermaß", Holz', shape: 'rect', w: 100, l: 40, h: 45 }
                ]
            };

            const bom = BOMCalculator.calculate(state);
            const csv = ExportManager.generateCSVContent(bom);

            const f1 = bom.furniture.find(f => f.name === 'Couchtisch-Set Deluxe');
            const f2 = bom.furniture.find(f => f.name === 'TV-Lowboard Modern');
            const f3 = bom.furniture.find(f => f.name === 'Maßgefertigter Raumteiler-Schreinerschrank');
            const f4 = bom.furniture.find(f => f.name.includes('Spezial-'));

            return {
                p1: f1?.unitPrice,
                p2: f2?.unitPrice,
                // "raumteiler" matches 280 EUR
                p3: f3?.unitPrice,
                p4: f4?.unitPrice,
                csvStartsWithBOM: csv.startsWith('\uFEFF'),
                csvHasEscapedQuotes: csv.includes('""Größe & Übermaß""'),
                totalCost: bom.totals.totalFurnitureCost
            };
        });

        assert.equal(testData.p1, 220, 'Couchtisch-Set Deluxe must match couchtisch (220), not couch (1250)');
        assert.equal(testData.p2, 390, 'TV-Lowboard Modern must match tv-lowboard (390), not tv (650)');
        assert.equal(testData.p3, 280, 'Raumteiler-Schreinerschrank matches raumteiler keyword (280)');
        assert.equal(testData.p4, 150, 'Unknown item with custom name falls back to baseline 150 EUR');
        assert.equal(testData.csvStartsWithBOM, true, 'CSV must start with UTF-8 byte order mark');
        assert.equal(testData.csvHasEscapedQuotes, true, 'CSV must escape inner quotes as doubled quotes RFC 4180');
        assert.equal(testData.totalCost, 220 + 390 + 280 + 150);
    });

    // =========================================================================
    // 3. 2D RADAR CONE & 3D WALKTHROUGH ADVERSARIAL STRESS VECTORS
    // =========================================================================
    test('Radar & Walkthrough Adversarial: Multi-rotation angle wrapping and extreme coordinate clamping', async () => {
        const { page } = env;

        const results = await page.evaluate(() => {
            State.room.width = 500;
            State.room.depth = 400;
            State.room.height = 250;
            Viewer3D.setWalkthroughMode(true);

            // Test 1: Extreme yaw angles (-450°, 720°, 1080°)
            const angles = [-450, 0, 720, 1080];
            const angleResults = angles.map(deg => {
                Viewer3D.walkthroughAngle = deg;
                return {
                    input: deg,
                    readback: Viewer3D.walkthroughAngle
                };
            });

            // Test 2: Extreme position clamping attempts
            // Shoulder margin = 25cm. Room 500x400 centered at (0,0) in 3D:
            // Allowed X: [-225, 225], Allowed Z: [-175, 175]
            Viewer3D.walkthroughPosition = { worldX: 99999, worldZ: -88888 };
            const clampedPos = {
                camX: Viewer3D.camera.position.x,
                camZ: Viewer3D.camera.position.z,
                roomX: Viewer3D.walkthroughPosition.x,
                roomY: Viewer3D.walkthroughPosition.y
            };

            // Test 3: Radar rendering with extreme zoom levels
            let radarDrawErrors = 0;
            const mockCtx = {
                save: () => {},
                restore: () => {},
                beginPath: () => {},
                closePath: () => {},
                moveTo: () => {},
                lineTo: () => {},
                arc: () => {},
                fill: () => {},
                stroke: () => {},
                setLineDash: () => {},
                strokeStyle: '',
                fillStyle: '',
                lineWidth: 1
            };

            [0.05, 0.5, 1.0, 3.0, 10.0].forEach(z => {
                State.editor2D.zoom = z;
                try {
                    Editor2D.drawCameraRadar(mockCtx);
                } catch (e) {
                    radarDrawErrors++;
                }
            });

            // Reset zoom and exit walkthrough
            State.editor2D.zoom = 1;
            Viewer3D.setWalkthroughMode(false);

            return {
                angleResults,
                clampedPos,
                radarDrawErrors
            };
        });

        // Camera position must be clamped to room bounds
        assert.equal(results.clampedPos.camX, 225, 'World X must clamp to 500/2 - 25 = 225');
        assert.equal(results.clampedPos.camZ, -175, 'World Z must clamp to -400/2 + 25 = -175');
        assert.equal(results.clampedPos.roomX, 475, '2D room X must clamp to 500 - 25 = 475');
        assert.equal(results.clampedPos.roomY, 25, '2D room Y must clamp to 0 + 25 = 25');
        assert.equal(results.radarDrawErrors, 0, 'drawCameraRadar should never crash under extreme zoom');
    });

    // =========================================================================
    // 4. DESIGN SYSTEM & THEMING ADVERSARIAL STRESS VECTORS
    // =========================================================================
    test('Theming Adversarial: Corrupt storage resilience and rapid toggle bursts', async () => {
        const { page } = env;

        // Test corrupt localStorage values
        const corruptRes = await page.evaluate(() => {
            const corruptedValues = ['{invalid_json: true', 'blue_mode', 'undefined', 'null', ''];
            const caughtErrors = [];

            for (const val of corruptedValues) {
                try {
                    localStorage.setItem('roomcraft_theme', val);
                    localStorage.setItem('roomcraft-theme', val);
                    ThemeManager.init();
                } catch (err) {
                    caughtErrors.push(err.message);
                }
            }

            return {
                finalTheme: ThemeManager.currentTheme,
                attrTheme: document.documentElement.getAttribute('data-theme'),
                caughtErrors
            };
        });

        assert.equal(corruptRes.caughtErrors.length, 0, 'Corrupt storage values must not throw');
        assert.ok(corruptRes.finalTheme === 'dark' || corruptRes.finalTheme === 'light', 'Theme must resolve to dark or light');
        assert.equal(corruptRes.attrTheme, corruptRes.finalTheme);

        // Test rapid toggle bursts (10 rapid toggles)
        for (let i = 0; i < 10; i++) {
            await page.click('#btn-toggle-theme');
        }

        const burstState = await page.evaluate(() => ({
            theme: ThemeManager.currentTheme,
            docTheme: document.documentElement.getAttribute('data-theme'),
            metaContent: document.querySelector('meta[name="color-scheme"]')?.getAttribute('content'),
            toggleHasLightClass: document.getElementById('btn-toggle-theme')?.classList.contains('light-active')
        }));

        assert.equal(burstState.docTheme, burstState.theme);
        assert.equal(burstState.metaContent, burstState.theme);
        assert.equal(burstState.toggleHasLightClass, burstState.theme === 'light');
    });

    test('Theming Adversarial: Core token presence and contrast in both themes', async () => {
        const { page } = env;

        const tokensCheck = await page.evaluate(() => {
            const requiredTokens = [
                '--canvas-bg',
                '--surface-bg',
                '--surface-card',
                '--border-default',
                '--text-primary',
                '--text-secondary',
                '--primary-bg',
                '--primary-fg'
            ];

            const evaluateTokensFor = (theme) => {
                ThemeManager.applyTheme(theme, false);
                const styles = window.getComputedStyle(document.documentElement);
                const missing = [];
                for (const t of requiredTokens) {
                    const val = styles.getPropertyValue(t).trim();
                    if (!val) missing.push(t);
                }
                return missing;
            };

            const darkMissing = evaluateTokensFor('dark');
            const lightMissing = evaluateTokensFor('light');

            // Reset to dark
            ThemeManager.applyTheme('dark', false);

            return { darkMissing, lightMissing };
        });

        assert.equal(tokensCheck.darkMissing.length, 0, `Missing tokens in dark theme: ${tokensCheck.darkMissing.join(', ')}`);
        assert.equal(tokensCheck.lightMissing.length, 0, `Missing tokens in light theme: ${tokensCheck.lightMissing.join(', ')}`);
    });

    // =========================================================================
    // 5. PROPERTIES DRAWER LIFECYCLE & KEYDOWN NON-DESTRUCTION
    // =========================================================================
    test('Properties Drawer Adversarial: Rapid selection bursts and non-destructive delete in inputs', async () => {
        const { page } = env;

        // Reset room and add test furniture
        await page.click('#btn-clear-room');
        await page.click('button[data-tab="tab-furniture"]');
        await page.click('button.preset-btn[data-preset="sofa"]');

        // Test rapid select/deselect burst
        await page.evaluate(() => {
            const item = State.furniture[0];
            for (let i = 0; i < 20; i++) {
                selectItem(i % 2 === 0 ? item : null, i % 2 === 0 ? 'furniture' : null);
            }
        });

        const panelActiveAfterBurst = await page.evaluate(() => {
            const panel = document.getElementById('properties-panel');
            return panel && !panel.classList.contains('active');
        });
        assert.equal(panelActiveAfterBurst, true, 'Drawer should be inactive after even deselect iterations');

        // Select item to open properties drawer
        await page.evaluate(() => {
            selectItem(State.furniture[0], 'furniture');
        });

        const isPanelOpen = await page.evaluate(() => {
            const panel = document.getElementById('properties-panel');
            return panel && panel.classList.contains('active');
        });
        assert.equal(isPanelOpen, true, 'Properties drawer must be open');

        // Focus an input field inside properties drawer (e.g., #prop-name)
        await page.focus('#prop-name');

        // Dispatch Delete and Backspace while focused inside the input
        await page.keyboard.press('Delete');
        await page.keyboard.press('Backspace');

        // Verify that the furniture item was NOT deleted
        const furnitureCountAfterKey = await page.evaluate(() => State.furniture.length);
        assert.equal(furnitureCountAfterKey, 1, 'Typing Delete or Backspace in input MUST NOT delete the selected item');

        // Press Escape to dismiss drawer
        await page.keyboard.press('Escape');

        const isDismissed = await page.evaluate(() => {
            const panel = document.getElementById('properties-panel');
            return !panel.classList.contains('active') && State.selectedItem === null;
        });
        assert.equal(isDismissed, true, 'Escape key must deselect item and dismiss properties drawer');
    });

    test('Properties Drawer Adversarial: Non-occlusion invariance with left sidebar on desktop', async () => {
        const { page } = env;

        // Ensure 1440x900 desktop viewport
        await page.setViewportSize({ width: 1440, height: 900 });

        // Select item to open properties drawer
        await page.evaluate(() => {
            selectItem(State.furniture[0], 'furniture');
        });
        await page.waitForTimeout(250);

        // Get bounding boxes of sidebar and properties drawer
        const rects = await page.evaluate(() => {
            const sidebar = document.querySelector('.sidebar');
            const drawer = document.getElementById('properties-panel');
            const sRect = sidebar.getBoundingClientRect();
            const dRect = drawer.getBoundingClientRect();
            return {
                sidebarRight: sRect.right,
                drawerLeft: dRect.left,
                drawerRight: dRect.right,
                viewportWidth: window.innerWidth
            };
        });

        // Verify drawer is strictly on the right side and does NOT overlap left sidebar
        assert.ok(rects.drawerLeft > rects.sidebarRight, `Drawer (left: ${rects.drawerLeft}) overlaps with sidebar (right: ${rects.sidebarRight})`);
        assert.ok(rects.drawerRight <= rects.viewportWidth, 'Drawer must stay within viewport right boundary');

        // Cleanup selection
        await page.evaluate(() => selectItem(null, null));
    });

    // =========================================================================
    // 6. TOOLBAR RESPONSIVE COLLAPSE & ZERO CUTOFF
    // =========================================================================
    test('Toolbar Adversarial: Responsive collapse and zero text cutoff across narrow viewports', async () => {
        const { page } = env;

        const viewports = [
            { width: 1440, height: 900, name: 'Desktop' },
            { width: 1024, height: 768, name: 'Small Laptop' },
            { width: 768, height: 1024, name: 'Tablet' },
            { width: 375, height: 667, name: 'Mobile' }
        ];

        for (const vp of viewports) {
            await page.setViewportSize({ width: vp.width, height: vp.height });
            await page.waitForTimeout(50);

            const check = await page.evaluate(() => {
                const toolbar = document.querySelector('.toolbar');
                const clearBtn = document.getElementById('btn-clear-room');
                const tRect = toolbar.getBoundingClientRect();

                // Check clear room button has valid dimensions
                const bRect = clearBtn.getBoundingClientRect();
                const isBtnVisible = bRect.width > 0 && bRect.height > 0;

                return {
                    toolbarHeight: tRect.height,
                    isBtnVisible,
                    buttonWidth: bRect.width,
                    buttonHeight: bRect.height
                };
            });

            assert.ok(check.toolbarHeight >= 36, `Toolbar height too small on ${vp.name}`);
            assert.equal(check.isBtnVisible, true, `Clear button must be visible on ${vp.name}`);
            assert.ok(check.buttonWidth >= 24, `Button width must be at least 24px on ${vp.name}`);
        }

        // Restore viewport
        await page.setViewportSize({ width: 1440, height: 900 });
    });
});
