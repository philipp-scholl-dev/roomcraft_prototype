const fs = require('fs');
const path = require('path');
const vm = require('vm');

/**
 * Loads a fresh, isolated instance of the RoomCraft application logic inside a Node VM sandbox.
 * Returns the application modules and functions without mutating disk files or polluting global scope.
 */
function createAppInstance() {
    const appPath = path.resolve(__dirname, '../app.js');
    const code = fs.readFileSync(appPath, 'utf8');

    // DOM mocks for canvas and HTML elements
    const mockElement = {
        id: '',
        tagName: 'DIV',
        value: '100',
        checked: false,
        disabled: false,
        classList: {
            classes: new Set(),
            add(c) { this.classes.add(c); },
            remove(c) { this.classes.delete(c); },
            contains(c) { return this.classes.has(c); },
            toggle(c) { this.contains(c) ? this.remove(c) : this.add(c); }
        },
        style: {},
        dataset: {},
        click: function() {
            if (typeof this.onclick === 'function') this.onclick();
        },
        showModal: function() {},
        close: function() {},
        getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }),
        addEventListener: () => {},
        removeEventListener: () => {},
        setAttribute: () => {},
        getAttribute: () => null,
        appendChild: () => {},
        removeChild: () => {},
        querySelectorAll: () => [],
        querySelector: () => null,
        getContext: () => ({
            fillRect: () => {},
            strokeRect: () => {},
            clearRect: () => {},
            beginPath: () => {},
            closePath: () => {},
            moveTo: () => {},
            lineTo: () => {},
            arc: () => {},
            ellipse: () => {},
            fill: () => {},
            stroke: () => {},
            save: () => {},
            restore: () => {},
            scale: () => {},
            translate: () => {},
            rotate: () => {},
            measureText: () => ({ width: 50 }),
            fillText: () => {},
            strokeText: () => {},
            setLineDash: () => {},
            createLinearGradient: () => ({ addColorStop: () => {} }),
            createRadialGradient: () => ({ addColorStop: () => {} }),
            createPattern: () => null,
            drawImage: () => {}
        })
    };

    const elementsMap = new Map();
    const getOrCreateElement = (id) => {
        if (!elementsMap.has(id)) {
            const el = Object.assign({}, mockElement, {
                id,
                classList: {
                    classes: new Set(),
                    add(c) { this.classes.add(c); },
                    remove(c) { this.classes.delete(c); },
                    contains(c) { return this.classes.has(c); },
                    toggle(c) { this.contains(c) ? this.remove(c) : this.add(c); }
                },
                style: {},
                dataset: {}
            });
            elementsMap.set(id, el);
        }
        return elementsMap.get(id);
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
            querySelector: (sel) => mockElement,
            querySelectorAll: (sel) => [],
            createElement: (tag) => Object.assign({}, mockElement, { tagName: tag.toUpperCase() }),
            body: mockElement
        },
        THREE: {
            Scene: class {
                add() {}
                remove() {}
            },
            PerspectiveCamera: class {
                position = {
                    x: 0, y: 0, z: 0,
                    set(x, y, z) { this.x = x; this.y = y; this.z = z; },
                    copy(p) { this.x = p.x; this.y = p.y; this.z = p.z; },
                    clone() { return { x: this.x, y: this.y, z: this.z }; },
                    add() {}
                };
                rotation = {
                    x: 0, y: 0, z: 0, order: 'XYZ',
                    set(x, y, z, order) { this.x = x; this.y = y; this.z = z; if (order) this.order = order; }
                };
                getWorldDirection(vec) {
                    if (vec) { vec.x = 0; vec.y = 0; vec.z = -1; return vec; }
                    return { x: 0, y: 0, z: -1 };
                }
            },
            OrbitControls: class {
                target = {
                    x: 0, y: 0, z: 0,
                    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; },
                    copy(p) { if (p) { this.x = p.x || 0; this.y = p.y || 0; this.z = p.z || 0; } return this; },
                    clone() { return { x: this.x, y: this.y, z: this.z }; },
                    add(v) { if (v) { this.x += v.x || 0; this.y += v.y || 0; this.z += v.z || 0; } return this; }
                };
                enabled = true;
                update() {}
            },
            WebGLRenderer: class {
                domElement = Object.assign({}, mockElement, {
                    width: 800,
                    height: 600,
                    toDataURL: () => 'data:image/png;base64,mock',
                    toBlob: (cb) => cb(new Blob(['mock'], { type: 'image/png' }))
                });
                setPixelRatio() {}
                setSize() {}
                render() {}
                dispose() {}
            },
            AmbientLight: class {},
            DirectionalLight: class {
                position = { set: () => {} };
                target = { position: { set: () => {} } };
                shadow = { camera: {}, mapSize: {} };
            },
            PointLight: class {
                position = { set: () => {} };
            },
            Vector2: class {},
            Vector3: class {
                constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
                set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
                copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
                clone() { return new sandbox.THREE.Vector3(this.x, this.y, this.z); }
                add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
                subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
                normalize() { return this; }
                lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
                length() { return Math.sqrt(this.lengthSq()); }
                addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
                crossVectors(a, b) {
                    this.x = a.y * b.z - a.z * b.y;
                    this.y = a.z * b.x - a.x * b.z;
                    this.z = a.x * b.y - a.y * b.x;
                    return this;
                }
                multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
            },
            Raycaster: class {},
            Group: class {
                children = [];
                position = { set: () => {} };
                rotation = { set: () => {} };
                add(obj) { this.children.push(obj); }
                remove() {}
            },
            Mesh: class {
                position = { set: () => {} };
                rotation = { set: () => {} };
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
    SmartSnapping,
    BOMCalculator,
    ExportManager,
    BOMDialog,
    WalkthroughMode,
    projectToWall,
    projectToSpecificWall,
    getWallCoordinates,
    createSlantedBoxGeometry,
    isMouseOverWallElement,
    checkElementOverlap,
    clampSkylightConstraints,
    isValidWallForElement,
    Editor2D,
    Viewer3D,
    TextureGenerator,
    TextureRegistry,
    TextureCache,
    getCeilingLampPositions,
    Presets,
    loadExampleRoom,
    clearRoom,
    applyProjectData,
    selectItem,
    syncRoomInputsUI
};
`;

    const context = vm.createContext(sandbox);
    vm.runInContext(code + exportSnippet, context);

    return sandbox.__EXPORTS__;
}

module.exports = {
    createAppInstance
};
