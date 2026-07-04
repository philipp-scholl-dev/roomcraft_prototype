/**
 * RoomCraft - Premium 2D/3D Room Planner
 * Core Application Logic
 */

// --- STATE MANAGEMENT ---
const State = {
    room: {
        width: 500,  // cm
        depth: 400,  // cm
        height: 250, // cm
        pitches: {
            top: { enabled: true, kniestock: 80, run: 150 },
            right: { enabled: false, kniestock: 80, run: 150 },
            bottom: { enabled: false, kniestock: 80, run: 150 },
            left: { enabled: false, kniestock: 80, run: 150 }
        }
    },
    furniture: [],
    elements: [],       // doors, windows, skylights
    installations: [],  // sockets, switches, etc.
    selectedItem: null, // ref to selected furniture, element, or installation
    selectedItemType: null, // 'furniture', 'element', 'installation'
    settings: {
        gridEnabled: true,
        gridSize: 10, // cm
        collisionEnabled: true,
        viewMode: '2d' // '2d', '3d', 'split'
    },
    editor2D: {
        zoom: 1.0,
        panX: 0,
        panY: 0,
        dragMode: null, // 'move', 'rotate', 'resize-w', 'resize-l', 'pan'
        draggedItem: null,
        dragStartPos: { x: 0, y: 0 },
        dragOffset: { x: 0, y: 0 },
        initialItemState: null,
        resizeHandleIndex: -1
    }
};

// --- DATA CLASS DEFINITIONS ---

class Vector2D {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }
    rotate(angle) {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        return new Vector2D(
            this.x * cos - this.y * sin,
            this.x * sin + this.y * cos
        );
    }
}

// Math helpers
function getCeilingHeightAt(x, y) {
    const room = State.room;
    let minHeight = room.height;

    // Check Top Wall Pitch (y=0 is wall, pitch goes down)
    if (room.pitches.top.enabled && y < room.pitches.top.run) {
        const h = room.pitches.top.kniestock + y * ((room.height - room.pitches.top.kniestock) / room.pitches.top.run);
        minHeight = Math.min(minHeight, h);
    }
    // Check Bottom Wall Pitch (y=depth is wall, pitch goes up)
    if (room.pitches.bottom.enabled && (room.depth - y) < room.pitches.bottom.run) {
        const dist = room.depth - y;
        const h = room.pitches.bottom.kniestock + dist * ((room.height - room.pitches.bottom.kniestock) / room.pitches.bottom.run);
        minHeight = Math.min(minHeight, h);
    }
    // Check Left Wall Pitch (x=0 is wall, pitch goes right)
    if (room.pitches.left.enabled && x < room.pitches.left.run) {
        const h = room.pitches.left.kniestock + x * ((room.height - room.pitches.left.kniestock) / room.pitches.left.run);
        minHeight = Math.min(minHeight, h);
    }
    // Check Right Wall Pitch (x=width is wall, pitch goes left)
    if (room.pitches.right.enabled && (room.width - x) < room.pitches.right.run) {
        const dist = room.width - x;
        const h = room.pitches.right.kniestock + dist * ((room.height - room.pitches.right.kniestock) / room.pitches.right.run);
        minHeight = Math.min(minHeight, h);
    }

    return Math.max(0, minHeight);
}

// Get corners of a rectangle furniture rotated around center
function getFurnitureCorners(f) {
    if (f.shape !== 'rect') return [];
    const rad = (f.rotation * Math.PI) / 180;
    const halfW = f.w / 2;
    const halfL = f.l / 2;

    const localCorners = [
        new Vector2D(-halfW, -halfL),
        new Vector2D(halfW, -halfL),
        new Vector2D(halfW, halfL),
        new Vector2D(-halfW, halfL)
    ];

    return localCorners.map(c => {
        const r = c.rotate(rad);
        return new Vector2D(f.x + r.x, f.y + r.y);
    });
}

// --- COLLISION ENGINE ---
const CollisionEngine = {
    // Oriented Bounding Box collision detection using Separating Axis Theorem (SAT)
    checkOBBvsOBB(cornersA, cornersB) {
        const axes = [
            // Normals of A
            new Vector2D(-(cornersA[1].y - cornersA[0].y), cornersA[1].x - cornersA[0].x),
            new Vector2D(-(cornersA[2].y - cornersA[1].y), cornersA[2].x - cornersA[1].x),
            // Normals of B
            new Vector2D(-(cornersB[1].y - cornersB[0].y), cornersB[1].x - cornersB[0].x),
            new Vector2D(-(cornersB[2].y - cornersB[1].y), cornersB[2].x - cornersB[1].x)
        ];

        for (let axis of axes) {
            // Normalize axis
            const len = Math.sqrt(axis.x * axis.x + axis.y * axis.y);
            if (len === 0) continue;
            axis.x /= len;
            axis.y /= len;

            // Project A
            let minA = Infinity, maxA = -Infinity;
            for (let p of cornersA) {
                const proj = p.x * axis.x + p.y * axis.y;
                minA = Math.min(minA, proj);
                maxA = Math.max(maxA, proj);
            }

            // Project B
            let minB = Infinity, maxB = -Infinity;
            for (let p of cornersB) {
                const proj = p.x * axis.x + p.y * axis.y;
                minB = Math.min(minB, proj);
                maxB = Math.max(maxB, proj);
            }

            // Test overlap
            if (maxA < minB || maxB < minA) {
                return false; // Gap found, no collision
            }
        }
        return true; // Overlap on all axes, collision
    },

    checkCircleVsCircle(c1, r1, c2, r2) {
        const dx = c1.x - c2.x;
        const dy = c1.y - c2.y;
        const distSq = dx * dx + dy * dy;
        const radSum = r1 + r2;
        return distSq < radSum * radSum;
    },

    checkCircleVsOBB(circleCenter, r, rectCenter, w, l, rotationDeg) {
        // Transform circle to rect's local space
        const rad = (-rotationDeg * Math.PI) / 180;
        const dx = circleCenter.x - rectCenter.x;
        const dy = circleCenter.y - rectCenter.y;
        
        // Rotate local offset
        const localX = dx * Math.cos(rad) - dy * Math.sin(rad);
        const localY = dx * Math.sin(rad) + dy * Math.cos(rad);

        // Find closest point on unrotated rect to local circle center
        const closestX = Math.max(-w/2, Math.min(w/2, localX));
        const closestY = Math.max(-l/2, Math.min(l/2, localY));

        // Distance in local space
        const diffX = localX - closestX;
        const diffY = localY - closestY;
        const distSq = diffX * diffX + diffY * diffY;

        return distSq < r * r;
    },

    checkFurnitureCollision(f1, f2) {
        if (f1.shape === 'rect' && f2.shape === 'rect') {
            return this.checkOBBvsOBB(getFurnitureCorners(f1), getFurnitureCorners(f2));
        } else if (f1.shape === 'circle' && f2.shape === 'circle') {
            return this.checkCircleVsCircle({ x: f1.x, y: f1.y }, f1.w / 2, { x: f2.x, y: f2.y }, f2.w / 2);
        } else {
            // One rect, one circle
            const rect = f1.shape === 'rect' ? f1 : f2;
            const circle = f1.shape === 'circle' ? f1 : f2;
            return this.checkCircleVsOBB(
                { x: circle.x, y: circle.y },
                circle.w / 2,
                { x: rect.x, y: rect.y },
                rect.w,
                rect.l,
                rect.rotation
            );
        }
    },

    checkWallCollision(f) {
        const room = State.room;
        if (f.shape === 'circle') {
            const r = f.w / 2;
            return (f.x - r < 0 || f.x + r > room.width || f.y - r < 0 || f.y + r > room.depth);
        } else {
            // Rectangle: check all 4 corners
            const corners = getFurnitureCorners(f);
            for (let c of corners) {
                if (c.x < 0 || c.x > room.width || c.y < 0 || c.y > room.depth) {
                    return true;
                }
            }
        }
        return false;
    },

    checkRoofPitchCollision(f) {
        // For a piece of furniture, check if its height exceeds the ceiling height at any footprint point
        if (f.shape === 'circle') {
            // For a circle, check the center and 4 perimeter points
            const r = f.w / 2;
            const pointsToCheck = [
                { x: f.x, y: f.y },
                { x: f.x - r, y: f.y },
                { x: f.x + r, y: f.y },
                { x: f.x, y: f.y - r },
                { x: f.x, y: f.y + r }
            ];
            for (let p of pointsToCheck) {
                const ceilH = getCeilingHeightAt(p.x, p.y);
                if (f.h > ceilH) return true;
            }
        } else {
            // For a rectangle, check corners and center
            const corners = getFurnitureCorners(f);
            corners.push(new Vector2D(f.x, f.y)); // add center
            
            // For long furniture, also check midpoint of edges
            if (corners.length >= 4) {
                corners.push(new Vector2D((corners[0].x + corners[1].x) / 2, (corners[0].y + corners[1].y) / 2));
                corners.push(new Vector2D((corners[1].x + corners[2].x) / 2, (corners[1].y + corners[2].y) / 2));
                corners.push(new Vector2D((corners[2].x + corners[3].x) / 2, (corners[2].y + corners[3].y) / 2));
                corners.push(new Vector2D((corners[3].x + corners[0].x) / 2, (corners[3].y + corners[0].y) / 2));
            }

            for (let p of corners) {
                const ceilH = getCeilingHeightAt(p.x, p.y);
                if (f.h > ceilH) return true;
            }
        }
        return false;
    },

    updateAllCollisions() {
        if (!State.settings.collisionEnabled) {
            State.furniture.forEach(f => f.isColliding = false);
            return false;
        }

        let anyCollision = false;

        // Reset
        State.furniture.forEach(f => f.isColliding = false);

        // Check Furniture vs Furniture
        for (let i = 0; i < State.furniture.length; i++) {
            const f1 = State.furniture[i];
            if (!f1.collisionEnabled) continue;

            // Check vs wall boundaries
            if (this.checkWallCollision(f1)) {
                f1.isColliding = true;
                anyCollision = true;
            }

            // Check vs roof pitches
            if (this.checkRoofPitchCollision(f1)) {
                f1.isColliding = true;
                anyCollision = true;
            }

            for (let j = i + 1; j < State.furniture.length; j++) {
                const f2 = State.furniture[j];
                if (!f2.collisionEnabled) continue;

                if (this.checkFurnitureCollision(f1, f2)) {
                    f1.isColliding = true;
                    f2.isColliding = true;
                    anyCollision = true;
                }
            }
        }

        // Show/hide collision badge
        const badge = document.getElementById('collision-alert');
        if (badge) {
            if (anyCollision) badge.classList.remove('hidden');
            else badge.classList.add('hidden');
        }

        return anyCollision;
    }
};

// --- WALL PROJECTION FOR WALL ELEMENTS ---
function projectToWall(mx, my) {
    const room = State.room;
    
    // Distances to the 4 walls
    const dTop = my;
    const dBottom = room.depth - my;
    const dLeft = mx;
    const dRight = room.width - mx;
    
    const minDist = Math.min(dTop, dBottom, dLeft, dRight);
    
    if (minDist === dTop) {
        return { wall: 'top', position: Math.max(0, Math.min(room.width, mx)) };
    } else if (minDist === dRight) {
        return { wall: 'right', position: Math.max(0, Math.min(room.depth, my)) };
    } else if (minDist === dBottom) {
        // south wall runs right-to-left
        return { wall: 'bottom', position: Math.max(0, Math.min(room.width, room.width - mx)) };
    } else {
        // west wall runs bottom-to-top
        return { wall: 'left', position: Math.max(0, Math.min(room.depth, room.depth - my)) };
    }
}

// Get global (x, y) coordinates of an item snapped to a wall
function getWallCoordinates(wall, position) {
    const room = State.room;
    switch (wall) {
        case 'top': return { x: position, y: 0, angle: 0 };
        case 'right': return { x: room.width, y: position, angle: Math.PI / 2 };
        case 'bottom': return { x: room.width - position, y: room.depth, angle: Math.PI };
        case 'left': return { x: 0, y: room.depth - position, angle: -Math.PI / 2 };
    }
}

// Helper to check if mouse is hovering over a wall element along its width
function isMouseOverWallElement(elem, m) {
    const coords = getWallCoordinates(elem.wall, elem.position);
    const halfW = elem.w / 2;
    
    // Transform mouse to local coordinate space of the wall segment
    const dx = m.x - coords.x;
    const dy = m.y - coords.y;
    const rad = -coords.angle;
    const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
    
    // lx is along the wall (from -halfW to halfW)
    // ly is normal to the wall (positive ly goes inwards of the room)
    
    if (elem.type === 'door') {
        const dir = elem.direction || 'in';
        const isIn = dir === 'in';
        
        const inX = Math.abs(lx) <= halfW + 10;
        const inY = isIn 
            ? (ly >= -10 && ly <= elem.w + 10) 
            : (ly >= -elem.w - 10 && ly <= 10);
            
        return inX && inY;
    } else if (elem.type === 'window') {
        return Math.abs(lx) <= halfW + 10 && Math.abs(ly) <= 20;
    } else if (elem.type === 'skylight') {
        const dist = elem.distanceFromWall || 60;
        const halfL = elem.h / 2;
        // Skylight is centered at local y = dist
        return Math.abs(lx) <= halfW + 10 && ly >= dist - halfL - 10 && ly <= dist + halfL + 10;
    }
    return false;
}

// --- 2D EDITOR DRAWING ---
const Editor2D = {
    canvas: null,
    ctx: null,
    
    init() {
        this.canvas = document.getElementById('editorCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
        
        // Mouse / Touch Event Listeners
        this.canvas.addEventListener('mousedown', e => this.handleMouseDown(e));
        this.canvas.addEventListener('mousemove', e => this.handleMouseMove(e));
        this.canvas.addEventListener('mouseup', e => this.handleMouseUp(e));
        this.canvas.addEventListener('wheel', e => this.handleWheel(e), { passive: false });
        
        // Key listener for deletion
        window.addEventListener('keydown', e => {
            if (e.key === 'Delete' || e.key === 'Backspace') {
                // Only delete if we are not typing in an input
                if (document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'SELECT') {
                    this.deleteSelected();
                }
            }
        });
    },
    
    resizeCanvas() {
        const wrapper = this.canvas.parentElement;
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = wrapper.clientWidth * dpr;
        this.canvas.height = wrapper.clientHeight * dpr;
        this.canvas.style.width = wrapper.clientWidth + 'px';
        this.canvas.style.height = wrapper.clientHeight + 'px';
        this.ctx.scale(dpr, dpr);
        
        // Auto-center room
        if (State.editor2D.zoom === 1.0 && State.editor2D.panX === 0) {
            this.resetView();
        } else {
            this.draw();
        }
    },
    
    resetView() {
        const wrapper = this.canvas.parentElement;
        const padding = 60; // pixels
        const scaleX = (wrapper.clientWidth - padding * 2) / State.room.width;
        const scaleY = (wrapper.clientHeight - padding * 2) / State.room.depth;
        
        State.editor2D.zoom = Math.min(scaleX, scaleY, 1.5);
        State.editor2D.panX = (wrapper.clientWidth - State.room.width * State.editor2D.zoom) / 2;
        State.editor2D.panY = (wrapper.clientHeight - State.room.depth * State.editor2D.zoom) / 2;
        this.draw();
    },
    
    // Coordinate conversions
    worldToScreen(x, y) {
        return {
            x: x * State.editor2D.zoom + State.editor2D.panX,
            y: y * State.editor2D.zoom + State.editor2D.panY
        };
    },
    
    screenToWorld(sx, sy) {
        return {
            x: (sx - State.editor2D.panX) / State.editor2D.zoom,
            y: (sy - State.editor2D.panY) / State.editor2D.zoom
        };
    },
    
    draw() {
        if (!this.canvas) return;
        const ctx = this.ctx;
        const w = this.canvas.width / (window.devicePixelRatio || 1);
        const h = this.canvas.height / (window.devicePixelRatio || 1);
        
        // Clear
        ctx.fillStyle = '#0b0f19'; // App background
        ctx.fillRect(0, 0, w, h);
        
        ctx.save();
        ctx.translate(State.editor2D.panX, State.editor2D.panY);
        ctx.scale(State.editor2D.zoom, State.editor2D.zoom);
        
        // 1. Draw Grid
        if (State.settings.gridEnabled) {
            this.drawGrid(ctx);
        }
        
        // 2. Draw Roof Pitches area representation (shaded boundaries)
        this.drawRoofPitches(ctx);

        // 3. Draw Room Boundaries (Walls)
        this.drawWalls(ctx);
        
        // 4. Draw Wall Elements (Doors & Windows)
        this.drawWallElements(ctx);
        
        // 5. Draw Installations (Sockets, Switches)
        this.drawInstallations(ctx);
        
        // 6. Draw Furniture
        this.drawFurniture(ctx);
        
        ctx.restore();
    },
    
    drawGrid(ctx) {
        const room = State.room;
        const step = 10; // Major lines every 50cm, minor every 10cm
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
        ctx.lineWidth = 0.5;
        
        // Grid vertical lines
        for (let x = 0; x <= room.width; x += step) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, room.depth);
            if (x % 50 === 0) {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
                ctx.lineWidth = 1.0;
            } else {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
                ctx.lineWidth = 0.5;
            }
            ctx.stroke();
        }
        
        // Grid horizontal lines
        for (let y = 0; y <= room.depth; y += step) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(room.width, y);
            if (y % 50 === 0) {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
                ctx.lineWidth = 1.0;
            } else {
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
                ctx.lineWidth = 0.5;
            }
            ctx.stroke();
        }
    },
    
    drawRoofPitches(ctx) {
        const room = State.room;
        ctx.fillStyle = 'rgba(139, 92, 246, 0.04)'; // Light purple tint
        ctx.strokeStyle = 'rgba(139, 92, 246, 0.15)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);

        const drawHatching = (x1, y1, x2, y2, angleRad, step = 12) => {
            ctx.save();
            // Create a clipping region
            ctx.beginPath();
            ctx.rect(x1, y1, x2 - x1, y2 - y1);
            ctx.clip();

            ctx.beginPath();
            // Shading lines
            if (angleRad === 0 || angleRad === Math.PI) { // Top/Bottom wall
                for (let x = x1 - 100; x < x2 + 100; x += step) {
                    ctx.moveTo(x, y1);
                    ctx.lineTo(x + (y2 - y1), y2);
                }
            } else { // Left/Right wall
                for (let y = y1 - 100; y < y2 + 100; y += step) {
                    ctx.moveTo(x1, y);
                    ctx.lineTo(x2, y + (x2 - x1));
                }
            }
            ctx.stroke();
            ctx.restore();
        };

        // Top Wall Pitch
        if (room.pitches.top.enabled) {
            ctx.fillRect(0, 0, room.width, room.pitches.top.run);
            ctx.beginPath();
            ctx.moveTo(0, room.pitches.top.run);
            ctx.lineTo(room.width, room.pitches.top.run);
            ctx.stroke();
            drawHatching(0, 0, room.width, room.pitches.top.run, 0);
        }
        
        // Bottom Wall Pitch
        if (room.pitches.bottom.enabled) {
            const startY = room.depth - room.pitches.bottom.run;
            ctx.fillRect(0, startY, room.width, room.pitches.bottom.run);
            ctx.beginPath();
            ctx.moveTo(0, startY);
            ctx.lineTo(room.width, startY);
            ctx.stroke();
            drawHatching(0, startY, room.width, room.depth, Math.PI);
        }

        // Left Wall Pitch
        if (room.pitches.left.enabled) {
            ctx.fillRect(0, 0, room.pitches.left.run, room.depth);
            ctx.beginPath();
            ctx.moveTo(room.pitches.left.run, 0);
            ctx.lineTo(room.pitches.left.run, room.depth);
            ctx.stroke();
            drawHatching(0, 0, room.pitches.left.run, room.depth, Math.PI/2);
        }

        // Right Wall Pitch
        if (room.pitches.right.enabled) {
            const startX = room.width - room.pitches.right.run;
            ctx.fillRect(startX, 0, room.pitches.right.run, room.depth);
            ctx.beginPath();
            ctx.moveTo(startX, 0);
            ctx.lineTo(startX, room.depth);
            ctx.stroke();
            drawHatching(startX, 0, room.width, room.depth, -Math.PI/2);
        }
        
        ctx.setLineDash([]);
    },
    
    drawWalls(ctx) {
        const room = State.room;
        ctx.strokeStyle = '#334155'; // Slate wall border
        ctx.lineWidth = 6;
        ctx.lineJoin = 'miter';
        ctx.strokeRect(0, 0, room.width, room.depth);
    },
    
    drawWallElements(ctx) {
        State.elements.forEach(elem => {
            const coords = getWallCoordinates(elem.wall, elem.position);
            const isSelected = State.selectedItem === elem;
            
            ctx.save();
            ctx.translate(coords.x, coords.y);
            ctx.rotate(coords.angle);
            
            // Center element alignment locally
            const halfW = elem.w / 2;
            
            if (elem.type === 'door') {
                const hinge = elem.hinge || 'left';
                const dir = elem.direction || 'in';
                const isLeft = hinge === 'left';
                const isIn = dir === 'in';
                
                const hX = isLeft ? -halfW : halfW;
                const leafY = isIn ? elem.w : -elem.w; // Inwards is local +y, Outwards is local -y
                const anticlockwise = isLeft ? !isIn : isIn;
                
                // Draw door swing arc
                ctx.strokeStyle = isSelected ? 'hsl(263, 85%, 65%)' : 'rgba(245, 158, 11, 0.4)';
                ctx.lineWidth = 1.5;
                ctx.setLineDash([2, 2]);
                ctx.beginPath();
                ctx.arc(hX, 0, elem.w, isLeft ? 0 : Math.PI, isIn ? Math.PI / 2 : -Math.PI / 2, anticlockwise);
                ctx.stroke();
                ctx.setLineDash([]);
                
                // Draw open door leaf
                ctx.strokeStyle = isSelected ? 'hsl(263, 85%, 65%)' : 'hsl(38, 92%, 50%)';
                ctx.lineWidth = 3.5;
                ctx.beginPath();
                ctx.moveTo(hX, 0);
                ctx.lineTo(hX, leafY);
                ctx.stroke();
                
                // Draw clear opening on wall
                ctx.strokeStyle = '#0b0f19'; // App background to overlap wall line
                ctx.lineWidth = 7;
                ctx.beginPath();
                ctx.moveTo(-halfW, 0);
                ctx.lineTo(halfW, 0);
                ctx.stroke();
                
                // Draw wall frames
                ctx.fillStyle = '#64748b';
                ctx.fillRect(-halfW - 2, -3, 4, 6);
                ctx.fillRect(halfW - 2, -3, 4, 6);
                
            } else if (elem.type === 'window') {
                // Clear wall below window
                ctx.strokeStyle = '#0b0f19';
                ctx.lineWidth = 7;
                ctx.beginPath();
                ctx.moveTo(-halfW, 0);
                ctx.lineTo(halfW, 0);
                ctx.stroke();
                
                // Draw blue window lines
                ctx.strokeStyle = isSelected ? 'hsl(263, 85%, 65%)' : 'hsl(199, 89%, 48%)';
                ctx.lineWidth = 2.5;
                ctx.strokeRect(-halfW, -3, elem.w, 6);
                
                ctx.fillStyle = isSelected ? 'rgba(139, 92, 246, 0.2)' : 'rgba(56, 189, 248, 0.2)';
                ctx.fillRect(-halfW, -3, elem.w, 6);
                
                // Middle window pane divider
                ctx.strokeStyle = 'white';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(-halfW, 0);
                ctx.lineTo(halfW, 0);
                ctx.stroke();
            } else if (elem.type === 'skylight') {
                // Skylight is in a roof pitch. Drawn floating near the wall in 2D
                // Its coordinates are computed based on pitch direction
                // Lets draw it as a dashed blue outline at the specified distance from wall
                // We'll restore rotation first and compute real position
                ctx.restore();
                ctx.save();
                
                const dist = elem.distanceFromWall || 60;
                let sx = coords.x;
                let sy = coords.y;
                
                // Offset normal to wall inwards
                if (elem.wall === 'top') sy += dist;
                else if (elem.wall === 'right') sx -= dist;
                else if (elem.wall === 'bottom') sy -= dist;
                else if (elem.wall === 'left') sx += dist;
                
                ctx.translate(sx, sy);
                ctx.rotate(coords.angle);
                
                ctx.strokeStyle = isSelected ? 'hsl(263, 85%, 65%)' : 'rgba(139, 92, 246, 0.8)';
                ctx.lineWidth = 2;
                ctx.setLineDash([3, 2]);
                ctx.strokeRect(-halfW, -elem.h/2, elem.w, elem.h);
                ctx.setLineDash([]);
                
                ctx.fillStyle = isSelected ? 'rgba(139, 92, 246, 0.25)' : 'rgba(139, 92, 246, 0.1)';
                ctx.fillRect(-halfW, -elem.h/2, elem.w, elem.h);
                
                // Draw an X to represent skylight glass division
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
                ctx.beginPath();
                ctx.moveTo(-halfW, -elem.h/2); ctx.lineTo(halfW, elem.h/2);
                ctx.moveTo(halfW, -elem.h/2); ctx.lineTo(-halfW, elem.h/2);
                ctx.stroke();
                
                // Label
                ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
                ctx.font = '8px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('DF', 0, 3);
            }
            
            ctx.restore();
        });
    },
    
    drawInstallations(ctx) {
        State.installations.forEach(inst => {
            const coords = getWallCoordinates(inst.wall, inst.position);
            const isSelected = State.selectedItem === inst;
            
            ctx.save();
            ctx.translate(coords.x, coords.y);
            ctx.rotate(coords.angle);
            
            // Shift slightly inside the room so it sits visible on wall
            ctx.translate(0, 5);
            
            // Draw Icon/Symbol
            ctx.strokeStyle = isSelected ? 'hsl(263, 85%, 65%)' : '#94a3b8';
            ctx.lineWidth = 1;
            
            switch (inst.type) {
                case 'socket':
                    ctx.fillStyle = isSelected ? 'hsl(263, 70%, 55%)' : '#e2e8f0';
                    ctx.beginPath();
                    ctx.arc(0, 0, 5, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                    // two small black dots inside
                    ctx.fillStyle = '#0b0f19';
                    ctx.fillRect(-2, -1, 1, 2);
                    ctx.fillRect(1, -1, 1, 2);
                    break;
                case 'switch':
                    ctx.fillStyle = isSelected ? 'hsl(263, 70%, 55%)' : '#f8fafc';
                    ctx.strokeRect(-4, -4, 8, 8);
                    ctx.fillRect(-3, -3, 6, 6);
                    ctx.strokeStyle = '#0b0f19';
                    ctx.beginPath();
                    ctx.arc(0, 0, 2, 0, Math.PI * 2);
                    ctx.stroke();
                    break;
                case 'lan':
                    ctx.fillStyle = isSelected ? 'hsl(263, 70%, 55%)' : '#38bdf8';
                    ctx.fillRect(-5, -5, 10, 10);
                    ctx.strokeRect(-5, -5, 10, 10);
                    ctx.fillStyle = 'white';
                    ctx.font = 'bold 7px Outfit';
                    ctx.textAlign = 'center';
                    ctx.fillText('L', 0, 2.5);
                    break;
                case 'sat':
                    ctx.fillStyle = isSelected ? 'hsl(263, 70%, 55%)' : '#818cf8';
                    ctx.beginPath();
                    ctx.moveTo(0, -6);
                    ctx.lineTo(5, 3);
                    ctx.lineTo(-5, 3);
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();
                    ctx.fillStyle = 'white';
                    ctx.font = 'bold 6px Outfit';
                    ctx.textAlign = 'center';
                    ctx.fillText('S', 0, 2);
                    break;
                case 'power':
                    ctx.fillStyle = isSelected ? 'hsl(263, 70%, 55%)' : '#f43f5e';
                    ctx.beginPath();
                    ctx.arc(0, 0, 6, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                    ctx.fillStyle = 'white';
                    ctx.font = 'bold 6px Outfit';
                    ctx.textAlign = 'center';
                    ctx.fillText('3~', 0, 2);
                    break;
            }
            
            ctx.restore();
        });
    },
    
    drawFurniture(ctx) {
        State.furniture.forEach(f => {
            const isSelected = State.selectedItem === f;
            
            ctx.save();
            ctx.translate(f.x, f.y);
            ctx.rotate((f.rotation * Math.PI) / 180);
            
            // Base styling based on status
            let fillColor = f.color || 'hsl(263, 50%, 40%)';
            let strokeColor = isSelected ? 'white' : 'rgba(255, 255, 255, 0.4)';
            let strokeWidth = isSelected ? 2.5 : 1.2;
            
            if (f.isColliding) {
                fillColor = 'rgba(239, 68, 68, 0.35)'; // Red overlay
                strokeColor = '#ef4444';
                strokeWidth = isSelected ? 3 : 2;
            }
            
            ctx.fillStyle = fillColor;
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = strokeWidth;
            
            // Draw Shape
            if (f.shape === 'circle') {
                const r = f.w / 2;
                ctx.beginPath();
                ctx.arc(0, 0, r, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                
                // Direction line inside circle
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(0, -r);
                ctx.stroke();
            } else {
                // Rectangle
                ctx.fillRect(-f.w / 2, -f.l / 2, f.w, f.l);
                
                // Cross hatch pattern for chimney/obstacle
                if (f.isObstacle) {
                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(-f.w / 2, -f.l / 2, f.w, f.l);
                    ctx.clip();
                    
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
                    ctx.lineWidth = 1.0;
                    const step = 15;
                    const limit = Math.max(f.w, f.l);
                    for (let k = -limit * 2; k < limit * 2; k += step) {
                        // Line /
                        ctx.beginPath();
                        ctx.moveTo(k, -f.l / 2);
                        ctx.lineTo(k + f.l, f.l / 2);
                        ctx.stroke();
                        
                        // Line \
                        ctx.beginPath();
                        ctx.moveTo(k, f.l / 2);
                        ctx.lineTo(k + f.l, -f.l / 2);
                        ctx.stroke();
                    }
                    ctx.restore();
                }
                
                ctx.strokeRect(-f.w / 2, -f.l / 2, f.w, f.l);
                
                // Draw face direction line (e.g. front of wardrobe/sofa)
                if (!f.isObstacle) {
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
                    ctx.fillRect(-f.w / 2, -f.l / 2, f.w, 4); // Front edge indicator
                }
            }
            
            // Draw Text Label (Name & dimensions)
            ctx.fillStyle = f.isColliding ? '#fecaca' : '#f8fafc';
            ctx.font = '10px Plus Jakarta Sans, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            // Rotate label text upright if upside down, or just keep relative
            ctx.fillText(f.name || 'Möbel', 0, -4);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.font = '8px Outfit';
            ctx.fillText(`${f.w}x${f.l}x${f.h}`, 0, 8);
            
            // Draw Handles if selected
            if (isSelected) {
                this.drawSelectionHandles(ctx, f);
            }
            
            ctx.restore();
        });
    },
    
    drawSelectionHandles(ctx, f) {
        const halfW = f.w / 2;
        const halfL = f.l / 2;
        
        // 1. Rotation handle (a stem going up with a circle)
        ctx.strokeStyle = 'hsl(263, 85%, 65%)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, -halfL);
        ctx.lineTo(0, -halfL - 25);
        ctx.stroke();
        
        ctx.fillStyle = 'hsl(263, 70%, 55%)';
        ctx.beginPath();
        ctx.arc(0, -halfL - 25, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        
        // 2. Resizing handle corners (only for rectangles)
        if (f.shape === 'rect') {
            ctx.fillStyle = 'white';
            ctx.strokeStyle = 'hsl(263, 70%, 55%)';
            ctx.lineWidth = 1;
            
            // Edge Midpoints for scaling
            const edgeHandles = [
                { x: halfW, y: 0, cursor: 'ew-resize', index: 0 },   // East/Right
                { x: 0, y: halfL, cursor: 'ns-resize', index: 1 }    // South/Bottom
            ];
            
            edgeHandles.forEach(h => {
                ctx.beginPath();
                ctx.arc(h.x, h.y, 4.5, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            });
        }
    },
    
    // --- MOUSE & INTERACTION LOGIC ---
    handleMouseDown(e) {
        const rect = this.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const m = this.screenToWorld(sx, sy);
        
        // 1. Check if clicked on selected item handles
        if (State.selectedItem && State.selectedItemType === 'furniture') {
            const f = State.selectedItem;
            const rad = (f.rotation * Math.PI) / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            
            // Check rotation handle
            // Local pos of rot handle: (0, -f.l/2 - 25)
            const rotHandleLocal = new Vector2D(0, -f.l/2 - 25).rotate(rad);
            const rotHandleWorld = new Vector2D(f.x + rotHandleLocal.x, f.y + rotHandleLocal.y);
            const distRot = Math.hypot(m.x - rotHandleWorld.x, m.y - rotHandleWorld.y);
            
            if (distRot < 10) {
                State.editor2D.dragMode = 'rotate';
                State.editor2D.draggedItem = f;
                State.editor2D.dragStartPos = { x: m.x, y: m.y };
                State.editor2D.initialItemState = { rotation: f.rotation };
                return;
            }
            
            // Check resize handles (only rect)
            if (f.shape === 'rect') {
                const rightHandleLocal = new Vector2D(f.w/2, 0).rotate(rad);
                const rightHandleWorld = new Vector2D(f.x + rightHandleLocal.x, f.y + rightHandleLocal.y);
                const bottomHandleLocal = new Vector2D(0, f.l/2).rotate(rad);
                const bottomHandleWorld = new Vector2D(f.x + bottomHandleLocal.x, f.y + bottomHandleLocal.y);
                
                if (Math.hypot(m.x - rightHandleWorld.x, m.y - rightHandleWorld.y) < 8) {
                    State.editor2D.dragMode = 'resize-w';
                    State.editor2D.draggedItem = f;
                    State.editor2D.initialItemState = { w: f.w, l: f.l, x: f.x, y: f.y };
                    return;
                }
                if (Math.hypot(m.x - bottomHandleWorld.x, m.y - bottomHandleWorld.y) < 8) {
                    State.editor2D.dragMode = 'resize-l';
                    State.editor2D.draggedItem = f;
                    State.editor2D.initialItemState = { w: f.w, l: f.l, x: f.x, y: f.y };
                    return;
                }
            }
        }
        
        // 2. Check if clicked on any furniture
        for (let i = State.furniture.length - 1; i >= 0; i--) {
            const f = State.furniture[i];
            let clicked = false;
            
            if (f.shape === 'circle') {
                const dist = Math.hypot(m.x - f.x, m.y - f.y);
                clicked = dist < f.w / 2;
            } else {
                // Transform click to local rect coords
                const rad = (-f.rotation * Math.PI) / 180;
                const dx = m.x - f.x;
                const dy = m.y - f.y;
                const localX = dx * Math.cos(rad) - dy * Math.sin(rad);
                const localY = dx * Math.sin(rad) + dy * Math.cos(rad);
                clicked = Math.abs(localX) < f.w / 2 && Math.abs(localY) < f.l / 2;
            }
            
            if (clicked) {
                selectItem(f, 'furniture');
                State.editor2D.dragMode = 'move';
                State.editor2D.draggedItem = f;
                State.editor2D.dragStartPos = { x: f.x, y: f.y };
                State.editor2D.dragOffset = { x: m.x - f.x, y: m.y - f.y };
                State.editor2D.initialItemState = { x: f.x, y: f.y };
                this.draw();
                return;
            }
        }
        
        // 3. Check if clicked on wall elements
        for (let elem of State.elements) {
            if (isMouseOverWallElement(elem, m)) {
                selectItem(elem, 'element');
                State.editor2D.dragMode = 'move-wall-item';
                State.editor2D.draggedItem = elem;
                this.draw();
                return;
            }
        }
        
        // 4. Check if clicked on installations
        for (let inst of State.installations) {
            const coords = getWallCoordinates(inst.wall, inst.position);
            const dist = Math.hypot(m.x - coords.x, m.y - coords.y);
            if (dist < 20) { // increased click radius for easier selection
                selectItem(inst, 'installation');
                State.editor2D.dragMode = 'move-wall-item';
                State.editor2D.draggedItem = inst;
                this.draw();
                return;
            }
        }
        
        // 5. Otherwise, start pan mode
        State.editor2D.dragMode = 'pan';
        State.editor2D.dragStartPos = { x: sx, y: sy };
        State.editor2D.dragOffset = { x: State.editor2D.panX, y: State.editor2D.panY };
    },
    
    handleMouseMove(e) {
        if (!State.editor2D.dragMode) {
            this.updateCursor(e);
            return;
        }
        
        const rect = this.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const m = this.screenToWorld(sx, sy);
        
        const f = State.editor2D.draggedItem;
        
        if (State.editor2D.dragMode === 'move') {
            // Drag furniture
            let newX = m.x - State.editor2D.dragOffset.x;
            let newY = m.y - State.editor2D.dragOffset.y;
            
            // Grid Snapping
            if (State.settings.gridEnabled) {
                const step = State.settings.gridSize;
                newX = Math.round(newX / step) * step;
                newY = Math.round(newY / step) * step;
            }
            
            const prevX = f.x;
            const prevY = f.y;
            f.x = newX;
            f.y = newY;
            
            // Update collision checks
            CollisionEngine.updateAllCollisions();
            
            // If collision blocking is preferred (optional - standard now highlights red and allows movement)
            
            this.draw();
            syncPropertiesPanel();
            if (Viewer3D.renderer) Viewer3D.updateFurniture3D(f);
            
        } else if (State.editor2D.dragMode === 'rotate') {
            // Rotate furniture
            // Calculate angle from furniture center to mouse
            const dx = m.x - f.x;
            const dy = m.y - f.y;
            let angle = Math.atan2(dy, dx) + Math.PI / 2; // offset so 0 is up
            
            let angleDeg = (angle * 180) / Math.PI;
            if (angleDeg < 0) angleDeg += 360;
            
            // Snapping to 15 degrees if grid is active
            if (State.settings.gridEnabled) {
                angleDeg = Math.round(angleDeg / 15) * 15;
            }
            
            f.rotation = angleDeg % 360;
            CollisionEngine.updateAllCollisions();
            this.draw();
            syncPropertiesPanel();
            if (Viewer3D.renderer) Viewer3D.updateFurniture3D(f);
            
        } else if (State.editor2D.dragMode === 'resize-w') {
            // Resize rectangle width (right edge handle)
            // Transform mouse coordinate to local coordinates of furniture
            const rad = (-f.rotation * Math.PI) / 180;
            const dx = m.x - f.x;
            const dy = m.y - f.y;
            const localX = dx * Math.cos(rad) - dy * Math.sin(rad);
            
            // Width is double the local X offset
            let newW = Math.max(20, Math.round(localX * 2));
            if (State.settings.gridEnabled) {
                newW = Math.round(newW / 10) * 10;
            }
            f.w = newW;
            
            CollisionEngine.updateAllCollisions();
            this.draw();
            syncPropertiesPanel();
            if (Viewer3D.renderer) Viewer3D.updateFurniture3D(f);
            
        } else if (State.editor2D.dragMode === 'resize-l') {
            // Resize rectangle length/depth (bottom edge handle)
            const rad = (-f.rotation * Math.PI) / 180;
            const dx = m.x - f.x;
            const dy = m.y - f.y;
            const localY = dx * Math.sin(rad) + dy * Math.cos(rad);
            
            let newL = Math.max(20, Math.round(localY * 2));
            if (State.settings.gridEnabled) {
                newL = Math.round(newL / 10) * 10;
            }
            f.l = newL;
            
            CollisionEngine.updateAllCollisions();
            this.draw();
            syncPropertiesPanel();
            if (Viewer3D.renderer) Viewer3D.updateFurniture3D(f);
            
        } else if (State.editor2D.dragMode === 'move-wall-item') {
            // Drag wall element or installation along walls
            const projection = projectToWall(m.x, m.y);
            State.editor2D.draggedItem.wall = projection.wall;
            
            let pos = projection.position;
            if (State.settings.gridEnabled) {
                pos = Math.round(pos / 5) * 5; // snap to 5cm along walls
            }
            
            // Limit doors/windows from going off the wall edges
            const maxPos = (projection.wall === 'top' || projection.wall === 'bottom') ? State.room.width : State.room.depth;
            const halfW = (State.editor2D.draggedItem.w || 10) / 2;
            State.editor2D.draggedItem.position = Math.max(halfW, Math.min(maxPos - halfW, pos));
            
            this.draw();
            syncPropertiesPanel();
            
            // Rebuild 3D wall elements since positions changed
            if (Viewer3D.renderer) {
                if (State.selectedItemType === 'element') Viewer3D.rebuildWalls3D();
                else Viewer3D.updateInstallations3D();
            }
            
        } else if (State.editor2D.dragMode === 'pan') {
            // Pan canvas view
            const dx = sx - State.editor2D.dragStartPos.x;
            const dy = sy - State.editor2D.dragStartPos.y;
            State.editor2D.panX = State.editor2D.dragOffset.x + dx;
            State.editor2D.panY = State.editor2D.dragOffset.y + dy;
            this.draw();
        }
    },
    
    handleMouseUp() {
        State.editor2D.dragMode = null;
        State.editor2D.draggedItem = null;
        this.draw();
    },
    
    handleWheel(e) {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const m = this.screenToWorld(sx, sy);
        
        const zoomFactor = 1.08;
        if (e.deltaY < 0) {
            State.editor2D.zoom = Math.min(State.editor2D.zoom * zoomFactor, 4.0);
        } else {
            State.editor2D.zoom = Math.max(State.editor2D.zoom / zoomFactor, 0.4);
        }
        
        // Re-calculate pan to zoom towards mouse position
        State.editor2D.panX = sx - m.x * State.editor2D.zoom;
        State.editor2D.panY = sy - m.y * State.editor2D.zoom;
        this.draw();
    },
    
    updateCursor(e) {
        const rect = this.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const m = this.screenToWorld(sx, sy);
        
        if (State.selectedItem && State.selectedItemType === 'furniture') {
            const f = State.selectedItem;
            const rad = (f.rotation * Math.PI) / 180;
            
            // Check rotation handle
            const rotHandleLocal = new Vector2D(0, -f.l/2 - 25).rotate(rad);
            const rotHandleWorld = new Vector2D(f.x + rotHandleLocal.x, f.y + rotHandleLocal.y);
            if (Math.hypot(m.x - rotHandleWorld.x, m.y - rotHandleWorld.y) < 10) {
                this.canvas.style.cursor = 'grab';
                return;
            }
            
            // Check resize handles
            if (f.shape === 'rect') {
                const rightHandleLocal = new Vector2D(f.w/2, 0).rotate(rad);
                const rightHandleWorld = new Vector2D(f.x + rightHandleLocal.x, f.y + rightHandleLocal.y);
                const bottomHandleLocal = new Vector2D(0, f.l/2).rotate(rad);
                const bottomHandleWorld = new Vector2D(f.x + bottomHandleLocal.x, f.y + bottomHandleLocal.y);
                
                if (Math.hypot(m.x - rightHandleWorld.x, m.y - rightHandleWorld.y) < 8) {
                    this.canvas.style.cursor = 'ew-resize';
                    return;
                }
                if (Math.hypot(m.x - bottomHandleWorld.x, m.y - bottomHandleWorld.y) < 8) {
                    this.canvas.style.cursor = 'ns-resize';
                    return;
                }
            }
        }
        
        // Check hover over items
        let hoverItem = null;
        for (let f of State.furniture) {
            if (f.shape === 'circle') {
                if (Math.hypot(m.x - f.x, m.y - f.y) < f.w/2) hoverItem = f;
            } else {
                const rad = (-f.rotation * Math.PI) / 180;
                const dx = m.x - f.x;
                const dy = m.y - f.y;
                const localX = dx * Math.cos(rad) - dy * Math.sin(rad);
                const localY = dx * Math.sin(rad) + dy * Math.cos(rad);
                if (Math.abs(localX) < f.w/2 && Math.abs(localY) < f.l/2) hoverItem = f;
            }
        }
        
        if (hoverItem) {
            this.canvas.style.cursor = 'move';
            return;
        }
        
        // Check hover over wall elements
        for (let elem of State.elements) {
            if (isMouseOverWallElement(elem, m)) {
                this.canvas.style.cursor = 'pointer';
                return;
            }
        }
        
        // Check hover over installations
        for (let inst of State.installations) {
            const coords = getWallCoordinates(inst.wall, inst.position);
            const dist = Math.hypot(m.x - coords.x, m.y - coords.y);
            if (dist < 20) {
                this.canvas.style.cursor = 'pointer';
                return;
            }
        }
        
        this.canvas.style.cursor = 'default';
    },
    
    deleteSelected() {
        if (!State.selectedItem) return;
        
        if (State.selectedItemType === 'furniture') {
            State.furniture = State.furniture.filter(item => item !== State.selectedItem);
            if (Viewer3D.renderer) Viewer3D.removeFurniture3D(State.selectedItem);
        } else if (State.selectedItemType === 'element') {
            State.elements = State.elements.filter(item => item !== State.selectedItem);
            if (Viewer3D.renderer) Viewer3D.rebuildWalls3D();
        } else if (State.selectedItemType === 'installation') {
            State.installations = State.installations.filter(item => item !== State.selectedItem);
            if (Viewer3D.renderer) Viewer3D.updateInstallations3D();
        }
        
        selectItem(null, null);
        CollisionEngine.updateAllCollisions();
        this.draw();
        updatePlacedListsUI();
    }
};

// --- 3D VIEWER (THREE.JS) ---
const Viewer3D = {
    container: null,
    scene: null,
    camera: null,
    renderer: null,
    controls: null,
    wallMeshes: [],
    furnitureMeshes: new Map(), // Maps furniture -> 3D Object3D Group
    installationMeshes: [],
    skylightMeshes: [],
    doorMeshes: [],
    windowMeshes: [],
    
    init() {
        this.container = document.getElementById('threeCanvasContainer');
        if (!this.container) return;
        
        // Scene setup
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0e1320);
        
        // Camera setup
        this.camera = new THREE.PerspectiveCamera(45, this.container.clientWidth / this.container.clientHeight, 1, 3000);
        this.camera.position.set(400, 450, 600);
        
        // Renderer setup
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.container.appendChild(this.renderer.domElement);
        
        // Orbit Controls
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.05; // prevent going under floor
        this.controls.minDistance = 50;
        this.controls.maxDistance = 1500;
        
        // Lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);
        
        const dirLight1 = new THREE.DirectionalLight(0xffffff, 0.6);
        dirLight1.position.set(400, 600, 200);
        dirLight1.castShadow = true;
        dirLight1.shadow.mapSize.width = 2048;
        dirLight1.shadow.mapSize.height = 2048;
        dirLight1.shadow.camera.near = 10;
        dirLight1.shadow.camera.far = 2000;
        const d = 500;
        dirLight1.shadow.camera.left = -d;
        dirLight1.shadow.camera.right = d;
        dirLight1.shadow.camera.top = d;
        dirLight1.shadow.camera.bottom = -d;
        this.scene.add(dirLight1);

        const dirLight2 = new THREE.DirectionalLight(0xa5b4fc, 0.2); // soft bluish fill light
        dirLight2.position.set(-400, 300, -300);
        this.scene.add(dirLight2);
        
        // Event listeners
        window.addEventListener('resize', () => this.resizeViewer());
        
        // Start animation loop
        this.animate();
        
        // Rebuild full room
        this.rebuildFullRoom();
    },
    
    resizeViewer() {
        if (!this.container || !this.renderer) return;
        this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    },
    
    animate() {
        requestAnimationFrame(() => this.animate());
        if (this.controls) this.controls.update();
        if (this.renderer) this.renderer.render(this.scene, this.camera);
    },
    
    rebuildFullRoom() {
        if (!this.scene) return;
        
        // 1. Clear old geometry
        this.clearScene();
        
        // 2. Center room in coordinate system
        const offset = { x: -State.room.width / 2, z: -State.room.depth / 2 };
        this.roomOffset = offset;
        
        // 3. Build Floor Grid & Plane
        this.buildFloor3D();
        
        // 4. Build Walls (with Door and Window holes)
        this.rebuildWalls3D();
        
        // 5. Build Furniture
        State.furniture.forEach(f => this.updateFurniture3D(f));
        
        // 6. Build Installations
        this.updateInstallations3D();
    },
    
    clearScene() {
        // Clear all arrays
        this.wallMeshes.forEach(mesh => this.scene.remove(mesh));
        this.wallMeshes = [];
        
        this.doorMeshes.forEach(mesh => this.scene.remove(mesh));
        this.doorMeshes = [];
        
        this.windowMeshes.forEach(mesh => this.scene.remove(mesh));
        this.windowMeshes = [];
        
        this.skylightMeshes.forEach(mesh => this.scene.remove(mesh));
        this.skylightMeshes = [];
        
        this.installationMeshes.forEach(mesh => this.scene.remove(mesh));
        this.installationMeshes = [];
        
        this.furnitureMeshes.forEach((mesh) => this.scene.remove(mesh));
        this.furnitureMeshes.clear();
        
        if (this.floorMesh) this.scene.remove(this.floorMesh);
        if (this.ceilingMesh) this.scene.remove(this.ceilingMesh);
        if (this.gridHelper) this.scene.remove(this.gridHelper);
    },
    
    buildFloor3D() {
        const room = State.room;
        const offset = this.roomOffset;
        
        // Floor geometry
        const floorGeo = new THREE.BoxGeometry(room.width, 2, room.depth);
        const floorMat = new THREE.MeshStandardMaterial({
            color: 0x1e293b, // slate-800
            roughness: 0.8,
            metalness: 0.1
        });
        this.floorMesh = new THREE.Mesh(floorGeo, floorMat);
        this.floorMesh.position.set(0, -1, 0); // top face at y=0
        this.floorMesh.receiveShadow = true;
        this.scene.add(this.floorMesh);
        
        // Add Grid lines
        this.gridHelper = new THREE.GridHelper(Math.max(room.width, room.depth) * 1.5, 50, 0x475569, 0x334155);
        this.gridHelper.position.set(0, 0.1, 0);
        this.scene.add(this.gridHelper);
        
        // Set orbit control target
        this.controls.target.set(0, room.height / 4, 0);
    },
    
    rebuildWalls3D() {
        // Clear existing walls, doors, windows, skylights
        this.wallMeshes.forEach(m => this.scene.remove(m));
        this.wallMeshes = [];
        this.doorMeshes.forEach(m => this.scene.remove(m));
        this.doorMeshes = [];
        this.windowMeshes.forEach(m => this.scene.remove(m));
        this.windowMeshes = [];
        this.skylightMeshes.forEach(m => this.scene.remove(m));
        this.skylightMeshes = [];
        
        const room = State.room;
        const thickness = 10; // Wall thickness in 3D
        
        // Generate shapes for the 4 walls
        const wallSpecs = [
            { name: 'top', startX: 0, startZ: 0, angle: 0, length: room.width },
            { name: 'right', startX: room.width, startZ: 0, angle: Math.PI / 2, length: room.depth },
            { name: 'bottom', startX: room.width, startZ: room.depth, angle: Math.PI, length: room.width },
            { name: 'left', startX: 0, startZ: room.depth, angle: -Math.PI / 2, length: room.depth }
        ];
        
        wallSpecs.forEach(spec => {
            const shape = new THREE.Shape();
            
            // Build polygon representing height profile of the wall
            // u goes from 0 to spec.length along wall base
            // v is height
            shape.moveTo(0, 0);
            shape.lineTo(spec.length, 0);
            
            // Sample ceiling height profile along wall base
            // We sample at 0, pitch start, pitch end, and length
            // This captures all potential linear roof slope cuts!
            const samplePoints = [spec.length];
            
            if (spec.name === 'top') {
                if (room.pitches.left.enabled) samplePoints.push(room.pitches.left.run);
                if (room.pitches.right.enabled) samplePoints.push(room.width - room.pitches.right.run);
            } else if (spec.name === 'bottom') {
                if (room.pitches.right.enabled) samplePoints.push(room.pitches.right.run);
                if (room.pitches.left.enabled) samplePoints.push(room.width - room.pitches.left.run);
            } else if (spec.name === 'left') {
                if (room.pitches.bottom.enabled) samplePoints.push(room.pitches.bottom.run);
                if (room.pitches.top.enabled) samplePoints.push(room.depth - room.pitches.top.run);
            } else if (spec.name === 'right') {
                if (room.pitches.top.enabled) samplePoints.push(room.pitches.top.run);
                if (room.pitches.bottom.enabled) samplePoints.push(room.depth - room.pitches.bottom.run);
            }
            
            // Filter points within range, sort descending, and add unique entries
            const uPoints = [spec.length];
            const sortedSamples = samplePoints.filter(p => p > 0 && p < spec.length).sort((a,b) => b-a);
            sortedSamples.forEach(p => {
                if (!uPoints.includes(p)) uPoints.push(p);
            });
            uPoints.push(0); // end of loop
            
            // Add top outline coordinates (from right side of wall back to left)
            uPoints.forEach(u => {
                // Map local u back to global 2D x,y
                const coords = getWallCoordinates(spec.name, u);
                const h = getCeilingHeightAt(coords.x, coords.y);
                shape.lineTo(u, h);
            });
            
            shape.closePath();
            
            // Add openings (Doors & Windows) as holes in the wall shape
            const wallElements = State.elements.filter(e => e.wall === spec.name);
            wallElements.forEach(elem => {
                const halfW = elem.w / 2;
                const holePath = new THREE.Path();
                
                if (elem.type === 'door') {
                    // Door hole starts at floor level (v=0)
                    holePath.moveTo(elem.position - halfW, 0);
                    holePath.lineTo(elem.position + halfW, 0);
                    holePath.lineTo(elem.position + halfW, elem.h);
                    holePath.lineTo(elem.position - halfW, elem.h);
                    holePath.closePath();
                    shape.holes.push(holePath);
                    
                    // Create simple wood frame & door leaf mesh
                    this.createDoorMesh3D(spec, elem);
                    
                } else if (elem.type === 'window') {
                    // Window hole sits at sill height
                    const bot = elem.sillHeight || 90;
                    const top = bot + elem.h;
                    
                    holePath.moveTo(elem.position - halfW, bot);
                    holePath.lineTo(elem.position + halfW, bot);
                    holePath.lineTo(elem.position + halfW, top);
                    holePath.lineTo(elem.position - halfW, top);
                    holePath.closePath();
                    shape.holes.push(holePath);
                    
                    // Create window glass/frame mesh
                    this.createWindowMesh3D(spec, elem);
                } else if (elem.type === 'skylight') {
                    // Skylights are in the slanted roof, not wall shape holes!
                    this.createSkylightMesh3D(spec, elem);
                }
            });
            
            // Extrude Wall Shape
            const extrudeSettings = {
                depth: thickness,
                bevelEnabled: false
            };
            
            const wallGeo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
            const wallMat = new THREE.MeshStandardMaterial({
                color: 0x334155, // slate-700
                roughness: 0.6,
                metalness: 0.1,
                transparent: true,
                opacity: 0.85 // slightly transparent to easily see inside room
            });
            
            const wallMesh = new THREE.Mesh(wallGeo, wallMat);
            
            // Set position and rotation based on wall segment orientation
            // Local shape coordinates (u, v, depth) map to:
            // u -> along wall
            // v -> height (Y)
            // depth -> wall thickness outwards (extrude depth moves in +Z local)
            
            let dx = 0, dz = 0;
            if (spec.name === 'top') dz = -thickness;
            else if (spec.name === 'bottom') dz = thickness;
            else if (spec.name === 'left') dx = -thickness;
            else if (spec.name === 'right') dx = thickness;

            wallMesh.position.set(spec.startX + this.roomOffset.x + dx, 0, spec.startZ + this.roomOffset.z + dz);
            wallMesh.rotation.y = -spec.angle;
            
            // Adjust for thickness so wall extrudes *outwards*
            // In Three local space, Z points forward (the extrusion direction).
            // Rotating -spec.angle means Z points outwards of the room bounding box.
            // That works out of the box!
            
            wallMesh.castShadow = true;
            wallMesh.receiveShadow = true;
            this.scene.add(wallMesh);
            this.wallMeshes.push(wallMesh);
        });

        // 6. Build Slanted Roof Ceilings (semi-transparent glass planes for slants)
        this.buildCeilingRoof3D();
    },
    
    createDoorMesh3D(spec, door) {
        const offset = this.roomOffset;
        const coords = getWallCoordinates(spec.name, door.position);
        
        const doorGroup = new THREE.Group();
        
        const hinge = door.hinge || 'left';
        const dir = door.direction || 'in';
        const isLeft = hinge === 'left';
        const isIn = dir === 'in';
        
        // Door leaf (wood colored box)
        const leafW = door.w - 4;
        const leafGeo = new THREE.BoxGeometry(leafW, door.h - 4, 3);
        const leafMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.8 }); // wood
        const leaf = new THREE.Mesh(leafGeo, leafMat);
        
        // Pivot rotation point for opening door
        const pivotX = isLeft ? -door.w / 2 + 2 : door.w / 2 - 2;
        leaf.position.set(isLeft ? leafW / 2 : -leafW / 2, (door.h - 4) / 2, 0);
        
        const pivot = new THREE.Group();
        pivot.position.set(pivotX, 2, 0);
        pivot.add(leaf);
        
        // Rotate open (45 deg)
        let openAngle = Math.PI / 4;
        if (isLeft) {
            pivot.rotation.y = isIn ? -openAngle : openAngle;
        } else {
            pivot.rotation.y = isIn ? openAngle : -openAngle;
        }
        
        // Door Frame
        const frameGeo = new THREE.BoxGeometry(door.w, 4, 10);
        const frameMat = new THREE.MeshStandardMaterial({ color: 0x475569 }); // slate-600
        const frameTop = new THREE.Mesh(frameGeo, frameMat);
        frameTop.position.set(0, door.h - 2, 0);
        
        doorGroup.add(pivot);
        doorGroup.add(frameTop);
        
        let dx = 0, dz = 0;
        const halfThick = 10 / 2; // wall thickness is 10
        if (spec.name === 'top') dz = -halfThick;
        else if (spec.name === 'bottom') dz = halfThick;
        else if (spec.name === 'left') dx = -halfThick;
        else if (spec.name === 'right') dx = halfThick;

        // Position door group
        doorGroup.position.set(coords.x + offset.x + dx, 0, coords.y + offset.z + dz);
        doorGroup.rotation.y = -spec.angle;
        
        this.scene.add(doorGroup);
        this.doorMeshes.push(doorGroup);
    },
    
    createWindowMesh3D(spec, win) {
        const offset = this.roomOffset;
        const coords = getWallCoordinates(spec.name, win.position);
        const bot = win.sillHeight || 90;
        const midH = bot + win.h / 2;
        
        const winGroup = new THREE.Group();
        
        // Glass pane (translucent blue box)
        const glassGeo = new THREE.BoxGeometry(win.w - 4, win.h - 4, 2);
        const glassMat = new THREE.MeshPhysicalMaterial({
            color: 0x38bdf8, // light-blue
            transparent: true,
            opacity: 0.4,
            roughness: 0.1,
            transmission: 0.9,
            thickness: 1.0
        });
        const glass = new THREE.Mesh(glassGeo, glassMat);
        glass.position.set(0, midH, 0);
        
        // Window Frame (white outline box)
        const frameMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.9 });
        
        // Top and Bottom frame
        const hFrameGeo = new THREE.BoxGeometry(win.w, 3, 10);
        const frameTop = new THREE.Mesh(hFrameGeo, frameMat);
        frameTop.position.set(0, bot + win.h - 1.5, 0);
        const frameBot = new THREE.Mesh(hFrameGeo, frameMat);
        frameBot.position.set(0, bot + 1.5, 0);
        
        // Sides frame
        const vFrameGeo = new THREE.BoxGeometry(3, win.h, 10);
        const frameLeft = new THREE.Mesh(vFrameGeo, frameMat);
        frameLeft.position.set(-win.w / 2 + 1.5, midH, 0);
        const frameRight = new THREE.Mesh(vFrameGeo, frameMat);
        frameRight.position.set(win.w / 2 - 1.5, midH, 0);
        
        winGroup.add(glass);
        winGroup.add(frameTop);
        winGroup.add(frameBot);
        winGroup.add(frameLeft);
        winGroup.add(frameRight);
        
        let dx = 0, dz = 0;
        const halfThick = 10 / 2;
        if (spec.name === 'top') dz = -halfThick;
        else if (spec.name === 'bottom') dz = halfThick;
        else if (spec.name === 'left') dx = -halfThick;
        else if (spec.name === 'right') dx = halfThick;

        // Position group
        winGroup.position.set(coords.x + offset.x + dx, 0, coords.y + offset.z + dz);
        winGroup.rotation.y = -spec.angle;
        
        this.scene.add(winGroup);
        this.windowMeshes.push(winGroup);
    },
    
    createSkylightMesh3D(spec, elem) {
        const offset = this.roomOffset;
        const coords = getWallCoordinates(spec.name, elem.position);
        const dist = elem.distanceFromWall || 60;
        
        // Offset coordinate inwards normal to wall
        let sx = coords.x;
        let sz = coords.y;
        
        if (spec.name === 'top') sz += dist;
        else if (spec.name === 'right') sx -= dist;
        else if (spec.name === 'bottom') sz -= dist;
        else if (spec.name === 'left') sx += dist;
        
        const h = getCeilingHeightAt(sx, sz);
        
        const group = new THREE.Group();
        
        // Glass skylight box
        const glassGeo = new THREE.BoxGeometry(elem.w, 1.5, elem.h);
        const glassMat = new THREE.MeshPhysicalMaterial({
            color: 0x8b5cf6, // purple tint
            transparent: true,
            opacity: 0.5,
            roughness: 0.1,
            transmission: 0.8
        });
        const glass = new THREE.Mesh(glassGeo, glassMat);
        
        // White frame border
        const frameMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0 });
        const frame = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.BoxGeometry(elem.w + 2, 2.5, elem.h + 2)),
            new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 })
        );
        
        group.add(glass);
        group.add(frame);
        
        // Set height and tilt to match the roof slant
        group.position.set(sx + offset.x, h, sz + offset.z);
        
        // Rotate to match wall face orientation
        group.rotation.y = -spec.angle;
        
        // Tilt the skylight along pitch slope angle!
        const room = State.room;
        const pitch = room.pitches[spec.name];
        if (pitch && pitch.enabled) {
            const slopeAngleRad = Math.atan((room.height - pitch.kniestock) / pitch.run);
            group.rotation.x = -slopeAngleRad; // tilt forward/backward
        }
        
        this.scene.add(group);
        this.skylightMeshes.push(group);
    },
    
    buildCeilingRoof3D() {
        // Render slanted ceiling surfaces as a unified parametric grid mesh
        const room = State.room;
        const offset = this.roomOffset;
        const wallMat = new THREE.MeshStandardMaterial({
            color: 0x475569, // slate-600
            transparent: true,
            opacity: 0.2, // semi-transparent so it doesn't block furniture
            roughness: 0.9,
            side: THREE.DoubleSide
        });
        
        // Remove old ceiling mesh if it exists
        if (this.ceilingMesh) {
            this.scene.remove(this.ceilingMesh);
        }
        
        // Create a detailed grid geometry (40x40 segments) to represent the ceiling
        const segmentsX = 40;
        const segmentsZ = 40;
        const ceilGeo = new THREE.PlaneGeometry(room.width, room.depth, segmentsX, segmentsZ);
        
        // Rotate the plane to be horizontal (default PlaneGeometry is vertical in X-Y)
        ceilGeo.rotateX(-Math.PI / 2);
        
        // Displace the Y coordinate of each vertex based on getCeilingHeightAt
        const posAttr = ceilGeo.attributes.position;
        for (let i = 0; i < posAttr.count; i++) {
            const localX = posAttr.getX(i);
            const localZ = posAttr.getZ(i);
            
            // Map from local centered coordinates to room coordinates [0, width] and [0, depth]
            const roomX = localX + room.width / 2;
            const roomY = localZ + room.depth / 2;
            
            // Get ceiling height at this specific coordinate
            const h = getCeilingHeightAt(roomX, roomY);
            
            // Set the Y coordinate of the vertex
            posAttr.setY(i, h);
        }
        
        // Recalculate normals so lighting works correctly on the slanted parts
        ceilGeo.computeVertexNormals();
        
        this.ceilingMesh = new THREE.Mesh(ceilGeo, wallMat);
        this.ceilingMesh.position.set(0, 0, 0); // centered
        
        this.scene.add(this.ceilingMesh);
    },
    
    updateFurniture3D(f) {
        if (!this.scene) return;
        
        let group = this.furnitureMeshes.get(f);
        
        if (!group) {
            group = new THREE.Group();
            this.scene.add(group);
            this.furnitureMeshes.set(f, group);
        } else {
            // Remove previous children to reconstruct
            while (group.children.length > 0) {
                group.remove(group.children[0]);
            }
        }
        
        // Create Mesh geometries based on properties
        const isObstacle = f.isObstacle || false;
        const heightVal = isObstacle ? getCeilingHeightAt(f.x, f.y) : f.h;
        
        let colorVal = f.isColliding ? 0xef4444 : (parseInt(f.color.replace(/[^0-9]/g, '')) || 0x8b5cf6);
        if (isObstacle && !f.isColliding) {
            colorVal = 0x334155; // match slate-700 wall color
        }
        
        // Material
        const mat = new THREE.MeshStandardMaterial({
            color: colorVal,
            roughness: isObstacle ? 0.8 : 0.5,
            metalness: isObstacle ? 0.1 : 0.1
        });
        
        if (f.isColliding) {
            mat.color.setHex(0xef4444);
            mat.roughness = 0.2;
            mat.metalness = 0.5;
        } else {
            // Convert HSL color string to color
            if (!isObstacle && f.color.startsWith('hsl')) {
                // Parse e.g. "hsl(263, 70%, 55%)"
                const parts = f.color.match(/\d+/g);
                if (parts && parts.length >= 3) {
                    const h = parseInt(parts[0]) / 360;
                    const s = parseInt(parts[1]) / 100;
                    const l = parseInt(parts[2]) / 100;
                    mat.color.setHSL(h, s, l);
                }
            }
        }
        
        let mesh;
        if (f.shape === 'circle') {
            const radius = f.w / 2;
            const cylGeo = new THREE.CylinderGeometry(radius, radius, heightVal, 32);
            mesh = new THREE.Mesh(cylGeo, mat);
            mesh.position.y = heightVal / 2; // Sit on floor
        } else {
            // Rectangle
            const boxGeo = new THREE.BoxGeometry(f.w, heightVal, f.l);
            mesh = new THREE.Mesh(boxGeo, mat);
            mesh.position.y = heightVal / 2; // Sit on floor
        }
        
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
        
        // Draw selected indicators in 3D
        if (State.selectedItem === f) {
            const edgesGeo = new THREE.EdgesGeometry(f.shape === 'circle' ? new THREE.CylinderGeometry(f.w/2, f.w/2, heightVal, 16) : new THREE.BoxGeometry(f.w + 1, heightVal + 1, f.l + 1));
            const line = new THREE.LineSegments(edgesGeo, new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 }));
            line.position.y = heightVal / 2;
            group.add(line);
        }
        
        // Position group
        group.position.set(f.x + this.roomOffset.x, 0, f.y + this.roomOffset.z);
        group.rotation.y = -(f.rotation * Math.PI) / 180;
    },
    
    removeFurniture3D(f) {
        const mesh = this.furnitureMeshes.get(f);
        if (mesh) {
            this.scene.remove(mesh);
            this.furnitureMeshes.delete(f);
        }
    },
    
    updateInstallations3D() {
        // Clear old installation meshes
        this.installationMeshes.forEach(m => this.scene.remove(m));
        this.installationMeshes = [];
        
        const offset = this.roomOffset;
        const thickness = 10;
        
        State.installations.forEach(inst => {
            const coords = getWallCoordinates(inst.wall, inst.position);
            const instH = inst.height || 30; // height from floor in cm
            
            const group = new THREE.Group();
            
            // Outer wall plate (white box)
            const plateGeo = new THREE.BoxGeometry(7, 7, 1);
            let plateMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.9 }); // Slate-100
            
            if (State.selectedItem === inst) {
                plateMat = new THREE.MeshStandardMaterial({ color: 0x8b5cf6, roughness: 0.5 }); // Highlight purple
            }
            
            const plate = new THREE.Mesh(plateGeo, plateMat);
            group.add(plate);
            
            // Colored core indicating outlet type
            let coreColor = 0x475569; // dark grey
            if (inst.type === 'socket') coreColor = 0xe2e8f0;
            else if (inst.type === 'switch') coreColor = 0xffffff;
            else if (inst.type === 'lan') coreColor = 0x0ea5e9; // blue
            else if (inst.type === 'sat') coreColor = 0x6366f1; // indigo
            else if (inst.type === 'power') coreColor = 0xf43f5e; // red
            
            const coreGeo = new THREE.BoxGeometry(4, 4, 1.2);
            const coreMat = new THREE.MeshStandardMaterial({ color: coreColor });
            const core = new THREE.Mesh(coreGeo, coreMat);
            group.add(core);
            
            // Position group on wall face
            // Shift group slightly out of wall
            group.position.set(coords.x + offset.x, instH, coords.y + offset.z);
            group.rotation.y = -coords.angle;
            
            this.scene.add(group);
            this.installationMeshes.push(group);
        });
    }
};

// --- PRESENTS & INITIAL DATA ---
const Presets = {
    bed: { name: 'Doppelbett', shape: 'rect', w: 180, l: 200, h: 60, color: 'hsl(215, 60%, 45%)', collisionEnabled: true },
    wardrobe: { name: 'Kleiderschrank', shape: 'rect', w: 150, l: 60, h: 210, color: 'hsl(33, 50%, 30%)', collisionEnabled: true },
    desk: { name: 'Schreibtisch', shape: 'rect', w: 140, l: 80, h: 76, color: 'hsl(180, 50%, 35%)', collisionEnabled: true },
    chair: { name: 'Stuhl', shape: 'rect', w: 45, l: 45, h: 85, color: 'hsl(20, 70%, 40%)', collisionEnabled: true },
    sofa: { name: 'Sofa', shape: 'rect', w: 210, l: 95, h: 80, color: 'hsl(263, 40%, 45%)', collisionEnabled: true },
    table: { name: 'Esstisch', shape: 'rect', w: 160, l: 90, h: 76, color: 'hsl(35, 45%, 40%)', collisionEnabled: true },
    'custom-rect': { name: 'Custom Box', shape: 'rect', w: 80, l: 80, h: 80, color: 'hsl(142, 60%, 40%)', collisionEnabled: true },
    'custom-circle': { name: 'Runder Tisch', shape: 'circle', w: 100, l: 100, h: 75, color: 'hsl(160, 60%, 40%)', collisionEnabled: true },
    chimney: { name: 'Schornstein / Pfeiler', shape: 'rect', w: 40, l: 40, h: 250, color: 'hsl(215, 12%, 40%)', collisionEnabled: true, isObstacle: true }
};

function loadExampleRoom() {
    selectItem(null, null);
    
    // Set Room Maße
    State.room.width = 500;
    State.room.depth = 400;
    State.room.height = 250;
    
    // Set Pitches
    State.room.pitches.top = { enabled: true, kniestock: 80, run: 160 };
    State.room.pitches.bottom = { enabled: false, kniestock: 80, run: 150 };
    State.room.pitches.left = { enabled: false, kniestock: 80, run: 150 };
    State.room.pitches.right = { enabled: false, kniestock: 80, run: 150 };
    
    // Elements (Doors, windows, skylights)
    State.elements = [
        { id: 'd1', type: 'door', wall: 'bottom', position: 80, w: 90, h: 200 },
        { id: 'w1', type: 'window', wall: 'left', position: 200, w: 120, h: 120, sillHeight: 90 },
        { id: 's1', type: 'skylight', wall: 'top', position: 250, w: 80, h: 120, distanceFromWall: 80 }
    ];
    
    // Installations
    State.installations = [
        { id: 'i1', type: 'switch', wall: 'bottom', position: 140, height: 105 },
        { id: 'i2', type: 'socket', wall: 'bottom', position: 140, height: 30 },
        { id: 'i3', type: 'socket', wall: 'top', position: 60, height: 30 },
        { id: 'i4', type: 'lan', wall: 'right', position: 120, height: 45 },
        { id: 'i5', type: 'socket', wall: 'right', position: 135, height: 30 }
    ];
    
    // Furniture
    State.furniture = [
        { id: 'f1', name: 'Doppelbett', shape: 'rect', x: 120, y: 300, w: 180, l: 200, h: 60, rotation: 180, color: 'hsl(215, 60%, 45%)', collisionEnabled: true, isColliding: false },
        { id: 'f2', name: 'Kleiderschrank', shape: 'rect', x: 420, y: 250, w: 150, l: 60, h: 210, rotation: 90, color: 'hsl(33, 50%, 30%)', collisionEnabled: true, isColliding: false },
        { id: 'f3', name: 'Schreibtisch', shape: 'rect', x: 250, y: 150, w: 140, l: 80, h: 76, rotation: 0, color: 'hsl(180, 50%, 35%)', collisionEnabled: true, isColliding: false }
    ];
    
    // Update forms and redraws
    syncRoomInputsUI();
    CollisionEngine.updateAllCollisions();
    Editor2D.draw();
    if (Viewer3D.renderer) {
        Viewer3D.rebuildFullRoom();
    }
    updatePlacedListsUI();
}

function clearRoom() {
    selectItem(null, null);
    State.furniture = [];
    State.elements = [];
    State.installations = [];
    
    CollisionEngine.updateAllCollisions();
    Editor2D.draw();
    if (Viewer3D.renderer) {
        Viewer3D.rebuildFullRoom();
    }
    updatePlacedListsUI();
}

function applyProjectData(data) {
    selectItem(null, null);
    
    State.room = data.room;
    State.furniture = data.furniture || [];
    State.elements = data.elements || [];
    State.installations = data.installations || [];
    
    // Sync UI inputs
    syncRoomInputsUI();
    
    // Run collision check
    CollisionEngine.updateAllCollisions();
    
    // Redraw 2D Canvas
    Editor2D.draw();
    
    // Rebuild 3D View
    if (Viewer3D.renderer) {
        Viewer3D.rebuildFullRoom();
    }
    
    // Update Sidebar lists
    updatePlacedListsUI();
}

function showToast(msg) {
    const status = document.getElementById('canvas-status');
    if (!status) return;
    
    const originalText = "Raster-Snapping aktiv | Ziehe Möbel zum Platzieren | Mausrad zum Zoomen";
    status.innerText = "✨ " + msg;
    status.style.color = "hsl(142, 70%, 45%)"; // success green
    status.style.fontWeight = "bold";
    
    if (window.toastTimeout) clearTimeout(window.toastTimeout);
    window.toastTimeout = setTimeout(() => {
        status.innerText = originalText;
        status.style.color = "";
        status.style.fontWeight = "";
    }, 3000);
}

// --- SELECTION & SIDEBAR PROPERTY PANEL ---

function selectItem(item, type) {
    State.selectedItem = item;
    State.selectedItemType = type;
    
    const panel = document.getElementById('properties-panel');
    if (!panel) return;
    
    if (item) {
        panel.classList.add('active');
        buildPropertiesPanelContent();
    } else {
        panel.classList.remove('active');
    }
    
    // Draw canvas selection borders
    Editor2D.draw();
    
    // Re-draw in 3D
    if (Viewer3D.renderer) {
        if (type === 'furniture') {
            Viewer3D.updateFurniture3D(item);
        } else if (type === 'element') {
            Viewer3D.rebuildWalls3D();
        } else if (type === 'installation') {
            Viewer3D.updateInstallations3D();
        }
    }
}

function buildPropertiesPanelContent() {
    const item = State.selectedItem;
    const type = State.selectedItemType;
    const container = document.getElementById('properties-content');
    
    if (!item || !container) return;
    
    let html = '';
    
    if (type === 'furniture') {
        const colors = [
            'hsl(215, 60%, 45%)', // Blue
            'hsl(33, 50%, 30%)',  // Brown
            'hsl(180, 50%, 35%)', // Teal
            'hsl(20, 70%, 40%)',  // Red-orange
            'hsl(263, 40%, 45%)', // Purple
            'hsl(35, 45%, 40%)',  // Wood
            'hsl(142, 60%, 40%)', // Green
            'hsl(0, 0%, 25%)'     // Charcoal
        ];
        
        html = `
            <div class="prop-grid">
                <div class="prop-field prop-span-2">
                    <label>Name</label>
                    <input type="text" id="prop-name" value="${item.name}">
                </div>
                <div class="prop-field">
                    <label>Breite (cm)</label>
                    <input type="number" id="prop-w" value="${item.w}" min="10" max="500">
                </div>
                <div class="prop-field">
                    <label>Länge / Tiefe (cm)</label>
                    <input type="number" id="prop-l" value="${item.l}" min="10" max="500" ${item.shape === 'circle' ? 'disabled' : ''}>
                </div>
                <div class="prop-field">
                    <label>Höhe (cm)</label>
                    <input type="number" id="prop-h" value="${item.isObstacle ? Math.round(getCeilingHeightAt(item.x, item.y)) : item.h}" min="10" max="350" ${item.isObstacle ? 'disabled' : ''}>
                </div>
                <div class="prop-field">
                    <label>Rotation (Grad)</label>
                    <input type="number" id="prop-rot" value="${item.rotation}" min="0" max="359">
                </div>
                <div class="prop-field prop-span-2">
                    <label>Farbe</label>
                    <div class="color-palette">
                        ${colors.map(c => `
                            <div class="color-dot ${item.color === c ? 'active' : ''}" 
                                 style="background-color: ${c}" 
                                 data-color="${c}">
                            </div>
                        `).join('')}
                    </div>
                </div>
                <div class="prop-field prop-span-2" style="margin-top: 4px;">
                    <label class="checkbox-container">
                        <input type="checkbox" id="prop-col" ${item.collisionEnabled ? 'checked' : ''}>
                        <span class="checkmark"></span>
                        <span>Kollisionsprüfung aktiv</span>
                    </label>
                </div>
            </div>
            
            <div class="prop-actions">
                <button class="btn btn-secondary" id="prop-btn-duplicate">
                    <i data-lucide="copy"></i> Duplizieren
                </button>
                <button class="btn btn-danger" id="prop-btn-delete">
                    <i data-lucide="trash-2"></i> Löschen
                </button>
            </div>
        `;
    } else if (type === 'element') {
        const isSkylight = item.type === 'skylight';
        html = `
            <div class="prop-grid">
                <div class="prop-field prop-span-2">
                    <label>Typ</label>
                    <input type="text" value="${item.type === 'door' ? 'Tür' : item.type === 'window' ? 'Fenster' : 'Dachfenster'}" disabled>
                </div>
                <div class="prop-field">
                    <label>Breite (cm)</label>
                    <input type="number" id="prop-w" value="${item.w}" min="30" max="300">
                </div>
                <div class="prop-field">
                    <label>${isSkylight ? 'Länge' : 'Höhe'} (cm)</label>
                    <input type="number" id="prop-h" value="${item.h}" min="30" max="300">
                </div>
                <div class="prop-field">
                    <label>Wand</label>
                    <select id="prop-wall">
                        <option value="top" ${item.wall === 'top' ? 'selected' : ''}>Oben (Nord)</option>
                        <option value="right" ${item.wall === 'right' ? 'selected' : ''}>Rechts (Ost)</option>
                        <option value="bottom" ${item.wall === 'bottom' ? 'selected' : ''}>Unten (Süd)</option>
                        <option value="left" ${item.wall === 'left' ? 'selected' : ''}>Links (West)</option>
                    </select>
                </div>
                <div class="prop-field">
                    <label>Wandposition (cm)</label>
                    <input type="number" id="prop-pos" value="${item.position}" min="0">
                </div>
                
                ${isSkylight ? `
                    <div class="prop-field">
                        <label>Wandabstand (cm)</label>
                        <input type="number" id="prop-dist" value="${item.distanceFromWall || 60}" min="10" max="300">
                    </div>
                ` : item.type === 'window' ? `
                    <div class="prop-field">
                        <label>Brüstungshöhe (cm)</label>
                        <input type="number" id="prop-sill" value="${item.sillHeight || 90}" min="0" max="200">
                    </div>
                ` : item.type === 'door' ? `
                    <div class="prop-field">
                        <label>Anschlag</label>
                        <select id="prop-hinge">
                            <option value="left" ${item.hinge === 'left' ? 'selected' : ''}>Links (Standard)</option>
                            <option value="right" ${item.hinge === 'right' ? 'selected' : ''}>Rechts</option>
                        </select>
                    </div>
                    <div class="prop-field">
                        <label>Öffnungsrichtung</label>
                        <select id="prop-dir">
                            <option value="in" ${item.direction === 'in' ? 'selected' : ''}>Nach Innen</option>
                            <option value="out" ${item.direction === 'out' ? 'selected' : ''}>Nach Außen</option>
                        </select>
                    </div>
                ` : ''}
            </div>
            
            <div class="prop-actions">
                <button class="btn btn-danger" id="prop-btn-delete" style="flex:1">
                    <i data-lucide="trash-2"></i> Löschen
                </button>
            </div>
        `;
    } else if (type === 'installation') {
        const typesMap = {
            socket: 'Steckdose',
            switch: 'Lichtschalter',
            lan: 'LAN Anschluss',
            sat: 'SAT Anschluss',
            power: 'Starkstrom'
        };
        html = `
            <div class="prop-grid">
                <div class="prop-field prop-span-2">
                    <label>Typ</label>
                    <input type="text" value="${typesMap[item.type]}" disabled>
                </div>
                <div class="prop-field">
                    <label>Wand</label>
                    <select id="prop-wall">
                        <option value="top" ${item.wall === 'top' ? 'selected' : ''}>Oben (Nord)</option>
                        <option value="right" ${item.wall === 'right' ? 'selected' : ''}>Rechts (Ost)</option>
                        <option value="bottom" ${item.wall === 'bottom' ? 'selected' : ''}>Unten (Süd)</option>
                        <option value="left" ${item.wall === 'left' ? 'selected' : ''}>Links (West)</option>
                    </select>
                </div>
                <div class="prop-field">
                    <label>Wandposition (cm)</label>
                    <input type="number" id="prop-pos" value="${item.position}" min="0">
                </div>
                <div class="prop-field">
                    <label>Höhe vom Boden (cm)</label>
                    <input type="number" id="prop-height" value="${item.height || 30}" min="0" max="300">
                </div>
            </div>
            
            <div class="prop-actions">
                <button class="btn btn-danger" id="prop-btn-delete" style="flex:1">
                    <i data-lucide="trash-2"></i> Löschen
                </button>
            </div>
        `;
    }
    
    container.innerHTML = html;
    lucide.createIcons({ attrs: { class: 'lucide' } });
    
    // Attach event listeners for property changes
    attachPropertiesListeners();
}

function attachPropertiesListeners() {
    const item = State.selectedItem;
    if (!item) return;
    
    const listenChange = (id, callback) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', callback);
    };
    
    // Text / Numbers inputs
    listenChange('prop-name', (e) => {
        item.name = e.target.value;
        Editor2D.draw();
        updatePlacedListsUI();
    });
    
    listenChange('prop-w', (e) => {
        item.w = Math.max(10, parseInt(e.target.value) || 0);
        if (item.shape === 'circle') item.l = item.w; // sync circle diameter
        updateSelectedMesh();
    });
    
    listenChange('prop-l', (e) => {
        item.l = Math.max(10, parseInt(e.target.value) || 0);
        updateSelectedMesh();
    });
    
    listenChange('prop-h', (e) => {
        item.h = Math.max(10, parseInt(e.target.value) || 0);
        updateSelectedMesh();
    });
    
    listenChange('prop-rot', (e) => {
        item.rotation = (parseInt(e.target.value) || 0) % 360;
        updateSelectedMesh();
    });
    
    listenChange('prop-pos', (e) => {
        item.position = Math.max(0, parseInt(e.target.value) || 0);
        updateSelectedMesh();
    });
    
    listenChange('prop-sill', (e) => {
        item.sillHeight = Math.max(0, parseInt(e.target.value) || 0);
        updateSelectedMesh();
    });
    
    listenChange('prop-hinge', (e) => {
        item.hinge = e.target.value;
        updateSelectedMesh();
    });
    
    listenChange('prop-dir', (e) => {
        item.direction = e.target.value;
        updateSelectedMesh();
    });
    
    listenChange('prop-dist', (e) => {
        item.distanceFromWall = Math.max(10, parseInt(e.target.value) || 0);
        updateSelectedMesh();
    });
    
    listenChange('prop-height', (e) => {
        item.height = Math.max(0, parseInt(e.target.value) || 0);
        updateSelectedMesh();
    });
    
    // Wall Selector
    const wallSel = document.getElementById('prop-wall');
    if (wallSel) {
        wallSel.addEventListener('change', (e) => {
            item.wall = e.target.value;
            // Clamp position just in case
            const maxPos = (item.wall === 'top' || item.wall === 'bottom') ? State.room.width : State.room.depth;
            const halfW = (item.w || 10) / 2;
            item.position = Math.min(maxPos - halfW, Math.max(halfW, item.position));
            
            updateSelectedMesh();
            buildPropertiesPanelContent(); // Rebuild panel to show updated limits
        });
    }
    
    // Checkboxes
    const colChk = document.getElementById('prop-col');
    if (colChk) {
        colChk.addEventListener('change', (e) => {
            item.collisionEnabled = e.target.checked;
            updateSelectedMesh();
        });
    }
    
    // Color Dot Palette
    const dots = document.querySelectorAll('.color-dot');
    dots.forEach(dot => {
        dot.addEventListener('click', (e) => {
            const col = e.target.dataset.color;
            item.color = col;
            
            // update UI dots
            dots.forEach(d => d.classList.remove('active'));
            e.target.classList.add('active');
            
            updateSelectedMesh();
        });
    });
    
    // Actions
    const btnDel = document.getElementById('prop-btn-delete');
    if (btnDel) btnDel.addEventListener('click', () => Editor2D.deleteSelected());
    
    const btnDupl = document.getElementById('prop-btn-duplicate');
    if (btnDupl && State.selectedItemType === 'furniture') {
        btnDupl.addEventListener('click', () => {
            const copy = Object.assign({}, item);
            copy.id = 'f_' + Date.now();
            copy.x += 20; // offset slightly
            copy.y += 20;
            copy.name = item.name + ' Kopie';
            
            State.furniture.push(copy);
            CollisionEngine.updateAllCollisions();
            Editor2D.draw();
            if (Viewer3D.renderer) Viewer3D.updateFurniture3D(copy);
            selectItem(copy, 'furniture');
            updatePlacedListsUI();
        });
    }
}

function updateSelectedMesh() {
    CollisionEngine.updateAllCollisions();
    Editor2D.draw();
    
    if (Viewer3D.renderer) {
        if (State.selectedItemType === 'furniture') {
            Viewer3D.updateFurniture3D(State.selectedItem);
        } else if (State.selectedItemType === 'element') {
            Viewer3D.rebuildWalls3D();
        } else if (State.selectedItemType === 'installation') {
            Viewer3D.updateInstallations3D();
        }
    }
}

function syncPropertiesPanel() {
    // If details are modified via drag, updates values without rebuilding whole structure
    const item = State.selectedItem;
    if (!item) return;
    
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = Math.round(val);
    };
    
    if (State.selectedItemType === 'furniture') {
        setVal('prop-w', item.w);
        setVal('prop-l', item.l);
        setVal('prop-h', item.isObstacle ? getCeilingHeightAt(item.x, item.y) : item.h);
        setVal('prop-rot', item.rotation);
    } else {
        setVal('prop-pos', item.position);
        if (item.type === 'skylight') setVal('prop-dist', item.distanceFromWall || 60);
    }
}

// --- UI EVENT BINDINGS (SIDEBAR & TOOLBAR) ---

function initUIEvents() {
    // 1. Sidebar Tab Switching
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.tab;
            
            // Switch tabs
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            const panels = document.querySelectorAll('.tab-panel');
            panels.forEach(p => p.classList.remove('active'));
            
            const panel = document.getElementById(target);
            if (panel) panel.classList.add('active');
        });
    });
    
    // Close properties panel button
    const closeProp = document.getElementById('close-properties');
    if (closeProp) closeProp.addEventListener('click', () => selectItem(null, null));
    
    // 2. Room Dimensions Input Updates
    const bindRoomInput = (rangeId, numId, stateKey) => {
        const range = document.getElementById(rangeId);
        const num = document.getElementById(numId);
        
        const update = (val) => {
            State.room[stateKey] = parseInt(val) || 200;
            
            // Sync both fields
            range.value = val;
            num.value = val;
            
            // Clamp elements and installations positions
            State.elements.forEach(el => {
                const maxPos = (el.wall === 'top' || el.wall === 'bottom') ? State.room.width : State.room.depth;
                const halfW = el.w / 2;
                el.position = Math.max(halfW, Math.min(maxPos - halfW, el.position));
            });
            State.installations.forEach(inst => {
                const maxPos = (inst.wall === 'top' || inst.wall === 'bottom') ? State.room.width : State.room.depth;
                inst.position = Math.max(5, Math.min(maxPos - 5, inst.position));
            });
            
            CollisionEngine.updateAllCollisions();
            Editor2D.draw();
            if (Viewer3D.renderer) {
                Viewer3D.rebuildFullRoom();
            }
        };
        
        range.addEventListener('input', (e) => update(e.target.value));
        num.addEventListener('change', (e) => update(e.target.value));
    };
    
    bindRoomInput('room-width-range', 'room-width', 'width');
    bindRoomInput('room-depth-range', 'room-depth', 'depth');
    bindRoomInput('room-height-range', 'room-height', 'height');
    
    // 3. Roof Pitches Checkboxes and Inputs
    const walls = ['top', 'right', 'bottom', 'left'];
    walls.forEach(w => {
        const enableChk = document.getElementById(`pitch-${w}-enable`);
        const details = document.getElementById(`pitch-${w}-details`);
        const knieInput = document.getElementById(`pitch-${w}-kniestock`);
        const runInput = document.getElementById(`pitch-${w}-run`);
        
        enableChk.addEventListener('change', (e) => {
            const active = e.target.checked;
            State.room.pitches[w].enabled = active;
            
            if (active) details.classList.remove('hidden');
            else details.classList.add('hidden');
            
            // Enable/disable Skylight button if at least one roof slant is active
            updateSkylightButtonState();
            
            CollisionEngine.updateAllCollisions();
            Editor2D.draw();
            if (Viewer3D.renderer) Viewer3D.rebuildWalls3D();
        });
        
        const updateValues = () => {
            State.room.pitches[w].kniestock = Math.max(0, parseInt(knieInput.value) || 0);
            State.room.pitches[w].run = Math.max(10, parseInt(runInput.value) || 10);
            
            CollisionEngine.updateAllCollisions();
            Editor2D.draw();
            if (Viewer3D.renderer) Viewer3D.rebuildWalls3D();
        };
        
        knieInput.addEventListener('input', updateValues);
        runInput.addEventListener('input', updateValues);
    });
    
    // 4. View Mode Toggles
    const viewBtns = [
        { id: 'btn-view-2d', mode: '2d', class: 'view-2d' },
        { id: 'btn-view-split', mode: 'split', class: 'view-split' },
        { id: 'btn-view-3d', mode: '3d', class: 'view-3d' }
    ];
    
    const layoutContainer = document.getElementById('workspace-layout');
    
    viewBtns.forEach(btnInfo => {
        const btn = document.getElementById(btnInfo.id);
        btn.addEventListener('click', () => {
            // Active style
            viewBtns.forEach(b => document.getElementById(b.id).classList.remove('active'));
            btn.classList.add('active');
            
            // Switch layout classes
            layoutContainer.className = 'split-workspace ' + btnInfo.class;
            State.settings.viewMode = btnInfo.mode;
            
            // Handle Canvas resize
            Editor2D.resizeCanvas();
            if (Viewer3D.renderer) {
                Viewer3D.resizeViewer();
            }
        });
    });
    
    // 5. Toolbar Switches
    const gridChk = document.getElementById('toggle-grid');
    gridChk.addEventListener('change', (e) => {
        State.settings.gridEnabled = e.target.checked;
        Editor2D.draw();
    });
    
    const colChk = document.getElementById('toggle-collision');
    colChk.addEventListener('change', (e) => {
        State.settings.collisionEnabled = e.target.checked;
        CollisionEngine.updateAllCollisions();
        Editor2D.draw();
        if (Viewer3D.renderer) {
            // rebuild all models to clear red highlights
            State.furniture.forEach(f => Viewer3D.updateFurniture3D(f));
        }
    });
    
    // 6. Action Buttons
    document.getElementById('btn-save-project').addEventListener('click', () => {
        const project = {
            room: State.room,
            furniture: State.furniture,
            elements: State.elements,
            installations: State.installations
        };
        localStorage.setItem('roomcraft_project', JSON.stringify(project));
        showToast("Projekt im Browser gespeichert!");
    });

    document.getElementById('btn-load-project').addEventListener('click', () => {
        const dataStr = localStorage.getItem('roomcraft_project');
        if (!dataStr) {
            alert("Kein gespeichertes Projekt im Browser gefunden!");
            return;
        }
        try {
            const data = JSON.parse(dataStr);
            applyProjectData(data);
            showToast("Projekt erfolgreich geladen!");
        } catch (e) {
            alert("Fehler beim Laden des Projekts!");
        }
    });

    document.getElementById('btn-export-json').addEventListener('click', () => {
        const project = {
            room: State.room,
            furniture: State.furniture,
            elements: State.elements,
            installations: State.installations
        };
        const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `roomcraft_project_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast("Projekt als JSON-Datei exportiert!");
    });

    const fileInput = document.getElementById('import-file-input');
    document.getElementById('btn-import-json').addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const data = JSON.parse(evt.target.result);
                applyProjectData(data);
                showToast("Projekt erfolgreich importiert!");
                fileInput.value = ''; // reset
            } catch (err) {
                alert("Ungültige JSON-Projektdatei!");
            }
        };
        reader.readAsText(file);
    });

    document.getElementById('btn-example-room').addEventListener('click', loadExampleRoom);
    document.getElementById('btn-clear-room').addEventListener('click', clearRoom);
    
    document.getElementById('zoom-in').addEventListener('click', () => {
        State.editor2D.zoom = Math.min(State.editor2D.zoom * 1.2, 4.0);
        Editor2D.draw();
    });
    
    document.getElementById('zoom-out').addEventListener('click', () => {
        State.editor2D.zoom = Math.max(State.editor2D.zoom / 1.2, 0.4);
        Editor2D.draw();
    });
    
    document.getElementById('zoom-reset').addEventListener('click', () => {
        Editor2D.resetView();
    });
    
    // 7. Preset Furniture placement click
    const presetBtns = document.querySelectorAll('.preset-btn');
    presetBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const presetKey = btn.dataset.preset;
            const p = Presets[presetKey];
            if (!p) return;
            
            // Create furniture at room center
            const f = {
                id: 'f_' + Date.now(),
                name: p.name,
                shape: p.shape,
                w: p.w,
                l: p.l,
                h: p.h,
                x: State.room.width / 2,
                y: State.room.depth / 2,
                rotation: 0,
                color: p.color,
                collisionEnabled: p.collisionEnabled,
                isObstacle: p.isObstacle || false,
                isColliding: false
            };
            
            State.furniture.push(f);
            CollisionEngine.updateAllCollisions();
            Editor2D.draw();
            if (Viewer3D.renderer) {
                Viewer3D.updateFurniture3D(f);
            }
            selectItem(f, 'furniture');
            updatePlacedListsUI();
        });
    });
    
    // 8. Add Wall Elements (Doors & Windows)
    const elemBtns = document.querySelectorAll('.add-elem-btn');
    elemBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const type = btn.dataset.type;
            
            // Check if roof window is valid (need roof pitch enabled)
            if (type === 'skylight') {
                const pitchEnabled = walls.some(w => State.room.pitches[w].enabled);
                if (!pitchEnabled) {
                    alert('Aktivieren Sie zuerst eine Dachschräge unter "Raum"!');
                    return;
                }
            }
            
            // Create default wall element on wall Top
            // find wall that has roof pitch if adding skylight
            let targetWall = 'top';
            if (type === 'skylight') {
                const pitchWall = walls.find(w => State.room.pitches[w].enabled);
                if (pitchWall) targetWall = pitchWall;
            } else {
                // doors/windows typically go on walls without a pitch if knee-wall is low, 
                // but let's just place on bottom wall initially as it has no pitches in our example
                targetWall = 'bottom';
            }
            
            const maxPos = (targetWall === 'top' || targetWall === 'bottom') ? State.room.width : State.room.depth;
            
            const elem = {
                id: 'el_' + Date.now(),
                type: type,
                wall: targetWall,
                position: maxPos / 2,
                w: type === 'door' ? 90 : type === 'window' ? 100 : 80,
                h: type === 'door' ? 200 : type === 'window' ? 120 : 120
            };
            
            if (type === 'window') {
                elem.sillHeight = 90;
            } else if (type === 'skylight') {
                elem.distanceFromWall = 60; // default distance along slant
            }
            
            State.elements.push(elem);
            Editor2D.draw();
            if (Viewer3D.scene) {
                Viewer3D.rebuildWalls3D();
            }
            selectItem(elem, 'element');
            updatePlacedListsUI();
        });
    });
    
    // 9. Add Installation elements
    const instBtns = document.querySelectorAll('.add-inst-btn');
    instBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const type = btn.dataset.type;
            
            const inst = {
                id: 'in_' + Date.now(),
                type: type,
                wall: 'left',
                position: State.room.depth / 2,
                height: type === 'socket' || type === 'lan' ? 30 : type === 'switch' ? 105 : 100 // default heights
            };
            
            State.installations.push(inst);
            Editor2D.draw();
            if (Viewer3D.scene) {
                Viewer3D.updateInstallations3D();
            }
            selectItem(inst, 'installation');
            updatePlacedListsUI();
        });
    });
}

function updateSkylightButtonState() {
    const skylightBtn = document.getElementById('skylight-add-btn');
    if (!skylightBtn) return;
    
    const anyPitch = wallsAnyPitch();
    if (anyPitch) {
        skylightBtn.classList.remove('disabled');
        skylightBtn.title = '';
    } else {
        skylightBtn.classList.add('disabled');
        skylightBtn.title = 'Aktivieren Sie zuerst eine Dachschräge';
    }
}

function wallsAnyPitch() {
    return State.room.pitches.top.enabled || 
           State.room.pitches.right.enabled || 
           State.room.pitches.bottom.enabled || 
           State.room.pitches.left.enabled;
}

function syncRoomInputsUI() {
    // Width
    document.getElementById('room-width-range').value = State.room.width;
    document.getElementById('room-width').value = State.room.width;
    // Depth
    document.getElementById('room-depth-range').value = State.room.depth;
    document.getElementById('room-depth').value = State.room.depth;
    // Height
    document.getElementById('room-height-range').value = State.room.height;
    document.getElementById('room-height').value = State.room.height;
    
    // Pitches checkboxes & inputs
    const walls = ['top', 'right', 'bottom', 'left'];
    walls.forEach(w => {
        const pitch = State.room.pitches[w];
        const enableChk = document.getElementById(`pitch-${w}-enable`);
        const details = document.getElementById(`pitch-${w}-details`);
        
        enableChk.checked = pitch.enabled;
        if (pitch.enabled) details.classList.remove('hidden');
        else details.classList.add('hidden');
        
        document.getElementById(`pitch-${w}-kniestock`).value = pitch.kniestock;
        document.getElementById(`pitch-${w}-run`).value = pitch.run;
    });
    
    updateSkylightButtonState();
}

function updatePlacedListsUI() {
    const renderList = (containerId, items, labelFunc, typeKey) => {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        if (items.length === 0) {
            container.innerHTML = '<p class="empty-list-text">Keine Elemente platziert.</p>';
            return;
        }
        
        let html = '';
        items.forEach(item => {
            const isSel = State.selectedItem === item;
            html += `
                <div class="placed-item-row ${isSel ? 'selected' : ''}" data-id="${item.id}">
                    <div class="placed-item-info">
                        ${item.color ? `<div class="placed-item-color" style="background-color: ${item.color}"></div>` : ''}
                        <span>${labelFunc(item)}</span>
                    </div>
                    <button class="placed-item-delete" data-id="${item.id}" title="Löschen">
                        <i data-lucide="trash-2" style="width:12px;height:12px;"></i>
                    </button>
                </div>
            `;
        });
        container.innerHTML = html;
        lucide.createIcons({ attrs: { class: 'lucide' } });
        
        // Attach selection and deletion listeners
        const rows = container.querySelectorAll('.placed-item-row');
        rows.forEach(row => {
            row.addEventListener('click', (e) => {
                // Avoid selection if trash button clicked
                if (e.target.closest('.placed-item-delete')) return;
                const id = row.dataset.id;
                const matched = items.find(it => it.id === id);
                if (matched) selectItem(matched, typeKey);
            });
        });
        
        const dels = container.querySelectorAll('.placed-item-delete');
        dels.forEach(del => {
            del.addEventListener('click', () => {
                const id = del.dataset.id;
                const matched = items.find(it => it.id === id);
                if (matched) {
                    selectItem(matched, typeKey);
                    Editor2D.deleteSelected();
                }
            });
        });
    };
    
    // Render Furniture List
    renderList('placed-furniture-list', State.furniture, f => `${f.name} (${f.w}x${f.l}x${f.h}cm)`, 'furniture');
    
    // Render Wall Elements List
    const elemNames = { door: 'Tür', window: 'Fenster', skylight: 'Dachfenster' };
    const wallsMap = { top: 'Nord', right: 'Ost', bottom: 'Süd', left: 'West' };
    renderList('placed-elements-list', State.elements, el => `${elemNames[el.type]} (${wallsMap[el.wall]} - ${el.position}cm)`, 'element');
    
    // Render Installations List
    const instNames = { socket: 'Steckdose', switch: 'Lichtschalter', lan: 'LAN', sat: 'SAT', power: 'Starkstrom' };
    renderList('placed-installations-list', State.installations, inst => `${instNames[inst.type]} (${wallsMap[inst.wall]} - ${inst.position}cm)`, 'installation');
}

// --- INITIALIZATION ---
window.addEventListener('DOMContentLoaded', () => {
    console.log("RoomCraft App loaded - Version 1.0.7");
    // 1. Initialize 2D Canvas Editor
    Editor2D.init();
    
    // 2. Initialize UI Controls & Event listeners
    initUIEvents();
    
    // 3. Initial state UI synching
    syncRoomInputsUI();
    
    // 4. Initialize 3D Viewer
    Viewer3D.init();
    
    // 5. Load default example room to showcase capabilities immediately
    loadExampleRoom();
});
