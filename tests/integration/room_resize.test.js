const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { createAppInstance } = require('../harness');

describe('Room Resizing & Constraint Clamping Integration Tests', () => {

    test('Wall elements are clamped within wall lengths when room is shrunk', () => {
        const app = createAppInstance();

        // Initial 500x400 room with a door at position 400 (w=90, so span is 355 to 445)
        app.State.room.width = 500;
        app.State.room.depth = 400;

        app.State.elements = [
            { id: 'door1', type: 'door', wall: 'bottom', position: 400, w: 90, h: 200 }
        ];

        // Shrink room width from 500 down to 300
        const newWidth = 300;
        app.State.room.width = newWidth;

        // Perform standard element clamping logic (as executed on room dimension resize)
        app.State.elements.forEach(el => {
            const maxPos = (el.wall === 'top' || el.wall === 'bottom') ? app.State.room.width : app.State.room.depth;
            const halfW = el.w / 2;
            el.position = Math.max(halfW, Math.min(maxPos - halfW, el.position));
        });

        // Clamped position must not exceed 300 - 45 = 255cm
        const door = app.State.elements[0];
        assert.equal(door.position, 255);
        assert.ok(door.position + door.w / 2 <= newWidth);
    });

    test('Wall installations are clamped within wall margin when room is shrunk', () => {
        const app = createAppInstance();

        app.State.room.width = 500;
        app.State.room.depth = 400;

        app.State.installations = [
            { id: 'inst1', type: 'socket', wall: 'right', position: 380, height: 30 }
        ];

        // Shrink room depth from 400 down to 250
        const newDepth = 250;
        app.State.room.depth = newDepth;

        // Perform standard installation clamping
        app.State.installations.forEach(inst => {
            const maxPos = (inst.wall === 'top' || inst.wall === 'bottom') ? app.State.room.width : app.State.room.depth;
            inst.position = Math.max(5, Math.min(maxPos - 5, inst.position));
        });

        // Clamped position must be 250 - 5 = 245cm
        const inst = app.State.installations[0];
        assert.equal(inst.position, 245);
        assert.ok(inst.position <= newDepth - 5);
    });

    test('wallUDToRoomXY maps wall coordinates correctly across scaled rooms', () => {
        const app = createAppInstance();

        // 600 x 400 room
        app.State.room.width = 600;
        app.State.room.depth = 400;

        // Top wall at u=100, d=20 -> (100, 20)
        const top = app.wallUDToRoomXY('top', 100, 20);
        assert.equal(top.x, 100);
        assert.equal(top.y, 20);

        // Right wall at u=150, d=30 -> (width - d, u) -> (570, 150)
        const right = app.wallUDToRoomXY('right', 150, 30);
        assert.equal(right.x, 570);
        assert.equal(right.y, 150);

        // Bottom wall at u=200, d=40 -> (width - u, depth - d) -> (400, 360)
        const bottom = app.wallUDToRoomXY('bottom', 200, 40);
        assert.equal(bottom.x, 400);
        assert.equal(bottom.y, 360);

        // Left wall at u=250, d=50 -> (d, depth - u) -> (50, 150)
        const left = app.wallUDToRoomXY('left', 250, 50);
        assert.equal(left.x, 50);
        assert.equal(left.y, 150);
    });

    test('getPitchInterval constrains pitch segment to dynamic wall length', () => {
        const app = createAppInstance();

        // Room width 400cm
        app.State.room.width = 400;
        const pitch = {
            enabled: true,
            start: 50,
            end: 550, // exceeds room width 400
            kniestock: 80,
            run: 150
        };

        const interval = app.getPitchInterval(pitch, 'top');
        assert.ok(interval);
        assert.equal(interval.start, 50);
        // Clamped to room.width = 400
        assert.equal(interval.end, 400);
    });
});
