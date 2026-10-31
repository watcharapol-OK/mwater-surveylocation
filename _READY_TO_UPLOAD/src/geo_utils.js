/**
 * Utility functions for Google Maps URL resolution and Distance/Cost calculations.
 */

function parseCoordinatesFromText(text) {
    if (!text || typeof text !== 'string') return null;
    const cleanText = decodeURIComponent(text).trim();

    // 1. Direct "lat, lng" e.g. "13.723081, 100.550036"
    const directRegex = /^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/;
    const directMatch = directRegex.exec(cleanText);
    if (directMatch) {
        return {
            lat: parseFloat(directMatch[1]),
            lng: parseFloat(directMatch[2])
        };
    }

    // 2. Query param ?q=lat,lng or ?ll=lat,lng or query=lat,lng or destination=lat,lng
    const queryRegex = /[?&](?:q|ll|query|destination)=(-?\d{1,2}\.\d+)[,\s]+(-?\d{1,3}\.\d+)/;
    const queryMatch = queryRegex.exec(cleanText);
    if (queryMatch) {
        return {
            lat: parseFloat(queryMatch[1]),
            lng: parseFloat(queryMatch[2])
        };
    }

    // 3. Path @lat,lng,zoom e.g. /@13.699491,100.587957,15z
    const pathRegex = /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/;
    const pathMatch = pathRegex.exec(cleanText);
    if (pathMatch) {
        return {
            lat: parseFloat(pathMatch[1]),
            lng: parseFloat(pathMatch[2])
        };
    }

    // 4. Fallback search anywhere in string for valid Thailand coordinate range (lat ~5-21, lng ~97-106)
    const anyCoordRegex = /(-?\d{1,2}\.\d{4,})[,\s]+(-?\d{1,3}\.\d{4,})/;
    const anyMatch = anyCoordRegex.exec(cleanText);
    if (anyMatch) {
        const lat = parseFloat(anyMatch[1]);
        const lng = parseFloat(anyMatch[2]);
        if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
            return { lat, lng };
        }
    }

    return null;
}

async function resolveGoogleMapsUrl(inputUrl) {
    if (!inputUrl || typeof inputUrl !== 'string') {
        throw new Error('กรุณาระบุลิงก์หรือพิกัด');
    }

    const trimmed = inputUrl.trim();
    // First check if it already contains readable coordinates
    const directCoords = parseCoordinatesFromText(trimmed);
    if (directCoords) {
        return directCoords;
    }

    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
        throw new Error('รูปแบบลิงก์ไม่ถูกต้อง กรุณาใส่ลิงก์ที่ขึ้นต้นด้วย https://');
    }

    try {
        // Follow redirects using fetch
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);

        const response = await fetch(trimmed, {
            method: 'GET',
            redirect: 'follow',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        const finalUrl = response.url;
        let coords = parseCoordinatesFromText(finalUrl);
        if (coords) return coords;

        // If not in URL, check HTML body for meta og:url or schema.org or google maps script data
        const bodyText = await response.text();
        coords = parseCoordinatesFromText(bodyText);
        if (coords) return coords;

        // Try extracting from /place/... or !3dlat!4dlng in Google Maps URLs
        const placeRegex = /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/;
        const placeMatch = placeRegex.exec(finalUrl) || placeRegex.exec(bodyText);
        if (placeMatch) {
            return {
                lat: parseFloat(placeMatch[1]),
                lng: parseFloat(placeMatch[2])
            };
        }

        throw new Error('ไม่สามารถถอดพิกัดจากลิงก์นี้ได้ กรุณาตรวจสอบหรือใส่พิกัด ละติจูด,ลองจิจูด โดยตรง');
    } catch (err) {
        if (err.name === 'AbortError') {
            throw new Error('การเชื่อมต่อไปยังลิงก์ใช้เวลานานเกินไป กรุณาลองใหม่อีกครั้ง');
        }
        throw err;
    }
}

/**
 * Calculates straight line distance using Haversine formula (km)
 */
function haversineDistanceKm(lat1, lon1, lat2, lon2) {
    const toRad = x => (x * Math.PI) / 180;
    const R = 6371; // Earth radius in km

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return parseFloat((R * c).toFixed(2));
}

/**
 * Calculates road driving distance using OSRM, with fallback to Haversine * 1.25
 */
async function calculateDistanceKm(lat1, lon1, lat2, lon2) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);

        // OSRM coordinates are in format: {longitude},{latitude}
        const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${lon1},${lat1};${lon2},${lat2}?overview=false`;
        const res = await fetch(osrmUrl, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
            const data = await res.json();
            if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
                const distanceKm = parseFloat((data.routes[0].distance / 1000).toFixed(2));
                return { distanceKm, method: 'osrm' };
            }
        }
    } catch (err) {
        // Fallback on timeout or network error
    }

    const straight = haversineDistanceKm(lat1, lon1, lat2, lon2);
    const estimatedRoad = parseFloat((straight * 1.25).toFixed(2));
    return { distanceKm: estimatedRoad, method: 'haversine' };
}

/**
 * Calculates both inbound (home -> branch) and outbound (branch -> home) road distances separately
 * taking into account U-turns, one-way roads, and divided highways.
 */
async function calculateBothDirectionsKm(homeLat, homeLng, branchLat, branchLng) {
    const [inbound, outbound] = await Promise.all([
        calculateDistanceKm(homeLat, homeLng, branchLat, branchLng), // ขาไป: ที่พัก -> สาขา
        calculateDistanceKm(branchLat, branchLng, homeLat, homeLng)  // ขากลับ: สาขา -> ที่พัก
    ]);

    const inboundKm = inbound.distanceKm;
    const outboundKm = outbound.distanceKm;
    const roundTripKm = parseFloat((inboundKm + outboundKm).toFixed(2));

    return {
        inboundKm,
        outboundKm,
        roundTripKm,
        method: inbound.method
    };
}

/**
 * Calculates fuel cost
 * @param {number} distanceKm
 * @param {number} fuelConsumption (km/L)
 * @param {number} dieselPrice (THB/L)
 * @param {'one-way'|'round-trip'} mode
 * @param {number} [roundTripDistanceKm] Optional explicit round-trip distance
 */
function calculateFuelCost(distanceKm, fuelConsumption, dieselPrice, mode = 'one-way', roundTripDistanceKm = null) {
    const consumption = parseFloat(fuelConsumption) || 9.0;
    const price = parseFloat(dieselPrice) || 32.94;
    const dist = parseFloat(distanceKm) || 0;

    if (mode === 'round-trip') {
        const rtDist = roundTripDistanceKm !== null && roundTripDistanceKm !== undefined
            ? parseFloat(roundTripDistanceKm)
            : dist * 2;
        return parseFloat(((rtDist / consumption) * price).toFixed(2));
    }
    return parseFloat(((dist / consumption) * price).toFixed(2));
}

module.exports = {
    parseCoordinatesFromText,
    resolveGoogleMapsUrl,
    haversineDistanceKm,
    calculateDistanceKm,
    calculateBothDirectionsKm,
    calculateFuelCost
};
