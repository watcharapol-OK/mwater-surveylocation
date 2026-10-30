const assert = require('assert');
const {
    parseCoordinatesFromText,
    haversineDistanceKm,
    calculateDistanceKm,
    calculateFuelCost
} = require('../src/geo_utils');

async function runTests() {
    console.log('--- Testing Geo Utils ---');

    // 1. Coordinate parsing from direct string
    const p1 = parseCoordinatesFromText('13.723081, 100.550036');
    assert(p1, 'Should parse lat,lng from plain numbers');
    assert.strictEqual(p1.lat, 13.723081);
    assert.strictEqual(p1.lng, 100.550036);

    // 2. Coordinate parsing from standard google maps URL
    const p2 = parseCoordinatesFromText('https://www.google.com/maps?q=13.734005,100.581834');
    assert(p2, 'Should parse from ?q=');
    assert.strictEqual(p2.lat, 13.734005);
    assert.strictEqual(p2.lng, 100.581834);

    const p3 = parseCoordinatesFromText('https://www.google.com/maps/@13.699491,100.587957,15z');
    assert(p3, 'Should parse from @lat,lng');
    assert.strictEqual(p3.lat, 13.699491);
    assert.strictEqual(p3.lng, 100.587957);

    // 3. Haversine distance
    // Bangkok Rama 4 (13.72308, 100.55003) to Sukhumvit 50 (13.69949, 100.58795) is approx 4.8 km straight line
    const straightDist = haversineDistanceKm(13.72308, 100.55003, 13.69949, 100.58795);
    console.log(`Straight distance: ${straightDist.toFixed(2)} km`);
    assert(straightDist > 3 && straightDist < 7, 'Distance should be roughly 4-6 km');

    // 4. Hybrid Distance (OSRM or fallback)
    const hybridDist = await calculateDistanceKm(13.72308, 100.55003, 13.69949, 100.58795);
    console.log(`Calculated distance: ${hybridDist.distanceKm} km (method: ${hybridDist.method})`);
    assert(hybridDist.distanceKm > 0, 'Distance should be greater than 0');

    // 5. Fuel cost calculation
    // Distance 50km, Consumption 10 km/L, Diesel 30 THB/L
    const oneWayCost = calculateFuelCost(50, 10, 30, 'one-way');
    assert.strictEqual(oneWayCost, 150, 'One-way: (50/10)*30 = 150');

    const roundTripCost = calculateFuelCost(50, 10, 30, 'round-trip');
    assert.strictEqual(roundTripCost, 300, 'Round-trip: 150 * 2 = 300');

    console.log('✓ Geo Utils tests passed successfully!');
}

runTests().catch(err => {
    console.error('Geo utils test failed:', err);
    process.exit(1);
});
