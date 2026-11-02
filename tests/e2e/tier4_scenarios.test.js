const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestEnvironment } = require('./helpers');

describe('E2E Tier 4: Real-World Application Scenarios', () => {
    let env;

    before(async () => {
        env = await setupTestEnvironment();
    });

    after(async () => {
        if (env) await env.cleanup();
    });

    test('Scenario A: Complete Modern Living Room Workflow', async () => {
        const { page } = env;

        // 1. Clear room
        await page.click('#btn-clear-room');

        // 2. Set dimensions: 600 x 450 x 260 cm
        await page.evaluate(() => {
            State.room.width = 600;
            State.room.depth = 450;
            State.room.height = 260;
            State.room.pitches.top.enabled = false;
            State.room.pitches.right.enabled = false;
            State.room.pitches.bottom.enabled = false;
            State.room.pitches.left.enabled = false;
            syncRoomInputsUI();
            Editor2D.draw();
        });

        // 3. Add elements: Patio door on bottom wall, window on left wall
        await page.evaluate(() => {
            State.elements.push(
                { id: 'living_door', type: 'door', isBalcony: true, wall: 'bottom', position: 180, w: 90, h: 200 },
                { id: 'living_window', type: 'window', wall: 'left', position: 220, w: 140, h: 120, sillHeight: 90 }
            );
            Editor2D.draw();
            updatePlacedListsUI();
        });

        // 4. Place furniture: Sofa, Coffee table, TV Lowboard, TV, Rug
        await page.evaluate(() => {
            const sofa = { id: 'sofa_1', name: 'Sofa', shape: 'rect', x: 300, y: 150, w: 210, l: 95, h: 80, rotation: 0, color: 'hsl(263, 40%, 45%)', collisionEnabled: true };
            const table = { id: 'table_1', name: 'Esstisch', shape: 'rect', x: 300, y: 260, w: 120, l: 70, h: 45, rotation: 0, color: 'hsl(35, 45%, 40%)', collisionEnabled: true };
            const lowboard = { id: 'desk_1', name: 'Schreibtisch', shape: 'rect', x: 300, y: 390, w: 160, l: 50, h: 50, rotation: 0, color: 'hsl(180, 50%, 35%)', collisionEnabled: true };
            const tv = { id: 'tv_1', name: 'Fernseher (TV)', shape: 'rect', x: 300, y: 390, w: 122, l: 15, h: 78.5, rotation: 0, color: 'hsl(0, 0%, 15%)', collisionEnabled: true, tvSize: 55, elevation: 0 };
            const rug = { id: 'rug_1', name: 'Teppich (eckig)', shape: 'rect', x: 300, y: 220, w: 240, l: 180, h: 2, rotation: 0, color: 'hsl(215, 25%, 60%)', collisionEnabled: true, isRug: true };

            State.furniture = [sofa, table, lowboard, tv, rug];
            CollisionEngine.updateAllCollisions();
            Editor2D.draw();
            if (Viewer3D.renderer) {
                Viewer3D.rebuildFullRoom();
            }
            updatePlacedListsUI();
        });

        // Verify living room invariants
        const summary = await page.evaluate(() => ({
            furnitureCount: State.furniture.length,
            elementsCount: State.elements.length,
            tvElevation: State.furniture.find(f => f.id === 'tv_1').elevation,
            anyColliding: State.furniture.some(f => f.isColliding),
            alertHidden: document.getElementById('collision-alert').classList.contains('hidden')
        }));

        assert.equal(summary.furnitureCount, 5);
        assert.equal(summary.elementsCount, 2);
        assert.equal(summary.tvElevation, 50, 'TV must sit on lowboard (height 50cm)');
        assert.equal(summary.anyColliding, false, 'Living room layout must have no colliding items');
        assert.equal(summary.alertHidden, true, 'Collision badge must be hidden');

        // Switch to 3D preview and ensure Three.js builds meshes
        await page.click('#btn-view-3d');
        const meshesCount = await page.evaluate(() => {
            return Viewer3D.furnitureMeshes ? Viewer3D.furnitureMeshes.size : -1;
        });
        assert.ok(meshesCount >= 5, '3D Viewer should render meshes for all living room furniture');
    });

    test('Scenario B: Attic Bedroom (Dachgeschoss) Workflow', async () => {
        const { page } = env;

        await page.click('#btn-view-2d');
        await page.click('#btn-clear-room');

        // Configure attic room: 450 x 400 x 250 cm with top roof slant
        await page.evaluate(() => {
            State.room.width = 450;
            State.room.depth = 400;
            State.room.height = 250;
            State.room.pitches.top = { enabled: true, kniestock: 80, run: 160 };
            State.room.pitches.right.enabled = false;
            State.room.pitches.bottom.enabled = false;
            State.room.pitches.left.enabled = false;

            // Skylight on roof slant
            State.elements = [
                { id: 'skylight_1', type: 'skylight', wall: 'top', position: 225, w: 80, h: 120, distanceFromWall: 80 },
                { id: 'door_south', type: 'door', wall: 'bottom', position: 100, w: 90, h: 200 }
            ];

            // Bed placed under slant where height is sufficient (y = 220cm)
            const bed = { id: 'bed_1', name: 'Doppelbett', shape: 'rect', x: 225, y: 220, w: 180, l: 200, h: 60, rotation: 0, collisionEnabled: true };
            // Tall wardrobe placed against bottom wall (y = 320, where rotated half-width 60 fits within room depth 400)
            const wardrobe = { id: 'wardrobe_1', name: 'Kleiderschrank', shape: 'rect', x: 380, y: 320, w: 120, l: 60, h: 210, rotation: 90, collisionEnabled: true };

            State.furniture = [bed, wardrobe];
            syncRoomInputsUI();
            CollisionEngine.updateAllCollisions();
            Editor2D.draw();
            updatePlacedListsUI();
        });

        const atticCheck = await page.evaluate(() => ({
            skylightValid: State.elements.some(e => e.type === 'skylight'),
            anyColliding: State.furniture.some(f => f.isColliding),
            bedHeightOk: getCeilingHeightAt(225, 220) >= 60,
            wardrobeHeightOk: getCeilingHeightAt(380, 360) >= 210
        }));

        assert.equal(atticCheck.skylightValid, true);
        assert.equal(atticCheck.anyColliding, false, 'Bed and Wardrobe must fit without roof collision');
        assert.equal(atticCheck.bedHeightOk, true);
        assert.equal(atticCheck.wardrobeHeightOk, true);
    });

    test('Scenario C: Modern Collaborative Office & State Round-trip Workflow', async () => {
        const { page } = env;

        await page.click('#btn-clear-room');

        // Setup 700 x 500 cm office
        await page.evaluate(() => {
            State.room.width = 700;
            State.room.depth = 500;
            State.room.height = 280;
            State.room.pitches.top.enabled = false;

            // 4 Desks
            State.furniture = [
                { id: 'desk_a', name: 'Schreibtisch A', shape: 'rect', x: 180, y: 150, w: 140, l: 80, h: 76, rotation: 0, collisionEnabled: true },
                { id: 'desk_b', name: 'Schreibtisch B', shape: 'rect', x: 180, y: 250, w: 140, l: 80, h: 76, rotation: 0, collisionEnabled: true },
                { id: 'desk_c', name: 'Schreibtisch C', shape: 'rect', x: 520, y: 150, w: 140, l: 80, h: 76, rotation: 0, collisionEnabled: true },
                { id: 'desk_d', name: 'Schreibtisch D', shape: 'rect', x: 520, y: 250, w: 140, l: 80, h: 76, rotation: 0, collisionEnabled: true }
            ];

            // 4 Chairs
            State.furniture.push(
                { id: 'chair_a', name: 'Stuhl A', shape: 'rect', x: 180, y: 80, w: 45, l: 45, h: 85, rotation: 180, collisionEnabled: true },
                { id: 'chair_b', name: 'Stuhl B', shape: 'rect', x: 180, y: 320, w: 45, l: 45, h: 85, rotation: 0, collisionEnabled: true },
                { id: 'chair_c', name: 'Stuhl C', shape: 'rect', x: 520, y: 80, w: 45, l: 45, h: 85, rotation: 180, collisionEnabled: true },
                { id: 'chair_d', name: 'Stuhl D', shape: 'rect', x: 520, y: 320, w: 45, l: 45, h: 85, rotation: 0, collisionEnabled: true }
            );

            // Electrical installations: 4 LAN ports and 4 power sockets
            State.installations = [
                { id: 'lan_1', type: 'lan', wall: 'left', position: 150, height: 45 },
                { id: 'lan_2', type: 'lan', wall: 'left', position: 250, height: 45 },
                { id: 'lan_3', type: 'lan', wall: 'right', position: 150, height: 45 },
                { id: 'lan_4', type: 'lan', wall: 'right', position: 250, height: 45 }
            ];

            CollisionEngine.updateAllCollisions();
            Editor2D.draw();
            updatePlacedListsUI();
        });

        // Verify total inventory counts
        const officeState = await page.evaluate(() => ({
            furnitureCount: State.furniture.length,
            installationsCount: State.installations.length
        }));
        assert.equal(officeState.furnitureCount, 8);
        assert.equal(officeState.installationsCount, 4);

        // Serialize state to JSON snapshot
        const projectJSON = await page.evaluate(() => JSON.stringify({
            room: State.room,
            furniture: State.furniture,
            elements: State.elements,
            installations: State.installations
        }));

        // Clear room
        await page.click('#btn-clear-room');
        const clearedCount = await page.evaluate(() => State.furniture.length);
        assert.equal(clearedCount, 0);

        // Restore state via applyProjectData
        await page.evaluate((json) => {
            const data = JSON.parse(json);
            applyProjectData(data);
        }, projectJSON);

        // Verify complete reconstruction
        const restoredState = await page.evaluate(() => ({
            furnitureCount: State.furniture.length,
            installationsCount: State.installations.length,
            width: State.room.width,
            depth: State.room.depth
        }));

        assert.equal(restoredState.furnitureCount, 8);
        assert.equal(restoredState.installationsCount, 4);
        assert.equal(restoredState.width, 700);
        assert.equal(restoredState.depth, 500);
    });
});
