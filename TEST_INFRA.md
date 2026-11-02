# RoomCraft Test Infrastructure & Quality Architecture

## 1. Test Philosophy
The RoomCraft test suite follows a strict **opaque-box testing methodology** derived directly from user requirements (`ORIGINAL_REQUEST.md`) and technical specifications (`PROJECT.md`).

Key principles:
1. **Behavior over Implementation**: Tests evaluate observable outputs, spatial geometry invariants, collision correctness, and user interaction flows rather than internal implementation hacks.
2. **Authoritative Specification Sources**: Every expected value is grounded in mathematical geometry (e.g. Separating Axis Theorem, Pythagorean distance, coordinate projections) or documented requirements.
3. **Progressive Testability & Isolation**: Tests are hermetic and independent. Each test initializes its own state, executes without side effects on sibling tests, and cleans up after itself.
4. **Adversarial Resilience**: Tests explicitly include edge cases: degenerate shapes, extreme room scales, negative/overflow dimensions, zero-area bounds, and multi-object collision cascades.

---

## 2. Feature Inventory & Mapping

| Feature # | Feature Name | Test Tier | Validation Method |
|---|---|---|---|
| **F01** | SAT Furniture-to-Furniture Collision | Tier 1, 2, 3 | Math/SAT OBB overlap verification, circle-OBB, elevation clearance |
| **F02** | Boundary Clamping (Room Bounds) | Tier 1, 2 | Verification that items never exceed `[0, width]` and `[0, depth]` |
| **F03** | Room Resize Boundary Adaptation | Tier 2, 3 | Element & furniture clamping when room dimensions shrink |
| **F04** | Roof Pitch Slanted Ceiling Collision | Tier 1, 2, 3 | Height evaluation under pitch, kniestock thresholds, collision alerts |
| **F05** | Three.js Realistic Renderer Initialization | Tier 1 | Viewport 3D canvas initialization, WebGL context, OrbitControls |
| **F06** | 3D Ceiling Lamps & Light Sources | Tier 1, 4 | Ceiling lamp presence, point light sources, lighting toggle |
| **F07** | Floor & Wall Textures / Materials | Tier 1, 3 | Surface color and texture registration, selector switching |
| **F08** | Plaster Bump Maps & Wall Details | Tier 1 | Material map assignments on room walls |
| **F09** | Doors, Windows & Skylights Placement | Tier 1, 3 | Wall projection, opening collision check, pitch restrictions |
| **F10** | Furniture Catalog Expansion | Tier 1, 4 | Catalog item presence, dimensions, rotation, and presets |
| **F11** | 3D Raycasting & Direct Selection | Tier 1, 3 | Item selection via click, property panel synchronization |
| **F12** | Smart Snapping & Alignment Guides | Tier 1, 3 | Alignment to walls, room center, and neighboring furniture |
| **F13** | Visual High-Res Export & Material BOM | Tier 1, 4 | JSON export/import integrity, Stückliste/inventory calculations |
| **F14** | First-Person Walkthrough Mode | Tier 1, 3 | Camera height (165cm), radar cone rendering, mode switching |
| **F15** | Design System & Vercel/v0 Styling | Tier 1, 2 | Monochrome tokens, Dark/Light theme switching, toolbar layout |
| **F16** | Viewport Modes (2D, 3D, Split) | Tier 1, 3 | Split canvas sizing, visibility, view switches |
| **F17** | History (Undo / Redo) | Tier 1, 3 | State immutability, undo stack restoration, redo consistency |

---

## 3. Test Architecture & Directory Layout

The test suite is structured into two complementary layers:
- **Fast Node Harness (`node:test`)**: High-speed, zero-dependency unit and integration tests executing pure physics, SAT geometry, math functions, state transitions, and JSON serialization in milliseconds.
- **Playwright Headless Browser**: End-to-end tests driving real Chromium instances to validate DOM event dispatching, canvas rendering, Three.js 3D scenes, UI drawer interactions, and user workflows.

```
tests/
├── harness.js                  # Isolated Node VM loader for app core logic
├── run_all.js                  # Unified master test runner with summary & exit codes
├── unit/
│   ├── math_physics.test.js    # Vector2D, SAT OBB, circle collisions, pitch heights
│   └── boundary_clamping.test.js # Room boundary limits, wall distances, closest wall
├── integration/
│   ├── state_workflow.test.js  # History (Undo/Redo), JSON save/load, preset integrity
│   └── room_resize.test.js     # Room dimension alterations, element clamping, intervals
└── e2e/
    ├── helpers.js              # Playwright test server and browser utilities
    ├── tier1_features.test.js  # Tier 1: Core Feature Coverage (Happy Path)
    ├── tier2_boundaries.test.js # Tier 2: Boundary & Corner Cases
    ├── tier3_combinations.test.js # Tier 3: Cross-Feature Interactions
    └── tier4_scenarios.test.js # Tier 4: Real-World Room Planning Scenarios
```

---

## 4. Test Tiers Overview

### Tier 1: Feature Coverage (Happy Path)
Verifies each feature independently under normal operational conditions:
- Vector math and SAT collision overlap math.
- Presets initialization with valid dimensions and colors.
- UI View switcher: 2D floorplan, 3D perspective, and Split view.
- Preset addition: Bed, Wardrobe, Sofa, Table, TV, Rug.
- Wall elements: Adding doors and windows on suitable walls.
- Electrical installations: Placing sockets and switches.
- Project JSON export and serialization.

### Tier 2: Boundary & Corner Cases
Stresses edge conditions, extremes, and error boundaries:
- **Empty Room**: Clear room behavior, rendering with zero furniture or zero elements.
- **Extreme Dimensions**: Minimal room dimensions (200x200cm, 100cm height) and maximum scales (1500x1200cm).
- **Pitch Collisions**: Placing tall items (e.g. 210cm wardrobe) under low ceiling pitches (80cm kniestock) triggering collision status.
- **Boundary Clamping**: Attempting to move items beyond wall boundaries (negative coordinates or `> room.width`).
- **Skylight on Flat Wall**: Disallowing skylight placement on walls without roof slants.

### Tier 3: Cross-Feature Combinations
Validates interdependent subsystem behaviors:
- **Furniture Placement + Collision Alert**: Detecting when overlapping furniture triggers the global `#collision-alert` badge.
- **Roof Pitch Toggle + Element Validation**: Preventing roof pitch activation if an existing tall door would clip into the pitch.
- **Split View + Property Drawer**: Opening property inspection drawer while split-view canvas renders both 2D and 3D seamlessly.
- **Undo/Redo Chain across Mutations**: Verifying state rollback after add -> move -> resize -> delete cycles.
- **TV Elevation on Furniture**: Automatic vertical stacking where TV elevates to the top surface of the furniture underneath it.

### Tier 4: Real-World Scenarios
Executes complete end-to-end user planning workflows:
1. **Scenario A: Modern Living Room**
   - Room: 600x450cm, 260cm height.
   - Elements: 1 Patio Door on South wall, 2 Windows on North wall.
   - Furniture: Modular Sofa + Coffee Table + Lowboard with TV + Rug + Ceiling/Arc Lamp.
   - Assertions: Zero clipping, TV sits at lowboard height, all items inside room bounds.
2. **Scenario B: Attic Bedroom (Dachgeschoss)**
   - Room: 450x400cm with a steep North roof pitch (kniestock 70cm, run 180cm).
   - Elements: Skylight placed on slanted ceiling, door on flat South wall.
   - Furniture: Bed placed under gentle slant, Wardrobe placed against flat wall (not colliding).
   - Assertions: Pitch collision detection passes, skylight validly positioned.
3. **Scenario C: Contemporary Collaborative Office**
   - Room: 700x500cm.
   - Furniture: 4 Desks, 4 Ergonomic Chairs, 1 Central Meeting Table, Bookshelf divider, 6 LAN/Power sockets.
   - Assertions: Full inventory (Stückliste) matches expected count, project JSON export round-trips without data loss.

---

## 5. Coverage Thresholds & Quality Gates
- **Suite Pass Rate**: 100% of tests must pass (exit code 0).
- **Zero Console/Runtime Exceptions**: No unhandled promise rejections or uncaught page errors during E2E runs.
- **Deterministic Teardown**: Temporary HTTP servers, browser contexts, and sandbox environments terminate cleanly after test completion.
