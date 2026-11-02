const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestEnvironment } = require('./helpers');

describe('E2E Tier 1: Core Feature Coverage (Happy Path)', () => {
    let env;

    before(async () => {
        env = await setupTestEnvironment();
    });

    after(async () => {
        if (env) await env.cleanup();
    });

    test('F05/F15: Initial application layout, canvas and default state load successfully', async () => {
        const { page } = env;

        // Title and canvas check
        const title = await page.title();
        assert.ok(title.includes('RoomCraft'));

        const canvasVisible = await page.isVisible('#editorCanvas');
        assert.equal(canvasVisible, true);

        // Verify initial room dimensions in State
        const roomState = await page.evaluate(() => State.room);
        assert.equal(roomState.width, 500);
        assert.equal(roomState.depth, 400);

        // Verify default example room loaded furniture items
        const furnitureCount = await page.evaluate(() => State.furniture.length);
        assert.ok(furnitureCount >= 3, 'Default example room should have at least 3 furniture items');
    });

    test('F16: View mode switching updates layout classes and button states', async () => {
        const { page } = env;

        // Switch to 3D View
        await page.click('#btn-view-3d');
        let layoutClass = await page.getAttribute('#workspace-layout', 'class');
        assert.ok(layoutClass.includes('view-3d'), 'Workspace layout should have view-3d class');

        let is3DActive = await page.evaluate(() => document.getElementById('btn-view-3d').classList.contains('active'));
        assert.equal(is3DActive, true);

        // Switch to Split View
        await page.click('#btn-view-split');
        layoutClass = await page.getAttribute('#workspace-layout', 'class');
        assert.ok(layoutClass.includes('view-split'), 'Workspace layout should have view-split class');

        // Switch back to 2D View
        await page.click('#btn-view-2d');
        layoutClass = await page.getAttribute('#workspace-layout', 'class');
        assert.ok(layoutClass.includes('view-2d'), 'Workspace layout should have view-2d class');
    });

    test('F15: Sidebar tabs navigation activates respective panels', async () => {
        const { page } = env;

        const tabs = [
            { btn: 'button[data-tab="tab-room"]', panel: 'tab-room' },
            { btn: 'button[data-tab="tab-elements"]', panel: 'tab-elements' },
            { btn: 'button[data-tab="tab-installations"]', panel: 'tab-installations' },
            { btn: 'button[data-tab="tab-furniture"]', panel: 'tab-furniture' },
            { btn: 'button[data-tab="tab-surfaces"]', panel: 'tab-surfaces' }
        ];

        for (const { btn, panel } of tabs) {
            await page.click(btn);
            const isPanelActive = await page.evaluate(
                (pId) => document.getElementById(pId).classList.contains('active'),
                panel
            );
            assert.equal(isPanelActive, true, `Panel ${panel} should be active`);
        }

        // Return to furniture tab
        await page.click('button[data-tab="tab-furniture"]');
    });

    test('F10: Preset furniture placement appends item and updates placed list', async () => {
        const { page } = env;

        await page.click('button[data-tab="tab-furniture"]');
        const initialCount = await page.evaluate(() => State.furniture.length);

        // Click sofa preset button
        await page.click('button.preset-btn[data-preset="sofa"]');

        const newCount = await page.evaluate(() => State.furniture.length);
        assert.equal(newCount, initialCount + 1, 'Furniture count should increase by 1');

        const latestItem = await page.evaluate(() => State.furniture[State.furniture.length - 1]);
        assert.equal(latestItem.name, 'Sofa');
        assert.equal(latestItem.w, 210);
        assert.equal(latestItem.l, 95);

        // Verify item is rendered in placed-furniture-list
        const listText = await page.textContent('#placed-furniture-list');
        assert.ok(listText.includes('Sofa'), 'Placed furniture list should contain Sofa');
    });

    test('F09: Wall element placement adds element and updates placed elements list', async () => {
        const { page } = env;

        await page.click('button[data-tab="tab-elements"]');
        const initialCount = await page.evaluate(() => State.elements.length);

        // Click add door button
        await page.click('button.add-elem-btn[data-type="door"]');

        const newCount = await page.evaluate(() => State.elements.length);
        assert.equal(newCount, initialCount + 1, 'Elements count should increase by 1');

        const listText = await page.textContent('#placed-elements-list');
        assert.ok(listText.includes('Tür'), 'Placed elements list should contain Tür');
    });

    test('F13: Project JSON export button triggers download without throwing', async () => {
        const { page } = env;

        // Listen for download event or toast message
        const [toastMsg] = await Promise.all([
            page.evaluate(() => {
                return new Promise(resolve => {
                    const status = document.getElementById('canvas-status');
                    const observer = new MutationObserver(() => {
                        if (status.innerText.includes('exportiert')) {
                            observer.disconnect();
                            resolve(status.innerText);
                        }
                    });
                    observer.observe(status, { childList: true, characterData: true, subtree: true });
                    document.getElementById('btn-export-json').click();
                    setTimeout(() => resolve(status.innerText), 1000);
                });
            })
        ]);

        assert.ok(toastMsg.includes('exportiert'), 'Export toast should appear upon export click');
    });
});
