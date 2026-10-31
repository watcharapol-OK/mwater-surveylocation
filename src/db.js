const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

let activeDb = null;

function parseKml(kmlContent) {
    const branches = [];
    const folderRegex = /<Folder>([\s\S]*?)<\/Folder>/g;
    let folderMatch;

    while ((folderMatch = folderRegex.exec(kmlContent)) !== null) {
        const folderContent = folderMatch[1];
        const categoryMatch = /<name>(.*?)<\/name>/.exec(folderContent);
        const category = categoryMatch ? categoryMatch[1].trim() : 'ทั่วไป';

        const placemarkRegex = /<Placemark>([\s\S]*?)<\/Placemark>/g;
        let pMatch;
        while ((pMatch = placemarkRegex.exec(folderContent)) !== null) {
            const pContent = pMatch[1];
            const nameMatch = /<name>(.*?)<\/name>/.exec(pContent);
            const descMatch = /<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/.exec(pContent);
            const coordMatch = /<coordinates>([\s\S]*?)<\/coordinates>/.exec(pContent);

            if (nameMatch && coordMatch) {
                const name = nameMatch[1].trim();
                const address = descMatch ? descMatch[1].replace(/<br>/gi, '\n').trim() : '';
                const coordsRaw = coordMatch[1].trim().split(',');
                const lng = parseFloat(coordsRaw[0]);
                const lat = parseFloat(coordsRaw[1]);

                if (!isNaN(lat) && !isNaN(lng)) {
                    branches.push({ name, category, address, latitude: lat, longitude: lng });
                }
            }
        }
    }
    return branches;
}

class DbWrapper {
    constructor(filePath) {
        this.rawDb = new DatabaseSync(filePath);
        this.createTables();
    }

    createTables() {
        this.rawDb.exec(`
            CREATE TABLE IF NOT EXISTS branches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                category TEXT,
                address TEXT,
                latitude REAL NOT NULL,
                longitude REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS submissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                employee_id TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                vehicle_no TEXT NOT NULL,
                branch_id INTEGER NOT NULL,
                map_url TEXT NOT NULL,
                home_latitude REAL NOT NULL,
                home_longitude REAL NOT NULL,
                distance_km REAL NOT NULL,
                distance_return_km REAL,
                distance_round_trip_km REAL,
                address_detail TEXT,
                postal_code TEXT,
                subdistrict TEXT,
                district TEXT,
                province TEXT,
                full_address TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (branch_id) REFERENCES branches(id)
            );

            CREATE TABLE IF NOT EXISTS system_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        `);

        // Migrate existing table if columns don't exist
        try {
            this.rawDb.exec(`ALTER TABLE submissions ADD COLUMN distance_return_km REAL;`);
        } catch (e) {}
        try {
            this.rawDb.exec(`ALTER TABLE submissions ADD COLUMN distance_round_trip_km REAL;`);
        } catch (e) {}
        try { this.rawDb.exec(`ALTER TABLE submissions ADD COLUMN address_detail TEXT;`); } catch (e) {}
        try { this.rawDb.exec(`ALTER TABLE submissions ADD COLUMN postal_code TEXT;`); } catch (e) {}
        try { this.rawDb.exec(`ALTER TABLE submissions ADD COLUMN subdistrict TEXT;`); } catch (e) {}
        try { this.rawDb.exec(`ALTER TABLE submissions ADD COLUMN district TEXT;`); } catch (e) {}
        try { this.rawDb.exec(`ALTER TABLE submissions ADD COLUMN province TEXT;`); } catch (e) {}
        try { this.rawDb.exec(`ALTER TABLE submissions ADD COLUMN full_address TEXT;`); } catch (e) {}

        // Set default system settings if not exists
        const defaults = [
            ['diesel_price', '32.94'],
            ['fuel_consumption', '9.0'],
            ['threshold_cost', '200.0'],
            ['manager_password', 'Mwater2026']
        ];
        const stmt = this.rawDb.prepare('INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)');
        for (const [k, v] of defaults) {
            stmt.run(k, v);
        }
    }

    all(sql, params = [], callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        try {
            const stmt = this.rawDb.prepare(sql);
            const rows = stmt.all(...params);
            if (callback) callback(null, rows);
            return rows;
        } catch (err) {
            if (callback) callback(err);
            else throw err;
        }
    }

    get(sql, params = [], callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        try {
            const stmt = this.rawDb.prepare(sql);
            const row = stmt.get(...params);
            if (callback) callback(null, row);
            return row;
        } catch (err) {
            if (callback) callback(err);
            else throw err;
        }
    }

    run(sql, params = [], callback) {
        if (typeof params === 'function') {
            callback = params;
            params = [];
        }
        try {
            const stmt = this.rawDb.prepare(sql);
            const result = stmt.run(...params);
            if (callback) callback.call(result, null);
            return result;
        } catch (err) {
            if (callback) callback(err);
            else throw err;
        }
    }

    close() {
        this.rawDb.close();
    }
}

async function initDb(dbPath = path.join(__dirname, '..', 'survey.db')) {
    activeDb = new DbWrapper(dbPath);
    return activeDb;
}

function getDb() {
    if (!activeDb) {
        activeDb = new DbWrapper(path.join(__dirname, '..', 'survey.db'));
    }
    return activeDb;
}

async function seedBranches(db, kmlPath = path.join(__dirname, '..', 'locations.kml')) {
    const kmlContent = fs.readFileSync(kmlPath, 'utf8');
    const branches = parseKml(kmlContent);

    const checkCount = db.get('SELECT COUNT(*) as count FROM branches');
    if (checkCount && checkCount.count > 0) {
        return checkCount.count;
    }

    const insertStmt = db.rawDb.prepare(`
        INSERT INTO branches (name, category, address, latitude, longitude)
        VALUES (?, ?, ?, ?, ?)
    `);

    for (const b of branches) {
        insertStmt.run(b.name, b.category, b.address, b.latitude, b.longitude);
    }

    const finalCount = db.get('SELECT COUNT(*) as count FROM branches');
    return finalCount.count;
}

module.exports = {
    initDb,
    getDb,
    seedBranches,
    parseKml,
    DbWrapper
};
