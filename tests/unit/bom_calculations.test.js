const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppInstance } = require('../harness');

test('Feature 13: High-Res Export & Material / Stückliste BOM Calculations', async (t) => {
    const app = createAppInstance();
    const { BOMCalculator, ExportManager } = app;

    await t.test('1. Basic room geometry calculations (DIN 277 / WoFlV)', () => {
        const state = {
            room: { width: 500, depth: 400, height: 250, pitches: {} },
            elements: [],
            installations: [],
            furniture: []
        };

        const bom = BOMCalculator.calculate(state);
        // Floor area = (500 * 400) / 10000 = 20.00 m²
        assert.equal(bom.geometry.floorAreaM2, 20);
        // Perimeter = 2 * (500 + 400) / 100 = 18.00 m
        assert.equal(bom.geometry.perimeterM, 18);
        // Gross volume = (500 * 400 * 250) / 1000000 = 50.00 m³
        assert.equal(bom.geometry.grossVolumeM3, 50);
        assert.equal(bom.geometry.netVolumeM3, 50);
    });

    await t.test('2. Roof pitch volume loss and sloped ceiling surface area', () => {
        // Room 500x400x250 with pitch on Top (North) wall:
        // wall length = 500 cm, run = 150 cm, kniestock = 80 cm
        // slopeHeight = 250 - 80 = 170 cm
        // lost volume = 0.5 * (1.50) * (1.70) * (5.00) = 6.375 m³
        // slopeHypotenuse = sqrt(150^2 + 170^2) = sqrt(22500 + 28900) = sqrt(51400) ≈ 226.7157 cm
        // sloped ceiling area = (500 * 226.7157) / 10000 ≈ 11.34 m²
        // flat ceiling area = floorArea (20 m²) - footprint (500 * 150 / 10000 = 7.5 m²) = 12.5 m²
        const state = {
            room: {
                width: 500,
                depth: 400,
                height: 250,
                pitches: {
                    top: { enabled: true, run: 150, kniestock: 80 }
                }
            },
            elements: [],
            installations: [],
            furniture: []
        };

        const bom = BOMCalculator.calculate(state);
        assert.equal(bom.geometry.grossVolumeM3, 50);
        assert.equal(bom.geometry.netVolumeM3, 43.63); // 50 - 6.375 = 43.625 -> 43.63 m³
        // Total ceiling area = 12.5 (flat) + 11.34 (slope) = 23.84 m²
        assert.ok(Math.abs(bom.totals.ceilingAreaM2 - 23.84) <= 0.05);
    });

    await t.test('3. Wall area calculations with door and window cutouts', () => {
        // Flat room 500x400x250, no pitches
        // North wall (top): 500x250 = 12.5 m²
        // South wall (bottom): 500x250 = 12.5 m²
        // East wall (right): 400x250 = 10.0 m²
        // West wall (left): 400x250 = 10.0 m²
        // Gross wall total = 12.5 + 12.5 + 10.0 + 10.0 = 45.0 m²
        const state = {
            room: { width: 500, depth: 400, height: 250, pitches: {} },
            elements: [
                // Door on bottom wall: 90x200 cm = 1.80 m²
                { id: 'd1', type: 'door', wall: 'bottom', position: 100, w: 90, h: 200 },
                // Window on right wall: 120x140 cm = 1.68 m²
                { id: 'w1', type: 'window', wall: 'right', position: 200, w: 120, h: 140 }
            ],
            installations: [],
            furniture: []
        };

        const bom = BOMCalculator.calculate(state);
        assert.equal(bom.totals.grossWallAreaM2, 45);
        assert.equal(bom.totals.openingsCutoutAreaM2, 3.48); // 1.80 + 1.68 = 3.48 m²
        assert.equal(bom.totals.netWallAreaM2, 41.52); // 45 - 3.48 = 41.52 m²

        // Verify wall breakdown in surfaces
        const wallBottom = bom.surfaces.find(s => s.id === 'wall_bottom');
        assert.equal(wallBottom.grossM2, 12.5);
        assert.equal(wallBottom.cutoutM2, 1.8);
        assert.equal(wallBottom.netM2, 10.7);

        const wallRight = bom.surfaces.find(s => s.id === 'wall_right');
        assert.equal(wallRight.grossM2, 10);
        assert.equal(wallRight.cutoutM2, 1.68);
        assert.equal(wallRight.netM2, 8.32);
    });

    await t.test('4. Furniture aggregation and guideline budget pricing', () => {
        const state = {
            room: { width: 500, depth: 400, height: 250, pitches: {} },
            elements: [],
            installations: [],
            furniture: [
                { id: 'f1', name: 'Doppelbett', shape: 'rect', w: 180, l: 200, h: 60 },
                { id: 'f2', name: 'Stuhl', shape: 'rect', w: 45, l: 45, h: 85 },
                { id: 'f3', name: 'Stuhl', shape: 'rect', w: 45, l: 45, h: 85 },
                { id: 'f4', name: 'Sofa', shape: 'rect', w: 210, l: 95, h: 80 }
            ]
        };

        const bom = BOMCalculator.calculate(state);
        assert.equal(bom.totals.furnitureCount, 4);

        // Grouping: chairs should be grouped with count 2
        const chairs = bom.furniture.find(f => f.name === 'Stuhl');
        assert.ok(chairs);
        assert.equal(chairs.count, 2);
        assert.equal(chairs.unitPrice, 95);
        assert.equal(chairs.totalCost, 190);

        const bed = bom.furniture.find(f => f.name === 'Doppelbett');
        assert.equal(bed.unitPrice, 850);
        assert.equal(bed.totalCost, 850);

        const sofa = bom.furniture.find(f => f.name === 'Sofa');
        assert.equal(sofa.unitPrice, 1250);
        assert.equal(sofa.totalCost, 1250);

        // Total = 850 + 190 + 1250 = 2290 €
        assert.equal(bom.totals.totalFurnitureCost, 2290);
    });

    await t.test('5. CSV generation with UTF-8 BOM and RFC 4180 escaping', () => {
        const state = {
            room: { width: 500, depth: 400, height: 250, pitches: {} },
            elements: [{ id: 'd1', type: 'door', wall: 'bottom', position: 100, w: 90, h: 200 }],
            installations: [{ id: 'i1', type: 'socket', wall: 'top', position: 150, height: 30 }],
            furniture: [{ id: 'f1', name: 'Sofa, "Modern"', shape: 'rect', w: 200, l: 90, h: 80 }]
        };

        const bom = BOMCalculator.calculate(state);
        const csv = ExportManager.generateCSVContent(bom);

        // Must start with UTF-8 BOM
        assert.ok(csv.startsWith('\uFEFF'), 'CSV must start with UTF-8 BOM for Excel compatibility');

        // Check RFC 4180 quote escaping on comma/quotes
        assert.ok(csv.includes('"Sofa, ""Modern"""'), 'Quotes and commas must be properly escaped');

        // Check key sections exist
        assert.ok(csv.includes('--- RAUM-STAMMDATEN ---'));
        assert.ok(csv.includes('--- FLÄCHENBERECHNUNG (DIN 277) ---'));
        assert.ok(csv.includes('--- ÖFFNUNGEN UND EINBAUTEN ---'));
        assert.ok(csv.includes('--- ELEKTRO- & SANITÄRINSTALLATIONEN ---'));
        assert.ok(csv.includes('--- MÖBEL-STÜCKLISTE & KOSTENRICHTWERTE ---'));
    });

    await t.test('6. Guideline pricing keyword precedence (Couchtisch vs Couch)', () => {
        const state = {
            room: { width: 500, depth: 400, height: 250, pitches: {} },
            elements: [],
            installations: [],
            furniture: [
                { id: 'f1', name: 'Couchtisch', shape: 'rect', w: 100, l: 60, h: 45 },
                { id: 'f2', name: 'Couchtisch-Set', shape: 'circle', w: 80, l: 80, h: 45 },
                { id: 'f3', name: 'Couch', shape: 'rect', w: 200, l: 90, h: 80 },
                { id: 'f4', name: 'Sofa', shape: 'rect', w: 200, l: 90, h: 80 }
            ]
        };

        const bom = BOMCalculator.calculate(state);
        const couchtisch = bom.furniture.find(f => f.name === 'Couchtisch');
        const couchtischSet = bom.furniture.find(f => f.name === 'Couchtisch-Set');
        const couch = bom.furniture.find(f => f.name === 'Couch');
        const sofa = bom.furniture.find(f => f.name === 'Sofa');

        assert.equal(couchtisch.unitPrice, 220, 'Couchtisch must be priced at 220 EUR, not shadowed by couch (1250 EUR)');
        assert.equal(couchtischSet.unitPrice, 220, 'Couchtisch-Set must be priced at 220 EUR');
        assert.equal(couch.unitPrice, 1250, 'Couch must be priced at 1250 EUR');
        assert.equal(sofa.unitPrice, 1250, 'Sofa must be priced at 1250 EUR');
    });
});
