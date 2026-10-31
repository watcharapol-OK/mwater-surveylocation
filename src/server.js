const express = require('express');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');
const { getDb, initDb, seedBranches } = require('./db');
const {
    resolveGoogleMapsUrl,
    calculateDistanceKm,
    calculateBothDirectionsKm,
    calculateFuelCost
} = require('./geo_utils');
const {
    syncFromGoogleSheets,
    pushToGoogleSheets,
    deleteFromGoogleSheets
} = require('./sheets_sync');

// In-memory valid manager tokens
const managerTokens = new Set();

function createApp(db) {
    const app = express();
    app.use(express.json());
    app.use(express.static(path.join(__dirname, '..', 'public')));

    // Helper: get system settings as an object
    function getSettings() {
        const rows = db.all('SELECT key, value FROM system_settings');
        const settings = {};
        for (const r of rows) {
            settings[r.key] = r.value;
        }
        return {
            diesel_price: parseFloat(settings.diesel_price) || 32.94,
            fuel_consumption: parseFloat(settings.fuel_consumption) || 9.0,
            threshold_cost: parseFloat(settings.threshold_cost) || 200.0,
            manager_password: settings.manager_password || 'Mwater2026'
        };
    }

    // Auth middleware
    function requireAuth(req, res, next) {
        const authHeader = req.headers['authorization'];
        let token = null;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        } else if (req.query.token) {
            token = req.query.token;
        }

        if (token && managerTokens.has(token)) {
            return next();
        }
        return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบด้วยรหัสผ่านผู้จัดการ' });
    }

    // 1. Get branches
    app.get('/api/branches', (req, res) => {
        try {
            const branches = db.all('SELECT * FROM branches ORDER BY category, name');
            res.json(branches);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // 2. Resolve link/coords preview
    app.post('/api/resolve-link', async (req, res) => {
        try {
            const { url } = req.body;
            if (!url) return res.status(400).json({ error: 'กรุณาระบุลิงก์หรือพิกัด' });
            const coords = await resolveGoogleMapsUrl(url);
            res.json(coords);
        } catch (err) {
            res.status(400).json({ error: err.message });
        }
    });

    // 3. Submit accommodation (Driver)
    app.post('/api/submit', async (req, res) => {
        try {
            const { employee_id, name, vehicle_no, branch_id, map_url } = req.body;
            if (!employee_id || !name || !vehicle_no || !branch_id || !map_url) {
                return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบทุกช่อง' });
            }

            // Find branch
            const branch = db.get('SELECT * FROM branches WHERE id = ?', [branch_id]);
            if (!branch) {
                return res.status(404).json({ error: 'ไม่พบข้อมูลสาขาที่เลือก' });
            }

            // Resolve home coordinates and calculate both inbound (home -> branch) and outbound (branch -> home)
            const coords = await resolveGoogleMapsUrl(map_url);
            const dirResult = await calculateBothDirectionsKm(
                coords.lat,
                coords.lng,
                branch.latitude,
                branch.longitude
            );

            // Upsert submission with separate inbound, outbound and actual round-trip distances
            db.run(`
                INSERT INTO submissions (
                    employee_id, name, vehicle_no, branch_id, map_url,
                    home_latitude, home_longitude, distance_km, distance_return_km, distance_round_trip_km, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(employee_id) DO UPDATE SET
                    name = excluded.name,
                    vehicle_no = excluded.vehicle_no,
                    branch_id = excluded.branch_id,
                    map_url = excluded.map_url,
                    home_latitude = excluded.home_latitude,
                    home_longitude = excluded.home_longitude,
                    distance_km = excluded.distance_km,
                    distance_return_km = excluded.distance_return_km,
                    distance_round_trip_km = excluded.distance_round_trip_km,
                    updated_at = CURRENT_TIMESTAMP
            `, [
                employee_id.trim(),
                name.trim(),
                vehicle_no.trim(),
                branch_id,
                map_url.trim(),
                coords.lat,
                coords.lng,
                dirResult.inboundKm,
                dirResult.outboundKm,
                dirResult.roundTripKm
            ]);

            const saved = db.get('SELECT * FROM submissions WHERE employee_id = ?', [employee_id.trim()]);

            // Sync with Google Sheets in background if configured
            pushToGoogleSheets({
                ...saved,
                branch_name: branch.name
            }).catch(err => console.error('[GoogleSheets] Submit sync error:', err.message));

            res.json({
                success: true,
                message: 'บันทึกข้อมูลเรียบร้อยแล้ว',
                data: {
                    ...saved,
                    branch_name: branch.name,
                    distance_inbound: dirResult.inboundKm,
                    distance_outbound: dirResult.outboundKm,
                    distance_round_trip: dirResult.roundTripKm,
                    distance_method: dirResult.method
                }
            });
        } catch (err) {
            res.status(400).json({ error: err.message });
        }
    });

    // 4. Manager Login
    app.post('/api/auth/login', (req, res) => {
        const { password } = req.body;
        const settings = getSettings();
        if (password === settings.manager_password) {
            const token = crypto.randomBytes(24).toString('hex');
            managerTokens.add(token);
            res.json({ success: true, token });
        } else {
            res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' });
        }
    });

    // 5. Manager Settings
    app.get('/api/settings', requireAuth, (req, res) => {
        const settings = getSettings();
        // Do not expose manager password in cleartext settings response
        delete settings.manager_password;
        res.json(settings);
    });

    app.put('/api/settings', requireAuth, (req, res) => {
        try {
            const { diesel_price, fuel_consumption, threshold_cost, new_password } = req.body;
            if (diesel_price !== undefined) {
                db.run('REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['diesel_price', String(diesel_price)]);
            }
            if (fuel_consumption !== undefined) {
                db.run('REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['fuel_consumption', String(fuel_consumption)]);
            }
            if (threshold_cost !== undefined) {
                db.run('REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['threshold_cost', String(threshold_cost)]);
            }
            if (new_password) {
                db.run('REPLACE INTO system_settings (key, value) VALUES (?, ?)', ['manager_password', String(new_password)]);
            }
            res.json({ success: true, message: 'บันทึกการตั้งค่าเรียบร้อยแล้ว' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // 6. Submissions with dynamic calculations
    app.get('/api/submissions', requireAuth, async (req, res) => {
        try {
            // Sync from Google Sheets if configured (throttled to at most once a minute)
            await syncFromGoogleSheets(db);

            const settings = getSettings();
            const mode = req.query.mode === 'round-trip' ? 'round-trip' : 'one-way';
            const dieselPrice = req.query.diesel_price ? parseFloat(req.query.diesel_price) : settings.diesel_price;
            const consumption = req.query.fuel_consumption ? parseFloat(req.query.fuel_consumption) : settings.fuel_consumption;
            const threshold = req.query.threshold_cost ? parseFloat(req.query.threshold_cost) : settings.threshold_cost;
            const branchId = req.query.branch_id ? parseInt(req.query.branch_id) : null;
            const vehicleNo = req.query.vehicle_no ? req.query.vehicle_no.trim() : null;
            const vehicles = req.query.vehicles ? req.query.vehicles.split(',').map(v => v.trim()).filter(Boolean) : null;

            let query = `
                SELECT s.*, b.name as branch_name, b.latitude as branch_latitude, b.longitude as branch_longitude
                FROM submissions s
                JOIN branches b ON s.branch_id = b.id
            `;
            const params = [];
            const conditions = [];
            if (branchId) {
                conditions.push('s.branch_id = ?');
                params.push(branchId);
            }
            if (vehicles && vehicles.length > 0) {
                const placeholders = vehicles.map(() => '?').join(',');
                conditions.push(`s.vehicle_no IN (${placeholders})`);
                params.push(...vehicles);
            } else if (vehicleNo) {
                conditions.push('s.vehicle_no = ?');
                params.push(vehicleNo);
            }
            if (conditions.length > 0) {
                query += ' WHERE ' + conditions.join(' AND ');
            }
            query += ' ORDER BY s.updated_at DESC';

            const rows = db.all(query, params);
            let overThresholdCount = 0;
            let totalDistance = 0;

            const enriched = rows.map(r => {
                const inboundDist = r.distance_km;
                const outboundDist = r.distance_return_km != null ? r.distance_return_km : inboundDist;
                const roundTripDist = r.distance_round_trip_km != null ? r.distance_round_trip_km : parseFloat((inboundDist * 2).toFixed(2));

                const oneWayCost = calculateFuelCost(inboundDist, consumption, dieselPrice, 'one-way');
                const roundTripCost = calculateFuelCost(inboundDist, consumption, dieselPrice, 'round-trip', roundTripDist);
                const activeCost = mode === 'round-trip' ? roundTripCost : oneWayCost;
                const activeDistance = mode === 'round-trip' ? roundTripDist : inboundDist;
                const isOver = activeCost > threshold;

                if (isOver) overThresholdCount++;
                totalDistance += activeDistance;

                return {
                    ...r,
                    distance_inbound: inboundDist,
                    distance_outbound: outboundDist,
                    distance_round_trip: roundTripDist,
                    active_distance: activeDistance,
                    cost_one_way: oneWayCost,
                    cost_round_trip: roundTripCost,
                    active_cost: activeCost,
                    is_over_threshold: isOver
                };
            });

            const total = enriched.length;
            const percentOver = total > 0 ? parseFloat(((overThresholdCount / total) * 100).toFixed(1)) : 0;
            const avgDistance = total > 0 ? parseFloat((totalDistance / total).toFixed(1)) : 0;

            res.json({
                summary: {
                    total,
                    over_threshold_count: overThresholdCount,
                    over_threshold_percent: percentOver,
                    avg_distance_km: avgDistance,
                    mode,
                    diesel_price: dieselPrice,
                    fuel_consumption: consumption,
                    threshold_cost: threshold
                },
                submissions: enriched
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // 7. Delete submission
    app.delete('/api/submissions/:id', requireAuth, async (req, res) => {
        try {
            const { id } = req.params;
            const sub = db.get('SELECT * FROM submissions WHERE id = ? OR employee_id = ? OR vehicle_no = ?', [id, id, id]);
            if (!sub) {
                return res.status(404).json({ error: 'ไม่พบข้อมูลที่ต้องการลบ' });
            }
            db.run('DELETE FROM submissions WHERE id = ?', [sub.id]);

            // Sync deletion with Google Sheets
            deleteFromGoogleSheets(sub.employee_id).catch(err => console.error('[GoogleSheets] Delete sync error:', err.message));

            res.json({ success: true, message: `ลบข้อมูลรถ ${sub.vehicle_no} (${sub.name}) เรียบร้อยแล้ว` });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // 7.1 Manual Sync with Google Sheets
    app.post('/api/sync-sheets', requireAuth, async (req, res) => {
        try {
            const success = await syncFromGoogleSheets(db, true);
            res.json({ success: true, message: success ? 'ซิงค์ข้อมูลกับ Google Sheets เรียบร้อยแล้ว' : 'ไม่ได้เปิดใช้งาน Google Sheets หรือไม่มีการเปลี่ยนแปลง' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // 8. Export Excel
    app.get('/api/export', requireAuth, async (req, res) => {
        try {
            const settings = getSettings();
            const mode = req.query.mode === 'round-trip' ? 'round-trip' : 'one-way';
            const dieselPrice = req.query.diesel_price ? parseFloat(req.query.diesel_price) : settings.diesel_price;
            const consumption = req.query.fuel_consumption ? parseFloat(req.query.fuel_consumption) : settings.fuel_consumption;
            const threshold = req.query.threshold_cost ? parseFloat(req.query.threshold_cost) : settings.threshold_cost;
            const branchId = req.query.branch_id ? parseInt(req.query.branch_id) : null;
            const vehicleNo = req.query.vehicle_no ? req.query.vehicle_no.trim() : null;
            const vehicles = req.query.vehicles ? req.query.vehicles.split(',').map(v => v.trim()).filter(Boolean) : null;

            let query = `
                SELECT s.*, b.name as branch_name
                FROM submissions s
                JOIN branches b ON s.branch_id = b.id
            `;
            const params = [];
            const conditions = [];
            if (branchId) {
                conditions.push('s.branch_id = ?');
                params.push(branchId);
            }
            if (vehicles && vehicles.length > 0) {
                const placeholders = vehicles.map(() => '?').join(',');
                conditions.push(`s.vehicle_no IN (${placeholders})`);
                params.push(...vehicles);
            } else if (vehicleNo) {
                conditions.push('s.vehicle_no = ?');
                params.push(vehicleNo);
            }
            if (conditions.length > 0) {
                query += ' WHERE ' + conditions.join(' AND ');
            }
            query += ' ORDER BY s.distance_km DESC';

            const rows = db.all(query, params);

            const workbook = new ExcelJS.Workbook();
            workbook.creator = 'MWater Survey System';
            const sheet = workbook.addWorksheet('รายงานสวัสดิการเดินทาง');

            sheet.columns = [
                { header: 'ลำดับ', key: 'no', width: 8 },
                { header: 'รหัสพนักงาน', key: 'employee_id', width: 15 },
                { header: 'ชื่อ-นามสกุล', key: 'name', width: 25 },
                { header: 'เบอร์รถ', key: 'vehicle_no', width: 16 },
                { header: 'สาขาที่วิ่งงาน', key: 'branch_name', width: 22 },
                { header: 'ระยะทางขาไป (กม.)', key: 'dist_inbound', width: 18 },
                { header: 'ระยะทางขากลับ (กม.)', key: 'dist_outbound', width: 18 },
                { header: 'ระยะทางไป-กลับจริง (กม.)', key: 'dist_round_trip', width: 22 },
                { header: 'ค่าน้ำมันเที่ยวเดียว (บาท)', key: 'cost_one_way', width: 22 },
                { header: 'ค่าน้ำมันไป-กลับจริง (บาท)', key: 'cost_round_trip', width: 22 },
                { header: `สถานะเกณฑ์ (${mode === 'round-trip' ? 'ไป-กลับ' : 'เที่ยวเดียว'} > ${threshold} บ.)`, key: 'status', width: 24 },
                { header: 'ลิงก์ที่พัก Google Maps', key: 'map_url', width: 35 },
                { header: 'วันที่บันทึก/อัปเดต', key: 'updated_at', width: 20 }
            ];

            // Header styling
            const headerRow = sheet.getRow(1);
            headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            headerRow.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF1E40AF' } // Deep blue
            };
            headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

            let i = 1;
            for (const r of rows) {
                const inboundDist = r.distance_km;
                const outboundDist = r.distance_return_km != null ? r.distance_return_km : inboundDist;
                const roundTripDist = r.distance_round_trip_km != null ? r.distance_round_trip_km : parseFloat((inboundDist * 2).toFixed(2));

                const oneWay = calculateFuelCost(inboundDist, consumption, dieselPrice, 'one-way');
                const roundTrip = calculateFuelCost(inboundDist, consumption, dieselPrice, 'round-trip', roundTripDist);
                const activeCost = mode === 'round-trip' ? roundTrip : oneWay;
                const isOver = activeCost > threshold;

                const row = sheet.addRow({
                    no: i++,
                    employee_id: r.employee_id,
                    name: r.name,
                    vehicle_no: r.vehicle_no,
                    branch_name: r.branch_name,
                    dist_inbound: inboundDist,
                    dist_outbound: outboundDist,
                    dist_round_trip: roundTripDist,
                    cost_one_way: oneWay,
                    cost_round_trip: roundTrip,
                    status: isOver ? 'เกินเกณฑ์ (พิจารณาสวัสดิการ)' : 'ปกติ',
                    map_url: r.map_url,
                    updated_at: r.updated_at
                });

                if (isOver) {
                    row.getCell('status').font = { bold: true, color: { argb: 'FFDC2626' } }; // Red
                }
            }

            res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', 'attachment; filename="driver_travel_welfare_report.xlsx"');
            await workbook.xlsx.write(res);
            res.end();
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    return app;
}

if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    const dbPath = path.join(__dirname, '..', 'survey.db');
    const kmlPath = path.join(__dirname, '..', 'locations.kml');

    initDb(dbPath).then(async db => {
        await seedBranches(db, kmlPath);
        // Initial sync from Google Sheets if configured
        await syncFromGoogleSheets(db, true);
        const app = createApp(db);
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`=================================================`);
            console.log(` MWater Driver Travel Welfare System is running! `);
            console.log(` - Employee Form:    http://localhost:${PORT}/    `);
            console.log(` - Manager Dashboard:http://localhost:${PORT}/dashboard.html `);
            console.log(` - Default Manager Password: Mwater2026          `);
            console.log(`=================================================`);
        });
    }).catch(err => {
        console.error('Failed to start server:', err);
    });
}

module.exports = { createApp };
