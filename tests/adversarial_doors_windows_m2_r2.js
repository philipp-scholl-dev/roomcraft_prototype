/**
 * Empirical Adversarial Verification Suite — Milestone 2 Round 2
 * Challenger: challenger_m2_r2_2
 *
 * Comprehensive empirical tests covering:
 * 1. Window sills & handle orientation across all 4 wall orientations ('top', 'bottom', 'left', 'right')
 *    - Distance from room center (0, 0, 0) to intSill vs extSill vs winGroup
 *    - Strict inward projection (D_int < D_win) and outward projection (D_ext > D_win)
 *    - Window handle (Fensterolive) mounted on interior face (+Z) facing room interior (D_handle < D_win)
 *    - Exact projection magnitudes (7.0cm interior, 5.0cm exterior)
 * 2. Window mullion threshold sweep (50cm to 200cm)
 * 3. Door Umfassungszargen casing across all 4 walls, double doors, balcony doors
 * 4. Drückergarnitur kinematic lock across 0°-90° sweep for all 4 walls, both swing directions ('in', 'out'), and both hinges ('left', 'right')
 * 5. 2D DIN 1356 CAD symbols across all 4 walls
 */

const assert = require('assert');
const { setupTestEnvironment } = require('./e2e/helpers.js');

let totalChecks = 0;
let passedChecks = 0;
let failedChecks = 0;

function recordCheck(name, condition, errorMsg = '') {
    totalChecks++;
    if (condition) {
        passedChecks++;
    } else {
        failedChecks++;
        console.error(`  FAIL [Check #${totalChecks}]: ${name} ${errorMsg ? '— ' + errorMsg : ''}`);
    }
}

async function runAdversarialVerification() {
    console.log('='.repeat(80));
    console.log('  CHALLENGER M2 R2: EMPIRICAL ADVERSARIAL STRESS TEST SUITE');
    console.log('  Testing Doors, Windows, Sills & Handle Orientations Across All 4 Walls');
    console.log('='.repeat(80));

    const env = await setupTestEnvironment();
    const { page } = env;

    try {
        // =========================================================================
        // TEST 1: Window Sills & Handle Orientation Across All 4 Wall Orientations
        // =========================================================================
        console.log('\n--- 1. Window Sills & Handle Orientation: 4 Walls x 3 Window Types x 3 Room Sizes ---');
        
        const walls = ['top', 'bottom', 'left', 'right'];
        const windowConfigs = [
            { desc: 'Narrow 80cm Single-Wing', w: 80, h: 120, sillHeight: 90 },
            { desc: 'Standard 120cm Double-Wing', w: 120, h: 140, sillHeight: 85 },
            { desc: 'Wide 180cm Double-Wing', w: 180, h: 150, sillHeight: 80 }
        ];
        const roomSizes = [
            { w: 500, d: 400, desc: 'Small 5x4m' },
            { w: 600, d: 500, desc: 'Standard 6x5m' },
            { w: 900, d: 700, desc: 'Large 9x7m' }
        ];

        const metricTable = [];

        for (const wall of walls) {
            for (const winCfg of windowConfigs) {
                for (const room of roomSizes) {
                    const winPos = (wall === 'top' || wall === 'bottom') ? room.w / 2 : room.d / 2;

                    const res = await page.evaluate(({ wall, winCfg, room, winPos }) => {
                        State.room.width = room.w;
                        State.room.depth = room.d;
                        State.room.height = 260;
                        State.elements = [
                            {
                                id: `adv_win_${wall}_${winCfg.w}`,
                                type: 'window',
                                wall: wall,
                                position: winPos,
                                w: winCfg.w,
                                h: winCfg.h,
                                sillHeight: winCfg.sillHeight
                            }
                        ];

                        Viewer3D.rebuildFullRoom();
                        const winGroup = Viewer3D.windowMeshes[0];
                        if (!winGroup) return { error: 'No window mesh found' };

                        // Interior sill (depth 13cm)
                        const intSill = winGroup.children.find(c => c.geometry && Math.abs(c.geometry.parameters.depth - 13) < 0.1);
                        // Exterior sill (depth 10cm)
                        const extSill = winGroup.children.find(c => c.geometry && Math.abs(c.geometry.parameters.depth - 10) < 0.1);
                        // Handle group
                        const handleGroup = winGroup.children.find(c => c.type === 'Group');

                        if (!intSill || !extSill || !handleGroup) {
                            return { error: 'Missing parts', hasInt: !!intSill, hasExt: !!extSill, hasHandle: !!handleGroup };
                        }

                        // Handle grip (child index 2)
                        const grip = handleGroup.children.find(c => c.geometry && Math.abs(c.geometry.parameters.height - 10) < 0.1);
                        const rosette = handleGroup.children[0];

                        // World positions
                        winGroup.updateMatrixWorld(true);
                        intSill.updateMatrixWorld(true);
                        extSill.updateMatrixWorld(true);
                        if (grip) grip.updateMatrixWorld(true);
                        if (rosette) rosette.updateMatrixWorld(true);

                        const posWin = new THREE.Vector3();
                        const posInt = new THREE.Vector3();
                        const posExt = new THREE.Vector3();
                        const posGrip = new THREE.Vector3();
                        const posRosette = new THREE.Vector3();

                        winGroup.getWorldPosition(posWin);
                        intSill.getWorldPosition(posInt);
                        extSill.getWorldPosition(posExt);
                        if (grip) grip.getWorldPosition(posGrip);
                        if (rosette) rosette.getWorldPosition(posRosette);

                        // Room center in world space is (0, 0, 0)
                        const dWin = Math.hypot(posWin.x, posWin.z);
                        const dInt = Math.hypot(posInt.x, posInt.z);
                        const dExt = Math.hypot(posExt.x, posExt.z);
                        const dGrip = Math.hypot(posGrip.x, posGrip.z);
                        const dRosette = Math.hypot(posRosette.x, posRosette.z);

                        // Inward normal unit vector in world coordinates:
                        // Room extends from -w/2 to +w/2 in X, -d/2 to +d/2 in Z.
                        // Center is (0, 0, 0).
                        // Top wall is at z = -d/2 -> inward is +Z (towards 0)
                        // Bottom wall is at z = +d/2 -> inward is -Z (towards 0)
                        // Left wall is at x = -w/2 -> inward is +X (towards 0)
                        // Right wall is at x = +w/2 -> inward is -X (towards 0)
                        let inwardNorm = { x: 0, z: 0 };
                        if (wall === 'top') inwardNorm = { x: 0, z: 1 };
                        else if (wall === 'bottom') inwardNorm = { x: 0, z: -1 };
                        else if (wall === 'left') inwardNorm = { x: 1, z: 0 };
                        else if (wall === 'right') inwardNorm = { x: -1, z: 0 };

                        // Vector from win to int, ext, grip
                        const vInt = { x: posInt.x - posWin.x, z: posInt.z - posWin.z };
                        const vExt = { x: posExt.x - posWin.x, z: posExt.z - posWin.z };
                        const vGrip = { x: posGrip.x - posWin.x, z: posGrip.z - posWin.z };

                        const dotInt = vInt.x * inwardNorm.x + vInt.z * inwardNorm.y; // note: norm is (x, z)
                        const dotIntReal = vInt.x * inwardNorm.x + vInt.z * inwardNorm.z;
                        const dotExtReal = vExt.x * inwardNorm.x + vExt.z * inwardNorm.z;
                        const dotGripReal = vGrip.x * inwardNorm.x + vGrip.z * inwardNorm.z;

                        // Local projections:
                        // intSill: local z = 5.5, depth = 13. inner edge = 5.5 + 6.5 = 12.0. Wall face = 5.0. Proj = 7.0
                        // extSill: local z = -5.0, depth = 10. outer edge = -5.0 - 5.0 = -10.0. Wall face = -5.0. Proj = 5.0
                        const intProj = (intSill.position.z + 13 / 2) - 5.0;
                        const extProj = Math.abs((extSill.position.z - 10 / 2) - (-5.0));

                        return {
                            dWin,
                            dInt,
                            dExt,
                            dGrip,
                            dRosette,
                            dotIntReal,
                            dotExtReal,
                            dotGripReal,
                            intProj,
                            extProj,
                            intSillZ: intSill.position.z,
                            extSillZ: extSill.position.z,
                            rosetteZ: rosette ? rosette.position.z : null,
                            gripZ: grip ? grip.position.z : null,
                            posWin: { x: posWin.x, z: posWin.z },
                            posInt: { x: posInt.x, z: posInt.z },
                            posExt: { x: posExt.x, z: posExt.z }
                        };
                    }, { wall, winCfg, room, winPos });

                    recordCheck(`Mesh creation on ${wall} (${winCfg.desc}, ${room.desc})`, !res.error, res.error);
                    
                    if (!res.error) {
                        // 1. Strict Inward Projection: dInt < dWin
                        recordCheck(
                            `Int sill closer to center than winGroup on ${wall} (${winCfg.w}cm)`,
                            res.dInt < res.dWin,
                            `dInt=${res.dInt.toFixed(2)} vs dWin=${res.dWin.toFixed(2)}`
                        );

                        // 2. Strict Outward Projection: dExt > dWin
                        recordCheck(
                            `Ext sill further from center than winGroup on ${wall} (${winCfg.w}cm)`,
                            res.dExt > res.dWin,
                            `dExt=${res.dExt.toFixed(2)} vs dWin=${res.dWin.toFixed(2)}`
                        );

                        // 3. Strict Handle Inward Mounting: dGrip < dWin & dRosette < dWin
                        recordCheck(
                            `Window handle grip closer to center than winGroup on ${wall} (${winCfg.w}cm)`,
                            res.dGrip < res.dWin,
                            `dGrip=${res.dGrip.toFixed(2)} vs dWin=${res.dWin.toFixed(2)}`
                        );
                        recordCheck(
                            `Window handle rosette closer to center than winGroup on ${wall} (${winCfg.w}cm)`,
                            res.dRosette < res.dWin,
                            `dRosette=${res.dRosette.toFixed(2)} vs dWin=${res.dWin.toFixed(2)}`
                        );

                        // 4. Dot Product with Inward Normal:
                        // Int sill must have positive projection along inward normal (+5.5cm)
                        recordCheck(
                            `Int sill points in direction of inward normal on ${wall}`,
                            res.dotIntReal > 5.4 && res.dotIntReal < 5.6,
                            `dotInt=${res.dotIntReal.toFixed(2)}`
                        );
                        // Ext sill must have negative projection along inward normal (-5.0cm)
                        recordCheck(
                            `Ext sill points in direction of outward normal on ${wall}`,
                            res.dotExtReal < -4.9 && res.dotExtReal > -5.1,
                            `dotExt=${res.dotExtReal.toFixed(2)}`
                        );
                        // Grip must project inward (+6.8cm)
                        recordCheck(
                            `Handle grip points in direction of inward normal on ${wall}`,
                            res.dotGripReal > 6.7 && res.dotGripReal < 6.9,
                            `dotGrip=${res.dotGripReal.toFixed(2)}`
                        );

                        // 5. Projection Magnitudes:
                        recordCheck(
                            `Int sill projection exactly 7.0cm on ${wall}`,
                            Math.abs(res.intProj - 7.0) < 1e-4,
                            `got ${res.intProj}`
                        );
                        recordCheck(
                            `Ext sill projection exactly 5.0cm on ${wall}`,
                            Math.abs(res.extProj - 5.0) < 1e-4,
                            `got ${res.extProj}`
                        );

                        // 6. Local Coordinate Checks:
                        recordCheck(`intSill local z is +5.5 on ${wall}`, Math.abs(res.intSillZ - 5.5) < 1e-4);
                        recordCheck(`extSill local z is -5.0 on ${wall}`, Math.abs(res.extSillZ - (-5.0)) < 1e-4);
                        recordCheck(`rosette local z is +4.2 on ${wall}`, Math.abs(res.rosetteZ - 4.2) < 1e-4);
                        recordCheck(`grip local z is +6.8 on ${wall}`, Math.abs(res.gripZ - 6.8) < 1e-4);
                    }

                    if (room.desc === 'Standard 6x5m' && winCfg.w === 120) {
                        metricTable.push({
                            wall,
                            winW: winCfg.w,
                            dCenterWin: res.dWin?.toFixed(2),
                            dCenterInt: res.dInt?.toFixed(2),
                            dCenterExt: res.dExt?.toFixed(2),
                            dCenterGrip: res.dGrip?.toFixed(2),
                            deltaInt: (res.dWin - res.dInt)?.toFixed(2),
                            deltaExt: (res.dExt - res.dWin)?.toFixed(2),
                            inwardCheck: (res.dInt < res.dWin && res.dExt > res.dWin) ? 'PASS' : 'FAIL'
                        });
                    }
                }
            }
        }

        console.table(metricTable);

        // =========================================================================
        // TEST 2: Window Mullion & Panes Sweep (50cm to 200cm in 10cm steps)
        // =========================================================================
        console.log('\n--- 2. Window Mullion & Glass Panes Threshold Sweep (50cm to 200cm) ---');
        
        const widths = [];
        for (let w = 50; w <= 200; w += 10) widths.push(w);
        widths.push(99.9, 100.0, 100.1);
        widths.sort((a, b) => a - b);

        const mullionResults = await page.evaluate((testWidths) => {
            const out = [];
            testWidths.forEach(w => {
                State.room.width = 600;
                State.room.depth = 500;
                State.elements = [
                    { id: `win_sw_${w}`, type: 'window', wall: 'top', position: 300, w, h: 130, sillHeight: 90 }
                ];
                Viewer3D.rebuildWalls3D();
                const win = Viewer3D.windowMeshes[0];
                const panes = win.children.filter(c => c.material && c.material.transmission !== undefined);
                const mullions = win.children.filter(c => c.geometry && Math.abs(c.geometry.parameters.width - 4.0) < 0.1 && Math.abs(c.position.x) < 0.1);
                out.push({ w, panes: panes.length, mullions: mullions.length });
            });
            return out;
        }, widths);

        mullionResults.forEach(r => {
            if (r.w >= 100.0) {
                recordCheck(`Window w=${r.w}cm has 2 glass panes`, r.panes === 2, `got ${r.panes}`);
                recordCheck(`Window w=${r.w}cm has 1 central mullion`, r.mullions === 1, `got ${r.mullions}`);
            } else {
                recordCheck(`Window w=${r.w}cm has 1 glass pane`, r.panes === 1, `got ${r.panes}`);
                recordCheck(`Window w=${r.w}cm has 0 central mullions`, r.mullions === 0, `got ${r.mullions}`);
            }
        });

        // =========================================================================
        // TEST 3: Door Umfassungszargen Casing Across All 4 Walls & Types
        // =========================================================================
        console.log('\n--- 3. Door Umfassungszargen Casing: 4 Walls x 3 Door Types ---');

        const doorTypes = [
            { desc: 'Single Wooden Door', type: 'door', isBalcony: false, w: 90, h: 210 },
            { desc: 'Double Wooden Door', type: 'double-door', isBalcony: false, w: 160, h: 210 },
            { desc: 'Balcony Glass Door', type: 'door', isBalcony: true, w: 90, h: 210 }
        ];

        for (const wall of walls) {
            for (const dt of doorTypes) {
                const res = await page.evaluate(({ wall, dt }) => {
                    State.room.width = 600;
                    State.room.depth = 500;
                    State.elements = [
                        {
                            id: `adv_door_${wall}_${dt.type}`,
                            type: dt.type,
                            isBalcony: dt.isBalcony,
                            wall: wall,
                            position: 250,
                            w: dt.w,
                            h: dt.h,
                            hinge: 'left',
                            direction: 'in'
                        }
                    ];
                    Viewer3D.rebuildWalls3D();
                    const doorGroup = Viewer3D.doorMeshes[0];
                    if (!doorGroup) return { error: 'No door mesh found' };

                    // Jamb left, jamb right, lintel
                    const jambL = doorGroup.children.find(c => c.geometry && Math.abs(c.geometry.parameters.width - 4.5) < 0.1 && c.position.x < 0);
                    const jambR = doorGroup.children.find(c => c.geometry && Math.abs(c.geometry.parameters.width - 4.5) < 0.1 && c.position.x > 0);
                    const lintel = doorGroup.children.find(c => c.geometry && Math.abs(c.geometry.parameters.height - 4.5) < 0.1);

                    return {
                        hasJambL: !!jambL,
                        hasJambR: !!jambR,
                        hasLintel: !!lintel,
                        jambDepth: jambL ? jambL.geometry.parameters.depth : 0,
                        lintelDepth: lintel ? lintel.geometry.parameters.depth : 0,
                        lintelWidth: lintel ? lintel.geometry.parameters.width : 0
                    };
                }, { wall, dt });

                recordCheck(`Full casing exists for ${dt.desc} on ${wall}`, res.hasJambL && res.hasJambR && res.hasLintel);
                recordCheck(`Casing jamb depth is 12cm (encasing 10cm wall) for ${dt.desc} on ${wall}`, Math.abs(res.jambDepth - 12) < 0.1);
                recordCheck(`Casing lintel depth is 12cm for ${dt.desc} on ${wall}`, Math.abs(res.lintelDepth - 12) < 0.1);
                recordCheck(`Lintel width is w+2 (${dt.w + 2}cm) for ${dt.desc} on ${wall}`, Math.abs(res.lintelWidth - (dt.w + 2)) < 0.1);
            }
        }

        // =========================================================================
        // TEST 4: Drückergarnitur Kinematic Invariants Across 0°-90° (Both Hinges, Both Directions)
        // =========================================================================
        console.log('\n--- 4. Drückergarnitur Kinematic Rigidity Across 0°-90° (Left/Right Hinges, In/Out Swing) ---');

        const testHinges = ['left', 'right'];
        const testDirs = ['in', 'out'];
        const testAngles = [0, 15, 30, 45, 60, 75, 90];

        for (const hinge of testHinges) {
            for (const dir of testDirs) {
                const kinRes = await page.evaluate(({ hinge, dir, testAngles }) => {
                    State.room.width = 600;
                    State.room.depth = 500;
                    State.elements = [
                        {
                            id: `adv_kin_${hinge}_${dir}`,
                            type: 'door',
                            wall: 'top',
                            position: 300,
                            w: 90,
                            h: 210,
                            hinge: hinge,
                            direction: dir
                        }
                    ];
                    Viewer3D.rebuildWalls3D();
                    const doorGroup = Viewer3D.doorMeshes[0];
                    const pivot = doorGroup.children.find(c => c.type === 'Group');
                    if (!pivot) return { error: 'No pivot group' };

                    const leaf = pivot.children[0];
                    const handle = pivot.children[1];
                    if (!leaf || !handle) return { error: 'No leaf or handle found' };

                    const angleData = [];
                    testAngles.forEach(deg => {
                        const rad = (deg * Math.PI) / 180;
                        const isIn = dir === 'in';
                        const isLeft = hinge === 'left';
                        const sign = (isIn ? -1 : 1) * (isLeft ? 1 : -1);
                        pivot.rotation.y = sign * rad;
                        pivot.updateMatrixWorld(true);

                        const pPos = new THREE.Vector3();
                        const hPos = new THREE.Vector3();
                        const lPos = new THREE.Vector3();

                        pivot.getWorldPosition(pPos);
                        handle.getWorldPosition(hPos);
                        leaf.getWorldPosition(lPos);

                        const rHandle = Math.hypot(hPos.x - pPos.x, hPos.z - pPos.z);
                        const rLeaf = Math.hypot(lPos.x - pPos.x, lPos.z - pPos.z);

                        // Angular alignment in X-Z
                        const aHandle = Math.atan2(hPos.z - pPos.z, hPos.x - pPos.x);
                        const aLeaf = Math.atan2(lPos.z - pPos.z, lPos.x - pPos.x);
                        const relAngle = Math.abs(aHandle - aLeaf);

                        angleData.push({
                            deg,
                            handleY: hPos.y,
                            rHandle,
                            rLeaf,
                            relAngle
                        });
                    });

                    return angleData;
                }, { hinge, dir, testAngles });

                recordCheck(`Kinematic angles returned for hinge=${hinge}, dir=${dir}`, Array.isArray(kinRes) && kinRes.length === 7);
                
                if (Array.isArray(kinRes)) {
                    const baseRadius = kinRes[0].rHandle;
                    kinRes.forEach(ad => {
                        // DIN 18101 height invariant: 105cm
                        recordCheck(
                            `Handle Y=105cm at ${ad.deg}° (hinge=${hinge}, dir=${dir})`,
                            Math.abs(ad.handleY - 105) < 1e-3,
                            `got ${ad.handleY}`
                        );
                        // Rigid distance invariant:
                        recordCheck(
                            `Zero radial drift at ${ad.deg}° (hinge=${hinge}, dir=${dir})`,
                            Math.abs(ad.rHandle - baseRadius) < 1e-3,
                            `diff=${Math.abs(ad.rHandle - baseRadius)}`
                        );
                        // Angular alignment invariant:
                        recordCheck(
                            `Rigid angular lock at ${ad.deg}° (hinge=${hinge}, dir=${dir})`,
                            ad.relAngle < 1e-4,
                            `relAngle=${ad.relAngle}`
                        );
                    });
                }
            }
        }

        // =========================================================================
        // TEST 5: 2D DIN 1356 Architectural CAD Symbols Across All 4 Walls
        // =========================================================================
        console.log('\n--- 5. 2D DIN 1356 Architectural CAD Symbols Across All 4 Walls ---');

        for (const wall of walls) {
            // Door symbols
            const doorSymbol = await page.evaluate((targetWall) => {
                State.room.width = 600;
                State.room.depth = 500;
                State.elements = [
                    { id: 'cad_d', type: 'door', wall: targetWall, position: 250, w: 90, h: 210, hinge: 'left', direction: 'in' }
                ];

                const canvas = document.getElementById('editorCanvas');
                const ctx = canvas.getContext('2d');
                const fillRects = [];
                const arcs = [];

                const origFR = ctx.fillRect.bind(ctx);
                const origArc = ctx.arc.bind(ctx);

                ctx.fillRect = function(...a) { fillRects.push(a); return origFR(...a); };
                ctx.arc = function(...a) { arcs.push(a); return origArc(...a); };

                Editor2D.draw();

                ctx.fillRect = origFR;
                ctx.arc = origArc;

                return {
                    hasCutout: fillRects.some(c => Math.abs(c[2] - 90) < 0.1 && Math.abs(c[3] - 11) < 0.1),
                    hasLeaf: fillRects.some(c => Math.abs(c[2] - 3.5) < 0.1 && Math.abs(c[3] - 90) < 0.1),
                    hasHingeDot: arcs.some(c => Math.abs(c[2] - 2.5) < 0.1),
                    hasSwingArc: arcs.some(c => Math.abs(c[2] - 90) < 0.1)
                };
            }, wall);

            recordCheck(`2D DIN 1356 Door cutout on ${wall}`, doorSymbol.hasCutout);
            recordCheck(`2D DIN 1356 Door solid leaf on ${wall}`, doorSymbol.hasLeaf);
            recordCheck(`2D DIN 1356 Door hinge dot on ${wall}`, doorSymbol.hasHingeDot);
            recordCheck(`2D DIN 1356 Door swing arc on ${wall}`, doorSymbol.hasSwingArc);

            // Window symbols
            const winSymbol = await page.evaluate((targetWall) => {
                State.room.width = 600;
                State.room.depth = 500;
                State.elements = [
                    { id: 'cad_w', type: 'window', wall: targetWall, position: 250, w: 120, h: 140, sillHeight: 90 }
                ];

                const canvas = document.getElementById('editorCanvas');
                const ctx = canvas.getContext('2d');
                const fillRects = [];
                const lines = [];

                const origFR = ctx.fillRect.bind(ctx);
                const origLine = ctx.lineTo.bind(ctx);

                ctx.fillRect = function(...a) { fillRects.push(a); return origFR(...a); };
                ctx.lineTo = function(...a) { lines.push(a); return origLine(...a); };

                Editor2D.draw();

                ctx.fillRect = origFR;
                ctx.lineTo = origLine;

                return {
                    hasCutout: fillRects.some(c => Math.abs(c[2] - 120) < 0.1 && Math.abs(c[3] - 11) < 0.1),
                    hasMullion: fillRects.some(c => Math.abs(c[2] - 3) < 0.1 && Math.abs(c[3] - 10) < 0.1),
                    hasExtSill: lines.some(c => Math.abs(c[0] - 63) < 0.1 && Math.abs(c[1] - (-12.5)) < 0.1),
                    hasIntSill: lines.some(c => Math.abs(c[0] - 64) < 0.1 && Math.abs(c[1] - 3) < 0.1),
                    hasGlazing1: lines.some(c => Math.abs(c[0] - 56) < 0.1 && Math.abs(c[1] - (-6.8)) < 0.1),
                    hasGlazing2: lines.some(c => Math.abs(c[0] - 56) < 0.1 && Math.abs(c[1] - (-3.2)) < 0.1)
                };
            }, wall);

            recordCheck(`2D DIN 1356 Window cutout on ${wall}`, winSymbol.hasCutout);
            recordCheck(`2D DIN 1356 Window mullion on ${wall}`, winSymbol.hasMullion);
            recordCheck(`2D DIN 1356 Window exterior sill line on ${wall}`, winSymbol.hasExtSill);
            recordCheck(`2D DIN 1356 Window interior sill line on ${wall}`, winSymbol.hasIntSill);
            recordCheck(`2D DIN 1356 Window glazing line 1 on ${wall}`, winSymbol.hasGlazing1);
            recordCheck(`2D DIN 1356 Window glazing line 2 on ${wall}`, winSymbol.hasGlazing2);
        }

    } finally {
        await env.cleanup();
    }

    // =========================================================================
    // SUMMARY
    // =========================================================================
    console.log('\n' + '='.repeat(80));
    console.log('  CHALLENGER M2 R2: SUMMARY OF EMPIRICAL ADVERSARIAL STRESS TEST');
    console.log('='.repeat(80));
    console.log(`  Total Checks:   ${totalChecks}`);
    console.log(`  Passed Checks:  ${passedChecks}`);
    console.log(`  Failed Checks:  ${failedChecks}`);
    const rate = ((passedChecks / totalChecks) * 100).toFixed(2);
    console.log(`  Success Rate:   ${rate}%`);
    console.log('='.repeat(80));
    
    if (failedChecks === 0) {
        console.log('  VERDICT: APPROVE (All empirical stress tests passed with 0 failures)\n');
        process.exit(0);
    } else {
        console.error(`  VERDICT: REQUEST_CHANGES (${failedChecks} failures detected)\n`);
        process.exit(1);
    }
}

runAdversarialVerification().catch(err => {
    console.error('Fatal execution error:', err);
    process.exit(1);
});
