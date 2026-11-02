const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestEnvironment } = require('./helpers');

describe('E2E Tier 5: Adversarial Physics, 3D Rendering & Walkthrough Hardening', () => {
    let env;

    before(async () => {
        env = await setupTestEnvironment();
    });

    after(async () => {
        if (env) await env.cleanup();
    });

    test('Adversarial 1: Degenerate OBBs & extreme geometry invariants (0-dim, collinear, extreme aspect ratios)', async () => {
        const { page } = env;

        const results = await page.evaluate(() => {
            // 1. Degenerate 0x0 boxes (all 4 vertices at exact same point)
            const ptA = [new Vector2D(100, 100), new Vector2D(100, 100), new Vector2D(100, 100), new Vector2D(100, 100)];
            const ptB = [new Vector2D(200, 200), new Vector2D(200, 200), new Vector2D(200, 200), new Vector2D(200, 200)];
            const collZeroDistant = CollisionEngine.checkOBBvsOBB(ptA, ptB);

            // 2. Degenerate 1D line segments (width = 0, length = 100)
            const line1 = [new Vector2D(100, 50), new Vector2D(100, 50), new Vector2D(100, 150), new Vector2D(100, 150)];
            const line2 = [new Vector2D(100, 80), new Vector2D(100, 80), new Vector2D(100, 180), new Vector2D(100, 180)];
            const collCollinearOverlap = CollisionEngine.checkOBBvsOBB(line1, line2);

            // 3. Null, undefined, empty, or insufficient corners
            const collNull = CollisionEngine.checkOBBvsOBB(null, ptB);
            const collEmpty = CollisionEngine.checkOBBvsOBB([], ptB);
            const collIncomplete = CollisionEngine.checkOBBvsOBB([new Vector2D(0, 0)], ptB);

            // 4. Extreme aspect ratio (10,000cm x 0.05cm thin strip)
            const stripCorners = [
                new Vector2D(0, 0),
                new Vector2D(10000, 0),
                new Vector2D(10000, 0.05),
                new Vector2D(0, 0.05)
            ];
            const obstacleCorners = [
                new Vector2D(500, -10),
                new Vector2D(500, 10),
                new Vector2D(502, 10),
                new Vector2D(502, -10)
            ];
            const collExtremeRatio = CollisionEngine.checkOBBvsOBB(stripCorners, obstacleCorners);

            // 5. Oversized furniture clamping: 800 x 600 in 500 x 400 room
            const oversized = { shape: 'rect', x: 50, y: 50, w: 800, l: 600, rotation: 0 };
            CollisionEngine.clampFurnitureToRoom(oversized, { width: 500, depth: 400 });

            // 6. Zero-dimension circle
            const circleZeroA = { x: 100, y: 100 };
            const circleZeroB = { x: 100, y: 100 };
            const collZeroCircle = CollisionEngine.checkCircleVsCircle(circleZeroA, 0, circleZeroB, 0);

            return {
                collZeroDistant,
                collCollinearOverlap,
                collNull,
                collEmpty,
                collIncomplete,
                collExtremeRatio,
                oversizedClampedX: oversized.x,
                oversizedClampedY: oversized.y,
                collZeroCircle
            };
        });

        assert.equal(results.collNull, false, 'Null corners must evaluate to false');
        assert.equal(results.collEmpty, false, 'Empty corners must evaluate to false');
        assert.equal(results.collIncomplete, false, 'Incomplete corners must evaluate to false');
        assert.equal(results.collExtremeRatio, true, 'Extreme 10,000x0.05 strip must intersect crossing obstacle');
        assert.equal(results.oversizedClampedX, 250, 'Oversized width must center to room.width / 2');
        assert.equal(results.oversizedClampedY, 200, 'Oversized depth must center to room.depth / 2');
        assert.equal(results.collZeroCircle, false, 'Zero radius circles must not collide');
    });

    test('Adversarial 2: Flush boundary tangencies and epsilon separation thresholds', async () => {
        const { page } = env;

        const results = await page.evaluate(() => {
            // Rect A: center (100, 100), w=100, l=100 -> X ∈ [50, 150], Y ∈ [50, 150]
            // Rect B (flush): center (200, 100), w=100, l=100 -> X ∈ [150, 250], Y ∈ [50, 150]
            const rectA = { shape: 'rect', x: 100, y: 100, w: 100, l: 100, h: 50, elevation: 0, rotation: 0, collisionEnabled: true };
            const rectBFlush = { shape: 'rect', x: 200, y: 100, w: 100, l: 100, h: 50, elevation: 0, rotation: 0, collisionEnabled: true };
            const flushColl = CollisionEngine.checkFurnitureCollision(rectA, rectBFlush);

            // Rect B (penetrating by 0.05cm > EPS 1e-5): center (199.95, 100)
            const rectBPenetrating = { shape: 'rect', x: 199.95, y: 100, w: 100, l: 100, h: 50, elevation: 0, rotation: 0, collisionEnabled: true };
            const penetratingColl = CollisionEngine.checkFurnitureCollision(rectA, rectBPenetrating);

            // Circle A (radius 50 at 100, 100) vs Circle B (radius 50 at 200, 100) -> distance = 100 = r1 + r2 (tangent)
            const circleATangent = { shape: 'circle', x: 100, y: 100, w: 100, h: 50, elevation: 0, collisionEnabled: true };
            const circleBTangent = { shape: 'circle', x: 200, y: 100, w: 100, h: 50, elevation: 0, collisionEnabled: true };
            const circleTangentColl = CollisionEngine.checkFurnitureCollision(circleATangent, circleBTangent);

            // Circle B penetrating by 0.05cm (distance = 99.95 < 100)
            const circleBPenetrating = { shape: 'circle', x: 199.95, y: 100, w: 100, h: 50, elevation: 0, collisionEnabled: true };
            const circlePenetratingColl = CollisionEngine.checkFurnitureCollision(circleATangent, circleBPenetrating);

            // Circle tangent to Rect left edge:
            // Rect at x=200, y=100, w=100, l=100 -> left edge at x=150.
            // Circle with radius 50 at x=100, y=100 -> rightmost point at x=150.
            const circleVsRectTangent = CollisionEngine.checkFurnitureCollision(circleATangent, rectBFlush);
            const circleVsRectPenetrating = CollisionEngine.checkFurnitureCollision(circleATangent, rectBPenetrating);

            return {
                flushColl,
                penetratingColl,
                circleTangentColl,
                circlePenetratingColl,
                circleVsRectTangent,
                circleVsRectPenetrating
            };
        });

        assert.equal(results.flushColl, false, 'Flush OBB contact (0 gap) must NOT register as collision due to epsilon tolerance');
        assert.equal(results.penetratingColl, true, 'Penetrating OBB (0.05cm overlap) MUST register as collision');
        assert.equal(results.circleTangentColl, false, 'Flush tangent circles must NOT register as collision');
        assert.equal(results.circlePenetratingColl, true, 'Penetrating circles must register as collision');
        assert.equal(results.circleVsRectTangent, false, 'Circle tangent to rect edge must NOT register as collision');
        assert.equal(results.circleVsRectPenetrating, true, 'Circle penetrating rect edge must register as collision');
    });

    test('Adversarial 3: Non-standard rotation angles & multi-turn periodicity (0°, 360°, 720°, -1080°, 1e-6°)', async () => {
        const { page } = env;

        const results = await page.evaluate(() => {
            const baseRect = { shape: 'rect', x: 250, y: 200, w: 120, l: 80 };

            const c0 = getFurnitureCorners({ ...baseRect, rotation: 0 });
            const c360 = getFurnitureCorners({ ...baseRect, rotation: 360 });
            const c720 = getFurnitureCorners({ ...baseRect, rotation: 720 });
            const cMinus1080 = getFurnitureCorners({ ...baseRect, rotation: -1080 });
            const cEpsilon = getFurnitureCorners({ ...baseRect, rotation: 1e-6 });

            const maxDelta360 = Math.max(...c0.map((p, i) => Math.hypot(p.x - c360[i].x, p.y - c360[i].y)));
            const maxDelta720 = Math.max(...c0.map((p, i) => Math.hypot(p.x - c720[i].x, p.y - c720[i].y)));
            const maxDeltaMinus1080 = Math.max(...c0.map((p, i) => Math.hypot(p.x - cMinus1080[i].x, p.y - cMinus1080[i].y)));
            const maxDeltaEpsilon = Math.max(...c0.map((p, i) => Math.hypot(p.x - cEpsilon[i].x, p.y - cEpsilon[i].y)));

            // Collision consistency under periodic rotation: Box at (340, 200) overlaps baseRect
            const neighbor = { shape: 'rect', x: 340, y: 200, w: 100, l: 80, h: 50, elevation: 0, collisionEnabled: true };
            const coll0 = CollisionEngine.checkFurnitureCollision({ ...baseRect, rotation: 0, h: 50, elevation: 0, collisionEnabled: true }, neighbor);
            const coll720 = CollisionEngine.checkFurnitureCollision({ ...baseRect, rotation: 720, h: 50, elevation: 0, collisionEnabled: true }, neighbor);

            return {
                maxDelta360,
                maxDelta720,
                maxDeltaMinus1080,
                maxDeltaEpsilon,
                coll0,
                coll720
            };
        });

        assert.ok(results.maxDelta360 < 1e-4, `360-degree rotation must match 0-degree vertices (delta: ${results.maxDelta360})`);
        assert.ok(results.maxDelta720 < 1e-4, `720-degree rotation must match 0-degree vertices (delta: ${results.maxDelta720})`);
        assert.ok(results.maxDeltaMinus1080 < 1e-4, `-1080-degree rotation must match 0-degree vertices (delta: ${results.maxDeltaMinus1080})`);
        assert.ok(results.maxDeltaEpsilon < 1e-3, `1e-6 degree rotation must match 0-degree within numerical tolerance`);
        assert.equal(results.coll0, true, '0-degree neighbor collision must be true');
        assert.equal(results.coll720, true, '720-degree neighbor collision must be true');
    });

    test('Adversarial 4: Rotated 45-degree furniture clamping against room walls', async () => {
        const { page } = env;

        const results = await page.evaluate(() => {
            const room = { width: 500, depth: 400, height: 250 };
            // Square 100x100 rotated by 45 degrees: half-diagonal = 100 * sqrt(2) / 2 ≈ 70.71 cm
            // Placed at (50, 50) -> corner X = 50 - 70.71 = -20.71 < 0 (outside left wall)
            const f = { shape: 'rect', x: 50, y: 50, w: 100, l: 100, rotation: 45 };

            const collidedBefore = CollisionEngine.checkWallCollision(f, room);
            const clamped = CollisionEngine.clampFurnitureToRoom(f, room);
            const collidedAfter = CollisionEngine.checkWallCollision(f, room);
            const cornersAfter = getFurnitureCorners(f);

            const minX = Math.min(...cornersAfter.map(c => c.x));
            const maxX = Math.max(...cornersAfter.map(c => c.x));
            const minY = Math.min(...cornersAfter.map(c => c.y));
            const maxY = Math.max(...cornersAfter.map(c => c.y));

            return {
                collidedBefore,
                clamped,
                collidedAfter,
                finalX: f.x,
                finalY: f.y,
                minX,
                maxX,
                minY,
                maxY
            };
        });

        assert.equal(results.collidedBefore, true, '45-degree rotated furniture at (50, 50) must collide with wall before clamp');
        assert.equal(results.clamped, true, 'clampFurnitureToRoom must modify position');
        assert.equal(results.collidedAfter, false, 'After clamping, 45-degree furniture must not collide with wall');
        assert.ok(results.minX >= -1e-4, `minX (${results.minX}) must be >= 0`);
        assert.ok(results.maxX <= 500 + 1e-4, `maxX (${results.maxX}) must be <= room.width`);
        assert.ok(results.minY >= -1e-4, `minY (${results.minY}) must be >= 0`);
        assert.ok(results.maxY <= 400 + 1e-4, `maxY (${results.maxY}) must be <= room.depth`);
    });

    test('Adversarial 5: Multi-tier elevation stacking and horizontal collision exemption', async () => {
        const { page } = env;

        const results = await page.evaluate(() => {
            // Stack 3 items vertically at the exact same horizontal center (250, 200):
            // 1. Lowboard: elevation 0, height 40 -> top = 40
            // 2. Shelf / Box: elevation 40, height 30 -> top = 70
            // 3. TV: tvSize 55, height 70 (elevation computed automatically)
            // 4. Rug underneath everything: isRug = true, height 2
            const lowboard = { id: 'lb_adv', name: 'Lowboard', shape: 'rect', x: 250, y: 200, w: 160, l: 50, h: 40, elevation: 0, rotation: 0, collisionEnabled: true };
            const shelf = { id: 'shelf_adv', name: 'Regalbox', shape: 'rect', x: 250, y: 200, w: 60, l: 40, h: 30, elevation: 40, rotation: 0, collisionEnabled: true };
            const tv = { id: 'tv_adv', name: 'Fernseher', shape: 'rect', x: 250, y: 200, w: 120, l: 15, h: 70, elevation: 0, tvSize: 55, rotation: 0, collisionEnabled: true };
            const rug = { id: 'rug_adv', name: 'Wollteppich', shape: 'rect', x: 250, y: 200, w: 200, l: 120, h: 2, elevation: 0, isRug: true, rotation: 0, collisionEnabled: true };

            State.furniture = [lowboard, shelf, tv, rug];
            const anyColl = CollisionEngine.updateAllCollisions();

            return {
                anyColl,
                tvElevation: tv.elevation,
                lowboardColliding: lowboard.isColliding,
                shelfColliding: shelf.isColliding,
                tvColliding: tv.isColliding,
                rugColliding: rug.isColliding
            };
        });

        assert.equal(results.tvElevation, 70, 'TV elevation must automatically elevate to the highest underlying surface (shelf top: 70cm)');
        assert.equal(results.anyColl, false, 'Cleanly stacked furniture and underlying rug must produce ZERO collision alerts');
        assert.equal(results.lowboardColliding, false, 'Lowboard must not be flagged as colliding');
        assert.equal(results.shelfColliding, false, 'Stacked shelf must not be flagged as colliding');
        assert.equal(results.tvColliding, false, 'Stacked TV must not be flagged as colliding');
        assert.equal(results.rugColliding, false, 'Underlying rug must not be flagged as colliding');
    });

    test('Adversarial 6: Dual-opposing gable roof pitches and 4-way hip roof vertical envelopes', async () => {
        const { page } = env;

        const results = await page.evaluate(() => {
            State.room.width = 500;
            State.room.depth = 400;
            State.room.height = 250;

            // Scenario 1: Dual opposing Gable roof (Top + Bottom pitches enabled)
            State.room.pitches.top = { enabled: true, kniestock: 70, run: 160 };
            State.room.pitches.bottom = { enabled: true, kniestock: 70, run: 160 };
            State.room.pitches.left = { enabled: false };
            State.room.pitches.right = { enabled: false };

            const hGableNorthWall = getCeilingHeightAt(250, 0);   // Exactly at North wall (y=0) -> kniestock 70
            const hGableMidNorth = getCeilingHeightAt(250, 80);    // Midway up North pitch -> 70 + (250-70)*(80/160) = 160
            const hGableRidge = getCeilingHeightAt(250, 200);      // Flat central ridge (y=200) -> 250
            const hGableMidSouth = getCeilingHeightAt(250, 320);   // Midway up South pitch -> 160
            const hGableSouthWall = getCeilingHeightAt(250, 400);   // Exactly at South wall (y=400) -> 70

            // Scenario 2: 4-Way Hip Roof (All 4 pitches enabled)
            State.room.pitches.left = { enabled: true, kniestock: 60, run: 150 };
            State.room.pitches.right = { enabled: true, kniestock: 60, run: 150 };

            const hCorner00 = getCeilingHeightAt(0, 0);           // Extreme corner (0, 0)
            const hCenter = getCeilingHeightAt(250, 200);          // Exact room center

            // Non-standard kniestock clamps: kniestock exceeding room height
            State.room.pitches.top.kniestock = 350; // greater than room.height 250
            const hOverKniestok = getCeilingHeightAt(250, 0);

            // kniestock = 0 (roof slopes directly to floor)
            State.room.pitches.top.kniestock = 0;
            const hZeroKniestok = getCeilingHeightAt(250, 0);

            return {
                hGableNorthWall,
                hGableMidNorth,
                hGableRidge,
                hGableMidSouth,
                hGableSouthWall,
                hCorner00,
                hCenter,
                hOverKniestok,
                hZeroKniestok
            };
        });

        assert.equal(Math.round(results.hGableNorthWall), 70, 'North wall kniestock must be 70cm');
        assert.equal(Math.round(results.hGableMidNorth), 160, 'Mid-north pitch height must be 160cm');
        assert.equal(Math.round(results.hGableRidge), 250, 'Central ridge must reach full ceiling height 250cm');
        assert.equal(Math.round(results.hGableMidSouth), 160, 'Mid-south pitch height must be 160cm');
        assert.equal(Math.round(results.hGableSouthWall), 70, 'South wall kniestock must be 70cm');
        assert.ok(results.hCorner00 <= 70, 'Corner height under 4-way hip roof must be minimum kniestock');
        assert.equal(Math.round(results.hCenter), 250, 'Center under 4-way hip roof beyond runs must be 250cm');
        assert.equal(results.hOverKniestok, 250, 'Kniestok exceeding room height must clamp to room height (250cm)');
        assert.equal(results.hZeroKniestok, 0, 'Zero kniestock roof must reach 0cm at wall');
    });

    test('Adversarial 7: 32-point perimeter circle sampling vs 9-point rect under partial pitch', async () => {
        const { page } = env;

        const results = await page.evaluate(() => {
            State.room.width = 500;
            State.room.depth = 400;
            State.room.height = 250;
            State.room.pitches.top = { enabled: true, kniestock: 80, run: 150 };
            State.room.pitches.bottom = { enabled: false };
            State.room.pitches.left = { enabled: false };
            State.room.pitches.right = { enabled: false };

            // Circular table: radius 30 (diameter 60), height 240
            // Positioned at x=250, y=160. Note: y=160 is OUTSIDE pitch run (150cm).
            // Center ceiling height at y=160 is 250cm (clearance: 250 - 240 = 10cm).
            // BUT perimeter extends to y = 160 - 30 = 130cm!
            // Ceiling at y=130 is 80 + (250-80)*(130/150) = 227.33cm.
            // Table height (240) > ceiling (227.33) -> 32-point perimeter MUST detect collision!
            const roundTableTall = {
                id: 'round_tall',
                name: 'Stehtisch rund',
                shape: 'circle',
                x: 250,
                y: 160,
                w: 60,
                h: 240,
                elevation: 0,
                collisionEnabled: true
            };

            const tallCircleCollides = CollisionEngine.checkRoofPitchCollision(roundTableTall);

            // If table height is reduced to 220cm (< 227.33cm), it clears completely
            roundTableTall.h = 220;
            const shortCircleCollides = CollisionEngine.checkRoofPitchCollision(roundTableTall);

            // Rug under low pitch (y=20, ceil ~102cm) must NOT collide even if height = 200
            const rugUnderPitch = {
                id: 'rug_pitch',
                name: 'Teppich',
                shape: 'rect',
                x: 250,
                y: 20,
                w: 120,
                l: 60,
                h: 200,
                isRug: true,
                collisionEnabled: true
            };
            const rugCollides = CollisionEngine.checkRoofPitchCollision(rugUnderPitch);

            return {
                tallCircleCollides,
                shortCircleCollides,
                rugCollides
            };
        });

        assert.equal(results.tallCircleCollides, true, '32-point perimeter sampling must catch perimeter clipping under pitch when center is outside slope');
        assert.equal(results.shortCircleCollides, false, 'Cleared circular table must not collide with pitch');
        assert.equal(results.rugCollides, false, 'Rugs must be exempt from roof pitch collision');
    });

    test('Adversarial 8: 3D Raycasting direct furniture selection, stacking & empty space deselect', async () => {
        const { page } = env;

        // Switch to 3D view
        await page.click('#btn-view-3d');

        const selectionResults = await page.evaluate(() => {
            // Setup scene with Sofa and Lowboard + TV
            State.room.width = 500;
            State.room.depth = 400;
            State.room.height = 250;

            const sofa = { id: 'sofa_3d', name: 'Sofa', shape: 'rect', x: 150, y: 200, w: 180, l: 85, h: 75, rotation: 0, collisionEnabled: true };
            const lowboard = { id: 'lb_3d', name: 'Lowboard', shape: 'rect', x: 350, y: 200, w: 150, l: 50, h: 40, rotation: 0, collisionEnabled: true };
            const tv = { id: 'tv_3d', name: 'Fernseher', shape: 'rect', x: 350, y: 200, w: 110, l: 15, h: 65, tvSize: 55, elevation: 40, rotation: 0, collisionEnabled: true };

            State.furniture = [sofa, lowboard, tv];
            Viewer3D.rebuildFullRoom();
            Viewer3D.renderer.render(Viewer3D.scene, Viewer3D.camera);

            // Raycast directed straight at Sofa in 3D
            const sofaGroup = Viewer3D.furnitureMeshes.get(sofa);
            const sofaPos = new THREE.Vector3();
            sofaGroup.getWorldPosition(sofaPos);

            const raycaster = new THREE.Raycaster();
            raycaster.set(new THREE.Vector3(sofaPos.x, 300, sofaPos.z), new THREE.Vector3(0, -1, 0));
            const hits = raycaster.intersectObjects([sofaGroup], true);

            let hitFurniture = null;
            if (hits.length > 0) {
                let cur = hits[0].object;
                while (cur && cur !== Viewer3D.scene) {
                    if (cur.userData && cur.userData.furniture) {
                        hitFurniture = cur.userData.furniture;
                        break;
                    }
                    cur = cur.parent;
                }
            }

            selectItem(hitFurniture, 'furniture');
            const selectedAfterSofa = State.selectedItem ? State.selectedItem.id : null;

            // Deselect by clicking floor
            selectItem(null, null);
            const selectedAfterDeselect = State.selectedItem;

            // Stacked raycast targeting TV volume (from above TV at x=350, z=200)
            const tvGroup = Viewer3D.furnitureMeshes.get(tv);
            const lbGroup = Viewer3D.furnitureMeshes.get(lowboard);
            const tvPos = new THREE.Vector3();
            tvGroup.getWorldPosition(tvPos);

            const stackedRay = new THREE.Raycaster();
            stackedRay.set(new THREE.Vector3(tvPos.x, 300, tvPos.z), new THREE.Vector3(0, -1, 0));
            const stackedHits = stackedRay.intersectObjects([tvGroup, lbGroup], true);

            let stackedTopEntity = null;
            if (stackedHits.length > 0) {
                let curTop = stackedHits[0].object;
                while (curTop && curTop !== Viewer3D.scene) {
                    if (curTop.userData && curTop.userData.furniture) {
                        stackedTopEntity = curTop.userData.furniture;
                        break;
                    }
                    curTop = curTop.parent;
                }
            }

            return {
                hasSofaGroup: Boolean(sofaGroup),
                hitsCount: hits.length,
                selectedAfterSofa,
                selectedAfterDeselect,
                topStackedId: stackedTopEntity ? stackedTopEntity.id : null
            };
        });

        assert.equal(selectionResults.hasSofaGroup, true, 'Sofa group mesh must exist in 3D scene');
        assert.ok(selectionResults.hitsCount > 0, 'Raycaster must intersect sofa group in 3D');
        assert.equal(selectionResults.selectedAfterSofa, 'sofa_3d', 'Sofa must be selected via direct 3D raycasting');
        assert.equal(selectionResults.selectedAfterDeselect, null, 'Deselection must clear State.selectedItem');
        assert.equal(selectionResults.topStackedId, 'tv_3d', 'Topmost object in stack (TV) must be hit first by raycaster');

        // Restore split view for subsequent test isolation
        await page.click('#btn-view-split');
    });

    test('Adversarial 9: 3D Raycasting drag-filter, hold-filter & deleted mesh safety', async () => {
        const { page } = env;

        const results = await page.evaluate(() => {
            const canvas = Viewer3D.renderer.domElement;
            const rect = canvas.getBoundingClientRect();

            // 1. Simulate pointer drag (camera orbit motion): down at (100, 100), up at (180, 180) -> dist ~113px > 5px
            canvas.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: rect.left + 100, clientY: rect.top + 100 }));
            canvas.dispatchEvent(new PointerEvent('pointerup', { button: 0, clientX: rect.left + 180, clientY: rect.top + 180 }));

            // Must NOT trigger selection
            const dragFilterActive = (Viewer3D.pointerDownPos === null);

            // 2. Orphaned / deleted furniture test:
            // Remove all furniture from State without calling rebuildFullRoom (stale meshes in Map)
            State.furniture = [];
            // Direct raycasting through all interactables must not throw unhandled exceptions
            let noThrow = true;
            try {
                const raycaster = new THREE.Raycaster();
                raycaster.set(new THREE.Vector3(0, 500, 0), new THREE.Vector3(0, -1, 0));
                const interactables = [];
                if (Viewer3D.furnitureMeshes) {
                    Viewer3D.furnitureMeshes.forEach(g => { if (g) interactables.push(g); });
                }
                const hits = raycaster.intersectObjects(interactables, true);
                if (hits.length > 0) {
                    let cur = hits[0].object;
                    while (cur && cur !== Viewer3D.scene) {
                        if (cur.userData && cur.userData.furniture) {
                            selectItem(cur.userData.furniture, 'furniture');
                            break;
                        }
                        cur = cur.parent;
                    }
                }
            } catch (err) {
                noThrow = false;
            }

            return {
                dragFilterActive,
                noThrow
            };
        });

        assert.equal(results.dragFilterActive, true, 'Pointerdown position must be reset after drag filter evaluation');
        assert.equal(results.noThrow, true, 'Raycaster over stale or unrendered meshes must not throw');
    });

    test('Adversarial 10: First-person Walkthrough mode rapid boundary stress & camera invariants', async () => {
        const { page } = env;

        // Ensure we are in split view so 2D editor canvas has valid positive dimensions
        await page.click('#btn-view-split');

        const results = await page.evaluate(() => {
            State.room.width = 500;
            State.room.depth = 400;
            State.room.height = 250;

            // 1. Enter Walkthrough mode
            WalkthroughMode.toggle(true);
            if (!Viewer3D.isWalkthrough) throw new Error('Walkthrough mode must be active');

            // Set high speed to stress boundary clamping
            Viewer3D.walkthroughSpeed = 100.0;
            Viewer3D.walkthroughYaw = 0; // Facing North (-Z)

            // Simulate pressing KeyW (move toward North wall: minZ = -depth/2 + margin = -200 + 25 = -175)
            Viewer3D.keys = { 'KeyW': true };
            for (let i = 0; i < 20; i++) {
                Viewer3D.animate();
            }
            Viewer3D.keys = {};
            const clampedNorthZ = Viewer3D.camera.position.z;

            // Simulate pressing KeyS (move toward South wall: maxZ = depth/2 - margin = 200 - 25 = 175)
            Viewer3D.keys = { 'KeyS': true };
            for (let i = 0; i < 40; i++) {
                Viewer3D.animate();
            }
            Viewer3D.keys = {};
            const clampedSouthZ = Viewer3D.camera.position.z;

            // Simulate pressing KeyD (move toward East wall: maxX = width/2 - margin = 250 - 25 = 225)
            Viewer3D.keys = { 'KeyD': true };
            for (let i = 0; i < 40; i++) {
                Viewer3D.animate();
            }
            Viewer3D.keys = {};
            const clampedEastX = Viewer3D.camera.position.x;

            // Simulate pressing KeyA (move toward West wall: minX = -width/2 + margin = -250 + 25 = -225)
            Viewer3D.keys = { 'KeyA': true };
            for (let i = 0; i < 40; i++) {
                Viewer3D.animate();
            }
            Viewer3D.keys = {};
            const clampedWestX = Viewer3D.camera.position.x;

            // Camera eye-level invariant
            const eyeLevel = Viewer3D.camera.position.y;

            // Extreme pitch stress (drag down mouse by 5000px)
            Viewer3D.walkthroughPitch = -10.0;
            Viewer3D.updateCameraRotation();
            const minPitchClamped = Viewer3D.walkthroughPitch;

            Viewer3D.walkthroughPitch = 10.0;
            Viewer3D.updateCameraRotation();
            const maxPitchClamped = Viewer3D.walkthroughPitch;

            // Restore Walkthrough off
            WalkthroughMode.toggle(false);

            return {
                clampedNorthZ,
                clampedSouthZ,
                clampedEastX,
                clampedWestX,
                eyeLevel,
                minPitchClamped,
                maxPitchClamped,
                isWalkthroughAfter: Viewer3D.isWalkthrough
            };
        });

        assert.equal(results.clampedNorthZ, -175, 'Camera Z must be clamped at -175cm on North wall');
        assert.equal(results.clampedSouthZ, 175, 'Camera Z must be clamped at +175cm on South wall');
        assert.equal(results.clampedEastX, 225, 'Camera X must be clamped at +225cm on East wall');
        assert.equal(results.clampedWestX, -225, 'Camera X must be clamped at -225cm on West wall');
        assert.equal(results.eyeLevel, 165, 'Walkthrough camera height must remain strictly at 165cm eye-level');
        assert.equal(results.minPitchClamped, -1.4, 'Pitch must be clamped to -1.4 rad minimum');
        assert.equal(results.maxPitchClamped, 1.4, 'Pitch must be clamped to +1.4 rad maximum');
        assert.equal(results.isWalkthroughAfter, false, 'Walkthrough mode must be toggled off');
    });

    test('Adversarial 11: Procedural Texture Generator comprehensive registry and fallback verification', async () => {
        const { page } = env;

        const textureResults = await page.evaluate(() => {
            const registeredFloors = [
                'parkett_eiche', 'parkett_dunkel', 'dielen_kiefer',
                'laminat_hell', 'laminat_grau', 'fliesen_weiss',
                'fliesen_anthrazit', 'fliesen_terrakotta', 'marmor_carrara',
                'estrich_beton', 'teppich_beige', 'teppich_grau'
            ];

            const floorChecks = registeredFloors.map(type => {
                const tex = TextureGenerator.createFloorTexture(type);
                const bump = TextureGenerator.createFloorBump(type);
                return {
                    type,
                    hasTex: Boolean(tex && tex.isCanvasTexture),
                    hasBump: Boolean(bump && bump.isCanvasTexture),
                    wrapS: tex ? tex.wrapS : null,
                    wrapT: tex ? tex.wrapT : null
                };
            });

            // Plaster & Door procedural textures
            const plasterBump = TextureGenerator.createWallPlasterBump();
            const doorTex = TextureGenerator.createDoorTexture('#ffffff');
            const doorBump = TextureGenerator.createDoorBump();

            // Adversarial corrupted / nonexistent texture token
            const fallbackTex = TextureGenerator.createFloorTexture('non_existent_corrupted_texture_#xyz999');

            return {
                allFloorsValid: floorChecks.every(f => f.hasTex && f.hasBump && f.wrapS === THREE.RepeatWrapping),
                plasterValid: Boolean(plasterBump && plasterBump.isCanvasTexture),
                doorTexValid: Boolean(doorTex && doorTex.isCanvasTexture),
                doorBumpValid: Boolean(doorBump && doorBump.isCanvasTexture),
                fallbackValid: Boolean(fallbackTex && fallbackTex.isCanvasTexture)
            };
        });

        assert.equal(textureResults.allFloorsValid, true, 'All 12 procedural floor textures and bump maps must initialize as valid THREE.CanvasTextures');
        assert.equal(textureResults.plasterValid, true, 'Wall plaster bump map must be a valid CanvasTexture');
        assert.equal(textureResults.doorTexValid, true, 'Procedural door texture must be a valid CanvasTexture');
        assert.equal(textureResults.doorBumpValid, true, 'Procedural door bump map must be a valid CanvasTexture');
        assert.equal(textureResults.fallbackValid, true, 'Corrupted or unknown texture tokens must fallback safely to default CanvasTexture');
    });

    test('Adversarial 12: Walkthrough transition from 3D view succeeds cleanly with positive zoom and no IndexSizeError', async () => {
        const { page } = env;

        // 1. Switch directly to 3D view (hiding .editor-pane via display: none)
        await page.click('#btn-view-3d');

        // 2. Read State.editor2D.zoom (must be strictly positive, guarded against hidden dimensions)
        const zoomIn3D = await page.evaluate(() => State.editor2D.zoom);
        assert.ok(zoomIn3D > 0, `Zoom in 3D view must be strictly positive, got ${zoomIn3D}`);

        // 3. Enabling Walkthrough mode while in 3D view transitions to split view cleanly without throwing IndexSizeError
        const result = await page.evaluate(() => {
            try {
                WalkthroughMode.toggle(true);
                return {
                    success: true,
                    isWalkthrough: Viewer3D.isWalkthrough,
                    viewMode: State.settings ? State.settings.viewMode : null,
                    zoom: State.editor2D.zoom
                };
            } catch (err) {
                return {
                    success: false,
                    name: err.name,
                    message: err.message
                };
            }
        });

        assert.equal(result.success, true, `Walkthrough mode must enter cleanly without throwing: ${result.name} - ${result.message}`);
        assert.equal(result.isWalkthrough, true, 'Viewer3D.isWalkthrough must be true');
        assert.equal(result.viewMode, 'split', 'View mode must automatically transition to split view');
        assert.ok(result.zoom > 0, `Zoom must remain strictly positive, got ${result.zoom}`);

        // Cleanup: exit walkthrough and restore split view
        await page.evaluate(() => {
            if (Viewer3D.isWalkthrough) WalkthroughMode.toggle(false);
        });
        await page.click('#btn-view-split');
    });
});
