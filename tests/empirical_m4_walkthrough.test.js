/**
 * RoomCraft — Milestone 4 Empirical Challenger Test Suite
 * Feature 14: 3D Walkthrough Mode & 2D Radar Frustum Cone
 * 
 * Adversarial Testing Categories:
 * 1. Walkthrough Wall Clamping Stress (>= 500 trajectory iterations)
 *    - Traversal along randomized headings towards walls, corners, room boundaries
 *    - Strict enforcement of [25, room.width - 25] x [25, room.length - 25] margin
 *    - Camera height strictly preserved at 165 cm (human eye level) across all movements
 * 2. OrbitControls Lifecycle & Re-entrance Stress
 *    - 100 rapid sequential enter/exit cycles
 *    - Preservation of OrbitControls position and target without NaN drift
 *    - Idempotency & re-entrance check
 * 3. 2D Radar Frustum Projection Stress
 *    - Full 360° heading angle sweep in 1° increments
 *    - Verification of zero NaNs in all canvas coordinates, angles, and FOV arc calculations
 *    - Adversarial angles, zoom levels, and room corner coordinates
 * 4. Headless Environment Safety
 *    - Resilience without DOM elements, WebGL canvas, or window APIs
 *    - Bridge API safety and error handling
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/**
 * Creates an enhanced test environment for Milestone 4 walkthrough testing.
 */
function createWalkthroughTestEnvironment() {
    const appPath = path.resolve(__dirname, '../app.js');
    const code = fs.readFileSync(appPath, 'utf8');

    // Canvas 2D Mock recording draw calls
    const canvasDrawCalls = [];
    const mockCtx = {
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        font: '',
        textAlign: '',
        textBaseline: '',
        globalAlpha: 1,
        fillRect: (...args) => canvasDrawCalls.push({ method: 'fillRect', args }),
        strokeRect: (...args) => canvasDrawCalls.push({ method: 'strokeRect', args }),
        clearRect: (...args) => canvasDrawCalls.push({ method: 'clearRect', args }),
        beginPath: () => canvasDrawCalls.push({ method: 'beginPath' }),
        closePath: () => canvasDrawCalls.push({ method: 'closePath' }),
        moveTo: (...args) => canvasDrawCalls.push({ method: 'moveTo', args }),
        lineTo: (...args) => canvasDrawCalls.push({ method: 'lineTo', args }),
        quadraticCurveTo: (...args) => canvasDrawCalls.push({ method: 'quadraticCurveTo', args }),
        bezierCurveTo: (...args) => canvasDrawCalls.push({ method: 'bezierCurveTo', args }),
        arc: (...args) => canvasDrawCalls.push({ method: 'arc', args }),
        ellipse: (...args) => canvasDrawCalls.push({ method: 'ellipse', args }),
        fill: () => canvasDrawCalls.push({ method: 'fill' }),
        stroke: () => canvasDrawCalls.push({ method: 'stroke' }),
        save: () => canvasDrawCalls.push({ method: 'save' }),
        restore: () => canvasDrawCalls.push({ method: 'restore' }),
        translate: (...args) => canvasDrawCalls.push({ method: 'translate', args }),
        rotate: (...args) => canvasDrawCalls.push({ method: 'rotate', args }),
        scale: (...args) => canvasDrawCalls.push({ method: 'scale', args }),
        setLineDash: (...args) => canvasDrawCalls.push({ method: 'setLineDash', args }),
        fillText: (...args) => canvasDrawCalls.push({ method: 'fillText', args }),
        strokeText: (...args) => canvasDrawCalls.push({ method: 'strokeText', args }),
        measureText: () => ({ width: 50 }),
        createLinearGradient: () => ({ addColorStop: () => {} }),
        createRadialGradient: (...args) => {
            canvasDrawCalls.push({ method: 'createRadialGradient', args });
            return { addColorStop: () => {} };
        },
        createPattern: () => null,
        drawImage: () => {}
    };

    // DOM Elements Mock
    const elementsMap = new Map();
    const createMockElement = (id = '', tagName = 'DIV') => ({
        id,
        tagName: tagName.toUpperCase(),
        classList: {
            classes: new Set(),
            add(c) { this.classes.add(c); },
            remove(c) { this.classes.delete(c); },
            contains(c) { return this.classes.has(c); },
            toggle(c) { this.contains(c) ? this.remove(c) : this.add(c); }
        },
        style: {},
        dataset: {},
        children: [],
        listeners: {},
        addEventListener(evt, fn) {
            if (!this.listeners[evt]) this.listeners[evt] = [];
            this.listeners[evt].push(fn);
        },
        removeEventListener(evt, fn) {
            if (!this.listeners[evt]) return;
            this.listeners[evt] = this.listeners[evt].filter(f => f !== fn);
        },
        dispatchEvent(evt) {
            const list = this.listeners[evt.type] || [];
            list.forEach(fn => fn(evt));
        },
        setAttribute(k, v) { this[k] = v; },
        getAttribute(k) { return this[k] || null; },
        appendChild(child) { this.children.push(child); },
        removeChild(child) { this.children = this.children.filter(c => c !== child); },
        querySelector: () => null,
        querySelectorAll: () => [],
        getContext: () => mockCtx,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
        requestPointerLock: () => Promise.resolve()
    });

    const getOrCreateElement = (id) => {
        if (!elementsMap.has(id)) {
            elementsMap.set(id, createMockElement(id));
        }
        return elementsMap.get(id);
    };

    class Vector3 {
        constructor(x = 0, y = 0, z = 0) {
            this.x = x;
            this.y = y;
            this.z = z;
        }
        set(x, y, z) {
            this.x = x;
            this.y = y;
            this.z = z;
            return this;
        }
        copy(v) {
            this.x = v.x;
            this.y = v.y;
            this.z = v.z;
            return this;
        }
        clone() {
            return new Vector3(this.x, this.y, this.z);
        }
        add(v) {
            this.x += v.x;
            this.y += v.y;
            this.z += v.z;
            return this;
        }
        subVectors(a, b) {
            this.x = a.x - b.x;
            this.y = a.y - b.y;
            this.z = a.z - b.z;
            return this;
        }
        normalize() {
            const l = this.length();
            if (l > 1e-6) {
                this.x /= l;
                this.y /= l;
                this.z /= l;
            }
            return this;
        }
        lengthSq() {
            return this.x * this.x + this.y * this.y + this.z * this.z;
        }
        length() {
            return Math.sqrt(this.lengthSq());
        }
        addScaledVector(v, s) {
            this.x += v.x * s;
            this.y += v.y * s;
            this.z += v.z * s;
            return this;
        }
        multiplyScalar(s) {
            this.x *= s;
            this.y *= s;
            this.z *= s;
            return this;
        }
    }

    class Euler {
        constructor(x = 0, y = 0, z = 0, order = 'XYZ') {
            this.x = x;
            this.y = y;
            this.z = z;
            this.order = order;
        }
        set(x, y, z, order) {
            this.x = x;
            this.y = y;
            this.z = z;
            if (order) this.order = order;
            return this;
        }
    }

    class PerspectiveCamera {
        constructor(fov = 45, aspect = 1, near = 1, far = 3000) {
            this.fov = fov;
            this.aspect = aspect;
            this.near = near;
            this.far = far;
            this.position = new Vector3(0, 0, 0);
            this.rotation = new Euler(0, 0, 0, 'YXZ');
        }
        getWorldDirection(vec) {
            if (!vec) vec = new Vector3();
            // Default facing -Z if rotation is identity
            vec.x = -Math.sin(this.rotation.y);
            vec.y = 0;
            vec.z = -Math.cos(this.rotation.y);
            return vec;
        }
        add() {}
    }

    class OrbitControls {
        constructor(camera, domElement) {
            this.camera = camera;
            this.domElement = domElement;
            this.target = new Vector3(0, 0, 0);
            this.enabled = true;
        }
        update() {}
    }

    const sandbox = {
        console,
        Math,
        Date,
        JSON,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        Infinity,
        NaN,
        parseFloat,
        parseInt,
        isNaN,
        isFinite,
        Array,
        Object,
        String,
        Number,
        Boolean,
        RegExp,
        Map,
        Set,
        requestAnimationFrame: (cb) => {
            // No-op for immediate step control in tests
        },
        window: {
            addEventListener: () => {},
            removeEventListener: () => {},
            location: { href: 'http://localhost/' },
            innerWidth: 1920,
            innerHeight: 1080,
            devicePixelRatio: 1
        },
        document: {
            addEventListener: () => {},
            removeEventListener: () => {},
            getElementById: (id) => getOrCreateElement(id),
            querySelector: (sel) => createMockElement('', 'DIV'),
            querySelectorAll: (sel) => [],
            createElement: (tag) => createMockElement('', tag),
            body: createMockElement('body', 'BODY'),
            pointerLockElement: null,
            exitPointerLock: () => {}
        },
        THREE: {
            Scene: class {
                add() {}
                remove() {}
            },
            Color: class {},
            PerspectiveCamera,
            OrbitControls,
            Vector2: class {
                constructor(x = 0, y = 0) { this.x = x; this.y = y; }
                set(x, y) { this.x = x; this.y = y; return this; }
            },
            Vector3,
            Euler,
            WebGLRenderer: class {
                constructor() {
                    this.domElement = createMockElement('canvas', 'CANVAS');
                    this.shadowMap = { enabled: false, type: 0 };
                }
                setSize() {}
                setPixelRatio() {}
                render() {}
                dispose() {}
            },
            AmbientLight: class {},
            DirectionalLight: class {
                constructor() {
                    this.position = new Vector3();
                    this.target = { position: new Vector3() };
                    this.shadow = { camera: {}, mapSize: {} };
                }
            },
            PointLight: class {
                constructor() {
                    this.position = new Vector3();
                }
            },
            Raycaster: class {},
            Group: class {
                constructor() {
                    this.children = [];
                    this.position = new Vector3();
                    this.rotation = new Euler();
                }
                add(obj) { this.children.push(obj); }
                remove() {}
            },
            Mesh: class {
                constructor() {
                    this.position = new Vector3();
                    this.rotation = new Euler();
                }
            },
            BoxGeometry: class {},
            PlaneGeometry: class {},
            CylinderGeometry: class {},
            MeshStandardMaterial: class {},
            MeshBasicMaterial: class {},
            CanvasTexture: class {
                wrapS = 0;
                wrapT = 0;
                repeat = { set: () => {} };
            },
            PCFSoftShadowMap: 2,
            ACESFilmicToneMapping: 4,
            sRGBEncoding: 3001,
            RepeatWrapping: 1000
        },
        lucide: {
            createIcons: () => {}
        }
    };
    sandbox.globalThis = sandbox;

    const exportSnippet = `
;globalThis.__EXPORTS__ = {
    State,
    History,
    Vector2D,
    Editor2D,
    Viewer3D,
    WalkthroughMode,
    CollisionEngine,
    SmartSnapping,
    BOMCalculator,
    ExportManager
};
`;

    const context = vm.createContext(sandbox);
    vm.runInContext(code + exportSnippet, context);

    return {
        exports: sandbox.__EXPORTS__,
        sandbox,
        canvasDrawCalls,
        mockCtx
    };
}

test('Feature 14 Empirical Challenge: Walkthrough Mode & 2D Radar Frustum', async (t) => {
    
    // =========================================================================
    // SUITE 1: Walkthrough Wall Clamping Stress (>= 500 Trajectory Iterations)
    // =========================================================================
    await t.test('Suite 1: Wall Clamping & Height Invariant Stress (1,000 Iterations)', async (st) => {
        const env = createWalkthroughTestEnvironment();
        const { Viewer3D, State, WalkthroughMode } = env.exports;

        // Ensure 3D Viewer is ready
        Viewer3D.camera = new env.sandbox.THREE.PerspectiveCamera(45, 1, 1, 3000);
        Viewer3D.controls = new env.sandbox.THREE.OrbitControls(Viewer3D.camera, null);
        Viewer3D.walkthroughMargin = 25;
        Viewer3D.walkthroughHeight = 165;

        await st.test('1.1 1,000 Continuous Traversal Iterations across Diverse Rooms', () => {
            const testRooms = [
                { name: 'Standard 500x400', width: 500, depth: 400, height: 250 },
                { name: 'Large Hall 1200x900', width: 1200, depth: 900, height: 320 },
                { name: 'Narrow Corridor 800x120', width: 800, depth: 120, height: 240 },
                { name: 'Small Square 200x200', width: 200, depth: 200, height: 220 }
            ];

            let totalStepsChecked = 0;
            const margin = Viewer3D.walkthroughMargin || 25;

            for (const roomConfig of testRooms) {
                State.room = roomConfig;
                Viewer3D.setWalkthroughMode(true);

                // Initial position at center
                Viewer3D.walkthroughPosition = { x: roomConfig.width / 2, y: roomConfig.depth / 2 };

                // Run 250 iterations per room = 1,000 total iterations
                for (let iter = 0; iter < 250; iter++) {
                    totalStepsChecked++;

                    // Pseudo-random deterministic heading and speed
                    const yaw = ((iter * 37) % 360) * (Math.PI / 180);
                    Viewer3D.walkthroughYaw = yaw;

                    // Speed varying from delicate crawl (1cm) to aggressive dash (50cm)
                    const speed = 1.0 + (iter % 50);
                    Viewer3D.walkthroughSpeed = speed;

                    // Random key activations
                    Viewer3D.keys = {
                        'KeyW': (iter % 3 === 0),
                        'KeyS': (iter % 5 === 0),
                        'KeyA': (iter % 7 === 0),
                        'KeyD': (iter % 4 === 0)
                    };
                    if (!Viewer3D.keys['KeyW'] && !Viewer3D.keys['KeyS'] && !Viewer3D.keys['KeyA'] && !Viewer3D.keys['KeyD']) {
                        Viewer3D.keys['KeyW'] = true; // ensure movement
                    }

                    // Execute one traversal step (reproducing Viewer3D.animate logic)
                    const moveDelta = new env.sandbox.THREE.Vector3();
                    const fwd = new env.sandbox.THREE.Vector3(-Math.sin(Viewer3D.walkthroughYaw), 0, -Math.cos(Viewer3D.walkthroughYaw));
                    const side = new env.sandbox.THREE.Vector3(fwd.z, 0, -fwd.x);

                    if (Viewer3D.keys['KeyW']) moveDelta.addScaledVector(fwd, speed);
                    if (Viewer3D.keys['KeyS']) moveDelta.addScaledVector(fwd, -speed);
                    if (Viewer3D.keys['KeyA']) moveDelta.addScaledVector(side, -speed);
                    if (Viewer3D.keys['KeyD']) moveDelta.addScaledVector(side, speed);

                    if (moveDelta.lengthSq() > 0) {
                        Viewer3D.camera.position.add(moveDelta);
                    }

                    // Boundary collision clamping with 25cm margin
                    const minX = -roomConfig.width / 2 + margin;
                    const maxX = roomConfig.width / 2 - margin;
                    const minZ = -roomConfig.depth / 2 + margin;
                    const maxZ = roomConfig.depth / 2 - margin;

                    if (maxX >= minX) {
                        Viewer3D.camera.position.x = Math.max(minX, Math.min(maxX, Viewer3D.camera.position.x));
                    } else {
                        Viewer3D.camera.position.x = 0;
                    }

                    if (maxZ >= minZ) {
                        Viewer3D.camera.position.z = Math.max(minZ, Math.min(maxZ, Viewer3D.camera.position.z));
                    } else {
                        Viewer3D.camera.position.z = 0;
                    }

                    Viewer3D.camera.position.y = Viewer3D.walkthroughHeight || 165;

                    // VERIFY INVARIANTS
                    const pos = Viewer3D.walkthroughPosition;

                    // 1. 2D Coordinates within [margin, room.width - margin] x [margin, room.depth - margin]
                    assert.ok(pos.x >= margin - 1e-4, `Iteration ${iter}: pos.x (${pos.x}) < margin (${margin}) in room ${roomConfig.name}`);
                    assert.ok(pos.x <= roomConfig.width - margin + 1e-4, `Iteration ${iter}: pos.x (${pos.x}) > max (${roomConfig.width - margin}) in room ${roomConfig.name}`);
                    assert.ok(pos.y >= margin - 1e-4, `Iteration ${iter}: pos.y (${pos.y}) < margin (${margin}) in room ${roomConfig.name}`);
                    assert.ok(pos.y <= roomConfig.depth - margin + 1e-4, `Iteration ${iter}: pos.y (${pos.y}) > max (${roomConfig.depth - margin}) in room ${roomConfig.name}`);

                    // 2. 3D Camera coordinates within [-width/2 + margin, width/2 - margin]
                    assert.ok(Viewer3D.camera.position.x >= minX - 1e-4, `Iteration ${iter}: camera.x (${Viewer3D.camera.position.x}) < minX (${minX})`);
                    assert.ok(Viewer3D.camera.position.x <= maxX + 1e-4, `Iteration ${iter}: camera.x (${Viewer3D.camera.position.x}) > maxX (${maxX})`);
                    assert.ok(Viewer3D.camera.position.z >= minZ - 1e-4, `Iteration ${iter}: camera.z (${Viewer3D.camera.position.z}) < minZ (${minZ})`);
                    assert.ok(Viewer3D.camera.position.z <= maxZ + 1e-4, `Iteration ${iter}: camera.z (${Viewer3D.camera.position.z}) > maxZ (${maxZ})`);

                    // 3. Eye-Level Height strictly 165 cm
                    assert.equal(pos.height, 165, `Iteration ${iter}: walkthroughPosition.height (${pos.height}) !== 165`);
                    assert.equal(Viewer3D.camera.position.y, 165, `Iteration ${iter}: camera.position.y (${Viewer3D.camera.position.y}) !== 165`);
                    assert.equal(pos.worldY, 165, `Iteration ${iter}: worldY (${pos.worldY}) !== 165`);
                }

                Viewer3D.setWalkthroughMode(false);
            }

            assert.equal(totalStepsChecked, 1000, 'Must have verified exactly 1,000 trajectory iterations');
        });

        await st.test('1.2 Deliberate High-Speed Wall and Corner Attacks', () => {
            State.room = { width: 500, depth: 400, height: 250 };
            Viewer3D.setWalkthroughMode(true);
            const margin = 25;

            // Attack 4 corners directly
            const corners = [
                { targetX: 0, targetY: 0, expectedX: 25, expectedY: 25 },
                { targetX: 500, targetY: 0, expectedX: 475, expectedY: 25 },
                { targetX: 500, targetY: 400, expectedX: 475, expectedY: 375 },
                { targetX: 0, targetY: 400, expectedX: 25, expectedY: 375 }
            ];

            for (const corner of corners) {
                // Set position directly at corner
                Viewer3D.walkthroughPosition = { x: corner.targetX, y: corner.targetY };
                const pos = Viewer3D.walkthroughPosition;
                assert.equal(pos.x, corner.expectedX, `Corner X clamped incorrectly`);
                assert.equal(pos.y, corner.expectedY, `Corner Y clamped incorrectly`);
                assert.equal(pos.height, 165, `Corner height must be 165`);
            }

            // High-speed slam: set extreme out-of-bounds positions
            const extremeAttacks = [
                { x: -999999, y: -999999, expX: 25, expY: 25 },
                { x: 999999, y: 999999, expX: 475, expY: 375 },
                { worldX: -999999, worldZ: 999999, expX: 25, expY: 375 },
                { worldX: 999999, worldZ: -999999, expX: 475, expY: 25 }
            ];

            for (const atk of extremeAttacks) {
                Viewer3D.walkthroughPosition = atk;
                const pos = Viewer3D.walkthroughPosition;
                assert.equal(pos.x, atk.expX, `Extreme attack X failed`);
                assert.equal(pos.y, atk.expY, `Extreme attack Y failed`);
                assert.equal(Viewer3D.camera.position.y, 165, `Camera height corrupted on extreme attack`);
            }

            // Adversarial tiny room where dimension < 2 * margin (e.g. 40 x 40 with margin 25)
            State.room = { width: 40, depth: 40, height: 250 };
            Viewer3D.walkthroughPosition = { x: 20, y: 20 };
            assert.equal(Viewer3D.camera.position.x, 0, 'Camera X should center when room is smaller than margin');
            assert.equal(Viewer3D.camera.position.z, 0, 'Camera Z should center when room is smaller than margin');
            assert.equal(Viewer3D.camera.position.y, 165, 'Camera height should remain 165 in tiny room');

            Viewer3D.setWalkthroughMode(false);
        });
    });

    // =========================================================================
    // SUITE 2: OrbitControls Lifecycle & Re-entrance Stress (100 Cycles)
    // =========================================================================
    await t.test('Suite 2: OrbitControls Lifecycle & Re-entrance Stress (100 Cycles)', async (st) => {
        const env = createWalkthroughTestEnvironment();
        const { Viewer3D, WalkthroughMode, State } = env.exports;

        Viewer3D.camera = new env.sandbox.THREE.PerspectiveCamera(45, 1, 1, 3000);
        Viewer3D.controls = new env.sandbox.THREE.OrbitControls(Viewer3D.camera, null);
        State.room = { width: 600, depth: 500, height: 260 };

        await st.test('2.1 100 Rapid Sequential Enter/Exit Cycles with Camera Movement', () => {
            const initialCamPos = { x: 350, y: 480, z: 620 };
            const initialTarget = { x: 12, y: 34, z: 56 };

            Viewer3D.camera.position.set(initialCamPos.x, initialCamPos.y, initialCamPos.z);
            Viewer3D.controls.target.set(initialTarget.x, initialTarget.y, initialTarget.z);
            Viewer3D.controls.enabled = true;

            for (let cycle = 1; cycle <= 100; cycle++) {
                // Enter walkthrough
                Viewer3D.setWalkthroughMode(true);
                assert.equal(Viewer3D.isWalkthrough, true, `Cycle ${cycle}: isWalkthrough should be true`);
                assert.equal(Viewer3D.controls.enabled, false, `Cycle ${cycle}: controls should be disabled`);
                assert.equal(Viewer3D.camera.position.y, 165, `Cycle ${cycle}: height should be 165 cm`);

                // Move around inside walkthrough mode
                Viewer3D.walkthroughPosition = { x: 100 + (cycle % 200), y: 120 + (cycle % 150) };
                Viewer3D.walkthroughAngle = (cycle * 17) % 360;

                // Exit walkthrough
                Viewer3D.setWalkthroughMode(false);
                assert.equal(Viewer3D.isWalkthrough, false, `Cycle ${cycle}: isWalkthrough should be false`);
                assert.equal(Viewer3D.controls.enabled, true, `Cycle ${cycle}: controls should be re-enabled`);

                // Verify exact OrbitControls restoration without drift
                assert.ok(Math.abs(Viewer3D.camera.position.x - initialCamPos.x) < 1e-5, `Cycle ${cycle}: cam.x drifted (${Viewer3D.camera.position.x})`);
                assert.ok(Math.abs(Viewer3D.camera.position.y - initialCamPos.y) < 1e-5, `Cycle ${cycle}: cam.y drifted (${Viewer3D.camera.position.y})`);
                assert.ok(Math.abs(Viewer3D.camera.position.z - initialCamPos.z) < 1e-5, `Cycle ${cycle}: cam.z drifted (${Viewer3D.camera.position.z})`);

                assert.ok(Math.abs(Viewer3D.controls.target.x - initialTarget.x) < 1e-5, `Cycle ${cycle}: target.x drifted (${Viewer3D.controls.target.x})`);
                assert.ok(Math.abs(Viewer3D.controls.target.y - initialTarget.y) < 1e-5, `Cycle ${cycle}: target.y drifted (${Viewer3D.controls.target.y})`);
                assert.ok(Math.abs(Viewer3D.controls.target.z - initialTarget.z) < 1e-5, `Cycle ${cycle}: target.z drifted (${Viewer3D.controls.target.z})`);

                // Verify zero NaNs
                assert.ok(!isNaN(Viewer3D.camera.position.x), `Cycle ${cycle}: cam.x is NaN`);
                assert.ok(!isNaN(Viewer3D.controls.target.x), `Cycle ${cycle}: target.x is NaN`);
            }
        });

        await st.test('2.2 WalkthroughMode Bridge 100 Toggle Cycles', () => {
            const initialCamPos = { x: 250, y: 350, z: 450 };
            const initialTarget = { x: 0, y: 50, z: 0 };

            Viewer3D.camera.position.set(initialCamPos.x, initialCamPos.y, initialCamPos.z);
            Viewer3D.controls.target.set(initialTarget.x, initialTarget.y, initialTarget.z);

            for (let i = 0; i < 50; i++) {
                // Toggle ON
                const on = WalkthroughMode.toggle();
                assert.equal(on, true);
                assert.equal(Viewer3D.isWalkthrough, true);

                // Toggle OFF
                const off = WalkthroughMode.toggle();
                assert.equal(off, false);
                assert.equal(Viewer3D.isWalkthrough, false);

                // Assert zero drift
                assert.equal(Viewer3D.camera.position.x, initialCamPos.x);
                assert.equal(Viewer3D.camera.position.y, initialCamPos.y);
                assert.equal(Viewer3D.camera.position.z, initialCamPos.z);
            }
        });

        await st.test('2.3 Re-entrance and Idempotency Lifecycle Stress', () => {
            const initialCamPos = { x: 500, y: 600, z: 700 };
            const initialTarget = { x: 10, y: 20, z: 30 };

            Viewer3D.camera.position.set(initialCamPos.x, initialCamPos.y, initialCamPos.z);
            Viewer3D.controls.target.set(initialTarget.x, initialTarget.y, initialTarget.z);

            // --- Case A: Double Enter (Re-entrance) ---
            // 1. Enter walkthrough
            Viewer3D.setWalkthroughMode(true);
            assert.equal(Viewer3D.isWalkthrough, true);

            // 2. Player traverses inside walkthrough mode to new position
            Viewer3D.walkthroughPosition = { x: 100, y: 150 };

            // 3. Re-entrant call while already in walkthrough mode
            Viewer3D.setWalkthroughMode(true);

            // 4. Exit walkthrough mode
            Viewer3D.setWalkthroughMode(false);

            // Orbit controls position MUST restore to initialCamPos (500, 600, 700), NOT walkthrough position (-150, 165, -50)
            assert.equal(
                Viewer3D.camera.position.x,
                initialCamPos.x,
                `Double-enter clobbered savedOrbitState! Expected camera.x=${initialCamPos.x}, got ${Viewer3D.camera.position.x}`
            );
            assert.equal(
                Viewer3D.camera.position.y,
                initialCamPos.y,
                `Double-enter clobbered savedOrbitState! Expected camera.y=${initialCamPos.y}, got ${Viewer3D.camera.position.y}`
            );
            assert.equal(
                Viewer3D.camera.position.z,
                initialCamPos.z,
                `Double-enter clobbered savedOrbitState! Expected camera.z=${initialCamPos.z}, got ${Viewer3D.camera.position.z}`
            );

            // --- Case B: Redundant Exit when Already Inactive ---
            // User manually navigates orbit camera to a new viewpoint
            Viewer3D.camera.position.set(777, 888, 999);

            // Redundant setWalkthroughMode(false) called
            Viewer3D.setWalkthroughMode(false);

            // Camera MUST remain at (777, 888, 999), NOT be overwritten by stale savedOrbitState
            assert.equal(
                Viewer3D.camera.position.x,
                777,
                `Redundant exit clobbered current orbit camera with stale savedOrbitState! Expected x=777, got ${Viewer3D.camera.position.x}`
            );
        });
    });

    // =========================================================================
    // SUITE 3: 2D Radar Frustum Projection Stress (Full 360° Sweep)
    // =========================================================================
    await t.test('Suite 3: 2D Radar Frustum Projection Stress (360° Sweep & Zero NaNs)', async (st) => {
        const env = createWalkthroughTestEnvironment();
        const { Viewer3D, Editor2D, State } = env.exports;

        State.room = { width: 500, depth: 400, height: 250 };
        Viewer3D.camera = new env.sandbox.THREE.PerspectiveCamera(45, 1, 1, 3000);
        Viewer3D.isWalkthrough = true;
        Viewer3D.walkthroughPosition = { x: 250, y: 200 };

        await st.test('3.1 Full 360° Sweep in 1° Increments: Zero NaNs Invariant', () => {
            let totalArcs = 0;
            let totalLines = 0;
            let totalMoves = 0;

            for (let deg = 0; deg < 360; deg++) {
                Viewer3D.walkthroughAngle = deg;

                // Clear previous draw calls
                env.canvasDrawCalls.length = 0;

                // Execute radar drawing
                Editor2D.drawCameraRadar(env.mockCtx);

                assert.ok(env.canvasDrawCalls.length > 0, `Degree ${deg}: drawCameraRadar must generate draw calls`);

                // Inspect every single numeric argument passed to Canvas API
                for (const call of env.canvasDrawCalls) {
                    if (call.args && call.args.length > 0) {
                        for (let argIdx = 0; argIdx < call.args.length; argIdx++) {
                            const val = call.args[argIdx];
                            if (typeof val === 'number') {
                                assert.ok(!isNaN(val), `Degree ${deg}, Method ${call.method}, Arg ${argIdx}: argument is NaN!`);
                                assert.ok(isFinite(val), `Degree ${deg}, Method ${call.method}, Arg ${argIdx}: argument is infinite!`);
                            }
                        }
                    }

                    if (call.method === 'arc') {
                        totalArcs++;
                        const [cx, cy, r, sAngle, eAngle] = call.args;
                        assert.ok(r > 0, `Degree ${deg}: Arc radius must be positive, got ${r}`);
                        // When drawing the 65° FOV sector
                        if (Math.abs(r - 100) < 1e-4) {
                            const arcSpan = eAngle - sAngle;
                            const expectedSpan = (65 * Math.PI) / 180;
                            assert.ok(Math.abs(arcSpan - expectedSpan) < 1e-5, `Degree ${deg}: FOV arc span mismatch`);
                        }
                    } else if (call.method === 'lineTo') {
                        totalLines++;
                    } else if (call.method === 'moveTo') {
                        totalMoves++;
                    }
                }
            }

            assert.ok(totalArcs >= 360 * 3, `Expected at least 1,080 arc draw calls across 360°, got ${totalArcs}`);
            assert.ok(totalLines >= 360 * 2, `Expected at least 720 lineTo calls across 360°, got ${totalLines}`);
            assert.ok(totalMoves >= 360 * 2, `Expected at least 720 moveTo calls across 360°, got ${totalMoves}`);
        });

        await st.test('3.2 Adversarial Angles and Zoom Factors', () => {
            const extremeAngles = [-720, -360, -180, -90, -45, -0.001, 0, 0.001, 360, 720, 100000];
            const testZooms = [0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0];

            for (const angle of extremeAngles) {
                Viewer3D.walkthroughAngle = angle;
                for (const zoom of testZooms) {
                    State.editor2D.zoom = zoom;
                    env.canvasDrawCalls.length = 0;

                    Editor2D.drawCameraRadar(env.mockCtx);

                    for (const call of env.canvasDrawCalls) {
                        if (call.args) {
                            for (let argIdx = 0; argIdx < call.args.length; argIdx++) {
                                const val = call.args[argIdx];
                                if (typeof val === 'number') {
                                    assert.ok(!isNaN(val), `Angle ${angle}, Zoom ${zoom}, Method ${call.method}: NaN detected!`);
                                    assert.ok(isFinite(val), `Angle ${angle}, Zoom ${zoom}, Method ${call.method}: Infinite detected!`);
                                }
                            }
                        }
                    }
                }
            }
        });
    });

    // =========================================================================
    // SUITE 4: Headless Environment Safety
    // =========================================================================
    await t.test('Suite 4: Headless Environment Safety', async (st) => {
        const env = createWalkthroughTestEnvironment();
        const { Viewer3D, WalkthroughMode, Editor2D, State } = env.exports;

        await st.test('4.1 Missing Camera or Controls Auto-Instantiation', () => {
            Viewer3D.camera = null;
            Viewer3D.controls = null;

            // Getting position with null camera should not crash and return valid object
            const pos = Viewer3D.walkthroughPosition;
            assert.ok(typeof pos.x === 'number');
            assert.ok(typeof pos.y === 'number');
            assert.ok(typeof pos.height === 'number');

            // setWalkthroughMode with null camera and controls should auto-initialize
            assert.doesNotThrow(() => {
                Viewer3D.setWalkthroughMode(true);
            });
            assert.ok(Viewer3D.camera !== null, 'Camera should have been auto-initialized');
            assert.ok(Viewer3D.controls !== null, 'Controls should have been auto-initialized');
            assert.equal(Viewer3D.isWalkthrough, true);
            assert.equal(Viewer3D.camera.position.y, 165);
            assert.equal(Viewer3D.walkthroughPosition.height, 165);

            Viewer3D.setWalkthroughMode(false);
            assert.equal(Viewer3D.isWalkthrough, false);
        });

        await st.test('4.2 Missing DOM Elements During Toggle', () => {
            // Document with getElementById returning null
            env.sandbox.document.getElementById = () => null;

            assert.doesNotThrow(() => {
                Viewer3D.setWalkthroughMode(true);
                Viewer3D.setWalkthroughMode(false);
            });
        });

        await st.test('4.3 Radar Cone Safety when Walkthrough Inactive but showRadarAlways True', () => {
            Viewer3D.isWalkthrough = false;
            Viewer3D.showRadarAlways = true;

            env.canvasDrawCalls.length = 0;
            assert.doesNotThrow(() => {
                Editor2D.drawCameraRadar(env.mockCtx);
            });
            assert.ok(env.canvasDrawCalls.length > 0, 'Should draw radar cone when showRadarAlways is true');
        });

        await st.test('4.4 Bridge Method Interface Safety with Invalid Inputs', () => {
            assert.doesNotThrow(() => {
                WalkthroughMode.setPosition(null);
                WalkthroughMode.setPosition(undefined);
                WalkthroughMode.setPosition({});
                WalkthroughMode.setAngle('invalid');
                WalkthroughMode.setAngle(null);
            });
        });
    });
});
