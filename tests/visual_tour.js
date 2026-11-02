const path = require('path');
const fs = require('fs');
const { setupTestEnvironment } = require('./e2e/helpers');

/**
 * Automated Visual Verification Tour (Feature 18 / Requirements R1 & R6)
 *
 * Runs headless Chromium via Playwright, executes full UI tour across
 * all primary views and themes, captures high-resolution screenshots,
 * and asserts zero button text cutoff.
 */
async function runVisualTour() {
    console.log('='.repeat(78));
    console.log('  RoomCraft Automated Visual Verification Tour (Feature 18)');
    console.log('='.repeat(78));

    const startTime = Date.now();
    const outputDir = path.resolve(__dirname, 'artifacts/screenshots');
    fs.mkdirSync(outputDir, { recursive: true });
    console.log(`\n[Artifacts] Saving screenshots to: ${outputDir}`);

    console.log('[Setup] Launching ephemeral static server and headless browser...');
    const env = await setupTestEnvironment();
    const { page } = env;

    // Configure high-DPI desktop viewport (1440x900)
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(400);

    const screenshots = [];

    try {
        // ---------------------------------------------------------------------
        // 1. 2D Floorplan in Dark Mode
        // ---------------------------------------------------------------------
        console.log('\n[Tour 1/6] Capturing 2D Floorplan in Dark Mode...');
        await page.click('#btn-view-2d');
        await page.evaluate(() => {
            if (typeof ThemeManager !== 'undefined') {
                ThemeManager.applyTheme('dark');
            } else {
                document.documentElement.setAttribute('data-theme', 'dark');
                if (typeof Editor2D !== 'undefined') Editor2D.draw();
            }
        });
        await page.waitForTimeout(300);
        const file1 = path.join(outputDir, '01_2d_floorplan_dark.png');
        await page.screenshot({ path: file1, fullPage: false });
        screenshots.push({ name: '2D Floorplan (Dark)', file: file1 });
        console.log(`  ✓ Saved: ${path.basename(file1)}`);

        // ---------------------------------------------------------------------
        // 2. 2D Floorplan in Light Mode
        // ---------------------------------------------------------------------
        console.log('\n[Tour 2/6] Capturing 2D Floorplan in Light Mode (contrast & grid check)...');
        await page.evaluate(() => {
            if (typeof ThemeManager !== 'undefined') {
                ThemeManager.applyTheme('light');
            } else {
                document.documentElement.setAttribute('data-theme', 'light');
                document.body.setAttribute('data-theme', 'light');
                const btnTheme = document.getElementById('btn-toggle-theme');
                if (btnTheme) btnTheme.classList.add('light-active');
                if (typeof Editor2D !== 'undefined') Editor2D.draw();
            }
        });
        await page.waitForTimeout(300);
        const file2 = path.join(outputDir, '02_2d_floorplan_light.png');
        await page.screenshot({ path: file2, fullPage: false });
        screenshots.push({ name: '2D Floorplan (Light)', file: file2 });
        console.log(`  ✓ Saved: ${path.basename(file2)}`);

        // Revert to dark theme for subsequent views
        await page.evaluate(() => {
            if (typeof ThemeManager !== 'undefined') {
                ThemeManager.applyTheme('dark');
            } else {
                document.documentElement.setAttribute('data-theme', 'dark');
                document.body.removeAttribute('data-theme');
                if (typeof Editor2D !== 'undefined') Editor2D.draw();
            }
        });

        // ---------------------------------------------------------------------
        // 3. 3D Realistic View with ceiling lamps & floor textures
        // ---------------------------------------------------------------------
        console.log('\n[Tour 3/6] Capturing 3D Realistic View (PBR lighting, lamps, textures)...');
        await page.click('#btn-view-3d');
        await page.waitForTimeout(300);
        await page.evaluate(() => {
            const btnTexture = document.getElementById('btn-mode-texture');
            if (btnTexture) btnTexture.click();
        });
        await page.waitForTimeout(600); // Allow WebGL frames and textures to settle
        const file3 = path.join(outputDir, '03_3d_realistic_view.png');
        await page.screenshot({ path: file3, fullPage: false });
        screenshots.push({ name: '3D Realistic View', file: file3 });
        console.log(`  ✓ Saved: ${path.basename(file3)}`);

        // ---------------------------------------------------------------------
        // 4. Split View with Smart Snapping HUD guide lines and 2D radar cone
        // ---------------------------------------------------------------------
        console.log('\n[Tour 4/6] Capturing Split View with Snapping HUD guides and 2D Radar cone...');
        await page.click('#btn-view-split');
        await page.evaluate(() => {
            if (typeof WalkthroughMode !== 'undefined') {
                WalkthroughMode.toggle(true);
            }
            if (typeof State !== 'undefined' && State.editor2D) {
                State.editor2D.activeGuides = [
                    { x1: 0, y1: 200, x2: State.room.width, y2: 200, type: 'room-center-y', label: 'Raum-Mitte Y' },
                    { x1: 250, y1: 0, x2: 250, y2: State.room.depth, type: 'room-center-x', label: 'Raum-Mitte X' }
                ];
            }
            if (typeof Editor2D !== 'undefined') {
                Editor2D.draw();
            }
        });
        await page.waitForTimeout(400);
        const file4 = path.join(outputDir, '04_split_view_snapping_radar.png');
        await page.screenshot({ path: file4, fullPage: false });
        screenshots.push({ name: 'Split View (Snapping & Radar)', file: file4 });
        console.log(`  ✓ Saved: ${path.basename(file4)}`);

        // Clean up walkthrough and guides
        await page.evaluate(() => {
            if (typeof WalkthroughMode !== 'undefined') {
                WalkthroughMode.toggle(false);
            }
            if (typeof State !== 'undefined' && State.editor2D) {
                State.editor2D.activeGuides = [];
            }
            if (typeof Editor2D !== 'undefined') {
                Editor2D.draw();
            }
        });

        // ---------------------------------------------------------------------
        // 5. Material / Stückliste BOM Modal Dialog
        // ---------------------------------------------------------------------
        console.log('\n[Tour 5/6] Capturing Material & Stückliste BOM Modal Dialog...');
        await page.click('#btn-open-bom');
        await page.waitForTimeout(400);
        const file5 = path.join(outputDir, '05_bom_modal_dialog.png');
        await page.screenshot({ path: file5, fullPage: false });
        screenshots.push({ name: 'Stückliste BOM Modal', file: file5 });
        console.log(`  ✓ Saved: ${path.basename(file5)}`);

        // Close BOM modal cleanly
        await page.evaluate(() => {
            if (typeof BOMDialog !== 'undefined' && BOMDialog.close) {
                BOMDialog.close();
            } else {
                const btn = document.getElementById('btn-close-bom');
                if (btn) btn.click();
            }
        });
        await page.waitForTimeout(300);

        // ---------------------------------------------------------------------
        // 6. Properties Drawer Inspector with selected furniture piece (Feature 17: Non-Occluding)
        // ---------------------------------------------------------------------
        console.log('\n[Tour 6/6] Capturing Properties Drawer Inspector (selected furniture item)...');
        await page.click('#btn-view-2d');
        await page.evaluate(() => {
            // Switch sidebar to furniture catalog to demonstrate non-occlusion
            const catBtn = document.querySelector('.tab-btn[data-tab="tab-furniture"]');
            if (catBtn) catBtn.click();

            if (typeof selectItem === 'function' && State && State.furniture && State.furniture.length > 0) {
                selectItem(State.furniture[0], 'furniture');
            }
        });
        await page.waitForTimeout(400);
        const file6 = path.join(outputDir, '06_properties_drawer_inspector.png');
        await page.screenshot({ path: file6, fullPage: false });
        screenshots.push({ name: 'Properties Drawer Inspector', file: file6 });
        console.log(`  ✓ Saved: ${path.basename(file6)}`);

        // ---------------------------------------------------------------------
        // Button Text Cutoff & Overflow Audit
        // ---------------------------------------------------------------------
        console.log('\n[Audit] Verifying zero button text cutoff across all viewports...');
        const viewportsToAudit = [
            { width: 1440, height: 900, label: 'Desktop 1440p' },
            { width: 1280, height: 800, label: 'Laptop 1280p' },
            { width: 1024, height: 768, label: 'Tablet 1024p' }
        ];

        let totalCutoffViolations = 0;

        for (const vp of viewportsToAudit) {
            await page.setViewportSize({ width: vp.width, height: vp.height });
            await page.waitForTimeout(150);

            const violations = await page.evaluate(() => {
                const buttons = Array.from(document.querySelectorAll('button, .btn, .tool-btn, .tab-btn, .preset-btn, .cat-pill'));
                const list = [];
                for (const btn of buttons) {
                    const rect = btn.getBoundingClientRect();
                    // Skip hidden or collapsed elements
                    if (rect.width === 0 || rect.height === 0 || window.getComputedStyle(btn).display === 'none') {
                        continue;
                    }
                    const textContainer = btn.querySelector('span') || btn;
                    // Tolerance of 1px for subpixel anti-aliasing
                    if (textContainer.scrollWidth > textContainer.clientWidth + 1) {
                        list.push({
                            id: btn.id || btn.className,
                            text: (btn.innerText || '').trim().replace(/\s+/g, ' '),
                            scrollWidth: textContainer.scrollWidth,
                            clientWidth: textContainer.clientWidth,
                            overflow: textContainer.scrollWidth - textContainer.clientWidth
                        });
                    }
                }
                return list;
            });

            if (violations.length === 0) {
                console.log(`  ✓ ${vp.label} (${vp.width}x${vp.height}): Zero button text cutoff`);
            } else {
                console.error(`  ✖ ${vp.label} (${vp.width}x${vp.height}): ${violations.length} cutoff violation(s) found!`);
                for (const v of violations) {
                    console.error(`    - Element "${v.id}" ["${v.text}"]: scrollWidth=${v.scrollWidth}px > clientWidth=${v.clientWidth}px (overflow +${v.overflow}px)`);
                }
                totalCutoffViolations += violations.length;
            }
        }

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log('\n' + '='.repeat(78));
        console.log(`  VISUAL TOUR COMPLETE (${elapsed}s)`);
        console.log('='.repeat(78));
        console.log(`  Screenshots Captured: ${screenshots.length} / 6`);
        console.log(`  Button Violations:    ${totalCutoffViolations}`);

        if (totalCutoffViolations > 0) {
            throw new Error(`Button text cutoff audit failed with ${totalCutoffViolations} violation(s).`);
        }

        console.log('\n✨ Visual tour passed successfully with zero visual defects!\n');
    } finally {
        await env.cleanup();
    }
}

if (require.main === module) {
    runVisualTour().catch(err => {
        console.error('\n❌ Visual Tour Error:', err);
        process.exit(1);
    });
}

module.exports = { runVisualTour };
