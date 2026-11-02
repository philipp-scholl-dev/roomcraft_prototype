# Project: RoomCraft Modernization & Enhancement

## Architecture
RoomCraft is an interactive 2D/3D architectural room planning application.
- **Core Technology**: Vanilla JavaScript (ES2020), HTML5, CSS3, Three.js r128 with OrbitControls, Lucide icons.
- **State Management**: Reactive singleton `State` in `app.js:7-53` with undo/redo `History` in `app.js:56-146`.
- **Physics & Collisions**: `CollisionEngine` in `app.js:312-575` using 2D Separating Axis Theorem (SAT) for oriented bounding boxes (OBBs), circle collision detection, and ceiling height projection.
- **2D Rendering Engine**: HTML5 Canvas renderer `Editor2D` in `app.js:975-2402` drawing walls, roof pitches, installations, openings, furniture, dimensions, and grid.
- **3D Rendering Engine**: Three.js WebGL renderer `Viewer3D` in `app.js:3323-5293` with parametric wall extrusion, roof pitches, shadow maps, tone mapping, and materials.
- **Procedural Textures**: Canvas-based texture generators `TextureGenerator` in `app.js:2403-3322`.
- **Testing Architecture**: Zero-dependency native `node:test` test harness for core logic via conditional `module.exports`, paired with Playwright Chromium for E2E workflows and visual snapshot regression.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | SAT Furniture-to-Furniture Collision | Enable and validate pairwise OBB/circle collision checking between placed items in `updateAllCollisions()` | M1 | R4 / Survey |
| 2 | Furniture Boundary Clamping | Clamp furniture positions to stay inside room boundaries during drag, drop, rotate, and resize | M1 | R4 / Survey |
| 3 | Room Resize Boundary Clamping | Clamp all furniture when room dimensions are decreased so items never end up outside walls | M1 | R4 / Survey |
| 4 | Roof Pitch Vertical Collision | Ensure items under slanted ceilings are accurately flagged or clamped when exceeding local pitch height | M1 | R4 / Survey |
| 5 | Three.js Realistic Renderer Setup | Enable `sRGBEncoding` and `physicallyCorrectLights = true`, configure tone mapping exposure and shadow bias | M2 | R2 / Survey |
| 6 | 3D Ceiling Lamps & Light Sources | Add 3D luminaire geometry with emissive diffuser and `THREE.PointLight` with physical quadratic decay and soft shadows | M2 | R2 / Survey |
| 7 | Procedural Floor Texture Registration | Register the 10 latent procedural floor textures in `TextureRegistry` and expose them in the UI | M2 | R2 / Survey |
| 8 | Wall & Ceiling Plaster Bump Maps | Create subtle procedural plaster bump map (`createWallPlasterBump`) to eliminate artificial smoothness | M2 | R2 / Survey |
| 9 | Realistic Door & Window Models/Textures | Add realistic frames, sills, handles, glass reflection, and wood grain textures to openings | M2 | R2 / Survey |
| 10 | Furniture Catalog Expansion (7 Items) | Add 7 modern furniture items: Lounge Chair, Bookshelf/Divider, Coffee Table Set, TV Lowboard, Arc Floor Lamp, Plant, Nightstand | M3 | R3 / Survey |
| 11 | 3D Direct Furniture Raycasting | Add furniture meshes to 3D click raycaster for direct selection and property inspection in 3D viewport | M3 | R3 / Survey |
| 12 | Smart Snapping & Dynamic Guides | Figma/CAD-style magnetic snapping to room centerlines, wall boundaries, and neighboring furniture with visual guide lines | M4 | R5 / Survey |
| 13 | Visual High-Res Export & Material BOM | High-resolution PNG export of 2D floor plan & 3D WebGL render, plus structured architectural item/material list (Stückliste) | M4 | R5 / Survey |
| 14 | First-Person 3D Walkthrough Mode | Eye-level 3D walkthrough camera with collision height and live synchronized 2D radar cone / camera frustum | M4 | R5 / Survey |
| 15 | Vercel/v0 Design System Tokens | Zinc/Slate monochrome tokens in `style.css` with seamless Dark and Light theme support | M5 | R1 / Survey |
| 16 | Toolbar & Header Modernization | Segmented view switcher, fix button text cutoff (`#btn-clear-room`), add Dark/Light mode toggle | M5 | R1 / Survey |
| 17 | Sidebar & Properties Drawer Polish | Prevent drawer from clobbering active tab, sleek 32px inputs, minimalist 14px slider thumbs | M5 | R1 / Survey |
| 18 | Automated Visual Inspection Harness | Headless Chromium script capturing visual screenshots of all views to guarantee zero visual regressions | M5 | R1 / R6 / Survey |
| 19 | E2E Test Suite Tiers 1-4 | Comprehensive opaque-box test suite (Tier 1 Feature, Tier 2 Boundary, Tier 3 Interaction, Tier 4 Real-World scenarios) | E2E-Track | R6 / Survey |
| 20 | Final E2E Pass & Adversarial Hardening | 100% pass on E2E test suite followed by Tier 5 adversarial stress testing and coverage audit | M6 | R6 / Survey |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| E2E | E2E Testing Track | Design and implement complete E2E test suite (Tiers 1-4) publishing `TEST_READY.md` | none | **DONE** (`TEST_INFRA.md`, `TEST_READY.md`, 50/50 tests pass) |
| M1 | Physics & Collision Hardening | Features 1-4: furniture-to-furniture SAT collision, boundary clamping on drag/rotate/resize and room resize | none | **DONE** (`app.js`, 83/83 unit tests, 21/21 stress tests pass, CLEAN audit) |
| M2 | Realistic Lighting & Textures | Features 5-9: Three.js PBR/sRGB settings, 3D ceiling lamps + point lights, 10 procedural floors, bump maps, window/door details | none | **DONE** (`app.js`, 1,120/1,120 tests pass, CLEAN audit) |
| M3 | Modern Furniture Catalog & 3D Selection | Features 10-11: 7 new designer furniture presets in 2D/3D, 3D raycaster direct furniture selection | M1, M2 | **DONE** (`app.js`, 60/60 master, 149/149 empirical pass, CLEAN audit) |
| M4 | Three High-Impact Custom Improvements | Features 12-14: Smart Snapping & Guides, High-Res 2D/3D Export & BOM, First-Person 3D Walkthrough with 2D radar cone | M1, M3 | **DONE** (`app.js`, 86/86 master, 27/27 empirical pass, CLEAN audit) |
| M5 | UI Modernization (Vercel/v0-Stil) | Features 15-18: Zinc design system, Light/Dark mode, toolbar redesign, property drawer fix, visual verification | M2, M3, M4 | **DONE** (`style.css`, `index.html`, `app.js`, `tests/visual_tour.js`, 6/6 screenshots, 0 button cutoffs, CLEAN audit) |
| M6 | Final E2E Pass & Adversarial Hardening | Feature 20: 100% pass on all E2E tests from `TEST_READY.md`, Tier 5 adversarial coverage hardening | E2E, M1-M5 | **DONE** (13 suites, 108/108 tests pass 100%, Tier 5 adversarial hardening, CLEAN audit) |

## Interface Contracts
### `CollisionEngine` ↔ `State` & `Editor2D`
- `CollisionEngine.checkFurnitureCollision(f1, f2)`: Returns boolean `true` if `f1` and `f2` collide (taking OBB angles and circle types into account, with `EPS = 1e-5` for OBB and `EPS = 1e-4` for circles).
- `CollisionEngine.clampFurnitureToRoom(f, room = State.room)`: Clamps `f.x` and `f.y` taking rotated corners (`getFurnitureCorners`) into account so `[minX, maxX] ⊆ [0, room.width]` and `[minY, maxY] ⊆ [0, room.depth]`. Centers oversized objects.
- `CollisionEngine.checkWallCollision(f, room = State.room)`: Evaluates whether any corner of `f` exceeds boundaries with `EPS = 1e-4`.
- `CollisionEngine.checkRoofPitchCollision(f)`: Evaluates 32 perimeter points for circles and 9 points for rectangles against local ceiling height `getCeilingHeightAt(x, y)`. Rugs and obstacles exempt.
- `CollisionEngine.updateAllCollisions()`: Evaluates wall, pitch, and pairwise furniture collisions, updating `f.isColliding` and toggling `#collision-alert`. Respects TV elevation stacking and `collisionEnabled !== false`.

### `Viewer3D` ↔ `State` & Lighting
- `Viewer3D.rebuildCeilingLamps()`: Synchronizes ceiling lamps from room dimensions or ceiling fixture state; instantiates `THREE.PointLight` with `decay = 2`, `castShadow = true`, and emissive luminaire mesh.
- `Viewer3D.initWallClickRaycaster()`: Raycasts both `this.wallMeshes` and `this.furnitureMeshes`, selecting the target object in `State.selectedFurniture` or `State.selectedWall`.

### `SmartSnapping` ↔ `Editor2D`
- `SmartSnapping.computeSnap(f, otherFurniture, room, threshold)`: Returns `{ snappedX, snappedY, guides: [{x1, y1, x2, y2, type}] }` for magnetic alignment to room centerlines, walls, and sibling furniture edges/centers.

### `WalkthroughMode` ↔ `Viewer3D` & `Editor2D`
- `WalkthroughMode.toggle(active)`: Switches `Viewer3D.camera` to eye-level (1.65m height) with pointer lock / arrow key controls.
- `Editor2D.drawCameraRadar(ctx)`: Draws the player's 2D position and field-of-view viewing cone on the 2D floorplan.

## Code Layout
- `app.js`: Application core (State, History, CollisionEngine, Editor2D, Viewer3D, Presets, UI event wiring).
- `style.css`: Design system tokens, Vercel/v0 typography, components, dark/light themes, animations.
- `index.html`: DOM structure, toolbar, sidebar tabs, canvas viewports, modals.
- `tests/unit/`: Fast unit tests executed via native `node --test` for physics, geometry, math, and state.
- `tests/integration/`: Integration tests for room resizing, JSON save/load, catalog presets.
- `tests/e2e/`: Playwright end-to-end tests covering complete workflows and visual regression.
- `.agents/teamwork/`: Metadata, analysis reports, logs, and coordination artifacts (strictly metadata).
