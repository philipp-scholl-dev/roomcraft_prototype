const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppInstance } = require('./harness');

test('Empirical Verification: Feature 14 Strafe Direction & OrbitControls Idempotency', async (t) => {
    
    // =========================================================================
    // SUITE 1: Rigorous Strafe Vector Mathematics (360 Yaw Angles)
    // =========================================================================
    await t.test('1. Orthonormality and Rightward Space Alignment across 360° Yaw Sweep', () => {
        const EPS = 1e-12;
        let checksPassed = 0;

        for (let deg = 0; deg < 360; deg++) {
            const rad = (deg * Math.PI) / 180;
            
            // In Three.js: yaw 0 looks toward -Z
            const fwd = {
                x: -Math.sin(rad),
                y: 0,
                z: -Math.cos(rad)
            };

            // Strafe vector defined in app.js:5170: side = (-fwd.z, 0, fwd.x)
            const side = {
                x: -fwd.z,
                y: 0,
                z: fwd.x
            };

            // Up vector in Three.js right-handed world space
            const up = { x: 0, y: 1, z: 0 };

            // Cross product: fwd x up
            const cross = {
                x: fwd.y * up.z - fwd.z * up.y,
                y: fwd.z * up.x - fwd.x * up.z,
                z: fwd.x * up.y - fwd.y * up.x
            };

            // 1. Length of fwd is 1
            const fwdLen = Math.hypot(fwd.x, fwd.y, fwd.z);
            assert.ok(Math.abs(fwdLen - 1.0) < EPS, `Angle ${deg}°: fwd length (${fwdLen}) != 1`);

            // 2. Length of side is 1
            const sideLen = Math.hypot(side.x, side.y, side.z);
            assert.ok(Math.abs(sideLen - 1.0) < EPS, `Angle ${deg}°: side length (${sideLen}) != 1`);

            // 3. Dot product fwd . side == 0 (strictly orthogonal)
            const dot = fwd.x * side.x + fwd.y * side.y + fwd.z * side.z;
            assert.ok(Math.abs(dot) < EPS, `Angle ${deg}°: fwd . side (${dot}) != 0`);

            // 4. Cross product fwd x up strictly matches side in all 3 components
            assert.ok(Math.abs(cross.x - side.x) < EPS, `Angle ${deg}°: cross.x (${cross.x}) != side.x (${side.x})`);
            assert.ok(Math.abs(cross.y - side.y) < EPS, `Angle ${deg}°: cross.y (${cross.y}) != side.y (${side.y})`);
            assert.ok(Math.abs(cross.z - side.z) < EPS, `Angle ${deg}°: cross.z (${cross.z}) != side.z (${side.z})`);

            checksPassed++;
        }

        assert.equal(checksPassed, 360, 'All 360 yaw angles passed orthonormal verification');

        // Explicit Cardinal Heading Checks
        // In Three.js coordinates:
        // yaw = 0 rad (0°): facing North (-Z). Player's right is East (+X).
        // yaw = π/2 rad (90°): facing West (-X). Player's right is North (-Z).
        // yaw = π rad (180°): facing South (+Z). Player's right is West (-X).
        // yaw = 3π/2 rad (270°): facing East (+X). Player's right is South (+Z).
        const cardinals = [
            { name: 'North', yawDeg: 0, expFwd: { x: 0, y: 0, z: -1 }, expSide: { x: 1, y: 0, z: 0 } },
            { name: 'West', yawDeg: 90, expFwd: { x: -1, y: 0, z: 0 }, expSide: { x: 0, y: 0, z: -1 } },
            { name: 'South', yawDeg: 180, expFwd: { x: 0, y: 0, z: 1 }, expSide: { x: -1, y: 0, z: 0 } },
            { name: 'East', yawDeg: 270, expFwd: { x: 1, y: 0, z: 0 }, expSide: { x: 0, y: 0, z: 1 } }
        ];

        for (const card of cardinals) {
            const rad = (card.yawDeg * Math.PI) / 180;
            const fwd = { x: -Math.sin(rad), y: 0, z: -Math.cos(rad) };
            const side = { x: -fwd.z, y: 0, z: fwd.x };

            assert.ok(Math.abs(fwd.x - card.expFwd.x) < 1e-10, `${card.name}: fwd.x mismatch`);
            assert.ok(Math.abs(fwd.z - card.expFwd.z) < 1e-10, `${card.name}: fwd.z mismatch`);
            assert.ok(Math.abs(side.x - card.expSide.x) < 1e-10, `${card.name}: side.x mismatch`);
            assert.ok(Math.abs(side.z - card.expSide.z) < 1e-10, `${card.name}: side.z mismatch`);
        }
    });

    // =========================================================================
    // SUITE 2: Keyboard Traversal Verification (KeyD/ArrowRight & KeyA/ArrowLeft)
    // =========================================================================
    await t.test('2. Keyboard Traversal: KeyD/ArrowRight (+side) & KeyA/ArrowLeft (-side)', () => {
        const app = createAppInstance();
        const { Viewer3D, State } = app;

        State.room = { width: 1000, depth: 1000, height: 250 };
        Viewer3D.setWalkthroughMode(true);
        Viewer3D.walkthroughSpeed = 4.0;

        const testHeadings = [
            { deg: 0, name: 'North (yaw=0°)' },
            { deg: 45, name: 'North-West (yaw=45°)' },
            { deg: 90, name: 'West (yaw=90°)' },
            { deg: 135, name: 'South-West (yaw=135°)' },
            { deg: 180, name: 'South (yaw=180°)' },
            { deg: 225, name: 'South-East (yaw=225°)' },
            { deg: 270, name: 'East (yaw=270°)' },
            { deg: 315, name: 'North-East (yaw=315°)' }
        ];

        for (const heading of testHeadings) {
            const rad = (heading.deg * Math.PI) / 180;
            Viewer3D.walkthroughYaw = rad;

            const expectedFwd = { x: -Math.sin(rad), y: 0, z: -Math.cos(rad) };
            const expectedSide = { x: -expectedFwd.z, y: 0, z: expectedFwd.x };

            // --- Test KeyD (Right) ---
            Viewer3D.camera.position.set(0, 165, 0);
            Viewer3D.keys = { 'KeyD': true };
            Viewer3D.animate();

            const deltaD = {
                x: Viewer3D.camera.position.x - 0,
                y: Viewer3D.camera.position.y - 165,
                z: Viewer3D.camera.position.z - 0
            };
            assert.ok(Math.abs(deltaD.x - expectedSide.x * 4.0) < 1e-6, `${heading.name} KeyD delta.x mismatch`);
            assert.ok(Math.abs(deltaD.z - expectedSide.z * 4.0) < 1e-6, `${heading.name} KeyD delta.z mismatch`);
            assert.equal(deltaD.y, 0, `${heading.name} KeyD delta.y must be 0`);

            // --- Test ArrowRight (Right) ---
            Viewer3D.camera.position.set(0, 165, 0);
            Viewer3D.keys = { 'ArrowRight': true };
            Viewer3D.animate();

            const deltaArrowR = {
                x: Viewer3D.camera.position.x - 0,
                y: Viewer3D.camera.position.y - 165,
                z: Viewer3D.camera.position.z - 0
            };
            assert.ok(Math.abs(deltaArrowR.x - expectedSide.x * 4.0) < 1e-6, `${heading.name} ArrowRight delta.x mismatch`);
            assert.ok(Math.abs(deltaArrowR.z - expectedSide.z * 4.0) < 1e-6, `${heading.name} ArrowRight delta.z mismatch`);

            // --- Test KeyA (Left) ---
            Viewer3D.camera.position.set(0, 165, 0);
            Viewer3D.keys = { 'KeyA': true };
            Viewer3D.animate();

            const deltaA = {
                x: Viewer3D.camera.position.x - 0,
                y: Viewer3D.camera.position.y - 165,
                z: Viewer3D.camera.position.z - 0
            };
            assert.ok(Math.abs(deltaA.x - (-expectedSide.x * 4.0)) < 1e-6, `${heading.name} KeyA delta.x mismatch`);
            assert.ok(Math.abs(deltaA.z - (-expectedSide.z * 4.0)) < 1e-6, `${heading.name} KeyA delta.z mismatch`);
            assert.equal(deltaA.y, 0, `${heading.name} KeyA delta.y must be 0`);

            // --- Test ArrowLeft (Left) ---
            Viewer3D.camera.position.set(0, 165, 0);
            Viewer3D.keys = { 'ArrowLeft': true };
            Viewer3D.animate();

            const deltaArrowL = {
                x: Viewer3D.camera.position.x - 0,
                y: Viewer3D.camera.position.y - 165,
                z: Viewer3D.camera.position.z - 0
            };
            assert.ok(Math.abs(deltaArrowL.x - (-expectedSide.x * 4.0)) < 1e-6, `${heading.name} ArrowLeft delta.x mismatch`);
            assert.ok(Math.abs(deltaArrowL.z - (-expectedSide.z * 4.0)) < 1e-6, `${heading.name} ArrowLeft delta.z mismatch`);

            // --- Opposing Keys Cancellation (KeyA + KeyD) ---
            Viewer3D.camera.position.set(0, 165, 0);
            Viewer3D.keys = { 'KeyA': true, 'KeyD': true };
            Viewer3D.animate();

            assert.equal(Viewer3D.camera.position.x, 0, `${heading.name} Opposing keys should cancel X displacement`);
            assert.equal(Viewer3D.camera.position.z, 0, `${heading.name} Opposing keys should cancel Z displacement`);
        }

        Viewer3D.keys = {};
        Viewer3D.setWalkthroughMode(false);
    });

    // =========================================================================
    // SUITE 3: 200 Re-entrant setWalkthroughMode(true) Calls with Movements
    // =========================================================================
    await t.test('3. 200 Consecutive Re-entrant Calls with Intervening Movements Preserve savedOrbitState', () => {
        const app = createAppInstance();
        const { Viewer3D, State } = app;

        State.room = { width: 800, depth: 600, height: 260 };

        // Ensure camera and controls are initialized
        Viewer3D.setWalkthroughMode(true);
        Viewer3D.setWalkthroughMode(false);

        // Define original non-trivial high-precision orbit camera state
        const originalCamPos = {
            x: 432.1234567891234,
            y: 567.9876543219876,
            z: 789.1234567891234
        };
        const originalTarget = {
            x: 123.4567890123456,
            y: 234.5678901234567,
            z: 345.6789012345678
        };

        Viewer3D.camera.position.set(originalCamPos.x, originalCamPos.y, originalCamPos.z);
        Viewer3D.controls.target.set(originalTarget.x, originalTarget.y, originalTarget.z);
        Viewer3D.controls.enabled = true;

        // Initial entrance into walkthrough
        Viewer3D.setWalkthroughMode(true);
        assert.equal(Viewer3D.isWalkthrough, true);
        assert.equal(Viewer3D.controls.enabled, false);

        // Perform 200 consecutive re-entrant calls to setWalkthroughMode(true)
        // with vigorous intervening movements in 3D walkthrough space
        for (let i = 1; i <= 200; i++) {
            // Traverse to arbitrary walkthrough coordinates
            const posX = -200 + (i * 7) % 400;
            const posZ = -150 + (i * 11) % 300;
            Viewer3D.camera.position.set(posX, 165, posZ);
            Viewer3D.walkthroughYaw = ((i * 13) % 360) * (Math.PI / 180);

            // Re-entrant invocation while already active
            Viewer3D.setWalkthroughMode(true);

            // Verify walkthrough state is still intact
            assert.equal(Viewer3D.isWalkthrough, true, `Iteration ${i}: isWalkthrough should remain true`);
            assert.equal(Viewer3D.controls.enabled, false, `Iteration ${i}: controls should remain disabled`);
        }

        // Exit walkthrough mode
        Viewer3D.setWalkthroughMode(false);
        assert.equal(Viewer3D.isWalkthrough, false);
        assert.equal(Viewer3D.controls.enabled, true);

        // Verify that original orbit camera position is preserved down to machine epsilon
        assert.equal(
            Viewer3D.camera.position.x,
            originalCamPos.x,
            `Camera X drifted! Expected ${originalCamPos.x}, got ${Viewer3D.camera.position.x}`
        );
        assert.equal(
            Viewer3D.camera.position.y,
            originalCamPos.y,
            `Camera Y drifted! Expected ${originalCamPos.y}, got ${Viewer3D.camera.position.y}`
        );
        assert.equal(
            Viewer3D.camera.position.z,
            originalCamPos.z,
            `Camera Z drifted! Expected ${originalCamPos.z}, got ${Viewer3D.camera.position.z}`
        );

        // Verify that original controls target is preserved down to machine epsilon
        assert.equal(
            Viewer3D.controls.target.x,
            originalTarget.x,
            `Controls Target X drifted! Expected ${originalTarget.x}, got ${Viewer3D.controls.target.x}`
        );
        assert.equal(
            Viewer3D.controls.target.y,
            originalTarget.y,
            `Controls Target Y drifted! Expected ${originalTarget.y}, got ${Viewer3D.controls.target.y}`
        );
        assert.equal(
            Viewer3D.controls.target.z,
            originalTarget.z,
            `Controls Target Z drifted! Expected ${originalTarget.z}, got ${Viewer3D.controls.target.z}`
        );

        // Verify savedOrbitState is cleanly reset to null on exit
        assert.equal(Viewer3D.savedOrbitState, null, 'savedOrbitState must be null after exit');
    });

    // =========================================================================
    // SUITE 4: Interleaved Re-entrance Patterns & State Cleanup
    // =========================================================================
    await t.test('4. Complex Interleaved Re-entrance Patterns and Redundant Exits', () => {
        const app = createAppInstance();
        const { Viewer3D, State } = app;

        State.room = { width: 600, depth: 600, height: 250 };
        Viewer3D.setWalkthroughMode(true);
        Viewer3D.setWalkthroughMode(false);

        Viewer3D.camera.position.set(111.1, 222.2, 333.3);
        Viewer3D.controls.target.set(44.4, 55.5, 66.6);

        // Sequence of 10 blocks: enter, 5x re-enter, move, exit, redundant exit x3
        for (let block = 0; block < 10; block++) {
            // New viewpoint before entering
            const basePos = { x: 100 + block * 10, y: 200 + block * 5, z: 300 - block * 8 };
            const baseTgt = { x: 10 + block, y: 20 - block, z: 30 + block };
            Viewer3D.camera.position.set(basePos.x, basePos.y, basePos.z);
            Viewer3D.controls.target.set(baseTgt.x, baseTgt.y, baseTgt.z);

            // First enter
            Viewer3D.setWalkthroughMode(true);
            assert.equal(Viewer3D.isWalkthrough, true);

            // 5 redundant enters with intervening movements
            for (let r = 0; r < 5; r++) {
                Viewer3D.camera.position.set(50 + r * 10, 165, 50 - r * 10);
                Viewer3D.setWalkthroughMode(true);
            }

            // Normal exit
            Viewer3D.setWalkthroughMode(false);
            assert.equal(Viewer3D.isWalkthrough, false);
            assert.equal(Viewer3D.camera.position.x, basePos.x);
            assert.equal(Viewer3D.camera.position.y, basePos.y);
            assert.equal(Viewer3D.camera.position.z, basePos.z);
            assert.equal(Viewer3D.controls.target.x, baseTgt.x);
            assert.equal(Viewer3D.controls.target.y, baseTgt.y);
            assert.equal(Viewer3D.controls.target.z, baseTgt.z);
            assert.equal(Viewer3D.savedOrbitState, null);

            // 3 redundant exits should not touch anything or throw
            Viewer3D.setWalkthroughMode(false);
            Viewer3D.setWalkthroughMode(false);
            Viewer3D.setWalkthroughMode(false);

            assert.equal(Viewer3D.camera.position.x, basePos.x);
            assert.equal(Viewer3D.controls.target.x, baseTgt.x);
        }
    });
});
