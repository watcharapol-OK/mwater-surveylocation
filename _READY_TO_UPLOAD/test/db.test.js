const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { initDb, getDb, seedBranches } = require('../src/db');

async function runTest() {
    console.log('--- Testing DB and 24 Branches Seed ---');
    const testDbPath = path.join(__dirname, 'test_survey.db');
    if (fs.existsSync(testDbPath)) {
        fs.unlinkSync(testDbPath);
    }

    const db = await initDb(testDbPath);
    assert(db, 'DB instance should exist');

    const kmlPath = path.join(__dirname, '..', 'locations.kml');
    assert(fs.existsSync(kmlPath), 'locations.kml must exist');

    const seededCount = await seedBranches(db, kmlPath);
    console.log(`Seeded branches count: ${seededCount}`);
    assert.strictEqual(seededCount, 24, 'Exactly 24 branches should be seeded from locations.kml');

    const branches = await new Promise((resolve, reject) => {
        db.all('SELECT * FROM branches', (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });

    assert.strictEqual(branches.length, 24, 'Database should contain exactly 24 branches');
    
    // Check specific known branch
    const homeplace = branches.find(b => b.name.includes('โฮมเพลส'));
    assert(homeplace, 'โฮมเพลส branch should exist');
    assert(Math.abs(homeplace.latitude - 13.734005) < 0.001, 'Latitude should match 13.734');
    assert(Math.abs(homeplace.longitude - 100.581834) < 0.001, 'Longitude should match 100.581');

    console.log('✓ Task 1 tests passed successfully!');
    db.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
}

runTest().catch(err => {
    console.error('Test failed with error:', err.message);
    process.exit(1);
});
