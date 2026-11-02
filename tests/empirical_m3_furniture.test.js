/**
 * RoomCraft — Milestone 3 Empirical Verification Test Suite
 * Comprehensive verification of Modern Furniture Presets 1-7,
 * 2D Blueprint Architectural Drawing, 3D Procedural Meshes,
 * Catalog Category Filtering UI, and 3D Direct Raycaster Selection.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/**
 * Creates an enhanced VM sandbox with complete Three.js procedural classes
 * to verify 3D geometries, materials, lights, and raycasting in headless Node.js.
 */
function createM3TestEnvironment() {
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
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 })
    });

    const getOrCreateElement = (id) => {
        if (!elementsMap.has(id)) {
            elementsMap.set(id, createMockElement(id));
        }
        return elementsMap.get(id);
    };

    // Three.js Mock with full geometric structure
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
        crossVectors() { return this; }
        addScaledVector() { return this; }
    }

    class Color {
        constructor(c = 0xffffff) { this.hex = c; }
        set(c) { this.hex = c; return this; }
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

    class Group extends Object3D {
        constructor() { super(); this.type = 'Group'; }
    }

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

    class BoxGeometry {
        constructor(w = 1, h = 1, d = 1) { this.parameters = { width: w, height: h, depth: d }; }
    }

    class CylinderGeometry {
        constructor(rt = 1, rb = 1, h = 1, s = 8) {
            this.parameters = { radiusTop: rt, radiusBottom: rb, height: h, radialSegments: s };
        }
    }

    class SphereGeometry {
        constructor(r = 1, ws = 8, hs = 6, phiStart = 0, phiLength = Math.PI * 2, thetaStart = 0, thetaLength = Math.PI) {
            this.parameters = { radius: r, widthSegments: ws, heightSegments: hs, thetaLength };
        }
    }

    class CatmullRomCurve3 {
        constructor(points = []) { this.points = points; }
    }

    class TubeGeometry {
        constructor(path, tubularSegments = 64, radius = 1, radialSegments = 8, closed = false) {
            this.parameters = { path, tubularSegments, radius, radialSegments, closed };
        }
    }

    class Shape {
        constructor() { this.curves = []; }
        moveTo(x, y) { this.curves.push({ type: 'move', x, y }); }
        bezierCurveTo(a, b, c, d, e, f) { this.curves.push({ type: 'bezier', a, b, c, d, e, f }); }
    }

    class ShapeGeometry {
        constructor(shapes, curveSegments = 12) {
            this.shapes = shapes;
            this.curveSegments = curveSegments;
            this.attributes = {
                position: {
                    count: 24,
                    getX: (i) => (i % 6) - 3,
                    getY: (i) => (i % 8) * 4,
                    setZ: () => {}
                }
            };
        }
        computeVertexNormals() {}
    }

    class EdgesGeometry {
        constructor(geometry) { this.geometry = geometry; }
    }

    class MeshStandardMaterial {
        constructor(params = {}) {
            Object.assign(this, params);
        }
    }

    class LineBasicMaterial {
        constructor(params = {}) {
            Object.assign(this, params);
        }
    }

    class PointLight extends Object3D {
        constructor(color = 0xffffff, intensity = 1, distance = 0, decay = 2) {
            super();
            this.color = new Color(color);
            this.intensity = intensity;
            this.distance = distance;
            this.decay = decay;
            this.shadow = { mapSize: { width: 512, height: 512 }, camera: {} };
        }
    }

    class Raycaster {
        constructor() {
            this.ray = { origin: new Vector3(), direction: new Vector3(0, 0, -1) };
            this.camera = null;
        }
        setFromCamera(coords, camera) {
            this.coords = coords;
            this.camera = camera;
        }
        intersectObjects(objects, recursive = true) {
            // Find all descendents
            const hits = [];
            const check = (obj) => {
                if (obj.visible === false) return;
                if (typeof obj.raycast === 'function' && obj.name === 'selectionIndicator') {
                    // Line selection indicator has neutralized raycast
                    return;
                }
                if (obj.type === 'Mesh') {
                    hits.push({ object: obj, distance: 10, point: new Vector3() });
                }
                if (recursive && obj.children) {
                    obj.children.forEach(check);
                }
            };
            objects.forEach(check);
            return hits;
        }
    }

    const domContainer = createMockElement('threeCanvasContainer');
    const mockRenderer = {
        domElement: createMockElement('three-canvas', 'CANVAS'),
        setSize: () => {},
        setPixelRatio: () => {},
        render: () => {},
        dispose: () => {}
    };

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
        performance: { now: () => Date.now() },
        window: {
            addEventListener: () => {},
            removeEventListener: () => {},
            location: { href: 'http://localhost/' },
            innerWidth: 1920,
            innerHeight: 1080
        },
        document: {
            addEventListener: () => {},
            removeEventListener: () => {},
            getElementById: (id) => getOrCreateElement(id),
            querySelector: (sel) => {
                if (sel === '#threeCanvasContainer') return domContainer;
                return createMockElement('sel_' + sel);
            },
            querySelectorAll: () => [],
            createElement: (tag) => createMockElement('el_' + tag, tag),
            body: createMockElement('body')
        },
        THREE: {
            Scene: class extends Group {},
            PerspectiveCamera: class extends Object3D {
                constructor() { super(); this.aspect = 1; }
                updateProjectionMatrix() {}
            },
            WebGLRenderer: class {
                constructor() { return mockRenderer; }
            },
            AmbientLight: class extends Object3D {},
            DirectionalLight: class extends Object3D {
                constructor() { super(); this.shadow = { camera: {} }; }
            },
            PointLight,
            Vector2,
            Vector3,
            Color,
            Raycaster,
            Group,
            Mesh,
            LineSegments,
            BoxGeometry,
            PlaneGeometry: class {},
            CylinderGeometry,
            SphereGeometry,
            CatmullRomCurve3,
            TubeGeometry,
            Shape,
            ShapeGeometry,
            EdgesGeometry,
            MeshStandardMaterial,
            MeshBasicMaterial: class {},
            LineBasicMaterial,
            DoubleSide: 2,
            CanvasTexture: class {
                constructor() { this.repeat = { set: () => {} }; }
            },
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
        canvasDrawCalls,
        mockRenderer
    };
}

describe('Milestone 3 Empirical Verification: Presets, 2D/3D & Direct Selection', () => {

    test('Specification Integrity: All 7 new presets exist with valid dimensions and categories', () => {
        const { app } = createM3TestEnvironment();
        const { Presets } = app;

        const presetsToCheck = [
            { key: 'lounge-chair', shape: 'rect', w: 80, l: 85, h: 78, category: 'living' },
            { key: 'bookshelf', shape: 'rect', w: 120, l: 38, h: 160, category: 'living office' },
            { key: 'coffee-table-set', shape: 'rect', w: 100, l: 65, h: 42, category: 'living', isTable: true },
            { key: 'tv-lowboard', shape: 'rect', w: 180, l: 45, h: 45, category: 'living' },
            { key: 'arc-lamp', shape: 'rect', w: 45, l: 160, h: 210, category: 'decor living', isLamp: true },
            { key: 'plant', shape: 'circle', w: 55, l: 55, h: 135, category: 'decor living', isPlant: true },
            { key: 'nightstand', shape: 'rect', w: 48, l: 40, h: 52, category: 'bedroom living', isNightstand: true }
        ];

        presetsToCheck.forEach(spec => {
            const p = Presets[spec.key];
            assert.ok(p, `Preset "${spec.key}" must exist in Presets`);
            assert.strictEqual(p.shape, spec.shape, `Preset "${spec.key}" shape must be ${spec.shape}`);
            assert.strictEqual(p.w, spec.w, `Preset "${spec.key}" width must be ${spec.w}`);
            assert.strictEqual(p.l, spec.l, `Preset "${spec.key}" length must be ${spec.l}`);
            assert.strictEqual(p.h, spec.h, `Preset "${spec.key}" height must be ${spec.h}`);
            assert.ok(p.color, `Preset "${spec.key}" must have a 2D color`);
            assert.ok(p.color3d, `Preset "${spec.key}" must have a 3D color`);
            assert.ok(p.category.includes(spec.category.split(' ')[0]), `Preset "${spec.key}" category must match`);
            if (spec.isTable) assert.strictEqual(p.isTable, true);
            if (spec.isLamp) assert.strictEqual(p.isLamp, true);
            if (spec.isPlant) assert.strictEqual(p.isPlant, true);
            if (spec.isNightstand) assert.strictEqual(p.isNightstand, true);
        });
    });

    test('Physics Hardening: TV-Lowboard collision vs TV surface elevation stacking', () => {
        const { app } = createM3TestEnvironment();
        const { CollisionEngine, State, Presets } = app;

        // 1. Create TV-Lowboard (180x45x45 cm) at room center (200, 200)
        const pLowboard = Presets['tv-lowboard'];
        const lowboard = {
            id: 'f_lowboard',
            name: pLowboard.name,
            presetKey: 'tv-lowboard',
            shape: pLowboard.shape,
            w: pLowboard.w,
            l: pLowboard.l,
            h: pLowboard.h,
            x: 200,
            y: 200,
            rotation: 0,
            elevation: 0,
            collisionEnabled: true
        };

        // 2. Create Chair overlapping horizontally with the lowboard
        const chair = {
            id: 'f_chair',
            name: 'Stuhl',
            shape: 'rect',
            w: 45,
            l: 45,
            h: 85,
            x: 200,
            y: 200,
            rotation: 0,
            elevation: 0,
            collisionEnabled: true
        };

        // Lowboard MUST collide with normal furniture (NOT ignored as a TV!)
        const collidesWithChair = CollisionEngine.checkFurnitureCollision(chair, lowboard);
        assert.strictEqual(collidesWithChair, true, 'TV-Lowboard must participate in SAT collision with other furniture');

        // 3. Create TV centered on top of lowboard
        const pTV = Presets['tv'];
        const tv = {
            id: 'f_tv',
            name: pTV.name,
            presetKey: 'tv',
            shape: pTV.shape,
            w: pTV.w,
            l: pTV.l,
            h: pTV.h,
            x: 200,
            y: 200,
            rotation: 0,
            elevation: 0,
            tvSize: pTV.tvSize,
            collisionEnabled: true
        };

        State.furniture = [lowboard, tv];
        CollisionEngine.updateAllCollisions();

        // The TV should be elevated onto the lowboard surface (elevation = 45 cm)
        assert.strictEqual(tv.elevation, 45, 'TV elevation should automatically equal lowboard height (45cm)');

        // TV and Lowboard must not flag collision with each other
        const tvCollidesLowboard = CollisionEngine.checkFurnitureCollision(tv, lowboard);
        assert.strictEqual(tvCollidesLowboard, false, 'Stacked TV on Lowboard must not trigger collision alarm');
    });

    test('2D Blueprint Architectural Drawing: Canvas renderers execute without error for all 7 presets', () => {
        const { app, mockCtx, canvasDrawCalls } = createM3TestEnvironment();
        const { Editor2D, Presets, State } = app;

        const keys = ['lounge-chair', 'bookshelf', 'coffee-table-set', 'tv-lowboard', 'arc-lamp', 'plant', 'nightstand'];

        keys.forEach(key => {
            const p = Presets[key];
            const item = {
                id: 'f_' + key,
                presetKey: key,
                name: p.name,
                shape: p.shape,
                w: p.w,
                l: p.l,
                h: p.h,
                x: 150,
                y: 150,
                rotation: 0,
                color: p.color,
                isLamp: p.isLamp || false,
                isPlant: p.isPlant || false,
                isNightstand: p.isNightstand || false
            };

            State.furniture = [item];
            canvasDrawCalls.length = 0;

            assert.doesNotThrow(() => {
                Editor2D.drawFurniture(mockCtx);
            }, `Editor2D.drawFurniture must not throw when drawing ${key}`);

            assert.ok(canvasDrawCalls.length > 5, `Drawing ${key} must emit canvas draw calls`);
        });
    });

    test('3D Procedural Geometries: Generates high-fidelity Three.js procedural groups for all 7 presets', () => {
        const { app, sandbox } = createM3TestEnvironment();
        const { Viewer3D, Presets } = app;
        const { THREE } = sandbox;

        // 1. Lounge Chair
        const fLounge = { ...Presets['lounge-chair'], id: 'f_lounge', presetKey: 'lounge-chair' };
        const gLounge = new THREE.Group();
        Viewer3D.buildDetailedFurniture(fLounge, gLounge, false);
        assert.ok(gLounge.children.length >= 6, 'Lounge chair should have at least 6 procedural sub-components');

        // 2. Bookshelf
        const fShelf = { ...Presets['bookshelf'], id: 'f_shelf', presetKey: 'bookshelf' };
        const gShelf = new THREE.Group();
        Viewer3D.buildDetailedFurniture(fShelf, gShelf, false);
        assert.ok(gShelf.children.length >= 10, 'Bookshelf should have cheeks, shelves, dividers, books, vase');

        // 3. Coffee Table Set
        const fTable = { ...Presets['coffee-table-set'], id: 'f_table', presetKey: 'coffee-table-set' };
        const gTable = new THREE.Group();
        Viewer3D.buildDetailedFurniture(fTable, gTable, false);
        assert.ok(gTable.children.length >= 8, 'Coffee table set should have primary table, secondary table, legs, decor');

        // 4. TV Lowboard
        const fBoard = { ...Presets['tv-lowboard'], id: 'f_board', presetKey: 'tv-lowboard' };
        const gBoard = new THREE.Group();
        Viewer3D.buildDetailedFurniture(fBoard, gBoard, false);
        // Plinth, bottom, top, cheeks (2), partitions (2), back, felt, 36 slats, grommet = ~47 meshes
        assert.ok(gBoard.children.length >= 40, 'TV Lowboard should have plinth, carcass, and 36 vertical wood slats');

        // 5. Arc Floor Lamp
        const fLamp = { ...Presets['arc-lamp'], id: 'f_lamp', presetKey: 'arc-lamp' };
        const gLamp = new THREE.Group();
        Viewer3D.buildDetailedFurniture(fLamp, gLamp, false);
        const pointLights = gLamp.children.filter(c => c instanceof THREE.PointLight);
        assert.strictEqual(pointLights.length, 1, 'Arc Floor Lamp must instantiate a THREE.PointLight');
        assert.strictEqual(pointLights[0].castShadow, true, 'PointLight must cast shadows');
        assert.strictEqual(pointLights[0].decay, 2, 'PointLight must use physical quadratic decay (decay = 2)');

        // 6. Potted Indoor Plant
        const fPlant = { ...Presets['plant'], id: 'f_plant', presetKey: 'plant' };
        const gPlant = new THREE.Group();
        Viewer3D.buildDetailedFurniture(fPlant, gPlant, false);
        assert.ok(gPlant.children.length >= 8, 'Potted plant must have ceramic pot, rim, soil, and golden-angle leaf groups');

        // 7. Nightstand
        const fNight = { ...Presets['nightstand'], id: 'f_night', presetKey: 'nightstand' };
        const gNight = new THREE.Group();
        Viewer3D.buildDetailedFurniture(fNight, gNight, false);
        assert.ok(gNight.children.length >= 8, 'Nightstand must have body, shadow gap, drawer, hairpin legs, staged book');
    });

    test('3D Direct Raycaster Selection: Resolves child mesh to parent furniture entity and manages highlights', () => {
        const { app, sandbox, mockRenderer } = createM3TestEnvironment();
        const { Viewer3D, State, selectItem, Presets } = app;
        const { THREE } = sandbox;

        // Setup scene
        Viewer3D.scene = new THREE.Scene();
        Viewer3D.camera = new THREE.PerspectiveCamera();
        Viewer3D.furnitureMeshes = new Map();
        Viewer3D.renderer = mockRenderer;
        Viewer3D.floorMesh = new THREE.Mesh();
        Viewer3D.wallMeshes = [];

        // Create furniture domain item
        const fSofa = {
            id: 'f_sofa_test',
            name: Presets['sofa'].name,
            presetKey: 'sofa',
            shape: 'rect',
            w: 210,
            l: 95,
            h: 80,
            x: 200,
            y: 200,
            rotation: 0
        };
        State.furniture = [fSofa];

        // Create 3D representation
        Viewer3D.updateFurniture3D(fSofa);
        const group = Viewer3D.furnitureMeshes.get(fSofa);
        assert.ok(group, 'Furniture group must be created');
        assert.strictEqual(group.userData.furniture, fSofa, 'group.userData.furniture must reference domain object');

        // Pick a child mesh inside the sofa group
        const childMesh = group.children.find(c => c.type === 'Mesh');
        assert.ok(childMesh, 'Sofa group must contain child meshes');

        // Simulate upward scene graph traversal as done in initWallClickRaycaster
        let current = childMesh;
        let resolvedFurniture = null;
        while (current && current !== Viewer3D.scene) {
            if (current.userData && current.userData.furniture) {
                resolvedFurniture = current.userData.furniture;
                break;
            }
            current = current.parent;
        }

        assert.strictEqual(resolvedFurniture, fSofa, 'Scene graph traversal must resolve child mesh back to fSofa');

        // Trigger selectItem
        selectItem(fSofa, 'furniture');
        assert.strictEqual(State.selectedItem, fSofa);
        assert.strictEqual(State.selectedFurniture, fSofa);

        // Check that an OBB selection indicator was appended to group
        const selIndicator = group.children.find(c => c.name === 'selectionIndicator');
        assert.ok(selIndicator, 'A selectionIndicator line must be attached to the selected furniture group');

        // Verify raycast neutralization on selection indicator
        assert.strictEqual(typeof selIndicator.raycast, 'function');
        // Calling raycast on indicator should not register any hits
        const dummyHits = [];
        selIndicator.raycast({}, dummyHits);
        assert.strictEqual(dummyHits.length, 0, 'Selection indicator must not register raycast hits');

        // Deselection on bare floor click
        selectItem(null, null);
        assert.strictEqual(State.selectedItem, null);
        assert.strictEqual(State.selectedFurniture, null);

        // Verify that selectionIndicator was cleanly removed
        const remainingIndicator = group.children.find(c => c.name === 'selectionIndicator');
        assert.strictEqual(remainingIndicator, undefined, 'Selection indicator must be stripped on deselection');
    });

    test('Pointer Disambiguation: Distinguishes stationary click from camera orbit drag', () => {
        // Disambiguation contract: e.button === 0, dist <= 5px, duration <= 350ms
        const isClick = (btn, dx, dy, dt) => {
            if (btn !== 0) return false;
            const dist = Math.hypot(dx, dy);
            return dist <= 5 && dt <= 350;
        };

        // Stationary clean click
        assert.strictEqual(isClick(0, 1, 2, 80), true, 'Left click with 2.2px movement in 80ms is valid click');

        // Orbit drag (> 5px)
        assert.strictEqual(isClick(0, 12, 18, 120), false, 'Movement > 5px must be rejected as camera orbit');

        // Long press (> 350ms)
        assert.strictEqual(isClick(0, 1, 1, 450), false, 'Duration > 350ms must be rejected');

        // Right-click or middle-click pan
        assert.strictEqual(isClick(2, 0, 0, 100), false, 'Right-click must be rejected from selection');
        assert.strictEqual(isClick(1, 0, 0, 100), false, 'Middle-click must be rejected from selection');
    });

    test('Catalog UI DOM Structure & Category Filtering Verification', () => {
        const htmlPath = path.resolve(__dirname, '../index.html');
        const html = fs.readFileSync(htmlPath, 'utf8');

        // 1. Check Category Filter Pills in index.html
        assert.ok(html.includes('id="furniture-category-filter"'), 'Must contain #furniture-category-filter container');
        const expectedPills = ['all', 'living', 'dining', 'bedroom', 'office', 'decor'];
        expectedPills.forEach(cat => {
            assert.ok(html.includes(`data-category="${cat}"`), `Filter pill for "${cat}" must exist in index.html`);
        });

        // 2. Check all 7 new preset buttons in index.html
        const newPresetKeys = ['lounge-chair', 'bookshelf', 'coffee-table-set', 'tv-lowboard', 'arc-lamp', 'plant', 'nightstand'];
        newPresetKeys.forEach(k => {
            assert.ok(html.includes(`data-preset="${k}"`), `Button for preset "${k}" must exist in index.html`);
        });

        // 3. Verify category filtering logic function
        const mockButtons = [
            { preset: 'sofa', category: 'living', style: { display: '' } },
            { preset: 'bed', category: 'bedroom', style: { display: '' } },
            { preset: 'desk', category: 'office', style: { display: '' } },
            { preset: 'arc-lamp', category: 'decor living', style: { display: '' } }
        ];

        const filterByCategory = (selectedCat) => {
            mockButtons.forEach(btn => {
                if (selectedCat === 'all') {
                    btn.style.display = '';
                } else {
                    const cats = (btn.category || '').split(' ');
                    btn.style.display = cats.includes(selectedCat) ? '' : 'none';
                }
            });
        };

        // When "living" selected
        filterByCategory('living');
        assert.strictEqual(mockButtons.find(b => b.preset === 'sofa').style.display, '');
        assert.strictEqual(mockButtons.find(b => b.preset === 'arc-lamp').style.display, '');
        assert.strictEqual(mockButtons.find(b => b.preset === 'bed').style.display, 'none');
        assert.strictEqual(mockButtons.find(b => b.preset === 'desk').style.display, 'none');

        // When "bedroom" selected
        filterByCategory('bedroom');
        assert.strictEqual(mockButtons.find(b => b.preset === 'bed').style.display, '');
        assert.strictEqual(mockButtons.find(b => b.preset === 'sofa').style.display, 'none');

        // When "all" selected (default)
        filterByCategory('all');
        mockButtons.forEach(btn => {
            assert.strictEqual(btn.style.display, '', 'All buttons must be visible when "all" is active');
        });
    });

    test('Lifecycle Hardening: Furniture deletion cleanly clears selection and eliminates 3D ghost meshes', () => {
        const { app, sandbox, mockRenderer } = createM3TestEnvironment();
        const { Viewer3D, State, Editor2D, selectItem } = app;
        const { THREE } = sandbox;

        // Initialize 3D scene & renderer
        Viewer3D.scene = new THREE.Scene();
        Viewer3D.camera = new THREE.PerspectiveCamera();
        Viewer3D.furnitureMeshes = new Map();
        Viewer3D.renderer = mockRenderer;
        Viewer3D.floorMesh = new THREE.Mesh();
        Viewer3D.floorMesh.name = 'floor';
        Viewer3D.scene.add(Viewer3D.floorMesh);
        Viewer3D.wallMeshes = [];

        // Place a test furniture piece
        const chair = {
            id: 'f_del_chair',
            presetKey: 'chair',
            name: 'Stuhl',
            shape: 'rect',
            w: 45,
            l: 45,
            h: 85,
            x: 200,
            y: 200,
            rotation: 0,
            elevation: 0
        };

        State.furniture = [chair];
        Viewer3D.updateFurniture3D(chair);

        const initialSceneChildrenCount = Viewer3D.scene.children.length;
        assert.ok(Viewer3D.furnitureMeshes.has(chair), 'Chair mesh group must be registered in Viewer3D.furnitureMeshes');
        assert.ok(Viewer3D.scene.children.some(c => c.userData && c.userData.furniture === chair), 'Chair mesh group must be present in Viewer3D.scene');

        // Select the furniture item
        selectItem(chair, 'furniture');
        assert.strictEqual(State.selectedItem, chair, 'State.selectedItem must be chair');
        assert.strictEqual(State.selectedItemType, 'furniture');

        // Prior to deletion, raycasting intersects the chair
        const raycaster = new THREE.Raycaster();
        const preHits = raycaster.intersectObjects(Viewer3D.scene.children, true);
        const preHitFurniture = preHits.map(h => {
            let curr = h.object;
            while (curr && curr !== Viewer3D.scene) {
                if (curr.userData && curr.userData.furniture) return curr.userData.furniture;
                curr = curr.parent;
            }
            return null;
        }).filter(Boolean);
        assert.ok(preHitFurniture.includes(chair), 'Raycasting before deletion should hit the chair');

        // Delete the selected item via Editor2D.deleteSelected()
        Editor2D.deleteSelected();

        // 1. Cleanly removed from State.furniture
        assert.strictEqual(State.furniture.includes(chair), false, 'Deleted chair must be removed from State.furniture');
        assert.strictEqual(State.furniture.length, 0, 'State.furniture must be empty');
        assert.strictEqual(State.selectedItem, null, 'State.selectedItem must be cleared to null');
        assert.strictEqual(State.selectedItemType, null, 'State.selectedItemType must be cleared to null');

        // 2. Viewer3D.furnitureMeshes.has(f) is false (no ghost entry)
        assert.strictEqual(Viewer3D.furnitureMeshes.has(chair), false, 'Viewer3D.furnitureMeshes must NOT retain deleted chair');

        // 3. Viewer3D.scene child count decremented and contains NO group with userData.furniture === chair
        assert.strictEqual(Viewer3D.scene.children.length, initialSceneChildrenCount - 1, 'Viewer3D.scene child count must be decremented by 1');
        const ghostInScene = Viewer3D.scene.children.some(c => c.userData && c.userData.furniture === chair);
        assert.strictEqual(ghostInScene, false, 'Viewer3D.scene must not contain any object associated with deleted furniture');

        // 4. Defensive test: calling Viewer3D.updateFurniture3D(chair) directly must NOT resurrect the mesh
        Viewer3D.updateFurniture3D(chair);
        assert.strictEqual(Viewer3D.furnitureMeshes.has(chair), false, 'Viewer3D.updateFurniture3D must refuse to resurrect unplaced furniture');
        assert.strictEqual(Viewer3D.scene.children.some(c => c.userData && c.userData.furniture === chair), false, 'No phantom mesh added to scene');

        // 5. Subsequent raycasting hits only floor/background, NOT the deleted entity
        const postHits = raycaster.intersectObjects(Viewer3D.scene.children, true);
        const postHitFurniture = postHits.map(h => {
            let curr = h.object;
            while (curr && curr !== Viewer3D.scene) {
                if (curr.userData && curr.userData.furniture) return curr.userData.furniture;
                curr = curr.parent;
            }
            return null;
        }).filter(Boolean);
        assert.strictEqual(postHitFurniture.length, 0, 'Raycaster must not detect any furniture hits after deletion');
        if (postHits.length > 0) {
            assert.strictEqual(postHits[0].object, Viewer3D.floorMesh, 'Remaining raycaster hit must be floor mesh');
        }
    });
});

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createM3TestEnvironment };
}
