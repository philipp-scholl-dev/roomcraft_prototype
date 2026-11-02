const { spawn } = require('child_process');
const path = require('path');

const testSuites = [
    { name: 'Unit: Math & SAT Physics', path: 'tests/unit/math_physics.test.js', tier: 'Tier 1' },
    { name: 'Unit: Boundary & Clamping', path: 'tests/unit/boundary_clamping.test.js', tier: 'Tier 2' },
    { name: 'Unit: Smart Snapping & Guides', path: 'tests/unit/smart_snapping.test.js', tier: 'Tier 1' },
    { name: 'Unit: Material BOM Calculations', path: 'tests/unit/bom_calculations.test.js', tier: 'Tier 1' },
    { name: 'Unit: 3D Walkthrough & 2D Radar', path: 'tests/unit/walkthrough_mode.test.js', tier: 'Tier 1' },
    { name: 'Integration: State & Workflow', path: 'tests/integration/state_workflow.test.js', tier: 'Tier 1/3' },
    { name: 'Integration: Room Resizing', path: 'tests/integration/room_resize.test.js', tier: 'Tier 2/3' },
    { name: 'E2E Tier 1: Feature Coverage', path: 'tests/e2e/tier1_features.test.js', tier: 'Tier 1' },
    { name: 'E2E Tier 2: Boundary Cases', path: 'tests/e2e/tier2_boundaries.test.js', tier: 'Tier 2' },
    { name: 'E2E Tier 3: Combinations', path: 'tests/e2e/tier3_combinations.test.js', tier: 'Tier 3' },
    { name: 'E2E Tier 4: Real-World Scenarios', path: 'tests/e2e/tier4_scenarios.test.js', tier: 'Tier 4' },
    { name: 'E2E Tier 5: Physics & 3D Adversarial', path: 'tests/e2e/tier5_physics_3d_adversarial.test.js', tier: 'Tier 5' },
    { name: 'E2E Tier 5: UI & Workflow Adversarial', path: 'tests/e2e/tier5_ui_workflow_adversarial.test.js', tier: 'Tier 5' }
];

function runTest(suite) {
    return new Promise((resolve) => {
        const startTime = Date.now();
        const proc = spawn(process.execPath, ['--test', path.resolve(__dirname, '..', suite.path)], {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', data => { stdout += data.toString(); });
        proc.stderr.on('data', data => { stderr += data.toString(); });

        proc.on('close', code => {
            const duration = Date.now() - startTime;
            // Parse pass/fail counts from node:test output
            const passMatch = stdout.match(/ℹ pass (\d+)/);
            const failMatch = stdout.match(/ℹ fail (\d+)/);
            const passCount = passMatch ? parseInt(passMatch[1], 10) : 0;
            const failCount = failMatch ? parseInt(failMatch[1], 10) : (code !== 0 ? 1 : 0);

            resolve({
                ...suite,
                code,
                duration,
                passCount,
                failCount,
                stdout,
                stderr
            });
        });
    });
}

async function main() {
    console.log('='.repeat(80));
    console.log('  RoomCraft Unified Test Runner — Full 5-Tier Test Suite');
    console.log('='.repeat(80));
    console.log(`Node.js: ${process.version} | Platform: ${process.platform}\n`);

    const results = [];
    let totalPassed = 0;
    let totalFailed = 0;
    const globalStart = Date.now();

    for (const suite of testSuites) {
        process.stdout.write(` Running [${suite.tier}] ${suite.name} ... `);
        const res = await runTest(suite);
        results.push(res);
        totalPassed += res.passCount;
        totalFailed += res.failCount;

        if (res.code === 0 && res.failCount === 0) {
            console.log(`✓ PASS (${res.passCount} tests, ${res.duration}ms)`);
        } else {
            console.log(`✖ FAIL (${res.failCount} failed, ${res.duration}ms)`);
            if (res.stderr) console.error(res.stderr);
            if (res.stdout) console.log(res.stdout);
        }
    }

    const totalDuration = Date.now() - globalStart;

    console.log('\n' + '='.repeat(80));
    console.log('  TEST SUMMARY');
    console.log('='.repeat(80));
    console.log(` Suites Executed: ${results.length}`);
    console.log(` Total Tests:     ${totalPassed + totalFailed}`);
    console.log(` Passed:          ${totalPassed}`);
    console.log(` Failed:          ${totalFailed}`);
    console.log(` Total Time:      ${(totalDuration / 1000).toFixed(2)}s`);
    console.log('='.repeat(80));

    if (totalFailed > 0) {
        console.error('\n❌ Test suite failed with errors.');
        process.exit(1);
    } else {
        console.log('\n✨ All test suites passed successfully with 100% pass rate!');
        process.exit(0);
    }
}

main().catch(err => {
    console.error('Fatal error running tests:', err);
    process.exit(1);
});
