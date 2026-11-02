const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppInstance } = require('../harness');

test('Feature 14: First-Person 3D Walkthrough Mode with 2D Camera Radar Frustum Cone', async (t) => {
    const app = createAppInstance();
    const { Viewer3D, WalkthroughMode, Editor2D, State } = app;

    await t.test('1. Walkthrough mode toggle and eye-level height (165 cm)', () => {
        assert.equal(Viewer3D.isWalkthrough, false);
        assert.equal(Viewer3D.walkthroughHeight, 165);

        // Toggle on
        Viewer3D.setWalkthroughMode(true);
        assert.equal(Viewer3D.isWalkthrough, true);
        assert.equal(Viewer3D.camera.position.y, 165);

        // Toggle off
        Viewer3D.setWalkthroughMode(false);
        assert.equal(Viewer3D.isWalkthrough, false);

        // Via WalkthroughMode bridge
        const active = WalkthroughMode.toggle(true);
        assert.equal(active, true);
        assert.equal(Viewer3D.isWalkthrough, true);
        assert.equal(Viewer3D.camera.position.y, 165);

        WalkthroughMode.toggle(false);
        assert.equal(Viewer3D.isWalkthrough, false);
    });

    await t.test('2. Wall boundary collision clamping with 25cm shoulder margin', () => {
        // Room 500 x 400. 3D room is centered at (0, 0).
        // 3D bounds: X ∈ [-225, 225], Z ∈ [-175, 175]
        State.room = { width: 500, depth: 400, height: 250 };
        Viewer3D.walkthroughMargin = 25;

        // Try setting position far beyond right wall (X = 300)
        Viewer3D.walkthroughPosition = { worldX: 300, worldZ: 0 };
        assert.equal(Viewer3D.camera.position.x, 225); // Clamped to 500/2 - 25

        // Try setting position far beyond left wall (X = -300)
        Viewer3D.walkthroughPosition = { worldX: -300, worldZ: 0 };
        assert.equal(Viewer3D.camera.position.x, -225); // Clamped to -500/2 + 25

        // Try setting position far beyond bottom wall (Z = 300)
        Viewer3D.walkthroughPosition = { worldX: 0, worldZ: 300 };
        assert.equal(Viewer3D.camera.position.z, 175); // Clamped to 400/2 - 25

        // Try setting position far beyond top wall (Z = -300)
        Viewer3D.walkthroughPosition = { worldX: 0, worldZ: -300 };
        assert.equal(Viewer3D.camera.position.z, -175); // Clamped to -400/2 + 25
    });

    await t.test('3. 2D Room coordinates ↔ 3D World coordinates synchronization', () => {
        State.room = { width: 500, depth: 400, height: 250 };
        // Set 2D coordinates: center of room is (250, 200)
        Viewer3D.walkthroughPosition = { x: 250, y: 200 };
        assert.equal(Viewer3D.camera.position.x, 0); // 250 - 250 = 0
        assert.equal(Viewer3D.camera.position.z, 0); // 200 - 200 = 0

        const pos = Viewer3D.walkthroughPosition;
        assert.equal(pos.x, 250);
        assert.equal(pos.y, 200);
        assert.equal(pos.height, 165);

        // Via bridge
        WalkthroughMode.setPosition({ x: 100, y: 100 });
        const bridgePos = WalkthroughMode.getPosition();
        assert.equal(bridgePos.x, 100);
        assert.equal(bridgePos.y, 100);
    });

    await t.test('4. Heading angle getter and setter', () => {
        // Set angle in degrees
        Viewer3D.walkthroughAngle = 90;
        assert.ok(Math.abs(Viewer3D.walkthroughAngle - 90) < 1e-4);

        Viewer3D.walkthroughAngle = 180;
        assert.ok(Math.abs(Viewer3D.walkthroughAngle - 180) < 1e-4);

        // Via bridge
        WalkthroughMode.setAngle(270);
        assert.ok(Math.abs(WalkthroughMode.getAngle() - 270) < 1e-4);
    });

    await t.test('5. 2D Camera radar frustum cone drawing', () => {
        Viewer3D.isWalkthrough = true;
        Viewer3D.walkthroughPosition = { x: 250, y: 200 };
        Viewer3D.walkthroughAngle = 0;

        let strokeCount = 0;
        let fillCount = 0;
        let arcCount = 0;

        const mockCtx = {
            save: () => {},
            restore: () => {},
            beginPath: () => {},
            closePath: () => {},
            moveTo: () => {},
            lineTo: () => {},
            arc: () => { arcCount++; },
            fill: () => { fillCount++; },
            stroke: () => { strokeCount++; },
            setLineDash: () => {},
            strokeStyle: '',
            fillStyle: '',
            lineWidth: 1
        };

        Editor2D.drawCameraRadar(mockCtx);

        // Radar sector + mid arc + outer glow + core dot + pointer tick
        assert.ok(arcCount >= 3, 'Must draw radar frustum arc and player dot');
        assert.ok(fillCount >= 2, 'Must fill radar sector and player indicator');
        assert.ok(strokeCount >= 2, 'Must stroke radar sector and look ray');
        Viewer3D.isWalkthrough = false;
    });

    await t.test('6. OrbitControls state preservation and restoration', () => {
        Viewer3D.setWalkthroughMode(false);
        Viewer3D.controls.enabled = true;
        Viewer3D.controls.target.set(100, 200, 300);
        Viewer3D.camera.position.set(400, 500, 600);

        // Enter walkthrough
        Viewer3D.setWalkthroughMode(true);
        assert.equal(Viewer3D.controls.enabled, false);

        // Exit walkthrough
        Viewer3D.setWalkthroughMode(false);
        assert.equal(Viewer3D.controls.enabled, true);
        assert.equal(Viewer3D.camera.position.x, 400);
        assert.equal(Viewer3D.camera.position.y, 500);
        assert.equal(Viewer3D.camera.position.z, 600);
        assert.equal(Viewer3D.controls.target.x, 100);
        assert.equal(Viewer3D.controls.target.y, 200);
        assert.equal(Viewer3D.controls.target.z, 300);
    });

    await t.test('7. Headless safety (no crash when window/document are absent)', () => {
        assert.doesNotThrow(() => {
            Viewer3D.setWalkthroughMode(true);
            Viewer3D.walkthroughPosition = { x: 200, y: 150 };
            Viewer3D.walkthroughAngle = 45;
            Viewer3D.updateCameraRotation();
            Viewer3D.setWalkthroughMode(false);
        });
    });

    await t.test('8. Lateral strafe traversal direction with KeyD (+X) and KeyA (-X) facing North', () => {
        Viewer3D.setWalkthroughMode(true);
        State.room = { width: 500, depth: 400, height: 250 };
        Viewer3D.walkthroughPosition = { x: 250, y: 200 }; // Centered at world (0, 165, 0)
        Viewer3D.walkthroughYaw = 0; // Facing North (-Z)
        Viewer3D.walkthroughPitch = 0;
        Viewer3D.walkthroughSpeed = 3.0;

        // Reset keys
        Viewer3D.keys = {};

        // Simulate KeyD (Strafe Right)
        Viewer3D.keys['KeyD'] = true;
        Viewer3D.animate();
        assert.ok(Viewer3D.camera.position.x > 0, `KeyD must move towards +X (East/Right), got ${Viewer3D.camera.position.x}`);
        assert.equal(Viewer3D.camera.position.x, 3.0);
        Viewer3D.keys['KeyD'] = false;

        // Reset back to center
        Viewer3D.camera.position.set(0, 165, 0);

        // Simulate KeyA (Strafe Left)
        Viewer3D.keys['KeyA'] = true;
        Viewer3D.animate();
        assert.ok(Viewer3D.camera.position.x < 0, `KeyA must move towards -X (West/Left), got ${Viewer3D.camera.position.x}`);
        assert.equal(Viewer3D.camera.position.x, -3.0);
        Viewer3D.keys['KeyA'] = false;

        Viewer3D.setWalkthroughMode(false);
    });

    await t.test('9. Consecutive setWalkthroughMode(true) calls do not clobber savedOrbitState', () => {
        Viewer3D.setWalkthroughMode(false);
        Viewer3D.camera.position.set(400, 500, 600);
        Viewer3D.controls.target.set(100, 200, 300);

        // First enter saves orbit state
        Viewer3D.setWalkthroughMode(true);
        // Move player within walkthrough
        Viewer3D.walkthroughPosition = { x: 100, y: 150 };

        // Second redundant enter must NOT clobber savedOrbitState
        Viewer3D.setWalkthroughMode(true);

        // Exit walkthrough must restore the original (400, 500, 600) position
        Viewer3D.setWalkthroughMode(false);
        assert.equal(Viewer3D.camera.position.x, 400);
        assert.equal(Viewer3D.camera.position.y, 500);
        assert.equal(Viewer3D.camera.position.z, 600);
        assert.equal(Viewer3D.controls.target.x, 100);
        assert.equal(Viewer3D.controls.target.y, 200);
        assert.equal(Viewer3D.controls.target.z, 300);
        assert.equal(Viewer3D.savedOrbitState, null, 'savedOrbitState should be cleared on exit');
    });
});
