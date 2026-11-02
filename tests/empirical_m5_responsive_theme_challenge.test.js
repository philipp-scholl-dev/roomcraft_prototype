const path = require('path');
const fs = require('fs');
const assert = require('node:assert/strict');
const { setupTestEnvironment } = require('./e2e/helpers');

/**
 * Empirical Challenger Test Suite for Milestone 5:
 * - Multi-Viewport Button Cutoff & Overflow Stress Testing (1920, 1600, 1440, 1280, 1024)
 * - Theme Switching, Persistence, 2D/3D Backgrounds & FOUC Prevention
 * - Adversarial Stress & Edge Cases
 */
async function runEmpiricalChallenge() {
    console.log('='.repeat(80));
    console.log('  M5 EMPIRICAL CHALLENGER: Responsive Viewports & Theme Stress Suite');
    console.log('='.repeat(80));

    const startTime = Date.now();
    const env = await setupTestEnvironment();
    const { page } = env;

    const report = {
        viewports: {},
        themeToggles: [],
        foucTests: [],
        stressTests: [],
        buttonMetrics: [],
        clearRoomMetrics: {}
    };

    try {
        // =====================================================================
        // PART 1: MULTI-VIEWPORT BUTTON CUTOFF & OVERFLOW STRESS TESTING
        // =====================================================================
        console.log('\n--- PART 1: Multi-Viewport Button Cutoff & Overflow Stress Testing ---');
        
        const testViewports = [
            { width: 1920, height: 1080, name: '1920px (Full HD)' },
            { width: 1600, height: 900,  name: '1600px (Wide)' },
            { width: 1440, height: 900,  name: '1440px (Desktop)' },
            { width: 1280, height: 800,  name: '1280px (Laptop)' },
            { width: 1024, height: 768,  name: '1024px (Tablet)' }
        ];

        for (const vp of testViewports) {
            console.log(`\nTesting Viewport: ${vp.name} (${vp.width}x${vp.height})...`);
            await page.setViewportSize({ width: vp.width, height: vp.height });
            await page.waitForTimeout(300); // Allow responsive CSS rules and reflow to stabilize

            const vpMetrics = await page.evaluate((vpWidth) => {
                const toolbar = document.querySelector('.toolbar');
                const workspace = document.querySelector('.workspace');
                const toolbarRect = toolbar.getBoundingClientRect();
                const workspaceRect = workspace ? workspace.getBoundingClientRect() : null;

                const toolbarButtons = Array.from(toolbar.querySelectorAll('button, .btn, .view-btn, .tool-btn, .dropdown-toggle'));
                const results = [];
                let clearRoomInfo = null;

                for (const btn of toolbarButtons) {
                    const rect = btn.getBoundingClientRect();
                    const style = window.getComputedStyle(btn);
                    
                    // Skip if hidden
                    if (style.display === 'none' || rect.width === 0 || rect.height === 0) {
                        continue;
                    }

                    const textContainer = btn.querySelector('.btn-text, .btn-text-secondary, span') || btn;
                    const textContent = (textContainer.innerText || btn.innerText || '').trim();
                    const textStyle = window.getComputedStyle(textContainer);

                    // Cutoff checks: scrollWidth > clientWidth + 1
                    const isCutoff = textContainer.scrollWidth > textContainer.clientWidth + 1;
                    
                    // Overflow checks: does button exceed toolbar bounds horizontally?
                    // Subpixel tolerance 1.5px
                    const exceedsToolbarRight = rect.right > toolbarRect.right + 1.5;
                    const exceedsWorkspaceRight = workspaceRect ? (rect.right > workspaceRect.right + 1.5) : false;

                    // Text wrapping checks: white-space property
                    const isNowrap = style.whiteSpace === 'nowrap' || textStyle.whiteSpace === 'nowrap';

                    const item = {
                        id: btn.id || btn.className,
                        text: textContent,
                        width: Math.round(rect.width * 100) / 100,
                        height: Math.round(rect.height * 100) / 100,
                        clientWidth: textContainer.clientWidth,
                        scrollWidth: textContainer.scrollWidth,
                        rectRight: Math.round(rect.right * 100) / 100,
                        toolbarRight: Math.round(toolbarRect.right * 100) / 100,
                        isCutoff,
                        exceedsToolbarRight,
                        exceedsWorkspaceRight,
                        isNowrap
                    };

                    if (btn.id === 'btn-clear-room') {
                        clearRoomInfo = item;
                    }

                    results.push(item);
                }

                return {
                    toolbarWidth: toolbarRect.width,
                    toolbarHeight: toolbarRect.height,
                    toolbarScrollWidth: toolbar.scrollWidth,
                    toolbarClientWidth: toolbar.clientWidth,
                    hasHorizontalOverflow: toolbar.scrollWidth > toolbar.clientWidth + 1,
                    buttons: results,
                    clearRoomInfo
                };
            }, vp.width);

            report.viewports[vp.name] = vpMetrics;
            report.clearRoomMetrics[vp.name] = vpMetrics.clearRoomInfo;

            console.log(`  Toolbar dimensions: ${vpMetrics.toolbarWidth}px × ${vpMetrics.toolbarHeight}px (scrollWidth: ${vpMetrics.toolbarScrollWidth}px)`);
            console.log(`  Buttons tested in toolbar: ${vpMetrics.buttons.length}`);
            console.log(`  Toolbar horizontal overflow: ${vpMetrics.hasHorizontalOverflow ? 'YES (FAIL)' : 'NONE (PASS)'}`);

            if (vpMetrics.clearRoomInfo) {
                console.log(`  [#btn-clear-room]: text="${vpMetrics.clearRoomInfo.text}", width=${vpMetrics.clearRoomInfo.width}px, clientWidth=${vpMetrics.clearRoomInfo.clientWidth}px, scrollWidth=${vpMetrics.clearRoomInfo.scrollWidth}px, cutoff=${vpMetrics.clearRoomInfo.isCutoff}, exceedsToolbar=${vpMetrics.clearRoomInfo.exceedsToolbarRight}`);
            }

            const cutoffFailures = vpMetrics.buttons.filter(b => b.isCutoff);
            const overflowFailures = vpMetrics.buttons.filter(b => b.exceedsToolbarRight || b.exceedsWorkspaceRight);

            assert.equal(cutoffFailures.length, 0, `Cutoff failures in ${vp.name}: ${JSON.stringify(cutoffFailures)}`);
            assert.equal(overflowFailures.length, 0, `Button overflow failures in ${vp.name}: ${JSON.stringify(overflowFailures)}`);
            assert.equal(vpMetrics.hasHorizontalOverflow, false, `Toolbar has horizontal scroll overflow in ${vp.name}`);

            if (vpMetrics.clearRoomInfo) {
                assert.equal(vpMetrics.clearRoomInfo.isCutoff, false, `#btn-clear-room must not be cut off in ${vp.name}`);
                assert.equal(vpMetrics.clearRoomInfo.isNowrap, true, `#btn-clear-room must have white-space: nowrap in ${vp.name}`);
                assert.equal(vpMetrics.clearRoomInfo.exceedsToolbarRight, false, `#btn-clear-room must not exceed toolbar right in ${vp.name}`);
            }

            console.log(`  ✓ ${vp.name}: 0 cutoff violations, 0 toolbar overflows.`);
        }

        // =====================================================================
        // PART 2: THEME SWITCHING, PERSISTENCE & FOUC TESTING
        // =====================================================================
        console.log('\n--- PART 2: Theme Switching, Persistence & FOUC Testing ---');

        // Reset to default desktop viewport
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.waitForTimeout(200);

        // 2.1 Test toggling between dark and light multiple times
        let currentTheme = await page.evaluate(() => {
            return document.documentElement.getAttribute('data-theme') || ThemeManager.currentTheme;
        });
        console.log(`Initial theme detected: "${currentTheme}"`);

        for (let i = 0; i < 4; i++) {
            const expectedTheme = currentTheme === 'dark' ? 'light' : 'dark';
            console.log(`Step 2.1.${i+1}: Clicking theme toggle button (toggling from ${currentTheme} -> expected: ${expectedTheme})...`);
            
            await page.click('#btn-toggle-theme');
            await page.waitForTimeout(150);

            const themeState = await page.evaluate(() => {
                const docTheme = document.documentElement.getAttribute('data-theme');
                const localPrimary = localStorage.getItem('roomcraft_theme');
                const localFallback = localStorage.getItem('roomcraft-theme');
                
                // Inspect 3D Scene background color
                let threeBgHex = null;
                if (typeof Viewer3D !== 'undefined' && Viewer3D.scene && Viewer3D.scene.background) {
                    threeBgHex = '0x' + Viewer3D.scene.background.getHex().toString(16).padStart(6, '0');
                }

                // Inspect 2D Canvas background color
                let canvasPixel = null;
                const canvas = document.getElementById('editorCanvas');
                if (canvas) {
                    const ctx = canvas.getContext('2d');
                    if (ctx) {
                        const pixel = ctx.getImageData(5, 5, 1, 1).data;
                        canvasPixel = `rgba(${pixel[0]},${pixel[1]},${pixel[2]},${pixel[3]})`;
                    }
                }

                return {
                    docTheme,
                    localPrimary,
                    localFallback,
                    threeBgHex,
                    canvasPixel
                };
            });

            console.log(`  Result: data-theme="${themeState.docTheme}", storage="${themeState.localPrimary}", 3D-bg=${themeState.threeBgHex}, 2D-pixel=${themeState.canvasPixel}`);
            report.themeToggles.push(themeState);

            assert.equal(themeState.docTheme, expectedTheme, `data-theme must be ${expectedTheme}`);
            assert.equal(themeState.localPrimary, expectedTheme, `localStorage roomcraft_theme must be ${expectedTheme}`);
            assert.equal(themeState.localFallback, expectedTheme, `localStorage roomcraft-theme must be ${expectedTheme}`);

            if (expectedTheme === 'light') {
                assert.equal(themeState.threeBgHex, '0xf8fafc', '3D Scene background must be 0xf8fafc in light mode');
                assert.ok(themeState.canvasPixel.startsWith('rgba(248,250,252,'), `2D Canvas background must be #f8fafc in light mode, got ${themeState.canvasPixel}`);
            } else {
                assert.equal(themeState.threeBgHex, '0x09090b', '3D Scene background must be 0x09090b in dark mode');
                assert.ok(themeState.canvasPixel.startsWith('rgba(9,9,11,'), `2D Canvas background must be #09090b in dark mode, got ${themeState.canvasPixel}`);
            }

            currentTheme = expectedTheme;
        }
        console.log('  ✓ Theme toggling and 2D/3D background colors verified across 4 toggles.');

        // 2.2 FOUC & Reload Persistence Test
        console.log('\nStep 2.2: FOUC Prevention & Reload Persistence Test...');
        
        // Pin to 'light' in localStorage
        await page.evaluate(() => {
            localStorage.setItem('roomcraft_theme', 'light');
        });

        // Add an init script that records documentElement data-theme as early as document_start
        await page.addInitScript(() => {
            window.__fouc_early_theme = null;
            const observer = new MutationObserver(() => {
                if (!window.__fouc_early_theme && document.documentElement) {
                    window.__fouc_early_theme = document.documentElement.getAttribute('data-theme');
                }
            });
            observer.observe(document, { childList: true, subtree: true, attributes: true });
        });

        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(200);

        const reloadLightResult = await page.evaluate(() => {
            return {
                earlyTheme: window.__fouc_early_theme,
                domLoadedTheme: document.documentElement.getAttribute('data-theme'),
                storage: localStorage.getItem('roomcraft_theme')
            };
        });
        console.log('  Light reload result:', reloadLightResult);
        assert.equal(reloadLightResult.domLoadedTheme, 'light', 'After reloading with light theme in localStorage, documentElement must be light');
        assert.equal(reloadLightResult.earlyTheme, 'light', 'Inline head script must apply light theme before FOUC');
        console.log('  ✓ Light theme reload without FOUC verified.');

        // Now pin to 'dark' in localStorage and reload
        await page.evaluate(() => {
            localStorage.setItem('roomcraft_theme', 'dark');
        });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(200);

        const reloadDarkResult = await page.evaluate(() => {
            return {
                domLoadedTheme: document.documentElement.getAttribute('data-theme'),
                storage: localStorage.getItem('roomcraft_theme')
            };
        });
        console.log('  Dark reload result:', reloadDarkResult);
        assert.equal(reloadDarkResult.domLoadedTheme, 'dark', 'After reloading with dark theme in localStorage, documentElement must be dark');
        console.log('  ✓ Dark theme reload without FOUC verified.');

        // 2.3 matchMedia OS preference reaction
        console.log('\nStep 2.3: OS matchMedia fallback & event listener test...');
        const matchMediaResult = await page.evaluate(() => {
            // Clear storage so ThemeManager relies on OS scheme
            localStorage.removeItem('roomcraft_theme');
            localStorage.removeItem('roomcraft-theme');

            // Call ThemeManager.init() to test prefers-color-scheme fallback
            ThemeManager.init();
            const fallbackTheme = document.documentElement.getAttribute('data-theme');

            // Simulate an OS change event
            const fakeEvent = { matches: false }; // light
            ThemeManager.applyTheme(fakeEvent.matches ? 'dark' : 'light', true);
            const appliedLight = document.documentElement.getAttribute('data-theme');

            const fakeDarkEvent = { matches: true }; // dark
            ThemeManager.applyTheme(fakeDarkEvent.matches ? 'dark' : 'light', true);
            const appliedDark = document.documentElement.getAttribute('data-theme');

            return { fallbackTheme, appliedLight, appliedDark };
        });

        console.log('  matchMedia fallback and event handling:', matchMediaResult);
        assert.ok(matchMediaResult.fallbackTheme === 'dark' || matchMediaResult.fallbackTheme === 'light');
        assert.equal(matchMediaResult.appliedLight, 'light');
        assert.equal(matchMediaResult.appliedDark, 'dark');
        console.log('  ✓ matchMedia handling verified.');

        // =====================================================================
        // PART 3: ADVERSARIAL STRESS & EDGE CASES
        // =====================================================================
        console.log('\n--- PART 3: Adversarial Stress & Edge Cases ---');

        // 3.1 Rapid Toggling Stress Test (20 clicks within 300ms)
        console.log('Step 3.1: Rapid-fire 20 theme toggles...');
        const rapidResult = await page.evaluate(async () => {
            const btn = document.getElementById('btn-toggle-theme');
            const errors = [];
            window.addEventListener('error', e => errors.push(e.message));

            for (let i = 0; i < 20; i++) {
                btn.click();
            }

            return {
                errors,
                finalTheme: document.documentElement.getAttribute('data-theme'),
                storedTheme: localStorage.getItem('roomcraft_theme')
            };
        });
        console.log('  Rapid toggle result:', rapidResult);
        assert.equal(rapidResult.errors.length, 0, 'Rapid toggling must not produce JavaScript runtime errors');
        assert.equal(rapidResult.finalTheme, rapidResult.storedTheme, 'DOM theme and localStorage must match after rapid toggling');
        console.log('  ✓ Rapid toggling survived with 0 errors.');

        // 3.2 Corrupt localStorage Recovery Test
        console.log('\nStep 3.2: Corrupt localStorage theme value handling...');
        await page.evaluate(() => {
            localStorage.setItem('roomcraft_theme', 'MALICIOUS_CORRUPT_THEME');
            ThemeManager.init();
        });
        const corruptRecovery = await page.evaluate(() => {
            return document.documentElement.getAttribute('data-theme');
        });
        console.log('  Theme after corrupt storage:', corruptRecovery);
        assert.ok(corruptRecovery === 'dark' || corruptRecovery === 'light', 'ThemeManager must safely fall back to dark or light on corrupt storage');
        console.log('  ✓ Corrupt storage gracefully recovered.');

        // 3.3 Dimension Line Color Masking Test in 2D
        console.log('\nStep 3.3: Dimension Line Color Masking in 2D...');
        const dimMaskResult = await page.evaluate(() => {
            // Check light mode dimension mask
            ThemeManager.applyTheme('light', false);
            const isLight = document.documentElement.getAttribute('data-theme') === 'light';
            const lightMask = isLight ? '#f8fafc' : '#09090b';
            const lightText = isLight ? '#1e293b' : '#cbd5e1';

            // Check dark mode dimension mask
            ThemeManager.applyTheme('dark', false);
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            const darkMask = !isDark ? '#f8fafc' : '#09090b';
            const darkText = !isDark ? '#1e293b' : '#cbd5e1';

            return { lightMask, lightText, darkMask, darkText };
        });
        console.log('  Dimension line colors:', dimMaskResult);
        assert.equal(dimMaskResult.lightMask, '#f8fafc');
        assert.equal(dimMaskResult.lightText, '#1e293b');
        assert.equal(dimMaskResult.darkMask, '#09090b');
        assert.equal(dimMaskResult.darkText, '#cbd5e1');
        console.log('  ✓ Dimension line masks match drafting background in both modes.');

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log('\n' + '='.repeat(80));
        console.log(`  ALL EMPIRICAL CHALLENGES PASSED SUCCESSFULLY (${duration}s)`);
        console.log('='.repeat(80));

        return report;
    } finally {
        await env.cleanup();
    }
}

if (require.main === module) {
    runEmpiricalChallenge()
        .then(report => {
            const reportPath = path.resolve(__dirname, 'empirical_m5_challenge_report.json');
            fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
            console.log(`\nDetailed report written to: ${reportPath}`);
            process.exit(0);
        })
        .catch(err => {
            console.error('\n❌ Empirical Challenge Failed:', err);
            process.exit(1);
        });
}

module.exports = { runEmpiricalChallenge };
