const path = require('path');
const { initDb, seedBranches } = require('../src/db');
const { calculateBothDirectionsKm } = require('../src/geo_utils');

async function seedSamples() {
    console.log('Seeding sample drivers with separate inbound & outbound road routing...');
    const db = await initDb(path.join(__dirname, '..', 'survey.db'));
    await seedBranches(db, path.join(__dirname, '..', 'locations.kml'));

    const branches = db.all('SELECT * FROM branches');
    const bBangPhli = branches.find(b => b.name.includes('บางพลี')) || branches[0];
    const bSukhumvit = branches.find(b => b.name.includes('สุขุมวิท 50')) || branches[1];
    const bRangsit = branches.find(b => b.name.includes('ปทุมธานี')) || branches[2];

    const samples = [
        {
            employee_id: 'DRV001',
            name: 'นายสมศักดิ์ ขยันยิ่ง',
            vehicle_no: 'เบอร์ 01',
            branch_id: bBangPhli.id,
            map_url: 'https://maps.google.com/?q=13.684045,100.549038',
            home_lat: 13.684045,
            home_lng: 100.549038,
            branch_lat: bBangPhli.latitude,
            branch_lng: bBangPhli.longitude
        },
        {
            employee_id: 'DRV002',
            name: 'นายวิชัย มานะดี',
            vehicle_no: 'เบอร์ 05',
            branch_id: bBangPhli.id,
            map_url: 'https://maps.google.com/?q=13.614945,100.700506',
            home_lat: 13.614945,
            home_lng: 100.700506,
            branch_lat: bBangPhli.latitude,
            branch_lng: bBangPhli.longitude
        },
        {
            employee_id: 'DRV003',
            name: 'นายอนุรักษ์ เจริญผล',
            vehicle_no: 'เบอร์ 12',
            branch_id: bSukhumvit.id,
            map_url: 'https://maps.google.com/?q=13.832644,100.714442',
            home_lat: 13.832644,
            home_lng: 100.714442,
            branch_lat: bSukhumvit.latitude,
            branch_lng: bSukhumvit.longitude
        },
        {
            employee_id: 'DRV004',
            name: 'นายประสิทธิ์ สุขใจ',
            vehicle_no: 'เบอร์ 18',
            branch_id: bRangsit.id,
            map_url: 'https://maps.google.com/?q=14.271601,100.756609',
            home_lat: 14.271601,
            home_lng: 100.756609,
            branch_lat: bRangsit.latitude,
            branch_lng: bRangsit.longitude
        }
    ];

    for (const s of samples) {
        const dir = await calculateBothDirectionsKm(s.home_lat, s.home_lng, s.branch_lat, s.branch_lng);
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
            s.employee_id, s.name, s.vehicle_no, s.branch_id, s.map_url,
            s.home_lat, s.home_lng, dir.inboundKm, dir.outboundKm, dir.roundTripKm
        ]);
        console.log(`Seeded ${s.name} (${s.vehicle_no}) - Inbound: ${dir.inboundKm} km | Outbound: ${dir.outboundKm} km | Round-trip: ${dir.roundTripKm} km`);
    }

    console.log('Sample drivers updated successfully!');
    db.close();
}

seedSamples().catch(console.error);
