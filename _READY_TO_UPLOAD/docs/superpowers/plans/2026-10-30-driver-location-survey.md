# Driver Accommodation Survey & Travel Welfare System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete Node.js web application for drivers to submit their home accommodation via Google Maps shared links and for branch managers to analyze travel distances, fuel costs, and welfare eligibility on an interactive dashboard.

**Architecture:** A lightweight Express backend with SQLite database, utilizing native fetch for Google Maps short-URL resolution, hybrid OSRM/Haversine distance calculation, and ExcelJS for reporting. The frontend provides a mobile-first submission form for drivers and an authenticated responsive dashboard with Leaflet.js map visualization for managers.

**Tech Stack:** Node.js v24, Express, SQLite (`better-sqlite3` or `sqlite3`), ExcelJS, Leaflet.js, Tailwind CSS (CDN).

**Spec:** `docs/specs/2026-10-30-driver-location-survey-design.md`

## Global Constraints
- Must run cleanly on Windows using installed Node.js v24 and npm without external native compilation failures.
- Branch dataset: must seed exactly the 24 branch/warehouse/factory locations extracted from `locations.kml`.
- Default Manager Password: `Mwater2026`.
- Default Fuel Consumption: `9.0` km/L.
- Default Welfare Threshold: `200.0` THB.
- Real-time calculation: changing diesel price or consumption rate on dashboard recalculates trip costs immediately for both One-way and Round-trip modes.

## Review Focus
1. **Google Maps Short URL (`maps.app.goo.gl` or `goo.gl/maps`):** Must follow HTTP 301/302 redirects to extract destination `?q=lat,lng` or `@lat,lng` coordinates reliably.
2. **Offline/Routing Failure Fallback:** If OSRM routing API is unreachable or rate-limited, must gracefully fall back to Haversine × 1.25 without crashing or failing the submission.
3. **Duplicate Submission Handling:** If a driver re-submits with the same `employee_id`, system must update the record rather than creating a duplicate row.
4. **Data Privacy (PDPA):** Manager dashboard (`/dashboard` and `/api/submissions`) must be protected by password authentication (`Mwater2026`).
5. **Mobile Viewport Usability:** Employee form must render smoothly on mobile touchscreens with clear Thai instructions on how to share a location from Google Maps.

---

### Task 1: Project Initialization & Database Layer with 24 Branches Seed

**Files:**
- Create: `package.json`
- Create: `src/db.js`
- Create: `src/seed_branches.js`
- Test: `test/db.test.js`

**Interfaces:**
- Produces: `getDb()`, `initDb()`, `seedBranches(kmlPath)`

- [ ] **Step 1: Write the failing test**
Create `test/db.test.js` verifying database tables creation and that 24 branches are seeded with valid latitude/longitude coordinates.

- [ ] **Step 2: Run test to verify it fails**
Run: `node test/db.test.js`
Expected: FAIL (modules not found)

- [ ] **Step 3: Implement dependencies and database module**
Run `npm.cmd init -y` and install `express`, `sqlite3` (or `better-sqlite3`), `exceljs`.
Implement `src/db.js` to create tables `branches`, `submissions`, `system_settings`.
Implement `src/seed_branches.js` to parse `locations.kml` and populate the `branches` table with 24 records.

- [ ] **Step 4: Run test to verify it passes**
Run: `node test/db.test.js`
Expected: PASS (24 branches verified in database)

---

### Task 2: Google Maps Link Parser & Hybrid Distance Calculator

**Files:**
- Create: `src/geo_utils.js`
- Test: `test/geo_utils.test.js`

**Interfaces:**
- Consumes: Google Maps URL or raw coordinates string
- Produces: 
  - `resolveGoogleMapsUrl(url: string) -> Promise<{lat: number, lng: number}>`
  - `calculateDistanceKm(lat1, lng1, lat2, lng2) -> Promise<{distanceKm: number, method: 'osrm' | 'haversine'}>`
  - `calculateFuelCost(distanceKm, fuelConsumption, dieselPrice, mode: 'one-way' | 'round-trip') -> number`

- [ ] **Step 1: Write the failing test**
Create `test/geo_utils.test.js` testing:
- Parsing URL formats: `https://maps.app.goo.gl/...`, `https://www.google.com/maps?q=13.72,100.55`, `13.72, 100.55`
- Distance calculation between two known Bangkok points (e.g. Rama 4 to Sukhumvit 50)
- One-way vs Round-trip cost formula: $C = \frac{D}{\text{Consumption}} \times \text{Price}$ (and $\times 2$)

- [ ] **Step 2: Run test to verify it fails**
Run: `node test/geo_utils.test.js`
Expected: FAIL (`geo_utils.js` not found)

- [ ] **Step 3: Implement `src/geo_utils.js`**
Implement HTTP redirect resolution using native `fetch` with regex extractors for `@lat,lng` and `q=lat,lng`.
Implement OSRM routing request (`https://router.project-osrm.org/route/v1/driving/...`) with automatic timeout/fallback to Haversine formula $\times 1.25$.

- [ ] **Step 4: Run test to verify it passes**
Run: `node test/geo_utils.test.js`
Expected: PASS

---

### Task 3: Backend API Endpoints (Express Server)

**Files:**
- Create: `src/server.js`
- Test: `test/api.test.js`

**Interfaces:**
- Endpoints:
  - `GET /api/branches`: returns 24 branches
  - `POST /api/resolve-link`: test/preview coordinates from link
  - `POST /api/submit`: `{ employee_id, name, vehicle_no, branch_id, map_url }`
  - `POST /api/auth/login`: `{ password }` returns session token
  - `GET /api/submissions`: returns submission list with calculated distance & costs
  - `GET /api/settings`: returns current diesel price, consumption rate, threshold
  - `PUT /api/settings`: updates parameters
  - `GET /api/export`: downloads Excel `.xlsx` file

- [ ] **Step 1: Write the failing test**
Create `test/api.test.js` testing branch list retrieval, submitting a new driver, verifying upsert on re-submission with same `employee_id`, and manager authentication check.

- [ ] **Step 2: Run test to verify it fails**
Run: `node test/api.test.js`
Expected: FAIL (server not running or routes missing)

- [ ] **Step 3: Implement `src/server.js`**
Configure Express routes with JSON body parser, static file serving from `public/`, and API route handlers.
Implement Excel export using `exceljs` with styled header columns (รหัส, ชื่อ, เบอร์รถ, สาขา, ระยะทาง, ค่าน้ำมันเที่ยวเดียว, ค่าน้ำมันไป-กลับ, สถานะสวัสดิการ).

- [ ] **Step 4: Run test to verify it passes**
Run: `node test/api.test.js`
Expected: PASS

---

### Task 4: Employee Mobile Submission View

**Files:**
- Create: `public/index.html`
- Create: `public/js/submit.js`
- Create: `public/css/style.css`

**Features:**
- Clean, modern Thai UI designed for smartphone screens.
- Searchable dropdown of 24 branches.
- Input fields: รหัสพนักงาน, ชื่อ-นามสกุล, เบอร์รถ.
- Google Maps link input with button "ตรวจสอบพิกัด" (checks link, shows green confirmation with resolved coordinates).
- Visual guide modal: "วิธีแชร์ตำแหน่งจาก Google Maps" (3-step visual instruction).
- Submit button with loading spinner and clear success feedback banner.

- [ ] **Step 1: Create HTML structure with Tailwind CSS**
- [ ] **Step 2: Connect frontend script `submit.js` to `/api/branches` and `/api/submit`**
- [ ] **Step 3: Test submission in browser/curl**

---

### Task 5: Manager Dashboard & Interactive Analytics View

**Files:**
- Create: `public/dashboard.html`
- Create: `public/js/dashboard.js`
- Create: `public/login.html`

**Features:**
- Authentication gate with password `Mwater2026`.
- **Top Metrics Cards:**
  - จำนวนรถทั้งหมด (Total Vehicles)
  - จำนวนรถที่เกินเกณฑ์ (Vehicles > 200 THB)
  - สัดส่วนเปอร์เซ็นต์ (Percentage %)
  - ระยะทางเฉลี่ย (Average Distance km)
- **Live Parameter Control Bar:**
  - ราคาน้ำมันดีเซล (บาท/ลิตร - ค่าตั้งต้นดึงราคาปัจจุบันในไทย ~32.94 บาท)
  - อัตราสิ้นเปลือง (กม./ลิตร - ค่าตั้งต้น 9.0)
  - เกณฑ์ค่าใช้จ่าย (บาท - ค่าตั้งต้น 200.0)
  - สวิตช์สลับโหมด: "เที่ยวเดียว (One-way)" vs "ไป-กลับ (Round-trip)"
  - ตัวเลือกกรองรายสาขา (Filter by Branch)
- **Interactive Leaflet.js Map:**
  - หมุดสีน้ำเงิน = สาขา/คลังสินค้า
  - หมุดสีเขียว = รถที่ไม่เกินเกณฑ์
  - หมุดสีแดง = รถที่เกินเกณฑ์ 200 บาท (พร้อมเส้นประเชื่อมโยงไปยังสาขาที่สังกัดเมื่อคลิก)
- **Data Table:**
  - ค้นหาและจัดเรียงตามระยะทาง/ค่าใช้จ่าย
  - ปุ่ม "ส่งออกข้อมูลเป็น Excel (.xlsx)"

- [ ] **Step 1: Create Dashboard UI and Login gate**
- [ ] **Step 2: Integrate Leaflet.js map with custom markers**
- [ ] **Step 3: Implement client-side dynamic recalculation when inputs/toggles change**
- [ ] **Step 4: Connect Excel export trigger**

---

### Task 6: End-to-End Verification & Documentation

**Files:**
- Create: `README.md` (instructions to start server, access ports, and usage guide)

- [ ] **Step 1: Start application server (`node src/server.js`)**
- [ ] **Step 2: Submit sample driver records from multiple branches**
- [ ] **Step 3: Verify dashboard displays correct statistics, map markers, threshold badges, and one-way vs round-trip switching**
- [ ] **Step 4: Download and verify exported Excel file**
- [ ] **Step 5: Write `README.md` with simple startup commands**
