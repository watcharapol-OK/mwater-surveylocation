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
                distance_round_trip_km, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                updated_at = excluded.updated_at
        `);

        for (const row of sheetRows) {
            if (!row.employee_id) continue;
            const empId = String(row.employee_id).trim();
            activeEmpIds.add(empId);

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
                row.created_at || new Date().toISOString(),
                row.updated_at || new Date().toISOString()
            );
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
