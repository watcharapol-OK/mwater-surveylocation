// Helper to sync submissions with Google Sheets Web App

const GOOGLE_SHEET_API_URL = process.env.GOOGLE_SHEET_API_URL || '';
let lastSyncTime = 0;
const SYNC_INTERVAL_MS = 60 * 1000; // sync at most once every minute on dashboard load

async function syncFromGoogleSheets(db, force = false) {
    const url = process.env.GOOGLE_SHEET_API_URL || GOOGLE_SHEET_API_URL;
    if (!url) return false;

    const now = Date.now();
    if (!force && (now - lastSyncTime < SYNC_INTERVAL_MS)) {
        return false;
    }

    try {
        const fetchUrl = url + (url.includes('?') ? '&' : '?') + 'action=get_submissions';
        const res = await fetch(fetchUrl, { method: 'GET', redirect: 'follow' });
        if (!res.ok) {
            console.error('[GoogleSheets] Sync failed HTTP status:', res.status);
            return false;
        }

        const json = await res.json();
        if (json.status !== 'ok' || !Array.isArray(json.data)) {
            console.error('[GoogleSheets] Invalid response:', json);
            return false;
        }

        const sheetRows = json.data;
        // Collect current employee_ids in Google Sheets
        const activeEmpIds = new Set();

        const upsertStmt = db.rawDb.prepare(`
            INSERT INTO submissions (
                employee_id, name, vehicle_no, branch_id, map_url,
                home_latitude, home_longitude, distance_km, distance_return_km,
                distance_round_trip_km, address_detail, postal_code, subdistrict, district, province, full_address,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                address_detail = excluded.address_detail,
                postal_code = excluded.postal_code,
                subdistrict = excluded.subdistrict,
                district = excluded.district,
                province = excluded.province,
                full_address = excluded.full_address,
                updated_at = excluded.updated_at
        `);

        for (const row of sheetRows) {
            if (!row.employee_id) continue;
            const empId = String(row.employee_id).trim();
            activeEmpIds.add(empId);

            // Safeguard: If Google Sheet column is missing or empty, preserve existing address from SQLite
            const existing = db.get('SELECT address_detail, postal_code, subdistrict, district, province, full_address FROM submissions WHERE employee_id = ?', [empId]);

            const addrDetail = row.address_detail ? String(row.address_detail).trim() : (existing && existing.address_detail ? existing.address_detail : '');
            const postCode = row.postal_code ? String(row.postal_code).trim() : (existing && existing.postal_code ? existing.postal_code : '');
            const subDist = row.subdistrict ? String(row.subdistrict).trim() : (existing && existing.subdistrict ? existing.subdistrict : '');
            const dist = row.district ? String(row.district).trim() : (existing && existing.district ? existing.district : '');
            const prov = row.province ? String(row.province).trim() : (existing && existing.province ? existing.province : '');
            const fullAddr = (row.full_address || row.address) ? String(row.full_address || row.address).trim() : (existing && existing.full_address ? existing.full_address : '');

            upsertStmt.run(
                empId,
                String(row.name || '').trim(),
                String(row.vehicle_no || '').trim(),
                parseInt(row.branch_id) || 1,
                String(row.map_url || '').trim(),
                parseFloat(row.home_latitude) || 0,
                parseFloat(row.home_longitude) || 0,
                parseFloat(row.distance_km) || 0,
                row.distance_return_km != null ? parseFloat(row.distance_return_km) : null,
                row.distance_round_trip_km != null ? parseFloat(row.distance_round_trip_km) : null,
                addrDetail,
                postCode,
                subDist,
                dist,
                prov,
                fullAddr,
                row.created_at || new Date().toISOString(),
                row.updated_at || new Date().toISOString()
            );

            // If SQLite had full_address but Sheet didn't have it, push back to Sheet!
            if (fullAddr && (!row.full_address && !row.address)) {
                pushToGoogleSheets({
                    employee_id: empId,
                    name: String(row.name || '').trim(),
                    vehicle_no: String(row.vehicle_no || '').trim(),
                    branch_id: parseInt(row.branch_id) || 1,
                    branch_name: String(row.branch_name || '').trim(),
                    map_url: String(row.map_url || '').trim(),
                    home_latitude: parseFloat(row.home_latitude) || 0,
                    home_longitude: parseFloat(row.home_longitude) || 0,
                    distance_km: parseFloat(row.distance_km) || 0,
                    distance_return_km: row.distance_return_km != null ? parseFloat(row.distance_return_km) : null,
                    distance_round_trip_km: row.distance_round_trip_km != null ? parseFloat(row.distance_round_trip_km) : null,
                    address_detail: addrDetail,
                    postal_code: postCode,
                    subdistrict: subDist,
                    district: dist,
                    province: prov,
                    full_address: fullAddr,
                    created_at: row.created_at,
                    updated_at: row.updated_at
                }).catch(e => console.error('[GoogleSheets] Auto-backfill error:', e.message));
            }
        }

        // If Google Sheet has records, delete any local submissions that are no longer in Google Sheets
        // (meaning they were deleted in Sheet)
        if (sheetRows.length > 0) {
            const localRows = db.all('SELECT employee_id FROM submissions');
            const deleteStmt = db.rawDb.prepare('DELETE FROM submissions WHERE employee_id = ?');
            for (const lr of localRows) {
                if (!activeEmpIds.has(lr.employee_id)) {
                    deleteStmt.run(lr.employee_id);
                }
            }
        } else {
            // If Google Sheet is empty, seed current local SQLite submissions to Google Sheet
            const localRows = db.all(`
                SELECT s.*, b.name as branch_name 
                FROM submissions s 
                LEFT JOIN branches b ON s.branch_id = b.id
            `);
            if (localRows.length > 0) {
                console.log(`[GoogleSheets] Sheet is empty. Seeding ${localRows.length} existing records to Sheet...`);
                for (const lr of localRows) {
                    await pushToGoogleSheets(lr);
                }
            }
        }

        lastSyncTime = now;
        console.log(`[GoogleSheets] Successfully synced ${sheetRows.length} rows from Google Sheets!`);
        return true;
    } catch (err) {
        console.error('[GoogleSheets] Error syncing from sheets:', err.message);
        return false;
    }
}

async function pushToGoogleSheets(data) {
    const url = process.env.GOOGLE_SHEET_API_URL || GOOGLE_SHEET_API_URL;
    if (!url) return false;

    try {
        const payload = {
            action: 'upsert',
            employee_id: data.employee_id,
            name: data.name,
            vehicle_no: data.vehicle_no,
            branch_id: data.branch_id,
            branch_name: data.branch_name,
            map_url: data.map_url,
            home_latitude: data.home_latitude,
            home_longitude: data.home_longitude,
            distance_km: data.distance_km,
            distance_return_km: data.distance_return_km,
            distance_round_trip_km: data.distance_round_trip_km,
            address_detail: data.address_detail || '',
            postal_code: data.postal_code || '',
            subdistrict: data.subdistrict || '',
            district: data.district || '',
            province: data.province || '',
            full_address: data.full_address || '',
            created_at: data.created_at || new Date().toISOString(),
            updated_at: data.updated_at || new Date().toISOString()
        };

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            redirect: 'follow'
        });
        const resJson = await res.json();
        console.log('[GoogleSheets] Push result:', resJson);
        return true;
    } catch (err) {
        console.error('[GoogleSheets] Push error:', err.message);
        return false;
    }
}

async function deleteFromGoogleSheets(employeeId) {
    const url = process.env.GOOGLE_SHEET_API_URL || GOOGLE_SHEET_API_URL;
    if (!url || !employeeId) return false;

    try {
        const payload = {
            action: 'delete',
            employee_id: String(employeeId).trim()
        };

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            redirect: 'follow'
        });
        const resJson = await res.json();
        console.log('[GoogleSheets] Delete result:', resJson);
        return true;
    } catch (err) {
        console.error('[GoogleSheets] Delete error:', err.message);
        return false;
    }
}

module.exports = {
    syncFromGoogleSheets,
    pushToGoogleSheets,
    deleteFromGoogleSheets
};
