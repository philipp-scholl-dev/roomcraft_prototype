const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppInstance } = require('../harness');

test('Feature 12: Smart Snapping & Dynamic HUD Alignment Guides', async (t) => {
    const app = createAppInstance();
    const { SmartSnapping, CollisionEngine, State, Editor2D } = app;

    await t.test('1. Trigonometric extents calculation for rectangles and circles', () => {
        // Circle item
        const circleItem = { shape: 'circle', w: 100, l: 100, rotation: 0 };
        const circleExt = SmartSnapping.getExtents(circleItem);
        assert.equal(circleExt.halfSpanX, 50);
        assert.equal(circleExt.halfSpanY, 50);

        // Unrotated rectangle
        const rect0 = { shape: 'rect', w: 120, l: 80, rotation: 0 };
        const ext0 = SmartSnapping.getExtents(rect0);
        assert.equal(ext0.halfSpanX, 60);
        assert.equal(ext0.halfSpanY, 40);

        // 90-degree rotated rectangle
        const rect90 = { shape: 'rect', w: 120, l: 80, rotation: 90 };
        const ext90 = SmartSnapping.getExtents(rect90);
        assert.ok(Math.abs(ext90.halfSpanX - 40) < 1e-4);
        assert.ok(Math.abs(ext90.halfSpanY - 60) < 1e-4);

        // 45-degree rotated rectangle
        const rect45 = { shape: 'rect', w: 100, l: 100, rotation: 45 };
        const ext45 = SmartSnapping.getExtents(rect45);
        const expected45 = 50 * Math.SQRT2;
        assert.ok(Math.abs(ext45.halfSpanX - expected45) < 1e-4);
        assert.ok(Math.abs(ext45.halfSpanY - expected45) < 1e-4);
    });

    await t.test('2. Room centerline magnetic snapping', () => {
        const room = { width: 500, depth: 400 };
        const item = { id: 'drag1', name: 'Tisch', shape: 'rect', w: 100, l: 80, x: 254, y: 196, rotation: 0 };

        const snap = SmartSnapping.computeSnap(item, [], room, 10);
        assert.equal(snap.snappedAxes.x, true);
        assert.equal(snap.snappedAxes.y, true);
        assert.equal(snap.snappedX, 250); // room.width / 2
        assert.equal(snap.snappedY, 200); // room.depth / 2

        assert.equal(snap.guides.length, 2);
        const guideX = snap.guides.find(g => g.axis === 'x');
        const guideY = snap.guides.find(g => g.axis === 'y');
        assert.equal(guideX.snapPos, 250);
        assert.equal(guideX.label, 'Raummitte');
        assert.equal(guideY.snapPos, 200);
        assert.equal(guideY.label, 'Raummitte');
    });

    await t.test('3. Wall interior boundary snapping (flush contact)', () => {
        const room = { width: 500, depth: 400 };
        // Item with halfSpanX = 50. Left edge is at x - 50 = 55 - 50 = 5 cm from left wall (0)
        const itemNearLeft = { id: 'drag1', name: 'Schrank', shape: 'rect', w: 100, l: 60, x: 55, y: 100, rotation: 0 };
        const snapLeft = SmartSnapping.computeSnap(itemNearLeft, [], room, 10);
        assert.equal(snapLeft.snappedAxes.x, true);
        assert.equal(snapLeft.snappedX, 50); // Flush against left wall (left edge at 0)

        // Item near right wall (500). Right edge at x + 50 = 446 + 50 = 496 cm (within 10cm of 500)
        const itemNearRight = { id: 'drag1', name: 'Schrank', shape: 'rect', w: 100, l: 60, x: 446, y: 100, rotation: 0 };
        const snapRight = SmartSnapping.computeSnap(itemNearRight, [], room, 10);
        assert.equal(snapRight.snappedAxes.x, true);
        assert.equal(snapRight.snappedX, 450); // Flush against right wall (right edge at 500)

        // Top wall (0). Top edge at y - 30 = 34 - 30 = 4 cm
        const itemNearTop = { id: 'drag1', name: 'Schrank', shape: 'rect', w: 100, l: 60, x: 200, y: 34, rotation: 0 };
        const snapTop = SmartSnapping.computeSnap(itemNearTop, [], room, 10);
        assert.equal(snapTop.snappedAxes.y, true);
        assert.equal(snapTop.snappedY, 30); // Flush top (top edge at 0)

        // Bottom wall (400). Bottom edge at y + 30 = 366 + 30 = 396 cm
        const itemNearBottom = { id: 'drag1', name: 'Schrank', shape: 'rect', w: 100, l: 60, x: 200, y: 366, rotation: 0 };
        const snapBottom = SmartSnapping.computeSnap(itemNearBottom, [], room, 10);
        assert.equal(snapBottom.snappedAxes.y, true);
        assert.equal(snapBottom.snappedY, 370); // Flush bottom (bottom edge at 400)
    });

    await t.test('4. Sibling furniture alignment (center-to-center and flush edges)', () => {
        const room = { width: 500, depth: 400 };
        const sibling = { id: 'sib1', name: 'Sideboard', shape: 'rect', w: 120, l: 50, x: 180, y: 150, rotation: 0 };
        // Sibling X center: 180, left: 120, right: 240
        // Sibling Y center: 150, top: 125, bottom: 175

        // Dragging item near sibling center on X
        const dragging = { id: 'drag1', name: 'Lampe', shape: 'rect', w: 60, l: 60, x: 184, y: 300, rotation: 0 };
        const snapCenter = SmartSnapping.computeSnap(dragging, [sibling], room, 10);
        assert.equal(snapCenter.snappedAxes.x, true);
        assert.equal(snapCenter.snappedX, 180);
        assert.equal(snapCenter.guides[0].label, 'Sideboard');

        // Dragging item near sibling left edge (flush left alignment)
        // Dragging halfSpanX = 30. Left edge = x - 30. We want left edge near sibling left (120)
        const draggingLeft = { id: 'drag1', name: 'Nachttisch', shape: 'rect', w: 60, l: 60, x: 153, y: 300, rotation: 0 };
        // Left edge: 153 - 30 = 123 (distance 3 cm from 120)
        const snapLeftEdge = SmartSnapping.computeSnap(draggingLeft, [sibling], room, 10);
        assert.equal(snapLeftEdge.snappedAxes.x, true);
        assert.equal(snapLeftEdge.snappedX, 150); // 150 - 30 = 120 (flush left edge)
    });

    await t.test('5. Priority tie-breaking: Sibling > Room Center > Wall', () => {
        const room = { width: 500, depth: 400 };
        // Place a sibling at x = 250 (room center)
        const sibling = { id: 'sib1', name: 'Sofa', shape: 'rect', w: 100, l: 80, x: 250, y: 200, rotation: 0 };
        // Both sibling center and room center are at 250
        const dragging = { id: 'drag1', name: 'Tisch', shape: 'rect', w: 80, l: 80, x: 254, y: 320, rotation: 0 };
        const snap = SmartSnapping.computeSnap(dragging, [sibling], room, 10);
        assert.equal(snap.snappedX, 250);
        const guideX = snap.guides.find(g => g.axis === 'x');
        // Priority 3 (sibling) wins over Priority 2 (room-center)
        assert.equal(guideX.type, 'furniture-center');
        assert.equal(guideX.label, 'Sofa');
    });

    await t.test('6. Threshold discarding: distance > 10cm does not snap', () => {
        const room = { width: 500, depth: 400 };
        // Centerline is at 250. Proposed x is 265 (distance 15 cm > 10 cm threshold)
        const item = { id: 'drag1', name: 'Tisch', shape: 'rect', w: 100, l: 80, x: 265, y: 320, rotation: 0 };
        const snap = SmartSnapping.computeSnap(item, [], room, 10);
        assert.equal(snap.snappedAxes.x, false);
        assert.equal(snap.snappedX, 265);
        assert.equal(snap.guides.length, 0);
    });

    await t.test('7. Rotated item snapping bounds match physical envelope', () => {
        const room = { width: 500, depth: 400 };
        // 90 deg rotated rect: w=100, l=60 -> halfSpanX = 30, halfSpanY = 50
        const rotatedItem = { id: 'drag1', name: 'Bett', shape: 'rect', w: 100, l: 60, x: 34, y: 100, rotation: 90 };
        // Left edge is x - 30 = 34 - 30 = 4 cm (within 10cm of wall 0)
        const snap = SmartSnapping.computeSnap(rotatedItem, [], room, 10);
        assert.equal(snap.snappedAxes.x, true);
        assert.equal(snap.snappedX, 30); // Left edge exactly at 0
    });

    await t.test('8. Editor2D guide lifecycle: activeGuides cleared on mouseUp', () => {
        State.editor2D.activeGuides = [{ x1: 250, y1: 0, x2: 250, y2: 400, axis: 'x', label: 'Raummitte' }];
        assert.equal(State.editor2D.activeGuides.length, 1);

        Editor2D.handleMouseUp();
        assert.equal(State.editor2D.activeGuides.length, 0);
    });
});
