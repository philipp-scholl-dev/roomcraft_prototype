const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestEnvironment } = require('./helpers');

describe('E2E Tier 2: Boundary & Corner Cases', () => {
    let env;

    before(async () => {
        env = await setupTestEnvironment();
    });

    after(async () => {
        if (env) await env.cleanup();
    });

    test('Boundary: Clearing room resets all collections and clears collision alert', async () => {
        const { page } = env;

        // Clear the room
        await page.click('#btn-clear-room');

        const stateSummary = await page.evaluate(() => ({
            furnitureCount: State.furniture.length,
            elementsCount: State.elements.length,
            installationsCount: State.installations.length,
            collisionAlertHidden: document.getElementById('collision-alert').classList.contains('hidden')
        }));

        assert.equal(stateSummary.furnitureCount, 0);
        assert.equal(stateSummary.elementsCount, 0);
        assert.equal(stateSummary.installationsCount, 0);
        assert.equal(stateSummary.collisionAlertHidden, true);
    });

    test('Boundary: Extreme minimal and maximal room dimensions update safely', async () => {
        const { page } = env;

        await page.click('button[data-tab="tab-room"]');

        // Test minimal room: 200 x 200 cm, 200 cm height
        await page.evaluate(() => {
            const widthInput = document.getElementById('room-width');
            widthInput.value = '200';
            widthInput.dispatchEvent(new Event('change'));

            const depthInput = document.getElementById('room-depth');
            depthInput.value = '200';
            depthInput.dispatchEvent(new Event('change'));

            const heightInput = document.getElementById('room-height');
            heightInput.value = '200';
            heightInput.dispatchEvent(new Event('change'));
        });

        let roomDims = await page.evaluate(() => ({
            w: State.room.width,
            d: State.room.depth,
            h: State.room.height
        }));

        assert.equal(roomDims.w, 200);
        assert.equal(roomDims.d, 200);
        assert.equal(roomDims.h, 200);

        // Test maximal room: 1500 x 1200 cm, 400 cm height
        await page.evaluate(() => {
            const widthInput = document.getElementById('room-width');
            widthInput.value = '1500';
            widthInput.dispatchEvent(new Event('change'));

            const depthInput = document.getElementById('room-depth');
            depthInput.value = '1200';
            depthInput.dispatchEvent(new Event('change'));

            const heightInput = document.getElementById('room-height');
            heightInput.value = '400';
            heightInput.dispatchEvent(new Event('change'));
        });

        roomDims = await page.evaluate(() => ({
            w: State.room.width,
            d: State.room.depth,
            h: State.room.height
        }));

        assert.equal(roomDims.w, 1500);
        assert.equal(roomDims.d, 1200);
        assert.equal(roomDims.h, 400);

        // Reset to normal standard size: 500 x 400
        await page.evaluate(() => {
            const widthInput = document.getElementById('room-width');
            widthInput.value = '500';
            widthInput.dispatchEvent(new Event('change'));

            const depthInput = document.getElementById('room-depth');
            depthInput.value = '400';
            depthInput.dispatchEvent(new Event('change'));

            const heightInput = document.getElementById('room-height');
            heightInput.value = '250';
            heightInput.dispatchEvent(new Event('change'));
        });
    });

    test('Boundary: Out-of-bounds furniture positioning triggers collision alert badge', async () => {
        const { page } = env;

        // Place an item directly on the wall boundary (x = 20 in 500cm room with w=100)
        await page.evaluate(() => {
            State.furniture = [{
                id: 'out_of_bounds_item',
                name: 'Crossing Desk',
                shape: 'rect',
                x: 20, // left edge is at 20 - 50 = -30 (outside!)
                y: 200,
                w: 100,
                l: 60,
                h: 75,
                rotation: 0,
                collisionEnabled: true,
                isColliding: false
            }];
            CollisionEngine.updateAllCollisions();
        });

        const alertVisible = await page.evaluate(() => {
            const badge = document.getElementById('collision-alert');
            return badge && !badge.classList.contains('hidden');
        });

        assert.equal(alertVisible, true, 'Collision alert badge must be visible when item crosses boundary');

        // Move item back safely inside room
        await page.evaluate(() => {
            State.furniture[0].x = 250;
            CollisionEngine.updateAllCollisions();
        });

        const alertCleared = await page.evaluate(() => {
            const badge = document.getElementById('collision-alert');
            return badge && badge.classList.contains('hidden');
        });

        assert.equal(alertCleared, true, 'Collision alert badge should be hidden when item is moved inside');
    });

    test('Corner Case: Empty state view switching produces no rendering crashes', async () => {
        const { page } = env;

        // Empty room
        await page.evaluate(() => {
            State.furniture = [];
            State.elements = [];
            State.installations = [];
        });

        // Switch through all views in empty state
        await page.click('#btn-view-3d');
        await page.waitForTimeout(100);

        await page.click('#btn-view-split');
        await page.waitForTimeout(100);

        await page.click('#btn-view-2d');
        await page.waitForTimeout(100);

        // Verify canvas and WebGL renderer did not crash
        const rendererOk = await page.evaluate(() => {
            return typeof Viewer3D !== 'undefined' && Viewer3D.renderer !== null;
        });
        assert.equal(rendererOk, true);
    });
});
