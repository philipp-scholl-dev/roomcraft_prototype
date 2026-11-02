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
        },
        wallColors: {
            top: '#f0eee9',
            right: '#f0eee9',
            bottom: '#f0eee9',
            left: '#f0eee9',
            pitch: '#f0eee9',
            ceiling: '#f5f4f0'
        },
        floorTexture: 'laminat_hell',
        floorScale: 1.0
    },
    furniture: [],
    elements: [],       // doors, windows, skylights
    installations: [],  // sockets, switches, etc.
    selectedItem: null, // ref to selected furniture, element, or installation
    selectedItemType: null, // 'furniture', 'element', 'installation'
    get selectedFurniture() {
        return this.selectedItemType === 'furniture' ? this.selectedItem : null;
    },
    set selectedFurniture(f) {
        selectItem(f, f ? 'furniture' : null);
    },
    settings: {
        gridEnabled: true,
        gridSize: 10, // cm
        collisionEnabled: true,
        smartSnappingEnabled: true,
        viewMode: '2d', // '2d', '3d', 'split'
        viewStyle3D: 'plan', // 'plan' (transparente Planungsansicht) oder 'texture' (Wandfarben & Texturen)
        ceilingLampsEnabled: true,
        ceilingLampIntensity: 1.0,
        ceilingLampColor: '#ffeedd'
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
        resizeHandleIndex: -1,
        hasManuallyPannedOrZoomed: false,
        activeGuides: []
    }
};

// --- UNDO / REDO HISTORY MANAGEMENT ---
const History = {
    undoStack: [],
    redoStack: [],
    tempSnapshot: null,
    
    // Create a deep copy of the relevant state
    getSnapshot() {
        return {
            room: JSON.parse(JSON.stringify(State.room)),
            furniture: JSON.parse(JSON.stringify(State.furniture)),
            elements: JSON.parse(JSON.stringify(State.elements)),
            installations: JSON.parse(JSON.stringify(State.installations))
        };
    },
    
    // Save current state to undo stack
    pushState() {
        const snapshot = this.getSnapshot();
        
        // Avoid duplicate consecutive states
        if (this.undoStack.length > 0) {
            const last = this.undoStack[this.undoStack.length - 1];
            if (JSON.stringify(last) === JSON.stringify(snapshot)) {
                return;
            }
        }
        
        this.undoStack.push(snapshot);
        this.redoStack = [];
        this.updateButtons();
    },
    
    // Store a temporary snapshot before a potential drag/input change begins
    saveTempSnapshot() {
        this.tempSnapshot = this.getSnapshot();
    },
    
    // Commit the temporary snapshot if the state actually changed
    commitTempSnapshot() {
        if (!this.tempSnapshot) return;
        
        const currentSnapshot = this.getSnapshot();
        if (JSON.stringify(this.tempSnapshot) !== JSON.stringify(currentSnapshot)) {
            this.undoStack.push(this.tempSnapshot);
            this.redoStack = [];
            this.updateButtons();
        }
        this.tempSnapshot = null;
    },
    
    undo() {
        if (this.undoStack.length === 0) return;
        
        // Push current state to redo stack
        this.redoStack.push(this.getSnapshot());
        
        // Pop and apply prev state
        const prevState = this.undoStack.pop();
        applyProjectData(prevState);
        
        this.updateButtons();
    },
    
    redo() {
        if (this.redoStack.length === 0) return;
        
        // Push current state to undo stack
        this.undoStack.push(this.getSnapshot());
        
        // Pop and apply next state
        const nextState = this.redoStack.pop();
        applyProjectData(nextState);
        
        this.updateButtons();
    },
    
    updateButtons() {
        const btnUndo = document.getElementById('btn-undo');
        const btnRedo = document.getElementById('btn-redo');
        if (btnUndo) {
            btnUndo.disabled = this.undoStack.length === 0;
            btnUndo.style.opacity = this.undoStack.length === 0 ? '0.4' : '1.0';
            btnUndo.style.pointerEvents = this.undoStack.length === 0 ? 'none' : 'auto';
        }
        if (btnRedo) {
            btnRedo.disabled = this.redoStack.length === 0;
            btnRedo.style.opacity = this.redoStack.length === 0 ? '0.4' : '1.0';
            btnRedo.style.pointerEvents = this.redoStack.length === 0 ? 'none' : 'auto';
        }
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

// Get closest wall and distance to it for a given furniture item (especially chimney/obstacle)
function getClosestWall(f) {
    const room = State.room;
    
    // Account for rotation to determine orientation of dimensions
    const isRotated = (Math.round((f.rotation || 0) / 90) % 2 === 1);
    const halfW = (isRotated ? f.l : f.w) / 2;
    const halfL = (isRotated ? f.w : f.l) / 2;
    
    const dists = {
        top: f.y - halfL,
        bottom: room.depth - (f.y + halfL),
        left: f.x - halfW,
        right: room.width - (f.x + halfW)
    };
    
    let closestWall = 'top';
    let minDist = dists.top;
    
    for (let wall in dists) {
        if (dists[wall] < minDist) {
            minDist = dists[wall];
            closestWall = wall;
        }
    }
    
    return { wall: closestWall, distance: minDist };
}

// Math helpers
function formatDim(val) {
    if (val === undefined || val === null || isNaN(val)) return 0;
    return Math.round(val * 10) / 10;
}

// Maps wall-local coordinates (u along wall, d perpendicular into room) to 2D room coordinates (x, y)
function wallUDToRoomXY(wallName, u, d) {
    const room = State.room;
    switch (wallName) {
        case 'top': return { x: u, y: d };
        case 'right': return { x: room.width - d, y: u };
        case 'bottom': return { x: room.width - u, y: room.depth - d };
        case 'left': return { x: d, y: room.depth - u };
    }
}

// Returns the active start/end and kniestockStart/kniestockEnd interval of a wall pitch in cm along the wall
function getPitchInterval(pitch, wallName) {
    if (!pitch || !pitch.enabled) return null;
    const room = State.room;
    const wallLength = (wallName === 'top' || wallName === 'bottom') ? room.width : room.depth;
    const rawStart = (pitch.start !== undefined && pitch.start !== null) ? pitch.start : 0;
    const rawEnd = (pitch.end !== undefined && pitch.end !== null) ? pitch.end : wallLength;
    const rawKnieStart = (pitch.kniestockStart !== undefined && pitch.kniestockStart !== null) ? pitch.kniestockStart : rawStart;
    const rawKnieEnd = (pitch.kniestockEnd !== undefined && pitch.kniestockEnd !== null) ? pitch.kniestockEnd : rawEnd;

    const s1 = Math.max(0, Math.min(wallLength, rawStart));
    const e1 = Math.max(s1, Math.min(wallLength, rawEnd));
    const s2 = Math.max(0, Math.min(wallLength, rawKnieStart));
    const e2 = Math.max(s2, Math.min(wallLength, rawKnieEnd));

    const outerStart = Math.min(s1, s2);
    const outerEnd = Math.max(e1, e2);
    let innerStart = Math.max(s1, s2);
    let innerEnd = Math.min(e1, e2);
    if (innerStart > innerEnd) {
        const mid = (innerStart + innerEnd) / 2;
        innerStart = mid;
        innerEnd = mid;
    }

    if (outerEnd <= outerStart) return null;
    return {
        start: outerStart,
        end: outerEnd,
        outerStart,
        innerStart,
        innerEnd,
        outerEnd
    };
}

function getWallPitchHeightAt(pitch, wallName, u, d) {
    const room = State.room;
    const H = room.height;
    const inter = getPitchInterval(pitch, wallName);
    if (!inter) return H;
    const R = pitch.run;
    const hk = pitch.kniestock;
    if (d < 0 || d >= R || R <= 0 || u < inter.outerStart || u > inter.outerEnd) return H;

    let h = hk + (H - hk) * (d / R);

    if (u < inter.innerStart && inter.innerStart > inter.outerStart) {
        const t = (u - inter.outerStart) / (inter.innerStart - inter.outerStart);
        const hStart = H - (H - hk) * t;
        h = Math.max(h, hStart);
    }
    if (u > inter.innerEnd && inter.outerEnd > inter.innerEnd) {
        const t = (inter.outerEnd - u) / (inter.outerEnd - inter.innerEnd);
        const hEnd = H - (H - hk) * t;
        h = Math.max(h, hEnd);
    }
    return Math.min(H, Math.max(hk, h));
}

function getCeilingHeightAt(x, y) {
    const room = State.room;
    let minHeight = room.height;

    if (room.pitches.top && room.pitches.top.enabled) {
        minHeight = Math.min(minHeight, getWallPitchHeightAt(room.pitches.top, 'top', x, y));
    }
    if (room.pitches.bottom && room.pitches.bottom.enabled) {
        minHeight = Math.min(minHeight, getWallPitchHeightAt(room.pitches.bottom, 'bottom', room.width - x, room.depth - y));
    }
    if (room.pitches.left && room.pitches.left.enabled) {
        minHeight = Math.min(minHeight, getWallPitchHeightAt(room.pitches.left, 'left', room.depth - y, x));
    }
    if (room.pitches.right && room.pitches.right.enabled) {
        minHeight = Math.min(minHeight, getWallPitchHeightAt(room.pitches.right, 'right', y, room.width - x));
    }

    return Math.max(0, minHeight);
}

// Compute positions of ceiling lamps based on room dimensions (single center or multi-lamp grid if > 600cm)
function getCeilingLampPositions(room = State.room) {
    const r = room || State.room;
    if (!r) return [];
    const lamps = [];
    const countX = (r && r.width > 600) ? 2 : 1;
    const countY = (r && r.depth > 600) ? 2 : 1;

    for (let ix = 0; ix < countX; ix++) {
        const x = r.width * (ix + 0.5) / countX;
        for (let iy = 0; iy < countY; iy++) {
            const y = r.depth * (iy + 0.5) / countY;
            lamps.push({ x, y });
        }
    }
    return lamps;
}

// Get corners of a rectangle furniture rotated around center
function getFurnitureCorners(f) {
    if (!f || f.shape !== 'rect') return [];
    const rad = ((f.rotation || 0) * Math.PI) / 180;
    const halfW = (f.w || 0) / 2;
    const halfL = (f.l || 0) / 2;

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
        if (!cornersA || !cornersB || cornersA.length < 4 || cornersB.length < 4) return false;

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

            // Test overlap with epsilon tolerance for flush contacts
            const EPS = 1e-5;
            if (maxA <= minB + EPS || maxB <= minA + EPS) {
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
        const EPS = 1e-4;
        const radSumEff = Math.max(0, radSum - EPS);
        return distSq < radSumEff * radSumEff;
    },

    checkCircleVsOBB(circleCenter, r, rectCenter, w, l, rotationDeg) {
        // Transform circle to rect's local space
        const rot = rotationDeg || 0;
        const rad = (-rot * Math.PI) / 180;
        const dx = circleCenter.x - rectCenter.x;
        const dy = circleCenter.y - rectCenter.y;
        
        // Rotate local offset
        const localX = dx * Math.cos(rad) - dy * Math.sin(rad);
        const localY = dx * Math.sin(rad) + dy * Math.cos(rad);

        // Find closest point on unrotated rect to local circle center
        const halfW = (w || 0) / 2;
        const halfL = (l || 0) / 2;
        const closestX = Math.max(-halfW, Math.min(halfW, localX));
        const closestY = Math.max(-halfL, Math.min(halfL, localY));

        // Distance in local space
        const diffX = localX - closestX;
        const diffY = localY - closestY;
        const distSq = diffX * diffX + diffY * diffY;

        const EPS = 1e-4;
        const rEff = Math.max(0, r - EPS);
        return distSq < rEff * rEff;
    },

    checkFurnitureCollision(f1, f2) {
        if (!f1 || !f2) return false;
        if (f1.collisionEnabled === false || f2.collisionEnabled === false) return false;

        // Disable collision for TVs (they sit on other furniture)
        const name1 = (f1.name || '').toLowerCase();
        const name2 = (f2.name || '').toLowerCase();
        const isTV1 = (f1.tvSize !== null && f1.tvSize !== undefined) || (!name1.includes('lowboard') && !name1.includes('sideboard') && !name1.includes('board') && (name1.includes('tv') || name1.includes('fernseher')));
        const isTV2 = (f2.tvSize !== null && f2.tvSize !== undefined) || (!name2.includes('lowboard') && !name2.includes('sideboard') && !name2.includes('board') && (name2.includes('tv') || name2.includes('fernseher')));
        if (isTV1 || isTV2) {
            return false;
        }

        // Disable collision for carpets / rugs (they sit under furniture)
        const isRug1 = Boolean(f1.isRug || name1.includes('teppich') || name1.includes('rug'));
        const isRug2 = Boolean(f2.isRug || name2.includes('teppich') || name2.includes('rug'));
        if (isRug1 || isRug2) {
            return false;
        }

        // Vertical span overlap check
        const h1 = (typeof f1.h === 'number') ? f1.h : ((typeof f1.height === 'number') ? f1.height : 0);
        const h2 = (typeof f2.h === 'number') ? f2.h : ((typeof f2.height === 'number') ? f2.height : 0);
        const elev1 = f1.elevation || 0;
        const elev2 = f2.elevation || 0;
        const top1 = elev1 + h1;
        const top2 = elev2 + h2;
        
        // No vertical overlap
        if (top1 <= elev2 + 0.1 || top2 <= elev1 + 0.1) {
            return false;
        }
        
        if (f1.shape === 'rect' && f2.shape === 'rect') {
            return this.checkOBBvsOBB(getFurnitureCorners(f1), getFurnitureCorners(f2));
        } else if (f1.shape === 'circle' && f2.shape === 'circle') {
            return this.checkCircleVsCircle({ x: f1.x, y: f1.y }, (f1.w || 0) / 2, { x: f2.x, y: f2.y }, (f2.w || 0) / 2);
        } else {
            // One rect, one circle
            const rect = f1.shape === 'rect' ? f1 : f2;
            const circle = f1.shape === 'circle' ? f1 : f2;
            return this.checkCircleVsOBB(
                { x: circle.x, y: circle.y },
                (circle.w || 0) / 2,
                { x: rect.x, y: rect.y },
                rect.w || 0,
                rect.l || 0,
                rect.rotation || 0
            );
        }
    },

    checkWallCollision(f, room = State.room) {
        if (!f || !room) return false;
        const EPS = 1e-4;
        if (f.shape === 'circle') {
            const r = (f.w || 0) / 2;
            return (f.x - r < -EPS || f.x + r > room.width + EPS || f.y - r < -EPS || f.y + r > room.depth + EPS);
        } else {
            // Rectangle: check all 4 corners
            const corners = getFurnitureCorners(f);
            for (let c of corners) {
                if (c.x < -EPS || c.x > room.width + EPS || c.y < -EPS || c.y > room.depth + EPS) {
                    return true;
                }
            }
        }
        return false;
    },

    clampFurnitureToRoom(f, room = State.room) {
        if (!f || !room) return false;
        const initialX = f.x;
        const initialY = f.y;

        if (f.shape === 'circle') {
            const r = (f.w || 0) / 2;
            const diam = r * 2;
            if (diam >= room.width) {
                f.x = room.width / 2;
            } else {
                f.x = Math.max(r, Math.min(room.width - r, f.x));
            }

            if (diam >= room.depth) {
                f.y = room.depth / 2;
            } else {
                f.y = Math.max(r, Math.min(room.depth - r, f.y));
            }
        } else {
            let corners = getFurnitureCorners(f);
            if (!corners || corners.length === 0) {
                const rad = ((f.rotation || 0) * Math.PI) / 180;
                const halfW = (f.w || 20) / 2;
                const halfL = (f.l || 20) / 2;
                const localCorners = [
                    new Vector2D(-halfW, -halfL),
                    new Vector2D(halfW, -halfL),
                    new Vector2D(halfW, halfL),
                    new Vector2D(-halfW, halfL)
                ];
                corners = localCorners.map(c => {
                    const r = c.rotate(rad);
                    return new Vector2D(f.x + r.x, f.y + r.y);
                });
            }

            let minX = Infinity, maxX = -Infinity;
            let minY = Infinity, maxY = -Infinity;
            for (let i = 0; i < corners.length; i++) {
                const c = corners[i];
                if (c.x < minX) minX = c.x;
                if (c.x > maxX) maxX = c.x;
                if (c.y < minY) minY = c.y;
                if (c.y > maxY) maxY = c.y;
            }

            const spanX = maxX - minX;
            if (spanX >= room.width) {
                f.x = room.width / 2;
            } else if (minX < 0) {
                f.x -= minX;
            } else if (maxX > room.width) {
                f.x -= (maxX - room.width);
            }

            const spanY = maxY - minY;
            if (spanY >= room.depth) {
                f.y = room.depth / 2;
            } else if (minY < 0) {
                f.y -= minY;
            } else if (maxY > room.depth) {
                f.y -= (maxY - room.depth);
            }
        }
        return f.x !== initialX || f.y !== initialY;
    },

    checkRoofPitchCollision(f) {
        if (!f || f.isObstacle || f.isRug) return false;
        
        // Defensively resolve height: support f.h and f.height
        const fHeight = (typeof f.h === 'number') ? f.h : ((typeof f.height === 'number') ? f.height : 0);
        const fElev = (typeof f.elevation === 'number') ? f.elevation : 0;
        const totalHeight = fElev + fHeight;
        
        if (f.shape === 'circle') {
            const r = (f.w || 0) / 2;
            const pointsToCheck = [{ x: f.x, y: f.y }];
            
            // Sample 32 perimeter points at 11.25-degree intervals to eliminate blind spots near partial pitch transitions
            for (let i = 0; i < 32; i++) {
                const angle = (i * Math.PI) / 16;
                pointsToCheck.push({
                    x: f.x + r * Math.cos(angle),
                    y: f.y + r * Math.sin(angle)
                });
            }
            
            for (let p of pointsToCheck) {
                const ceilH = getCeilingHeightAt(p.x, p.y);
                if (totalHeight > ceilH) return true;
            }
        } else {
            const corners = getFurnitureCorners(f);
            corners.push(new Vector2D(f.x, f.y));
            
            if (corners.length >= 4) {
                corners.push(new Vector2D((corners[0].x + corners[1].x) / 2, (corners[0].y + corners[1].y) / 2));
                corners.push(new Vector2D((corners[1].x + corners[2].x) / 2, (corners[1].y + corners[2].y) / 2));
                corners.push(new Vector2D((corners[2].x + corners[3].x) / 2, (corners[2].y + corners[3].y) / 2));
                corners.push(new Vector2D((corners[3].x + corners[0].x) / 2, (corners[3].y + corners[0].y) / 2));
            }

            for (let p of corners) {
                const ceilH = getCeilingHeightAt(p.x, p.y);
                if (totalHeight > ceilH) return true;
            }
        }
        return false;
    },

    updateAllCollisions() {
        // Automatically calculate elevation for all TVs based on what is underneath them
        State.furniture.forEach(f => {
            const nameLower = (f.name || '').toLowerCase();
            const isTV = (f.tvSize !== null && f.tvSize !== undefined) || (!nameLower.includes('lowboard') && !nameLower.includes('sideboard') && !nameLower.includes('board') && (nameLower.includes('tv') || nameLower.includes('fernseher')));
            if (isTV) {
                let highestSurface = 0;
                State.furniture.forEach(o => {
                    if (o === f) return; // skip self
                    const oName = (o.name || '').toLowerCase();
                    const oIsTV = (o.tvSize !== null && o.tvSize !== undefined) || (!oName.includes('lowboard') && !oName.includes('sideboard') && !oName.includes('board') && (oName.includes('tv') || oName.includes('fernseher')));
                    if (oIsTV) return; // skip other TVs
                    
                    // Translate and rotate f's center into o's local coordinates
                    const dx = f.x - o.x;
                    const dy = f.y - o.y;
                    const rad = -(o.rotation * Math.PI) / 180;
                    const cos = Math.cos(rad);
                    const sin = Math.sin(rad);
                    
                    const lx = dx * cos - dy * sin;
                    const ly = dx * sin + dy * cos;
                    
                    const halfW = o.w / 2;
                    const halfL = o.shape === 'circle' ? o.w / 2 : o.l / 2;
                    
                    let inside = false;
                    if (o.shape === 'circle') {
                        inside = (lx * lx + ly * ly) <= halfW * halfW;
                    } else {
                        inside = (lx >= -halfW && lx <= halfW && ly >= -halfL && ly <= halfL);
                    }
                    
                    if (inside) {
                        const oElev = o.elevation || 0;
                        const oHeight = (typeof o.h === 'number') ? o.h : ((typeof o.height === 'number') ? o.height : 0);
                        const surface = oElev + oHeight;
                        if (surface > highestSurface) {
                            highestSurface = surface;
                        }
                    }
                });
                
                f.elevation = highestSurface;
                if (Viewer3D.renderer) {
                    Viewer3D.updateFurniture3D(f);
                }
            }
        });

        if (!State.settings.collisionEnabled) {
            State.furniture.forEach(f => f.isColliding = false);
            const badge = typeof document !== 'undefined' ? document.getElementById('collision-alert') : null;
            if (badge) badge.classList.add('hidden');
            return false;
        }

        // Capture previous collision state for selective 3D mesh updates
        const prevColliding = new Map(State.furniture.map(f => [f, f.isColliding]));

        let anyCollision = false;

        // Reset all collision flags
        State.furniture.forEach(f => f.isColliding = false);

        // Check Wall, Roof Pitch, and Pairwise Furniture Collisions
        for (let i = 0; i < State.furniture.length; i++) {
            const f1 = State.furniture[i];
            if (f1.collisionEnabled === false) continue;

            const isRug1 = Boolean(f1.isRug || (f1.name && (f1.name.toLowerCase().includes('teppich') || f1.name.toLowerCase().includes('rug'))));

            // Check vs wall boundaries
            if (this.checkWallCollision(f1)) {
                f1.isColliding = true;
                anyCollision = true;
            }
            
            // Check vs roof pitches (unless it's a rug)
            if (!isRug1 && this.checkRoofPitchCollision(f1)) {
                f1.isColliding = true;
                anyCollision = true;
            }

            // Pairwise Furniture vs Furniture collision (SAT OBB, Circle, Elevation)
            for (let j = i + 1; j < State.furniture.length; j++) {
                const f2 = State.furniture[j];
                if (f2.collisionEnabled === false) continue;

                if (this.checkFurnitureCollision(f1, f2)) {
                    f1.isColliding = true;
                    f2.isColliding = true;
                    anyCollision = true;
                }
            }
        }

        // Show/hide collision badge
        const badge = typeof document !== 'undefined' ? document.getElementById('collision-alert') : null;
        if (badge) {
            if (anyCollision) badge.classList.remove('hidden');
            else badge.classList.add('hidden');
        }

        // Synchronize 3D meshes whose collision state changed
        if (typeof Viewer3D !== 'undefined' && Viewer3D && Viewer3D.renderer) {
            State.furniture.forEach(f => {
                if (prevColliding.get(f) !== f.isColliding) {
                    Viewer3D.updateFurniture3D(f);
                }
            });
        }

        return anyCollision;
    }
};

// --- SMART SNAPPING & DYNAMIC HUD ALIGNMENT GUIDES ---
const SmartSnapping = {
    DEFAULT_THRESHOLD: 10, // cm world units

    getExtents(f) {
        if (!f) return { halfSpanX: 0, halfSpanY: 0 };
        if (f.shape === 'circle') {
            const r = (f.w || 0) / 2;
            return { halfSpanX: r, halfSpanY: r };
        }
        const halfW = (f.w || 0) / 2;
        const halfL = (f.l || 0) / 2;
        const rot = ((f.rotation || 0) * Math.PI) / 180;
        const cos = Math.abs(Math.cos(rot));
        const sin = Math.abs(Math.sin(rot));
        return {
            halfSpanX: halfW * cos + halfL * sin,
            halfSpanY: halfW * sin + halfL * cos
        };
    },

    computeSnap(draggingItem, otherFurniture = [], room = State.room, threshold = 10, options = {}) {
        if (!draggingItem || !room) {
            return {
                snappedX: draggingItem ? draggingItem.x : 0,
                snappedY: draggingItem ? draggingItem.y : 0,
                guides: [],
                snappedAxes: { x: false, y: false }
            };
        }

        const { halfSpanX, halfSpanY } = this.getExtents(draggingItem);
        const dragX = draggingItem.x;
        const dragY = draggingItem.y;

        const dragRefsX = [
            { type: 'left', offset: -halfSpanX, val: dragX - halfSpanX },
            { type: 'center', offset: 0, val: dragX },
            { type: 'right', offset: halfSpanX, val: dragX + halfSpanX }
        ];

        const dragRefsY = [
            { type: 'top', offset: -halfSpanY, val: dragY - halfSpanY },
            { type: 'center', offset: 0, val: dragY },
            { type: 'bottom', offset: halfSpanY, val: dragY + halfSpanY }
        ];

        // 1. Collect X Candidates
        const targetsX = [];
        // Room Centerline (Priority 2)
        targetsX.push({ val: room.width / 2, type: 'room-center', label: 'Raummitte', priority: 2 });
        // Wall Boundaries (Priority 1)
        targetsX.push({ val: 0, type: 'wall', label: 'Wand', priority: 1, side: 'left' });
        targetsX.push({ val: room.width, type: 'wall', label: 'Wand', priority: 1, side: 'right' });
        // Sibling Furniture (Priority 3)
        for (const s of otherFurniture) {
            if (s.id === draggingItem.id || s === draggingItem) continue;
            const ext = this.getExtents(s);
            const name = s.name || 'Möbel';
            targetsX.push({ val: s.x - ext.halfSpanX, type: 'furniture-edge', label: name, priority: 3, item: s });
            targetsX.push({ val: s.x, type: 'furniture-center', label: name, priority: 3, item: s });
            targetsX.push({ val: s.x + ext.halfSpanX, type: 'furniture-edge', label: name, priority: 3, item: s });
        }

        // 2. Collect Y Candidates
        const targetsY = [];
        // Room Centerline (Priority 2)
        targetsY.push({ val: room.depth / 2, type: 'room-center', label: 'Raummitte', priority: 2 });
        // Wall Boundaries (Priority 1)
        targetsY.push({ val: 0, type: 'wall', label: 'Wand', priority: 1, side: 'top' });
        targetsY.push({ val: room.depth, type: 'wall', label: 'Wand', priority: 1, side: 'bottom' });
        // Sibling Furniture (Priority 3)
        for (const s of otherFurniture) {
            if (s.id === draggingItem.id || s === draggingItem) continue;
            const ext = this.getExtents(s);
            const name = s.name || 'Möbel';
            targetsY.push({ val: s.y - ext.halfSpanY, type: 'furniture-edge', label: name, priority: 3, item: s });
            targetsY.push({ val: s.y, type: 'furniture-center', label: name, priority: 3, item: s });
            targetsY.push({ val: s.y + ext.halfSpanY, type: 'furniture-edge', label: name, priority: 3, item: s });
        }

        // 3. Evaluate X matches
        let bestSnapX = null;
        for (const t of targetsX) {
            for (const dRef of dragRefsX) {
                // Prevent snapping past walls
                if (t.type === 'wall' && t.side === 'left' && dRef.type !== 'left') continue;
                if (t.type === 'wall' && t.side === 'right' && dRef.type !== 'right') continue;

                const delta = t.val - dRef.val;
                const dist = Math.abs(delta);
                if (dist <= threshold) {
                    if (!bestSnapX || dist < bestSnapX.dist || (dist === bestSnapX.dist && t.priority > bestSnapX.target.priority)) {
                        bestSnapX = {
                            dist,
                            delta,
                            snappedX: dragX + delta,
                            guideVal: t.val,
                            target: t,
                            dragRef: dRef
                        };
                    }
                }
            }
        }

        // 4. Evaluate Y matches
        let bestSnapY = null;
        for (const t of targetsY) {
            for (const dRef of dragRefsY) {
                if (t.type === 'wall' && t.side === 'top' && dRef.type !== 'top') continue;
                if (t.type === 'wall' && t.side === 'bottom' && dRef.type !== 'bottom') continue;

                const delta = t.val - dRef.val;
                const dist = Math.abs(delta);
                if (dist <= threshold) {
                    if (!bestSnapY || dist < bestSnapY.dist || (dist === bestSnapY.dist && t.priority > bestSnapY.target.priority)) {
                        bestSnapY = {
                            dist,
                            delta,
                            snappedY: dragY + delta,
                            guideVal: t.val,
                            target: t,
                            dragRef: dRef
                        };
                    }
                }
            }
        }

        const guides = [];
        const snappedAxes = { x: false, y: false };
        let finalX = dragX;
        let finalY = dragY;

        if (bestSnapX) {
            finalX = Math.round(bestSnapX.snappedX * 10000) / 10000;
            snappedAxes.x = true;
            guides.push({
                x1: bestSnapX.guideVal,
                y1: 0,
                x2: bestSnapX.guideVal,
                y2: room.depth,
                axis: 'x',
                type: bestSnapX.target.type,
                label: bestSnapX.target.label,
                snapPos: bestSnapX.guideVal
            });
        }

        if (bestSnapY) {
            finalY = Math.round(bestSnapY.snappedY * 10000) / 10000;
            snappedAxes.y = true;
            guides.push({
                x1: 0,
                y1: bestSnapY.guideVal,
                x2: room.width,
                y2: bestSnapY.guideVal,
                axis: 'y',
                type: bestSnapY.target.type,
                label: bestSnapY.target.label,
                snapPos: bestSnapY.guideVal
            });
        }

        return {
            snappedX: finalX,
            snappedY: finalY,
            guides,
            snappedAxes
        };
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

// Project coordinates onto a specific wall
function projectToSpecificWall(mx, my, wall) {
    const room = State.room;
    if (wall === 'top') {
        return Math.max(0, Math.min(room.width, mx));
    } else if (wall === 'right') {
        return Math.max(0, Math.min(room.depth, my));
    } else if (wall === 'bottom') {
        return Math.max(0, Math.min(room.width, room.width - mx));
    } else { // left
        return Math.max(0, Math.min(room.depth, room.depth - my));
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

// Helper to generate a 3D box geometry with a slanted top (to conform to roof pitch)
function createSlantedBoxGeometry(w, l, h0, h1, h2, h3) {
    const geom = new THREE.BufferGeometry();
    
    const p0 = { x: -w/2, y: 0, z: -l/2 }; // NW bottom
    const p1 = { x: w/2, y: 0, z: -l/2 };  // NE bottom
    const p2 = { x: w/2, y: 0, z: l/2 };   // SE bottom
    const p3 = { x: -w/2, y: 0, z: l/2 };  // SW bottom
    
    const p4 = { x: -w/2, y: h0, z: -l/2 }; // NW top
    const p5 = { x: w/2, y: h1, z: -l/2 };  // NE top
    const p6 = { x: w/2, y: h2, z: l/2 };   // SE top
    const p7 = { x: -w/2, y: h3, z: l/2 };  // SW top
    
    const vertices = new Float32Array([
        // Bottom (facing -Y)
        p0.x, p0.y, p0.z,  p2.x, p2.y, p2.z,  p3.x, p3.y, p3.z,
        p0.x, p0.y, p0.z,  p1.x, p1.y, p1.z,  p2.x, p2.y, p2.z,
        
        // Top (facing +Y)
        p4.x, p4.y, p4.z,  p5.x, p5.y, p5.z,  p6.x, p6.y, p6.z,
        p4.x, p4.y, p4.z,  p6.x, p6.y, p6.z,  p7.x, p7.y, p7.z,
        
        // Front (+Z)
        p3.x, p3.y, p3.z,  p2.x, p2.y, p2.z,  p6.x, p6.y, p6.z,
        p3.x, p3.y, p3.z,  p6.x, p6.y, p6.z,  p7.x, p7.y, p7.z,
        
        // Back (-Z)
        p1.x, p1.y, p1.z,  p0.x, p0.y, p0.z,  p4.x, p4.y, p4.z,
        p1.x, p1.y, p1.z,  p4.x, p4.y, p4.z,  p5.x, p5.y, p5.z,
        
        // Left (-X)
        p0.x, p0.y, p0.z,  p3.x, p3.y, p3.z,  p7.x, p7.y, p7.z,
        p0.x, p0.y, p0.z,  p7.x, p7.y, p7.z,  p4.x, p4.y, p4.z,
        
        // Right (+X)
        p2.x, p2.y, p2.z,  p1.x, p1.y, p1.z,  p5.x, p5.y, p5.z,
        p2.x, p2.y, p2.z,  p5.x, p5.y, p5.z,  p6.x, p6.y, p6.z
    ]);
    
    geom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geom.computeVertexNormals();
    return geom;
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
    
    if (elem.type === 'door' || elem.type === 'double-door') {
        const dir = elem.direction || 'in';
        const isIn = dir === 'in';
        
        const inX = Math.abs(lx) <= halfW + 10;
        const swingDepth = elem.type === 'double-door' ? halfW : elem.w;
        const inY = isIn 
            ? (ly >= -10 && ly <= swingDepth + 10) 
            : (ly >= -swingDepth - 10 && ly <= 10);
            
        return inX && inY;
    } else if (elem.type === 'window') {
        return Math.abs(lx) <= halfW + 10 && Math.abs(ly) <= 20;
    } else if (elem.type === 'skylight') {
        const pitch = State.room.pitches[elem.wall];
        let cosAlpha = 1.0;
        if (pitch && pitch.enabled) {
            const slopeAngleRad = Math.atan((State.room.height - pitch.kniestock) / pitch.run);
            cosAlpha = Math.cos(slopeAngleRad);
        }
        const startH = (elem.distanceFromWall || 0) * cosAlpha;
        const endH = ((elem.distanceFromWall || 0) + elem.h) * cosAlpha;
        return Math.abs(lx) <= halfW + 10 && ly >= startH - 10 && ly <= endH + 10;
    }
    return false;
}

// Checks if an element overlaps with any other element on the same wall
function checkElementOverlap(item, wall, position) {
    const pos = position !== undefined ? position : item.position;
    const halfW = item.w / 2;
    
    const rangeStart = pos - halfW;
    const rangeEnd = pos + halfW;
    
    for (let el of State.elements) {
        if (el.id === item.id) continue;
        if (el.wall !== wall) continue;
        
        if (item.type === 'skylight' && el.type === 'skylight') {
            // Check 2D bounding box overlap for skylights on the slant
            const dist1 = item.distanceFromWall || 0;
            const dist2 = el.distanceFromWall || 0;
            
            const xOverlap = Math.max(rangeStart, el.position - el.w / 2) < Math.min(rangeEnd, el.position + el.w / 2);
            const yOverlap = Math.max(dist1, dist2) < Math.min(dist1 + item.h, dist2 + el.h);
            
            if (xOverlap && yOverlap) return true;
        } else if (item.type !== 'skylight' && el.type !== 'skylight') {
            // Check 1D overlap along the wall for doors and windows
            const overlap = Math.max(rangeStart, el.position - el.w / 2) < Math.min(rangeEnd, el.position + el.w / 2);
            if (overlap) return true;
        }
    }
    return false;
}

// Clamps skylight dimensions to fit within the roof slant boundary
function clampSkylightConstraints(elem) {
    if (elem.type !== 'skylight') return;
    
    const pitch = State.room.pitches[elem.wall];
    const inter = getPitchInterval(pitch, elem.wall);
    if (!inter) return;
    
    // Clamp along wall within main pitch interval
    const halfW = elem.w / 2;
    const minPos = inter.innerStart + halfW;
    const maxPos = Math.max(minPos, inter.innerEnd - halfW);
    elem.position = Math.max(minPos, Math.min(maxPos, elem.position));
    
    const H = State.room.height;
    const hk = pitch.kniestock;
    const r = pitch.run;
    
    const slopeAngleRad = Math.atan((H - hk) / r);
    const cosAlpha = Math.cos(slopeAngleRad);
    
    // sMax is the maximum slanted length of the roof slant
    const sMax = r / cosAlpha;
    
    // Clamp the window length (elem.h) so it does not exceed the roof slant length
    elem.h = Math.max(30, Math.min(sMax, elem.h));
    
    // Clamp distanceFromWall (which is the slanted distance of the lower edge from the wall)
    if (elem.distanceFromWall === undefined) elem.distanceFromWall = 60;
    elem.distanceFromWall = Math.max(0, Math.min(sMax - elem.h, elem.distanceFromWall));
}

// Validates if a wall is suitable for a given element type and dimensions (preventing clipping with ceiling)
function isValidWallForElement(item, wall, position) {
    const pos = position !== undefined ? position : item.position;
    const halfW = (item.w || 0) / 2;
    
    // 1. Skylights must be on a slanted wall within active pitch interval
    if (item.type === 'skylight') {
        const inter = getPitchInterval(State.room.pitches[wall], wall);
        if (!inter) return false;
        return (pos - halfW >= inter.outerStart - 5 && pos + halfW <= inter.outerEnd + 5);
    }
    
    // 2. Doors and windows must not exceed the ceiling height at their footprint
    const topY = (item.type === 'window') 
        ? (item.sillHeight !== undefined ? item.sillHeight : 90) + item.h 
        : item.h;
        
    // Check 3 points along the element's width: left edge, center, right edge
    const testPositions = [pos - halfW, pos, pos + halfW];
    
    for (let p of testPositions) {
        const coords = getWallCoordinates(wall, p);
        const ceilH = getCeilingHeightAt(coords.x, coords.y);
        if (topY > ceilH) {
            return false; // collides with ceiling!
        }
    }
    
    // 3. Check overlap with other elements on the same wall
    if (checkElementOverlap(item, wall, pos)) {
        return false;
    }
    
    return true;
}

// Helper to draw a single parallel dimension line with architectural ticks, witness lines and centered text
function drawDimensionLine(ctx, x1, y1, x2, y2, text, options = {}) {
    if (Math.abs(x1 - x2) < 0.1 && Math.abs(y1 - y2) < 0.1) return;
    
    // Ensure we always draw from left-to-right, or if vertical, from top-to-bottom
    let swap = false;
    if (Math.abs(y1 - y2) < 0.1) {
        if (x1 > x2) swap = true;
    } else if (Math.abs(x1 - x2) < 0.1) {
        if (y1 > y2) swap = true;
    } else {
        if (x1 > x2) swap = true;
    }
    
    let drawX1 = x1, drawY1 = y1, drawX2 = x2, drawY2 = y2;
    if (swap) {
        drawX1 = x2; drawY1 = y2;
        drawX2 = x1; drawY2 = y1;
    }
    
    ctx.save();
    
    // Witness lines (Hilfsmaßlinien) from inner wall surface to dimension line
    if (options.witness) {
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        if (options.witness.top) {
            ctx.moveTo(drawX1, 0); ctx.lineTo(drawX1, drawY1 - 3);
            ctx.moveTo(drawX2, 0); ctx.lineTo(drawX2, drawY2 - 3);
        } else if (options.witness.bottom) {
            const wPos = options.witness.wallPos !== undefined ? options.witness.wallPos : State.room.depth;
            ctx.moveTo(drawX1, wPos); ctx.lineTo(drawX1, drawY1 + 3);
            ctx.moveTo(drawX2, wPos); ctx.lineTo(drawX2, drawY2 + 3);
        } else if (options.witness.left) {
            ctx.moveTo(0, drawY1); ctx.lineTo(drawX1 - 3, drawY1);
            ctx.moveTo(0, drawY2); ctx.lineTo(drawX2 - 3, drawY2);
        } else if (options.witness.right) {
            const wPos = options.witness.wallPos !== undefined ? options.witness.wallPos : State.room.width;
            ctx.moveTo(wPos, drawY1); ctx.lineTo(drawX1 + 3, drawY1);
            ctx.moveTo(wPos, drawY2); ctx.lineTo(drawX2 + 3, drawY2);
        }
        ctx.stroke();
    }
    
    ctx.strokeStyle = '#64748b'; // Slate-500
    ctx.lineWidth = 1.0;
    ctx.fillStyle = '#cbd5e1'; // Slate-300
    ctx.font = '9px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Draw main line
    ctx.beginPath();
    ctx.moveTo(drawX1, drawY1);
    ctx.lineTo(drawX2, drawY2);
    ctx.stroke();
    
    // Draw architectural ticks (slanted lines at 45 degrees)
    const tickLen = 4;
    ctx.strokeStyle = '#94a3b8'; // Slate-400
    ctx.lineWidth = 1.2;
    
    const drawTick = (x, y) => {
        ctx.beginPath();
        ctx.moveTo(x - tickLen, y + tickLen);
        ctx.lineTo(x + tickLen, y - tickLen);
        ctx.stroke();
    };
    
    drawTick(drawX1, drawY1);
    drawTick(drawX2, drawY2);
    
    // Draw Text with background mask to avoid overlapping lines/grid
    const midX = (drawX1 + drawX2) / 2;
    const midY = (drawY1 + drawY2) / 2;
    const angle = Math.atan2(drawY2 - drawY1, drawX2 - drawX1);
    
    ctx.translate(midX, midY);
    ctx.rotate(angle);
    
    const metrics = ctx.measureText(text);
    const isLight = typeof document !== 'undefined' && document.documentElement && document.documentElement.getAttribute('data-theme') === 'light';
    ctx.fillStyle = isLight ? '#f8fafc' : '#09090b'; // Dynamic canvas background to cleanly mask dimension line under text
    ctx.fillRect(-metrics.width / 2 - 3, -6, metrics.width + 6, 12);
    
    ctx.fillStyle = isLight ? '#1e293b' : '#cbd5e1'; // Dark Slate in light mode, Slate-300 in dark mode
    ctx.fillText(text, 0, 0);
    
    ctx.restore();
}

function getWallSegments(wall) {
    const room = State.room;
    const wallElems = State.elements.filter(el => el.wall === wall);
    const wallChimneys = State.furniture.filter(f => f.isObstacle && getClosestWall(f).wall === wall);
    
    if (wallElems.length === 0 && wallChimneys.length === 0) return [];
    
    const L = (wall === 'top' || wall === 'bottom') ? room.width : room.depth;
    
    const footprints = [];
    
    // Add wall elements
    wallElems.forEach(el => {
        const isReversed = (wall === 'bottom' || wall === 'left');
        const center = isReversed ? (L - el.position) : el.position;
        const start = Math.max(0, Math.min(L, center - el.w / 2));
        const end = Math.max(0, Math.min(L, center + el.w / 2));
        if (start < end) {
            footprints.push({
                id: el.id,
                start: start,
                end: end,
                w: end - start
            });
        }
    });
    
    // Add chimneys
    wallChimneys.forEach(f => {
        const isRotated = (Math.round((f.rotation || 0) / 90) % 2 === 1);
        let w, pos;
        if (wall === 'top' || wall === 'bottom') {
            w = isRotated ? f.l : f.w;
            pos = f.x;
        } else {
            w = isRotated ? f.w : f.l;
            pos = f.y;
        }
        
        const isReversed = (wall === 'bottom' || wall === 'left');
        const center = isReversed ? (L - pos) : pos;
        const start = Math.max(0, Math.min(L, center - w / 2));
        const end = Math.max(0, Math.min(L, center + w / 2));
        if (start < end) {
            footprints.push({
                id: f.id,
                start: start,
                end: end,
                w: end - start
            });
        }
    });
    
    footprints.sort((a, b) => a.start - b.start);
    
    const segments = [];
    let current = 0;
    
    footprints.forEach(fp => {
        if (fp.start > current) {
            segments.push({ start: current, end: fp.start, label: formatDim(fp.start - current) });
        }
        segments.push({ start: fp.start, end: fp.end, label: formatDim(fp.w), isElement: true });
        current = fp.end;
    });
    
    if (L > current) {
        segments.push({ start: current, end: L, label: formatDim(L - current) });
    }
    
    return segments;
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
        
        // Key listener for deletion and undo/redo
        window.addEventListener('keydown', e => {
            if (e.key === 'Delete' || e.key === 'Backspace') {
                // Only delete if we are not typing in an input
                if (document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'SELECT') {
                    this.deleteSelected();
                }
            }
            
            // Undo: Ctrl+Z or Cmd+Z
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
                e.preventDefault();
                History.undo();
            }
            
            // Redo: Ctrl+Y, Cmd+Y, or Ctrl+Shift+Z / Cmd+Shift+Z
            if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') || 
                ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')) {
                e.preventDefault();
                History.redo();
            }

            // Escape: Deselect active item and close properties inspector
            if (e.key === 'Escape' && State.selectedItem) {
                selectItem(null, null);
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
        
        // Auto-center room if the user hasn't manually panned/zoomed yet
        if (!State.editor2D.hasManuallyPannedOrZoomed) {
            this.resetView();
        } else {
            this.draw();
        }
    },
    
    resetView() {
        const wrapper = this.canvas.parentElement;
        if (!wrapper || wrapper.clientWidth <= 100 || wrapper.clientHeight <= 100) return;
        const padding = 50; // pixels
        const extraDim = 50; // cm for outer dimension lines outside walls
        const scaleX = (wrapper.clientWidth - padding * 2) / (State.room.width + extraDim * 2);
        const scaleY = (wrapper.clientHeight - padding * 2) / (State.room.depth + extraDim * 2);
        
        State.editor2D.zoom = Math.max(0.1, Math.min(scaleX, scaleY, 1.5));
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
        
        // Ensure skylights conform to constraints before drawing
        State.elements.forEach(el => {
            if (el.type === 'skylight') clampSkylightConstraints(el);
        });
        
        // Clear
        const isLight = typeof document !== 'undefined' && document.documentElement && document.documentElement.getAttribute('data-theme') === 'light';
        ctx.fillStyle = isLight ? '#f8fafc' : '#09090b'; // Dynamic canvas background
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
        
        // 6.5. Draw Ceiling Lamps (Electrical standard symbol ⊗ per IEC 60617)
        this.drawCeilingLamps(ctx);

        // 7. Draw Dimensions & Chains
        this.drawDimensions(ctx);
        
        // 7.5. Draw Smart Snapping Dynamic HUD Guides
        this.drawSnapGuides(ctx);

        // 8. Draw Walkthrough Camera Radar Frustum Cone
        if (typeof Viewer3D !== 'undefined' && Viewer3D && (Viewer3D.isWalkthrough || Viewer3D.showRadarAlways)) {
            this.drawCameraRadar(ctx);
        }

        ctx.restore();
    },
    
    drawSnapGuides(ctx) {
        const guides = State.editor2D.activeGuides;
        if (!guides || guides.length === 0) return;

        ctx.save();
        const zoom = State.editor2D.zoom || 1;
        const lineWidth = 1.5 / zoom;
        const dash = [6 / zoom, 4 / zoom];

        for (const g of guides) {
            // 1. Dashed Cyan Alignment Line
            ctx.strokeStyle = '#06b6d4';
            ctx.lineWidth = lineWidth;
            ctx.setLineDash(dash);
            ctx.beginPath();
            ctx.moveTo(g.x1, g.y1);
            ctx.lineTo(g.x2, g.y2);
            ctx.stroke();

            // 2. HUD Alignment Badge Pill
            if (g.label) {
                ctx.setLineDash([]);
                const text = g.label;
                const fontSize = Math.max(9, Math.round(11 / zoom));
                ctx.font = `600 ${fontSize}px Inter, sans-serif`;
                const textMetrics = ctx.measureText(text);
                const padX = 6 / zoom;
                const padY = 3 / zoom;
                const badgeW = textMetrics.width + padX * 2;
                const badgeH = fontSize + padY * 2;

                let bx, by;
                if (g.axis === 'x') {
                    bx = g.snapPos - badgeW / 2;
                    by = 12 / zoom;
                } else {
                    bx = 12 / zoom;
                    by = g.snapPos - badgeH / 2;
                }

                // Dark Pill Background
                ctx.fillStyle = 'rgba(11, 15, 25, 0.9)';
                ctx.strokeStyle = '#06b6d4';
                ctx.lineWidth = 1 / zoom;
                
                const rad = 3 / zoom;
                ctx.beginPath();
                if (typeof ctx.roundRect === 'function') {
                    ctx.roundRect(bx, by, badgeW, badgeH, rad);
                } else {
                    ctx.rect(bx, by, badgeW, badgeH);
                }
                ctx.fill();
                ctx.stroke();

                // Text
                ctx.fillStyle = '#38bdf8'; // Light Cyan / Sky
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(text, bx + badgeW / 2, by + badgeH / 2);
            }
        }
        ctx.restore();
    },

    drawCameraRadar(ctx) {
        if (typeof Viewer3D === 'undefined' || !Viewer3D) return;
        if (!Viewer3D.camera && typeof THREE !== 'undefined' && THREE.PerspectiveCamera) {
            Viewer3D.camera = new THREE.PerspectiveCamera(45, 1, 1, 3000);
        }
        if (!Viewer3D.camera || !Viewer3D.camera.position) return;

        const room = State.room;
        // Convert 3D camera position to 2D room coordinates
        const px = Viewer3D.camera.position.x + room.width / 2;
        const py = Viewer3D.camera.position.z + room.depth / 2;

        // Compute 2D heading angle from camera world direction or walkthroughYaw
        let yaw2D = 0;
        if (Viewer3D.isWalkthrough && typeof Viewer3D.walkthroughYaw === 'number') {
            const fwdX = -Math.sin(Viewer3D.walkthroughYaw);
            const fwdZ = -Math.cos(Viewer3D.walkthroughYaw);
            yaw2D = Math.atan2(fwdZ, fwdX);
        } else if (Viewer3D.camera.getWorldDirection && typeof THREE !== 'undefined' && THREE.Vector3) {
            const fwd = new THREE.Vector3();
            Viewer3D.camera.getWorldDirection(fwd);
            yaw2D = Math.atan2(fwd.z, fwd.x);
        }

        ctx.save();
        const zoom = Math.max(0.1, Math.abs(State.editor2D.zoom) || 1);
        const fovDeg = 65;
        const fovRad = (fovDeg * Math.PI) / 180;
        const coneRadius = 100; // 100 cm range

        const startAngle = yaw2D - fovRad / 2;
        const endAngle = yaw2D + fovRad / 2;

        // 1. Radar Frustum Cone Sector (FOV)
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.arc(px, py, coneRadius, startAngle, endAngle);
        ctx.closePath();
        ctx.fillStyle = 'rgba(6, 182, 212, 0.22)';
        ctx.fill();
        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = 1.5 / zoom;
        ctx.stroke();

        // 2. Mid-distance arc (50 cm)
        ctx.beginPath();
        ctx.arc(px, py, coneRadius * 0.5, startAngle, endAngle);
        ctx.strokeStyle = 'rgba(6, 182, 212, 0.35)';
        ctx.lineWidth = 1 / zoom;
        ctx.stroke();

        // 3. Centerline Look Ray
        ctx.beginPath();
        ctx.setLineDash([4 / zoom, 3 / zoom]);
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(yaw2D) * (coneRadius + 15), py + Math.sin(yaw2D) * (coneRadius + 15));
        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = 1.2 / zoom;
        ctx.stroke();
        ctx.setLineDash([]);

        // 4. Player Position Indicator
        // Outer subtle glow
        ctx.beginPath();
        ctx.arc(px, py, 9 / zoom, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(6, 182, 212, 0.3)';
        ctx.fill();

        // Core dot
        ctx.beginPath();
        ctx.arc(px, py, 5.5 / zoom, 0, Math.PI * 2);
        ctx.fillStyle = '#06b6d4';
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.8 / zoom;
        ctx.stroke();

        // Direction pointer tick
        ctx.beginPath();
        ctx.moveTo(px + Math.cos(yaw2D) * (5.5 / zoom), py + Math.sin(yaw2D) * (5.5 / zoom));
        ctx.lineTo(px + Math.cos(yaw2D) * (11 / zoom), py + Math.sin(yaw2D) * (11 / zoom));
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2 / zoom;
        ctx.stroke();

        ctx.restore();
    },
    
    drawCeilingLamps(ctx) {
        const lamps = getCeilingLampPositions(State.room);
        const isLit = State.settings.ceilingLampsEnabled !== false;

        lamps.forEach(lamp => {
            ctx.save();
            ctx.translate(lamp.x, lamp.y);

            // 1. Illumination halo in 2D if light is switched on
            if (isLit) {
                const glowRadius = 45;
                const grad = ctx.createRadialGradient(0, 0, 4, 0, 0, glowRadius);
                grad.addColorStop(0, 'rgba(251, 191, 36, 0.22)');
                grad.addColorStop(0.5, 'rgba(251, 191, 36, 0.08)');
                grad.addColorStop(1, 'rgba(251, 191, 36, 0)');
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(0, 0, glowRadius, 0, Math.PI * 2);
                ctx.fill();
            }

            // 2. Standard Electrical Symbol (Circle with diagonal cross ⊗ per IEC 60617)
            const radius = 10;
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
            ctx.fillStyle = isLit ? 'rgba(254, 243, 199, 0.9)' : 'rgba(30, 41, 59, 0.75)';
            ctx.fill();
            ctx.strokeStyle = isLit ? '#d97706' : '#64748b';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Diagonal cross lines
            const d = radius * 0.7071;
            ctx.beginPath();
            ctx.moveTo(-d, -d);
            ctx.lineTo(d, d);
            ctx.moveTo(d, -d);
            ctx.lineTo(-d, d);
            ctx.strokeStyle = isLit ? '#92400e' : '#475569';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            ctx.restore();
        });
    },

    drawDimensions(ctx) {
        const room = State.room;
        const wallThick = 10;
        const chainOffset = wallThick + 16; // 26 cm: outer chain line
        const totalOffset = wallThick + 34; // 44 cm: outer overall room dimension line
        
        const walls = ['top', 'right', 'bottom', 'left'];
        
        walls.forEach(w => {
            const segments = getWallSegments(w);
            
            const witnessOpt = {
                top: { top: true },
                bottom: { bottom: true, wallPos: room.depth },
                left: { left: true },
                right: { right: true, wallPos: room.width }
            }[w];
            
            if (segments.length > 0) {
                // Element chain outside the wall (Maßkette)
                segments.forEach(seg => {
                    const text = `${seg.label}`;
                    if (w === 'top') {
                        drawDimensionLine(ctx, seg.start, -chainOffset, seg.end, -chainOffset, text, { witness: witnessOpt });
                    } else if (w === 'bottom') {
                        drawDimensionLine(ctx, seg.start, room.depth + chainOffset, seg.end, room.depth + chainOffset, text, { witness: witnessOpt });
                    } else if (w === 'left') {
                        drawDimensionLine(ctx, -chainOffset, seg.start, -chainOffset, seg.end, text, { witness: witnessOpt });
                    } else if (w === 'right') {
                        drawDimensionLine(ctx, room.width + chainOffset, seg.start, room.width + chainOffset, seg.end, text, { witness: witnessOpt });
                    }
                });
                
                // When wall has elements, draw overall dimension line further outside
                if (w === 'top') {
                    drawDimensionLine(ctx, 0, -totalOffset, room.width, -totalOffset, `${formatDim(room.width)} cm`, { witness: witnessOpt });
                } else if (w === 'bottom') {
                    drawDimensionLine(ctx, 0, room.depth + totalOffset, room.width, room.depth + totalOffset, `${formatDim(room.width)} cm`, { witness: witnessOpt });
                } else if (w === 'left') {
                    drawDimensionLine(ctx, -totalOffset, 0, -totalOffset, room.depth, `${formatDim(room.depth)} cm`, { witness: witnessOpt });
                } else if (w === 'right') {
                    drawDimensionLine(ctx, room.width + totalOffset, 0, room.width + totalOffset, room.depth, `${formatDim(room.depth)} cm`, { witness: witnessOpt });
                }
            } else {
                // Wall has no elements: draw overall room dimension on top and left walls
                if (w === 'top') {
                    drawDimensionLine(ctx, 0, -chainOffset, room.width, -chainOffset, `${formatDim(room.width)} cm`, { witness: witnessOpt });
                } else if (w === 'left') {
                    drawDimensionLine(ctx, -chainOffset, 0, -chainOffset, room.depth, `${formatDim(room.depth)} cm`, { witness: witnessOpt });
                }
            }
        });
    },
    
    drawGrid(ctx) {
        const room = State.room;
        const step = 10; // Major lines every 50cm, minor every 10cm
        const isLight = typeof document !== 'undefined' && document.documentElement && document.documentElement.getAttribute('data-theme') === 'light';
        const minorColor = isLight ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.03)';
        const majorColor = isLight ? 'rgba(0, 0, 0, 0.09)' : 'rgba(255, 255, 255, 0.08)';

        ctx.strokeStyle = minorColor;
        ctx.lineWidth = 0.5;
        
        // Grid vertical lines
        for (let x = 0; x <= room.width; x += step) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, room.depth);
            if (x % 50 === 0) {
                ctx.strokeStyle = majorColor;
                ctx.lineWidth = 1.0;
            } else {
                ctx.strokeStyle = minorColor;
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
                ctx.strokeStyle = majorColor;
                ctx.lineWidth = 1.0;
            } else {
                ctx.strokeStyle = minorColor;
                ctx.lineWidth = 0.5;
            }
            ctx.stroke();
        }
    },
    
    drawRoofPitches(ctx) {
        const room = State.room;
        ctx.fillStyle = 'rgba(139, 92, 246, 0.06)'; // Light purple tint
        ctx.strokeStyle = 'rgba(139, 92, 246, 0.35)';
        ctx.lineWidth = 1;

        const walls = ['top', 'right', 'bottom', 'left'];
        walls.forEach(w => {
            const pitch = room.pitches[w];
            const inter = getPitchInterval(pitch, w);
            if (!inter) return;

            const run = pitch.run;
            const wallLen = (w === 'top' || w === 'bottom') ? room.width : room.depth;

            // Rectangular outer footprint [outerStart, outerEnd] x [0, run] in 2D room space
            const p0 = wallUDToRoomXY(w, inter.outerStart, 0);
            const p1 = wallUDToRoomXY(w, inter.outerStart, run);
            const p2 = wallUDToRoomXY(w, inter.outerEnd, run);
            const p3 = wallUDToRoomXY(w, inter.outerEnd, 0);

            // Fill footprint
            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.lineTo(p3.x, p3.y);
            ctx.closePath();
            ctx.fill();

            // Directional slope contour lines (parallel to wall in main trapezoid, perpendicular to wall in slanted cheek triangles)
            const step = 18;
            ctx.save();
            ctx.setLineDash([]);
            ctx.strokeStyle = 'rgba(139, 92, 246, 0.28)';
            ctx.beginPath();

            // 1. Main slope trapezoid lines (parallel to wall)
            for (let d = step; d < run; d += step) {
                const t = d / run;
                const uLeft = inter.innerStart - (inter.innerStart - inter.outerStart) * t;
                const uRight = inter.innerEnd + (inter.outerEnd - inter.innerEnd) * t;
                if (uRight > uLeft) {
                    const a = wallUDToRoomXY(w, uLeft, d);
                    const b = wallUDToRoomXY(w, uRight, d);
                    ctx.moveTo(a.x, a.y);
                    ctx.lineTo(b.x, b.y);
                }
            }

            // 2. Start slanted cheek triangle lines (perpendicular to wall, from wall to diagonal crease)
            if (inter.innerStart > inter.outerStart) {
                const spanStart = inter.innerStart - inter.outerStart;
                for (let u = inter.outerStart + step; u < inter.innerStart; u += step) {
                    const dMax = run * (1 - (u - inter.outerStart) / spanStart);
                    if (dMax > 0) {
                        const a = wallUDToRoomXY(w, u, 0);
                        const b = wallUDToRoomXY(w, u, dMax);
                        ctx.moveTo(a.x, a.y);
                        ctx.lineTo(b.x, b.y);
                    }
                }
            }

            // 3. End slanted cheek triangle lines (perpendicular to wall, from wall to diagonal crease)
            if (inter.outerEnd > inter.innerEnd) {
                const spanEnd = inter.outerEnd - inter.innerEnd;
                for (let u = inter.innerEnd + step; u < inter.outerEnd; u += step) {
                    const dMax = run * (1 - (inter.outerEnd - u) / spanEnd);
                    if (dMax > 0) {
                        const a = wallUDToRoomXY(w, u, 0);
                        const b = wallUDToRoomXY(w, u, dMax);
                        ctx.moveTo(a.x, a.y);
                        ctx.lineTo(b.x, b.y);
                    }
                }
            }
            ctx.stroke();
            ctx.restore();

            // Draw structural boundary and diagonal valley/hip crease lines
            ctx.save();
            ctx.strokeStyle = 'rgba(139, 92, 246, 0.55)';
            ctx.lineWidth = 1.25;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();

            // Inner ceiling boundary (p1 -> p2)
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);

            // Start outer edge (p0 -> p1) if not flush with corner wall
            if (inter.outerStart > 0) {
                ctx.moveTo(p0.x, p0.y);
                ctx.lineTo(p1.x, p1.y);
            }

            // End outer edge (p3 -> p2) if not flush with corner wall
            if (inter.outerEnd < wallLen) {
                ctx.moveTo(p3.x, p3.y);
                ctx.lineTo(p2.x, p2.y);
            }
            ctx.stroke();

            // Solid diagonal crease lines (Grat / Kehle) between slanted cheek triangle and main slope
            ctx.setLineDash([]);
            ctx.beginPath();
            if (inter.innerStart > inter.outerStart) {
                const c0 = wallUDToRoomXY(w, inter.innerStart, 0);
                ctx.moveTo(c0.x, c0.y);
                ctx.lineTo(p1.x, p1.y);
            }
            if (inter.outerEnd > inter.innerEnd) {
                const c1 = wallUDToRoomXY(w, inter.innerEnd, 0);
                ctx.moveTo(c1.x, c1.y);
                ctx.lineTo(p2.x, p2.y);
            }
            ctx.stroke();
            ctx.restore();
        });

        ctx.setLineDash([]);
    },
    
        drawWalls(ctx) {
        const room = State.room;
        const wallThick = 10;
        
        ctx.save();
        
        // 1. Fill wall mass (solid frame between outer rect and inner rect)
        ctx.beginPath();
        // Outer rect clockwise
        ctx.rect(-wallThick, -wallThick, room.width + 2 * wallThick, room.depth + 2 * wallThick);
        // Inner rect counter-clockwise (hole)
        ctx.rect(room.width, 0, -room.width, room.depth);
        ctx.fillStyle = '#1e293b'; // Slate-800 architectural wall fill
        ctx.fill();
        
        // 2. Stroke outer boundary
        ctx.strokeStyle = '#334155'; // Slate-700
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-wallThick, -wallThick, room.width + 2 * wallThick, room.depth + 2 * wallThick);
        
        // 3. Stroke inner boundary strictly on the wall side (clipped outside room)
        // This guarantees that the inner face of the wall sits PRECISELY on the 0 and room dimension lines,
        // and never intrudes into the room interior or covers the grid.
        ctx.save();
        ctx.beginPath();
        ctx.rect(-wallThick - 10, -wallThick - 10, room.width + 2 * wallThick + 20, room.depth + 2 * wallThick + 20);
        ctx.rect(room.width, 0, -room.width, room.depth);
        ctx.clip();
        
        ctx.strokeStyle = '#475569'; // Crisp inner wall border
        ctx.lineWidth = 2.0;
        ctx.strokeRect(0, 0, room.width, room.depth);
        ctx.restore();
        
        ctx.restore();
    },
    
    drawWallElements(ctx) {
        const wallThick = 10;
        State.elements.forEach(elem => {
            const coords = getWallCoordinates(elem.wall, elem.position);
            const isSelected = State.selectedItem === elem;
            
            ctx.save();
            ctx.translate(coords.x, coords.y);
            ctx.rotate(coords.angle);
            
            // Center element alignment locally
            const halfW = elem.w / 2;
            
            if (elem.type === 'door' || elem.type === 'double-door') {
                const dir = elem.direction || 'in';
                const isIn = dir === 'in';
                
                // Clear the wall opening across wall thickness (-wallThick to 0)
                ctx.fillStyle = '#0b0f19'; // App background to overlap wall
                ctx.fillRect(-halfW, -wallThick - 0.5, elem.w, wallThick + 1);
                
                // Draw architectural door casing jambs with wall return lips
                ctx.fillStyle = '#64748b';
                ctx.fillRect(-halfW - 3, -wallThick - 1, 3.5, wallThick + 2);
                ctx.fillRect(halfW - 0.5, -wallThick - 1, 3.5, wallThick + 2);
                ctx.fillStyle = '#94a3b8';
                ctx.fillRect(-halfW - 4.5, -2, 5.5, 2.5);
                ctx.fillRect(halfW - 1, -2, 5.5, 2.5);
                
                // Thin threshold line along inner wall face (y = 0)
                ctx.strokeStyle = '#334155';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(-halfW, 0);
                ctx.lineTo(halfW, 0);
                ctx.stroke();
                
                if (elem.type === 'door') {
                    const hinge = elem.hinge || 'left';
                    const isLeft = hinge === 'left';
                    const hX = isLeft ? -halfW : halfW;
                    const leafY = isIn ? elem.w : -elem.w;
                    const anticlockwise = isLeft ? !isIn : isIn;
                    
                    // Draw swing arc
                    ctx.strokeStyle = isSelected ? 'hsl(263, 85%, 65%)' : 'rgba(217, 119, 6, 0.45)';
                    ctx.lineWidth = 1.2;
                    ctx.setLineDash([3, 3]);
                    ctx.beginPath();
                    ctx.arc(hX, 0, elem.w, isLeft ? 0 : Math.PI, isIn ? Math.PI / 2 : -Math.PI / 2, anticlockwise);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    
                    // Architectural solid door leaf (3.5cm thickness)
                    const leafThick = 3.5;
                    const leafX = isLeft ? hX : hX - leafThick;
                    const leafTop = isIn ? 0 : -elem.w;
                    
                    ctx.fillStyle = isSelected ? 'hsl(263, 85%, 65%)' : (elem.color || (elem.isBalcony ? '#38bdf8' : '#d97706'));
                    ctx.fillRect(leafX, leafTop, leafThick, elem.w);
                    ctx.strokeStyle = isSelected ? '#a855f7' : '#92400e';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(leafX, leafTop, leafThick, elem.w);
                    
                    // Hinge pivot dot
                    ctx.beginPath();
                    ctx.arc(hX, 0, 2.5, 0, Math.PI * 2);
                    ctx.fillStyle = '#cbd5e1';
                    ctx.fill();
                    
                    // Handle indicator tick
                    const handleY = isIn ? elem.w * 0.82 : -elem.w * 0.82;
                    ctx.strokeStyle = '#e2e8f0';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.moveTo(hX, handleY);
                    ctx.lineTo(isLeft ? hX + 4.5 : hX - 4.5, handleY);
                    ctx.stroke();
                } else {
                    // Double door: has two wings of width halfW
                    const leafY = isIn ? halfW : -halfW;
                    
                    // Left wing: hinge at -halfW, leaf length halfW, swing radius halfW
                    const hX_L = -halfW;
                    const anticlockwise_L = !isIn;
                    
                    // Right wing: hinge at halfW, leaf length halfW, swing radius halfW
                    const hX_R = halfW;
                    const anticlockwise_R = isIn;
                    
                    ctx.strokeStyle = isSelected ? 'hsl(263, 85%, 65%)' : 'rgba(217, 119, 6, 0.45)';
                    ctx.lineWidth = 1.2;
                    ctx.setLineDash([3, 3]);
                    
                    // Draw Left swing arc
                    ctx.beginPath();
                    ctx.arc(hX_L, 0, halfW, 0, isIn ? Math.PI / 2 : -Math.PI / 2, anticlockwise_L);
                    ctx.stroke();
                    
                    // Draw Right swing arc
                    ctx.beginPath();
                    ctx.arc(hX_R, 0, halfW, Math.PI, isIn ? Math.PI / 2 : -Math.PI / 2, anticlockwise_R);
                    ctx.stroke();
                    
                    ctx.setLineDash([]);
                    
                    const leafThick = 3.5;
                    const leafColor = isSelected ? 'hsl(263, 85%, 65%)' : (elem.color || (elem.isBalcony ? '#38bdf8' : '#d97706'));
                    ctx.fillStyle = leafColor;
                    ctx.strokeStyle = isSelected ? '#a855f7' : '#92400e';
                    ctx.lineWidth = 1;
                    
                    // Left leaf
                    ctx.fillRect(hX_L, isIn ? 0 : -halfW, leafThick, halfW);
                    ctx.strokeRect(hX_L, isIn ? 0 : -halfW, leafThick, halfW);
                    
                    // Right leaf
                    ctx.fillRect(hX_R - leafThick, isIn ? 0 : -halfW, leafThick, halfW);
                    ctx.strokeRect(hX_R - leafThick, isIn ? 0 : -halfW, leafThick, halfW);
                    
                    // Hinge dots
                    ctx.fillStyle = '#cbd5e1';
                    ctx.beginPath(); ctx.arc(hX_L, 0, 2.5, 0, Math.PI * 2); ctx.fill();
                    ctx.beginPath(); ctx.arc(hX_R, 0, 2.5, 0, Math.PI * 2); ctx.fill();
                }
                
            } else if (elem.type === 'window') {
                // Clear wall opening completely between -wallThick and 0
                ctx.fillStyle = '#0b0f19';
                ctx.fillRect(-halfW, -wallThick - 0.5, elem.w, wallThick + 1);
                
                // 1. Exterior Window Sill (Außenfensterbank)
                ctx.strokeStyle = '#64748b';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(-halfW - 3, -wallThick - 2.5);
                ctx.lineTo(halfW + 3, -wallThick - 2.5);
                ctx.stroke();
                
                // 2. Interior Window Sill (Innenfensterbank)
                ctx.strokeStyle = isSelected ? 'hsl(263, 85%, 65%)' : '#38bdf8';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(-halfW - 4, 3);
                ctx.lineTo(halfW + 4, 3);
                ctx.moveTo(-halfW - 4, 0);
                ctx.lineTo(-halfW - 4, 3);
                ctx.moveTo(halfW + 4, 0);
                ctx.lineTo(halfW + 4, 3);
                ctx.stroke();
                
                // 3. Side frame jambs
                ctx.fillStyle = '#475569';
                ctx.fillRect(-halfW, -wallThick, 4, wallThick);
                ctx.fillRect(halfW - 4, -wallThick, 4, wallThick);
                
                // 4. Translucent glass fill
                ctx.fillStyle = isSelected ? 'rgba(139, 92, 246, 0.2)' : 'rgba(56, 189, 248, 0.15)';
                ctx.fillRect(-halfW + 4, -wallThick, elem.w - 8, wallThick);
                
                // 5. Double Glazing parallel lines (Doppelverglasung)
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                ctx.moveTo(-halfW + 4, -wallThick * 0.68);
                ctx.lineTo(halfW - 4, -wallThick * 0.68);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(-halfW + 4, -wallThick * 0.32);
                ctx.lineTo(halfW - 4, -wallThick * 0.32);
                ctx.stroke();
                
                // 6. Central mullion if wide
                if (elem.w >= 100) {
                    ctx.fillStyle = '#475569';
                    ctx.fillRect(-1.5, -wallThick, 3, wallThick);
                }
            } else if (elem.type === 'skylight') {
                // Skylight is in a roof pitch. Drawn floating near the wall in 2D
                // Its coordinates are computed based on pitch direction
                // We'll restore rotation first and compute real position
                ctx.restore();
                ctx.save();
                
                // Get slope angle
                const pitch = State.room.pitches[elem.wall];
                let cosAlpha = 1.0;
                if (pitch && pitch.enabled) {
                    const slopeAngleRad = Math.atan((State.room.height - pitch.kniestock) / pitch.run);
                    cosAlpha = Math.cos(slopeAngleRad);
                }
                
                // Slanted distances
                const sCenter = (elem.distanceFromWall || 0) + elem.h / 2;
                const dCenterHoriz = sCenter * cosAlpha;
                const hProj = elem.h * cosAlpha;
                
                let sx = coords.x;
                let sy = coords.y;
                
                // Offset normal to wall inwards
                if (elem.wall === 'top') sy += dCenterHoriz;
                else if (elem.wall === 'right') sx -= dCenterHoriz;
                else if (elem.wall === 'bottom') sy -= dCenterHoriz;
                else if (elem.wall === 'left') sx += dCenterHoriz;
                
                ctx.translate(sx, sy);
                ctx.rotate(coords.angle);
                
                ctx.strokeStyle = isSelected ? 'hsl(263, 85%, 65%)' : 'rgba(139, 92, 246, 0.8)';
                ctx.lineWidth = 2;
                ctx.setLineDash([3, 2]);
                ctx.strokeRect(-halfW, -hProj/2, elem.w, hProj);
                ctx.setLineDash([]);
                
                ctx.fillStyle = isSelected ? 'rgba(139, 92, 246, 0.25)' : 'rgba(139, 92, 246, 0.1)';
                ctx.fillRect(-halfW, -hProj/2, elem.w, hProj);
                
                // Draw an X to represent skylight glass division
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
                ctx.beginPath();
                ctx.moveTo(-halfW, -hProj/2); ctx.lineTo(halfW, hProj/2);
                ctx.moveTo(halfW, -hProj/2); ctx.lineTo(-halfW, hProj/2);
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
        const drawItem = (f) => {
            const isSelected = State.selectedItem === f;
            
            ctx.save();
            ctx.translate(f.x, f.y);
            ctx.rotate((f.rotation * Math.PI) / 180);
            
            // Base styling based on status
            let fillColor = f.color || 'hsl(263, 50%, 40%)';
            let strokeColor = isSelected ? (f.locked ? 'hsl(215, 75%, 60%)' : 'white') : 'rgba(255, 255, 255, 0.4)';
            let strokeWidth = isSelected ? 2.5 : 1.2;
            
            if (f.isColliding) {
                fillColor = 'rgba(239, 68, 68, 0.35)'; // Red overlay
                strokeColor = '#ef4444';
                strokeWidth = isSelected ? 3 : 2;
            }
            
            ctx.fillStyle = fillColor;
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = strokeWidth;
            
            if (f.isRug) {
                // Draw rug with dashed outline and lower opacity
                ctx.setLineDash([4, 3]);
                ctx.globalAlpha = 0.8;
            }
            
            // Draw Shape
            if (f.shape === 'circle') {
                const r = f.w / 2;
                ctx.beginPath();
                ctx.arc(0, 0, r, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
                
                if (f.isRug) {
                    // Stitched inner border (Kettelrand) & fabric texture for round rug
                    ctx.save();
                    ctx.beginPath();
                    ctx.arc(0, 0, r, 0, Math.PI * 2);
                    ctx.clip();
                    
                    // Subtle weave grid
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
                    ctx.lineWidth = 0.8;
                    const step = 8;
                    for (let x = -r; x <= r; x += step) {
                        ctx.beginPath(); ctx.moveTo(x, -r); ctx.lineTo(x, r); ctx.stroke();
                    }
                    for (let y = -r; y <= r; y += step) {
                        ctx.beginPath(); ctx.moveTo(-r, y); ctx.lineTo(r, y); ctx.stroke();
                    }
                    
                    // Stitched hem line
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([3, 3]);
                    ctx.beginPath();
                    ctx.arc(0, 0, Math.max(4, r - 5), 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.restore();
                } else {
                    const nameLower = (f.name || '').toLowerCase();
                    const isPlant = f.isPlant || nameLower.includes('pflanze') || nameLower.includes('plant') || f.presetKey === 'plant' || f.preset === 'plant';
                    if (isPlant) {
                        const radius = f.w / 2;
                        const potRadius = radius * 0.44;

                        // Ground shadow
                        ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
                        ctx.beginPath();
                        ctx.arc(2, 2, radius * 0.95, 0, Math.PI * 2);
                        ctx.fill();

                        // Ceramic pot rim
                        ctx.fillStyle = '#e2e8f0';
                        ctx.strokeStyle = '#94a3b8';
                        ctx.lineWidth = 1.2;
                        ctx.beginPath();
                        ctx.arc(0, 0, potRadius, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.stroke();

                        // Dark potting soil
                        ctx.fillStyle = '#261c14';
                        ctx.beginPath();
                        ctx.arc(0, 0, potRadius * 0.85, 0, Math.PI * 2);
                        ctx.fill();

                        // 8 Organic foliage lobes
                        const leafCount = 8;
                        for (let i = 0; i < leafCount; i++) {
                            const angle = (i * Math.PI * 2) / leafCount;
                            const leafLen = radius * (0.8 + 0.18 * Math.sin(i * 1.8));
                            const tipX = Math.cos(angle) * leafLen;
                            const tipY = Math.sin(angle) * leafLen;
                            const perp = angle + Math.PI / 2;
                            const w = 9 + 3 * Math.cos(i);

                            const c1X = Math.cos(angle) * (leafLen * 0.5) + Math.cos(perp) * w;
                            const c1Y = Math.sin(angle) * (leafLen * 0.5) + Math.sin(perp) * w;
                            const c2X = Math.cos(angle) * (leafLen * 0.5) - Math.cos(perp) * w;
                            const c2Y = Math.sin(angle) * (leafLen * 0.5) - Math.sin(perp) * w;

                            ctx.fillStyle = i % 2 === 0 ? 'rgba(45, 106, 79, 0.75)' : 'rgba(64, 145, 108, 0.75)';
                            ctx.strokeStyle = '#1b4332';
                            ctx.lineWidth = 1;

                            ctx.beginPath();
                            ctx.moveTo(0, 0);
                            ctx.quadraticCurveTo(c1X, c1Y, tipX, tipY);
                            ctx.quadraticCurveTo(c2X, c2Y, 0, 0);
                            ctx.fill();
                            ctx.stroke();

                            ctx.strokeStyle = 'rgba(216, 243, 220, 0.45)';
                            ctx.lineWidth = 0.8;
                            ctx.beginPath();
                            ctx.moveTo(0, 0);
                            ctx.lineTo(tipX * 0.85, tipY * 0.85);
                            ctx.stroke();
                        }

                        // Central hub
                        ctx.fillStyle = '#1b4332';
                        ctx.beginPath();
                        ctx.arc(0, 0, 3, 0, Math.PI * 2);
                        ctx.fill();
                    } else {
                        // Direction line inside circle
                        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
                        ctx.beginPath();
                        ctx.moveTo(0, 0);
                        ctx.lineTo(0, -r);
                        ctx.stroke();
                    }
                }
            } else {
                // Rectangle
                ctx.fillRect(-f.w / 2, -f.l / 2, f.w, f.l);
                
                if (f.isRug) {
                    // Textile fabric cross-weave & stitched hem in 2D
                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(-f.w / 2, -f.l / 2, f.w, f.l);
                    ctx.clip();
                    
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
                    ctx.lineWidth = 0.8;
                    const step = 8;
                    for (let x = -f.w / 2; x <= f.w / 2; x += step) {
                        ctx.beginPath(); ctx.moveTo(x, -f.l / 2); ctx.lineTo(x, f.l / 2); ctx.stroke();
                    }
                    for (let y = -f.l / 2; y <= f.l / 2; y += step) {
                        ctx.beginPath(); ctx.moveTo(-f.w / 2, y); ctx.lineTo(f.w / 2, y); ctx.stroke();
                    }
                    
                    // Stitched border (Kettelrand)
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([3, 3]);
                    const inset = Math.min(6, Math.min(f.w, f.l) / 4);
                    ctx.strokeRect(-f.w / 2 + inset, -f.l / 2 + inset, f.w - inset * 2, f.l - inset * 2);
                    ctx.restore();
                } else if (f.isObstacle) {
                    // Cross hatch pattern for chimney/obstacle
                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(-f.w / 2, -f.l / 2, f.w, f.l);
                    ctx.clip();
                    
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
                    ctx.lineWidth = 1.0;
                    const step = 15;
                    const limit = Math.max(f.w, f.l);
                    for (let k = -limit * 2; k < limit * 2; k += step) {
                        ctx.beginPath();
                        ctx.moveTo(k, -f.l / 2);
                        ctx.lineTo(k + f.l, f.l / 2);
                        ctx.stroke();
                        
                        ctx.beginPath();
                        ctx.moveTo(k, f.l / 2);
                        ctx.lineTo(k + f.l, -f.l / 2);
                        ctx.stroke();
                    }
                    ctx.restore();
                }
                
                ctx.strokeRect(-f.w / 2, -f.l / 2, f.w, f.l);
                
                // Draw face direction line or detailed architectural components
                if (!f.isObstacle && !f.isRug) {
                    const nameLower = (f.name || '').toLowerCase();
                    const pKey = f.presetKey || f.preset || '';

                    const isArcLamp = f.isLamp || nameLower.includes('bogenleuchte') || nameLower.includes('arc') || pKey === 'arc-lamp';
                    const isLoungeChair = nameLower.includes('lounge') || pKey === 'lounge-chair';
                    const isBookshelf = nameLower.includes('regal') || nameLower.includes('raumteiler') || nameLower.includes('bookshelf') || pKey === 'bookshelf';
                    const isCoffeeTableSet = nameLower.includes('couchtisch') || nameLower.includes('coffee-table') || pKey === 'coffee-table-set';
                    const isTVLowboard = nameLower.includes('lowboard') || pKey === 'tv-lowboard';
                    const isNightstand = f.isNightstand || nameLower.includes('nachttisch') || nameLower.includes('nightstand') || pKey === 'nightstand';
                    const isRealTV = (f.tvSize !== null && f.tvSize !== undefined) || (!nameLower.includes('lowboard') && !nameLower.includes('sideboard') && !nameLower.includes('board') && (nameLower.includes('tv') || nameLower.includes('fernseher')));

                    const halfW = f.w / 2;
                    const halfL = f.l / 2;

                    if (isArcLamp) {
                        const baseR = Math.min(f.w * 0.42, 19);
                        const baseY = -halfL + baseR + 2;
                        const shadeR = Math.min(f.w * 0.4, 18);
                        const shadeY = halfL - shadeR - 2;

                        // 1. Heavy Base plate (rear)
                        ctx.fillStyle = isSelected ? 'hsl(45, 70%, 50%)' : '#475569';
                        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
                        ctx.lineWidth = 1.5;
                        ctx.beginPath();
                        ctx.arc(0, baseY, baseR, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.stroke();

                        // Center mounting core
                        ctx.fillStyle = '#0f172a';
                        ctx.beginPath();
                        ctx.arc(0, baseY, 4, 0, Math.PI * 2);
                        ctx.fill();

                        // 2. Curved metallic arc spine
                        ctx.beginPath();
                        ctx.moveTo(0, baseY);
                        ctx.quadraticCurveTo(f.w * 0.35, (baseY + shadeY) * 0.35, 0, shadeY);
                        ctx.strokeStyle = '#e2e8f0';
                        ctx.lineWidth = 2.5;
                        ctx.stroke();

                        // 3. Dome Shade & Light Glow (front)
                        try {
                            const glowGrad = ctx.createRadialGradient(0, shadeY, 3, 0, shadeY, shadeR * 1.4);
                            if (glowGrad && glowGrad.addColorStop) {
                                glowGrad.addColorStop(0, 'rgba(255, 238, 187, 0.5)');
                                glowGrad.addColorStop(0.6, 'rgba(255, 220, 140, 0.2)');
                                glowGrad.addColorStop(1, 'rgba(255, 220, 140, 0)');
                                ctx.fillStyle = glowGrad;
                                ctx.beginPath();
                                ctx.arc(0, shadeY, shadeR * 1.4, 0, Math.PI * 2);
                                ctx.fill();
                            }
                        } catch (e) {}

                        ctx.fillStyle = '#334155';
                        ctx.strokeStyle = '#ffffff';
                        ctx.lineWidth = 1.5;
                        ctx.beginPath();
                        ctx.arc(0, shadeY, shadeR, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.stroke();

                        // Inner bulb
                        ctx.fillStyle = '#ffeedd';
                        ctx.beginPath();
                        ctx.arc(0, shadeY, shadeR * 0.5, 0, Math.PI * 2);
                        ctx.fill();

                    } else if (isLoungeChair) {
                        // Backrest pillow at rear
                        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
                        ctx.fillRect(-halfW + 6, -halfL + 4, f.w - 12, 16);
                        // Backrest double stitch seam
                        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
                        ctx.lineWidth = 1;
                        ctx.setLineDash([3, 3]);
                        ctx.strokeRect(-halfW + 8, -halfL + 6, f.w - 16, 12);
                        ctx.setLineDash([]);

                        // Seat cushion
                        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
                        ctx.fillRect(-halfW + 10, -halfL + 22, f.w - 20, f.l - 28);
                        // Center tuft line
                        ctx.beginPath();
                        ctx.moveTo(-halfW + 16, 2);
                        ctx.lineTo(halfW - 16, 2);
                        ctx.stroke();

                        // Armrests
                        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
                        ctx.fillRect(-halfW + 2, -halfL + 8, 6, f.l - 16);
                        ctx.fillRect(halfW - 8, -halfL + 8, 6, f.l - 16);

                        // 4 leg pads at corners
                        ctx.fillStyle = '#1e293b';
                        const pads = [
                            { x: -halfW + 6, y: -halfL + 8 },
                            { x: halfW - 6, y: -halfL + 8 },
                            { x: -halfW + 6, y: halfL - 8 },
                            { x: halfW - 6, y: halfL - 8 }
                        ];
                        pads.forEach(p => {
                            ctx.beginPath();
                            ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
                            ctx.fill();
                        });

                    } else if (isBookshelf) {
                        // Side upright cheeks
                        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
                        ctx.fillRect(-halfW, -halfL, 4, f.l);
                        ctx.fillRect(halfW - 4, -halfL, 4, f.l);

                        // Asymmetric vertical partition dividers
                        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
                        ctx.lineWidth = 1.2;
                        const d1X = -halfW + f.w * 0.35;
                        const d2X = -halfW + f.w * 0.70;
                        ctx.beginPath();
                        ctx.moveTo(d1X, -halfL); ctx.lineTo(d1X, halfL);
                        ctx.moveTo(d2X, -halfL); ctx.lineTo(d2X, halfL);
                        ctx.stroke();

                        // Top-down book spines (left bay)
                        const bookColors = ['#1e3a5f', '#a04e38', '#556b2f', '#e2d9cb', '#2c3e50'];
                        for (let b = 0; b < 5; b++) {
                            ctx.fillStyle = bookColors[b % bookColors.length];
                            ctx.fillRect(-halfW + 6 + b * 5, -halfL + 4, 3.5, f.l - 8);
                        }

                        // Top-down ceramic vase circle (right bay)
                        ctx.fillStyle = '#ede8df';
                        ctx.strokeStyle = '#94a3b8';
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.arc(halfW - f.w * 0.15, 0, 5, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.stroke();

                    } else if (isCoffeeTableSet) {
                        // Table 2 (Lower, dark smoked oak)
                        ctx.fillStyle = 'rgba(39, 39, 42, 0.85)';
                        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
                        ctx.lineWidth = 1.2;
                        ctx.beginPath();
                        ctx.arc(18, 6, 20, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.stroke();

                        // Table 1 (Higher, travertine/Carrara marble)
                        ctx.fillStyle = f.color || '#e5ded6';
                        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
                        ctx.lineWidth = 1.5;
                        ctx.beginPath();
                        ctx.arc(-16, -4, 26, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.stroke();

                        // 3 Tripod leg attachment dots on Table 1
                        ctx.fillStyle = '#18181b';
                        for (let k = 0; k < 3; k++) {
                            const la = (k * 2 * Math.PI) / 3;
                            ctx.beginPath();
                            ctx.arc(-16 + Math.cos(la) * 18, -4 + Math.sin(la) * 18, 2, 0, Math.PI * 2);
                            ctx.fill();
                        }

                    } else if (isTVLowboard) {
                        // 3 Cabinet compartment sections
                        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
                        ctx.lineWidth = 1;
                        const c1X = -f.w / 6;
                        const c2X = f.w / 6;
                        ctx.beginPath();
                        ctx.moveTo(c1X, -halfL); ctx.lineTo(c1X, halfL);
                        ctx.moveTo(c2X, -halfL); ctx.lineTo(c2X, halfL);
                        ctx.stroke();

                        // Front acoustic vertical slat lines along front edge (+halfL)
                        ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
                        ctx.lineWidth = 1;
                        for (let sx = -halfW + 4; sx <= halfW - 4; sx += 5) {
                            ctx.beginPath();
                            ctx.moveTo(sx, halfL - 5);
                            ctx.lineTo(sx, halfL);
                            ctx.stroke();
                        }

                        // Rear cable grommet
                        ctx.fillStyle = '#0f172a';
                        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
                        ctx.lineWidth = 0.8;
                        ctx.beginPath();
                        ctx.arc(0, -halfL + 6, 3, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.stroke();

                    } else if (isNightstand) {
                        // Front shadow gap & drawer lip
                        ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
                        ctx.fillRect(-halfW + 2, halfL - 4, f.w - 4, 3);
                        ctx.fillStyle = '#0f172a';
                        ctx.fillRect(-8, halfL - 3, 16, 2);

                        // 4 Corner hairpin leg foot pads
                        const inset = 5;
                        const feet = [
                            { x: -halfW + inset, y: -halfL + inset },
                            { x: halfW - inset, y: -halfL + inset },
                            { x: -halfW + inset, y: halfL - inset },
                            { x: halfW - inset, y: halfL - inset }
                        ];
                        ctx.fillStyle = '#1e293b';
                        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
                        ctx.lineWidth = 1;
                        feet.forEach(pt => {
                            ctx.beginPath();
                            ctx.arc(pt.x, pt.y, 2.5, 0, Math.PI * 2);
                            ctx.fill();
                            ctx.stroke();
                        });

                        // Staged bedside book
                        ctx.save();
                        ctx.translate(-f.w * 0.15, -f.l * 0.05);
                        ctx.rotate(-0.1);
                        const bW = 14, bL = 18;
                        ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
                        ctx.fillRect(-bW / 2, -bL / 2, bW, bL);
                        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
                        ctx.strokeRect(-bW / 2, -bL / 2, bW, bL);
                        ctx.fillStyle = '#3b82f6';
                        ctx.fillRect(-bW / 2, -bL / 2, 2.5, bL);
                        ctx.restore();

                    } else if (isRealTV) {
                        // Draw stand foot base
                        const baseW = Math.min(f.w * 0.4, 40);
                        ctx.fillStyle = '#0f172a';
                        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
                        ctx.lineWidth = 1;
                        ctx.fillRect(-baseW / 2, -Math.min(f.l / 2, 6), baseW, Math.min(f.l, 12));
                        ctx.strokeRect(-baseW / 2, -Math.min(f.l / 2, 6), baseW, Math.min(f.l, 12));

                        // Draw TV screen bezel
                        ctx.fillStyle = '#0f172a';
                        ctx.fillRect(-f.w / 2 + 5, -2, f.w - 10, 4);
                        ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
                        ctx.lineWidth = 1;
                        ctx.strokeRect(-f.w / 2 + 5, -2, f.w - 10, 4);

                    } else {
                        // Generic front edge indicator
                        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
                        ctx.fillRect(-halfW, -halfL, f.w, 4);
                    }
                }
            }
            
            // Draw Text Label (Name & dimensions)
            ctx.save();
            
            // In CAD & architectural drafting (DIN 1356), text labels must always be upright
            // and readable (never upside down).
            let textAngleLocal = 0;
            if (f.shape !== 'circle' && f.w < f.l && (f.l - f.w) >= 30) {
                textAngleLocal = 90;
            }
            const worldAngle = ((f.rotation + textAngleLocal) % 360 + 360) % 360;
            if (worldAngle > 90 && worldAngle <= 270) {
                ctx.rotate((textAngleLocal + 180) * Math.PI / 180);
            } else if (textAngleLocal !== 0) {
                ctx.rotate(textAngleLocal * Math.PI / 180);
            }
            
            ctx.fillStyle = f.isColliding ? '#fecaca' : '#f8fafc';
            ctx.font = '10px Plus Jakarta Sans, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            let nameText = f.name || 'Möbel';
            if (f.locked) {
                nameText = '🔒 ' + nameText;
            }
            
            const labelSpan = textAngleLocal === 90 ? f.l : f.w;
            const availableSpan = Math.max(20, labelSpan - 12);
            const m = ctx.measureText(nameText);
            if (m.width > availableSpan) {
                const s = Math.max(0.7, availableSpan / m.width);
                ctx.font = (Math.round(10 * s)) + 'px Plus Jakarta Sans, sans-serif';
            }
            
            ctx.fillText(nameText, 0, -4);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
            ctx.font = '8px Outfit, sans-serif';
            ctx.fillText(formatDim(f.w) + 'x' + formatDim(f.l) + 'x' + formatDim(f.h), 0, 8);
            
            ctx.restore();
            
            // Draw Handles if selected
            if (isSelected) {
                ctx.globalAlpha = 1.0;
                ctx.setLineDash([]);
                this.drawSelectionHandles(ctx, f);
            }
            
            ctx.restore();
        };

        // Draw rugs first (so they sit below normal furniture)
        State.furniture.forEach(f => {
            if (f.isRug) drawItem(f);
        });
        
        // Draw normal furniture next
        State.furniture.forEach(f => {
            if (!f.isRug) drawItem(f);
        });
    },
    
    drawSelectionHandles(ctx, f) {
        if (f.locked) return;
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
        History.saveTempSnapshot();
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
                if (f.locked) return;
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
                    if (f.locked) return;
                    State.editor2D.dragMode = 'resize-w';
                    State.editor2D.draggedItem = f;
                    State.editor2D.initialItemState = { w: f.w, l: f.l, x: f.x, y: f.y };
                    return;
                }
                if (Math.hypot(m.x - bottomHandleWorld.x, m.y - bottomHandleWorld.y) < 8) {
                    if (f.locked) return;
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
                if (!f.locked) {
                    State.editor2D.dragMode = 'move';
                    State.editor2D.draggedItem = f;
                    State.editor2D.dragStartPos = { x: f.x, y: f.y };
                    State.editor2D.dragOffset = { x: m.x - f.x, y: m.y - f.y };
                    State.editor2D.initialItemState = { x: f.x, y: f.y };
                }
                this.draw();
                return;
            }
        }
        
        // 3. Check if clicked on wall elements
        for (let elem of State.elements) {
            if (isMouseOverWallElement(elem, m)) {
                selectItem(elem, 'element');
                if (!elem.locked) {
                    State.editor2D.dragMode = 'move-wall-item';
                    State.editor2D.draggedItem = elem;
                    State.editor2D.dragStartPos = { x: m.x, y: m.y };
                    State.editor2D.initialItemState = { wall: elem.wall, position: elem.position };
                }
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
                if (!inst.locked) {
                    State.editor2D.dragMode = 'move-wall-item';
                    State.editor2D.draggedItem = inst;
                    State.editor2D.dragStartPos = { x: m.x, y: m.y };
                    State.editor2D.initialItemState = { wall: inst.wall, position: inst.position };
                }
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
            const mStartX = State.editor2D.dragStartPos.x + State.editor2D.dragOffset.x;
            const mStartY = State.editor2D.dragStartPos.y + State.editor2D.dragOffset.y;
            
            let deltaX = m.x - mStartX;
            let deltaY = m.y - mStartY;
            
            if (e.shiftKey) {
                // Slower precision movement (20% speed)
                deltaX *= 0.2;
                deltaY *= 0.2;
            }
            
            let newX = State.editor2D.initialItemState.x + deltaX;
            let newY = State.editor2D.initialItemState.y + deltaY;
            
            if (f.isObstacle) {
                // Snap distance to closest wall
                const tempItem = { ...f, x: newX, y: newY };
                const closest = getClosestWall(tempItem);
                
                const isRotated = (Math.round((f.rotation || 0) / 90) % 2 === 1);
                const halfW = (isRotated ? f.l : f.w) / 2;
                const halfL = (isRotated ? f.w : f.l) / 2;
                
                let dist = closest.distance;
                let step = 1;
                if (e.shiftKey) {
                    dist = Math.round(dist * 10) / 10;
                } else if (State.settings.gridEnabled) {
                    step = State.settings.gridSize;
                    dist = Math.round(dist / step) * step;
                } else {
                    dist = Math.round(dist);
                }
                
                // Update position based on snapped distance
                if (closest.wall === 'top') {
                    f.y = dist + halfL;
                    // Snap x coordinate directly
                    if (e.shiftKey) {
                        f.x = Math.round(newX * 10) / 10;
                    } else if (State.settings.gridEnabled) {
                        f.x = Math.round(newX / step) * step;
                    } else {
                        f.x = Math.round(newX);
                    }
                } else if (closest.wall === 'bottom') {
                    f.y = State.room.depth - dist - halfL;
                    if (e.shiftKey) {
                        f.x = Math.round(newX * 10) / 10;
                    } else if (State.settings.gridEnabled) {
                        f.x = Math.round(newX / step) * step;
                    } else {
                        f.x = Math.round(newX);
                    }
                } else if (closest.wall === 'left') {
                    f.x = dist + halfW;
                    if (e.shiftKey) {
                        f.y = Math.round(newY * 10) / 10;
                    } else if (State.settings.gridEnabled) {
                        f.y = Math.round(newY / step) * step;
                    } else {
                        f.y = Math.round(newY);
                    }
                } else if (closest.wall === 'right') {
                    f.x = State.room.width - dist - halfW;
                    if (e.shiftKey) {
                        f.y = Math.round(newY * 10) / 10;
                    } else if (State.settings.gridEnabled) {
                        f.y = Math.round(newY / step) * step;
                    } else {
                        f.y = Math.round(newY);
                    }
                }
            } else {
                // Normal furniture
                const snappingActive = State.settings.smartSnappingEnabled !== false && !e.altKey && !e.shiftKey;
                let activeGuides = [];

                if (e.shiftKey) {
                    f.x = Math.round(newX * 10) / 10;
                    f.y = Math.round(newY * 10) / 10;
                } else if (snappingActive) {
                    const otherFurniture = State.furniture.filter(item => item !== f && item.id !== f.id);
                    const snapThreshold = 10; // 10cm world units
                    const snapResult = SmartSnapping.computeSnap(
                        { ...f, x: newX, y: newY },
                        otherFurniture,
                        State.room,
                        snapThreshold
                    );

                    const step = State.settings.gridEnabled ? State.settings.gridSize : 1;
                    f.x = snapResult.snappedAxes.x ? snapResult.snappedX : (State.settings.gridEnabled ? Math.round(newX / step) * step : Math.round(newX));
                    f.y = snapResult.snappedAxes.y ? snapResult.snappedY : (State.settings.gridEnabled ? Math.round(newY / step) * step : Math.round(newY));
                    activeGuides = snapResult.guides;
                } else {
                    if (State.settings.gridEnabled) {
                        const step = State.settings.gridSize;
                        f.x = Math.round(newX / step) * step;
                        f.y = Math.round(newY / step) * step;
                    } else {
                        f.x = Math.round(newX);
                        f.y = Math.round(newY);
                    }
                }
                State.editor2D.activeGuides = activeGuides;
            }
            
            CollisionEngine.clampFurnitureToRoom(f);
            
            // Update collision checks
            CollisionEngine.updateAllCollisions();
            
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
            CollisionEngine.clampFurnitureToRoom(f);
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
            
            CollisionEngine.clampFurnitureToRoom(f);
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
            
            CollisionEngine.clampFurnitureToRoom(f);
            CollisionEngine.updateAllCollisions();
            this.draw();
            syncPropertiesPanel();
            if (Viewer3D.renderer) Viewer3D.updateFurniture3D(f);
            
        } else if (State.editor2D.dragMode === 'move-wall-item') {
            // Drag wall element or installation along walls
            let targetWall, pos;
            const item = State.editor2D.draggedItem;
            const halfW = (item.w || 10) / 2;
            const w = item.w || 10;
            
            if (e.shiftKey) {
                // Precision mode: keep on the starting wall, scale movement (20% speed) and 0.1cm steps
                targetWall = State.editor2D.initialItemState.wall;
                const maxPos = (targetWall === 'top' || targetWall === 'bottom') ? State.room.width : State.room.depth;
                
                const proj = projectToSpecificWall(m.x, m.y, targetWall);
                let deltaPos = proj - State.editor2D.initialItemState.position;
                deltaPos *= 0.2;
                
                if (State.selectedItemType === 'element') {
                    const initialDist = State.editor2D.initialItemState.position - halfW;
                    let dist = initialDist + deltaPos;
                    dist = Math.round(dist * 10) / 10;
                    dist = Math.max(0, Math.min(maxPos - w, dist));
                    pos = dist + halfW;
                } else {
                    // installation
                    pos = State.editor2D.initialItemState.position + deltaPos;
                    pos = Math.round(pos * 10) / 10;
                }
            } else {
                // Normal mode
                const projection = projectToWall(m.x, m.y);
                targetWall = projection.wall;
                const maxPos = (targetWall === 'top' || targetWall === 'bottom') ? State.room.width : State.room.depth;
                
                if (State.selectedItemType === 'element') {
                    let dist = projection.position - halfW;
                    if (State.settings.gridEnabled) {
                        dist = Math.round(dist / 5) * 5; // snap to 5cm along walls
                    } else {
                        dist = Math.round(dist); // exactly 1.0cm steps
                    }
                    dist = Math.max(0, Math.min(maxPos - w, dist));
                    pos = dist + halfW;
                } else {
                    // installation
                    pos = projection.position;
                    if (State.settings.gridEnabled) {
                        pos = Math.round(pos / 5) * 5; // snap to 5cm along walls
                    } else {
                        pos = Math.round(pos); // exactly 1.0cm steps
                    }
                }
            }
            
            if (State.selectedItemType === 'element') {
                const isValid = isValidWallForElement(State.editor2D.draggedItem, targetWall, pos);
                if (!isValid) {
                    // Refuse to switch wall. Keep current wall and project mouse to it!
                    targetWall = State.editor2D.draggedItem.wall;
                    const room = State.room;
                    const wallMaxPos = (targetWall === 'top' || targetWall === 'bottom') ? room.width : room.depth;
                    let tempPos;
                    if (targetWall === 'top') {
                        tempPos = Math.max(0, Math.min(room.width, m.x));
                    } else if (targetWall === 'right') {
                        tempPos = Math.max(0, Math.min(room.depth, m.y));
                    } else if (targetWall === 'bottom') {
                        tempPos = Math.max(0, Math.min(room.width, room.width - m.x));
                    } else { // left
                        tempPos = Math.max(0, Math.min(room.depth, room.depth - m.y));
                    }
                    
                    let tempDist = tempPos - halfW;
                    if (e.shiftKey) {
                        const proj = projectToSpecificWall(m.x, m.y, targetWall);
                        let deltaPos = proj - State.editor2D.initialItemState.position;
                        deltaPos *= 0.2;
                        tempDist = (State.editor2D.initialItemState.position - halfW) + deltaPos;
                        tempDist = Math.round(tempDist * 10) / 10;
                    } else {
                        if (State.settings.gridEnabled) {
                            tempDist = Math.round(tempDist / 5) * 5;
                        } else {
                            tempDist = Math.round(tempDist);
                        }
                    }
                    tempDist = Math.max(0, Math.min(wallMaxPos - w, tempDist));
                    tempPos = tempDist + halfW;
                    
                    // Also check if moving along the current wall is valid at this tempPos!
                    if (isValidWallForElement(State.editor2D.draggedItem, targetWall, tempPos)) {
                        pos = tempPos;
                    } else {
                        // Keep current position (don't move further if it would collide)
                        pos = State.editor2D.draggedItem.position;
                    }
                }
            }
            
            State.editor2D.draggedItem.wall = targetWall;
            
            // Limit doors/windows/installations from going off the wall edges
            const limitMaxPos = (targetWall === 'top' || targetWall === 'bottom') ? State.room.width : State.room.depth;
            if (State.selectedItemType === 'element') {
                const dist = Math.max(0, Math.min(limitMaxPos - w, pos - halfW));
                State.editor2D.draggedItem.position = dist + halfW;
            } else {
                State.editor2D.draggedItem.position = Math.max(5, Math.min(limitMaxPos - 5, pos));
            }
            
            this.draw();
            syncPropertiesPanel();
            
            // Rebuild 3D wall elements since positions changed
            if (Viewer3D.renderer) {
                if (State.selectedItemType === 'element') Viewer3D.rebuildWalls3D();
                else Viewer3D.updateInstallations3D();
            }
            
        } else if (State.editor2D.dragMode === 'pan') {
            // Pan canvas view
            State.editor2D.hasManuallyPannedOrZoomed = true;
            const dx = sx - State.editor2D.dragStartPos.x;
            const dy = sy - State.editor2D.dragStartPos.y;
            State.editor2D.panX = State.editor2D.dragOffset.x + dx;
            State.editor2D.panY = State.editor2D.dragOffset.y + dy;
            this.draw();
        }
    },
    
    handleMouseUp() {
        if (State.editor2D.draggedItem && State.selectedItemType === 'furniture') {
            CollisionEngine.clampFurnitureToRoom(State.editor2D.draggedItem);
        }
        State.editor2D.activeGuides = [];
        State.editor2D.dragMode = null;
        State.editor2D.draggedItem = null;
        this.draw();
        History.commitTempSnapshot();
    },
    
    handleWheel(e) {
        e.preventDefault();
        State.editor2D.hasManuallyPannedOrZoomed = true;
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
        History.pushState();
        
        const itemToDelete = State.selectedItem;
        const itemType = State.selectedItemType;
        selectItem(null, null);

        if (itemType === 'furniture') {
            State.furniture = State.furniture.filter(item => item !== itemToDelete);
            if (Viewer3D.renderer) Viewer3D.removeFurniture3D(itemToDelete);
        } else if (itemType === 'element') {
            State.elements = State.elements.filter(item => item !== itemToDelete);
            if (Viewer3D.renderer) Viewer3D.rebuildWalls3D();
        } else if (itemType === 'installation') {
            State.installations = State.installations.filter(item => item !== itemToDelete);
            if (Viewer3D.renderer) Viewer3D.updateInstallations3D();
        }
        
        CollisionEngine.updateAllCollisions();
        this.draw();
        updatePlacedListsUI();
    }
};

// --- PROCEDURAL TEXTURES FOR 3D MODELS ---
const TextureGenerator = {
    createWood(colorHex) {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        
        ctx.fillStyle = colorHex;
        ctx.fillRect(0, 0, 512, 512);
        
        ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
        for (let i = 0; i < 40; i++) {
            const w = Math.random() * 20 + 5;
            const y = Math.random() * 512;
            ctx.fillRect(0, y, 512, w);
        }
        
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.06)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 300; i++) {
            ctx.beginPath();
            const y = Math.random() * 512;
            ctx.moveTo(0, y);
            ctx.bezierCurveTo(128, y + (Math.random() - 0.5) * 10, 384, y + (Math.random() - 0.5) * 10, 512, y);
            ctx.stroke();
        }
        
        ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
        for (let i = 0; i < 2; i++) {
            const kx = Math.random() * 512;
            const ky = Math.random() * 512;
            const r = Math.random() * 15 + 10;
            ctx.beginPath();
            ctx.ellipse(kx, ky, r, r * 0.4, Math.random() * Math.PI, 0, Math.PI * 2);
            ctx.fill();
        }
        
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        return tex;
    },
    
    createBrick() {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        
        ctx.fillStyle = '#cbd5e1';
        ctx.fillRect(0, 0, 512, 512);
        
        const rows = 16;
        const cols = 8;
        const rh = 512 / rows;
        const cw = 512 / cols;
        const padding = 3;
        
        for (let r = 0; r < rows; r++) {
            const offset = (r % 2) * (cw / 2);
            for (let c = -1; c < cols + 1; c++) {
                const x = c * cw + offset + padding;
                const y = r * rh + padding;
                const w = cw - padding * 2;
                const h = rh - padding * 2;
                
                const tint = Math.floor(Math.random() * 20) - 10;
                ctx.fillStyle = `rgb(${148 + tint}, ${163 + tint}, ${184 + tint})`;
                ctx.fillRect(x, y, w, h);
                
                ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
                for (let i = 0; i < 5; i++) {
                    ctx.fillRect(x + Math.random() * w, y + Math.random() * h, Math.random() * 4 + 2, Math.random() * 4 + 2);
                }
            }
        }
        
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        return tex;
    },
    
    createFabric(colorHex) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        
        ctx.fillStyle = colorHex;
        ctx.fillRect(0, 0, 256, 256);
        
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 256; i += 4) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i, 256);
            ctx.stroke();
            
            ctx.beginPath();
            ctx.moveTo(0, i);
            ctx.lineTo(256, i);
            ctx.stroke();
        }
        
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.04)';
        for (let i = 2; i < 256; i += 4) {
            ctx.beginPath();
            ctx.moveTo(i, 0);
            ctx.lineTo(i, 256);
            ctx.stroke();
            
            ctx.beginPath();
            ctx.moveTo(0, i);
            ctx.lineTo(256, i);
            ctx.stroke();
        }
        
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(2, 2);
        return tex;
    },
    
    createCarpetFlat(colorHex) {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        
        // Base fabric color
        ctx.fillStyle = colorHex || '#94a3b8';
        ctx.fillRect(0, 0, 256, 256);
        
        // Authentic Panama / basketweave textile pattern
        const blockSize = 16;
        for (let y = 0; y < 256; y += blockSize) {
            for (let x = 0; x < 256; x += blockSize) {
                const isHoriz = ((x / blockSize + y / blockSize) % 2 === 0);
                
                if (isHoriz) {
                    // Horizontal yarn bundle
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.14)';
                    ctx.fillRect(x, y, blockSize, 1.5);
                    ctx.fillRect(x, y + blockSize - 1.5, blockSize, 1.5);
                    
                    // Center thread highlight
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
                    ctx.fillRect(x, y + 3, blockSize, 10);
                    
                    // Individual thread fiber striations
                    ctx.strokeStyle = 'rgba(0, 0, 0, 0.09)';
                    ctx.lineWidth = 0.8;
                    ctx.beginPath();
                    ctx.moveTo(x, y + 5); ctx.lineTo(x + blockSize, y + 5);
                    ctx.moveTo(x, y + 10); ctx.lineTo(x + blockSize, y + 10);
                    ctx.stroke();
                } else {
                    // Vertical yarn bundle
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.14)';
                    ctx.fillRect(x, y, 1.5, blockSize);
                    ctx.fillRect(x + blockSize - 1.5, y, 1.5, blockSize);
                    
                    // Center thread highlight
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
                    ctx.fillRect(x + 3, y, 10, blockSize);
                    
                    // Individual thread fiber striations
                    ctx.strokeStyle = 'rgba(0, 0, 0, 0.09)';
                    ctx.lineWidth = 0.8;
                    ctx.beginPath();
                    ctx.moveTo(x + 5, y); ctx.lineTo(x + 5, y + blockSize);
                    ctx.moveTo(x + 10, y); ctx.lineTo(x + 10, y + blockSize);
                    ctx.stroke();
                }
            }
        }
        
        // Heathered wool / cotton fiber flecks
        for (let i = 0; i < 2000; i++) {
            const rx = Math.random() * 256;
            const ry = Math.random() * 256;
            const light = Math.random() > 0.5;
            ctx.fillStyle = light ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.10)';
            ctx.fillRect(rx, ry, Math.random() * 2 + 1, Math.random() * 2 + 1);
        }
        
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        return tex;
    },
    
    createCarpetFlatBump() {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        
        ctx.fillStyle = '#808080';
        ctx.fillRect(0, 0, 256, 256);
        
        const blockSize = 16;
        for (let y = 0; y < 256; y += blockSize) {
            for (let x = 0; x < 256; x += blockSize) {
                const isHoriz = ((x / blockSize + y / blockSize) % 2 === 0);
                
                ctx.fillStyle = '#282828';
                ctx.strokeRect(x, y, blockSize, blockSize);
                
                if (isHoriz) {
                    const grad = ctx.createLinearGradient(x, y, x, y + blockSize);
                    grad.addColorStop(0, '#484848');
                    grad.addColorStop(0.5, '#eaeaea');
                    grad.addColorStop(1, '#484848');
                    ctx.fillStyle = grad;
                    ctx.fillRect(x + 1, y + 1, blockSize - 2, blockSize - 2);
                } else {
                    const grad = ctx.createLinearGradient(x, y, x + blockSize, y);
                    grad.addColorStop(0, '#484848');
                    grad.addColorStop(0.5, '#eaeaea');
                    grad.addColorStop(1, '#484848');
                    ctx.fillStyle = grad;
                    ctx.fillRect(x + 1, y + 1, blockSize - 2, blockSize - 2);
                }
            }
        }
        
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        return tex;
    },
    
    createCarpetShaggy(colorHex) {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        
        ctx.fillStyle = colorHex || '#94a3b8';
        ctx.fillRect(0, 0, 512, 512);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        ctx.fillRect(0, 0, 512, 512);
        
        // 5000 soft curved yarn tufts & fibers
        for (let i = 0; i < 5000; i++) {
            const x = Math.random() * 512;
            const y = Math.random() * 512;
            const len = Math.random() * 14 + 5;
            const angle = Math.random() * Math.PI * 2;
            const bend = (Math.random() - 0.5) * 8;
            
            const ex = x + Math.cos(angle) * len;
            const ey = y + Math.sin(angle) * len;
            const cx = (x + ex) / 2 - Math.sin(angle) * bend;
            const cy = (y + ey) / 2 + Math.cos(angle) * bend;
            
            // Base shadow of fiber
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
            ctx.lineWidth = Math.random() * 2 + 1.5;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.quadraticCurveTo(cx, cy, ex, ey);
            ctx.stroke();
            
            // Highlight of fiber
            const light = Math.random() > 0.4;
            ctx.strokeStyle = light ? 'rgba(255, 255, 255, 0.26)' : 'rgba(255, 255, 255, 0.1)';
            ctx.lineWidth = Math.random() * 1.2 + 0.8;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.quadraticCurveTo(cx, cy, ex, ey);
            ctx.stroke();
        }
        
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        return tex;
    },
    
    createCarpetShaggyBump() {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        
        ctx.fillStyle = '#222222';
        ctx.fillRect(0, 0, 512, 512);
        
        for (let i = 0; i < 4000; i++) {
            const x = Math.random() * 512;
            const y = Math.random() * 512;
            const r = Math.random() * 6 + 2;
            const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
            grad.addColorStop(0, '#ffffff');
            grad.addColorStop(0.5, '#777777');
            grad.addColorStop(1, '#222222');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }
        
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        return tex;
    },

    // --- PROCEDURAL / AI FLOOR TEXTURES ---
    createFloorTexture(type) {
        if (typeof document === 'undefined') {
            return { width: 512, height: 512 };
        }
        if (type === 'parkett_eiche') type = 'parquet_oak';
        if (type === 'fischgraet' || type === 'parquet_herringbone') type = 'herringbone';
        if (type === 'esche_hell') type = 'wood_ash';
        if (type === 'walnuss_dunkel') type = 'wood_walnut';
        if (type === 'fliesen_grau') type = 'tiles_gray';
        if (type === 'marmor_weiss') type = 'marble_white';
        if (type === 'beton_estrich') type = 'concrete';
        if (type === 'terrazzo_modern') type = 'terrazzo';
        if (type === 'schiefer_anthrazit') type = 'tiles_slate';
        if (type === 'teppich_greige' || type === 'carpet_boucle') type = 'carpet_warm';

        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        
        switch (type) {
            case 'parquet_oak': {
                // Eichenparkett Natur: 4 Längsdielen mit Versatz
                ctx.fillStyle = '#c5925e';
                ctx.fillRect(0, 0, 512, 512);
                const plankW = 128;
                const plankH = 256;
                const tones = ['#d4a373', '#c5925e', '#b88552', '#cca070'];
                
                for (let col = 0; col < 4; col++) {
                    const x = col * plankW;
                    const offset = (col % 2) * 120;
                    for (let row = -1; row < 3; row++) {
                        const y = row * plankH + offset;
                        const tone = tones[(col + Math.abs(row)) % tones.length];
                        ctx.fillStyle = tone;
                        ctx.fillRect(x + 1, y + 1, plankW - 2, plankH - 2);
                        
                        // Holzmaserung
                        ctx.strokeStyle = 'rgba(0, 0, 0, 0.06)';
                        ctx.lineWidth = 1;
                        for (let g = 0; g < 14; g++) {
                            const gx = x + Math.random() * plankW;
                            ctx.beginPath();
                            ctx.moveTo(gx, y);
                            ctx.bezierCurveTo(gx + (Math.random() - 0.5) * 12, y + plankH * 0.5, gx + (Math.random() - 0.5) * 12, y + plankH, gx, y + plankH);
                            ctx.stroke();
                        }
                        
                        // Fugen
                        ctx.strokeStyle = '#3e2712';
                        ctx.lineWidth = 1.5;
                        ctx.strokeRect(x, y, plankW, plankH);
                    }
                }
                break;
            }
            case 'herringbone': {
                // Fischgrät-Parkett Classic (45-Grad-Waben)
                ctx.fillStyle = '#b88552';
                ctx.fillRect(0, 0, 512, 512);
                const blockW = 64;
                const blockH = 128;
                for (let y = -blockH; y < 512 + blockH; y += blockW) {
                    for (let x = -blockW; x < 512 + blockW; x += blockW * 2) {
                        const isEven = Math.floor(y / blockW) % 2 === 0;
                        ctx.fillStyle = isEven ? '#c5925e' : '#b07e4c';
                        ctx.fillRect(x, y, blockW, blockH);
                        ctx.strokeStyle = '#4a2c11';
                        ctx.lineWidth = 1.5;
                        ctx.strokeRect(x, y, blockW, blockH);
                        
                        // Feine Faserlinien
                        ctx.strokeStyle = 'rgba(0,0,0,0.06)';
                        ctx.lineWidth = 0.8;
                        for (let i = 4; i < blockW; i += 8) {
                            ctx.beginPath();
                            ctx.moveTo(x + i, y);
                            ctx.lineTo(x + i, y + blockH);
                            ctx.stroke();
                        }
                    }
                }
                break;
            }
            case 'wood_ash': {
                // Helle Skandi-Esche
                ctx.fillStyle = '#ede8df';
                ctx.fillRect(0, 0, 512, 512);
                const tones = ['#f4f0e8', '#ede8df', '#e4ded3', '#dfd8cc'];
                const plankW = 128;
                for (let col = 0; col < 4; col++) {
                    const x = col * plankW;
                    ctx.fillStyle = tones[col % tones.length];
                    ctx.fillRect(x, 0, plankW, 512);
                    
                    ctx.strokeStyle = 'rgba(0, 0, 0, 0.05)';
                    for (let i = 0; i < 20; i++) {
                        const gx = x + Math.random() * plankW;
                        ctx.beginPath();
                        ctx.moveTo(gx, 0);
                        ctx.lineTo(gx + (Math.random() - 0.5) * 8, 512);
                        ctx.stroke();
                    }
                    ctx.strokeStyle = '#9ca3af';
                    ctx.lineWidth = 1;
                    ctx.strokeRect(x, 0, plankW, 512);
                }
                break;
            }
            case 'wood_walnut': {
                // Dunkles Walnussparkett
                ctx.fillStyle = '#3d2d20';
                ctx.fillRect(0, 0, 512, 512);
                const tones = ['#4a3728', '#3d2d20', '#34261b', '#423023'];
                const plankW = 128;
                for (let col = 0; col < 4; col++) {
                    const x = col * plankW;
                    ctx.fillStyle = tones[col % tones.length];
                    ctx.fillRect(x, 0, plankW, 512);
                    
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
                    for (let i = 0; i < 25; i++) {
                        const gx = x + Math.random() * plankW;
                        ctx.beginPath();
                        ctx.moveTo(gx, 0);
                        ctx.bezierCurveTo(gx + (Math.random() - 0.5) * 15, 256, gx, 512);
                        ctx.stroke();
                    }
                    ctx.strokeStyle = '#1a120c';
                    ctx.lineWidth = 1.5;
                    ctx.strokeRect(x, 0, plankW, 512);
                }
                break;
            }
            case 'tiles_gray': {
                // Moderne Feinsteinzeug-Fliesen 2x2
                ctx.fillStyle = '#cbd5e1';
                ctx.fillRect(0, 0, 512, 512);
                const tileS = 256;
                for (let r = 0; r < 2; r++) {
                    for (let c = 0; c < 2; c++) {
                        const x = c * tileS;
                        const y = r * tileS;
                        ctx.fillStyle = (r + c) % 2 === 0 ? '#d1d9e2' : '#c5cfd9';
                        ctx.fillRect(x + 2, y + 2, tileS - 4, tileS - 4);
                        
                        // Stein-Körnung
                        for (let k = 0; k < 600; k++) {
                            const kx = x + Math.random() * tileS;
                            const ky = y + Math.random() * tileS;
                            ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)';
                            ctx.fillRect(kx, ky, 2, 2);
                        }
                    }
                }
                // Fugen
                ctx.strokeStyle = '#64748b';
                ctx.lineWidth = 3;
                ctx.strokeRect(0, 0, 512, 512);
                ctx.beginPath();
                ctx.moveTo(256, 0); ctx.lineTo(256, 512);
                ctx.moveTo(0, 256); ctx.lineTo(512, 256);
                ctx.stroke();
                break;
            }
            case 'marble_white': {
                // Carrara Marmor Weiß mit Äderung
                ctx.fillStyle = '#f8fafc';
                ctx.fillRect(0, 0, 512, 512);
                // Sanfte Marmorschattierung
                const grad = ctx.createLinearGradient(0, 0, 512, 512);
                grad.addColorStop(0, 'rgba(241, 245, 249, 0.8)');
                grad.addColorStop(0.5, 'rgba(226, 232, 240, 0.4)');
                grad.addColorStop(1, 'rgba(248, 250, 252, 0.8)');
                ctx.fillStyle = grad;
                ctx.fillRect(0, 0, 512, 512);
                
                // Graue Äderungen
                ctx.strokeStyle = 'rgba(100, 116, 139, 0.22)';
                ctx.lineWidth = 2.5;
                for (let v = 0; v < 6; v++) {
                    const startX = Math.random() * 512;
                    ctx.beginPath();
                    ctx.moveTo(startX, 0);
                    ctx.bezierCurveTo(startX + 100, 150, startX - 80, 350, startX + 50, 512);
                    ctx.stroke();
                }
                ctx.strokeStyle = 'rgba(71, 85, 105, 0.12)';
                ctx.lineWidth = 1;
                for (let v = 0; v < 10; v++) {
                    const startY = Math.random() * 512;
                    ctx.beginPath();
                    ctx.moveTo(0, startY);
                    ctx.bezierCurveTo(180, startY + 60, 360, startY - 40, 512, startY + 30);
                    ctx.stroke();
                }
                // Diskrete Fuge
                ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
                ctx.lineWidth = 1.5;
                ctx.strokeRect(0, 0, 512, 512);
                break;
            }
            case 'concrete': {
                // Sichtbeton / Loft-Estrich
                ctx.fillStyle = '#71717a';
                ctx.fillRect(0, 0, 512, 512);
                for (let i = 0; i < 4000; i++) {
                    const x = Math.random() * 512;
                    const y = Math.random() * 512;
                    const r = Math.random() * 3 + 1;
                    ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';
                    ctx.fillRect(x, y, r, r);
                }
                // Spachtelzüge / Trowel marks
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
                ctx.lineWidth = 15;
                for (let j = 0; j < 8; j++) {
                    ctx.beginPath();
                    ctx.arc(Math.random() * 512, Math.random() * 512, 120, 0, Math.PI);
                    ctx.stroke();
                }
                break;
            }
            case 'terrazzo': {
                // Modern Terrazzo
                ctx.fillStyle = '#f1ede8';
                ctx.fillRect(0, 0, 512, 512);
                const chipColors = ['#c2593f', '#52796f', '#2d3748', '#d99b26', '#8d99ae', '#3a5a40'];
                for (let i = 0; i < 700; i++) {
                    const x = Math.random() * 512;
                    const y = Math.random() * 512;
                    const size = Math.random() * 7 + 2;
                    ctx.fillStyle = chipColors[Math.floor(Math.random() * chipColors.length)];
                    ctx.beginPath();
                    ctx.moveTo(x, y);
                    ctx.lineTo(x + size, y + size * 0.4);
                    ctx.lineTo(x + size * 0.6, y + size);
                    ctx.closePath();
                    ctx.fill();
                }
                break;
            }
            case 'tiles_slate': {
                // Dunkler Schiefer / Anthrazit
                ctx.fillStyle = '#1e293b';
                ctx.fillRect(0, 0, 512, 512);
                const tileS = 256;
                for (let r = 0; r < 2; r++) {
                    for (let c = 0; c < 2; c++) {
                        const x = c * tileS;
                        const y = r * tileS;
                        ctx.fillStyle = (r + c) % 2 === 0 ? '#1e293b' : '#172235';
                        ctx.fillRect(x + 2, y + 2, tileS - 4, tileS - 4);
                        
                        // Spalt-Struktur
                        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
                        ctx.lineWidth = 1;
                        for (let k = 0; k < 30; k++) {
                            const sy = y + Math.random() * tileS;
                            ctx.beginPath();
                            ctx.moveTo(x, sy);
                            ctx.lineTo(x + tileS, sy + (Math.random() - 0.5) * 6);
                            ctx.stroke();
                        }
                    }
                }
                ctx.strokeStyle = '#0f172a';
                ctx.lineWidth = 3;
                ctx.strokeRect(0, 0, 512, 512);
                ctx.beginPath();
                ctx.moveTo(256, 0); ctx.lineTo(256, 512);
                ctx.moveTo(0, 256); ctx.lineTo(512, 256);
                ctx.stroke();
                break;
            }
            case 'carpet_warm': {
                // Teppichboden Bouclé Greige
                ctx.fillStyle = '#c8c2b5';
                ctx.fillRect(0, 0, 512, 512);
                for (let y = 0; y < 512; y += 6) {
                    for (let x = 0; x < 512; x += 6) {
                        ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
                        ctx.beginPath();
                        ctx.arc(x + 3, y + 3, 2.5, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
                        ctx.beginPath();
                        ctx.arc(x + 2, y + 2, 1.2, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
                break;
            }
            default: {
                ctx.fillStyle = '#c5925e';
                ctx.fillRect(0, 0, 512, 512);
                break;
            }
        }
        
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        return tex;
    },
    
    createFloorBump(type) {
        if (typeof document === 'undefined') {
            return { width: 512, height: 512 };
        }
        if (type === 'parkett_eiche') type = 'parquet_oak';
        if (type === 'fischgraet' || type === 'parquet_herringbone') type = 'herringbone';
        if (type === 'esche_hell') type = 'wood_ash';
        if (type === 'walnuss_dunkel') type = 'wood_walnut';
        if (type === 'fliesen_grau') type = 'tiles_gray';
        if (type === 'marmor_weiss') type = 'marble_white';
        if (type === 'beton_estrich') type = 'concrete';
        if (type === 'terrazzo_modern') type = 'terrazzo';
        if (type === 'schiefer_anthrazit') type = 'tiles_slate';
        if (type === 'teppich_greige' || type === 'carpet_boucle') type = 'carpet_warm';

        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        
        ctx.fillStyle = '#808080';
        ctx.fillRect(0, 0, 512, 512);
        
        if (type === 'herringbone') {
            const blockW = 64;
            const blockH = 128;
            ctx.strokeStyle = '#202020';
            ctx.lineWidth = 1.8;
            for (let y = -blockH; y < 512 + blockH; y += blockW) {
                for (let x = -blockW; x < 512 + blockW; x += blockW * 2) {
                    ctx.strokeRect(x, y, blockW, blockH);
                }
            }
        } else if (type.includes('parquet') || type.includes('wood') || type === 'parkett_eiche') {
            const plankW = 128;
            ctx.strokeStyle = '#202020';
            ctx.lineWidth = 2.5;
            for (let c = 0; c <= 512; c += plankW) {
                ctx.beginPath(); ctx.moveTo(c, 0); ctx.lineTo(c, 512); ctx.stroke();
            }
        } else if (type.includes('tiles') || type === 'marble_white') {
            ctx.strokeStyle = '#181818';
            ctx.lineWidth = 3.5;
            ctx.strokeRect(0, 0, 512, 512);
            ctx.beginPath();
            ctx.moveTo(256, 0); ctx.lineTo(256, 512);
            ctx.moveTo(0, 256); ctx.lineTo(512, 256);
            ctx.stroke();
        } else if (type === 'carpet_warm') {
            for (let y = 0; y < 512; y += 6) {
                for (let x = 0; x < 512; x += 6) {
                    ctx.fillStyle = '#ffffff';
                    ctx.beginPath(); ctx.arc(x + 3, y + 3, 2, 0, Math.PI * 2); ctx.fill();
                }
            }
        } else if (type === 'concrete') {
            for (let i = 0; i < 2000; i++) {
                const rx = Math.random() * 512;
                const ry = Math.random() * 512;
                ctx.fillStyle = Math.random() > 0.5 ? '#909090' : '#707070';
                ctx.fillRect(rx, ry, 2, 2);
            }
        }
        
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        return tex;
    },

    // Generator für feinkörnige Putz-Bump-Map (Wand & Decke)
    createWallPlasterBump() {
        if (typeof document === 'undefined') {
            return { width: 256, height: 256 };
        }
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        
        if (ctx.createImageData && ctx.putImageData) {
            const imgData = ctx.createImageData(256, 256);
            const d = imgData.data;
            
            // Feinkörniges Grundrauschen (Sandkorn / Putzkorn)
            for (let i = 0; i < d.length; i += 4) {
                const grain = (Math.random() - 0.5) * 36;
                const v = Math.min(255, Math.max(0, Math.round(128 + grain)));
                d[i] = v;
                d[i + 1] = v;
                d[i + 2] = v;
                d[i + 3] = 255;
            }
            ctx.putImageData(imgData, 0, 0);
        } else {
            ctx.fillStyle = '#808080';
            ctx.fillRect(0, 0, 256, 256);
        }
        
        // Mehrskalige Stippling-Punkte (Spachtelzüge / Mikroporen)
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        for (let i = 0; i < 500; i++) {
            const rx = Math.random() * 256;
            const ry = Math.random() * 256;
            const r = Math.random() * 1.5 + 0.5;
            ctx.beginPath();
            ctx.arc(rx, ry, r, 0, Math.PI * 2);
            ctx.fill();
        }
        
        ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
        for (let i = 0; i < 500; i++) {
            const rx = Math.random() * 256;
            const ry = Math.random() * 256;
            const r = Math.random() * 1.5 + 0.5;
            ctx.beginPath();
            ctx.arc(rx, ry, r, 0, Math.PI * 2);
            ctx.fill();
        }
        
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        return tex;
    },
    
    // Vorschau-URL für UI-Kacheln
    _previewCache: {},
    getFloorPreviewUrl(type) {
        if (!this._previewCache) this._previewCache = {};
        if (this._previewCache[type]) return this._previewCache[type];
        try {
            const tex = this.createFloorTexture(type);
            if (tex && tex.image && typeof tex.image.toDataURL === 'function') {
                this._previewCache[type] = tex.image.toDataURL('image/jpeg', 0.85);
                return this._previewCache[type];
            }
        } catch (e) {
            // Fallback
        }
        return '';
    },

    // --- PROCEDURAL DOOR TEXTURE & BUMP ---
    _doorTexCache: {},
    createDoorTexture(colorHex = '#8b5a2b') {
        if (typeof document === 'undefined') {
            return { width: 512, height: 1024 };
        }
        if (!this._doorTexCache) this._doorTexCache = {};
        if (this._doorTexCache[colorHex]) return this._doorTexCache[colorHex];
        
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 1024;
        const ctx = canvas.getContext('2d');
        
        // Base tone
        ctx.fillStyle = colorHex;
        ctx.fillRect(0, 0, 512, 1024);
        
        // Vertical grain fibers
        ctx.fillStyle = 'rgba(0, 0, 0, 0.04)';
        for (let i = 0; i < 60; i++) {
            const x = Math.random() * 512;
            const w = Math.random() * 15 + 3;
            ctx.fillRect(x, 0, w, 1024);
        }
        
        // Longitudinal organic wood curves
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.05)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 350; i++) {
            ctx.beginPath();
            const x = Math.random() * 512;
            ctx.moveTo(x, 0);
            ctx.bezierCurveTo(
                x + (Math.random() - 0.5) * 12, 300,
                x + (Math.random() - 0.5) * 12, 700,
                x + (Math.random() - 0.5) * 6, 1024
            );
            ctx.stroke();
        }
        
        // Subtle micro-highlights
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
        for (let i = 0; i < 180; i++) {
            ctx.beginPath();
            const x = Math.random() * 512;
            ctx.moveTo(x, 0);
            ctx.bezierCurveTo(x + (Math.random() - 0.5) * 8, 300, x + (Math.random() - 0.5) * 8, 700, x, 1024);
            ctx.stroke();
        }
        
        // Architectural recessed panels (2 stacked panels)
        const marginX = 64;
        const panelW = 512 - marginX * 2;
        [{ y: 80, h: 380 }, { y: 520, h: 420 }].forEach(p => {
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
            ctx.lineWidth = 2;
            ctx.strokeRect(marginX, p.y, panelW, p.h);
            
            ctx.fillStyle = 'rgba(0, 0, 0, 0.06)';
            ctx.fillRect(marginX + 2, p.y + 2, panelW - 4, 8);
            ctx.fillRect(marginX + 2, p.y + 2, 8, p.h - 4);
            
            ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
            ctx.fillRect(marginX + 2, p.y + p.h - 10, panelW - 4, 8);
            ctx.fillRect(marginX + panelW - 10, p.y + 2, 8, p.h - 4);
        });
        
        // Edge chamfer highlight
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.fillRect(0, 0, 5, 1024);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
        ctx.fillRect(507, 0, 5, 1024);
        
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = (THREE.ClampToEdgeWrapping !== undefined) ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
        tex.wrapT = (THREE.ClampToEdgeWrapping !== undefined) ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
        this._doorTexCache[colorHex] = tex;
        return tex;
    },
    
    _doorBumpCache: null,
    createDoorBump() {
        if (typeof document === 'undefined') {
            return { width: 512, height: 1024 };
        }
        if (this._doorBumpCache) return this._doorBumpCache;
        
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 1024;
        const ctx = canvas.getContext('2d');
        
        ctx.fillStyle = '#808080';
        ctx.fillRect(0, 0, 512, 1024);
        
        ctx.strokeStyle = '#707070';
        ctx.lineWidth = 1;
        for (let i = 0; i < 250; i++) {
            const x = Math.random() * 512;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x + (Math.random() - 0.5) * 8, 1024);
            ctx.stroke();
        }
        
        const marginX = 64;
        const panelW = 512 - marginX * 2;
        [{ y: 80, h: 380 }, { y: 520, h: 420 }].forEach(p => {
            ctx.strokeStyle = '#555555';
            ctx.lineWidth = 3;
            ctx.strokeRect(marginX, p.y, panelW, p.h);
            
            ctx.strokeStyle = '#aaaaaa';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(marginX + 3, p.y + 3, panelW - 6, p.h - 6);
        });
        
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = (THREE.ClampToEdgeWrapping !== undefined) ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
        tex.wrapT = (THREE.ClampToEdgeWrapping !== undefined) ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
        this._doorBumpCache = tex;
        return tex;
    }
};

// Central registry for floor and carpet textures
const TextureRegistry = {
    floors: [
        // --- Fototexturen (Assets) ---
        {
            id: 'laminat_hell',
            name: 'Laminat Hell',
            desc: 'Eiche Landhausdiele',
            file: 'texturen/laminat_hell.jpg',
            defaultScale: 160,
            roughness: 0.82,
            metalness: 0.0,
            thumbClass: 'floor-thumb'
        },
        {
            id: 'anthrazit_holz',
            name: 'Holzboden Anthrazit',
            desc: 'Parkett Carbon',
            file: 'texturen/anthrazit_holz_boden_textur.jpg',
            defaultScale: 180,
            roughness: 0.85,
            metalness: 0.0,
            thumbClass: 'floor-thumb'
        },
        {
            id: 'teppich_flach',
            name: 'Teppichboden Schlinge',
            desc: 'Flachgewebe Anthrazit',
            file: 'texturen/teppich_textur_flach.jpg',
            defaultScale: 60,
            roughness: 0.96,
            metalness: 0.0,
            thumbClass: 'floor-thumb'
        },
        {
            id: 'teppich_hoch',
            name: 'Teppichboden Hochflor',
            desc: 'Shaggy Kuschelflor',
            file: 'texturen/teppich_hoch.jpg',
            normalMap: 'texturen/teppich_hoch_normal.jpg',
            defaultScale: 55,
            roughness: 0.98,
            metalness: 0.0,
            thumbClass: 'floor-thumb'
        },
        // --- Prozedurale Böden (Canvas PBR) ---
        {
            id: 'parquet_oak',
            aliases: ['parkett_eiche'],
            name: 'Eichenparkett Natur',
            desc: 'Klassische Eichendielen',
            procedural: true,
            defaultScale: 160,
            roughness: 0.78,
            metalness: 0.0,
            hasBump: true,
            bumpScale: 0.04,
            thumbClass: 'floor-thumb-parquet'
        },
        {
            id: 'herringbone',
            aliases: ['fischgraet', 'parquet_herringbone'],
            name: 'Fischgrät-Parkett',
            desc: 'Eiche Fischgrät Classic',
            procedural: true,
            defaultScale: 120,
            roughness: 0.75,
            metalness: 0.0,
            hasBump: true,
            bumpScale: 0.04,
            thumbClass: 'floor-thumb-herringbone'
        },
        {
            id: 'wood_ash',
            aliases: ['esche_hell'],
            name: 'Skandi-Esche',
            desc: 'Helles Skandi-Parkett',
            procedural: true,
            defaultScale: 160,
            roughness: 0.80,
            metalness: 0.0,
            hasBump: true,
            bumpScale: 0.03,
            thumbClass: 'floor-thumb-ash'
        },
        {
            id: 'wood_walnut',
            aliases: ['walnuss_dunkel'],
            name: 'Walnuss-Parkett',
            desc: 'Edles dunkles Nussholz',
            procedural: true,
            defaultScale: 160,
            roughness: 0.76,
            metalness: 0.0,
            hasBump: true,
            bumpScale: 0.03,
            thumbClass: 'floor-thumb-walnut'
        },
        {
            id: 'tiles_gray',
            aliases: ['fliesen_grau'],
            name: 'Feinsteinzeug Grau',
            desc: 'Moderne Fliesen 60x60',
            procedural: true,
            defaultScale: 120,
            roughness: 0.65,
            metalness: 0.02,
            hasBump: true,
            bumpScale: 0.05,
            thumbClass: 'floor-thumb-tiles'
        },
        {
            id: 'marble_white',
            aliases: ['marmor_weiss'],
            name: 'Carrara-Marmor',
            desc: 'Weißer Marmor mit Äderung',
            procedural: true,
            defaultScale: 150,
            roughness: 0.35,
            metalness: 0.05,
            hasBump: true,
            bumpScale: 0.03,
            thumbClass: 'floor-thumb-marble'
        },
        {
            id: 'concrete',
            aliases: ['beton_estrich'],
            name: 'Sichtbeton Loft',
            desc: 'Industrie-Estrich glatt',
            procedural: true,
            defaultScale: 200,
            roughness: 0.88,
            metalness: 0.0,
            hasBump: true,
            bumpScale: 0.02,
            thumbClass: 'floor-thumb-concrete'
        },
        {
            id: 'terrazzo',
            aliases: ['terrazzo_modern'],
            name: 'Terrazzo Modern',
            desc: 'Bunte Naturstein-Splitter',
            procedural: true,
            defaultScale: 140,
            roughness: 0.70,
            metalness: 0.02,
            hasBump: false,
            thumbClass: 'floor-thumb-terrazzo'
        },
        {
            id: 'tiles_slate',
            aliases: ['schiefer_anthrazit'],
            name: 'Schiefer Anthrazit',
            desc: 'Spalt-Schieferfliesen',
            procedural: true,
            defaultScale: 120,
            roughness: 0.80,
            metalness: 0.02,
            hasBump: true,
            bumpScale: 0.05,
            thumbClass: 'floor-thumb-slate'
        },
        {
            id: 'carpet_warm',
            aliases: ['teppich_greige', 'carpet_boucle'],
            name: 'Teppich Greige',
            desc: 'Warmer Bouclé Teppichboden',
            procedural: true,
            defaultScale: 80,
            roughness: 0.95,
            metalness: 0.0,
            hasBump: true,
            bumpScale: 0.04,
            thumbClass: 'floor-thumb-carpet'
        }
    ],
    carpets: [
        {
            id: 'flach',
            aliases: ['flat', 'teppich_flach'],
            name: 'Flachgewebe / Schlinge',
            file: 'texturen/teppich_textur_flach.jpg',
            defaultScale: 50, // cm pro Textur-Wiederholung
            roughness: 0.96
        },
        {
            id: 'hochflor',
            aliases: ['shaggy', 'hoch', 'teppich_hoch'],
            name: 'Hochflor / Shaggy',
            file: 'texturen/teppich_hoch.jpg',
            normalMap: 'texturen/teppich_hoch_normal.jpg',
            defaultScale: 45, // cm pro Textur-Wiederholung
            roughness: 0.98
        }
    ]
};

const TextureCache = {
    loader: null,
    textures: {},
    
    getLoader() {
        if (!this.loader) this.loader = new THREE.TextureLoader();
        return this.loader;
    },
    
    // Weicher nahtloser Blend-Übergang über die Kanten der Textur (verhindert harte Kanten bei Wiederholung)
    applySeamlessBlend(ctx, W, H) {
        try {
            const imgData = ctx.getImageData(0, 0, W, H);
            const data = imgData.data;
            
            // Weicher Blend-Übergang über ca. 5% der Texturbreite/-höhe
            const Bx = Math.max(16, Math.min(128, Math.round(W * 0.05)));
            const By = Math.max(16, Math.min(128, Math.round(H * 0.05)));
            
            // 1. Horizontaler nahtloser Übergang (links k=0..Bx mit rechts k=0..Bx)
            for (let y = 0; y < H; y++) {
                const rowOffset = y * W * 4;
                for (let k = 0; k < Bx; k++) {
                    const t = 0.5 + 0.5 * (1 - Math.cos((Math.PI * k) / Bx)) * 0.5;
                    const leftIdx = rowOffset + k * 4;
                    const rightIdx = rowOffset + (W - 1 - k) * 4;
                    
                    const rL = data[leftIdx];
                    const gL = data[leftIdx + 1];
                    const bL = data[leftIdx + 2];
                    
                    const rR = data[rightIdx];
                    const gR = data[rightIdx + 1];
                    const bR = data[rightIdx + 2];
                    
                    data[leftIdx]     = Math.round(t * rL + (1 - t) * rR);
                    data[leftIdx + 1] = Math.round(t * gL + (1 - t) * gR);
                    data[leftIdx + 2] = Math.round(t * bL + (1 - t) * bR);
                    
                    data[rightIdx]     = Math.round(t * rR + (1 - t) * rL);
                    data[rightIdx + 1] = Math.round(t * gR + (1 - t) * gL);
                    data[rightIdx + 2] = Math.round(t * bR + (1 - t) * bL);
                }
            }
            
            // 2. Vertikaler nahtloser Übergang (oben k=0..By mit unten k=0..By)
            for (let k = 0; k < By; k++) {
                const t = 0.5 + 0.5 * (1 - Math.cos((Math.PI * k) / By)) * 0.5;
                const topRow = k * W * 4;
                const botRow = (H - 1 - k) * W * 4;
                for (let x = 0; x < W; x++) {
                    const topIdx = topRow + x * 4;
                    const botIdx = botRow + x * 4;
                    
                    const rT = data[topIdx];
                    const gT = data[topIdx + 1];
                    const bT = data[topIdx + 2];
                    
                    const rB = data[botIdx];
                    const gB = data[botIdx + 1];
                    const bB = data[botIdx + 2];
                    
                    data[topIdx]     = Math.round(t * rT + (1 - t) * rB);
                    data[topIdx + 1] = Math.round(t * gT + (1 - t) * gB);
                    data[topIdx + 2] = Math.round(t * bT + (1 - t) * bB);
                    
                    data[botIdx]     = Math.round(t * rB + (1 - t) * rT);
                    data[botIdx + 1] = Math.round(t * gB + (1 - t) * gT);
                    data[botIdx + 2] = Math.round(t * bB + (1 - t) * bT);
                }
            }
            
            ctx.putImageData(imgData, 0, 0);
        } catch (e) {
            // Falls lokales Canvas-Sicherheitseinschränkung greift, Originalbild beibehalten
        }
    },
    
    load(url, seamless = false) {
        if (!url) return null;
        const cacheKey = (seamless ? 'seamless_' : '') + url;
        if (this.textures[cacheKey]) return this.textures[cacheKey];
        
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#b0b5be';
        ctx.fillRect(0, 0, 64, 64);
        
        // Immer echtes RepeatWrapping nutzen – NIEMALS spiegeln (MirroredRepeatWrapping),
        // damit Dielen und Maserungen immer in dieselbe Richtung parallel laufen
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        this.textures[cacheKey] = tex;
        
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            canvas.width = img.naturalWidth || 1024;
            canvas.height = img.naturalHeight || 1024;
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            
            if (seamless) {
                this.applySeamlessBlend(ctx, canvas.width, canvas.height);
            }
            
            tex.needsUpdate = true;
            if (Viewer3D.renderer && Viewer3D.scene && Viewer3D.camera) {
                Viewer3D.buildFloor3D();
                Viewer3D.renderer.render(Viewer3D.scene, Viewer3D.camera);
            }
        };
        img.src = url;
        
        return tex;
    },
    
    getFloorTexture(id) {
        const def = TextureRegistry.floors.find(f => f.id === id || (f.aliases && f.aliases.includes(id))) || TextureRegistry.floors[0];
        
        if (def.procedural || !def.file) {
            const cacheKey = 'proc_floor_' + def.id;
            const bumpKey = 'proc_bump_' + def.id;
            if (!this.textures[cacheKey]) {
                this.textures[cacheKey] = TextureGenerator.createFloorTexture(def.id);
            }
            if (def.hasBump && !this.textures[bumpKey]) {
                this.textures[bumpKey] = TextureGenerator.createFloorBump(def.id);
            }
            return {
                map: this.textures[cacheKey],
                normalMap: null,
                bumpMap: this.textures[bumpKey] || null,
                def: def
            };
        }
        
        return {
            map: this.load(def.file, true),
            normalMap: def.normalMap ? this.load(def.normalMap, true) : null,
            bumpMap: null,
            def: def
        };
    },
    
    getWallPlasterBump() {
        if (!this.textures['wall_plaster_bump']) {
            this.textures['wall_plaster_bump'] = TextureGenerator.createWallPlasterBump();
        }
        return this.textures['wall_plaster_bump'];
    },
    
    getCarpetTexture(id, colorHex) {
        const def = TextureRegistry.carpets.find(c => c.id === id || (c.aliases && c.aliases.includes(id))) || TextureRegistry.carpets[0];
        
        let map;
        if (def.id === 'flach') {
            map = this.getLightenedFlachTexture(def.file);
        } else {
            map = this.load(def.file, true);
        }
        
        return {
            map: map,
            normalMap: def.normalMap ? this.load(def.normalMap, true) : null,
            def: def
        };
    },
    
    getLightenedFlachTexture(url) {
        const cacheKey = 'tinted_' + url;
        if (this.textures[cacheKey]) return this.textures[cacheKey];
        
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        this.textures[cacheKey] = tex;
        
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            canvas.width = img.naturalWidth || 512;
            canvas.height = img.naturalHeight || 512;
            ctx.drawImage(img, 0, 0);
            try {
                const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const d = imgData.data;
                // Hebe dunkle Helligkeitswerte auf einen hellneutralen Grundwert an (145..240)
                for (let i = 0; i < d.length; i += 4) {
                    const lum = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
                    const val = Math.min(255, Math.round(145 + lum * 1.5));
                    d[i] = val;
                    d[i+1] = val;
                    d[i+2] = val;
                }
                ctx.putImageData(imgData, 0, 0);
                this.applySeamlessBlend(ctx, canvas.width, canvas.height);
            } catch (e) {
                // Bei Canvas Security Exception (z.B. restriktives file://) Fallback auf unverändertes Bild
            }
            tex.needsUpdate = true;
            if (Viewer3D.renderer && Viewer3D.scene && Viewer3D.camera) {
                Viewer3D.renderer.render(Viewer3D.scene, Viewer3D.camera);
            }
        };
        img.src = url;
        
        return tex;
    },
    
    // Legacy support für sonstige Möbel
    get(type, colorHex) {
        const key = type + '_' + (colorHex || '');
        if (this.textures[key]) return this.textures[key];
        
        let tex;
        if (type === 'wood') {
            tex = TextureGenerator.createWood(colorHex || '#8B5A2B');
        } else if (type === 'brick') {
            tex = TextureGenerator.createBrick();
        } else if (type === 'fabric') {
            tex = TextureGenerator.createFabric(colorHex || '#A89F91');
        }
        
        if (tex) this.textures[key] = tex;
        return tex;
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
    pitchCheekMeshes: [],
    ceilingLampMeshes: [],
    ceilingLampLights: [],
    sunLight: null,
    headlight: null,
    keys: {},
    pointerDownPos: null,
    flatCeilingMesh: null,
    
    // First-Person Walkthrough State
    isWalkthrough: false,
    walkthroughHeight: 165, // cm (1:1 units matching Three.js world coordinates)
    walkthroughMargin: 25,  // cm wall boundary collision margin
    walkthroughSpeed: 3.0,  // cm per frame
    walkthroughYaw: 0,      // radians
    walkthroughPitch: 0,    // radians
    savedOrbitState: null,
    isMouseDown: false,
    lastMousePos: { x: 0, y: 0 },
    showRadarAlways: false,

    get walkthroughPosition() {
        if (!this.camera && typeof THREE !== 'undefined' && THREE.PerspectiveCamera) {
            this.camera = new THREE.PerspectiveCamera(45, 1, 1, 3000);
        }
        if (!this.camera || !this.camera.position) {
            return { x: 0, y: 0, worldX: 0, worldY: this.walkthroughHeight, worldZ: 0, height: this.walkthroughHeight };
        }
        const room = State.room || { width: 500, depth: 400 };
        return {
            x: this.camera.position.x + room.width / 2,
            y: this.camera.position.z + room.depth / 2,
            worldX: this.camera.position.x,
            worldY: this.camera.position.y,
            worldZ: this.camera.position.z,
            height: this.camera.position.y
        };
    },

    set walkthroughPosition(pos) {
        if (!pos) return;
        if (!this.camera && typeof THREE !== 'undefined' && THREE.PerspectiveCamera) {
            this.camera = new THREE.PerspectiveCamera(45, 1, 1, 3000);
        }
        if (!this.camera || !this.camera.position) return;
        const room = State.room || { width: 500, depth: 400 };
        const margin = this.walkthroughMargin || 25;
        
        let wx = 0;
        let wz = 0;
        let wy = typeof pos.height === 'number' ? pos.height : (typeof pos.worldY === 'number' ? pos.worldY : this.walkthroughHeight);

        if (typeof pos.x === 'number' && typeof pos.y === 'number') {
            wx = pos.x - room.width / 2;
            wz = pos.y - room.depth / 2;
        } else if (typeof pos.worldX === 'number' && typeof pos.worldZ === 'number') {
            wx = pos.worldX;
            wz = pos.worldZ;
        }

        const minX = -room.width / 2 + margin;
        const maxX = room.width / 2 - margin;
        const minZ = -room.depth / 2 + margin;
        const maxZ = room.depth / 2 - margin;

        if (maxX >= minX) {
            wx = Math.max(minX, Math.min(maxX, wx));
        } else {
            wx = 0;
        }

        if (maxZ >= minZ) {
            wz = Math.max(minZ, Math.min(maxZ, wz));
        } else {
            wz = 0;
        }

        this.camera.position.set(wx, wy, wz);
        if (this.controls && this.controls.target && typeof THREE !== 'undefined' && THREE.Vector3) {
            const fwd = new THREE.Vector3(-Math.sin(this.walkthroughYaw || 0), 0, -Math.cos(this.walkthroughYaw || 0));
            if (this.controls.target.copy) this.controls.target.copy(this.camera.position);
            if (this.controls.target.add && fwd.multiplyScalar) this.controls.target.add(fwd.multiplyScalar(100));
        }
        if (typeof Editor2D !== 'undefined' && Editor2D.draw) {
            Editor2D.draw();
        }
    },

    get walkthroughAngle() {
        let deg = ((-this.walkthroughYaw * 180) / Math.PI) % 360;
        if (deg < 0) deg += 360;
        return deg;
    },

    set walkthroughAngle(val) {
        let rad = typeof val === 'number' ? (val * Math.PI) / 180 : 0;
        this.walkthroughYaw = -rad;
        this.updateCameraRotation();
        if (typeof Editor2D !== 'undefined' && Editor2D.draw) {
            Editor2D.draw();
        }
    },

    updateCameraRotation() {
        if (!this.camera) return;
        this.walkthroughPitch = Math.max(-1.4, Math.min(1.4, this.walkthroughPitch));
        if (this.camera.rotation) {
            this.camera.rotation.order = 'YXZ';
            this.camera.rotation.set(this.walkthroughPitch, this.walkthroughYaw, 0, 'YXZ');
        }
    },

    setWalkthroughMode(active) {
        const nextActive = !!active;
        if (this.isWalkthrough === nextActive) return; // Prevent re-entrant clobbering of savedOrbitState
        this.isWalkthrough = nextActive;

        if (!this.camera && typeof THREE !== 'undefined' && THREE.PerspectiveCamera) {
            this.camera = new THREE.PerspectiveCamera(45, 1, 1, 3000);
        }
        if (!this.controls && typeof THREE !== 'undefined' && THREE.OrbitControls) {
            this.controls = new THREE.OrbitControls(this.camera, null);
        }

        if (this.isWalkthrough) {
            if (this.camera && this.controls) {
                this.savedOrbitState = {
                    position: this.camera.position.clone ? this.camera.position.clone() : Object.assign({}, this.camera.position),
                    target: this.controls.target && this.controls.target.clone ? this.controls.target.clone() : Object.assign({}, this.controls.target)
                };
                this.controls.enabled = false;
            }

            const room = State.room || { width: 500, depth: 400 };
            const margin = this.walkthroughMargin || 25;
            const minX = -room.width / 2 + margin;
            const maxX = room.width / 2 - margin;
            const minZ = -room.depth / 2 + margin;
            const maxZ = room.depth / 2 - margin;

            if (this.camera && this.camera.position) {
                let curX = this.camera.position.x;
                let curZ = this.camera.position.z;
                if (curX < minX || curX > maxX || curZ < minZ || curZ > maxZ) {
                    curX = 0;
                    curZ = room.depth / 4;
                }
                this.camera.position.set(curX, this.walkthroughHeight, curZ);

                if (this.controls && this.controls.target) {
                    const dir = new THREE.Vector3().subVectors(this.controls.target, this.camera.position);
                    dir.y = 0;
                    if (dir.lengthSq() > 0.001) {
                        dir.normalize();
                        this.walkthroughYaw = Math.atan2(-dir.x, -dir.z);
                    } else {
                        this.walkthroughYaw = 0;
                    }
                }
                this.walkthroughPitch = 0;
                this.updateCameraRotation();
            }

            if (State.settings && (State.settings.viewMode === '2d' || State.settings.viewMode === '3d')) {
                const btnSplit = typeof document !== 'undefined' ? document.getElementById('btn-view-split') : null;
                if (btnSplit && typeof btnSplit.click === 'function') {
                    btnSplit.click();
                } else if (State.settings) {
                    State.settings.viewMode = 'split';
                }
            }

            if (typeof document !== 'undefined') {
                const btnWalk = document.getElementById('btn-walkthrough');
                if (btnWalk && btnWalk.classList) btnWalk.classList.add('active');
            }
        } else {
            if (this.controls) {
                this.controls.enabled = true;
                if (this.savedOrbitState && this.camera && this.camera.position) {
                    if (this.camera.position.copy) this.camera.position.copy(this.savedOrbitState.position);
                    else Object.assign(this.camera.position, this.savedOrbitState.position);
                    if (this.controls.target) {
                        if (this.controls.target.copy) this.controls.target.copy(this.savedOrbitState.target);
                        else Object.assign(this.controls.target, this.savedOrbitState.target);
                    }
                }
                this.savedOrbitState = null; // Clear saved state upon exit
            }

            if (typeof document !== 'undefined') {
                const btnWalk = document.getElementById('btn-walkthrough');
                if (btnWalk && btnWalk.classList) btnWalk.classList.remove('active');
                if (document.exitPointerLock && document.pointerLockElement) {
                    try { document.exitPointerLock(); } catch(e) {}
                }
            }
        }

        if (typeof Editor2D !== 'undefined' && Editor2D.draw) {
            Editor2D.draw();
        }
    },
    
    setTheme(theme) {
        if (this.scene && typeof THREE !== 'undefined') {
            const col = theme === 'dark' ? 0x09090b : 0xf8fafc;
            this.scene.background = new THREE.Color(col);
        }
    },
    
    updateTheme(theme) {
        this.setTheme(theme);
    },
    
    init() {
        this.container = document.getElementById('threeCanvasContainer');
        if (!this.container) return;
        
        // Scene setup
        this.scene = new THREE.Scene();
        const initialTheme = (typeof document !== 'undefined' && document.documentElement && document.documentElement.getAttribute('data-theme')) || 'dark';
        this.scene.background = new THREE.Color(initialTheme === 'dark' ? 0x09090b : 0xf8fafc);
        
        // Camera setup
        this.camera = new THREE.PerspectiveCamera(45, this.container.clientWidth / this.container.clientHeight, 1, 3000);
        this.camera.position.set(400, 500, 600);
        
        // Renderer setup (preserveDrawingBuffer enables high-res PNG snapshot export)
        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        if (THREE.sRGBEncoding !== undefined) {
            this.renderer.outputEncoding = THREE.sRGBEncoding;
        }
        this.renderer.physicallyCorrectLights = true;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        this.container.appendChild(this.renderer.domElement);
        
        // Orbit Controls
        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.minPolarAngle = 0.03; // Vertikal nach unten blicken
        this.controls.maxPolarAngle = Math.PI - 0.03; // Vertikal nach oben blicken (Decke / Dachschräge)
        this.controls.minDistance = 20;
        this.controls.maxDistance = 2500;
        
        // Lights (Soft, natural warm interior lighting)
        const ambientLight = new THREE.AmbientLight(0xfaf5ec, 0.55);
        this.scene.add(ambientLight);
        
        // Headlight (attached to camera to follow viewer angle) - softened for eye-comfort without harsh hot-spots
        this.headlight = new THREE.DirectionalLight(0xfffbf2, 0.35);
        this.headlight.position.set(0, 0, 1);
        this.camera.add(this.headlight);
        this.scene.add(this.camera);
        
        this.sunLight = new THREE.DirectionalLight(0xfff8e8, 1.1); // Warm sun light
        this.sunLight.castShadow = true;
        this.sunLight.shadow.mapSize.width = 2048;
        this.sunLight.shadow.mapSize.height = 2048;
        this.sunLight.shadow.camera.near = 50;
        this.sunLight.shadow.camera.far = 5000;
        this.sunLight.shadow.bias = -0.0008; // avoid shadow acne / stripes
        this.sunLight.shadow.normalBias = 0.02;
        const d = 1000;
        this.sunLight.shadow.camera.left = -d;
        this.sunLight.shadow.camera.right = d;
        this.sunLight.shadow.camera.top = d;
        this.sunLight.shadow.camera.bottom = -d;
        this.scene.add(this.sunLight);
        this.scene.add(this.sunLight.target);
        
        this.updateSunLight();

        const dirLight2 = new THREE.DirectionalLight(0xa5b4fc, 0.2); // soft bluish fill light
        dirLight2.position.set(-400, 300, -300);
        this.scene.add(dirLight2);
        
        // Event listeners
        window.addEventListener('resize', () => this.resizeViewer());
        this.initKeyboardControls();
        this.initWalkthroughControls();
        this.initWallClickRaycaster();
        
        // Start animation loop
        this.animate();
        
        // Rebuild full room
        this.rebuildFullRoom();
    },
    
    initKeyboardControls() {
        window.addEventListener('keydown', (e) => {
            if (typeof document !== 'undefined' && document.activeElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
            const code = e.code;
            if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight'].includes(code)) {
                if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(code)) {
                    if (e.preventDefault) e.preventDefault();
                }
                this.keys[code] = true;
            }
        });
        window.addEventListener('keyup', (e) => {
            const code = e.code;
            if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight'].includes(code)) {
                this.keys[code] = false;
            }
        });
    },

    initWalkthroughControls() {
        if (!this.container) return;

        this.container.addEventListener('click', () => {
            if (this.isWalkthrough && this.renderer && this.renderer.domElement) {
                try {
                    const canvas = this.renderer.domElement;
                    if (canvas.requestPointerLock && typeof document !== 'undefined' && document.pointerLockElement !== canvas) {
                        const lockPromise = canvas.requestPointerLock();
                        if (lockPromise && lockPromise.catch) {
                            lockPromise.catch(() => {});
                        }
                    }
                } catch (e) {}
            }
        });

        this.container.addEventListener('mousedown', (e) => {
            if (this.isWalkthrough) {
                this.isMouseDown = true;
                this.lastMousePos = { x: e.clientX, y: e.clientY };
            }
        });

        window.addEventListener('mouseup', () => {
            this.isMouseDown = false;
        });

        window.addEventListener('mousemove', (e) => {
            if (!this.isWalkthrough) return;
            const canvas = this.renderer ? this.renderer.domElement : null;
            const isLocked = typeof document !== 'undefined' && document.pointerLockElement === canvas;

            let dx = 0;
            let dy = 0;

            if (isLocked) {
                dx = e.movementX || 0;
                dy = e.movementY || 0;
            } else if (this.isMouseDown) {
                dx = e.clientX - this.lastMousePos.x;
                dy = e.clientY - this.lastMousePos.y;
                this.lastMousePos = { x: e.clientX, y: e.clientY };
            }

            if (dx !== 0 || dy !== 0) {
                const sensitivity = 0.0025;
                this.walkthroughYaw -= dx * sensitivity;
                this.walkthroughPitch -= dy * sensitivity;
                this.updateCameraRotation();
                if (typeof Editor2D !== 'undefined' && Editor2D.draw) {
                    Editor2D.draw();
                }
            }
        });

        window.addEventListener('blur', () => {
            this.keys = {};
            this.isMouseDown = false;
        });
    },
    
    initWallClickRaycaster() {
        if (!this.renderer) return;
        
        // Cache reusable raycaster and pointer vector
        if (!this.raycaster) this.raycaster = new THREE.Raycaster();
        if (!this.mouseVec) this.mouseVec = new THREE.Vector2();
        
        this.renderer.domElement.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return; // Primary left button only
            this.pointerDownPos = { x: e.clientX, y: e.clientY };
            this.pointerDownTime = performance.now();
        });
        
        this.renderer.domElement.addEventListener('pointerup', (e) => {
            if (!this.pointerDownPos || e.button !== 0) return;
            const dist = Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y);
            const duration = performance.now() - (this.pointerDownTime || 0);
            this.pointerDownPos = null;
            this.pointerDownTime = 0;
            
            // Camera orbit drag or prolonged hold filter
            if (dist > 5 || duration > 350) return;
            
            const rect = this.renderer.domElement.getBoundingClientRect();
            this.mouseVec.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            this.mouseVec.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            
            this.raycaster.setFromCamera(this.mouseVec, this.camera);
            
            // Build comprehensive interactables list
            const interactables = [];
            
            // 1. All placed furniture groups
            if (this.furnitureMeshes && this.furnitureMeshes.size > 0) {
                this.furnitureMeshes.forEach((group) => {
                    if (group && group.visible !== false) {
                        interactables.push(group);
                    }
                });
            }
            
            // 2. Wall meshes
            if (this.wallMeshes && this.wallMeshes.length > 0) {
                interactables.push(...this.wallMeshes);
            }
            
            // 3. Ceiling & pitches
            if (this.ceilingMesh) interactables.push(this.ceilingMesh);
            if (this.pitchCheekMeshes && this.pitchCheekMeshes.length > 0) interactables.push(...this.pitchCheekMeshes);
            if (this.flatCeilingMesh) interactables.push(this.flatCeilingMesh);
            
            // 4. Floor plane (for empty floor click detection)
            if (this.floorMesh) interactables.push(this.floorMesh);
            
            const hits = this.raycaster.intersectObjects(interactables, true);
            
            // Empty space / sky click -> Deselect
            if (!hits || hits.length === 0) {
                selectItem(null, null);
                return;
            }
            
            const hitObj = hits[0].object;
            
            // Direct floor click (not on a rug or furniture) -> Deselect
            if (hitObj === this.floorMesh) {
                selectItem(null, null);
                return;
            }
            
            // Recursive scene graph traversal to identify root entity
            let current = hitObj;
            let hitFurniture = null;
            let surfaceTarget = null;
            
            while (current && current !== this.scene) {
                if (current.userData) {
                    if (current.userData.furniture) {
                        hitFurniture = current.userData.furniture;
                        break;
                    }
                    if (current.userData.wallName || current.userData.surfaceTarget) {
                        surfaceTarget = current.userData.wallName || current.userData.surfaceTarget;
                        break;
                    }
                }
                current = current.parent;
            }
            
            if (hitFurniture) {
                selectItem(hitFurniture, 'furniture');
            } else if (surfaceTarget) {
                selectItem(null, null); // Deselect active furniture when selecting a wall
                selectSurfaceTarget(surfaceTarget);
            } else {
                selectItem(null, null);
            }
        });
    },
    
    resizeViewer() {
        if (!this.container || !this.renderer) return;
        this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    },
    
    updateSunLight() {
        if (!this.sunLight || !this.headlight) return;
        
        const isSunMode = State.settings.lightingMode === 'sun';
        
        // 1. Sun light setup
        this.sunLight.visible = isSunMode;
        this.sunLight.castShadow = isSunMode;
        
        // 2. Headlight setup
        this.headlight.visible = !isSunMode;
        
        // 3. Ceiling shadow casting
        if (this.ceilingMesh) {
            this.ceilingMesh.castShadow = isSunMode;
        }
        
        if (isSunMode) {
            const angleRad = (State.settings.sunAngle || 45) * Math.PI / 180;
            const elevRad = (State.settings.sunElevation || 45) * Math.PI / 180;
            
            // Calculate direction vector (sun dome radius of 2500cm to keep it outside the room)
            const r = 2500;
            const x = r * Math.cos(elevRad) * Math.cos(angleRad);
            const z = r * Math.cos(elevRad) * Math.sin(angleRad);
            const y = r * Math.sin(elevRad);
            
            this.sunLight.position.set(x, y, z);
            this.sunLight.target.position.set(0, 0, 0);
        }
    },
    
    animate() {
        if (typeof requestAnimationFrame !== 'undefined') {
            requestAnimationFrame(() => this.animate());
        }
        
        if (this.isWalkthrough && this.camera) {
            const moveDelta = new THREE.Vector3();
            const speed = this.walkthroughSpeed || 3.0; // cm per frame

            // In Three.js: yaw 0 looks toward -Z, so forward is (-sin(yaw), 0, -cos(yaw))
            const fwd = new THREE.Vector3(-Math.sin(this.walkthroughYaw), 0, -Math.cos(this.walkthroughYaw));
            const side = new THREE.Vector3(-fwd.z, 0, fwd.x);

            if (this.keys['KeyW'] || this.keys['ArrowUp']) moveDelta.addScaledVector(fwd, speed);
            if (this.keys['KeyS'] || this.keys['ArrowDown']) moveDelta.addScaledVector(fwd, -speed);
            if (this.keys['KeyA'] || this.keys['ArrowLeft']) moveDelta.addScaledVector(side, -speed);
            if (this.keys['KeyD'] || this.keys['ArrowRight']) moveDelta.addScaledVector(side, speed);

            // Turning via ArrowLeft / ArrowRight or Q / E
            const turnSpeed = 0.03;
            if (this.keys['KeyQ']) {
                this.walkthroughYaw += turnSpeed;
                this.updateCameraRotation();
            }
            if (this.keys['KeyE']) {
                this.walkthroughYaw -= turnSpeed;
                this.updateCameraRotation();
            }

            if (moveDelta.lengthSq() > 0) {
                if (typeof this.camera.position.add === 'function') {
                    const oldX = this.camera.position.x;
                    const oldY = this.camera.position.y;
                    const oldZ = this.camera.position.z;
                    this.camera.position.add(moveDelta);
                    if (this.camera.position.x === oldX && moveDelta.x !== 0) {
                        this.camera.position.x += moveDelta.x;
                    }
                    if (this.camera.position.y === oldY && moveDelta.y !== 0) {
                        this.camera.position.y += moveDelta.y;
                    }
                    if (this.camera.position.z === oldZ && moveDelta.z !== 0) {
                        this.camera.position.z += moveDelta.z;
                    }
                } else {
                    this.camera.position.x = (this.camera.position.x || 0) + moveDelta.x;
                    this.camera.position.y = (this.camera.position.y || 0) + moveDelta.y;
                    this.camera.position.z = (this.camera.position.z || 0) + moveDelta.z;
                }
            }

            // Boundary collision clamping with 25cm margin
            const room = State.room || { width: 500, depth: 400 };
            const margin = this.walkthroughMargin || 25;
            const minX = -room.width / 2 + margin;
            const maxX = room.width / 2 - margin;
            const minZ = -room.depth / 2 + margin;
            const maxZ = room.depth / 2 - margin;

            if (maxX >= minX) {
                this.camera.position.x = Math.max(minX, Math.min(maxX, this.camera.position.x));
            } else {
                this.camera.position.x = 0;
            }

            if (maxZ >= minZ) {
                this.camera.position.z = Math.max(minZ, Math.min(maxZ, this.camera.position.z));
            } else {
                this.camera.position.z = 0;
            }

            this.camera.position.y = this.walkthroughHeight || 165;
            this.updateCameraRotation();

            // Real-time synchronization: redraw 2D radar cone
            if (typeof Editor2D !== 'undefined' && Editor2D.draw) {
                Editor2D.draw();
            }
        } else if (this.camera && this.controls) {
            const moveDelta = new THREE.Vector3();
            const speed = 2.8; // cm pro Frame - angenehm und feinfühlig steuerbar
            
            // 1. WASD-Steuerung: Bewegen / Laufen im Raum (Forward, Backward, Strafe Left/Right)
            const forward = new THREE.Vector3();
            this.camera.getWorldDirection(forward);
            forward.y = 0;
            if (forward.lengthSq() > 0.0001) {
                forward.normalize();
            } else {
                // Bei Blick fast senkrecht nach oben/unten: Horizontale Vorwärtsrichtung aus Kamera-Up ableiten
                const camUp = this.camera.up.clone().applyQuaternion(this.camera.quaternion);
                forward.copy(camUp);
                forward.y = 0;
                if (forward.lengthSq() > 0.0001) {
                    forward.normalize();
                } else {
                    forward.set(0, 0, -1);
                }
            }
            const side = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
            
            if (this.keys['KeyW']) moveDelta.addScaledVector(forward, speed);
            if (this.keys['KeyS']) moveDelta.addScaledVector(forward, -speed);
            if (this.keys['KeyA']) moveDelta.addScaledVector(side, -speed);
            if (this.keys['KeyD']) moveDelta.addScaledVector(side, speed);
            
            // 2. Vertikale Flugsteuerung: Leertaste = Hoch, Shift = Runter
            if (this.keys['Space']) moveDelta.y += speed;
            if (this.keys['ShiftLeft'] || this.keys['ShiftRight']) {
                if (this.camera.position.y > 15) {
                    moveDelta.y -= speed;
                }
            }
            
            if (moveDelta.lengthSq() > 0) {
                this.camera.position.add(moveDelta);
                this.controls.target.add(moveDelta);
            }
            
            // 3. Pfeiltasten-Steuerung: Kameraneigung (Tilt) und Blickrichtung (Turn)
            if (this.keys['ArrowLeft'] || this.keys['ArrowRight'] || this.keys['ArrowUp'] || this.keys['ArrowDown']) {
                const rotSpeed = 0.016; // Radian pro Frame - weichere, kontrollierte Drehung
                
                // Vektor von Kamera zum Blickziel (Look Vector)
                const look = new THREE.Vector3().subVectors(this.controls.target, this.camera.position);
                const lookDist = Math.max(50, look.length());
                
                let theta = Math.atan2(look.x, look.z);
                let phi = Math.acos(Math.max(-1, Math.min(1, look.y / lookDist)));
                
                // Pfeil Links / Rechts: Horizontales Schwenken (Turn Left / Right)
                if (this.keys['ArrowLeft']) theta += rotSpeed;
                if (this.keys['ArrowRight']) theta -= rotSpeed;
                
                // Pfeil Oben / Unten: Vertikale Kameraneigung (Tilt Up / Down)
                // phi = 0 ist senkrecht nach oben blicken (Decke)
                // phi = Math.PI ist senkrecht nach unten blicken (Boden)
                if (this.keys['ArrowUp']) phi = Math.max(0.05, phi - rotSpeed); // Nach oben neigen bis vertikal nach oben
                if (this.keys['ArrowDown']) phi = Math.min(Math.PI - 0.05, phi + rotSpeed); // Nach unten neigen bis vertikal nach unten
                
                look.x = lookDist * Math.sin(phi) * Math.sin(theta);
                look.y = lookDist * Math.cos(phi);
                look.z = lookDist * Math.sin(phi) * Math.cos(theta);
                
                this.controls.target.copy(this.camera.position).add(look);
            }
            
            this.controls.update();
            
            // Kamera niemals unter den Boden fallen lassen
            if (this.camera.position.y < 8) {
                this.camera.position.y = 8;
            }
        }
        
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
        
        // 7. Build Ceiling Lamps
        this.rebuildCeilingLamps();
    },
    
    clearScene() {
        if (this.flatCeilingMesh) {
            this.scene.remove(this.flatCeilingMesh);
            this.flatCeilingMesh = null;
        }
        if (this.ceilingLampMeshes) {
            this.ceilingLampMeshes.forEach(mesh => {
                if (mesh.userData && mesh.userData.pointLight && mesh.userData.pointLight.shadow && mesh.userData.pointLight.shadow.map) {
                    mesh.userData.pointLight.shadow.map.dispose();
                }
                this.scene.remove(mesh);
            });
            this.ceilingLampMeshes = [];
        }
        if (this.ceilingLampLights) {
            this.ceilingLampLights.forEach(light => this.scene.remove(light));
            this.ceilingLampLights = [];
        }
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
        
        if (this.pitchCheekMeshes) {
            this.pitchCheekMeshes.forEach(mesh => this.scene.remove(mesh));
            this.pitchCheekMeshes = [];
        }
        
        if (this.floorMesh) this.scene.remove(this.floorMesh);
        if (this.ceilingMesh) this.scene.remove(this.ceilingMesh);
        if (this.flatCeilingMesh) {
            this.scene.remove(this.flatCeilingMesh);
            this.flatCeilingMesh = null;
        }
        if (this.gridHelper) this.scene.remove(this.gridHelper);
    },
    
    buildFloor3D() {
        const room = State.room;
        const isTextureMode = State.settings.viewStyle3D === 'texture';
        
        if (this.floorMesh) {
            this.scene.remove(this.floorMesh);
            this.floorMesh = null;
        }
        if (this.gridHelper) {
            this.scene.remove(this.gridHelper);
            this.gridHelper = null;
        }
        
        // Floor geometry
        const floorGeo = new THREE.BoxGeometry(room.width, 2, room.depth);
        let floorMat;
        
        if (isTextureMode) {
            const floorType = room.floorTexture || 'laminat_hell';
            const floorInfo = TextureCache.getFloorTexture(floorType);
            const floorDef = floorInfo.def;
            const floorTex = floorInfo.map;
            const floorNormal = floorInfo.normalMap;
            const floorBump = floorInfo.bumpMap;
            
            // Texturskalierung anwenden (defaultScale in cm * userScale)
            const userScale = Math.max(0.3, Math.min(3.0, room.floorScale || 1.0));
            const tileSize = (floorDef.defaultScale || 160) * userScale;
            
            // Aspektverhältnis des Texturbildes berücksichtigen für unverzerrte, natürliche Dielenproportionen
            let aspect = 1.0;
            if (floorTex && floorTex.image && floorTex.image.width && floorTex.image.height) {
                aspect = floorTex.image.width / floorTex.image.height;
            } else if (floorDef.file) {
                aspect = 1.79;
            }
            const tileSizeX = tileSize;
            const tileSizeY = tileSize / aspect;
            
            const repX = Math.max(0.2, room.width / tileSizeX);
            const repY = Math.max(0.2, room.depth / tileSizeY);
            
            if (floorTex && floorTex.repeat) floorTex.repeat.set(repX, repY);
            if (floorNormal && floorNormal.repeat) floorNormal.repeat.set(repX, repY);
            if (floorBump && floorBump.repeat) floorBump.repeat.set(repX, repY);
            
            floorMat = new THREE.MeshStandardMaterial({
                map: floorTex,
                normalMap: floorNormal || null,
                normalScale: floorNormal ? new THREE.Vector2(0.8, 0.8) : null,
                bumpMap: floorBump || null,
                bumpScale: floorBump ? (floorDef.bumpScale !== undefined ? floorDef.bumpScale : 0.04) : 0,
                roughness: floorDef.roughness !== undefined ? floorDef.roughness : 0.85,
                metalness: floorDef.metalness !== undefined ? floorDef.metalness : 0.0
            });
        } else {
            floorMat = new THREE.MeshStandardMaterial({
                color: 0x1e293b, // slate-800
                roughness: 0.8,
                metalness: 0.1
            });
        }
        
        this.floorMesh = new THREE.Mesh(floorGeo, floorMat);
        this.floorMesh.position.set(0, -1, 0); // top face at y=0
        this.floorMesh.receiveShadow = true;
        this.scene.add(this.floorMesh);
        
        // Add Grid lines only in planning mode
        this.gridHelper = new THREE.GridHelper(Math.max(room.width, room.depth) * 1.5, 50, 0x475569, 0x334155);
        this.gridHelper.position.set(0, 0.1, 0);
        this.gridHelper.visible = !isTextureMode;
        this.scene.add(this.gridHelper);
    },
    
    rebuildWalls3D() {
        // Ensure skylights conform to constraints
        State.elements.forEach(el => {
            if (el.type === 'skylight') clampSkylightConstraints(el);
        });
        
        // Clear existing walls, doors, windows, skylights
        this.wallMeshes.forEach(m => this.scene.remove(m));
        this.wallMeshes = [];
        this.doorMeshes.forEach(m => this.scene.remove(m));
        this.doorMeshes = [];
        this.windowMeshes.forEach(m => this.scene.remove(m));
        this.windowMeshes = [];
        this.skylightMeshes.forEach(m => this.scene.remove(m));
        this.skylightMeshes = [];
        if (this.pitchCheekMeshes) {
            this.pitchCheekMeshes.forEach(m => this.scene.remove(m));
            this.pitchCheekMeshes = [];
        }
        
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
            const samplePoints = [spec.length];
            
            // 1. Pitches on perpendicular walls that meet this wall's ends
            if (spec.name === 'top') {
                const interLeft = getPitchInterval(room.pitches.left, 'left');
                if (interLeft && interLeft.end >= room.depth) samplePoints.push(room.pitches.left.run);
                const interRight = getPitchInterval(room.pitches.right, 'right');
                if (interRight && interRight.start <= 0) samplePoints.push(room.width - room.pitches.right.run);
            } else if (spec.name === 'bottom') {
                const interRight = getPitchInterval(room.pitches.right, 'right');
                if (interRight && interRight.end >= room.depth) samplePoints.push(room.pitches.right.run);
                const interLeft = getPitchInterval(room.pitches.left, 'left');
                if (interLeft && interLeft.start <= 0) samplePoints.push(room.width - room.pitches.left.run);
            } else if (spec.name === 'left') {
                const interBottom = getPitchInterval(room.pitches.bottom, 'bottom');
                if (interBottom && interBottom.end >= room.width) samplePoints.push(room.pitches.bottom.run);
                const interTop = getPitchInterval(room.pitches.top, 'top');
                if (interTop && interTop.start <= 0) samplePoints.push(room.depth - room.pitches.top.run);
            } else if (spec.name === 'right') {
                const interTop = getPitchInterval(room.pitches.top, 'top');
                if (interTop && interTop.end >= room.width) samplePoints.push(room.pitches.top.run);
                const interBottom = getPitchInterval(room.pitches.bottom, 'bottom');
                if (interBottom && interBottom.start <= 0) samplePoints.push(room.depth - room.pitches.bottom.run);
            }

            // 2. Pitch on this wall itself: add step/slope boundaries for outer and inner start/end
            const interSelf = getPitchInterval(room.pitches[spec.name], spec.name);
            if (interSelf) {
                [interSelf.outerStart, interSelf.innerStart, interSelf.innerEnd, interSelf.outerEnd].forEach(pt => {
                    if (pt > 0 && pt < spec.length) {
                        samplePoints.push(pt + 0.01);
                        samplePoints.push(pt - 0.01);
                    }
                });
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
                
                if (elem.type === 'door' || elem.type === 'double-door') {
                    // Door hole starts at floor level (v=0)
                    holePath.moveTo(elem.position - halfW, 0);
                    holePath.lineTo(elem.position + halfW, 0);
                    holePath.lineTo(elem.position + halfW, elem.h);
                    holePath.lineTo(elem.position - halfW, elem.h);
                    holePath.closePath();
                    shape.holes.push(holePath);
                    
                    // Create wood frame & door leaf mesh
                    if (elem.type === 'door') {
                        this.createDoorMesh3D(spec, elem);
                    } else {
                        this.createDoubleDoorMesh3D(spec, elem);
                    }
                    
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
            const isTextureMode = State.settings.viewStyle3D === 'texture';
            
            let wallMat;
            if (isTextureMode) {
                const wallColors = State.room.wallColors || {};
                const hexColor = wallColors[spec.name] || '#f0eee9';
                
                const plasterBump = TextureCache.getWallPlasterBump();
                let wallBump = null;
                if (plasterBump) {
                    wallBump = plasterBump.clone();
                    if (wallBump.repeat) {
                        wallBump.repeat.set(
                            Math.max(1, Math.round(spec.length / 50)),
                            Math.max(1, Math.round(State.room.height / 50))
                        );
                    }
                    wallBump.needsUpdate = true;
                }
                
                wallMat = new THREE.MeshStandardMaterial({
                    color: hexColor,
                    roughness: 0.92,
                    metalness: 0.02,
                    bumpMap: wallBump,
                    bumpScale: wallBump ? 0.003 : 0,
                    transparent: false,
                    opacity: 1.0,
                    side: THREE.DoubleSide
                });
            } else {
                wallMat = new THREE.MeshStandardMaterial({
                    color: 0x334155, // slate-700
                    roughness: 0.6,
                    metalness: 0.1,
                    transparent: true,
                    opacity: 0.85
                });
            }
            
            const wallMesh = new THREE.Mesh(wallGeo, wallMat);
            wallMesh.userData = { wallName: spec.name };
            
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

        // 6. Build Slanted Roof (visible and solid non-transparent roof pitches)
        this.buildCeilingRoof3D();
        
        // 7. Build Vertical Triangular Cheek Walls (Wangen / Stirnwände) for partial slants
        this.buildPitchCheekMeshes3D();
    },

    buildDoorHandle3D(leafW, leafThick, isLeft) {
        const handleGroup = new THREE.Group();
        
        const metalMat = new THREE.MeshStandardMaterial({
            color: 0xd4d4d8,
            metalness: 0.88,
            roughness: 0.22
        });
        
        const rosetteGeo = new THREE.BoxGeometry(3.2, 16, 0.4);
        const spindleGeo = new THREE.CylinderGeometry(0.7, 0.7, 4.0, 10);
        const leverGeo = new THREE.BoxGeometry(11, 1.8, 1.2);
        const keyholeGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.45, 8);
        const keyholeMat = new THREE.MeshBasicMaterial({ color: 0x18181b });
        
        const leverDir = isLeft ? -1 : 1;
        
        [-1, 1].forEach(side => {
            const sideGroup = new THREE.Group();
            
            const rosette = new THREE.Mesh(rosetteGeo, metalMat);
            rosette.position.set(0, 0, side * (leafThick / 2 + 0.2));
            rosette.castShadow = true;
            sideGroup.add(rosette);
            
            const spindle = new THREE.Mesh(spindleGeo, metalMat);
            spindle.rotation.x = Math.PI / 2;
            spindle.position.set(0, 2.5, side * (leafThick / 2 + 2.0));
            spindle.castShadow = true;
            sideGroup.add(spindle);
            
            const lever = new THREE.Mesh(leverGeo, metalMat);
            lever.position.set(leverDir * 4.5, 2.5, side * (leafThick / 2 + 4.0));
            lever.castShadow = true;
            sideGroup.add(lever);
            
            const keyhole = new THREE.Mesh(keyholeGeo, keyholeMat);
            keyhole.rotation.x = Math.PI / 2;
            keyhole.position.set(0, -3.5, side * (leafThick / 2 + 0.2));
            sideGroup.add(keyhole);
            
            handleGroup.add(sideGroup);
        });
        
        return handleGroup;
    },
    
    createDoorMesh3D(spec, door) {
        const offset = this.roomOffset;
        const coords = getWallCoordinates(spec.name, door.position);
        
        const doorGroup = new THREE.Group();
        
        const hinge = door.hinge || 'left';
        const dir = door.direction || 'in';
        const isLeft = hinge === 'left';
        const isIn = dir === 'in';
        
        const casingW = 4.5;
        const casingD = 12; // Wall is 10cm, casing protrudes 1cm inside & outside
        const casingColor = door.frameColor || 0x475569;
        const casingMat = new THREE.MeshStandardMaterial({ color: casingColor, roughness: 0.5, metalness: 0.05 });
        
        // 1. Umfassungszarge (3-sided casing)
        // Left jamb
        const jambGeo = new THREE.BoxGeometry(casingW, door.h, casingD);
        const jambL = new THREE.Mesh(jambGeo, casingMat);
        jambL.position.set(-door.w / 2 + casingW / 2, door.h / 2, 0);
        jambL.castShadow = true;
        jambL.receiveShadow = true;
        doorGroup.add(jambL);
        
        // Right jamb
        const jambR = new THREE.Mesh(jambGeo, casingMat);
        jambR.position.set(door.w / 2 - casingW / 2, door.h / 2, 0);
        jambR.castShadow = true;
        jambR.receiveShadow = true;
        doorGroup.add(jambR);
        
        // Top lintel
        const lintelGeo = new THREE.BoxGeometry(door.w + 2, casingW, casingD);
        const lintel = new THREE.Mesh(lintelGeo, casingMat);
        lintel.position.set(0, door.h - casingW / 2, 0);
        lintel.castShadow = true;
        lintel.receiveShadow = true;
        doorGroup.add(lintel);
        
        // Pivot point for opening door leaf
        const pivot = new THREE.Group();
        const pivotX = isLeft ? -door.w / 2 + casingW - 0.5 : door.w / 2 - casingW + 0.5;
        pivot.position.set(pivotX, 1, 0);
        
        const leafW = door.w - casingW * 2 + 2;
        const leafH = door.h - casingW - 1;
        const leafThick = 4.0;
        
        if (door.isBalcony) {
            // Balcony Door (Glass with frame)
            const frameColor = door.color3d || door.color || '#ffffff';
            const whiteMat = new THREE.MeshStandardMaterial({ color: frameColor, roughness: 0.4 });
            const glassMat = new THREE.MeshPhysicalMaterial({
                color: 0xf8fafc,
                transparent: true,
                opacity: 0.3,
                roughness: 0.05,
                metalness: 0.1,
                transmission: 0.92,
                ior: 1.52,
                clearcoat: 1.0,
                clearcoatRoughness: 0.05,
                side: THREE.DoubleSide
            });
            
            const leafGroup = new THREE.Group();
            
            const leftBarGeo = new THREE.BoxGeometry(6, leafH, leafThick);
            const leftBar = new THREE.Mesh(leftBarGeo, whiteMat);
            leftBar.position.set(-leafW / 2 + 3, leafH / 2, 0);
            leftBar.castShadow = true;
            leftBar.receiveShadow = true;
            leafGroup.add(leftBar);
            
            const rightBarGeo = new THREE.BoxGeometry(6, leafH, leafThick);
            const rightBar = new THREE.Mesh(rightBarGeo, whiteMat);
            rightBar.position.set(leafW / 2 - 3, leafH / 2, 0);
            rightBar.castShadow = true;
            rightBar.receiveShadow = true;
            leafGroup.add(rightBar);
            
            const topBarW = leafW - 12;
            const topBarGeo = new THREE.BoxGeometry(topBarW, 6, leafThick);
            const topBar = new THREE.Mesh(topBarGeo, whiteMat);
            topBar.position.set(0, leafH - 3, 0);
            topBar.castShadow = true;
            topBar.receiveShadow = true;
            leafGroup.add(topBar);
            
            const bottomBarGeo = new THREE.BoxGeometry(topBarW, 12, leafThick);
            const bottomBar = new THREE.Mesh(bottomBarGeo, whiteMat);
            bottomBar.position.set(0, 6, 0);
            bottomBar.castShadow = true;
            bottomBar.receiveShadow = true;
            leafGroup.add(bottomBar);
            
            const midBarGeo = new THREE.BoxGeometry(topBarW, 4, leafThick);
            const midBar = new THREE.Mesh(midBarGeo, whiteMat);
            midBar.position.set(0, leafH / 2, 0);
            midBar.castShadow = true;
            midBar.receiveShadow = true;
            leafGroup.add(midBar);
            
            const glassLowerH = leafH / 2 - 14;
            const glassLowerGeo = new THREE.BoxGeometry(topBarW - 0.5, glassLowerH, 1.5);
            const glassLower = new THREE.Mesh(glassLowerGeo, glassMat);
            glassLower.position.set(0, 12 + glassLowerH / 2, 0);
            leafGroup.add(glassLower);
            
            const glassUpperH = leafH / 2 - 8;
            const glassUpperGeo = new THREE.BoxGeometry(topBarW - 0.5, glassUpperH, 1.5);
            const glassUpper = new THREE.Mesh(glassUpperGeo, glassMat);
            glassUpper.position.set(0, leafH / 2 + 2 + glassUpperH / 2, 0);
            leafGroup.add(glassUpper);
            
            leafGroup.position.set(isLeft ? leafW / 2 : -leafW / 2, 0, 0);
            pivot.add(leafGroup);
            
            // Add Lever Handle to Balcony Door
            const handle = this.buildDoorHandle3D(leafW, leafThick, isLeft);
            const handleX = isLeft ? (leafW - 7) : -(leafW - 7);
            handle.position.set(handleX, 104, 0);
            pivot.add(handle);
            
        } else {
            // Standard Wooden Door with Procedural Texture & Bump
            const leafColor = door.color3d || door.color || 'hsl(33, 40%, 35%)';
            const doorTex = TextureGenerator.createDoorTexture(leafColor);
            const doorBump = TextureGenerator.createDoorBump();
            
            const leafGeo = new THREE.BoxGeometry(leafW, leafH, leafThick);
            const leafMat = new THREE.MeshStandardMaterial({
                color: leafColor,
                map: doorTex,
                bumpMap: doorBump,
                bumpScale: 0.02,
                roughness: 0.45,
                metalness: 0.02
            });
            const leaf = new THREE.Mesh(leafGeo, leafMat);
            leaf.position.set(isLeft ? leafW / 2 : -leafW / 2, leafH / 2, 0);
            leaf.castShadow = true;
            leaf.receiveShadow = true;
            pivot.add(leaf);
            
            // Add 3D Metallic Lever Handle Assembly
            const handle = this.buildDoorHandle3D(leafW, leafThick, isLeft);
            const handleX = isLeft ? (leafW - 7) : -(leafW - 7);
            handle.position.set(handleX, 104, 0);
            pivot.add(handle);
        }
        
        doorGroup.add(pivot);
        
        // Rotate open (45 deg)
        let openAngle = Math.PI / 4;
        if (isLeft) {
            pivot.rotation.y = isIn ? -openAngle : openAngle;
        } else {
            pivot.rotation.y = isIn ? openAngle : -openAngle;
        }
        
        let dx = 0, dz = 0;
        const halfThick = 10 / 2;
        if (spec.name === 'top') dz = -halfThick;
        else if (spec.name === 'bottom') dz = halfThick;
        else if (spec.name === 'left') dx = -halfThick;
        else if (spec.name === 'right') dx = halfThick;

        doorGroup.position.set(coords.x + offset.x + dx, 0, coords.y + offset.z + dz);
        doorGroup.rotation.y = -spec.angle;
        
        this.scene.add(doorGroup);
        this.doorMeshes.push(doorGroup);
    },
    
    createDoubleDoorMesh3D(spec, door) {
        const offset = this.roomOffset;
        const coords = getWallCoordinates(spec.name, door.position);
        
        const doorGroup = new THREE.Group();
        
        const dir = door.direction || 'in';
        const isIn = dir === 'in';
        
        const casingW = 4.5;
        const casingD = 12; // Wall is 10cm, casing protrudes 1cm inside & outside
        const casingColor = door.frameColor || 0x475569;
        const casingMat = new THREE.MeshStandardMaterial({ color: casingColor, roughness: 0.5, metalness: 0.05 });
        
        // 1. Umfassungszarge (3-sided casing)
        const jambGeo = new THREE.BoxGeometry(casingW, door.h, casingD);
        const jambL = new THREE.Mesh(jambGeo, casingMat);
        jambL.position.set(-door.w / 2 + casingW / 2, door.h / 2, 0);
        jambL.castShadow = true;
        jambL.receiveShadow = true;
        doorGroup.add(jambL);
        
        const jambR = new THREE.Mesh(jambGeo, casingMat);
        jambR.position.set(door.w / 2 - casingW / 2, door.h / 2, 0);
        jambR.castShadow = true;
        jambR.receiveShadow = true;
        doorGroup.add(jambR);
        
        const lintelGeo = new THREE.BoxGeometry(door.w + 2, casingW, casingD);
        const lintel = new THREE.Mesh(lintelGeo, casingMat);
        lintel.position.set(0, door.h - casingW / 2, 0);
        lintel.castShadow = true;
        lintel.receiveShadow = true;
        doorGroup.add(lintel);
        
        const innerW = door.w - casingW * 2 + 2;
        const wingW = innerW / 2;
        const leafH = door.h - casingW - 1;
        const leafThick = 4.0;
        
        let pivotL = new THREE.Group();
        pivotL.position.set(-door.w / 2 + casingW - 0.5, 1, 0);
        
        let pivotR = new THREE.Group();
        pivotR.position.set(door.w / 2 - casingW + 0.5, 1, 0);
        
        if (door.isBalcony) {
            // Double Balcony Door (Glass with frame)
            const frameColor = door.color3d || door.color || '#ffffff';
            const whiteMat = new THREE.MeshStandardMaterial({ color: frameColor, roughness: 0.4 });
            const glassMat = new THREE.MeshPhysicalMaterial({
                color: 0xf8fafc,
                transparent: true,
                opacity: 0.3,
                roughness: 0.05,
                metalness: 0.1,
                transmission: 0.92,
                ior: 1.52,
                clearcoat: 1.0,
                clearcoatRoughness: 0.05,
                side: THREE.DoubleSide
            });
            
            const buildBalconyLeaf = (w, h, isLeftWing) => {
                const leafGroup = new THREE.Group();
                
                const leftBarGeo = new THREE.BoxGeometry(5, h, leafThick);
                const leftBar = new THREE.Mesh(leftBarGeo, whiteMat);
                leftBar.position.set(-w / 2 + 2.5, h / 2, 0);
                leftBar.castShadow = true;
                leftBar.receiveShadow = true;
                leafGroup.add(leftBar);
                
                const rightBarGeo = new THREE.BoxGeometry(5, h, leafThick);
                const rightBar = new THREE.Mesh(rightBarGeo, whiteMat);
                rightBar.position.set(w / 2 - 2.5, h / 2, 0);
                rightBar.castShadow = true;
                rightBar.receiveShadow = true;
                leafGroup.add(rightBar);
                
                const topBarW = w - 10;
                const topBarGeo = new THREE.BoxGeometry(topBarW, 5, leafThick);
                const topBar = new THREE.Mesh(topBarGeo, whiteMat);
                topBar.position.set(0, h - 2.5, 0);
                topBar.castShadow = true;
                topBar.receiveShadow = true;
                leafGroup.add(topBar);
                
                const bottomBarGeo = new THREE.BoxGeometry(topBarW, 10, leafThick);
                const bottomBar = new THREE.Mesh(bottomBarGeo, whiteMat);
                bottomBar.position.set(0, 5, 0);
                bottomBar.castShadow = true;
                bottomBar.receiveShadow = true;
                leafGroup.add(bottomBar);
                
                const midBarGeo = new THREE.BoxGeometry(topBarW, 4, leafThick);
                const midBar = new THREE.Mesh(midBarGeo, whiteMat);
                midBar.position.set(0, h / 2, 0);
                midBar.castShadow = true;
                midBar.receiveShadow = true;
                leafGroup.add(midBar);
                
                const glassLowerH = h / 2 - 12;
                const glassLowerGeo = new THREE.BoxGeometry(topBarW - 0.5, glassLowerH, 1.5);
                const glassLower = new THREE.Mesh(glassLowerGeo, glassMat);
                glassLower.position.set(0, 10 + glassLowerH / 2, 0);
                leafGroup.add(glassLower);
                
                const glassUpperH = h / 2 - 7;
                const glassUpperGeo = new THREE.BoxGeometry(topBarW - 0.5, glassUpperH, 1.5);
                const glassUpper = new THREE.Mesh(glassUpperGeo, glassMat);
                glassUpper.position.set(0, h / 2 + 2 + glassUpperH / 2, 0);
                leafGroup.add(glassUpper);
                
                return leafGroup;
            };
            
            const leafLGroup = buildBalconyLeaf(wingW, leafH, true);
            leafLGroup.position.set(wingW / 2, 0, 0);
            pivotL.add(leafLGroup);
            const handleL = this.buildDoorHandle3D(wingW, leafThick, true);
            handleL.position.set(wingW - 6, 104, 0);
            pivotL.add(handleL);
            
            const leafRGroup = buildBalconyLeaf(wingW, leafH, false);
            leafRGroup.position.set(-wingW / 2, 0, 0);
            pivotR.add(leafRGroup);
            const handleR = this.buildDoorHandle3D(wingW, leafThick, false);
            handleR.position.set(-(wingW - 6), 104, 0);
            pivotR.add(handleR);
            
        } else {
            // Standard Wooden Double Door with Procedural Texture & Bump
            const leafColor = door.color3d || door.color || 'hsl(33, 40%, 35%)';
            const doorTex = TextureGenerator.createDoorTexture(leafColor);
            const doorBump = TextureGenerator.createDoorBump();
            
            const leafGeo = new THREE.BoxGeometry(wingW, leafH, leafThick);
            const leafMat = new THREE.MeshStandardMaterial({
                color: leafColor,
                map: doorTex,
                bumpMap: doorBump,
                bumpScale: 0.02,
                roughness: 0.45,
                metalness: 0.02
            });
            
            const leafL = new THREE.Mesh(leafGeo, leafMat);
            leafL.position.set(wingW / 2, leafH / 2, 0);
            leafL.castShadow = true;
            leafL.receiveShadow = true;
            pivotL.add(leafL);
            const handleL = this.buildDoorHandle3D(wingW, leafThick, true);
            handleL.position.set(wingW - 6, 104, 0);
            pivotL.add(handleL);
            
            const leafR = new THREE.Mesh(leafGeo, leafMat);
            leafR.position.set(-wingW / 2, leafH / 2, 0);
            leafR.castShadow = true;
            leafR.receiveShadow = true;
            pivotR.add(leafR);
            const handleR = this.buildDoorHandle3D(wingW, leafThick, false);
            handleR.position.set(-(wingW - 6), 104, 0);
            pivotR.add(handleR);
        }
        
        // Rotate both open by 45 degrees
        let openAngle = Math.PI / 4;
        pivotL.rotation.y = isIn ? -openAngle : openAngle;
        pivotR.rotation.y = isIn ? openAngle : -openAngle;
        
        doorGroup.add(pivotL);
        doorGroup.add(pivotR);
        
        let dx = 0, dz = 0;
        const halfThick = 10 / 2;
        if (spec.name === 'top') dz = -halfThick;
        else if (spec.name === 'bottom') dz = halfThick;
        else if (spec.name === 'left') dx = -halfThick;
        else if (spec.name === 'right') dx = halfThick;

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
        
        // 1. Dual Window Sills (Innen- und Außenfensterbank)
        // Interior Sill: marble/stone projecting 7cm into room (z > 0)
        const intSillGeo = new THREE.BoxGeometry(win.w + 6, 2.5, 13);
        const intSillMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.25, metalness: 0.02 });
        const intSill = new THREE.Mesh(intSillGeo, intSillMat);
        intSill.position.set(0, bot - 1.25, 5.5);
        intSill.castShadow = true;
        intSill.receiveShadow = true;
        winGroup.add(intSill);
        
        // Exterior Sill: anodized aluminum ledge projecting 5cm outside (z < 0)
        const extSillGeo = new THREE.BoxGeometry(win.w + 2, 1.5, 10);
        const extSillMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.45, metalness: 0.7 });
        const extSill = new THREE.Mesh(extSillGeo, extSillMat);
        extSill.position.set(0, bot - 2.0, -5.0);
        extSill.castShadow = true;
        winGroup.add(extSill);
        
        // 2. Window Frame (Blendrahmen)
        const frameMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.35, metalness: 0.05 });
        const frameW = 4.5;
        const frameD = 8.0;
        
        // Top and Bottom frame rails
        const hFrameGeo = new THREE.BoxGeometry(win.w - frameW * 2, frameW, frameD);
        const frameTop = new THREE.Mesh(hFrameGeo, frameMat);
        frameTop.position.set(0, bot + win.h - frameW / 2, 0);
        const frameBot = new THREE.Mesh(hFrameGeo, frameMat);
        frameBot.position.set(0, bot + frameW / 2, 0);
        
        // Side jambs
        const vFrameGeo = new THREE.BoxGeometry(frameW, win.h, frameD);
        const frameLeft = new THREE.Mesh(vFrameGeo, frameMat);
        frameLeft.position.set(-win.w / 2 + frameW / 2, midH, 0);
        const frameRight = new THREE.Mesh(vFrameGeo, frameMat);
        frameRight.position.set(win.w / 2 - frameW / 2, midH, 0);
        
        frameTop.castShadow = true; frameBot.castShadow = true;
        frameLeft.castShadow = true; frameRight.castShadow = true;
        winGroup.add(frameTop); winGroup.add(frameBot);
        winGroup.add(frameLeft); winGroup.add(frameRight);
        
        // 3. Physically-Based Optical Glass
        const glassMat = new THREE.MeshPhysicalMaterial({
            color: 0xf8fafc,
            transparent: true,
            opacity: 0.35,
            roughness: 0.05,
            metalness: 0.1,
            transmission: 0.92,
            ior: 1.52,
            reflectivity: 0.5,
            clearcoat: 1.0,
            clearcoatRoughness: 0.05,
            side: THREE.DoubleSide
        });
        
        const isDoubleWing = win.w >= 100;
        if (isDoubleWing) {
            // Central mullion (Pfosten)
            const mullionGeo = new THREE.BoxGeometry(4.0, win.h - frameW * 2, frameD - 0.5);
            const mullion = new THREE.Mesh(mullionGeo, frameMat);
            mullion.position.set(0, midH, 0);
            mullion.castShadow = true;
            winGroup.add(mullion);
            
            // Left & Right Glass Panes
            const wingW = (win.w - frameW * 2 - 4.0) / 2;
            const glassGeo = new THREE.BoxGeometry(wingW - 1.0, win.h - frameW * 2 - 1.0, 1.5);
            
            const glassL = new THREE.Mesh(glassGeo, glassMat);
            glassL.position.set(-wingW / 2 - 2.0, midH, 0);
            const glassR = new THREE.Mesh(glassGeo, glassMat);
            glassR.position.set(wingW / 2 + 2.0, midH, 0);
            
            winGroup.add(glassL);
            winGroup.add(glassR);
        } else {
            // Single Glass Pane
            const glassGeo = new THREE.BoxGeometry(win.w - frameW * 2 - 1.0, win.h - frameW * 2 - 1.0, 1.5);
            const glass = new THREE.Mesh(glassGeo, glassMat);
            glass.position.set(0, midH, 0);
            winGroup.add(glass);
        }
        
        // 4. Metallic Window Handle (Fensterolive)
        const handleGroup = new THREE.Group();
        const metalMat = new THREE.MeshStandardMaterial({
            color: 0xd4d4d8,
            metalness: 0.88,
            roughness: 0.22
        });
        
        const rosetteGeo = new THREE.BoxGeometry(2.4, 6.0, 0.4);
        const rosette = new THREE.Mesh(rosetteGeo, metalMat);
        rosette.position.set(0, 0, 4.2);
        handleGroup.add(rosette);
        
        const neckGeo = new THREE.CylinderGeometry(0.6, 0.6, 2.5, 8);
        const neck = new THREE.Mesh(neckGeo, metalMat);
        neck.rotation.x = Math.PI / 2;
        neck.position.set(0, 0.8, 5.5);
        handleGroup.add(neck);
        
        const gripGeo = new THREE.BoxGeometry(1.4, 10.0, 1.0);
        const grip = new THREE.Mesh(gripGeo, metalMat);
        grip.position.set(0, -4.0, 6.8); // Points downward (closed window position)
        grip.castShadow = true;
        handleGroup.add(grip);
        
        const handleX = isDoubleWing ? -3.5 : (win.w / 2 - 3.5);
        const handleY = bot + win.h * 0.45;
        handleGroup.position.set(handleX, handleY, 0);
        winGroup.add(handleGroup);
        
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
        
        // Get slope angle
        const room = State.room;
        const pitch = room.pitches[spec.name];
        let cosAlpha = 1.0;
        let slopeAngleRad = 0;
        if (pitch && pitch.enabled) {
            slopeAngleRad = Math.atan((room.height - pitch.kniestock) / pitch.run);
            cosAlpha = Math.cos(slopeAngleRad);
        }
        
        const sCenter = (elem.distanceFromWall || 0) + elem.h / 2;
        const dCenterHoriz = sCenter * cosAlpha;
        
        // Offset coordinate inwards normal to wall
        let sx = coords.x;
        let sz = coords.y;
        
        if (spec.name === 'top') sz += dCenterHoriz;
        else if (spec.name === 'right') sx -= dCenterHoriz;
        else if (spec.name === 'bottom') sz -= dCenterHoriz;
        else if (spec.name === 'left') sx += dCenterHoriz;
        
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
        if (pitch && pitch.enabled) {
            group.rotation.x = -slopeAngleRad; // tilt forward/backward
        }
        
        this.scene.add(group);
        this.skylightMeshes.push(group);
    },
    
    buildCeilingRoof3D() {
        // Render main slanted ceiling surfaces as a unified parametric grid mesh
        const room = State.room;
        const offset = this.roomOffset;
        
        // Remove old ceiling meshes if they exist
        if (this.ceilingMesh) {
            this.scene.remove(this.ceilingMesh);
            this.ceilingMesh = null;
        }
        if (this.flatCeilingMesh) {
            this.scene.remove(this.flatCeilingMesh);
            this.flatCeilingMesh = null;
        }
        
        if (!wallsAnyPitch()) {
            return;
        }
        
        // Create an alpha map to render active main pitch areas [innerStart, innerEnd] solid and cut out skylights
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        
        // Fill black by default (transparent for flat ceiling and cheek regions)
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, 512, 512);
        
        // Fill white for main rectangular roof pitch areas [innerStart, innerEnd]
        ctx.fillStyle = '#ffffff';
        const interTop = getPitchInterval(room.pitches.top, 'top');
        if (interTop && interTop.innerEnd > interTop.innerStart) {
            const x = (interTop.innerStart / room.width) * 512;
            const w = ((interTop.innerEnd - interTop.innerStart) / room.width) * 512;
            const h = (room.pitches.top.run / room.depth) * 512;
            ctx.fillRect(x, 0, w, h);
        }
        const interBottom = getPitchInterval(room.pitches.bottom, 'bottom');
        if (interBottom && interBottom.innerEnd > interBottom.innerStart) {
            const x = ((room.width - interBottom.innerEnd) / room.width) * 512;
            const w = ((interBottom.innerEnd - interBottom.innerStart) / room.width) * 512;
            const y = ((room.depth - room.pitches.bottom.run) / room.depth) * 512;
            const h = (room.pitches.bottom.run / room.depth) * 512;
            ctx.fillRect(x, y, w, h);
        }
        const interLeft = getPitchInterval(room.pitches.left, 'left');
        if (interLeft && interLeft.innerEnd > interLeft.innerStart) {
            const y = ((room.depth - interLeft.innerEnd) / room.depth) * 512;
            const h = ((interLeft.innerEnd - interLeft.innerStart) / room.depth) * 512;
            const w = (room.pitches.left.run / room.width) * 512;
            ctx.fillRect(0, y, w, h);
        }
        const interRight = getPitchInterval(room.pitches.right, 'right');
        if (interRight && interRight.innerEnd > interRight.innerStart) {
            const y = (interRight.innerStart / room.depth) * 512;
            const h = ((interRight.innerEnd - interRight.innerStart) / room.depth) * 512;
            const x = ((room.width - room.pitches.right.run) / room.width) * 512;
            const w = (room.pitches.right.run / room.width) * 512;
            ctx.fillRect(x, y, w, h);
        }
        
        // Fill black for skylight footprints
        ctx.fillStyle = '#000000';
        
        const skylights = State.elements.filter(el => el.type === 'skylight');
        skylights.forEach(elem => {
            const spec = {
                top: { name: 'top', startX: 0, startZ: 0, angle: 0, length: room.width },
                right: { name: 'right', startX: room.width, startZ: 0, angle: Math.PI / 2, length: room.depth },
                bottom: { name: 'bottom', startX: room.width, startZ: room.depth, angle: Math.PI, length: room.width },
                left: { name: 'left', startX: 0, startZ: room.depth, angle: -Math.PI / 2, length: room.depth }
            }[elem.wall];
            
            if (!spec) return;
            
            const coords = getWallCoordinates(spec.name, elem.position);
            const pitch = room.pitches[spec.name];
            const run = (pitch && pitch.enabled) ? pitch.run : 100;
            const kniestock = (pitch && pitch.enabled) ? pitch.kniestock : 100;
            const wallH = room.height;
            
            const slopeLen = Math.sqrt(run * run + (wallH - kniestock) * (wallH - kniestock));
            const cosAlpha = run / slopeLen;
            
            const distFromWall = elem.distanceFromWall !== undefined ? elem.distanceFromWall : 60;
            const sCenter = distFromWall + elem.h / 2;
            const dCenterHoriz = sCenter * cosAlpha;
            
            let sx = coords.x;
            let sz = coords.y;
            
            if (spec.name === 'top') sz += dCenterHoriz;
            else if (spec.name === 'right') sx -= dCenterHoriz;
            else if (spec.name === 'bottom') sz -= dCenterHoriz;
            else if (spec.name === 'left') sx += dCenterHoriz;
            
            let wX = elem.w;
            let dZ = elem.h * cosAlpha;
            
            if (spec.name === 'left' || spec.name === 'right') {
                wX = elem.h * cosAlpha;
                dZ = elem.w;
            }
            
            const xMin = sx - wX / 2;
            const zMin = sz - dZ / 2;
            
            const cx = (xMin / room.width) * 512;
            const cz = (zMin / room.depth) * 512;
            const cw = (wX / room.width) * 512;
            const ch = (dZ / room.depth) * 512;
            
            ctx.fillRect(cx, cz, cw, ch);
        });
        
        const alphaMap = new THREE.CanvasTexture(canvas);
        
        const isTextureMode = State.settings.viewStyle3D === 'texture';
        const pitchColor = (State.room.wallColors && State.room.wallColors.pitch) || (State.room.wallColors && State.room.wallColors.top) || (isTextureMode ? '#f0eee9' : 0x334155);
        const ceilingColor = (State.room.wallColors && State.room.wallColors.ceiling) || (isTextureMode ? '#f5f4f0' : 0x334155);
        
        const plasterBump = TextureCache.getWallPlasterBump();
        let pitchBump = null;
        if (isTextureMode && plasterBump) {
            pitchBump = plasterBump.clone();
            if (pitchBump.repeat) {
                pitchBump.repeat.set(
                    Math.max(1, Math.round(room.width / 50)),
                    Math.max(1, Math.round(room.depth / 50))
                );
            }
            pitchBump.needsUpdate = true;
        }

        // Roof pitch material
        const wallMat = new THREE.MeshStandardMaterial({
            color: isTextureMode ? pitchColor : 0x334155,
            transparent: false,
            opacity: 1.0,
            roughness: 0.88,
            metalness: 0.0,
            bumpMap: pitchBump,
            bumpScale: pitchBump ? 0.003 : 0,
            side: THREE.DoubleSide,
            alphaMap: alphaMap,
            alphaTest: 0.5,
            depthWrite: true
        });
        
        // Detailed grid geometry to represent the ceiling slopes accurately
        const segmentsX = Math.max(60, Math.round(room.width / 5));
        const segmentsZ = Math.max(60, Math.round(room.depth / 5));
        const ceilGeo = new THREE.PlaneGeometry(room.width, room.depth, segmentsX, segmentsZ);
        
        // Rotate the plane to be horizontal (default PlaneGeometry is vertical in X-Y)
        ceilGeo.rotateX(-Math.PI / 2);
        
        // Displace the Y coordinate of each vertex using the main slope planes so edges at innerStart/innerEnd are crisp and unwarped
        const getMainSlopeHeightAt = (x, y) => {
            let minH = room.height;
            const margin = 15;
            if (interTop && x >= interTop.innerStart - margin && x <= interTop.innerEnd + margin && y < room.pitches.top.run) {
                const h = room.pitches.top.kniestock + y * ((room.height - room.pitches.top.kniestock) / room.pitches.top.run);
                minH = Math.min(minH, h);
            }
            if (interBottom && (room.width - x) >= interBottom.innerStart - margin && (room.width - x) <= interBottom.innerEnd + margin && (room.depth - y) < room.pitches.bottom.run) {
                const dist = room.depth - y;
                const h = room.pitches.bottom.kniestock + dist * ((room.height - room.pitches.bottom.kniestock) / room.pitches.bottom.run);
                minH = Math.min(minH, h);
            }
            if (interLeft && (room.depth - y) >= interLeft.innerStart - margin && (room.depth - y) <= interLeft.innerEnd + margin && x < room.pitches.left.run) {
                const h = room.pitches.left.kniestock + x * ((room.height - room.pitches.left.kniestock) / room.pitches.left.run);
                minH = Math.min(minH, h);
            }
            if (interRight && y >= interRight.innerStart - margin && y <= interRight.innerEnd + margin && (room.width - x) < room.pitches.right.run) {
                const dist = room.width - x;
                const h = room.pitches.right.kniestock + dist * ((room.height - room.pitches.right.kniestock) / room.pitches.right.run);
                minH = Math.min(minH, h);
            }
            return Math.max(0, minH);
        };

        const posAttr = ceilGeo.attributes.position;
        for (let i = 0; i < posAttr.count; i++) {
            const localX = posAttr.getX(i);
            const localZ = posAttr.getZ(i);
            const roomX = localX + room.width / 2;
            const roomY = localZ + room.depth / 2;
            posAttr.setY(i, getMainSlopeHeightAt(roomX, roomY));
        }
        
        // Recalculate normals so lighting works correctly on the slanted parts
        ceilGeo.computeVertexNormals();
        
        this.ceilingMesh = new THREE.Mesh(ceilGeo, wallMat);
        this.ceilingMesh.userData = { surfaceTarget: 'pitch' };
        this.ceilingMesh.position.set(0, 0, 0); // centered
        this.ceilingMesh.castShadow = true;
        this.ceilingMesh.receiveShadow = true;
        
        this.scene.add(this.ceilingMesh);
        
        // Im Texturmodus: Eine Deckenfläche NUR über dem flachen Deckenbereich einfügen (niemals über die Schräge überstehend)
        if (isTextureMode) {
            const pLeft = (room.pitches.left && room.pitches.left.enabled) ? room.pitches.left.run : 0;
            const pRight = (room.pitches.right && room.pitches.right.enabled) ? room.pitches.right.run : 0;
            const pTop = (room.pitches.top && room.pitches.top.enabled) ? room.pitches.top.run : 0;
            const pBottom = (room.pitches.bottom && room.pitches.bottom.enabled) ? room.pitches.bottom.run : 0;
            
            const xMin = pLeft;
            const xMax = room.width - pRight;
            const zMin = pTop;
            const zMax = room.depth - pBottom;
            
            const flatW = xMax - xMin;
            const flatD = zMax - zMin;
            
            if (flatW > 0.5 && flatD > 0.5) {
                const flatCeilingGeo = new THREE.PlaneGeometry(flatW, flatD);
                let flatCeilBump = null;
                if (plasterBump) {
                    flatCeilBump = plasterBump.clone();
                    if (flatCeilBump.repeat) {
                        flatCeilBump.repeat.set(
                            Math.max(1, Math.round(flatW / 50)),
                            Math.max(1, Math.round(flatD / 50))
                        );
                    }
                    flatCeilBump.needsUpdate = true;
                }
                const flatCeilingMat = new THREE.MeshStandardMaterial({
                    color: ceilingColor,
                    roughness: 0.92,
                    metalness: 0.0,
                    bumpMap: flatCeilBump,
                    bumpScale: flatCeilBump ? 0.003 : 0,
                    side: THREE.DoubleSide
                });
                this.flatCeilingMesh = new THREE.Mesh(flatCeilingGeo, flatCeilingMat);
                this.flatCeilingMesh.rotation.x = Math.PI / 2;
                const centerX = (xMin + xMax) / 2 + offset.x;
                const centerZ = (zMin + zMax) / 2 + offset.z;
                this.flatCeilingMesh.position.set(centerX, room.height, centerZ);
                this.flatCeilingMesh.userData = { surfaceTarget: 'ceiling' };
                this.scene.add(this.flatCeilingMesh);
            }
        }
    },
    
    buildPitchCheekMeshes3D() {
        if (!this.pitchCheekMeshes) this.pitchCheekMeshes = [];
        this.pitchCheekMeshes.forEach(mesh => this.scene.remove(mesh));
        this.pitchCheekMeshes = [];

        const room = State.room;
        const offset = this.roomOffset;

        const isTextureMode = State.settings.viewStyle3D === 'texture';
        const cheekColor = (State.room.wallColors && State.room.wallColors.pitch) || (State.room.wallColors && State.room.wallColors.top) || (isTextureMode ? '#f0eee9' : 0x334155);

        const plasterBump = TextureCache.getWallPlasterBump();
        let cheekBump = null;
        if (isTextureMode && plasterBump) {
            cheekBump = plasterBump.clone();
            if (cheekBump.repeat) cheekBump.repeat.set(4, 4);
            cheekBump.needsUpdate = true;
        }

        const cheekMat = new THREE.MeshStandardMaterial({
            color: isTextureMode ? cheekColor : 0x334155,
            roughness: 0.88,
            metalness: 0.0,
            bumpMap: cheekBump,
            bumpScale: cheekBump ? 0.003 : 0,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1
        });

        const wallUDTo3D = (wallName, u, d, height) => {
            const pt2d = wallUDToRoomXY(wallName, u, d);
            return {
                x: pt2d.x + offset.x,
                y: height,
                z: pt2d.y + offset.z
            };
        };

        const addTriangle = (p1, p2, p3) => {
            const geom = new THREE.BufferGeometry();
            const vertices = new Float32Array([
                p1.x, p1.y, p1.z,
                p2.x, p2.y, p2.z,
                p3.x, p3.y, p3.z
            ]);
            geom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
            geom.computeVertexNormals();
            const mesh = new THREE.Mesh(geom, cheekMat);
            mesh.userData = { surfaceTarget: 'pitch' };
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.scene.add(mesh);
            this.pitchCheekMeshes.push(mesh);
        };

        const walls = ['top', 'right', 'bottom', 'left'];
        walls.forEach(w => {
            const pitch = room.pitches[w];
            const inter = getPitchInterval(pitch, w);
            if (!inter) return;

            const wallLen = (w === 'top' || w === 'bottom') ? room.width : room.depth;
            const knie = pitch.kniestock;
            const run = pitch.run;
            const H = room.height;

            // Start transition:
            // - If innerStart > outerStart: Slanted Querschräge triangle (A-B-C) + Main-slope triangle (A-C-D) meeting along diagonal crease A->C
            // - If innerStart === outerStart (> 0): Vertical triangular cheek wall at u = outerStart
            if (inter.innerStart > inter.outerStart) {
                const uInner = Math.min(inter.innerEnd, inter.innerStart + 1.5);
                const A = wallUDTo3D(w, inter.innerStart, 0, knie);
                const B = wallUDTo3D(w, inter.outerStart, 0, H);
                const C = wallUDTo3D(w, inter.outerStart, run, H);
                const D = wallUDTo3D(w, uInner, run, H);
                addTriangle(A, B, C);
                addTriangle(A, C, D);
                if (uInner > inter.innerStart) {
                    const A2 = wallUDTo3D(w, uInner, 0, knie);
                    addTriangle(A, D, A2);
                }
            } else if (inter.outerStart > 0) {
                const A = wallUDTo3D(w, inter.outerStart, 0, knie);
                const B = wallUDTo3D(w, inter.outerStart, 0, H);
                const C = wallUDTo3D(w, inter.outerStart, run, H);
                addTriangle(A, B, C);
            }

            // End transition:
            // - If outerEnd > innerEnd: Slanted Querschräge triangle (A-B-C) + Main-slope triangle (A-C-D) meeting along diagonal crease A->C
            // - If innerEnd === outerEnd (< wallLen): Vertical triangular cheek wall at u = outerEnd
            if (inter.outerEnd > inter.innerEnd) {
                const uInner = Math.max(inter.innerStart, inter.innerEnd - 1.5);
                const A = wallUDTo3D(w, inter.innerEnd, 0, knie);
                const B = wallUDTo3D(w, inter.outerEnd, 0, H);
                const C = wallUDTo3D(w, inter.outerEnd, run, H);
                const D = wallUDTo3D(w, uInner, run, H);
                addTriangle(A, B, C);
                addTriangle(A, C, D);
                if (uInner < inter.innerEnd) {
                    const A2 = wallUDTo3D(w, uInner, 0, knie);
                    addTriangle(A, D, A2);
                }
            } else if (inter.outerEnd < wallLen) {
                const A = wallUDTo3D(w, inter.outerEnd, 0, knie);
                const B = wallUDTo3D(w, inter.outerEnd, 0, H);
                const C = wallUDTo3D(w, inter.outerEnd, run, H);
                addTriangle(A, B, C);
            }
        });
    },

    createCeilingLuminaire(lampPos, ceilingHeight, isLit, intensityFactor) {
        const group = new THREE.Group();
        group.name = 'ceilingLamp';

        // Keep ceiling lamp at least 185 cm above floor
        const minFloorClearance = 185;
        const maxDrop = Math.max(15, ceilingHeight - minFloorClearance);
        const drop = Math.min(45, maxDrop);
        const cableLength = Math.max(5, drop - 16);

        // 1. Baldachin (Ceiling Canopy)
        const canopyGeo = new THREE.CylinderGeometry(6, 6, 3, 16);
        const canopyMat = new THREE.MeshStandardMaterial({
            color: 0x22262e,
            roughness: 0.4,
            metalness: 0.6
        });
        const canopy = new THREE.Mesh(canopyGeo, canopyMat);
        canopy.position.y = -1.5;
        group.add(canopy);

        // 2. Cable / Rod
        const cableGeo = new THREE.CylinderGeometry(0.7, 0.7, cableLength, 8);
        const cableMat = new THREE.MeshStandardMaterial({
            color: 0x111317,
            roughness: 0.5,
            metalness: 0.2
        });
        const cable = new THREE.Mesh(cableGeo, cableMat);
        cable.position.y = -3 - cableLength / 2;
        group.add(cable);

        // 3. Shade Top Collar
        const collarGeo = new THREE.CylinderGeometry(4, 5, 2, 16);
        const shadeMat = new THREE.MeshStandardMaterial({
            color: 0x2d3748,
            roughness: 0.35,
            metalness: 0.5
        });
        const collar = new THREE.Mesh(collarGeo, shadeMat);
        collar.position.y = -3 - cableLength - 1;
        group.add(collar);

        // 4. Conical Shade (open bottom)
        const shadeGeo = new THREE.CylinderGeometry(5, 18, 12, 24, 1, true);
        const shadeMesh = new THREE.Mesh(shadeGeo, shadeMat);
        shadeMesh.position.y = -3 - cableLength - 2 - 6;
        group.add(shadeMesh);

        // 5. Diffuser Bulb (emissive glow)
        const bulbGeo = (typeof THREE.SphereGeometry !== 'undefined')
            ? new THREE.SphereGeometry(6, 16, 12)
            : new THREE.CylinderGeometry(6, 6, 6, 12);
        const bulbMat = new THREE.MeshStandardMaterial({
            color: 0xffeedd,
            emissive: 0xfff4e0,
            emissiveIntensity: isLit ? (0.85 * intensityFactor) : 0.0,
            roughness: 0.2,
            metalness: 0.0
        });
        const bulbMesh = new THREE.Mesh(bulbGeo, bulbMat);
        bulbMesh.position.y = -3 - cableLength - 8;
        group.add(bulbMesh);

        // 6. THREE.PointLight
        const lightColor = State.settings.ceilingLampColor ? parseInt(State.settings.ceilingLampColor.replace('#', '0x'), 16) : 0xffeedd;
        const baseIntensity = 25000;
        const pointLight = new THREE.PointLight(
            lightColor,
            isLit ? (baseIntensity * intensityFactor) : 0,
            800,
            2
        );
        pointLight.position.y = -3 - cableLength - 8;
        pointLight.castShadow = true;
        if (pointLight.shadow) {
            if (pointLight.shadow.mapSize) {
                pointLight.shadow.mapSize.width = 1024;
                pointLight.shadow.mapSize.height = 1024;
            }
            if (pointLight.shadow.camera) {
                pointLight.shadow.camera.near = 10;
                pointLight.shadow.camera.far = 1500;
            }
            pointLight.shadow.bias = -0.001;
        }
        group.add(pointLight);

        group.userData = {
            bulbMesh,
            pointLight,
            bulbMat
        };

        const worldX = lampPos.x + this.roomOffset.x;
        const worldZ = lampPos.y + this.roomOffset.z;
        group.position.set(worldX, ceilingHeight, worldZ);

        return group;
    },

    rebuildCeilingLamps() {
        if (!this.scene) return;

        if (this.ceilingLampMeshes) {
            this.ceilingLampMeshes.forEach(mesh => {
                if (mesh.userData && mesh.userData.pointLight && mesh.userData.pointLight.shadow && mesh.userData.pointLight.shadow.map) {
                    mesh.userData.pointLight.shadow.map.dispose();
                }
                this.scene.remove(mesh);
            });
        }
        this.ceilingLampMeshes = [];
        this.ceilingLampLights = [];

        const lampPositions = getCeilingLampPositions(State.room);
        const isLit = State.settings.ceilingLampsEnabled !== false;
        const intensityFactor = State.settings.ceilingLampIntensity !== undefined ? State.settings.ceilingLampIntensity : 1.0;
        const lampCount = lampPositions.length;
        const perLampScale = 1.0 / Math.sqrt(lampCount);

        lampPositions.forEach((pos, idx) => {
            const ceilH = getCeilingHeightAt(pos.x, pos.y);
            const lampGroup = this.createCeilingLuminaire(pos, ceilH, isLit, intensityFactor * perLampScale);
            if (lampGroup.userData && lampGroup.userData.pointLight) {
                lampGroup.userData.pointLight.castShadow = (idx < 2) && isLit;
                this.ceilingLampLights.push(lampGroup.userData.pointLight);
            }
            this.scene.add(lampGroup);
            this.ceilingLampMeshes.push(lampGroup);
        });
    },

    updateCeilingLampsLight() {
        if (!this.ceilingLampMeshes) return;
        const isLit = State.settings.ceilingLampsEnabled !== false;
        const intensityFactor = State.settings.ceilingLampIntensity !== undefined ? State.settings.ceilingLampIntensity : 1.0;
        const lampCount = this.ceilingLampMeshes.length || 1;
        const perLampScale = 1.0 / Math.sqrt(lampCount);
        const baseIntensity = 25000;
        const lightColor = State.settings.ceilingLampColor ? parseInt(State.settings.ceilingLampColor.replace('#', '0x'), 16) : 0xffeedd;

        this.ceilingLampMeshes.forEach((mesh, idx) => {
            if (mesh.userData) {
                if (mesh.userData.bulbMat) {
                    mesh.userData.bulbMat.emissiveIntensity = isLit ? (0.85 * intensityFactor) : 0.0;
                }
                if (mesh.userData.pointLight) {
                    mesh.userData.pointLight.visible = isLit;
                    mesh.userData.pointLight.intensity = isLit ? (baseIntensity * intensityFactor * perLampScale) : 0.0;
                    if (mesh.userData.pointLight.color && mesh.userData.pointLight.color.setHex) {
                        mesh.userData.pointLight.color.setHex(lightColor);
                    }
                    mesh.userData.pointLight.castShadow = (idx < 2) && isLit;
                }
            }
        });

        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
    },
    
    buildDetailedFurniture(f, group, isColliding) {
        group.userData = group.userData || {};
        group.userData.furniture = f;
        group.userData.furnitureId = f.id;

        const isObstacle = f.isObstacle || false;
        const heightVal = isObstacle ? getCeilingHeightAt(f.x, f.y) : f.h;
        const pKey = f.presetKey || f.preset || '';
        
        // Default materials
        const woodColor = f.color3d || f.color || 'hsl(33, 40%, 35%)';
        const fabricColor = f.color3d || f.color || 'hsl(215, 60%, 45%)';
        
        const woodTex = TextureCache.get('wood', woodColor);
        const fabricTex = TextureCache.get('fabric', fabricColor);
        const brickTex = TextureCache.get('brick');
        
        const woodMat = new THREE.MeshStandardMaterial({
            map: woodTex,
            roughness: 0.7,
            metalness: 0.1
        });
        
        const fabricMat = new THREE.MeshStandardMaterial({
            map: fabricTex,
            roughness: 0.9,
            metalness: 0.0
        });
        
        const metalMat = new THREE.MeshStandardMaterial({
            color: 0xcccccc,
            roughness: 0.2,
            metalness: 0.8
        });
        
        const brickMat = new THREE.MeshStandardMaterial({
            map: brickTex,
            roughness: 0.8,
            metalness: 0.1
        });
        
        const whiteMat = new THREE.MeshStandardMaterial({
            color: 0xf8fafc,
            roughness: 0.9,
            metalness: 0.0
        });
        
        const screenMat = new THREE.MeshStandardMaterial({
            color: 0x1e293b,
            roughness: 0.1,
            metalness: 0.9
        });
        
        const primaryMat = woodMat;
        
        const getMat = (defaultMat) => {
            if (isColliding) {
                return new THREE.MeshStandardMaterial({
                    color: 0xef4444,
                    roughness: 0.4,
                    metalness: 0.2,
                    transparent: true,
                    opacity: 0.8
                });
            }
            return defaultMat;
        };
        
        const isRug = f.isRug || (f.name && f.name.toLowerCase().includes('teppich'));
        if (isRug) f.isRug = true;
        
        let rugMat;
        if (f.isRug) {
            const rugColor = f.color3d || f.color || 'hsl(215, 25%, 60%)';
            const rugTexKey = (f.rugTexture === 'shaggy' || f.rugTexture === 'hochflor') ? 'hochflor' : 'flach';
            const carpetInfo = TextureCache.getCarpetTexture(rugTexKey, rugColor);
            const carpetDef = carpetInfo.def;
            const rugTex = carpetInfo.map;
            const rugNormal = carpetInfo.normalMap;
            
            // Skalierung anwenden
            const userScale = Math.max(0.3, Math.min(3.0, f.textureScale || 1.0));
            const tileSize = (carpetDef.defaultScale || 35) * userScale;
            
            const repX = Math.max(0.5, f.w / tileSize);
            const repY = Math.max(0.5, (f.shape === 'circle' ? f.w : f.l) / tileSize);
            
            rugTex.repeat.set(repX, repY);
            if (rugNormal) rugNormal.repeat.set(repX, repY);
            
            const hexColor = parseColorToHex(rugColor);
            
            rugMat = new THREE.MeshStandardMaterial({
                map: rugTex,
                normalMap: rugNormal || null,
                normalScale: rugNormal ? new THREE.Vector2(1.0, 1.0) : null,
                color: new THREE.Color(hexColor),
                roughness: carpetDef.roughness !== undefined ? carpetDef.roughness : 0.96,
                metalness: 0.02
            });
        }
        
        const nameLower = f.name.toLowerCase();
        
        if (f.isRug) {
            // Teppich (Rug)
            const thickness = f.h || 2;
            let geo;
            if (f.shape === 'circle') {
                geo = new THREE.CylinderGeometry(f.w / 2, f.w / 2, thickness, 32);
            } else {
                geo = new THREE.BoxGeometry(f.w, thickness, f.l);
            }
            const mesh = new THREE.Mesh(geo, getMat(rugMat));
            mesh.position.y = thickness / 2;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            group.add(mesh);
            
        } else if (isObstacle) {
            // Chimney / obstacle
            const rad = (f.rotation * Math.PI) / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            const corners = [
                { lx: -f.w/2, ly: -f.l/2 }, // NW
                { lx: f.w/2, ly: -f.l/2 },  // NE
                { lx: f.w/2, ly: f.l/2 },   // SE
                { lx: -f.w/2, ly: f.l/2 }    // SW
            ];
            const heights = corners.map(c => {
                const gx = f.x + c.lx * cos - c.ly * sin;
                const gy = f.y + c.lx * sin + c.ly * cos;
                return getCeilingHeightAt(gx, gy);
            });
            
            const boxGeo = createSlantedBoxGeometry(f.w, f.l, heights[0], heights[1], heights[2], heights[3]);
            const mesh = new THREE.Mesh(boxGeo, getMat(brickMat));
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            group.add(mesh);
            
        } else if (nameLower.includes('bogenleuchte') || nameLower.includes('arc') || f.isLamp || pKey === 'arc-lamp') {
            // =========================================================================
            // 5. ARC FLOOR LAMP (Bogenleuchte)
            // =========================================================================
            const baseR = Math.min(f.w * 0.42, 19);
            const baseH = 5;
            const baseY = -f.l / 2 + baseR + 2;
            const shadeR = Math.min(f.w * 0.4, 18);
            const shadeY = f.l / 2 - shadeR - 2;

            // 1. Heavy Marble Base
            const baseGeo = new THREE.CylinderGeometry(baseR, baseR + 0.5, baseH, 32);
            const marbleMat = new THREE.MeshStandardMaterial({
                color: 0xf1f5f9,
                roughness: 0.25,
                metalness: 0.1
            });
            const baseMesh = new THREE.Mesh(baseGeo, getMat(marbleMat));
            baseMesh.position.set(0, baseH / 2, baseY);
            baseMesh.castShadow = true;
            baseMesh.receiveShadow = true;
            group.add(baseMesh);

            // Collar / Stem Socket
            const collarGeo = new THREE.CylinderGeometry(2.5, 3.0, 6, 16);
            const collarMesh = new THREE.Mesh(collarGeo, getMat(metalMat));
            collarMesh.position.set(0, baseH + 3, baseY);
            collarMesh.castShadow = true;
            group.add(collarMesh);

            // 2. Sweeping Metal Arc Neck (Tubular spline or segmented curve)
            const chromeMat = new THREE.MeshStandardMaterial({
                color: 0xe2e8f0,
                metalness: 0.9,
                roughness: 0.15
            });

            const arcPoints = [
                new THREE.Vector3(0, baseH + 5, baseY),
                new THREE.Vector3(0, f.h * 0.65, baseY),
                new THREE.Vector3(0, f.h, baseY + (shadeY - baseY) * 0.35),
                new THREE.Vector3(0, f.h * 0.96, shadeY - 10),
                new THREE.Vector3(0, f.h * 0.82, shadeY)
            ];

            if (typeof THREE.CatmullRomCurve3 === 'function' && typeof THREE.TubeGeometry === 'function') {
                const arcCurve = new THREE.CatmullRomCurve3(arcPoints);
                const tubeGeo = new THREE.TubeGeometry(arcCurve, 40, 1.2, 12, false);
                const arcMesh = new THREE.Mesh(tubeGeo, getMat(chromeMat));
                arcMesh.castShadow = true;
                group.add(arcMesh);
            } else {
                const neckGeo = new THREE.CylinderGeometry(1.2, 1.2, f.h * 0.8, 12);
                const neckMesh = new THREE.Mesh(neckGeo, getMat(chromeMat));
                neckMesh.position.set(0, f.h * 0.4, baseY);
                neckMesh.castShadow = true;
                group.add(neckMesh);
            }

            // 3. Shade Socket
            const mountGeo = new THREE.CylinderGeometry(2.5, 3.5, 4, 16);
            const mountMesh = new THREE.Mesh(mountGeo, getMat(metalMat));
            mountMesh.position.set(0, f.h * 0.82 + 2, shadeY);
            mountMesh.castShadow = true;
            group.add(mountMesh);

            // 4. Hemispherical Dome Shade (open downward towards floor)
            const domeGeo = typeof THREE.SphereGeometry === 'function'
                ? new THREE.SphereGeometry(shadeR, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2)
                : new THREE.CylinderGeometry(shadeR, shadeR * 0.6, shadeR, 24);
            const domeMat = new THREE.MeshStandardMaterial({
                color: 0x334155,
                metalness: 0.85,
                roughness: 0.2,
                side: THREE.DoubleSide || 2
            });
            const domeMesh = new THREE.Mesh(domeGeo, getMat(domeMat));
            domeMesh.rotation.x = Math.PI;
            domeMesh.position.set(0, f.h * 0.82, shadeY);
            domeMesh.castShadow = true;
            group.add(domeMesh);

            // 5. Internal Warm Bulb
            const isLit = State.settings.ceilingLampsEnabled !== false;
            const bulbGeo = typeof THREE.SphereGeometry === 'function'
                ? new THREE.SphereGeometry(3.5, 16, 16)
                : new THREE.CylinderGeometry(3.5, 3.5, 3.5, 8);
            const bulbMat = new THREE.MeshStandardMaterial({
                color: 0xfff8ee,
                emissive: 0xffaa44,
                emissiveIntensity: isLit ? 0.9 : 0.0,
                roughness: 0.2
            });
            const bulbMesh = new THREE.Mesh(bulbGeo, getMat(bulbMat));
            bulbMesh.position.set(0, f.h * 0.82 - shadeR * 0.4, shadeY);
            group.add(bulbMesh);

            // 6. Child THREE.PointLight
            const lightColor = f.lightColor || 0xffeedd;
            const lightIntensity = (f.lightIntensity !== undefined ? f.lightIntensity : 10000) * (isLit ? 1 : 0);
            const lightDist = f.lightDistance || 450;
            const lampLight = new THREE.PointLight(lightColor, lightIntensity, lightDist, 2);
            lampLight.position.set(0, f.h * 0.82 - shadeR * 0.6, shadeY);
            lampLight.castShadow = true;
            if (lampLight.shadow) {
                lampLight.shadow.mapSize.width = 512;
                lampLight.shadow.mapSize.height = 512;
                lampLight.shadow.camera.near = 5;
                lampLight.shadow.camera.far = 500;
                lampLight.shadow.bias = -0.002;
            }
            group.add(lampLight);

            group.userData.isFloorLamp = true;
            group.userData.lampLight = lampLight;
            group.userData.bulbMat = bulbMat;

        } else if (nameLower.includes('pflanze') || nameLower.includes('plant') || f.isPlant || pKey === 'plant') {
            // =========================================================================
            // 6. POTTED INDOOR PLANT (Zimmerpflanze)
            // =========================================================================
            const potTopR = 17;
            const potBottomR = 12;
            const potH = 34;
            const soilY = 32;

            // 1. Ceramic Pot
            const potGeo = new THREE.CylinderGeometry(potTopR, potBottomR, potH, 24);
            const ceramicMat = new THREE.MeshStandardMaterial({
                color: 0xf1f3f5,
                roughness: 0.35,
                metalness: 0.05
            });
            const potMesh = new THREE.Mesh(potGeo, getMat(ceramicMat));
            potMesh.position.y = potH / 2;
            potMesh.castShadow = true;
            potMesh.receiveShadow = true;
            group.add(potMesh);

            // Rim Collar
            const rimGeo = new THREE.CylinderGeometry(potTopR + 0.8, potTopR, 2, 24);
            const rimMesh = new THREE.Mesh(rimGeo, getMat(ceramicMat));
            rimMesh.position.y = potH;
            rimMesh.castShadow = true;
            group.add(rimMesh);

            // 2. Potting Soil
            const soilGeo = new THREE.CylinderGeometry(potTopR - 0.5, potTopR - 1.5, 3, 24);
            const soilMat = new THREE.MeshStandardMaterial({
                color: 0x241810,
                roughness: 0.95,
                metalness: 0.0
            });
            const soilMesh = new THREE.Mesh(soilGeo, getMat(soilMat));
            soilMesh.position.y = soilY;
            soilMesh.receiveShadow = true;
            group.add(soilMesh);

            // 3. Stems & Leaves branching outward at golden angle
            const leafMat1 = new THREE.MeshStandardMaterial({
                color: 0x2d6a4f,
                roughness: 0.55,
                metalness: 0.05,
                side: THREE.DoubleSide || 2
            });
            const leafMat2 = new THREE.MeshStandardMaterial({
                color: 0x40916c,
                roughness: 0.5,
                metalness: 0.05,
                side: THREE.DoubleSide || 2
            });
            const stemMat = new THREE.MeshStandardMaterial({
                color: 0x2d4a22,
                roughness: 0.7,
                metalness: 0.1
            });

            let baseLeafGeo = null;
            if (typeof THREE.Shape === 'function' && typeof THREE.ShapeGeometry === 'function') {
                const leafShape = new THREE.Shape();
                leafShape.moveTo(0, 0);
                leafShape.bezierCurveTo(7, 8, 13, 22, 0, 38);
                leafShape.bezierCurveTo(-13, 22, -7, 8, 0, 0);

                baseLeafGeo = new THREE.ShapeGeometry(leafShape, 12);
                if (baseLeafGeo.attributes && baseLeafGeo.attributes.position) {
                    const posAttr = baseLeafGeo.attributes.position;
                    for (let j = 0; j < posAttr.count; j++) {
                        const lx = posAttr.getX(j);
                        const ly = posAttr.getY(j);
                        const zArch = -Math.pow(lx / 6, 2) * 1.2 - Math.sin((ly / 38) * Math.PI) * 4.0;
                        posAttr.setZ(j, zArch);
                    }
                    if (baseLeafGeo.computeVertexNormals) baseLeafGeo.computeVertexNormals();
                }
            }

            const leafCount = 8;
            const goldenAngle = 2.39996;

            for (let i = 0; i < leafCount; i++) {
                const fraction = (i + 1) / leafCount;
                const azimuth = i * goldenAngle;
                const tilt = 0.45 + (1 - fraction) * 0.35;
                const stemLen = 25 + fraction * 35;

                const stemGeo = new THREE.CylinderGeometry(0.8, 1.3, stemLen, 8);
                const stemMesh = new THREE.Mesh(stemGeo, getMat(stemMat));

                const stemGroup = new THREE.Group();
                stemGroup.position.set(0, soilY + 1, 0);
                stemGroup.rotation.y = azimuth;

                stemMesh.position.set(0, stemLen / 2, 0);
                stemMesh.rotation.x = tilt * 0.5;
                stemMesh.castShadow = true;
                stemGroup.add(stemMesh);

                const leafGeoInstance = baseLeafGeo || new THREE.BoxGeometry(16, 2, 32);
                const leafMesh = new THREE.Mesh(leafGeoInstance, getMat(i % 2 === 0 ? leafMat1 : leafMat2));
                const scale = 0.8 + fraction * 0.4;
                leafMesh.scale.set(scale, scale, scale);

                const tipY = stemLen * Math.cos(tilt * 0.5);
                const tipZ = stemLen * Math.sin(tilt * 0.5);
                leafMesh.position.set(0, tipY, tipZ);
                leafMesh.rotation.x = tilt + 0.3;
                leafMesh.castShadow = true;
                leafMesh.receiveShadow = true;
                stemGroup.add(leafMesh);

                group.add(stemGroup);
            }

        } else if (nameLower.includes('nachttisch') || nameLower.includes('nightstand') || f.isNightstand || pKey === 'nightstand') {
            // =========================================================================
            // 7. MINIMALIST NIGHTSTAND (Nachttisch)
            // =========================================================================
            const legH = 24;
            const bodyH = f.h - legH; // 28 cm

            // 1. Cabinet Box
            const boxGeo = new THREE.BoxGeometry(f.w, bodyH, f.l);
            const boxMesh = new THREE.Mesh(boxGeo, getMat(woodMat));
            boxMesh.position.set(0, legH + bodyH / 2, 0);
            boxMesh.castShadow = true;
            boxMesh.receiveShadow = true;
            group.add(boxMesh);

            // 2. Drawer Front & Shadow Gap
            const gapGeo = new THREE.BoxGeometry(f.w - 1, 0.8, 0.5);
            const gapMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 });
            const gapMesh = new THREE.Mesh(gapGeo, getMat(gapMat));
            gapMesh.position.set(0, legH + bodyH * 0.5, f.l / 2 + 0.3);
            group.add(gapMesh);

            const drawerH = (bodyH - 3) / 2;
            const drawerGeo = new THREE.BoxGeometry(f.w - 2, drawerH, 1.2);
            const drawerMesh = new THREE.Mesh(drawerGeo, getMat(woodMat));
            drawerMesh.position.set(0, legH + bodyH - drawerH / 2 - 1.5, f.l / 2 + 0.6);
            drawerMesh.castShadow = true;
            group.add(drawerMesh);

            // Minimalist finger notch
            const notchGeo = new THREE.BoxGeometry(12, 0.8, 1.5);
            const notchMesh = new THREE.Mesh(notchGeo, getMat(gapMat));
            notchMesh.position.set(0, legH + bodyH - drawerH - 0.5, f.l / 2 + 0.8);
            group.add(notchMesh);

            // 3. Hairpin Steel Legs
            const legMat = new THREE.MeshStandardMaterial({
                color: 0x1e293b,
                metalness: 0.85,
                roughness: 0.25
            });
            const strutRadius = 0.6;
            const strutLen = Math.sqrt(legH * legH + 2.5 * 2.5);
            const strutGeo = new THREE.CylinderGeometry(strutRadius, strutRadius, strutLen, 12);

            const cornerOffsets = [
                { x: -f.w / 2 + 5, z: -f.l / 2 + 5, sx: -1, sz: -1 },
                { x: f.w / 2 - 5, z: -f.l / 2 + 5, sx: 1, sz: -1 },
                { x: -f.w / 2 + 5, z: f.l / 2 - 5, sx: -1, sz: 1 },
                { x: f.w / 2 - 5, z: f.l / 2 - 5, sx: 1, sz: 1 }
            ];

            cornerOffsets.forEach(c => {
                // Base plate
                const plateGeo = new THREE.BoxGeometry(4, 0.4, 4);
                const plateMesh = new THREE.Mesh(plateGeo, getMat(legMat));
                plateMesh.position.set(c.x, legH - 0.2, c.z);
                group.add(plateMesh);

                // V-struts
                const strut1 = new THREE.Mesh(strutGeo, getMat(legMat));
                strut1.position.set(c.x + c.sx * 0.8, legH / 2, c.z + c.sz * 0.4);
                strut1.rotation.z = -c.sx * 0.08;
                strut1.rotation.x = c.sz * 0.04;
                strut1.castShadow = true;
                group.add(strut1);

                const strut2 = new THREE.Mesh(strutGeo, getMat(legMat));
                strut2.position.set(c.x + c.sx * 0.4, legH / 2, c.z + c.sz * 0.8);
                strut2.rotation.z = -c.sx * 0.04;
                strut2.rotation.x = c.sz * 0.08;
                strut2.castShadow = true;
                group.add(strut2);

                // Rubber foot pad
                const footGeo = typeof THREE.SphereGeometry === 'function'
                    ? new THREE.SphereGeometry(1.0, 8, 8)
                    : new THREE.CylinderGeometry(1.0, 1.0, 1.0, 8);
                const footMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 });
                const footMesh = new THREE.Mesh(footGeo, getMat(footMat));
                footMesh.position.set(c.x + c.sx * 1.5, 0.8, c.z + c.sz * 1.5);
                group.add(footMesh);
            });

            // 4. Staged Bedside Book
            const bookW = 16, bookH = 2.2, bookL = 22;
            const bookCoverGeo = new THREE.BoxGeometry(bookW, bookH, bookL);
            const bookCoverMat = new THREE.MeshStandardMaterial({
                color: 0x3b82f6,
                roughness: 0.6
            });
            const bookCoverMesh = new THREE.Mesh(bookCoverGeo, getMat(bookCoverMat));
            bookCoverMesh.position.set(-f.w * 0.15, f.h + bookH / 2, 0);
            bookCoverMesh.rotation.y = -0.15;
            bookCoverMesh.castShadow = true;
            bookCoverMesh.receiveShadow = true;
            group.add(bookCoverMesh);

            const pageGeo = new THREE.BoxGeometry(bookW - 0.6, bookH - 0.4, bookL - 0.6);
            const pageMesh = new THREE.Mesh(pageGeo, getMat(whiteMat));
            pageMesh.position.set(-f.w * 0.15 + 0.3, f.h + bookH / 2, 0);
            pageMesh.rotation.y = -0.15;
            group.add(pageMesh);

        } else if (nameLower.includes('lounge') || pKey === 'lounge-chair') {
            // =========================================================================
            // 1. MINIMALIST LOUNGE CHAIR (Lounge-Sessel)
            // =========================================================================
            const legMat = new THREE.MeshStandardMaterial({
                color: 0x1e293b,
                roughness: 0.35,
                metalness: 0.85
            });
            const legGeo = new THREE.CylinderGeometry(0.9, 1.2, 22, 12);
            const legAngles = [
                { x: -(f.w / 2 - 8), z: -(f.l / 2 - 10), tiltX: -0.06, tiltZ: -0.06 },
                { x: +(f.w / 2 - 8), z: -(f.l / 2 - 10), tiltX: -0.06, tiltZ: +0.06 },
                { x: -(f.w / 2 - 8), z: +(f.l / 2 - 10), tiltX: +0.06, tiltZ: -0.06 },
                { x: +(f.w / 2 - 8), z: +(f.l / 2 - 10), tiltX: +0.06, tiltZ: +0.06 }
            ];
            legAngles.forEach(la => {
                const legMesh = new THREE.Mesh(legGeo, getMat(legMat));
                legMesh.position.set(la.x, 11, la.z);
                legMesh.rotation.x = la.tiltX;
                legMesh.rotation.z = la.tiltZ;
                legMesh.castShadow = true;
                group.add(legMesh);
            });

            // Leg stretchers
            const stretcherGeo = new THREE.CylinderGeometry(0.8, 0.8, f.l - 24, 8);
            const strLeft = new THREE.Mesh(stretcherGeo, getMat(legMat));
            strLeft.position.set(-(f.w / 2 - 8), 10, 0);
            strLeft.rotation.x = Math.PI / 2;
            group.add(strLeft);

            const strRight = new THREE.Mesh(stretcherGeo, getMat(legMat));
            strRight.position.set(+(f.w / 2 - 8), 10, 0);
            strRight.rotation.x = Math.PI / 2;
            group.add(strRight);

            // Sub-chassis plate
            const chassisGeo = new THREE.BoxGeometry(f.w - 8, 2.5, f.l - 12);
            const chassisMesh = new THREE.Mesh(chassisGeo, getMat(legMat));
            chassisMesh.position.set(0, 22 + 1.25, 0);
            chassisMesh.rotation.x = -0.05;
            chassisMesh.castShadow = true;
            group.add(chassisMesh);

            // Plush bouclé seat cushion
            const cushionGeo = new THREE.BoxGeometry(f.w - 14, 14, f.l - 20);
            const cushionMesh = new THREE.Mesh(cushionGeo, getMat(fabricMat));
            cushionMesh.position.set(0, 24 + 7, 2);
            cushionMesh.rotation.x = -0.05;
            cushionMesh.castShadow = true;
            cushionMesh.receiveShadow = true;
            group.add(cushionMesh);

            // Ergonomic backrest pillow
            const backGeo = new THREE.BoxGeometry(f.w - 14, 46, 12);
            const backMesh = new THREE.Mesh(backGeo, getMat(fabricMat));
            backMesh.position.set(0, 28 + 23, -f.l / 2 + 16);
            backMesh.rotation.x = -0.22;
            backMesh.castShadow = true;
            backMesh.receiveShadow = true;
            group.add(backMesh);

            // Walnut arm pads on metal upright posts
            const armPadGeo = new THREE.BoxGeometry(5, 2.5, f.l - 18);
            const armPostGeo = new THREE.CylinderGeometry(0.8, 0.8, 20, 8);

            [-1, 1].forEach(side => {
                const armX = side * (f.w / 2 - 4);
                [-1, 1].forEach(postPos => {
                    const postMesh = new THREE.Mesh(armPostGeo, getMat(legMat));
                    postMesh.position.set(armX, 22 + 10, postPos * (f.l / 4 - 4));
                    postMesh.castShadow = true;
                    group.add(postMesh);
                });

                const armPad = new THREE.Mesh(armPadGeo, getMat(woodMat));
                armPad.position.set(armX, 42.5, 0);
                armPad.castShadow = true;
                group.add(armPad);
            });

        } else if (nameLower.includes('regal') || nameLower.includes('raumteiler') || nameLower.includes('bookshelf') || pKey === 'bookshelf') {
            // =========================================================================
            // 2. BOOKSHELF / ROOM DIVIDER (Regal / Raumteiler)
            // =========================================================================
            const cheekGeo = new THREE.BoxGeometry(3, f.h, f.l);
            const leftCheek = new THREE.Mesh(cheekGeo, getMat(woodMat));
            leftCheek.position.set(-(f.w / 2 - 1.5), f.h / 2, 0);
            leftCheek.castShadow = true;
            leftCheek.receiveShadow = true;
            group.add(leftCheek);

            const rightCheek = new THREE.Mesh(cheekGeo, getMat(woodMat));
            rightCheek.position.set(+(f.w / 2 - 1.5), f.h / 2, 0);
            rightCheek.castShadow = true;
            rightCheek.receiveShadow = true;
            group.add(rightCheek);

            // Base plinth
            const plinthGeo = new THREE.BoxGeometry(f.w - 6, 4, f.l);
            const plinthMesh = new THREE.Mesh(plinthGeo, getMat(woodMat));
            plinthMesh.position.set(0, 2, 0);
            plinthMesh.castShadow = true;
            plinthMesh.receiveShadow = true;
            group.add(plinthMesh);

            // Top crown shelf
            const crownGeo = new THREE.BoxGeometry(f.w, 2.5, f.l);
            const crownMesh = new THREE.Mesh(crownGeo, getMat(woodMat));
            crownMesh.position.set(0, f.h - 1.25, 0);
            crownMesh.castShadow = true;
            group.add(crownMesh);

            // 4 Intermediate Shelves
            const shelfLevels = [36, 70, 104, 138];
            const shelfGeo = new THREE.BoxGeometry(f.w - 6, 2.5, f.l - 0.5);
            shelfLevels.forEach(yLevel => {
                const shelf = new THREE.Mesh(shelfGeo, getMat(woodMat));
                shelf.position.set(0, yLevel, 0);
                shelf.castShadow = true;
                shelf.receiveShadow = true;
                group.add(shelf);
            });

            // Asymmetric Staggered Vertical Dividers
            const dividers = [
                { y: 36 + 17, h: 31.5, x: -20 },
                { y: 70 + 17, h: 31.5, x: 25 },
                { y: 104 + 17, h: 31.5, x: -30 },
                { y: 138 + 10, h: 18, x: 15 }
            ];
            dividers.forEach(div => {
                const divGeo = new THREE.BoxGeometry(2.5, div.h, f.l - 1);
                const divMesh = new THREE.Mesh(divGeo, getMat(woodMat));
                divMesh.position.set(div.x, div.y, 0);
                divMesh.castShadow = true;
                divMesh.receiveShadow = true;
                group.add(divMesh);
            });

            // Staged books cluster on shelf 2 (y = 70)
            const bookColors = [0x1e3a5f, 0xa04e38, 0x556b2f, 0xe2d9cb, 0x2c3e50];
            const bookHeights = [22, 26, 20, 24, 25];
            for (let b = 0; b < 5; b++) {
                const bH = bookHeights[b];
                const bGeo = new THREE.BoxGeometry(3.6, bH, f.l * 0.55);
                const bMat = new THREE.MeshStandardMaterial({
                    color: bookColors[b],
                    roughness: 0.75,
                    metalness: 0.05
                });
                const bMesh = new THREE.Mesh(bGeo, getMat(bMat));
                bMesh.position.set(-(f.w / 2 - 10) + b * 4.4, 70 + 1.25 + bH / 2, 0);
                bMesh.castShadow = true;
                group.add(bMesh);
            }

            // Ceramic vase on shelf 3 (y = 104)
            const vaseGeo = new THREE.CylinderGeometry(4.5, 3.5, 18, 24);
            const vaseMat = new THREE.MeshStandardMaterial({
                color: 0xede8df,
                roughness: 0.85,
                metalness: 0.05
            });
            const vaseMesh = new THREE.Mesh(vaseGeo, getMat(vaseMat));
            vaseMesh.position.set(f.w / 2 - 18, 104 + 1.25 + 9, 0);
            vaseMesh.castShadow = true;
            group.add(vaseMesh);

        } else if (nameLower.includes('couchtisch') || nameLower.includes('coffee-table') || pKey === 'coffee-table-set') {
            // =========================================================================
            // 3. MODERN COFFEE TABLE SET (Couchtisch-Set)
            // =========================================================================
            const tableLegMat = new THREE.MeshStandardMaterial({
                color: 0x18181b,
                roughness: 0.35,
                metalness: 0.85
            });

            // Primary Table (Height 42cm, Carrara marble top)
            const marbleMat = new THREE.MeshStandardMaterial({
                color: 0xf1f0eb,
                roughness: 0.25,
                metalness: 0.08
            });
            const top1Geo = new THREE.CylinderGeometry(26, 26, 2.4, 36);
            const top1Mesh = new THREE.Mesh(top1Geo, getMat(marbleMat));
            top1Mesh.position.set(-16, 42 - 1.2, -4);
            top1Mesh.castShadow = true;
            top1Mesh.receiveShadow = true;
            group.add(top1Mesh);

            // 3 Tapered Tripod Legs for Table 1
            const leg1Geo = new THREE.CylinderGeometry(1.0, 0.7, 39.6, 12);
            for (let i = 0; i < 3; i++) {
                const angle = (i * 2 * Math.PI) / 3;
                const leg1 = new THREE.Mesh(leg1Geo, getMat(tableLegMat));
                leg1.position.set(-16 + Math.cos(angle) * 18, 19.8, -4 + Math.sin(angle) * 18);
                leg1.rotation.z = -Math.cos(angle) * 0.07;
                leg1.rotation.x = Math.sin(angle) * 0.07;
                leg1.castShadow = true;
                group.add(leg1);
            }

            // Secondary Nested Table (Height 34cm, Smoked Oak top)
            const smokedOakMat = new THREE.MeshStandardMaterial({
                color: 0x27272a,
                roughness: 0.6,
                metalness: 0.1
            });
            const top2Geo = new THREE.CylinderGeometry(20, 20, 2.0, 36);
            const top2Mesh = new THREE.Mesh(top2Geo, getMat(smokedOakMat));
            top2Mesh.position.set(18, 34 - 1.0, 6);
            top2Mesh.castShadow = true;
            top2Mesh.receiveShadow = true;
            group.add(top2Mesh);

            // 3 Tapered Tripod Legs for Table 2
            const leg2Geo = new THREE.CylinderGeometry(0.9, 0.6, 32.0, 12);
            for (let i = 0; i < 3; i++) {
                const angle = Math.PI / 3 + (i * 2 * Math.PI) / 3;
                const leg2 = new THREE.Mesh(leg2Geo, getMat(tableLegMat));
                leg2.position.set(18 + Math.cos(angle) * 14, 16.0, 6 + Math.sin(angle) * 14);
                leg2.rotation.z = -Math.cos(angle) * 0.07;
                leg2.rotation.x = Math.sin(angle) * 0.07;
                leg2.castShadow = true;
                group.add(leg2);
            }

            // Art monograph decor on Table 1
            const bookGeo = new THREE.BoxGeometry(14, 0.8, 10);
            const bookMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.8 });
            const bookMesh = new THREE.Mesh(bookGeo, getMat(bookMat));
            bookMesh.position.set(-16, 42 + 0.4, -4);
            bookMesh.rotation.y = 0.2;
            bookMesh.castShadow = true;
            group.add(bookMesh);

        } else if (nameLower.includes('lowboard') || pKey === 'tv-lowboard') {
            // =========================================================================
            // 4. TV LOWBOARD / MEDIA UNIT (TV-Lowboard)
            // =========================================================================
            // 1. Recessed dark shadow plinth
            const plinthMat = new THREE.MeshStandardMaterial({
                color: 0x121214,
                roughness: 0.9,
                metalness: 0.1
            });
            const plinthGeo = new THREE.BoxGeometry(f.w - 12, 6, f.l - 8);
            const plinthMesh = new THREE.Mesh(plinthGeo, getMat(plinthMat));
            plinthMesh.position.set(0, 3, 0);
            plinthMesh.castShadow = true;
            plinthMesh.receiveShadow = true;
            group.add(plinthMesh);

            // 2. Carcass Bottom & Top in Walnut
            const carcassPanelGeo = new THREE.BoxGeometry(f.w, 2.2, f.l);
            const bottomMesh = new THREE.Mesh(carcassPanelGeo, getMat(woodMat));
            bottomMesh.position.set(0, 7.1, 0);
            bottomMesh.castShadow = true;
            bottomMesh.receiveShadow = true;
            group.add(bottomMesh);

            const topMesh = new THREE.Mesh(carcassPanelGeo, getMat(woodMat));
            topMesh.position.set(0, 43.9, 0);
            topMesh.castShadow = true;
            topMesh.receiveShadow = true;
            group.add(topMesh);

            // 3. Side Cheeks
            const cheekGeo = new THREE.BoxGeometry(2.2, 34.6, f.l);
            const leftCheek = new THREE.Mesh(cheekGeo, getMat(woodMat));
            leftCheek.position.set(-(f.w / 2 - 1.1), 25.5, 0);
            leftCheek.castShadow = true;
            leftCheek.receiveShadow = true;
            group.add(leftCheek);

            const rightCheek = new THREE.Mesh(cheekGeo, getMat(woodMat));
            rightCheek.position.set(+(f.w / 2 - 1.1), 25.5, 0);
            rightCheek.castShadow = true;
            rightCheek.receiveShadow = true;
            group.add(rightCheek);

            // 4. Internal Partitions
            const partGeo = new THREE.BoxGeometry(1.8, 34.6, f.l - 4);
            const p1 = new THREE.Mesh(partGeo, getMat(woodMat));
            p1.position.set(-f.w / 6, 25.5, 0);
            p1.castShadow = true;
            group.add(p1);

            const p2 = new THREE.Mesh(partGeo, getMat(woodMat));
            p2.position.set(+f.w / 6, 25.5, 0);
            p2.castShadow = true;
            group.add(p2);

            // 5. Back Panel
            const backGeo = new THREE.BoxGeometry(f.w - 4.4, 34.6, 1.2);
            const backMesh = new THREE.Mesh(backGeo, getMat(woodMat));
            backMesh.position.set(0, 25.5, -f.l / 2 + 0.6);
            group.add(backMesh);

            // 6. Acoustic Felt Backing (Dark Charcoal)
            const feltMat = new THREE.MeshStandardMaterial({
                color: 0x18181b,
                roughness: 0.95
            });
            const feltGeo = new THREE.BoxGeometry(f.w - 5, 33.6, 0.8);
            const feltMesh = new THREE.Mesh(feltGeo, getMat(feltMat));
            feltMesh.position.set(0, 25.5, f.l / 2 - 2.0);
            group.add(feltMesh);

            // 7. 36 Acoustic Wood Slats
            const slatCount = 36;
            const slatGeo = new THREE.BoxGeometry(2.4, 32.6, 1.2);
            const slatSpan = f.w - 8;
            const slatStep = slatSpan / (slatCount - 1);
            for (let s = 0; s < slatCount; s++) {
                const slatX = -(slatSpan / 2) + s * slatStep;
                const slatMesh = new THREE.Mesh(slatGeo, getMat(woodMat));
                slatMesh.position.set(slatX, 25.5, f.l / 2 - 1.0);
                slatMesh.castShadow = true;
                group.add(slatMesh);
            }

            // 8. Rear Cable Grommet
            const grommetMat = new THREE.MeshStandardMaterial({
                color: 0x334155,
                metalness: 0.7,
                roughness: 0.3
            });
            const grommetGeo = new THREE.CylinderGeometry(2.5, 2.5, 0.4, 20);
            const grommetMesh = new THREE.Mesh(grommetGeo, getMat(grommetMat));
            grommetMesh.position.set(0, 45.2, -f.l / 2 + 6);
            group.add(grommetMesh);

        } else if ((f.tvSize !== null && f.tvSize !== undefined) || (!nameLower.includes('lowboard') && !nameLower.includes('sideboard') && !nameLower.includes('board') && (nameLower.includes('tv') || nameLower.includes('fernseher')))) {
            // TV / Fernseher
            const baseH = 2;
            const neckH = 8;
            const screenHeight = Math.max(10, f.h - baseH - neckH);
            
            // 1. Base / Stand plate (metal or dark plastic)
            const baseW = Math.min(f.w * 0.4, 40);
            const baseL = Math.min(f.l, 20);
            const baseGeo = new THREE.BoxGeometry(baseW, baseH, baseL);
            const baseMesh = new THREE.Mesh(baseGeo, getMat(metalMat));
            baseMesh.position.y = baseH / 2;
            baseMesh.castShadow = true;
            baseMesh.receiveShadow = true;
            group.add(baseMesh);
            
            // 2. Neck / Stand post (metal cylinder)
            const neckGeo = new THREE.CylinderGeometry(2, 2, neckH, 16);
            const neckMesh = new THREE.Mesh(neckGeo, getMat(metalMat));
            neckMesh.position.y = baseH + neckH / 2;
            neckMesh.castShadow = true;
            group.add(neckMesh);
            
            // 3. TV Bezel / Frame (slate-800 or black)
            const bezelGeo = new THREE.BoxGeometry(f.w, screenHeight, 3);
            const bezelMesh = new THREE.Mesh(bezelGeo, getMat(screenMat));
            bezelMesh.position.y = baseH + neckH + screenHeight / 2;
            bezelMesh.castShadow = true;
            group.add(bezelMesh);
            
            // 4. Glossy Screen (inset on front face of the bezel)
            const screenW = f.w - 2;
            const screenH = screenHeight - 2;
            const screenGeo = new THREE.BoxGeometry(screenW, screenH, 0.5);
            const glassScreenMat = new THREE.MeshStandardMaterial({
                color: 0x0f172a, // dark slate
                roughness: 0.1,
                metalness: 0.9
            });
            const screenMesh = new THREE.Mesh(screenGeo, getMat(glassScreenMat));
            screenMesh.position.set(0, baseH + neckH + screenHeight / 2, 1.35); // slightly shifted forward to fit on bezel
            group.add(screenMesh);
            
        } else if (nameLower.includes('bett') || f.id.includes('bed')) {
            // Doppelbett (Double Bed)
            // 1. Frame base (wood)
            const frameH = 15;
            const frameGeo = new THREE.BoxGeometry(f.w, frameH, f.l);
            const frameMesh = new THREE.Mesh(frameGeo, getMat(woodMat));
            frameMesh.position.y = frameH / 2;
            frameMesh.castShadow = true;
            frameMesh.receiveShadow = true;
            group.add(frameMesh);
            
            // 2. Headboard (wood)
            const headH = f.h;
            const headT = 6;
            const headGeo = new THREE.BoxGeometry(f.w, headH, headT);
            const headMesh = new THREE.Mesh(headGeo, getMat(woodMat));
            headMesh.position.set(0, headH / 2, -f.l / 2 + headT / 2);
            headMesh.castShadow = true;
            headMesh.receiveShadow = true;
            group.add(headMesh);
            
            // 3. Mattress (white fabric)
            const mattH = 20;
            const mattW = f.w - 8;
            const mattL = f.l - headT - 4;
            const mattGeo = new THREE.BoxGeometry(mattW, mattH, mattL);
            const mattMesh = new THREE.Mesh(mattGeo, getMat(whiteMat));
            mattMesh.position.set(0, frameH + mattH / 2, headT / 2);
            mattMesh.castShadow = true;
            mattMesh.receiveShadow = true;
            group.add(mattMesh);
            
            // 4. Pillows (two small white boxes)
            const pilW = mattW / 2 - 8;
            const pilL = 25;
            const pilH = 6;
            const pilGeo = new THREE.BoxGeometry(pilW, pilH, pilL);
            
            const pilLMesh = new THREE.Mesh(pilGeo, getMat(whiteMat));
            pilLMesh.position.set(-pilW / 2 - 2, frameH + mattH + pilH / 2, -mattL / 2 + pilL / 2 + headT + 2);
            group.add(pilLMesh);
            
            const pilRMesh = new THREE.Mesh(pilGeo, getMat(whiteMat));
            pilRMesh.position.set(pilW / 2 + 2, frameH + mattH + pilH / 2, -mattL / 2 + pilL / 2 + headT + 2);
            group.add(pilRMesh);
            
            // 5. Blanket (colored fabric folded at the foot of the bed)
            const blH = 2;
            const blW = mattW + 0.2;
            const blL = mattL * 0.6; // covers 60% of mattress
            const blGeo = new THREE.BoxGeometry(blW, blH, blL);
            const blMesh = new THREE.Mesh(blGeo, getMat(fabricMat));
            
            // Position on top of mattress, aligned to the foot of the bed
            const zPos = (headT / 2 + mattL / 2) - blL / 2;
            blMesh.position.set(0, frameH + mattH + blH / 2, zPos);
            blMesh.castShadow = true;
            blMesh.receiveShadow = true;
            group.add(blMesh);
            
        } else if (nameLower.includes('schrank') || f.id.includes('wardrobe')) {
            // Kleiderschrank (Wardrobe)
            // 1. Main body (wood)
            const bodyGeo = new THREE.BoxGeometry(f.w, f.h, f.l);
            const bodyMesh = new THREE.Mesh(bodyGeo, getMat(woodMat));
            bodyMesh.position.y = f.h / 2;
            bodyMesh.castShadow = true;
            bodyMesh.receiveShadow = true;
            group.add(bodyMesh);
            
            // 2. Door slit line
            const slitW = 1;
            const slitGeo = new THREE.BoxGeometry(slitW, f.h - 10, 2);
            const slitMesh = new THREE.Mesh(slitGeo, getMat(screenMat));
            slitMesh.position.set(0, f.h / 2, f.l / 2 + 0.5);
            group.add(slitMesh);
            
            // 3. Handles (metal)
            const handH = 30;
            const handGeo = new THREE.BoxGeometry(2, handH, 2);
            const handL = new THREE.Mesh(handGeo, getMat(metalMat));
            handL.position.set(-6, f.h / 2, f.l / 2 + 2);
            group.add(handL);
            
            const handR = new THREE.Mesh(handGeo, getMat(metalMat));
            handR.position.set(6, f.h / 2, f.l / 2 + 2);
            group.add(handR);
            
        } else if (nameLower.includes('schreibtisch') || f.id.includes('desk')) {
            // Schreibtisch (Desk)
            // 1. Tabletop (wood)
            const topH = 4;
            const topGeo = new THREE.BoxGeometry(f.w, topH, f.l);
            const topMesh = new THREE.Mesh(topGeo, getMat(woodMat));
            topMesh.position.y = f.h - topH / 2;
            topMesh.castShadow = true;
            topMesh.receiveShadow = true;
            group.add(topMesh);
            
            // 2. Legs (metal cylinders)
            const legRadius = 2.5;
            const legH = f.h - topH;
            const legGeo = new THREE.CylinderGeometry(legRadius, legRadius, legH, 16);
            const legOffsetW = f.w / 2 - 5;
            const legOffsetL = f.l / 2 - 5;
            const legPositions = [
                { x: -legOffsetW, z: -legOffsetL },
                { x: legOffsetW, z: -legOffsetL },
                { x: -legOffsetW, z: legOffsetL },
                { x: legOffsetW, z: legOffsetL }
            ];
            legPositions.forEach(pos => {
                const legMesh = new THREE.Mesh(legGeo, getMat(metalMat));
                legMesh.position.set(pos.x, legH / 2, pos.z);
                legMesh.castShadow = true;
                legMesh.receiveShadow = true;
                group.add(legMesh);
            });
            
            // 3. Drawer Cabinet
            const cabW = 35;
            const cabH = legH - 10;
            const cabL = f.l - 10;
            const cabGeo = new THREE.BoxGeometry(cabW, cabH, cabL);
            const cabMesh = new THREE.Mesh(cabGeo, getMat(woodMat));
            cabMesh.position.set(-f.w / 2 + cabW / 2 + 10, cabH / 2, 0);
            cabMesh.castShadow = true;
            cabMesh.receiveShadow = true;
            group.add(cabMesh);
            
            // 4. Laptop
            const lapW = 30;
            const lapL = 20;
            const lapGeo = new THREE.BoxGeometry(lapW, 1.0, lapL);
            const lapMesh = new THREE.Mesh(lapGeo, getMat(metalMat));
            lapMesh.position.set(10, f.h + 0.5, 5);
            group.add(lapMesh);
            
            const screenGeo = new THREE.BoxGeometry(lapW, 15, 1.0);
            const screenMesh = new THREE.Mesh(screenGeo, getMat(screenMat));
            screenMesh.position.set(10, f.h + 8, -lapL / 2 + 5);
            screenMesh.rotation.x = 0.2;
            group.add(screenMesh);
            
        } else if (nameLower.includes('stuhl') || f.id.includes('chair')) {
            // Stuhl (Chair)
            const seatH = f.h * 0.53;
            const seatT = 3;
            
            // 1. Seat
            const seatGeo = new THREE.BoxGeometry(f.w, seatT, f.l);
            const seatMesh = new THREE.Mesh(seatGeo, getMat(fabricMat));
            seatMesh.position.y = seatH;
            seatMesh.castShadow = true;
            seatMesh.receiveShadow = true;
            group.add(seatMesh);
            
            // 2. Backrest
            const backH = f.h - seatH;
            const backGeo = new THREE.BoxGeometry(f.w, backH, 3);
            const backMesh = new THREE.Mesh(backGeo, getMat(fabricMat));
            backMesh.position.set(0, seatH + backH / 2, -f.l / 2 + 1.5);
            backMesh.castShadow = true;
            backMesh.receiveShadow = true;
            group.add(backMesh);
            
            // 3. Legs
            const legGeo = new THREE.CylinderGeometry(1.5, 1.0, seatH, 8);
            const legPositions = [
                { x: -f.w / 2 + 3, z: -f.l / 2 + 3 },
                { x: f.w / 2 - 3, z: -f.l / 2 + 3 },
                { x: -f.w / 2 + 3, z: f.l / 2 - 3 },
                { x: f.w / 2 - 3, z: f.l / 2 - 3 }
            ];
            legPositions.forEach(pos => {
                const legMesh = new THREE.Mesh(legGeo, getMat(metalMat));
                legMesh.position.set(pos.x, seatH / 2, pos.z);
                legMesh.castShadow = true;
                group.add(legMesh);
            });
            
        } else if (nameLower.includes('sofa') || f.id.includes('sofa')) {
            // Sofa
            // 1. Base cushion
            const baseH = 25;
            const baseGeo = new THREE.BoxGeometry(f.w, baseH, f.l);
            const baseMesh = new THREE.Mesh(baseGeo, getMat(fabricMat));
            baseMesh.position.y = baseH / 2 + 5;
            baseMesh.castShadow = true;
            baseMesh.receiveShadow = true;
            group.add(baseMesh);
            
            // 2. Backrest
            const backH = f.h - 10;
            const backT = 15;
            const backGeo = new THREE.BoxGeometry(f.w, backH, backT);
            const backMesh = new THREE.Mesh(backGeo, getMat(fabricMat));
            backMesh.position.set(0, backH / 2 + 5, -f.l / 2 + backT / 2);
            backMesh.castShadow = true;
            backMesh.receiveShadow = true;
            group.add(backMesh);
            
            // 3. Armrests
            const armW = 15;
            const armH = baseH + 15;
            const armGeo = new THREE.BoxGeometry(armW, armH, f.l);
            const armL = new THREE.Mesh(armGeo, getMat(fabricMat));
            armL.position.set(-f.w / 2 + armW / 2, armH / 2 + 5, 0);
            armL.castShadow = true;
            armL.receiveShadow = true;
            group.add(armL);
            
            const armR = new THREE.Mesh(armGeo, getMat(fabricMat));
            armR.position.set(f.w / 2 - armW / 2, armH / 2 + 5, 0);
            armR.castShadow = true;
            armR.receiveShadow = true;
            group.add(armR);
            
            // 4. Legs
            const legGeo = new THREE.CylinderGeometry(2, 2, 5, 8);
            const legPositions = [
                { x: -f.w / 2 + 5, z: -f.l / 2 + 5 },
                { x: f.w / 2 - 5, z: -f.l / 2 + 5 },
                { x: -f.w / 2 + 5, z: f.l / 2 - 5 },
                { x: f.w / 2 - 5, z: f.l / 2 - 5 }
            ];
            legPositions.forEach(pos => {
                const legMesh = new THREE.Mesh(legGeo, getMat(metalMat));
                legMesh.position.set(pos.x, 2.5, pos.z);
                legMesh.castShadow = true;
                group.add(legMesh);
            });
            
        } else if (nameLower.includes('esstisch') || nameLower.includes('table') || f.id.includes('table')) {
            // Esstisch (Dining Table) or Tisch (Table)
            const topH = 4;
            const topGeo = new THREE.BoxGeometry(f.w, topH, f.l);
            const topMesh = new THREE.Mesh(topGeo, getMat(woodMat));
            topMesh.position.y = f.h - topH / 2;
            topMesh.castShadow = true;
            topMesh.receiveShadow = true;
            group.add(topMesh);
            
            // Legs
            const legW = 6;
            const legH = f.h - topH;
            const legGeo = new THREE.BoxGeometry(legW, legH, legW);
            const legPositions = [
                { x: -f.w / 2 + legW / 2 + 2, z: -f.l / 2 + legW / 2 + 2 },
                { x: f.w / 2 - legW / 2 - 2, z: -f.l / 2 + legW / 2 + 2 },
                { x: -f.w / 2 + legW / 2 + 2, z: f.l / 2 - legW / 2 - 2 },
                { x: f.w / 2 - legW / 2 - 2, z: f.l / 2 - legW / 2 - 2 }
            ];
            legPositions.forEach(pos => {
                const legMesh = new THREE.Mesh(legGeo, getMat(woodMat));
                legMesh.position.set(pos.x, legH / 2, pos.z);
                legMesh.castShadow = true;
                legMesh.receiveShadow = true;
                group.add(legMesh);
            });
            
            // Table runner
            const runnerW = f.w * 0.3;
            const runnerGeo = new THREE.BoxGeometry(runnerW, 0.5, f.l + 0.2);
            const runnerMesh = new THREE.Mesh(runnerGeo, getMat(whiteMat));
            runnerMesh.position.set(0, f.h + 0.25, 0);
            group.add(runnerMesh);
            
        } else if (f.shape === 'circle') {
            const radius = f.w / 2;
            const isRoundTable = nameLower.includes('tisch') || nameLower.includes('table') || f.isTable;
            
            if (isRoundTable) {
                // Runder Tisch (Tischplatte + Säule + Fußplatte)
                const topH = 3;
                const topGeo = new THREE.CylinderGeometry(radius, radius, topH, 32);
                const topMesh = new THREE.Mesh(topGeo, getMat(woodMat));
                topMesh.position.y = f.h - topH / 2;
                topMesh.castShadow = true;
                topMesh.receiveShadow = true;
                group.add(topMesh);
                
                const pedGeo = new THREE.CylinderGeometry(8, 8, f.h - topH, 16);
                const pedMesh = new THREE.Mesh(pedGeo, getMat(woodMat));
                pedMesh.position.y = (f.h - topH) / 2;
                pedMesh.castShadow = true;
                pedMesh.receiveShadow = true;
                group.add(pedMesh);
                
                const basePlateGeo = new THREE.CylinderGeometry(radius * 0.5, radius * 0.5, 2, 24);
                const basePlateMesh = new THREE.Mesh(basePlateGeo, getMat(metalMat));
                basePlateMesh.position.y = 1;
                basePlateMesh.castShadow = true;
                basePlateMesh.receiveShadow = true;
                group.add(basePlateMesh);
            } else {
                // Echtes rundes Custom: Ein sauberer Zylinder
                const cylGeo = new THREE.CylinderGeometry(radius, radius, f.h, 32);
                const cylMesh = new THREE.Mesh(cylGeo, getMat(primaryMat));
                cylMesh.position.y = f.h / 2;
                cylMesh.castShadow = true;
                cylMesh.receiveShadow = true;
                group.add(cylMesh);
            }
        } else {
            // Custom rectangle block
            const boxGeo = new THREE.BoxGeometry(f.w, heightVal, f.l);
            const mainMesh = new THREE.Mesh(boxGeo, getMat(woodMat));
            mainMesh.position.y = heightVal / 2;
            mainMesh.castShadow = true;
            mainMesh.receiveShadow = true;
            group.add(mainMesh);
        }
    },

    updateFurniture3D(f) {
        if (!this.scene) return;
        
        // Guard against resurrecting deleted furniture
        if (State.furniture && !State.furniture.includes(f)) {
            this.removeFurniture3D(f);
            return;
        }
        
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
        
        // Attach domain entity metadata for raycasting traversal
        group.userData = { furniture: f, furnitureId: f.id };

        const isObstacle = f.isObstacle || false;
        const heightVal = isObstacle ? getCeilingHeightAt(f.x, f.y) : f.h;
        
        // Build the detailed parts
        this.buildDetailedFurniture(f, group, f.isColliding);
        
        // Draw selected indicators in 3D (Oriented Bounding Wireframe)
        if (State.selectedItem === f) {
            let edgesGeo;
            if (f.shape === 'circle') {
                edgesGeo = new THREE.EdgesGeometry(new THREE.CylinderGeometry(f.w/2, f.w/2, heightVal, 24));
            } else if (isObstacle) {
                const rad = (f.rotation * Math.PI) / 180;
                const cos = Math.cos(rad);
                const sin = Math.sin(rad);
                const corners = [
                    { lx: -f.w/2, ly: -f.l/2 }, // NW
                    { lx: f.w/2, ly: -f.l/2 },  // NE
                    { lx: f.w/2, ly: f.l/2 },   // SE
                    { lx: -f.w/2, ly: f.l/2 }    // SW
                ];
                const heights = corners.map(c => {
                    const gx = f.x + c.lx * cos - c.ly * sin;
                    const gy = f.y + c.lx * sin + c.ly * cos;
                    return getCeilingHeightAt(gx, gy);
                });
                edgesGeo = new THREE.EdgesGeometry(createSlantedBoxGeometry(f.w + 1, f.l + 1, heights[0] + 1, heights[1] + 1, heights[2] + 1, heights[3] + 1));
            } else {
                edgesGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(f.w + 1, heightVal + 1, f.l + 1));
            }
            
            const line = new THREE.LineSegments(
                edgesGeo,
                new THREE.LineBasicMaterial({ color: 0x3b82f6, linewidth: 2 })
            );
            line.name = 'selectionIndicator';
            line.position.y = isObstacle ? 0 : heightVal / 2;
            line.raycast = () => {}; // Never intercept raycasts
            group.add(line);
        }
        
        // Position group
        const offX = (this.roomOffset && typeof this.roomOffset.x === 'number') ? this.roomOffset.x : (-State.room.width / 2);
        const offZ = (this.roomOffset && typeof this.roomOffset.z === 'number') ? this.roomOffset.z : (-State.room.depth / 2);
        group.position.set(f.x + offX, f.elevation || 0, f.y + offZ);
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

// --- WALKTHROUGH MODE BRIDGE ---
const WalkthroughMode = {
    toggle(active) {
        const next = active !== undefined ? !!active : !Viewer3D.isWalkthrough;
        Viewer3D.setWalkthroughMode(next);
        return Viewer3D.isWalkthrough;
    },
    getPosition() {
        return Viewer3D.walkthroughPosition;
    },
    setPosition(pos) {
        Viewer3D.walkthroughPosition = pos;
    },
    getAngle() {
        return Viewer3D.walkthroughAngle;
    },
    setAngle(angle) {
        Viewer3D.walkthroughAngle = angle;
    }
};

// --- MATERIAL- & STÜCKLISTE (BOM) CALCULATOR (DIN 277 / WoFlV) ---
const BOMCalculator = {
    calculate(state = State) {
        const room = state.room || { width: 500, depth: 400, height: 250, pitches: {}, wallColors: {}, floorTexture: 'laminat_hell' };
        const elements = state.elements || [];
        const installations = state.installations || [];
        const furniture = state.furniture || [];

        const W = room.width || 500;
        const D = room.depth || 400;
        const H = room.height || 250;

        // 1. Geometry (DIN 277 / WoFlV)
        const floorAreaM2 = (W * D) / 10000;
        const perimeterM = (2 * (W + D)) / 100;
        const grossVolumeM3 = (W * D * H) / 1000000;

        // Pitch lost volume & sloped ceiling areas
        let pitchLostVolumeM3 = 0;
        let totalPitchSlopeAreaM2 = 0;
        let totalPitchRunFootprintM2 = 0;
        const pitches = room.pitches || {};

        ['top', 'right', 'bottom', 'left'].forEach(side => {
            const p = pitches[side];
            if (p && p.enabled) {
                const wallLen = (side === 'top' || side === 'bottom') ? W : D;
                const run = Math.min(wallLen, Math.max(0, p.run || 150));
                const kniestock = Math.min(H, Math.max(0, p.kniestock !== undefined ? p.kniestock : 80));
                const slopeHeight = Math.max(0, H - kniestock);
                
                const lostVol = 0.5 * (run / 100) * (slopeHeight / 100) * (wallLen / 100);
                pitchLostVolumeM3 += lostVol;

                const slopeHypotenuse = Math.sqrt(run * run + slopeHeight * slopeHeight);
                totalPitchSlopeAreaM2 += (wallLen * slopeHypotenuse) / 10000;
                totalPitchRunFootprintM2 += (wallLen * run) / 10000;
            }
        });

        const netVolumeM3 = Math.max(0, grossVolumeM3 - pitchLostVolumeM3);
        const flatCeilingAreaM2 = Math.max(0, floorAreaM2 - totalPitchRunFootprintM2);

        // Skylights cutouts
        let skylightCutoutsM2 = 0;
        elements.forEach(el => {
            if (el.type === 'skylight') {
                skylightCutoutsM2 += ((el.w || 80) * (el.h || 120)) / 10000;
            }
        });

        const totalCeilingAreaM2 = Math.max(0, flatCeilingAreaM2 + totalPitchSlopeAreaM2 - skylightCutoutsM2);

        // 2. Wall Surfaces
        const walls = [
            { key: 'top', name: 'Wand Nord (Oben)', len: W, colorKey: 'top' },
            { key: 'right', name: 'Wand Ost (Rechts)', len: D, colorKey: 'right' },
            { key: 'bottom', name: 'Wand Süd (Unten)', len: W, colorKey: 'bottom' },
            { key: 'left', name: 'Wand West (Links)', len: D, colorKey: 'left' }
        ];

        let grossWallAreaTotalM2 = 0;
        let cutoutsTotalM2 = 0;
        let netWallAreaTotalM2 = 0;

        const surfaceRows = [];

        // Floor row
        const floorTexName = (typeof TextureRegistry !== 'undefined' && TextureRegistry[room.floorTexture] && TextureRegistry[room.floorTexture].name)
            ? TextureRegistry[room.floorTexture].name
            : (room.floorTexture || 'Standard');
        surfaceRows.push({
            id: 'floor',
            name: 'Bodenfläche',
            type: 'floor',
            grossM2: floorAreaM2,
            cutoutM2: 0,
            netM2: floorAreaM2,
            material: floorTexName,
            color: '#e2e8f0'
        });

        // Ceiling row
        surfaceRows.push({
            id: 'ceiling',
            name: 'Deckenfläche (inkl. Schrägen)',
            type: 'ceiling',
            grossM2: flatCeilingAreaM2 + totalPitchSlopeAreaM2,
            cutoutM2: skylightCutoutsM2,
            netM2: totalCeilingAreaM2,
            material: 'Putz / Weiß',
            color: (room.wallColors && room.wallColors.ceiling) ? room.wallColors.ceiling : '#f5f4f0'
        });

        // Wall rows
        walls.forEach(w => {
            const pSelf = pitches[w.key];
            let grossW = 0;

            if (pSelf && pSelf.enabled) {
                const kniestock = Math.min(H, Math.max(0, pSelf.kniestock !== undefined ? pSelf.kniestock : 80));
                grossW = (w.len * kniestock) / 10000;
            } else {
                grossW = (w.len * H) / 10000;
                const adj1 = (w.key === 'top' || w.key === 'bottom') ? 'left' : 'top';
                const adj2 = (w.key === 'top' || w.key === 'bottom') ? 'right' : 'bottom';
                [adj1, adj2].forEach(adj => {
                    const pAdj = pitches[adj];
                    if (pAdj && pAdj.enabled) {
                        const run = Math.min(w.len, Math.max(0, pAdj.run || 150));
                        const kniestock = Math.min(H, Math.max(0, pAdj.kniestock !== undefined ? pAdj.kniestock : 80));
                        const lostTriangleM2 = (0.5 * run * (H - kniestock)) / 10000;
                        grossW = Math.max(0, grossW - lostTriangleM2);
                    }
                });
            }

            let wallCutouts = 0;
            elements.forEach(el => {
                if (el.wall === w.key && el.type !== 'skylight') {
                    wallCutouts += ((el.w || 0) * (el.h || 0)) / 10000;
                }
            });

            const netW = Math.max(0, grossW - wallCutouts);
            grossWallAreaTotalM2 += grossW;
            cutoutsTotalM2 += wallCutouts;
            netWallAreaTotalM2 += netW;

            surfaceRows.push({
                id: `wall_${w.key}`,
                name: w.name,
                type: 'wall',
                wallKey: w.key,
                grossM2: grossW,
                cutoutM2: wallCutouts,
                netM2: netW,
                material: 'Wandfarbe',
                color: (room.wallColors && room.wallColors[w.colorKey]) ? room.wallColors[w.colorKey] : '#f0eee9'
            });
        });

        // 3. Openings breakdown
        const openingNames = {
            'door': 'Zimmertür',
            'double-door': 'Doppeltür / Flügeltür',
            'window': 'Fenster',
            'skylight': 'Dachflächenfenster'
        };
        const wallsMap = { top: 'Nord (Oben)', right: 'Ost (Rechts)', bottom: 'Süd (Unten)', left: 'West (Links)' };

        const openingsRows = elements.map((el, idx) => {
            const cutoutArea = ((el.w || 0) * (el.h || 0)) / 10000;
            return {
                pos: idx + 1,
                id: el.id,
                type: el.type,
                name: openingNames[el.type] || el.type,
                wall: wallsMap[el.wall] || el.wall,
                wallKey: el.wall,
                widthCm: el.w,
                heightCm: el.h,
                positionCm: el.position,
                sillHeightCm: el.sillHeight || 0,
                areaM2: cutoutArea
            };
        });

        // 4. Installations breakdown
        const instNames = { socket: 'Steckdose', switch: 'Lichtschalter', lan: 'LAN-Dose', sat: 'SAT-Anschluss', power: 'Starkstrom' };
        const installationsRows = installations.map((inst, idx) => ({
            pos: idx + 1,
            id: inst.id,
            type: inst.type,
            name: instNames[inst.type] || inst.type,
            wall: wallsMap[inst.wall] || inst.wall,
            positionCm: inst.position,
            heightCm: inst.height || 30
        }));

        // 5. Furniture Inventory & Realistic Budget Guideline Prices (EUR)
        const guidelinePrices = {
            'doppelbett': 850,
            'bett': 850,
            'kleiderschrank': 680,
            'schrank': 680,
            'sofa': 1250,
            'couchtisch': 220,
            'couch': 1250,
            'esstisch': 490,
            'stuhl': 95,
            'schreibtisch': 340,
            'lounge-sessel': 420,
            'sessel': 420,
            'regal': 280,
            'raumteiler': 280,
            'tv-lowboard': 390,
            'lowboard': 390,
            'bogenleuchte': 180,
            'lampe': 180,
            'leuchte': 180,
            'zimmerpflanze': 65,
            'pflanze': 65,
            'nachttisch': 110,
            'teppich': 190,
            'fernseher': 650,
            'tv': 650
        };

        const guidelineKeys = Object.keys(guidelinePrices).sort((a, b) => b.length - a.length);

        const getUnitPrice = (item) => {
            const name = (item.name || '').toLowerCase();
            for (const key of guidelineKeys) {
                if (name.includes(key)) return guidelinePrices[key];
            }
            return 150;
        };

        const furnitureGroups = new Map();
        furniture.forEach(f => {
            const sig = `${f.name || 'Möbel'}|${f.w}|${f.l}|${f.h || 0}`;
            if (!furnitureGroups.has(sig)) {
                furnitureGroups.set(sig, {
                    name: f.name || 'Möbel',
                    shape: f.shape || 'rect',
                    w: f.w,
                    l: f.l,
                    h: (typeof f.h === 'number') ? f.h : ((typeof f.height === 'number') ? f.height : 0),
                    unitPrice: getUnitPrice(f),
                    count: 0,
                    category: f.isRug ? 'Textil' : (f.isLamp ? 'Beleuchtung' : (f.isPlant ? 'Deko' : 'Möbel'))
                });
            }
            furnitureGroups.get(sig).count++;
        });

        const furnitureRows = [];
        let totalFurnitureCost = 0;
        let posCounter = 1;

        furnitureGroups.forEach(grp => {
            const totalCost = grp.count * grp.unitPrice;
            totalFurnitureCost += totalCost;
            furnitureRows.push({
                pos: posCounter++,
                name: grp.name,
                category: grp.category,
                shape: grp.shape,
                w: grp.w,
                l: grp.l,
                h: grp.h,
                count: grp.count,
                unitPrice: grp.unitPrice,
                totalCost: totalCost
            });
        });

        return {
            geometry: {
                widthCm: W,
                depthCm: D,
                heightCm: H,
                floorAreaM2: Math.round(floorAreaM2 * 100) / 100,
                perimeterM: Math.round(perimeterM * 100) / 100,
                grossVolumeM3: Math.round(grossVolumeM3 * 100) / 100,
                netVolumeM3: Math.round(netVolumeM3 * 100) / 100
            },
            surfaces: surfaceRows.map(r => ({
                ...r,
                grossM2: Math.round(r.grossM2 * 100) / 100,
                cutoutM2: Math.round(r.cutoutM2 * 100) / 100,
                netM2: Math.round(r.netM2 * 100) / 100
            })),
            openings: openingsRows.map(r => ({
                ...r,
                areaM2: Math.round(r.areaM2 * 100) / 100
            })),
            installations: installationsRows,
            furniture: furnitureRows,
            totals: {
                floorAreaM2: Math.round(floorAreaM2 * 100) / 100,
                netWallAreaM2: Math.round(netWallAreaTotalM2 * 100) / 100,
                grossWallAreaM2: Math.round(grossWallAreaTotalM2 * 100) / 100,
                ceilingAreaM2: Math.round(totalCeilingAreaM2 * 100) / 100,
                openingsCutoutAreaM2: Math.round(cutoutsTotalM2 * 100) / 100,
                furnitureCount: furniture.length,
                totalFurnitureCost: totalFurnitureCost,
                installationsCount: installations.length,
                openingsCount: elements.length
            }
        };
    }
};

// --- HIGH-RES EXPORT & MATERIAL BOM EXPORT MANAGER ---
const ExportManager = {
    export2DHighResPNG() {
        if (typeof document === 'undefined') return;

        const canvas = document.createElement('canvas');
        canvas.width = 2400;
        canvas.height = 1800;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // 1. Slate Background
        ctx.fillStyle = '#0b0f19';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const H_head = 140;
        const H_foot = 70;

        // 2. Header Banner
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, canvas.width, H_head);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, H_head);
        ctx.lineTo(canvas.width, H_head);
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = '700 32px Inter, Outfit, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText('RoomCraft', 50, 40);

        ctx.fillStyle = '#94a3b8';
        ctx.font = '500 14px Inter, Outfit, sans-serif';
        ctx.fillText('ARCHITEKTUR-GRUNDRISS • MASSSTABSGERECHTE AUSFÜHRUNG (DIN 277)', 50, 82);

        const room = State.room;
        const floorArea = ((room.width * room.depth) / 10000).toFixed(2);
        const perimeter = (2 * (room.width + room.depth) / 100).toFixed(2);
        const chips = [
            `Raummaße: ${(room.width / 100).toFixed(2)} m × ${(room.depth / 100).toFixed(2)} m`,
            `Höhe: ${(room.height / 100).toFixed(2)} m`,
            `Grundfläche: ${floorArea} m²`,
            `Umfang: ${perimeter} m`
        ];

        let chipX = canvas.width - 50;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        chips.reverse().forEach(chip => {
            ctx.font = '600 13px Inter, sans-serif';
            const metrics = ctx.measureText(chip);
            const w = metrics.width + 24;
            const h = 32;
            const rx = chipX - w;
            const ry = 54;

            ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(rx, ry, w, h, 6);
            else ctx.rect(rx, ry, w, h);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#e2e8f0';
            ctx.fillText(chip, chipX - 12, ry + h / 2);
            chipX -= (w + 10);
        });

        // 3. Centered Plan Drawing Viewport
        const marginX = 120;
        const marginY = 90;
        const availW = canvas.width - 2 * marginX;
        const availH = canvas.height - H_head - H_foot - 2 * marginY;

        const totalWcm = room.width + 120;
        const totalDcm = room.depth + 120;
        const scale = Math.min(availW / totalWcm, availH / totalDcm);

        const originX = canvas.width / 2 - (room.width / 2) * scale;
        const originY = H_head + (canvas.height - H_head - H_foot) / 2 - (room.depth / 2) * scale;

        const prevSelected = State.selectedItem;
        State.selectedItem = null;

        ctx.save();
        ctx.translate(originX, originY);
        ctx.scale(scale, scale);

        if (State.settings.gridEnabled && Editor2D.drawGrid) {
            Editor2D.drawGrid(ctx);
        }
        if (Editor2D.drawRoofPitches) Editor2D.drawRoofPitches(ctx);
        if (Editor2D.drawWalls) Editor2D.drawWalls(ctx);
        if (Editor2D.drawWallElements) Editor2D.drawWallElements(ctx);
        if (Editor2D.drawInstallations) Editor2D.drawInstallations(ctx);
        if (Editor2D.drawFurniture) Editor2D.drawFurniture(ctx);
        if (Editor2D.drawCeilingLamps) Editor2D.drawCeilingLamps(ctx);
        if (Editor2D.drawDimensions) Editor2D.drawDimensions(ctx);

        ctx.restore();
        State.selectedItem = prevSelected;

        // 4. North Compass Rose
        const compassX = canvas.width - 90;
        const compassY = H_head + 60;
        ctx.save();
        ctx.translate(compassX, compassY);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, 22, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#06b6d4';
        ctx.beginPath();
        ctx.moveTo(0, -18);
        ctx.lineTo(6, 6);
        ctx.lineTo(0, 2);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.beginPath();
        ctx.moveTo(0, -18);
        ctx.lineTo(-6, 6);
        ctx.lineTo(0, 2);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.font = '700 10px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText('N', 0, -20);
        ctx.restore();

        // 5. Footer Bar with Scale Bar
        const footY = canvas.height - H_foot;
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, footY, canvas.width, H_foot);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, footY);
        ctx.lineTo(canvas.width, footY);
        ctx.stroke();

        const bar1m = 100 * scale;
        const bar2m = 200 * scale;
        const barX = 50;
        const barY = footY + 36;

        ctx.fillStyle = '#e2e8f0';
        ctx.fillRect(barX, barY - 4, bar1m, 4);
        ctx.fillStyle = '#475569';
        ctx.fillRect(barX + bar1m, barY - 4, bar1m, 4);

        ctx.font = '500 11px Inter, sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('0', barX, barY + 4);
        ctx.fillText('1m', barX + bar1m, barY + 4);
        ctx.fillText('2m', barX + bar2m, barY + 4);

        ctx.textAlign = 'left';
        ctx.font = '600 11px Inter, sans-serif';
        ctx.fillStyle = '#cbd5e1';
        ctx.fillText('MASSSTABSLEISTE', barX, barY - 18);

        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#94a3b8';
        ctx.font = '500 12px Inter, sans-serif';
        const dateStr = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        ctx.fillText(`Erstellt mit RoomCraft • ${dateStr} • ${State.furniture.length} Möbel • ${State.elements.length} Öffnungen`, canvas.width - 50, footY + H_foot / 2);

        // 6. Download Trigger
        const timestamp = Date.now();
        const filename = `roomcraft-2d-floorplan-${timestamp}.png`;
        if (canvas.toBlob) {
            canvas.toBlob(blob => {
                if (!blob) return;
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                a.click();
                URL.revokeObjectURL(url);
                showToast("2D High-Res Grundriss heruntergeladen!");
            }, 'image/png');
        } else {
            const a = document.createElement('a');
            a.href = canvas.toDataURL('image/png');
            a.download = filename;
            a.click();
            showToast("2D High-Res Grundriss heruntergeladen!");
        }
    },

    export3DHighResPNG() {
        if (typeof Viewer3D === 'undefined' || !Viewer3D || !Viewer3D.renderer || !Viewer3D.scene || !Viewer3D.camera) {
            alert("3D Ansicht ist noch nicht initialisiert!");
            return;
        }

        const prevSelected = State.selectedItem;
        State.selectedItem = null;

        try {
            Viewer3D.renderer.render(Viewer3D.scene, Viewer3D.camera);
            const dom = Viewer3D.renderer.domElement;
            const timestamp = Date.now();
            const filename = `roomcraft-3d-${timestamp}.png`;

            if (dom.toBlob) {
                dom.toBlob(blob => {
                    State.selectedItem = prevSelected;
                    if (!blob) return;
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = filename;
                    a.click();
                    URL.revokeObjectURL(url);
                    showToast("3D Rendering erfolgreich heruntergeladen!");
                }, 'image/png');
            } else {
                State.selectedItem = prevSelected;
                const a = document.createElement('a');
                a.href = dom.toDataURL('image/png');
                a.download = filename;
                a.click();
                showToast("3D Rendering erfolgreich heruntergeladen!");
            }
        } catch (err) {
            State.selectedItem = prevSelected;
            console.error("Export 3D Error:", err);
            alert("Fehler beim Exportieren des 3D-Renderings.");
        }
    },

    generateCSVContent(bom) {
        const lines = [];
        const escape = (val) => {
            const str = String(val === undefined || val === null ? '' : val);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        lines.push('--- RAUM-STAMMDATEN ---');
        lines.push(['Eigenschaft', 'Wert', 'Einheit'].map(escape).join(','));
        lines.push(['Raumbreite', bom.geometry.widthCm, 'cm'].map(escape).join(','));
        lines.push(['Raumlänge / Tiefe', bom.geometry.depthCm, 'cm'].map(escape).join(','));
        lines.push(['Raumhöhe', bom.geometry.heightCm, 'cm'].map(escape).join(','));
        lines.push(['Grundfläche (DIN 277)', bom.geometry.floorAreaM2, 'm²'].map(escape).join(','));
        lines.push(['Umfang', bom.geometry.perimeterM, 'm'].map(escape).join(','));
        lines.push(['Brutto-Rauminhalt', bom.geometry.grossVolumeM3, 'm³'].map(escape).join(','));
        lines.push(['Netto-Rauminhalt', bom.geometry.netVolumeM3, 'm³'].map(escape).join(','));
        lines.push('');

        lines.push('--- FLÄCHENBERECHNUNG (DIN 277) ---');
        lines.push(['Bereich', 'Typ', 'Brutto m²', 'Abzug m²', 'Netto m²', 'Material / Ausführung'].map(escape).join(','));
        bom.surfaces.forEach(s => {
            lines.push([s.name, s.type, s.grossM2, s.cutoutM2, s.netM2, s.material].map(escape).join(','));
        });
        lines.push(['SUMME WANDFLÄCHE (NETTO)', 'Summe', bom.totals.grossWallAreaM2, bom.totals.openingsCutoutAreaM2, bom.totals.netWallAreaM2, 'Putz / Anstrich'].map(escape).join(','));
        lines.push('');

        lines.push('--- ÖFFNUNGEN UND EINBAUTEN ---');
        lines.push(['Pos', 'Element', 'Wand', 'Breite cm', 'Höhe cm', 'Wandposition cm', 'Brüstung cm', 'Fläche m²'].map(escape).join(','));
        bom.openings.forEach(o => {
            lines.push([o.pos, o.name, o.wall, o.widthCm, o.heightCm, o.positionCm, o.sillHeightCm, o.areaM2].map(escape).join(','));
        });
        lines.push('');

        lines.push('--- ELEKTRO- & SANITÄRINSTALLATIONEN ---');
        lines.push(['Pos', 'Installation', 'Wand', 'Wandposition cm', 'Höhe cm'].map(escape).join(','));
        bom.installations.forEach(i => {
            lines.push([i.pos, i.name, i.wall, i.positionCm, i.heightCm].map(escape).join(','));
        });
        lines.push('');

        lines.push('--- MÖBEL-STÜCKLISTE & KOSTENRICHTWERTE ---');
        lines.push(['Pos', 'Bezeichnung', 'Kategorie', 'Maße BxTxH cm', 'Menge', 'Einzelpreis EUR', 'Gesamtpreis EUR'].map(escape).join(','));
        bom.furniture.forEach(f => {
            const dims = `${f.w} × ${f.l} × ${f.h}`;
            lines.push([f.pos, f.name, f.category, dims, f.count, `${f.unitPrice} €`, `${f.totalCost} €`].map(escape).join(','));
        });
        lines.push(['GESAMTBUDGET MÖBEL', '', '', '', bom.totals.furnitureCount, '', `${bom.totals.totalFurnitureCost} €`].map(escape).join(','));

        return '\uFEFF' + lines.join('\r\n');
    },

    exportBOMCSV() {
        const bom = BOMCalculator.calculate(State);
        const csv = this.generateCSVContent(bom);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `roomcraft-stueckliste-${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        showToast("Material- und Stückliste (CSV) heruntergeladen!");
    },

    exportBOMJSON() {
        const bom = BOMCalculator.calculate(State);
        const jsonStr = JSON.stringify(bom, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `roomcraft-bom-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast("BOM als JSON heruntergeladen!");
    },

    copyBOMToClipboard() {
        const bom = BOMCalculator.calculate(State);
        let text = `RoomCraft Material- & Stückliste (BOM)\n`;
        text += `Raum: ${(bom.geometry.widthCm/100).toFixed(2)}m × ${(bom.geometry.depthCm/100).toFixed(2)}m • Fläche: ${bom.geometry.floorAreaM2} m² • Netto-Wand: ${bom.totals.netWallAreaM2} m²\n\n`;
        text += `MÖBEL:\nPos\tBezeichnung\tKategorie\tMaße (BxTxH)\tMenge\tEinzelpreis\tGesamtpreis\n`;
        bom.furniture.forEach(f => {
            text += `${f.pos}\t${f.name}\t${f.category}\t${f.w}x${f.l}x${f.h} cm\t${f.count}\t${f.unitPrice} €\t${f.totalCost} €\n`;
        });
        text += `\nGesamtbudget Möbel: ${bom.totals.totalFurnitureCost} € (${bom.totals.furnitureCount} Teile)\n`;

        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                showToast("Stückliste in Zwischenablage kopiert!");
            }).catch(() => {
                this.fallbackCopyToClipboard(text);
            });
        } else {
            this.fallbackCopyToClipboard(text);
        }
    },

    fallbackCopyToClipboard(text) {
        if (typeof document === 'undefined') return;
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try {
            document.execCommand('copy');
            showToast("Stückliste in Zwischenablage kopiert!");
        } catch (e) {
            alert("Kopieren nicht unterstützt.");
        }
        document.body.removeChild(ta);
    },

    printBOM() {
        if (typeof window !== 'undefined' && window.print) {
            window.print();
        }
    }
};

// --- MATERIAL- & STÜCKLISTE (BOM) MODAL CONTROLLER ---
const BOMDialog = {
    modal: null,

    init() {
        if (typeof document === 'undefined') return;
        this.modal = document.getElementById('bom-modal');
        if (!this.modal) return;

        const btnClose = document.getElementById('btn-close-bom');
        if (btnClose) btnClose.addEventListener('click', () => this.close());

        this.modal.addEventListener('click', (e) => {
            if (this.modal.getBoundingClientRect) {
                const rect = this.modal.getBoundingClientRect();
                if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
                    this.close();
                }
            }
        });

        const tabBtns = this.modal.querySelectorAll('.bom-tab-btn');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                tabBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const targetPanelId = btn.dataset.bomTab;
                this.modal.querySelectorAll('.bom-panel').forEach(panel => {
                    if (panel.id === targetPanelId) panel.classList.add('active');
                    else panel.classList.remove('active');
                });
            });
        });

        const btnCopy = document.getElementById('btn-bom-copy');
        if (btnCopy) btnCopy.addEventListener('click', () => ExportManager.copyBOMToClipboard());

        const btnPrint = document.getElementById('btn-bom-print');
        if (btnPrint) btnPrint.addEventListener('click', () => ExportManager.printBOM());

        const btnDownloadJson = document.getElementById('btn-bom-download-json');
        if (btnDownloadJson) btnDownloadJson.addEventListener('click', () => ExportManager.exportBOMJSON());

        const btnDownloadCsv = document.getElementById('btn-bom-download-csv');
        if (btnDownloadCsv) btnDownloadCsv.addEventListener('click', () => ExportManager.exportBOMCSV());
    },

    open() {
        if (!this.modal && typeof document !== 'undefined') {
            this.modal = document.getElementById('bom-modal');
        }
        if (!this.modal) return;

        const bom = BOMCalculator.calculate(State);

        const elArea = document.getElementById('bom-kpi-area');
        if (elArea) elArea.textContent = `${bom.geometry.floorAreaM2.toFixed(2)} m²`;

        const elDims = document.getElementById('bom-kpi-dims');
        if (elDims) elDims.textContent = `${(bom.geometry.widthCm / 100).toFixed(2)} × ${(bom.geometry.depthCm / 100).toFixed(2)} m (H: ${(bom.geometry.heightCm / 100).toFixed(2)} m)`;

        const elWalls = document.getElementById('bom-kpi-walls');
        if (elWalls) elWalls.textContent = `${bom.totals.netWallAreaM2.toFixed(2)} m²`;

        const elWallCutouts = document.getElementById('bom-kpi-wall-cutouts');
        if (elWallCutouts) elWallCutouts.textContent = `Abzüge: ${bom.totals.openingsCutoutAreaM2.toFixed(2)} m²`;

        const elCeiling = document.getElementById('bom-kpi-ceiling');
        if (elCeiling) elCeiling.textContent = `${bom.totals.ceilingAreaM2.toFixed(2)} m²`;

        const elPitches = document.getElementById('bom-kpi-pitches');
        const pitchCount = Object.values(State.room.pitches || {}).filter(p => p && p.enabled).length;
        if (elPitches) elPitches.textContent = pitchCount > 0 ? `${pitchCount} Dachschräge(n)` : 'Keine Schrägen';

        const elFurnitureCost = document.getElementById('bom-kpi-furniture-cost');
        if (elFurnitureCost) elFurnitureCost.textContent = `${bom.totals.totalFurnitureCost.toLocaleString('de-DE')} €`;

        const elFurnitureCount = document.getElementById('bom-kpi-furniture-count');
        if (elFurnitureCount) elFurnitureCount.textContent = `${bom.totals.furnitureCount} Möbel-Objekt(e)`;

        const elSummary = document.getElementById('bom-overview-summary');
        if (elSummary) {
            elSummary.innerHTML = `
                <table class="bom-table">
                    <thead>
                        <tr><th>Parameter</th><th>Wert</th><th>Beschreibung</th></tr>
                    </thead>
                    <tbody>
                        <tr><td>Raummaße (B × T × H)</td><td>${bom.geometry.widthCm} × ${bom.geometry.depthCm} × ${bom.geometry.heightCm} cm</td><td>Lichte Innenmaße Rohbau/Putz</td></tr>
                        <tr><td>Brutto-Grundfläche</td><td>${bom.geometry.floorAreaM2} m²</td><td>Nutzbare Bodenfläche nach DIN 277</td></tr>
                        <tr><td>Raum-Umfang</td><td>${bom.geometry.perimeterM} m</td><td>Sockelleisten-Gesamtlänge (abzgl. Türen)</td></tr>
                        <tr><td>Rauminhalt (Brutto)</td><td>${bom.geometry.grossVolumeM3} m³</td><td>Volumen ohne Schrägenabzug</td></tr>
                        <tr><td>Rauminhalt (Netto)</td><td>${bom.geometry.netVolumeM3} m³</td><td>Bereinigt um Dachschrägenvolumen</td></tr>
                        <tr><td>Netto-Wandfläche</td><td>${bom.totals.netWallAreaM2} m²</td><td>Verputz-/Anstrichfläche nach Abzug aller Öffnungen</td></tr>
                        <tr><td>Ausstattung & Möbel</td><td>${bom.totals.furnitureCount} Objekte</td><td>Gesamtbudget Richtwert: ${bom.totals.totalFurnitureCost.toLocaleString('de-DE')} €</td></tr>
                    </tbody>
                </table>
            `;
        }

        const elSurfaces = document.getElementById('bom-surfaces-table-wrap');
        if (elSurfaces) {
            let html = `
                <table class="bom-table">
                    <thead>
                        <tr><th>Bereich</th><th>Brutto m²</th><th>Abzug Öffnungen</th><th>Netto m²</th><th>Material / Textur</th></tr>
                    </thead>
                    <tbody>
            `;
            bom.surfaces.forEach(s => {
                html += `<tr>
                    <td><strong>${s.name}</strong></td>
                    <td>${s.grossM2.toFixed(2)} m²</td>
                    <td>${s.cutoutM2 > 0 ? s.cutoutM2.toFixed(2) + ' m²' : '—'}</td>
                    <td><strong style="color: #38bdf8;">${s.netM2.toFixed(2)} m²</strong></td>
                    <td>${s.material}</td>
                </tr>`;
            });
            html += `</tbody></table>`;
            elSurfaces.innerHTML = html;
        }

        const elOpenings = document.getElementById('bom-openings-table-wrap');
        if (elOpenings) {
            if (bom.openings.length === 0) {
                elOpenings.innerHTML = `<div style="padding: 14px; color: #94a3b8; font-size: 13px;">Keine Wandöffnungen (Türen / Fenster) im Raum vorhanden.</div>`;
            } else {
                let html = `
                    <table class="bom-table">
                        <thead>
                            <tr><th>Pos</th><th>Element</th><th>Wand</th><th>Breite × Höhe</th><th>Position</th><th>Fläche</th></tr>
                        </thead>
                        <tbody>
                `;
                bom.openings.forEach(o => {
                    html += `<tr>
                        <td>${o.pos}</td>
                        <td><strong>${o.name}</strong></td>
                        <td>${o.wall}</td>
                        <td>${o.widthCm} × ${o.heightCm} cm</td>
                        <td>${o.positionCm} cm</td>
                        <td>${o.areaM2.toFixed(2)} m²</td>
                    </tr>`;
                });
                html += `</tbody></table>`;
                elOpenings.innerHTML = html;
            }
        }

        const elInst = document.getElementById('bom-installations-table-wrap');
        if (elInst) {
            if (bom.installations.length === 0) {
                elInst.innerHTML = `<div style="padding: 14px; color: #94a3b8; font-size: 13px;">Keine Anschlüsse (Steckdosen / Schalter) platziert.</div>`;
            } else {
                let html = `
                    <table class="bom-table">
                        <thead>
                            <tr><th>Pos</th><th>Typ</th><th>Wand</th><th>Position</th><th>Höhe ab Boden</th></tr>
                        </thead>
                        <tbody>
                `;
                bom.installations.forEach(i => {
                    html += `<tr>
                        <td>${i.pos}</td>
                        <td><strong>${i.name}</strong></td>
                        <td>${i.wall}</td>
                        <td>${i.positionCm} cm</td>
                        <td>${i.heightCm} cm</td>
                    </tr>`;
                });
                html += `</tbody></table>`;
                elInst.innerHTML = html;
            }
        }

        const elFurn = document.getElementById('bom-furniture-table-wrap');
        if (elFurn) {
            if (bom.furniture.length === 0) {
                elFurn.innerHTML = `<div style="padding: 14px; color: #94a3b8; font-size: 13px;">Keine Möbelstücke platziert.</div>`;
            } else {
                let html = `
                    <table class="bom-table">
                        <thead>
                            <tr><th>Pos</th><th>Bezeichnung</th><th>Kategorie</th><th>Maße (B × T × H)</th><th>Menge</th><th>Einzelpreis</th><th>Gesamtpreis</th></tr>
                        </thead>
                        <tbody>
                `;
                bom.furniture.forEach(f => {
                    html += `<tr>
                        <td>${f.pos}</td>
                        <td><strong>${f.name}</strong></td>
                        <td><span style="font-size: 11px; padding: 2px 6px; background: rgba(255,255,255,0.06); border-radius: 4px;">${f.category}</span></td>
                        <td>${f.w} × ${f.l} × ${f.h} cm</td>
                        <td>${f.count}×</td>
                        <td>${f.unitPrice.toLocaleString('de-DE')} €</td>
                        <td><strong>${f.totalCost.toLocaleString('de-DE')} €</strong></td>
                    </tr>`;
                });
                html += `
                    <tr style="background: rgba(139, 92, 246, 0.08); font-weight: 600;">
                        <td colspan="4">GESAMTSUMME AUSSTATTUNG</td>
                        <td>${bom.totals.furnitureCount} Teile</td>
                        <td>—</td>
                        <td style="color: #a78bfa; font-size: 14px;">${bom.totals.totalFurnitureCost.toLocaleString('de-DE')} €</td>
                    </tr>
                </tbody></table>`;
                elFurn.innerHTML = html;
            }
        }

        const elStatus = document.getElementById('bom-footer-status');
        if (elStatus) {
            elStatus.textContent = `${bom.furniture.length} Möbelpositionen • ${bom.openings.length} Öffnungen • ${bom.installations.length} Anschlüsse`;
        }

        if (typeof lucide !== 'undefined' && lucide.createIcons) {
            lucide.createIcons();
        }

        if (typeof this.modal.showModal === 'function') {
            this.modal.showModal();
        } else {
            this.modal.setAttribute('open', '');
        }
    },

    close() {
        if (!this.modal) return;
        if (typeof this.modal.close === 'function') {
            this.modal.close();
        } else {
            this.modal.removeAttribute('open');
        }
    }
};

// --- PRESENTS & INITIAL DATA ---
const Presets = {
    bed: { name: 'Doppelbett', shape: 'rect', w: 180, l: 200, h: 60, color: 'hsl(215, 60%, 45%)', collisionEnabled: true, category: 'bedroom' },
    wardrobe: { name: 'Kleiderschrank', shape: 'rect', w: 150, l: 60, h: 210, color: 'hsl(33, 50%, 30%)', collisionEnabled: true, category: 'bedroom' },
    desk: { name: 'Schreibtisch', shape: 'rect', w: 140, l: 80, h: 76, color: 'hsl(180, 50%, 35%)', collisionEnabled: true, category: 'office' },
    chair: { name: 'Stuhl', shape: 'rect', w: 45, l: 45, h: 85, color: 'hsl(20, 70%, 40%)', collisionEnabled: true, category: 'dining office' },
    sofa: { name: 'Sofa', shape: 'rect', w: 210, l: 95, h: 80, color: 'hsl(263, 40%, 45%)', collisionEnabled: true, category: 'living' },
    table: { name: 'Esstisch', shape: 'rect', w: 160, l: 90, h: 76, color: 'hsl(35, 45%, 40%)', collisionEnabled: true, category: 'dining' },
    'custom-rect': { name: 'Eckiges Custom', shape: 'rect', w: 80, l: 80, h: 80, color: 'hsl(142, 60%, 40%)', collisionEnabled: true, category: 'all' },
    'round-table': { name: 'Runder Tisch', shape: 'circle', w: 100, l: 100, h: 75, color: 'hsl(35, 45%, 40%)', collisionEnabled: true, isTable: true, category: 'dining living' },
    'custom-circle': { name: 'Rundes Custom', shape: 'circle', w: 80, l: 80, h: 80, color: 'hsl(160, 60%, 40%)', collisionEnabled: true, category: 'all' },
    chimney: { name: 'Schornstein / Pfeiler', shape: 'rect', w: 40, l: 40, h: 250, color: 'hsl(215, 12%, 40%)', collisionEnabled: true, isObstacle: true, category: 'all' },
    tv: { name: 'Fernseher (TV)', shape: 'rect', w: 122, l: 15, h: 78.5, color: 'hsl(0, 0%, 15%)', collisionEnabled: true, tvSize: 55, elevation: 76, category: 'living' },
    'rug-rect': { name: 'Teppich (eckig)', shape: 'rect', w: 200, l: 150, h: 2, color: 'hsl(215, 25%, 60%)', color3d: '#334155', collisionEnabled: true, isRug: true, rugTexture: 'flach', textureScale: 1.0, category: 'decor living' },
    'rug-circle': { name: 'Teppich (rund)', shape: 'circle', w: 160, l: 160, h: 2, color: 'hsl(30, 25%, 70%)', color3d: '#fefae0', collisionEnabled: true, isRug: true, rugTexture: 'hochflor', textureScale: 1.0, category: 'decor living' },
    
    // --- 7 NEW MODERN DESIGNER FURNITURE PRESETS (Milestone 3 / Requirement R3) ---
    'lounge-chair': {
        name: 'Lounge-Sessel',
        shape: 'rect',
        w: 80,
        l: 85,
        h: 78,
        color: 'hsl(36, 32%, 48%)',
        color3d: '#c8b6a6',
        category: 'living',
        categoryLabel: 'Wohnen',
        collisionEnabled: true
    },
    'bookshelf': {
        name: 'Regal / Raumteiler',
        shape: 'rect',
        w: 120,
        l: 38,
        h: 160,
        color: 'hsl(28, 45%, 38%)',
        color3d: '#a27b5c',
        category: 'living office',
        categoryLabel: 'Wohnen / Büro',
        collisionEnabled: true
    },
    'coffee-table-set': {
        name: 'Couchtisch-Set',
        shape: 'rect',
        w: 100,
        l: 65,
        h: 42,
        color: 'hsl(38, 28%, 52%)',
        color3d: '#e5ded6',
        category: 'living',
        categoryLabel: 'Wohnen',
        collisionEnabled: true,
        isTable: true
    },
    'tv-lowboard': {
        name: 'TV-Lowboard',
        shape: 'rect',
        w: 180,
        l: 45,
        h: 45,
        color: 'hsl(30, 35%, 28%)',
        color3d: '#3d2817',
        category: 'living',
        categoryLabel: 'Wohnen',
        collisionEnabled: true
    },
    'arc-lamp': {
        name: 'Bogenleuchte',
        shape: 'rect',
        w: 45,
        l: 160,
        h: 210,
        color: 'hsl(45, 60%, 55%)',
        color3d: '#d4af37',
        category: 'decor living',
        categoryLabel: 'Deko & Licht',
        collisionEnabled: true,
        isLamp: true,
        lightColor: 0xffeedd,
        lightIntensity: 10000,
        lightDistance: 450
    },
    'plant': {
        name: 'Zimmerpflanze',
        shape: 'circle',
        w: 55,
        l: 55,
        h: 135,
        color: 'hsl(142, 50%, 35%)',
        color3d: '#2d6a4f',
        category: 'decor living',
        categoryLabel: 'Deko & Licht',
        collisionEnabled: true,
        isPlant: true
    },
    'nightstand': {
        name: 'Nachttisch',
        shape: 'rect',
        w: 48,
        l: 40,
        h: 52,
        color: 'hsl(33, 40%, 40%)',
        color3d: '#8b5a2b',
        category: 'bedroom living',
        categoryLabel: 'Schlafen',
        collisionEnabled: true,
        isNightstand: true
    }
};

function loadExampleRoom() {
    selectItem(null, null);
    
    // Set Room Maße
    State.room.width = 500;
    State.room.depth = 400;
    State.room.height = 250;
    
    State.room.wallColors = {
        top: '#f0eee9',
        right: '#f0eee9',
        bottom: '#f0eee9',
        left: '#f0eee9',
        pitch: '#f0eee9',
        ceiling: '#f5f4f0'
    };
    State.room.floorTexture = 'laminat_hell'; State.room.floorScale = 1.0;
    
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
    History.pushState();
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
    
    // Clamp placed furniture to room boundaries
    State.furniture.forEach(f => CollisionEngine.clampFurnitureToRoom(f, State.room));
    
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
    const prevItem = State.selectedItem;
    const prevType = State.selectedItemType;
    
    State.selectedItem = item;
    State.selectedItemType = type;
    
    const panel = document.getElementById('properties-panel');
    if (panel) {
        if (item) {
            panel.classList.add('active');
            buildPropertiesPanelContent();
        } else {
            panel.classList.remove('active');
        }
    }
    
    // Draw canvas selection borders
    Editor2D.draw();
    
    // Re-draw in 3D
    if (Viewer3D.renderer) {
        // Strip selection indicator from previously selected furniture
        if (prevItem && prevItem !== item && prevType === 'furniture' && State.furniture && State.furniture.includes(prevItem)) {
            Viewer3D.updateFurniture3D(prevItem);
        }
        
        if (type === 'furniture' && item) {
            Viewer3D.updateFurniture3D(item);
        } else if (type === 'element' || prevType === 'element') {
            Viewer3D.rebuildWalls3D();
        } else if (type === 'installation' || prevType === 'installation') {
            Viewer3D.updateInstallations3D();
        }
    }
}

function showPropertiesTab() {
    const panel = document.getElementById('properties-panel');
    if (panel) panel.classList.add('active');
}

function hslToHex(h, s, l) {
    l /= 100;
    const a = s * Math.min(l, 1 - l) / 100;
    const f = n => {
        const k = (n + h / 30) % 12;
        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}

function parseColorToHex(c) {
    if (!c) return '#3b82f6';
    if (c.startsWith('#')) return c;
    const match = c.match(/hsl\(\s*(\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%\s*\)/);
    if (match) {
        const h = parseInt(match[1]);
        const s = parseInt(match[2]);
        const l = parseInt(match[3]);
        return hslToHex(h, s, l);
    }
    return '#3b82f6';
}

function buildPropertiesPanelContent() {
    const item = State.selectedItem;
    const type = State.selectedItemType;
    const container = document.getElementById('properties-content');
    
    if (!item || !container) return;
    
    const colors = [
        'hsl(215, 60%, 45%)', // Blue
        'hsl(33, 50%, 30%)',  // Brown
        'hsl(180, 50%, 35%)', // Teal
        'hsl(20, 70%, 40%)',  // Red-orange
        'hsl(263, 40%, 45%)', // Purple
        'hsl(35, 45%, 40%)',  // Wood
        'hsl(142, 60%, 40%)', // Green
        'hsl(0, 0%, 25%)',    // Charcoal
        'hsl(0, 0%, 90%)'     // White
    ];
    
    let html = '';
    const lockedAttr = item.locked ? 'disabled' : '';
    
    if (type === 'furniture') {
        html = `
            <div class="prop-grid">
                <div class="prop-field prop-span-2">
                    <label>Name</label>
                    <input type="text" id="prop-name" value="${item.name}" ${lockedAttr}>
                </div>
                <div class="prop-field">
                    <label>Breite (cm)</label>
                    <input type="number" id="prop-w" value="${item.w}" min="10" max="500" step="0.1" ${lockedAttr}>
                </div>
                <div class="prop-field">
                    <label>Länge / Tiefe (cm)</label>
                    <input type="number" id="prop-l" value="${item.l}" min="10" max="500" step="0.1" ${item.shape === 'circle' ? 'disabled' : lockedAttr}>
                </div>
                <div class="prop-field">
                    <label>Höhe (cm)</label>
                    <input type="number" id="prop-h" value="${item.isObstacle ? formatDim(getCeilingHeightAt(item.x, item.y)) : item.h}" min="10" max="350" step="0.1" ${item.isObstacle ? 'disabled' : lockedAttr}>
                </div>
                <div class="prop-field">
                    <label>Rotation (Grad)</label>
                    <input type="number" id="prop-rot" value="${item.rotation}" min="0" max="359" step="0.1" ${lockedAttr}>
                </div>
                <div class="prop-field">
                    <label>Höhe über Boden (cm)</label>
                    <input type="number" id="prop-elevation" value="${item.elevation || 0}" min="0" max="300" step="0.1" ${lockedAttr}>
                </div>
                ${item.tvSize !== null && item.tvSize !== undefined ? `
                <div class="prop-field">
                    <label>Größe (Zoll)</label>
                    <input type="number" id="prop-tv-size" value="${item.tvSize}" min="10" max="150" step="1" ${lockedAttr}>
                </div>
                ` : ''}
                <div class="prop-field prop-span-2">
                    <label>Farbe (2D-Ansicht)</label>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <div class="color-palette color-palette-2d" style="${item.locked ? 'pointer-events: none; opacity: 0.5;' : ''}">
                            ${colors.map(c => `
                                <div class="color-dot color-dot-2d ${item.color === c ? 'active' : ''}" 
                                     style="background-color: ${c}" 
                                     data-color="${c}">
                                </div>
                            `).join('')}
                        </div>
                        <input type="color" id="prop-color-2d-custom" value="${parseColorToHex(item.color)}" style="width: 32px; height: 32px; border: 1px solid var(--border-color); border-radius: 6px; cursor: pointer; padding: 0; background: transparent;" ${lockedAttr}>
                    </div>
                </div>
                <div class="prop-field prop-span-2">
                    <label>Farbe (3D-Ansicht)</label>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <div class="color-palette color-palette-3d" style="${item.locked ? 'pointer-events: none; opacity: 0.5;' : ''}">
                            ${colors.map(c => `
                                <div class="color-dot color-dot-3d ${(item.color3d || item.color) === c ? 'active' : ''}" 
                                     style="background-color: ${c}" 
                                     data-color="${c}">
                                </div>
                            `).join('')}
                        </div>
                        <input type="color" id="prop-color-3d-custom" value="${parseColorToHex(item.color3d || item.color)}" style="width: 32px; height: 32px; border: 1px solid var(--border-color); border-radius: 6px; cursor: pointer; padding: 0; background: transparent;" ${lockedAttr}>
                    </div>
                </div>
                ${item.isRug ? `
                <div class="prop-field prop-span-2">
                    <label>Teppich-Textur</label>
                    <select id="prop-rug-texture" ${lockedAttr}>
                        <option value="flach" ${(!item.rugTexture || item.rugTexture === 'flach' || item.rugTexture === 'flat') ? 'selected' : ''}>Flachgewebe / Schlinge</option>
                        <option value="hochflor" ${(item.rugTexture === 'hochflor' || item.rugTexture === 'shaggy') ? 'selected' : ''}>Hochflor / Shaggy</option>
                    </select>
                </div>
                <div class="prop-field prop-span-2">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                        <label for="prop-rug-scale">Textur-Skalierung</label>
                        <span id="prop-rug-scale-val" style="font-size: 11px; color: var(--primary-light, #a78bfa); font-weight: 600;">${Math.round((item.textureScale || 1.0) * 100)}%</span>
                    </div>
                    <input type="range" id="prop-rug-scale" min="30" max="300" value="${Math.round((item.textureScale || 1.0) * 100)}" step="5" ${lockedAttr}>
                </div>
                ` : ''}
                <div class="prop-field prop-span-2" style="margin-top: 4px;">
                    <label class="checkbox-container">
                        <input type="checkbox" id="prop-col" ${item.collisionEnabled ? 'checked' : ''} ${lockedAttr}>
                        <span class="checkmark"></span>
                        <span>Kollisionsprüfung aktiv</span>
                    </label>
                </div>
                <div class="prop-field prop-span-2" style="margin-top: 4px;">
                    <label class="checkbox-container">
                        <input type="checkbox" id="prop-locked" ${item.locked ? 'checked' : ''}>
                        <span class="checkmark"></span>
                        <span>🔒 Position sperren</span>
                    </label>
                </div>
                ${item.isObstacle ? (() => {
                    const closest = getClosestWall(item);
                    const wallNamesMap = { top: 'Nord', right: 'Ost', bottom: 'Süd', left: 'West' };
                    const wallName = wallNamesMap[closest.wall];
                    const edgeDist = Math.max(0, formatDim(closest.distance));
                    return `
                        <div class="prop-field prop-span-2">
                            <label>Abstand zur Wand ${wallName} (cm)</label>
                            <input type="number" id="prop-wall-dist" value="${edgeDist}" min="0" step="0.1" ${lockedAttr}>
                        </div>
                    `;
                })() : ''}
            </div>
            
            <div class="prop-actions">
                <button class="btn btn-secondary" id="prop-btn-duplicate" ${lockedAttr}>
                    <i data-lucide="copy"></i> Duplizieren
                </button>
                <button class="btn btn-danger" id="prop-btn-delete" ${lockedAttr}>
                    <i data-lucide="trash-2"></i> Löschen
                </button>
            </div>
        `;
    } else if (type === 'element') {
        const isSkylight = item.type === 'skylight';
        const maxPos = (item.wall === 'top' || item.wall === 'bottom') ? State.room.width : State.room.depth;
        html = `
            <div class="prop-grid">
                <div class="prop-field prop-span-2">
                    <label>Typ</label>
                    <input type="text" value="${item.type === 'door' ? (item.isBalcony ? 'Balkontür' : 'Tür') : item.type === 'double-door' ? (item.isBalcony ? 'Doppelbalkontür' : 'Doppeltür') : item.type === 'window' ? 'Fenster' : 'Dachfenster'}" disabled>
                </div>
                <div class="prop-field">
                    <label>Breite (cm)</label>
                    <input type="number" id="prop-w" value="${item.w}" min="30" max="300" step="0.1" ${lockedAttr}>
                </div>
                <div class="prop-field">
                    <label>${isSkylight ? 'Länge' : 'Höhe'} (cm)</label>
                    <input type="number" id="prop-h" value="${item.h}" min="30" max="300" step="0.1" ${lockedAttr}>
                </div>
                <div class="prop-field prop-span-2">
                    <label>Wand</label>
                    <select id="prop-wall" ${lockedAttr}>
                        <option value="top" ${item.wall === 'top' ? 'selected' : ''}>Oben (Nord)</option>
                        <option value="right" ${item.wall === 'right' ? 'selected' : ''}>Rechts (Ost)</option>
                        <option value="bottom" ${item.wall === 'bottom' ? 'selected' : ''}>Unten (Süd)</option>
                        <option value="left" ${item.wall === 'left' ? 'selected' : ''}>Links (West)</option>
                    </select>
                </div>
                <div class="prop-field">
                    <label>Abstand Links (cm)</label>
                    <input type="number" id="prop-dist-left" value="${formatDim(item.position - item.w/2)}" min="0" step="0.1" ${lockedAttr}>
                </div>
                <div class="prop-field">
                    <label>Abstand Rechts (cm)</label>
                    <input type="number" id="prop-dist-right" value="${formatDim(maxPos - (item.position + item.w/2))}" min="0" step="0.1" ${lockedAttr}>
                </div>
                
                ${isSkylight ? `
                    <div class="prop-field">
                        <label>Wandabstand (cm)</label>
                        <input type="number" id="prop-dist" value="${item.distanceFromWall !== undefined ? item.distanceFromWall : 60}" min="0" max="300" step="0.1" ${lockedAttr}>
                    </div>
                ` : item.type === 'window' ? `
                    <div class="prop-field">
                        <label>Brüstungshöhe (cm)</label>
                        <input type="number" id="prop-sill" value="${item.sillHeight || 90}" min="0" max="200" step="0.1" ${lockedAttr}>
                    </div>
                ` : (item.type === 'door' || item.type === 'double-door') ? `
                    ${item.type === 'door' ? `
                        <div class="prop-field">
                            <label>Anschlag</label>
                            <select id="prop-hinge" ${lockedAttr}>
                                <option value="left" ${item.hinge === 'left' ? 'selected' : ''}>Links (Standard)</option>
                                <option value="right" ${item.hinge === 'right' ? 'selected' : ''}>Rechts</option>
                            </select>
                        </div>
                    ` : ''}
                    <div class="prop-field">
                        <label>Öffnungsrichtung</label>
                        <select id="prop-dir" ${lockedAttr}>
                            <option value="in" ${item.direction === 'in' ? 'selected' : ''}>Nach Innen</option>
                            <option value="out" ${item.direction === 'out' ? 'selected' : ''}>Nach Außen</option>
                        </select>
                    </div>
                ` : ''}
                ${(item.type === 'door' || item.type === 'double-door') ? `
                <div class="prop-field prop-span-2">
                    <label>Farbe (2D-Ansicht)</label>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <div class="color-palette color-palette-2d" style="${item.locked ? 'pointer-events: none; opacity: 0.5;' : ''}">
                            ${colors.map(c => `
                                <div class="color-dot color-dot-2d ${(item.color || (item.isBalcony ? 'hsl(0, 0%, 90%)' : 'hsl(33, 40%, 35%)')) === c ? 'active' : ''}" 
                                     style="background-color: ${c}" 
                                     data-color="${c}">
                                </div>
                            `).join('')}
                        </div>
                        <input type="color" id="prop-color-2d-custom" value="${parseColorToHex(item.color || (item.isBalcony ? 'hsl(0, 0%, 90%)' : 'hsl(33, 40%, 35%)'))}" style="width: 32px; height: 32px; border: 1px solid var(--border-color); border-radius: 6px; cursor: pointer; padding: 0; background: transparent;" ${lockedAttr}>
                    </div>
                </div>
                <div class="prop-field prop-span-2">
                    <label>Farbe (3D-Ansicht)</label>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <div class="color-palette color-palette-3d" style="${item.locked ? 'pointer-events: none; opacity: 0.5;' : ''}">
                            ${colors.map(c => `
                                <div class="color-dot color-dot-3d ${(item.color3d || item.color || (item.isBalcony ? 'hsl(0, 0%, 90%)' : 'hsl(33, 40%, 35%)')) === c ? 'active' : ''}" 
                                     style="background-color: ${c}" 
                                     data-color="${c}">
                                </div>
                            `).join('')}
                        </div>
                        <input type="color" id="prop-color-3d-custom" value="${parseColorToHex(item.color3d || item.color || (item.isBalcony ? 'hsl(0, 0%, 90%)' : 'hsl(33, 40%, 35%)'))}" style="width: 32px; height: 32px; border: 1px solid var(--border-color); border-radius: 6px; cursor: pointer; padding: 0; background: transparent;" ${lockedAttr}>
                    </div>
                </div>
                ` : ''}
                <div class="prop-field prop-span-2" style="margin-top: 4px;">
                    <label class="checkbox-container">
                        <input type="checkbox" id="prop-locked" ${item.locked ? 'checked' : ''}>
                        <span class="checkmark"></span>
                        <span>🔒 Position sperren</span>
                    </label>
                </div>
            </div>
            
            <div class="prop-actions">
                <button class="btn btn-danger" id="prop-btn-delete" style="flex:1" ${lockedAttr}>
                    <i data-lucide="trash-2"></i> Löschen
                </button>
            </div>
        `;
    } else if (type === 'installation') {
        const maxPos = (item.wall === 'top' || item.wall === 'bottom') ? State.room.width : State.room.depth;
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
                    <select id="prop-wall" ${lockedAttr}>
                        <option value="top" ${item.wall === 'top' ? 'selected' : ''}>Oben (Nord)</option>
                        <option value="right" ${item.wall === 'right' ? 'selected' : ''}>Rechts (Ost)</option>
                        <option value="bottom" ${item.wall === 'bottom' ? 'selected' : ''}>Unten (Süd)</option>
                        <option value="left" ${item.wall === 'left' ? 'selected' : ''}>Links (West)</option>
                    </select>
                </div>
                <div class="prop-field">
                    <label>Höhe vom Boden (cm)</label>
                    <input type="number" id="prop-height" value="${item.height || 30}" min="0" max="300" step="0.1" ${lockedAttr}>
                </div>
                <div class="prop-field">
                    <label>Abstand Links (cm)</label>
                    <input type="number" id="prop-dist-left" value="${formatDim(item.position)}" min="0" step="0.1" ${lockedAttr}>
                </div>
                <div class="prop-field">
                    <label>Abstand Rechts (cm)</label>
                    <input type="number" id="prop-dist-right" value="${formatDim(maxPos - item.position)}" min="0" step="0.1" ${lockedAttr}>
                </div>
                <div class="prop-field prop-span-2" style="margin-top: 4px;">
                    <label class="checkbox-container">
                        <input type="checkbox" id="prop-locked" ${item.locked ? 'checked' : ''}>
                        <span class="checkmark"></span>
                        <span>🔒 Position sperren</span>
                    </label>
                </div>
            </div>
            
            <div class="prop-actions">
                <button class="btn btn-danger" id="prop-btn-delete" style="flex:1" ${lockedAttr}>
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
        const val = Math.max(10, parseFloat(e.target.value) || 0);
        if (State.selectedItemType === 'element') {
            const maxPos = (item.wall === 'top' || item.wall === 'bottom') ? State.room.width : State.room.depth;
            const oldW = item.w || 0;
            const distLeft = item.position - oldW / 2;
            const distRight = maxPos - (item.position + oldW / 2);
            
            // Wenn man die Breite ändert, bleibt der kleinere Abstand zur nächsten Wand gleich
            let newPos = item.position;
            if (distLeft <= distRight) {
                newPos = distLeft + val / 2;
            } else {
                newPos = maxPos - distRight - val / 2;
            }
            // Innerhalb der Wandgrenzen halten
            newPos = Math.max(val / 2, Math.min(maxPos - val / 2, newPos));
            
            const temp = { ...item, w: val, position: newPos };
            if (!isValidWallForElement(temp, item.wall, newPos)) {
                alert('Diese Breite führt zu einer Kollision mit der Dachschräge oder einem anderen Element!');
                e.target.value = item.w;
                return;
            }
            item.position = newPos;
        } else if (State.selectedItemType === 'furniture' && item.isObstacle) {
            const closest = getClosestWall(item);
            const isRotated = (Math.round((item.rotation || 0) / 90) % 2 === 1);
            const oldHalfW = (isRotated ? item.l : item.w) / 2;
            const newHalfW = (isRotated ? item.l : val) / 2;
            if (closest.wall === 'left') {
                item.x = item.x - oldHalfW + newHalfW;
            } else if (closest.wall === 'right') {
                item.x = item.x + oldHalfW - newHalfW;
            }
        }
        item.w = val;
        if (item.shape === 'circle') item.l = item.w; // sync circle diameter
        updateSelectedMesh();
        syncPropertiesPanel();
    });
    
    listenChange('prop-l', (e) => {
        const val = Math.max(10, parseFloat(e.target.value) || 0);
        if (State.selectedItemType === 'furniture' && item.isObstacle) {
            const closest = getClosestWall(item);
            const isRotated = (Math.round((item.rotation || 0) / 90) % 2 === 1);
            const oldHalfL = (isRotated ? item.w : item.l) / 2;
            const newHalfL = (isRotated ? val : val) / 2;
            if (closest.wall === 'top') {
                item.y = item.y - oldHalfL + newHalfL;
            } else if (closest.wall === 'bottom') {
                item.y = item.y + oldHalfL - newHalfL;
            }
        }
        item.l = val;
        updateSelectedMesh();
        syncPropertiesPanel();
    });
    
    listenChange('prop-h', (e) => {
        const val = Math.max(10, parseFloat(e.target.value) || 0);
        if (State.selectedItemType === 'element') {
            const temp = { ...item, h: val };
            if (!isValidWallForElement(temp, item.wall, item.position)) {
                alert('Diese Höhe überschreitet die Deckenhöhe an dieser Position! Das Element würde in die Dachschräge ragen.');
                e.target.value = item.h;
                return;
            }
        }
        item.h = val;
        updateSelectedMesh();
    });
    
    listenChange('prop-rot', (e) => {
        item.rotation = (parseFloat(e.target.value) || 0) % 360;
        updateSelectedMesh();
    });
    
    listenChange('prop-elevation', (e) => {
        item.elevation = Math.max(0, parseFloat(e.target.value) || 0);
        updateSelectedMesh();
    });
    
    listenChange('prop-tv-size', (e) => {
        const size = Math.max(10, parseInt(e.target.value) || 10);
        item.tvSize = size;
        
        // 16:9 aspect ratio dimensions (w: size * 2.2138, h: size * 1.2453 + 10cm stand)
        item.w = Math.round(size * 2.2138 * 10) / 10;
        item.h = Math.round((size * 1.2453 + 10) * 10) / 10;
        
        const wInput = document.getElementById('prop-w');
        const hInput = document.getElementById('prop-h');
        if (wInput) wInput.value = item.w;
        if (hInput) hInput.value = item.h;
        
        updateSelectedMesh();
    });
    
    listenChange('prop-rug-texture', (e) => {
        History.pushState();
        item.rugTexture = e.target.value;
        updateSelectedMesh();
    });
    
    listenChange('prop-rug-scale', (e) => {
        const val = parseInt(e.target.value) || 100;
        item.textureScale = val / 100;
        const valLabel = document.getElementById('prop-rug-scale-val');
        if (valLabel) valLabel.textContent = val + '%';
        updateSelectedMesh();
    });
    
    listenChange('prop-dist-left', (e) => {
        const val = Math.max(0, parseFloat(e.target.value) || 0);
        const w = item.w || 0;
        const newPos = val + w / 2;
        
        if (State.selectedItemType === 'element') {
            const temp = { ...item, position: newPos };
            if (!isValidWallForElement(temp, item.wall, newPos)) {
                alert('Diese Position führt zu einer Kollision mit der Dachschräge oder einem anderen Element!');
                e.target.value = formatDim(item.position - w / 2);
                return;
            }
        }
        item.position = newPos;
        updateSelectedMesh();
        
        // Update distance right input field
        const maxPos = (item.wall === 'top' || item.wall === 'bottom') ? State.room.width : State.room.depth;
        const rightInput = document.getElementById('prop-dist-right');
        if (rightInput) rightInput.value = formatDim(maxPos - (newPos + w / 2));
    });
    
    listenChange('prop-dist-right', (e) => {
        const val = Math.max(0, parseFloat(e.target.value) || 0);
        const maxPos = (item.wall === 'top' || item.wall === 'bottom') ? State.room.width : State.room.depth;
        const w = item.w || 0;
        const newPos = maxPos - val - w / 2;
        
        if (State.selectedItemType === 'element') {
            const temp = { ...item, position: newPos };
            if (!isValidWallForElement(temp, item.wall, newPos)) {
                alert('Diese Position führt zu einer Kollision mit der Dachschräge oder einem anderen Element!');
                e.target.value = formatDim(maxPos - (item.position + w / 2));
                return;
            }
        }
        item.position = newPos;
        updateSelectedMesh();
        
        // Update distance left input field
        const leftInput = document.getElementById('prop-dist-left');
        if (leftInput) leftInput.value = formatDim(newPos - w / 2);
    });
    
    listenChange('prop-sill', (e) => {
        const val = Math.max(0, parseFloat(e.target.value) || 0);
        if (State.selectedItemType === 'element') {
            const temp = { ...item, sillHeight: val };
            if (!isValidWallForElement(temp, item.wall, item.position)) {
                alert('Diese Brüstungshöhe überschreitet die Deckenhöhe an dieser Position! Das Fenster würde in die Dachschräge ragen.');
                e.target.value = item.sillHeight !== undefined ? item.sillHeight : 90;
                return;
            }
        }
        item.sillHeight = val;
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
        const val = Math.max(0, parseFloat(e.target.value) || 0);
        if (State.selectedItemType === 'element') {
            const temp = { ...item, distanceFromWall: val };
            if (!isValidWallForElement(temp, item.wall, item.position)) {
                alert('Diese Position führt zu einer Kollision mit einem anderen Element!');
                e.target.value = item.distanceFromWall !== undefined ? item.distanceFromWall : 60;
                return;
            }
        }
        item.distanceFromWall = val;
        updateSelectedMesh();
    });
    
    listenChange('prop-height', (e) => {
        item.height = Math.max(0, parseFloat(e.target.value) || 0);
        updateSelectedMesh();
    });
    
    // Wall Selector
    const wallSel = document.getElementById('prop-wall');
    if (wallSel) {
        wallSel.addEventListener('change', (e) => {
            const newWall = e.target.value;
            if (State.selectedItemType === 'element') {
                const maxPos = (newWall === 'top' || newWall === 'bottom') ? State.room.width : State.room.depth;
                const halfW = (item.w || 10) / 2;
                const tempPos = Math.min(maxPos - halfW, Math.max(halfW, item.position));
                
                if (!isValidWallForElement(item, newWall, tempPos)) {
                    alert('Dieses Element kann nicht auf diese Wand verschoben werden (kollidiert mit Dachschräge).');
                    e.target.value = item.wall;
                    return;
                }
                item.position = tempPos;
            }
            item.wall = newWall;
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
    
    // Color Dot Palette 2D
    const dots2d = document.querySelectorAll('.color-dot-2d');
    dots2d.forEach(dot => {
        dot.addEventListener('click', (e) => {
            History.pushState();
            const col = e.target.dataset.color;
            item.color = col;
            
            // update UI dots
            dots2d.forEach(d => d.classList.remove('active'));
            e.target.classList.add('active');
            
            // Redraw 2D layout and update Selected 3D mesh
            Editor2D.draw();
            updateSelectedMesh();
        });
    });
    
    // Color Dot Palette 3D
    const dots3d = document.querySelectorAll('.color-dot-3d');
    dots3d.forEach(dot => {
        dot.addEventListener('click', (e) => {
            History.pushState();
            const col = e.target.dataset.color;
            item.color3d = col;
            
            // update UI dots
            dots3d.forEach(d => d.classList.remove('active'));
            e.target.classList.add('active');
            
            updateSelectedMesh();
        });
    });
    
    // Custom color picker 2D
    const picker2d = document.getElementById('prop-color-2d-custom');
    if (picker2d) {
        picker2d.addEventListener('input', (e) => {
            const col = e.target.value;
            item.color = col;
            
            // clear active dots
            const dots2d = document.querySelectorAll('.color-dot-2d');
            dots2d.forEach(d => d.classList.remove('active'));
            
            Editor2D.draw();
            updateSelectedMesh();
        });
        
        picker2d.addEventListener('change', () => {
            History.pushState();
        });
    }
    
    // Custom color picker 3D
    const picker3d = document.getElementById('prop-color-3d-custom');
    if (picker3d) {
        picker3d.addEventListener('input', (e) => {
            const col = e.target.value;
            item.color3d = col;
            
            // clear active dots
            const dots3d = document.querySelectorAll('.color-dot-3d');
            dots3d.forEach(d => d.classList.remove('active'));
            
            updateSelectedMesh();
        });
        
        picker3d.addEventListener('change', () => {
            History.pushState();
        });
    }
    
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
            CollisionEngine.clampFurnitureToRoom(copy);
            
            History.pushState();
            State.furniture.push(copy);
            CollisionEngine.updateAllCollisions();
            Editor2D.draw();
            if (Viewer3D.renderer) Viewer3D.updateFurniture3D(copy);
            selectItem(copy, 'furniture');
            updatePlacedListsUI();
        });
    }

    // Lock Position Checkbox
    const lockChk = document.getElementById('prop-locked');
    if (lockChk) {
        lockChk.addEventListener('change', (e) => {
            History.pushState();
            item.locked = e.target.checked;
            buildPropertiesPanelContent();
            Editor2D.draw();
        });
    }

    // Obstacle Wall Distance Input
    listenChange('prop-wall-dist', (e) => {
        const val = Math.max(0, parseFloat(e.target.value) || 0);
        const closest = getClosestWall(item);
        
        const isRotated = (Math.round((item.rotation || 0) / 90) % 2 === 1);
        const halfW = (isRotated ? item.l : item.w) / 2;
        const halfL = (isRotated ? item.w : item.l) / 2;
        
        if (closest.wall === 'top') {
            item.y = val + halfL;
        } else if (closest.wall === 'bottom') {
            item.y = State.room.depth - val - halfL;
        } else if (closest.wall === 'left') {
            item.x = val + halfW;
        } else if (closest.wall === 'right') {
            item.x = State.room.width - val - halfW;
        }
        
        updateSelectedMesh();
    });
}

function updateSelectedMesh() {
    if (State.selectedItemType === 'furniture' && State.selectedItem) {
        CollisionEngine.clampFurnitureToRoom(State.selectedItem);
    }
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
        if (el) el.value = formatDim(val);
    };
    
    if (State.selectedItemType === 'furniture') {
        setVal('prop-w', item.w);
        setVal('prop-l', item.l);
        setVal('prop-h', item.isObstacle ? getCeilingHeightAt(item.x, item.y) : item.h);
        setVal('prop-rot', item.rotation);
        setVal('prop-elevation', item.elevation || 0);
        
        if (item.isRug) {
            const rugScaleVal = Math.round((item.textureScale || 1.0) * 100);
            const rugScaleInput = document.getElementById('prop-rug-scale');
            const rugScaleLabel = document.getElementById('prop-rug-scale-val');
            if (rugScaleInput) rugScaleInput.value = rugScaleVal;
            if (rugScaleLabel) rugScaleLabel.textContent = rugScaleVal + '%';
            const rugTexSel = document.getElementById('prop-rug-texture');
            if (rugTexSel) rugTexSel.value = (item.rugTexture === 'shaggy' || item.rugTexture === 'hochflor') ? 'hochflor' : 'flach';
        }
        
        if (item.tvSize !== null && item.tvSize !== undefined) {
            const tvSizeEl = document.getElementById('prop-tv-size');
            if (tvSizeEl) tvSizeEl.value = item.tvSize;
        }
        
        if (item.isObstacle) {
            const closest = getClosestWall(item);
            setVal('prop-wall-dist', closest.distance);
        }
    } else {
        const maxPos = (item.wall === 'top' || item.wall === 'bottom') ? State.room.width : State.room.depth;
        const w = item.w || 0;
        if (State.selectedItemType === 'element') {
            setVal('prop-dist-left', item.position - w / 2);
            setVal('prop-dist-right', maxPos - (item.position + w / 2));
            if (item.type === 'skylight') setVal('prop-dist', item.distanceFromWall !== undefined ? item.distanceFromWall : 60);
        } else if (State.selectedItemType === 'installation') {
            setVal('prop-dist-left', item.position);
            setVal('prop-dist-right', maxPos - item.position);
        }
    }
}

// --- THEME MANAGER (DARK / LIGHT VERCEL MONOCHROME THEMES) ---
const ThemeManager = {
    currentTheme: 'dark',
    STORAGE_KEY: 'roomcraft_theme',

    init() {
        if (typeof window === 'undefined') return;

        let stored = null;
        try {
            stored = localStorage.getItem(this.STORAGE_KEY) || localStorage.getItem('roomcraft-theme');
        } catch (e) {}

        if (stored === 'light' || stored === 'dark') {
            this.currentTheme = stored;
        } else {
            const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
            this.currentTheme = prefersDark ? 'dark' : 'light';
        }

        this.applyTheme(this.currentTheme, false);

        // Listen for OS scheme adjustments if not pinned by user
        if (window.matchMedia) {
            try {
                window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
                    let hasStored = null;
                    try { hasStored = localStorage.getItem(this.STORAGE_KEY) || localStorage.getItem('roomcraft-theme'); } catch(err) {}
                    if (!hasStored) {
                        this.applyTheme(e.matches ? 'dark' : 'light', true);
                    }
                });
            } catch (err) {}
        }

        // Event listener on theme toggle button(s)
        const toggleBtn = document.getElementById('btn-toggle-theme') || document.getElementById('btn-theme-toggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => this.toggleTheme());
        }
    },

    toggleTheme() {
        const next = this.currentTheme === 'dark' ? 'light' : 'dark';
        try {
            localStorage.setItem(this.STORAGE_KEY, next);
            localStorage.setItem('roomcraft-theme', next);
        } catch (e) {}
        this.applyTheme(next, true);
    },

    applyTheme(theme, notify = true) {
        this.currentTheme = theme;
        if (typeof document !== 'undefined' && document.documentElement) {
            document.documentElement.setAttribute('data-theme', theme);
            if (document.body) {
                if (theme === 'light') {
                    document.body.setAttribute('data-theme', 'light');
                } else {
                    document.body.removeAttribute('data-theme');
                }
            }

            const meta = document.querySelector('meta[name="color-scheme"]');
            if (meta) meta.setAttribute('content', theme === 'light' ? 'light' : 'dark');

            // Update Toggle Button UI Icons & aria labels
            const toggleBtns = [document.getElementById('btn-toggle-theme'), document.getElementById('btn-theme-toggle')].filter(Boolean);
            toggleBtns.forEach(btn => {
                const isDark = theme === 'dark';
                btn.setAttribute('title', isDark ? 'Zu hellem Design wechseln' : 'Zu dunklem Design wechseln');
                btn.setAttribute('aria-label', isDark ? 'Zu hellem Design wechseln' : 'Zu dunklem Design wechseln');
                if (isDark) {
                    btn.classList.remove('light-active');
                } else {
                    btn.classList.add('light-active');
                }
            });
        }

        // Update 2D Canvas Editor
        if (typeof Editor2D !== 'undefined' && Editor2D.draw) {
            Editor2D.draw();
        }

        // Update 3D WebGL Viewer Background
        if (typeof Viewer3D !== 'undefined') {
            if (typeof Viewer3D.setTheme === 'function') {
                Viewer3D.setTheme(theme);
            } else if (Viewer3D.scene && Viewer3D.scene.background && typeof THREE !== 'undefined') {
                Viewer3D.scene.background = new THREE.Color(theme === 'dark' ? 0x09090b : 0xf8fafc);
            }
        }
    }
};

// --- UI EVENT BINDINGS (SIDEBAR & TOOLBAR) ---

function initUIEvents() {
    // Initialize Theme Manager
    ThemeManager.init();

    // Global keyboard dismissal for properties panel
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && State.selectedItem) {
            selectItem(null, null);
        }
    });

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
            State.room[stateKey] = parseFloat(val) || 200;
            
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
            
            // Clamp all placed furniture items to new room boundaries
            State.furniture.forEach(f => {
                CollisionEngine.clampFurnitureToRoom(f, State.room);
            });
            
            CollisionEngine.updateAllCollisions();
            Editor2D.draw();
            syncPropertiesPanel();
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
            
            const prevEnabled = State.room.pitches[w].enabled;
            State.room.pitches[w].enabled = active;
            
            const conflict = State.elements.find(el => !isValidWallForElement(el, el.wall, el.position));
            if (conflict) {
                const elemNames = { door: conflict.isBalcony ? 'Balkontür' : 'Tür', 'double-door': conflict.isBalcony ? 'Doppelbalkontür' : 'Doppeltür', window: 'Fenster', skylight: 'Dachfenster' };
                const wallsMap = { top: 'Nord', right: 'Ost', bottom: 'Süd', left: 'West' };
                alert(`Die Dachschräge kann auf dieser Wand nicht ${active ? 'aktiviert' : 'deaktiviert'} werden, da das Element "${elemNames[conflict.type]}" (Wand: ${wallsMap[conflict.wall]}, Position: ${conflict.position}cm) dadurch mit der Dachschräge kollidieren würde.`);
                State.room.pitches[w].enabled = prevEnabled;
                e.target.checked = prevEnabled;
                return;
            }
            
            if (active) details.classList.remove('hidden');
            else details.classList.add('hidden');
            
            // Enable/disable Skylight button if at least one roof slant is active
            updateSkylightButtonState();
            
            CollisionEngine.updateAllCollisions();
            Editor2D.draw();
            if (Viewer3D.renderer) Viewer3D.rebuildWalls3D();
        });
        
        let prevKniestock = knieInput.value;
        knieInput.addEventListener('focus', () => {
            prevKniestock = knieInput.value;
        });
        
        const updateValues = () => {
            const newKniestock = Math.max(0, parseFloat(knieInput.value) || 0);
            const prevKnieVal = State.room.pitches[w].kniestock;
            
            State.room.pitches[w].kniestock = newKniestock;
            State.room.pitches[w].run = Math.max(10, parseFloat(runInput.value) || 10);
            
            const conflict = State.elements.find(el => !isValidWallForElement(el, el.wall, el.position));
            if (conflict) {
                const elemNames = { door: conflict.isBalcony ? 'Balkontür' : 'Tür', 'double-door': conflict.isBalcony ? 'Doppelbalkontür' : 'Doppeltür', window: 'Fenster', skylight: 'Dachfenster' };
                const wallsMap = { top: 'Nord', right: 'Ost', bottom: 'Süd', left: 'West' };
                alert(`Der Kniestock kann nicht geändert werden, da das Element "${elemNames[conflict.type]}" (Wand: ${wallsMap[conflict.wall]}, Position: ${conflict.position}cm) dadurch mit der Dachschräge kollidieren würde.`);
                State.room.pitches[w].kniestock = prevKnieVal;
                knieInput.value = prevKnieVal;
                return;
            }
            
            prevKniestock = knieInput.value;
            CollisionEngine.updateAllCollisions();
            Editor2D.draw();
            if (Viewer3D.renderer) Viewer3D.rebuildWalls3D();
        };
        
        knieInput.addEventListener('input', updateValues);
        knieInput.addEventListener('change', updateValues);
        runInput.addEventListener('input', updateValues);
        runInput.addEventListener('change', updateValues);
        
        const startInput = document.getElementById(`pitch-${w}-start`);
        const endInput = document.getElementById(`pitch-${w}-end`);
        const knieStartInput = document.getElementById(`pitch-${w}-kniestock-start`);
        const knieEndInput = document.getElementById(`pitch-${w}-kniestock-end`);
        
        if (startInput && endInput) {
            const updateInterval = (syncDOM) => {
                const wallLen = (w === 'top' || w === 'bottom') ? State.room.width : State.room.depth;
                let s = parseFloat(startInput.value);
                let e = parseFloat(endInput.value);
                let ks = knieStartInput ? parseFloat(knieStartInput.value) : s;
                let ke = knieEndInput ? parseFloat(knieEndInput.value) : e;

                if (isNaN(s)) s = 0;
                if (isNaN(e)) e = wallLen;
                if (isNaN(ks)) ks = s;
                if (isNaN(ke)) ke = e;

                s = Math.max(0, Math.min(wallLen, s));
                e = Math.max(0, Math.min(wallLen, e));
                ks = Math.max(0, Math.min(wallLen, ks));
                ke = Math.max(0, Math.min(wallLen, ke));

                State.room.pitches[w].start = s;
                State.room.pitches[w].end = e;
                State.room.pitches[w].kniestockStart = ks;
                State.room.pitches[w].kniestockEnd = ke;

                if (syncDOM === true) {
                    startInput.value = s;
                    endInput.value = e;
                    if (knieStartInput) knieStartInput.value = ks;
                    if (knieEndInput) knieEndInput.value = ke;
                }
                
                CollisionEngine.updateAllCollisions();
                Editor2D.draw();
                if (Viewer3D.renderer) Viewer3D.rebuildWalls3D();
            };

            [startInput, endInput, knieStartInput, knieEndInput].forEach(inp => {
                if (!inp) return;
                inp.addEventListener('input', () => updateInterval(false));
                inp.addEventListener('change', () => updateInterval(true));
            });
        }
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

    const snapChk = document.getElementById('toggle-snapping');
    if (snapChk) {
        snapChk.addEventListener('change', (e) => {
            State.settings.smartSnappingEnabled = e.target.checked;
            Editor2D.draw();
        });
    }

    const btnToggleLight = document.getElementById('btn-toggle-light-3d');
    if (btnToggleLight) {
        btnToggleLight.addEventListener('click', () => {
            State.settings.ceilingLampsEnabled = !State.settings.ceilingLampsEnabled;
            if (State.settings.ceilingLampsEnabled) {
                btnToggleLight.classList.add('active');
            } else {
                btnToggleLight.classList.remove('active');
            }
            const toggleCeilingLampsChk = document.getElementById('toggle-ceiling-lamps');
            if (toggleCeilingLampsChk) {
                toggleCeilingLampsChk.checked = State.settings.ceilingLampsEnabled;
            }
            if (Viewer3D.renderer) {
                Viewer3D.updateCeilingLampsLight();
            }
            Editor2D.draw();
        });
    }

    const btnWalk = document.getElementById('btn-walkthrough');
    if (btnWalk) {
        btnWalk.addEventListener('click', () => {
            Viewer3D.setWalkthroughMode(!Viewer3D.isWalkthrough);
        });
    }

    // Material- & Stückliste (BOM) Dialog & Exports
    BOMDialog.init();

    const btnOpenBOM = document.getElementById('btn-open-bom');
    if (btnOpenBOM) {
        btnOpenBOM.addEventListener('click', () => {
            BOMDialog.open();
        });
    }

    const btnExportDropdown = document.getElementById('btn-export-dropdown');
    const exportMenu = document.getElementById('export-menu');
    if (btnExportDropdown && exportMenu) {
        btnExportDropdown.addEventListener('click', (e) => {
            e.stopPropagation();
            exportMenu.classList.toggle('hidden');
        });

        document.addEventListener('click', () => {
            if (!exportMenu.classList.contains('hidden')) {
                exportMenu.classList.add('hidden');
            }
        });
    }

    const btnExport2DPNG = document.getElementById('btn-export-2d-png');
    if (btnExport2DPNG) {
        btnExport2DPNG.addEventListener('click', () => {
            if (exportMenu) exportMenu.classList.add('hidden');
            ExportManager.export2DHighResPNG();
        });
    }

    const btnExport3DPNG = document.getElementById('btn-export-3d-png');
    if (btnExport3DPNG) {
        btnExport3DPNG.addEventListener('click', () => {
            if (exportMenu) exportMenu.classList.add('hidden');
            ExportManager.export3DHighResPNG();
        });
    }

    const btnExportBOMModal = document.getElementById('btn-export-bom-modal');
    if (btnExportBOMModal) {
        btnExportBOMModal.addEventListener('click', () => {
            if (exportMenu) exportMenu.classList.add('hidden');
            BOMDialog.open();
        });
    }

    const btnExportJSONMenu = document.getElementById('btn-export-json-menu');
    if (btnExportJSONMenu) {
        btnExportJSONMenu.addEventListener('click', () => {
            if (exportMenu) exportMenu.classList.add('hidden');
            const btnExportJson = document.getElementById('btn-export-json');
            if (btnExportJson) btnExportJson.click();
        });
    }
    
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
            History.pushState();
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
                History.pushState();
                applyProjectData(data);
                showToast("Projekt erfolgreich importiert!");
                fileInput.value = ''; // reset
            } catch (err) {
                alert("Ungültige JSON-Projektdatei!");
            }
        };
        reader.readAsText(file);
    });

    document.getElementById('btn-example-room').addEventListener('click', () => {
        History.pushState();
        loadExampleRoom();
    });
    document.getElementById('btn-clear-room').addEventListener('click', clearRoom);
    
    document.getElementById('zoom-in').addEventListener('click', () => {
        State.editor2D.hasManuallyPannedOrZoomed = true;
        State.editor2D.zoom = Math.min(State.editor2D.zoom * 1.2, 4.0);
        Editor2D.draw();
    });
    
    document.getElementById('zoom-out').addEventListener('click', () => {
        State.editor2D.hasManuallyPannedOrZoomed = true;
        State.editor2D.zoom = Math.max(State.editor2D.zoom / 1.2, 0.4);
        Editor2D.draw();
    });
    
    document.getElementById('zoom-reset').addEventListener('click', () => {
        State.editor2D.hasManuallyPannedOrZoomed = false;
        Editor2D.resetView();
    });
    
    // Category Filter Pills (Catalog filtering)
    const catPills = document.querySelectorAll('.cat-pill');
    catPills.forEach(pill => {
        pill.addEventListener('click', () => {
            catPills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            const selected = pill.dataset.category;

            document.querySelectorAll('.furniture-presets-grid .preset-btn').forEach(btn => {
                if (selected === 'all') {
                    btn.style.display = '';
                } else {
                    const cats = (btn.dataset.category || '').split(' ');
                    btn.style.display = cats.includes(selected) ? '' : 'none';
                }
            });
        });
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
                presetKey: presetKey,
                preset: presetKey,
                name: p.name,
                shape: p.shape,
                w: p.w,
                l: p.l,
                h: p.h,
                x: State.room.width / 2,
                y: State.room.depth / 2,
                rotation: 0,
                color: p.color,
                color3d: p.color3d || p.color,
                collisionEnabled: p.collisionEnabled,
                isObstacle: p.isObstacle || false,
                isRug: p.isRug || false,
                rugTexture: p.rugTexture || 'flat',
                isTable: p.isTable || false,
                isLamp: p.isLamp || false,
                isPlant: p.isPlant || false,
                isNightstand: p.isNightstand || false,
                lightColor: p.lightColor,
                lightIntensity: p.lightIntensity,
                lightDistance: p.lightDistance,
                isColliding: false,
                elevation: p.elevation || 0,
                tvSize: p.tvSize !== undefined ? p.tvSize : null
            };
            
            CollisionEngine.clampFurnitureToRoom(f);
            History.pushState();
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
            
            // Determine a temporary element to check validity
            const tempElem = {
                type: type === 'balcony-door' ? 'door' : type === 'double-balcony-door' ? 'double-door' : type,
                w: type === 'door' || type === 'balcony-door' ? 90 : type === 'double-door' || type === 'double-balcony-door' ? 160 : type === 'window' ? 100 : 80,
                h: type === 'door' || type === 'double-door' || type === 'balcony-door' || type === 'double-balcony-door' ? 200 : type === 'window' ? 120 : 120,
                sillHeight: type === 'window' ? 90 : undefined
            };
            
            // Find a valid wall and position
            const wallOrder = ['bottom', 'top', 'left', 'right'];
            let targetWall = null;
            let targetPos = 0;
            
            for (let w of wallOrder) {
                const maxPos = (w === 'top' || w === 'bottom') ? State.room.width : State.room.depth;
                const pos = maxPos / 2;
                if (isValidWallForElement(tempElem, w, pos)) {
                    targetWall = w;
                    targetPos = pos;
                    break;
                }
            }
            
            if (!targetWall) {
                if (type === 'door' || type === 'double-door' || type === 'balcony-door' || type === 'double-balcony-door') {
                    alert('Türen können nicht platziert werden, da alle Wände eine Dachschräge haben oder der Platz blockiert ist!');
                } else if (type === 'window') {
                    alert('Fenster können nicht platziert werden, da an allen Wänden die Deckenhöhe für dieses Fenster zu niedrig ist!');
                } else if (type === 'skylight') {
                    alert('Aktivieren Sie zuerst eine Dachschräge unter "Raum"!');
                }
                return;
            }
            
            const elem = {
                id: 'el_' + Date.now(),
                type: type === 'balcony-door' ? 'door' : type === 'double-balcony-door' ? 'double-door' : type,
                isBalcony: type === 'balcony-door' || type === 'double-balcony-door',
                wall: targetWall,
                position: targetPos,
                w: tempElem.w,
                h: tempElem.h
            };
            
            if (type === 'window') {
                elem.sillHeight = tempElem.sillHeight;
            } else if (type === 'skylight') {
                elem.distanceFromWall = 60; // default distance along slant
            }
            
            History.pushState();
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
            
            History.pushState();
            State.installations.push(inst);
            Editor2D.draw();
            if (Viewer3D.scene) {
                Viewer3D.updateInstallations3D();
            }
            selectItem(inst, 'installation');
            updatePlacedListsUI();
        });
    });

    // Undo / Redo button event listeners
    const undoBtn = document.getElementById('btn-undo');
    const redoBtn = document.getElementById('btn-redo');
    if (undoBtn) undoBtn.addEventListener('click', () => History.undo());
    if (redoBtn) redoBtn.addEventListener('click', () => History.redo());

    // Global history snapshotting on focus / input interactions
    document.addEventListener('focusin', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') {
            History.saveTempSnapshot();
        }
    });

    document.addEventListener('mousedown', (e) => {
        // Capture range sliders / checkboxes immediately on click
        if (e.target.tagName === 'INPUT' && (e.target.type === 'range' || e.target.type === 'checkbox')) {
            History.saveTempSnapshot();
        }
    });
    
    document.addEventListener('change', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') {
            History.commitTempSnapshot();
        }
    });

    // 10. 3D View Style Toggle (Planung vs Textur)
    const btnModePlan = document.getElementById('btn-mode-plan');
    const btnModeTexture = document.getElementById('btn-mode-texture');
    
    if (btnModePlan && btnModeTexture) {
        btnModePlan.addEventListener('click', () => setViewStyle3D('plan'));
        btnModeTexture.addEventListener('click', () => setViewStyle3D('texture'));
    }
    
    // 11. Surfaces Tab (Wandfarben & Bodentexturen) Listeners
    initSurfaceTabListeners();
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
        
        const wallLen = (w === 'top' || w === 'bottom') ? State.room.width : State.room.depth;
        const knieEl = document.getElementById(`pitch-${w}-kniestock`);
        const runEl = document.getElementById(`pitch-${w}-run`);
        const startEl = document.getElementById(`pitch-${w}-start`);
        const endEl = document.getElementById(`pitch-${w}-end`);
        const knieStartEl = document.getElementById(`pitch-${w}-kniestock-start`);
        const knieEndEl = document.getElementById(`pitch-${w}-kniestock-end`);
        
        const sVal = (pitch.start !== undefined && pitch.start !== null) ? pitch.start : 0;
        const eVal = (pitch.end !== undefined && pitch.end !== null) ? pitch.end : wallLen;
        const ksVal = (pitch.kniestockStart !== undefined && pitch.kniestockStart !== null) ? pitch.kniestockStart : sVal;
        const keVal = (pitch.kniestockEnd !== undefined && pitch.kniestockEnd !== null) ? pitch.kniestockEnd : eVal;

        if (knieEl) knieEl.value = pitch.kniestock;
        if (runEl) runEl.value = pitch.run;
        if (startEl) {
            startEl.max = wallLen;
            startEl.value = sVal;
        }
        if (endEl) {
            endEl.max = wallLen;
            endEl.value = eVal;
        }
        if (knieStartEl) {
            knieStartEl.max = wallLen;
            knieStartEl.value = ksVal;
        }
        if (knieEndEl) {
            knieEndEl.max = wallLen;
            knieEndEl.value = keVal;
        }
    });
    
    updateSkylightButtonState();
    syncSurfaceTabUI();
}

let currentSurfaceTarget = 'all';

function setViewStyle3D(mode) {
    State.settings.viewStyle3D = mode;
    const btnPlan = document.getElementById('btn-mode-plan');
    const btnTex = document.getElementById('btn-mode-texture');
    if (btnPlan && btnTex) {
        if (mode === 'texture') {
            btnTex.classList.add('active');
            btnPlan.classList.remove('active');
        } else {
            btnPlan.classList.add('active');
            btnTex.classList.remove('active');
        }
    }
    if (Viewer3D.renderer) {
        Viewer3D.buildFloor3D();
        Viewer3D.rebuildWalls3D();
    }
}

function selectSurfaceTarget(target) {
    currentSurfaceTarget = target;
    const sel = document.getElementById('surface-target-select');
    if (sel) sel.value = target;
    
    // Switch to surfaces tab if not already active
    const tabBtn = document.querySelector('.tab-btn[data-tab="tab-surfaces"]');
    if (tabBtn && !tabBtn.classList.contains('active')) {
        tabBtn.click();
    }
    syncSurfaceTabUI();
}

function setWallColor(color, target = currentSurfaceTarget) {
    History.pushState();
    if (!State.room.wallColors) {
        State.room.wallColors = { top: '#f0eee9', right: '#f0eee9', bottom: '#f0eee9', left: '#f0eee9', pitch: '#f0eee9', ceiling: '#f5f4f0' };
    }
    if (target === 'all') {
        State.room.wallColors.top = color;
        State.room.wallColors.right = color;
        State.room.wallColors.bottom = color;
        State.room.wallColors.left = color;
        State.room.wallColors.pitch = color;
    } else if (target === 'ceiling') {
        State.room.wallColors.ceiling = color;
    } else if (target === 'pitch') {
        State.room.wallColors.pitch = color;
    } else {
        State.room.wallColors[target] = color;
    }
    
    // Auto-switch to texture/color view
    if (State.settings.viewStyle3D !== 'texture') {
        setViewStyle3D('texture');
    } else {
        Viewer3D.rebuildWalls3D();
    }
    syncSurfaceTabUI();
}

function setFloorTexture(floorKey) {
    History.pushState();
    State.room.floorTexture = floorKey;
    
    if (State.settings.viewStyle3D !== 'texture') {
        setViewStyle3D('texture');
    } else {
        Viewer3D.buildFloor3D();
    }
    syncSurfaceTabUI();
}

function initSurfaceTabListeners() {
    const targetSel = document.getElementById('surface-target-select');
    if (targetSel) {
        targetSel.addEventListener('change', (e) => {
            currentSurfaceTarget = e.target.value;
            syncSurfaceTabUI();
        });
    }
    
    // Preset wall color dots
    document.querySelectorAll('.surface-color-dot').forEach(dot => {
        dot.addEventListener('click', () => {
            const color = dot.dataset.color;
            setWallColor(color);
        });
    });
    
    // Custom color input
    const customColor = document.getElementById('surface-custom-color');
    if (customColor) {
        customColor.addEventListener('input', (e) => {
            setWallColor(e.target.value);
        });
    }
    
    // Apply to all walls button
    const btnAllWalls = document.getElementById('btn-apply-all-walls');
    if (btnAllWalls) {
        btnAllWalls.addEventListener('click', () => {
            const wallColors = State.room.wallColors || {};
            const currentColor = (currentSurfaceTarget === 'all' || currentSurfaceTarget === 'ceiling') 
                ? (wallColors.top || '#f0eee9') 
                : (wallColors[currentSurfaceTarget] || '#f0eee9');
            setWallColor(currentColor, 'all');
        });
    }
    
    // Floor texture cards
    document.querySelectorAll('.floor-card').forEach(card => {
        card.addEventListener('click', () => {
            const floor = card.dataset.floor;
            setFloorTexture(floor);
        });

        // Generate procedural preview data URL if canvas-based
        const previewImg = card.querySelector('.floor-card-preview');
        if (previewImg && (!previewImg.getAttribute('src') || previewImg.dataset.procedural)) {
            if (typeof TextureGenerator !== 'undefined' && TextureGenerator.getFloorPreviewUrl) {
                const dataUrl = TextureGenerator.getFloorPreviewUrl(card.dataset.floor);
                if (dataUrl) previewImg.src = dataUrl;
            }
        }
    });
    
    // Floor texture scale slider
    const floorScaleSlider = document.getElementById('floor-texture-scale-slider');
    const floorScaleVal = document.getElementById('floor-texture-scale-val');
    if (floorScaleSlider) {
        floorScaleSlider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value) || 100;
            if (floorScaleVal) floorScaleVal.textContent = val + '%';
            State.room.floorScale = val / 100;
            Viewer3D.buildFloor3D();
        });
    }
    
    // Reset floor scale button
    const btnResetFloorScale = document.getElementById('btn-reset-floor-scale');
    if (btnResetFloorScale) {
        btnResetFloorScale.addEventListener('click', () => {
            State.room.floorScale = 1.0;
            if (floorScaleSlider) floorScaleSlider.value = 100;
            if (floorScaleVal) floorScaleVal.textContent = '100%';
            Viewer3D.buildFloor3D();
        });
    }

    // Ceiling Lamp Controls
    const toggleLamps = document.getElementById('toggle-ceiling-lamps');
    if (toggleLamps) {
        toggleLamps.addEventListener('change', (e) => {
            State.settings.ceilingLampsEnabled = e.target.checked;
            const btnToggleLight = document.getElementById('btn-toggle-light-3d');
            if (btnToggleLight) {
                if (e.target.checked) btnToggleLight.classList.add('active');
                else btnToggleLight.classList.remove('active');
            }
            if (Viewer3D.renderer) {
                Viewer3D.updateCeilingLampsLight();
            }
            Editor2D.draw();
        });
    }

    const lampIntensitySlider = document.getElementById('ceiling-lamp-intensity-slider');
    const lampIntensityVal = document.getElementById('ceiling-lamp-intensity-val');
    if (lampIntensitySlider) {
        lampIntensitySlider.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value) || 1.0;
            State.settings.ceilingLampIntensity = val;
            if (lampIntensityVal) lampIntensityVal.textContent = Math.round(val * 100) + '%';
            if (Viewer3D.renderer) {
                Viewer3D.updateCeilingLampsLight();
            }
        });
    }

    const lampColorInput = document.getElementById('ceiling-lamp-color');
    if (lampColorInput) {
        lampColorInput.addEventListener('input', (e) => {
            State.settings.ceilingLampColor = e.target.value;
            if (Viewer3D.renderer) {
                Viewer3D.updateCeilingLampsLight();
            }
        });
    }
}

function syncSurfaceTabUI() {
    const wallColors = State.room.wallColors || { top: '#f0eee9', right: '#f0eee9', bottom: '#f0eee9', left: '#f0eee9', pitch: '#f0eee9', ceiling: '#f5f4f0' };
    const currentColor = (currentSurfaceTarget === 'all') 
        ? (wallColors.pitch || wallColors.top || '#f0eee9') 
        : (wallColors[currentSurfaceTarget] || '#f0eee9');
        
    const customColor = document.getElementById('surface-custom-color');
    const colorHexLabel = document.getElementById('surface-color-hex');
    if (customColor) customColor.value = currentColor.startsWith('#') ? currentColor : '#f0eee9';
    if (colorHexLabel) colorHexLabel.textContent = currentColor;
    
    // Highlight active color dot
    document.querySelectorAll('.surface-color-dot').forEach(dot => {
        if (dot.dataset.color.toLowerCase() === currentColor.toLowerCase()) {
            dot.classList.add('active');
        } else {
            dot.classList.remove('active');
        }
    });
    
    // Highlight active floor card (supporting aliases)
    const currentFloor = State.room.floorTexture || 'laminat_hell';
    const regFloors = (typeof TextureRegistry !== 'undefined' && Array.isArray(TextureRegistry.floors)) ? TextureRegistry.floors : [];
    const activeDef = regFloors.find(f => f.id === currentFloor || (f.aliases && f.aliases.includes(currentFloor)));
    const resolvedFloor = activeDef ? activeDef.id : currentFloor;

    document.querySelectorAll('.floor-card').forEach(card => {
        const cardFloor = card.dataset.floor;
        const cardDef = regFloors.find(f => f.id === cardFloor);
        const matches = (cardFloor === currentFloor) || 
                        (cardFloor === resolvedFloor) || 
                        (cardDef && cardDef.aliases && cardDef.aliases.includes(currentFloor));
        if (matches) {
            card.classList.add('active');
        } else {
            card.classList.remove('active');
        }

        const previewImg = card.querySelector('.floor-card-preview');
        if (previewImg && (!previewImg.getAttribute('src') || previewImg.dataset.procedural)) {
            if (typeof TextureGenerator !== 'undefined' && TextureGenerator.getFloorPreviewUrl) {
                const dataUrl = TextureGenerator.getFloorPreviewUrl(cardFloor);
                if (dataUrl) previewImg.src = dataUrl;
            }
        }
    });
    
    // Sync floor scale slider
    const currentScale = Math.round((State.room.floorScale || 1.0) * 100);
    const floorScaleSlider = document.getElementById('floor-texture-scale-slider');
    const floorScaleVal = document.getElementById('floor-texture-scale-val');
    if (floorScaleSlider) floorScaleSlider.value = currentScale;
    if (floorScaleVal) floorScaleVal.textContent = currentScale + '%';

    // Sync ceiling lamp controls
    const toggleLamps = document.getElementById('toggle-ceiling-lamps');
    if (toggleLamps) {
        toggleLamps.checked = State.settings.ceilingLampsEnabled !== false;
    }
    const btnToggleLight = document.getElementById('btn-toggle-light-3d');
    if (btnToggleLight) {
        if (State.settings.ceilingLampsEnabled !== false) {
            btnToggleLight.classList.add('active');
        } else {
            btnToggleLight.classList.remove('active');
        }
    }
    const lampIntensitySlider = document.getElementById('ceiling-lamp-intensity-slider');
    const lampIntensityVal = document.getElementById('ceiling-lamp-intensity-val');
    const curIntensity = State.settings.ceilingLampIntensity !== undefined ? State.settings.ceilingLampIntensity : 1.0;
    if (lampIntensitySlider) {
        lampIntensitySlider.value = curIntensity;
    }
    if (lampIntensityVal) {
        lampIntensityVal.textContent = Math.round(curIntensity * 100) + '%';
    }
    const lampColorInput = document.getElementById('ceiling-lamp-color');
    if (lampColorInput) {
        lampColorInput.value = State.settings.ceilingLampColor || '#ffeedd';
    }
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
    const elemNames = { door: 'Tür', 'double-door': 'Doppeltür', window: 'Fenster', skylight: 'Dachfenster' };
    const wallsMap = { top: 'Nord', right: 'Ost', bottom: 'Süd', left: 'West' };
    renderList('placed-elements-list', State.elements, el => {
        const name = el.type === 'double-door' ? (el.isBalcony ? 'Doppelbalkontür' : 'Doppeltür') : (el.isBalcony ? 'Balkontür' : elemNames[el.type]);
        return `${name} (${wallsMap[el.wall]} - ${el.position}cm)`;
    }, 'element');
    
    // Render Installations List
    const instNames = { socket: 'Steckdose', switch: 'Lichtschalter', lan: 'LAN', sat: 'SAT', power: 'Starkstrom' };
    renderList('placed-installations-list', State.installations, inst => `${instNames[inst.type]} (${wallsMap[inst.wall]} - ${inst.position}cm)`, 'installation');
}

// --- INITIALIZATION ---
if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', () => {
        console.log("RoomCraft App loaded - Version 1.1.3");
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
}

// --- NODE.JS MODULE EXPORT BRIDGE ---
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        State,
        History,
        CollisionEngine,
        Vector2D,
        getCeilingHeightAt,
        getFurnitureCorners,
        Presets,
        getWallPitchHeightAt,
        getPitchInterval,
        getClosestWall,
        formatDim,
        wallUDToRoomXY,
        projectToWall,
        projectToSpecificWall,
        getWallCoordinates,
        createSlantedBoxGeometry,
        isMouseOverWallElement,
        checkElementOverlap,
        clampSkylightConstraints,
        isValidWallForElement,
        getCeilingLampPositions,
        TextureRegistry,
        TextureGenerator,
        TextureCache,
        Editor2D,
        Viewer3D,
        SmartSnapping,
        BOMCalculator,
        ExportManager,
        BOMDialog,
        WalkthroughMode,
        selectItem,
        showPropertiesTab,
        ThemeManager
    };
}
