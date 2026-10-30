const assert = require('assert');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { initDb, seedBranches } = require('../src/db');
const { createApp } = require('../src/server');

async function runTests() {
    console.log('--- Testing API Endpoints ---');
    const testDbPath = path.join(__dirname, 'test_api.db');
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);

    const db = await initDb(testDbPath);
    await seedBranches(db, path.join(__dirname, '..', 'locations.kml'));

    const app = createApp(db);
    const server = http.createServer(app);

    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;
    console.log(`Test server running at ${baseUrl}`);

    try {
        // 1. GET /api/branches
        const branchesRes = await fetch(`${baseUrl}/api/branches`);
        const branchesData = await branchesRes.json();
        assert.strictEqual(branchesRes.status, 200);
        assert.strictEqual(branchesData.length, 24, 'Should return 24 branches');
        const firstBranch = branchesData[0];

        // 2. POST /api/resolve-link with plain coordinates
        const resolveRes = await fetch(`${baseUrl}/api/resolve-link`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: '13.723081, 100.550036' })
        });
        const resolveData = await resolveRes.json();
        assert.strictEqual(resolveRes.status, 200);
        assert.strictEqual(resolveData.lat, 13.723081);

        // 3. POST /api/submit (driver 1)
        const submitRes = await fetch(`${baseUrl}/api/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                employee_id: 'EMP001',
                name: 'สมชาย ใจดี',
                vehicle_no: '1ฒผ-1234',
                branch_id: firstBranch.id,
                map_url: '13.750000, 100.500000'
            })
        });
        const submitData = await submitRes.json();
        assert.strictEqual(submitRes.status, 200);
        assert(submitData.success);
        assert(submitData.data.distance_km > 0);

        // 4. Test Upsert (same employee_id submits again with updated vehicle_no)
        const updateRes = await fetch(`${baseUrl}/api/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                employee_id: 'EMP001',
                name: 'สมชาย ใจดี',
                vehicle_no: '9กก-9999',
                branch_id: firstBranch.id,
                map_url: '13.750000, 100.500000'
            })
        });
        const updateData = await updateRes.json();
        assert.strictEqual(updateRes.status, 200);

        // 5. POST /api/auth/login
        const loginFail = await fetch(`${baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: 'wrong' })
        });
        assert.strictEqual(loginFail.status, 401);

        const loginOk = await fetch(`${baseUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: 'Mwater2026' })
        });
        assert.strictEqual(loginOk.status, 200);
        const loginData = await loginOk.json();
        const token = loginData.token;
        assert(token, 'Should receive session token');

        // 6. GET /api/submissions with calculations
        const listRes = await fetch(`${baseUrl}/api/submissions`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        assert.strictEqual(listRes.status, 200);
        const listData = await listRes.json();
        assert.strictEqual(listData.submissions.length, 1, 'Deduplication: exactly 1 row should exist for EMP001');
        assert.strictEqual(listData.submissions[0].vehicle_no, '9กก-9999', 'Should have updated vehicle_no');

        // 7. GET /api/export Excel
        const exportRes = await fetch(`${baseUrl}/api/export`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        assert.strictEqual(exportRes.status, 200);
        const contentType = exportRes.headers.get('content-type');
        assert(contentType.includes('spreadsheetml'), 'Should return Excel content type');

        console.log('✓ API Endpoints tests passed successfully!');
    } finally {
        server.close();
        db.close();
        if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    }
}

runTests().catch(err => {
    console.error('API test failed:', err);
    process.exit(1);
});
