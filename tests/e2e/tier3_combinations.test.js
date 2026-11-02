const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestEnvironment } = require('./helpers');

describe('E2E Tier 3: Cross-Feature Combinations', () => {
    let env;

    before(async () => {
        env = await setupTestEnvironment();
    });

    after(async () => {
        if (env) await env.cleanup();
    });

    test('Combination: Furniture under roof pitch triggers vertical collision detection', async () => {
        const { page } = env;

        // Configure roof pitch on top wall (kniestock 80, run 160)
        await page.evaluate(() => {
            State.room.width = 500;
            State.room.depth = 400;
            State.room.height = 250;
            State.room.pitches.top = { enabled: true, kniestock: 80, run: 160 };

            // Place tall wardrobe (height 210cm) under the slant at y = 50 (ceiling is ~133cm)
            State.furniture = [{
                id: 'pitch_test_wardrobe',
                name: 'Kleiderschrank',
                shape: 'rect',
                x: 250,
                y: 50,
                w: 150,
                l: 60,
                h: 210,
                elevation: 0,
                rotation: 0,
                collisionEnabled: true,
                isColliding: false
            }];

            CollisionEngine.updateAllCollisions();
        });

        // Verify collision flag and alert badge
        const isColliding = await page.evaluate(() => State.furniture[0].isColliding);
        assert.equal(isColliding, true, 'Wardrobe under low pitch must be flagged as colliding');

        const alertShown = await page.evaluate(() => {
            const badge = document.getElementById('collision-alert');
            return badge && !badge.classList.contains('hidden');
        });
        assert.equal(alertShown, true, 'Collision alert badge must be visible');

        // Move wardrobe out of the slant into the flat room area (y = 250)
        await page.evaluate(() => {
            State.furniture[0].y = 250;
            CollisionEngine.updateAllCollisions();
        });

        const isCollidingCleared = await page.evaluate(() => State.furniture[0].isColliding);
        assert.equal(isCollidingCleared, false, 'Wardrobe in flat area must not collide');

        const alertCleared = await page.evaluate(() => {
            const badge = document.getElementById('collision-alert');
            return badge && badge.classList.contains('hidden');
        });
        assert.equal(alertCleared, true, 'Collision alert badge must be hidden');
    });

    test('Combination: TV automatic elevation stacking on top of underlying furniture', async () => {
        const { page } = env;

        await page.evaluate(() => {
            // Place lowboard / table at center (elev 0, height 76cm)
            const desk = {
                id: 'base_desk',
                name: 'Schreibtisch',
                shape: 'rect',
                x: 250,
                y: 200,
                w: 140,
                l: 80,
                h: 76,
                elevation: 0,
                rotation: 0,
                collisionEnabled: true
            };

            // Place TV directly over the desk
            const tv = {
                id: 'stacked_tv',
                name: 'Fernseher (TV)',
                shape: 'rect',
                x: 250,
                y: 200,
                w: 122,
                l: 15,
                h: 78.5,
                elevation: 0, // initially 0
                tvSize: 55,
                rotation: 0,
                collisionEnabled: true
            };

            State.furniture = [desk, tv];
            CollisionEngine.updateAllCollisions();
        });

        const tvElevation = await page.evaluate(() => {
            const tv = State.furniture.find(f => f.id === 'stacked_tv');
            return tv ? tv.elevation : -1;
        });

        // TV must automatically be elevated to the desk surface height (76cm)
        assert.equal(tvElevation, 76, 'TV elevation must match the height of the underlying desk (76cm)');
    });

    test('Combination: Split view and Item Selection synchronize property drawer', async () => {
        const { page } = env;

        // Switch to Split View
        await page.click('#btn-view-split');

        // Select the first furniture item via selectItem
        await page.evaluate(() => {
            const item = State.furniture[0];
            selectItem(item, 'furniture');
        });

        // Verify property panel is active and contains item details
        const isPanelActive = await page.evaluate(() => {
            const panel = document.getElementById('properties-panel');
            return panel && panel.classList.contains('active');
        });
        assert.equal(isPanelActive, true, 'Properties panel should be active when item is selected');

        // Close properties panel
        await page.click('#close-properties');

        const isPanelClosed = await page.evaluate(() => {
            const panel = document.getElementById('properties-panel');
            return panel && !panel.classList.contains('active');
        });
        assert.equal(isPanelClosed, true, 'Properties panel should close when clicking close button');

        // Switch back to 2D view
        await page.click('#btn-view-2d');
    });

    test('Combination: Multi-step Undo and Redo restores state sequentially', async () => {
        const { page } = env;

        // Reset room
        await page.click('#btn-clear-room');
        const countBefore = await page.evaluate(() => State.furniture.length);
        assert.equal(countBefore, 0);

        // Add armchair
        await page.click('button[data-tab="tab-furniture"]');
        await page.click('button.preset-btn[data-preset="chair"]');

        const countAfterAdd = await page.evaluate(() => State.furniture.length);
        assert.equal(countAfterAdd, 1);

        // Undo the addition
        await page.click('#btn-undo');
        const countAfterUndo = await page.evaluate(() => State.furniture.length);
        assert.equal(countAfterUndo, 0, 'Undo must remove the added item');

        // Redo the addition
        await page.click('#btn-redo');
        const countAfterRedo = await page.evaluate(() => State.furniture.length);
        assert.equal(countAfterRedo, 1, 'Redo must restore the added item');
    });
});
