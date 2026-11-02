/**
 * RoomCraft — Milestone 3 Round 2 Adversarial Deletion Lifecycle Test Suite
 * 
 * Adversarially challenges:
 * 1. Multi-item placement (5 items), selective deletion of item 3, scene child count decrement,
 *    furnitureMeshes.size tracking, complete mesh removal, and preservation of surviving items.
 * 2. Rapid sequential full deletion returning scene children strictly to baseline room shell count.
 * 3. Direct manual invocation of Viewer3D.updateFurniture3D(deletedItem) to ensure resurrection resistance.
 * 4. Idempotent double-deletion and no-op handling when nothing is selected.
 * 5. High-frequency create-select-delete churn (50 cycles) to ensure zero scene graph leak.
 * 6. Direct removal of non-existent or unmanaged items without throw.
 * 7. Selection indicator switching among surviving furniture after deletion maintains pristine state without ghosting.
 * 8. Real Chromium WebGL end-to-end verification of deletion lifecycle, 5-item deletion, and sequential full clear.
 * 9. Real Chromium WebGL raycast neutralization ensuring deleted items are 100% untargetable by raycasts.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { setupTestEnvironment } = require('./e2e/helpers');

function createIsolatedTestEnvironment() {
    const appPath = path.resolve(__dirname, '../app.js');
    const code = fs.readFileSync(appPath, 'utf8');

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
        createRadialGradient: () => ({ addColorStop: () => {} }),
        createPattern: () => null,
        drawImage: () => {}
    };

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
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 })
    });

    const getOrCreateElement = (id) => {
        if (!elementsMap.has(id)) {
            elementsMap.set(id, createMockElement(id));
        }
        return elementsMap.get(id);
    };

    class Vector2 {
        constructor(x = 0, y = 0) { this.x = x; this.y = y; }
        set(x, y) { this.x = x; this.y = y; return this; }
    }

    class Vector3 {
        constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
        set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
        copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
        add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
        subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
        normalize() { return this; }
        length() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
        lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
    }

    class Object3D {
        constructor() {
            this.position = new Vector3();
            this.rotation = { x: 0, y: 0, z: 0 };
            this.scale = new Vector3(1, 1, 1);
            this.children = [];
            this.parent = null;
            this.userData = {};
            this.castShadow = false;
            this.receiveShadow = false;
            this.visible = true;
        }
        add(child) {
            child.parent = this;
            this.children.push(child);
            return this;
        }
        remove(child) {
            const idx = this.children.indexOf(child);
            if (idx !== -1) {
                child.parent = null;
                this.children.splice(idx, 1);
            }
            return this;
        }
    }

    class Group extends Object3D { constructor() { super(); this.type = 'Group'; } }
    class Mesh extends Object3D {
        constructor(geometry, material) {
            super();
            this.type = 'Mesh';
            this.geometry = geometry;
            this.material = material;
        }
    }
    class LineSegments extends Object3D {
        constructor(geometry, material) {
            super();
            this.type = 'LineSegments';
            this.geometry = geometry;
            this.material = material;
            this.raycast = () => {};
        }
    }

    class BoxGeometry { constructor(w = 1, h = 1, d = 1) { this.parameters = { width: w, height: h, depth: d }; } }
    class CylinderGeometry { constructor(rt = 1, rb = 1, h = 1, s = 8) { this.parameters = { radiusTop: rt, radiusBottom: rb, height: h, radialSegments: s }; } }
    class SphereGeometry { constructor(r = 1) { this.parameters = { radius: r }; } }
    class TubeGeometry { constructor(p, t = 64, r = 1) { this.parameters = { path: p, tubularSegments: t, radius: r }; } }
    class EdgesGeometry { constructor(geometry) { this.geometry = geometry; } }
    class LineBasicMaterial { constructor(params = {}) { this.params = params; } }
    class MeshStandardMaterial { constructor(params = {}) { this.params = params; } }
    class MeshBasicMaterial { constructor(params = {}) { this.params = params; } }
    class Scene extends Object3D { constructor() { super(); this.type = 'Scene'; } }
    class PerspectiveCamera extends Object3D { constructor() { super(); this.type = 'PerspectiveCamera'; } }

    const mockThree = {
        Vector2, Vector3, Object3D, Group, Mesh, LineSegments,
        BoxGeometry, CylinderGeometry, SphereGeometry, TubeGeometry, EdgesGeometry,
        LineBasicMaterial, MeshStandardMaterial, MeshBasicMaterial,
        Scene, PerspectiveCamera,
        CatmullRomCurve3: class { constructor(p = []) { this.points = p; } },
        Shape: class { constructor() { this.curves = []; } moveTo() {} bezierCurveTo() {} },
        ShapeGeometry: class { constructor() { this.attributes = { position: { count: 24, getX: () => 0, getY: () => 0, getZ: () => 0, setZ: () => {} } }; } computeVertexNormals() {} },
        BufferGeometry: class { constructor() { this.setAttribute = () => {}; this.computeVertexNormals = () => {}; } },
        Float32BufferAttribute: class { constructor(arr, itemSize) { this.array = arr; this.itemSize = itemSize; } },
        CanvasTexture: class { constructor() { this.wrapS = 1000; this.wrapT = 1000; this.repeat = new Vector2(1, 1); this.needsUpdate = false; } },
        PointLight: class extends Object3D { constructor(c, i, d) { super(); this.type = 'PointLight'; this.color = c; this.intensity = i; this.distance = d; } },
        Raycaster: class {
            constructor() { this.ray = { origin: new Vector3(), direction: new Vector3(0, 0, -1) }; }
            set(origin, direction) { this.ray.origin.copy(origin); this.ray.direction.copy(direction); }
            intersectObjects(objects, recursive = true) {
                const hits = [];
                const search = (objList) => {
                    for (const o of objList) {
                        if (o.type === 'Mesh' && o.visible !== false) hits.push({ object: o, point: new Vector3() });
                        if (recursive && o.children && o.children.length > 0) search(o.children);
                    }
                };
                search(objects);
                return hits;
            }
        }
    };

    const sandbox = {
        window: {
            innerWidth: 1440,
            innerHeight: 900,
            devicePixelRatio: 1,
            addEventListener: () => {},
            removeEventListener: () => {}
        },
        document: {
            getElementById: getOrCreateElement,
            querySelector: () => null,
            querySelectorAll: () => [],
            createElement: (tag) => createMockElement('', tag),
            addEventListener: () => {},
            removeEventListener: () => {}
        },
        THREE: mockThree,
        lucide: { createIcons: () => {} },
        OrbitControls: function() { this.target = new mockThree.Vector3(); this.update = () => {}; },
        console,
        Math,
        Array,
        Object,
        String,
        Number,
        Boolean,
        Map,
        Set,
        Date
    };
    sandbox.globalThis = sandbox;

    const exportSnippet = `
;globalThis.__EXPORTS__ = {
    State,
    History,
    Vector2D,
    getClosestWall,
    formatDim,
    wallUDToRoomXY,
    getPitchInterval,
    getWallPitchHeightAt,
    getCeilingHeightAt,
    getFurnitureCorners,
    CollisionEngine,
    Presets,
    Editor2D,
    Viewer3D,
    selectItem,
    showPropertiesTab
};
`;

    vm.runInNewContext(code + exportSnippet, sandbox);
    return {
        app: sandbox.__EXPORTS__,
        sandbox,
        mockCtx,
        canvasDrawCalls
    };
}

describe('Empirical Challenger: Adversarial Deletion Lifecycle & Ghost Mesh Elimination (Node Sandbox)', () => {

    function setupSandboxWithRoom(app, sandbox) {
        const { Viewer3D, State, Presets } = app;
        const { THREE } = sandbox;

        // Reset state with complete pitches structure
        State.room = {
            width: 500,
            depth: 400,
            height: 260,
            pitches: {
                top: { enabled: false },
                bottom: { enabled: false },
                left: { enabled: false },
                right: { enabled: false }
            }
        };
        State.furniture = [];
        State.selectedItem = null;
        State.selectedItemType = null;

        // Initialize 3D scene & renderer mock
        Viewer3D.scene = new THREE.Scene();
        Viewer3D.camera = new THREE.PerspectiveCamera();
        Viewer3D.furnitureMeshes = new Map();
        Viewer3D.renderer = {
            domElement: { width: 800, height: 600 },
            render: () => {},
            setSize: () => {}
        };
        Viewer3D.floorMesh = new THREE.Mesh();
        Viewer3D.floorMesh.name = 'floor';
        Viewer3D.scene.add(Viewer3D.floorMesh);

        // Add 4 baseline walls to simulate realistic room shell
        for (let i = 0; i < 4; i++) {
            const wall = new THREE.Mesh();
            wall.name = `wall_${i}`;
            Viewer3D.scene.add(wall);
        }

        const baselineCount = Viewer3D.scene.children.length; // floor + 4 walls = 5

        // Create 5 distinct furniture items
        const item1 = { ...Presets['lounge-chair'], id: 'f_test_1', presetKey: 'lounge-chair', x: 100, y: 100, rotation: 0, elevation: 0 };
        const item2 = { ...Presets['bookshelf'], id: 'f_test_2', presetKey: 'bookshelf', x: 200, y: 100, rotation: 0, elevation: 0 };
        const item3 = { ...Presets['coffee-table-set'], id: 'f_test_3', presetKey: 'coffee-table-set', x: 300, y: 200, rotation: 15, elevation: 0 };
        const item4 = { ...Presets['tv-lowboard'], id: 'f_test_4', presetKey: 'tv-lowboard', x: 100, y: 300, rotation: 90, elevation: 0 };
        const item5 = { ...Presets['plant'], id: 'f_test_5', presetKey: 'plant', x: 400, y: 350, rotation: 0, elevation: 0 };

        const items = [item1, item2, item3, item4, item5];

        items.forEach(it => {
            State.furniture.push(it);
            Viewer3D.updateFurniture3D(it);
        });

        return { items, baselineCount };
    }

    test('Adversarial 1: Placing 5 items, selecting item 3, deleting item 3 -> scene child count decrements, furnitureMeshes.size === 4, item 3 completely gone, surviving 4 items preserved', () => {
        const { app, sandbox } = createIsolatedTestEnvironment();
        const { Viewer3D, State, Editor2D, selectItem } = app;
        const { items, baselineCount } = setupSandboxWithRoom(app, sandbox);

        const initialChildCount = Viewer3D.scene.children.length;
        assert.strictEqual(initialChildCount, baselineCount + 5, `Initial scene children should be baseline (${baselineCount}) + 5 items`);
        assert.strictEqual(Viewer3D.furnitureMeshes.size, 5, 'furnitureMeshes must hold all 5 items');
        assert.strictEqual(State.furniture.length, 5, 'State.furniture must contain 5 items');

        const item3 = items[2]; // coffee-table-set
        assert.strictEqual(item3.id, 'f_test_3');

        // Select item 3
        selectItem(item3, 'furniture');
        assert.strictEqual(State.selectedItem, item3, 'State.selectedItem must be item3');
        assert.strictEqual(State.selectedItemType, 'furniture');

        // Delete item 3 via Editor2D.deleteSelected()
        Editor2D.deleteSelected();

        // 1. Check State.furniture
        assert.strictEqual(State.furniture.length, 4, 'State.furniture length must decrease to 4');
        assert.strictEqual(State.furniture.includes(item3), false, 'item3 must NOT be present in State.furniture');
        assert.strictEqual(State.selectedItem, null, 'State.selectedItem must be cleared to null');
        assert.strictEqual(State.selectedItemType, null, 'State.selectedItemType must be cleared to null');

        // 2. Check Viewer3D.furnitureMeshes
        assert.strictEqual(Viewer3D.furnitureMeshes.size, 4, 'Viewer3D.furnitureMeshes size must be exactly 4');
        assert.strictEqual(Viewer3D.furnitureMeshes.has(item3), false, 'Viewer3D.furnitureMeshes must NOT contain item3');

        // 3. Check Viewer3D.scene children
        assert.strictEqual(Viewer3D.scene.children.length, initialChildCount - 1, 'Scene children count must decrease by exactly 1');
        const ghostMeshInScene = Viewer3D.scene.children.some(c => 
            (c.userData && (c.userData.furniture === item3 || c.userData.furnitureId === item3.id))
        );
        assert.strictEqual(ghostMeshInScene, false, 'No group or mesh associated with item3 may linger in scene');

        // 4. Verify surviving 4 items are completely intact
        const surviving = [items[0], items[1], items[3], items[4]];
        surviving.forEach((it) => {
            assert.ok(State.furniture.includes(it), `Surviving item ${it.id} must be in State.furniture`);
            assert.ok(Viewer3D.furnitureMeshes.has(it), `Surviving item ${it.id} must be in Viewer3D.furnitureMeshes`);
            const group = Viewer3D.furnitureMeshes.get(it);
            assert.ok(Viewer3D.scene.children.includes(group), `Surviving item ${it.id} group must be present in Viewer3D.scene`);
            assert.strictEqual(group.userData.furniture, it);
            assert.strictEqual(group.userData.furnitureId, it.id);
        });
    });

    test('Adversarial 2: Rapid sequential full deletion -> 3D scene child count returns strictly to baseline room shell count', () => {
        const { app, sandbox } = createIsolatedTestEnvironment();
        const { Viewer3D, State, Editor2D, selectItem } = app;
        const { items, baselineCount } = setupSandboxWithRoom(app, sandbox);

        assert.strictEqual(Viewer3D.scene.children.length, baselineCount + 5);

        // Sequentially select and delete each item
        while (State.furniture.length > 0) {
            const nextItem = State.furniture[0];
            const prevChildCount = Viewer3D.scene.children.length;
            const prevMeshCount = Viewer3D.furnitureMeshes.size;

            selectItem(nextItem, 'furniture');
            Editor2D.deleteSelected();

            assert.strictEqual(Viewer3D.scene.children.length, prevChildCount - 1, 'Child count must decrement on each deletion');
            assert.strictEqual(Viewer3D.furnitureMeshes.size, prevMeshCount - 1, 'furnitureMeshes.size must decrement on each deletion');
            assert.strictEqual(Viewer3D.furnitureMeshes.has(nextItem), false, 'Deleted item must be removed from furnitureMeshes');
        }

        // Final verification after all 5 items deleted
        assert.strictEqual(State.furniture.length, 0, 'State.furniture must be empty');
        assert.strictEqual(Viewer3D.furnitureMeshes.size, 0, 'Viewer3D.furnitureMeshes must be empty');
        assert.strictEqual(Viewer3D.scene.children.length, baselineCount, `Viewer3D.scene.children must return strictly to baseline count (${baselineCount})`);
        
        // Ensure no lingering groups exist
        const hasAnyFurnitureData = Viewer3D.scene.children.some(c => c.userData && c.userData.furniture);
        assert.strictEqual(hasAnyFurnitureData, false, 'No children with furniture userData should exist');
    });

    test('Adversarial 3: Direct manual invocation of Viewer3D.updateFurniture3D(deletedItem) strictly refuses to resurrect mesh and returns early', () => {
        const { app, sandbox } = createIsolatedTestEnvironment();
        const { Viewer3D, State, Editor2D, selectItem } = app;
        const { items } = setupSandboxWithRoom(app, sandbox);

        const target = items[1]; // bookshelf
        selectItem(target, 'furniture');
        Editor2D.deleteSelected();

        assert.strictEqual(State.furniture.includes(target), false);
        assert.strictEqual(Viewer3D.furnitureMeshes.has(target), false);
        const childrenCountAfterDelete = Viewer3D.scene.children.length;

        // Direct malicious / rogue invocation with deleted item
        Viewer3D.updateFurniture3D(target);

        // Verification: must NOT recreate or re-add
        assert.strictEqual(Viewer3D.furnitureMeshes.has(target), false, 'Must NOT add target back to furnitureMeshes');
        assert.strictEqual(Viewer3D.scene.children.length, childrenCountAfterDelete, 'Scene child count must NOT increase');
        assert.strictEqual(
            Viewer3D.scene.children.some(c => c.userData && (c.userData.furniture === target || c.userData.furnitureId === target.id)),
            false,
            'No phantom group must be inserted into Viewer3D.scene'
        );

        // Repeat call 5 times consecutively
        for (let i = 0; i < 5; i++) {
            Viewer3D.updateFurniture3D(target);
        }
        assert.strictEqual(Viewer3D.furnitureMeshes.has(target), false);
        assert.strictEqual(Viewer3D.scene.children.length, childrenCountAfterDelete);
    });

    test('Adversarial 4: Double deletion & no-op idempotency', () => {
        const { app, sandbox } = createIsolatedTestEnvironment();
        const { Viewer3D, State, Editor2D, selectItem } = app;
        const { items } = setupSandboxWithRoom(app, sandbox);

        const target = items[0];
        selectItem(target, 'furniture');

        // First deletion
        Editor2D.deleteSelected();
        const countAfterFirst = Viewer3D.scene.children.length;

        // Second immediate deletion call with nothing selected
        assert.strictEqual(State.selectedItem, null);
        assert.doesNotThrow(() => {
            Editor2D.deleteSelected();
        }, 'Second deleteSelected call on null selection must not throw');

        assert.strictEqual(Viewer3D.scene.children.length, countAfterFirst, 'Scene children count must remain unchanged');
        assert.strictEqual(Viewer3D.furnitureMeshes.size, 4, 'furnitureMeshes.size must remain 4');
    });

    test('Adversarial 5: High-frequency churn test (50 cycles of Add -> Select -> Delete)', () => {
        const { app, sandbox } = createIsolatedTestEnvironment();
        const { Viewer3D, State, Editor2D, selectItem, Presets } = app;
        const { baselineCount } = setupSandboxWithRoom(app, sandbox);

        // First clear initial items to start clean
        while (State.furniture.length > 0) {
            selectItem(State.furniture[0], 'furniture');
            Editor2D.deleteSelected();
        }
        assert.strictEqual(Viewer3D.scene.children.length, baselineCount);
        assert.strictEqual(Viewer3D.furnitureMeshes.size, 0);

        const presetKeys = ['lounge-chair', 'bookshelf', 'coffee-table-set', 'tv-lowboard', 'plant', 'nightstand', 'arc-lamp'];

        // Churn 50 iterations
        for (let i = 0; i < 50; i++) {
            const key = presetKeys[i % presetKeys.length];
            const tempItem = {
                ...Presets[key],
                id: `churn_${i}`,
                presetKey: key,
                x: 150 + (i % 20),
                y: 150 + (i % 20),
                rotation: (i * 15) % 360,
                elevation: 0
            };

            // Add & build 3D
            State.furniture.push(tempItem);
            Viewer3D.updateFurniture3D(tempItem);

            assert.strictEqual(Viewer3D.furnitureMeshes.size, 1, `Iteration ${i}: size should be 1 after add`);
            assert.strictEqual(Viewer3D.scene.children.length, baselineCount + 1, `Iteration ${i}: children should be baseline + 1`);

            // Select
            selectItem(tempItem, 'furniture');

            // Delete
            Editor2D.deleteSelected();

            assert.strictEqual(Viewer3D.furnitureMeshes.size, 0, `Iteration ${i}: size should return to 0`);
            assert.strictEqual(Viewer3D.scene.children.length, baselineCount, `Iteration ${i}: children should return to baseline`);
        }

        assert.strictEqual(Viewer3D.scene.children.length, baselineCount, 'Scene children must strictly equal baseline after 50 churn cycles');
        assert.strictEqual(Viewer3D.furnitureMeshes.size, 0, 'furnitureMeshes map must be empty after 50 churn cycles');
    });

    test('Adversarial 6: Calling Viewer3D.removeFurniture3D with unmanaged or null items is safe', () => {
        const { app } = createIsolatedTestEnvironment();
        const { Viewer3D } = app;

        assert.doesNotThrow(() => {
            Viewer3D.removeFurniture3D(null);
            Viewer3D.removeFurniture3D(undefined);
            Viewer3D.removeFurniture3D({ id: 'non_existent' });
        });
    });

    test('Adversarial 7: Selection indicator switching among surviving furniture after deletion maintains pristine state without ghosting', () => {
        const { app, sandbox } = createIsolatedTestEnvironment();
        const { Viewer3D, State, Editor2D, selectItem } = app;
        const { items } = setupSandboxWithRoom(app, sandbox);

        // Delete item 3
        selectItem(items[2], 'furniture');
        Editor2D.deleteSelected();

        // Switch selection to item 1
        selectItem(items[0], 'furniture');
        assert.strictEqual(State.selectedItem, items[0]);
        const g0 = Viewer3D.furnitureMeshes.get(items[0]);
        assert.ok(g0.children.some(c => c.name === 'selectionIndicator'), 'Item 0 must have selectionIndicator');

        // Switch selection to item 4
        selectItem(items[3], 'furniture');
        assert.strictEqual(State.selectedItem, items[3]);
        assert.strictEqual(g0.children.some(c => c.name === 'selectionIndicator'), false, 'Item 0 indicator removed');
        const g3 = Viewer3D.furnitureMeshes.get(items[3]);
        assert.ok(g3.children.some(c => c.name === 'selectionIndicator'), 'Item 3 must have selectionIndicator');

        // Deselect all
        selectItem(null, null);
        assert.strictEqual(State.selectedItem, null);
        assert.strictEqual(g3.children.some(c => c.name === 'selectionIndicator'), false, 'Item 3 indicator removed');
    });
});

describe('Empirical Challenger: Real Chromium WebGL Deletion Lifecycle & Raycasting', () => {
    let env;

    before(async () => {
        env = await setupTestEnvironment();
    });

    after(async () => {
        if (env) await env.cleanup();
    });

    test('Adversarial 8 & 9: Real WebGL 5-item placement, item 3 deletion, resurrection test, and sequential full clear to baseline', async () => {
        const { page } = env;

        // Switch to 3D view
        await page.click('#btn-view-3d');
        await page.waitForFunction(() => typeof Viewer3D !== 'undefined' && Viewer3D.renderer && Viewer3D.scene);

        // Run browser evaluation
        const evalResult = await page.evaluate(async () => {
            // Establish clean slate
            while (State.furniture.length > 0) {
                const item = State.furniture[0];
                selectItem(item, 'furniture');
                Editor2D.deleteSelected();
            }

            const baselineChildrenCount = Viewer3D.scene.children.length;
            const baselineMeshesCount = Viewer3D.furnitureMeshes.size;

            // Place 5 items
            const item1 = { ...Presets['lounge-chair'], id: 'f_webgl_1', presetKey: 'lounge-chair', x: 120, y: 120, rotation: 0, elevation: 0 };
            const item2 = { ...Presets['bookshelf'], id: 'f_webgl_2', presetKey: 'bookshelf', x: 220, y: 120, rotation: 0, elevation: 0 };
            const item3 = { ...Presets['coffee-table-set'], id: 'f_webgl_3', presetKey: 'coffee-table-set', x: 320, y: 220, rotation: 30, elevation: 0 };
            const item4 = { ...Presets['tv-lowboard'], id: 'f_webgl_4', presetKey: 'tv-lowboard', x: 120, y: 320, rotation: 90, elevation: 0 };
            const item5 = { ...Presets['plant'], id: 'f_webgl_5', presetKey: 'plant', x: 420, y: 360, rotation: 0, elevation: 0 };

            const items = [item1, item2, item3, item4, item5];
            for (const it of items) {
                State.furniture.push(it);
                Viewer3D.updateFurniture3D(it);
            }

            const placedChildrenCount = Viewer3D.scene.children.length;
            const placedMeshesCount = Viewer3D.furnitureMeshes.size;

            // Step 1: Select item 3 (coffee table)
            selectItem(item3, 'furniture');
            const selectedItemBefore = State.selectedItem ? State.selectedItem.id : null;

            // Step 2: Delete item 3
            Editor2D.deleteSelected();

            const postDeleteChildrenCount = Viewer3D.scene.children.length;
            const postDeleteMeshesCount = Viewer3D.furnitureMeshes.size;
            const item3InState = State.furniture.some(it => it.id === item3.id);
            const item3InMap = Viewer3D.furnitureMeshes.has(item3);
            const item3MeshInScene = Viewer3D.scene.children.some(c => 
                c.userData && (c.userData.furniture === item3 || c.userData.furnitureId === item3.id)
            );

            // Step 3: Malicious manual call to updateFurniture3D(item3)
            Viewer3D.updateFurniture3D(item3);
            const postResurrectAttemptChildren = Viewer3D.scene.children.length;
            const postResurrectAttemptInMap = Viewer3D.furnitureMeshes.has(item3);
            const postResurrectAttemptInScene = Viewer3D.scene.children.some(c => 
                c.userData && (c.userData.furniture === item3 || c.userData.furnitureId === item3.id)
            );

            // Step 4: Surviving items check
            const survivingItemsInState = State.furniture.length;
            const survivingItemsInMap = [item1, item2, item4, item5].every(it => Viewer3D.furnitureMeshes.has(it));

            // Step 5: Rapid sequential deletion of remaining 4 items
            const sequentialSteps = [];
            while (State.furniture.length > 0) {
                const it = State.furniture[0];
                selectItem(it, 'furniture');
                Editor2D.deleteSelected();
                sequentialSteps.push({
                    stateLen: State.furniture.length,
                    meshesSize: Viewer3D.furnitureMeshes.size,
                    sceneChildren: Viewer3D.scene.children.length
                });
            }

            const finalChildrenCount = Viewer3D.scene.children.length;
            const finalMeshesCount = Viewer3D.furnitureMeshes.size;

            return {
                baselineChildrenCount,
                baselineMeshesCount,
                placedChildrenCount,
                placedMeshesCount,
                selectedItemBefore,
                postDeleteChildrenCount,
                postDeleteMeshesCount,
                item3InState,
                item3InMap,
                item3MeshInScene,
                postResurrectAttemptChildren,
                postResurrectAttemptInMap,
                postResurrectAttemptInScene,
                survivingItemsInState,
                survivingItemsInMap,
                sequentialSteps,
                finalChildrenCount,
                finalMeshesCount
            };
        });

        // Assertions on Browser Results
        assert.strictEqual(evalResult.baselineMeshesCount, 0, 'Baseline furniture meshes must be 0');
        assert.strictEqual(evalResult.placedChildrenCount, evalResult.baselineChildrenCount + 5, '5 items should add 5 children');
        assert.strictEqual(evalResult.placedMeshesCount, 5, 'furnitureMeshes should have 5 entries');
        assert.strictEqual(evalResult.selectedItemBefore, 'f_webgl_3', 'Item 3 should be selected');

        // Item 3 deletion assertions
        assert.strictEqual(evalResult.postDeleteChildrenCount, evalResult.placedChildrenCount - 1, 'Scene children should decrease by 1');
        assert.strictEqual(evalResult.postDeleteMeshesCount, 4, 'furnitureMeshes count should decrease to 4');
        assert.strictEqual(evalResult.item3InState, false, 'item 3 must not be in State.furniture');
        assert.strictEqual(evalResult.item3InMap, false, 'item 3 must not be in Viewer3D.furnitureMeshes');
        assert.strictEqual(evalResult.item3MeshInScene, false, 'item 3 mesh must not exist in Viewer3D.scene');

        // Resurrection resistance assertions
        assert.strictEqual(evalResult.postResurrectAttemptInMap, false, 'Direct updateFurniture3D must NOT re-add to Map');
        assert.strictEqual(evalResult.postResurrectAttemptInScene, false, 'Direct updateFurniture3D must NOT add mesh to scene');
        assert.strictEqual(evalResult.postResurrectAttemptChildren, evalResult.postDeleteChildrenCount, 'Scene child count must not grow');

        // Surviving items
        assert.strictEqual(evalResult.survivingItemsInState, 4, '4 items must remain in State');
        assert.strictEqual(evalResult.survivingItemsInMap, true, 'Surviving items must remain in Viewer3D.furnitureMeshes');

        // Sequential deletion to baseline
        assert.strictEqual(evalResult.finalChildrenCount, evalResult.baselineChildrenCount, 'Final scene children count must strictly equal baseline count');
        assert.strictEqual(evalResult.finalMeshesCount, 0, 'Final furnitureMeshes size must be 0');
    });

    test('Adversarial 10: Real WebGL Raycaster selection and post-deletion raycast immunity', async () => {
        const { page } = env;

        const raycastResult = await page.evaluate(async () => {
            // Establish clean room
            while (State.furniture.length > 0) {
                selectItem(State.furniture[0], 'furniture');
                Editor2D.deleteSelected();
            }

            // Place 1 chair
            const chair = { ...Presets['chair'], id: 'f_ray_chair', presetKey: 'chair', x: 250, y: 200, rotation: 0, elevation: 0 };
            State.furniture.push(chair);
            Viewer3D.updateFurniture3D(chair);

            // Raycaster setup
            const group = Viewer3D.furnitureMeshes.get(chair);
            const raycaster = new THREE.Raycaster();
            
            // Cast ray pointing directly downwards from above the chair
            const origin = new THREE.Vector3(group.position.x, 150, group.position.z);
            const direction = new THREE.Vector3(0, -1, 0);
            raycaster.set(origin, direction);

            // Intersect before deletion
            const preHits = raycaster.intersectObjects(Viewer3D.scene.children, true);
            const preFoundChair = preHits.some(h => {
                let curr = h.object;
                while (curr && curr !== Viewer3D.scene) {
                    if (curr.userData && curr.userData.furniture === chair) return true;
                    curr = curr.parent;
                }
                return false;
            });

            // Delete chair
            selectItem(chair, 'furniture');
            Editor2D.deleteSelected();

            // Intersect after deletion with the exact same ray
            const postHits = raycaster.intersectObjects(Viewer3D.scene.children, true);
            const postFoundChair = postHits.some(h => {
                let curr = h.object;
                while (curr && curr !== Viewer3D.scene) {
                    if (curr.userData && curr.userData.furniture === chair) return true;
                    curr = curr.parent;
                }
                return false;
            });

            return {
                preFoundChair,
                postFoundChair,
                preHitCount: preHits.length,
                postHitCount: postHits.length
            };
        });

        assert.strictEqual(raycastResult.preFoundChair, true, 'Raycaster should hit the chair before deletion');
        assert.strictEqual(raycastResult.postFoundChair, false, 'Raycaster MUST NOT hit the chair after deletion');
    });
});
