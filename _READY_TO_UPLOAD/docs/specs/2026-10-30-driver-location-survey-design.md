# Design Document: ระบบสำรวจที่พักและคำนวณระยะทางเพื่อจัดสรรสวัสดิการเดินทาง (Driver Accommodation Survey & Travel Welfare System)

- **Date:** 2026-10-30
- **Author:** Watcharapol & Antigravity
- **Status:** Approved (Approach: Node.js + SQLite)
- **Tech Stack:** Node.js (Express), SQLite, ExcelJS, Leaflet.js, Tailwind CSS
- **Manager Default Password:** `Mwater2026`

---

## 1. Intent & The Why (ที่มาและวัตถุประสงค์)
องค์กรต้องการเก็บรวบรวมข้อมูลตำแหน่งที่พักปัจจุบันของพนักงานและผู้ประกอบการขนส่ง เพื่อนำมาคำนวณระยะทางจริงจากที่พักไปยังสาขาที่วิ่งงานประจำ นำข้อมูลค่าใช้จ่ายค่าน้ำมันจริงมาใช้ประกอบการพิจารณาจัดสรรสวัสดิการช่วยเหลือ โดยมุ่งเน้นกลุ่มที่มีภาระค่าใช้จ่ายในการเดินทางสูง (เบื้องต้นกำหนดเกณฑ์ไว้ที่ค่าน้ำมันเกิน 200 บาท)

---

## 2. Goals, Non-Goals & Anti-Goals

### Goals
- พนักงาน/คนขับสามารถกรอกข้อมูลได้สะดวกผ่านสมาร์ตโฟน (Mobile-friendly) โดยวางเพียงลิงก์ที่แชร์จาก Google Maps
- ระบบสามารถแปลงลิงก์ Google Maps (ทั้งลิงก์สั้น `maps.app.goo.gl` และลิงก์เต็ม) ออกมาเป็นพิกัด ละติจูด, ลองจิจูด ได้อย่างแม่นยำ
- ผู้จัดการสาขาสามารถเข้าดูแดชบอร์ดสรุปภาพรวมได้ทันที:
  - สรุปจำนวนและสัดส่วนเปอร์เซ็นต์ของรถที่มีค่าใช้จ่ายเกินเกณฑ์ที่กำหนด (ค่าตั้งต้น 200 บาท)
  - ปรับเปลี่ยนตัวแปรคำนวณได้อิสระ: ราคาน้ำมันดีเซลปัจจุบัน (บาท/ลิตร), อัตราสิ้นเปลือง (กม./ลิตร ค่าตั้งต้น 9), และเกณฑ์ค่าใช้จ่าย (บาท)
  - สลับโหมดการดูได้ทั้งแบบ **"เที่ยวเดียว" (One-way)** และ **"ไป-กลับ" (Round-trip)**
  - คัดกรอง (Filter) แสดงผลตามรายสาขาได้
  - แผนที่แสดงตำแหน่งที่พักและสาขา พร้อมตารางรายละเอียดพนักงานแต่ละคน
  - สามารถส่งออกข้อมูลเป็นไฟล์ Excel (.xlsx) หรือ CSV สำหรับนำไปสรุปการประชุมได้
- โครงสร้างฐานข้อมูลรองรับการอัปเดตข้อมูลพนักงาน/คนขับเข้ามาใหม่อย่างต่อเนื่องในอนาคต

### Non-Goals
- ระบบยังไม่ต้องมีระบบสแกนใบเสร็จค่าน้ำมันจริง (เน้นการประเมินจากระยะทางและอัตราสิ้นเปลืองมาตรฐาน)
- พนักงานยังไม่ต้องล็อกอินด้วยรหัสผ่านซับซ้อน (เน้นความง่ายในการส่งข้อมูล โดยใช้รหัสพนักงานและเบอร์รถเป็นตัวระบุ)

### Anti-Goals
- ไม่บีบให้พนักงานต้องเปิด GPS ตลอดเวลาหรือติดตั้งแอปพลิเคชันจาก App Store / Play Store
- ไม่เก็บข้อมูลที่ซับซ้อนเกินความจำเป็นของพนักงาน

---

## 3. Constraints (ข้อจำกัดและข้อกำหนด)
- แหล่งพิกัดสาขาตั้งต้น: ใช้ข้อมูลพิกัดทั้ง 24 แห่ง (สาขา/คลัง/โรงงาน) จาก `locations.kml` ที่มีอยู่เดิม
- ลิงก์ที่แชร์จาก Google Maps บนมือถือมักเป็นลิงก์ย่อ เช่น `https://maps.app.goo.gl/...` หรือ `https://goo.gl/maps/...` เซิร์ฟเวอร์ต้องทำการ Resolve HTTP Redirect เพื่อดึงพิกัดจริงออกมา
- รองรับการทำงานแบบ Offline หรือสำรองกรณีลิงก์เปิดไม่ได้: มีช่องแสดงให้ตรวจสอบหรือปรับแก้ไขพิกัดได้

---

## 4. Approaches Considered (แนวทางที่พิจารณา)
1. **Node.js (Express + SQLite) [เลือกแนวทางนี้]:** พร้อมรันบนเครื่องทันทีโดยไม่ต้องติดตั้ง runtime เพิ่มเติม (มี Node.js v24 + npm 11 ในเครื่องแล้ว), จัดการ URL redirect และ short links ได้รวดเร็ว, รองรับ SQLite ในตัว, ส่งออก Excel ด้วย ExcelJS ได้อย่างมีประสิทธิภาพ
2. **Python (FastAPI + SQLite + Pandas):** ต้องดาวน์โหลดติดตั้ง Python 3 บนระบบปฏิบัติการเพิ่มเติมก่อน
3. **Google Sheets + Apps Script:** ไม่ต้องตั้งเซิร์ฟเวอร์ แต่มีข้อจำกัดด้าน Quota การ Resolve Redirect URL ของ Google Maps และการแสดงผล Interactive Dashboard ทำได้จำกัด

---

## 5. System Architecture & Detailed Design

```
[ Mobile Phone (Employee) ] ────> POST /api/submit ───┐
                                                       ▼
[ Desktop/Tablet (Manager) ] <───> GET/PUT /api/...  [ Express.js Backend ]
                                                       │  - Google Maps URL Resolver (Redirect follow)
                                                       │  - Distance & Cost Calculator (OSRM + Haversine fallback)
                                                       │  - ExcelJS Exporter
                                                       ▼
                                                [ SQLite Database ]
                                                (submissions, branches, settings)
```

### 5.1 Database Schema (SQLite)
1. **Table: `branches`**
   - `id`: INTEGER PRIMARY KEY
   - `name`: TEXT (เช่น สาขาบางพลี, สาขาสุขุมวิท 50)
   - `category`: TEXT (สาขา / คลังสินค้า / โรงงาน)
   - `address`: TEXT
   - `latitude`: REAL
   - `longitude`: REAL
2. **Table: `submissions`**
   - `id`: INTEGER PRIMARY KEY AUTOINCREMENT
   - `employee_id`: TEXT UNIQUE (รหัสพนักงาน สำหรับใช้เป็นคีย์หลักในการ Upsert ข้อมูลล่าสุด)
   - `name`: TEXT (ชื่อ-นามสกุล)
   - `vehicle_no`: TEXT (เบอร์รถ / ทะเบียนรถ)
   - `branch_id`: INTEGER (FOREIGN KEY -> branches.id)
   - `map_url`: TEXT (ลิงก์ Google Maps ที่พนักงานกรอก)
   - `home_latitude`: REAL
   - `home_longitude`: REAL
   - `distance_km`: REAL (ระยะทางจริงตามถนน OSRM หรือ Haversine fallback)
   - `created_at`: DATETIME
   - `updated_at`: DATETIME
3. **Table: `system_settings`**
   - `diesel_price`: REAL (บาท/ลิตร)
   - `fuel_consumption`: REAL (กม./ลิตร, default = 9.0)
   - `threshold_cost`: REAL (บาท, default = 200.0)
   - `manager_password`: TEXT (ค่าเริ่มต้น `Mwater2026`)

### 5.2 Distance & Cost Calculation Formula
- **ระยะทาง ($D$):** คำนวณตามเส้นทางขับรถจริงบนถนน (Road Driving Distance ผ่าน OSRM API) และมีระบบ Fallback ไปใช้ Haversine × 1.25 อัตโนมัติหากมีปัญหาเรื่องเครือข่าย เพื่อให้คำนวณได้อย่างเสถียรที่สุด
- **ค่าน้ำมันต่อวัน ($C$):**
  - **แบบเที่ยวเดียว (One-way):**
    $$C_{\text{one-way}} = \frac{D}{\text{Fuel Consumption}} \times \text{Diesel Price}$$
  - **แบบไป-กลับ (Round-trip):**
    $$C_{\text{round-trip}} = 2 \times C_{\text{one-way}}$$
- **การตัดเกณฑ์:** ตรวจสอบว่า $C > \text{Threshold Cost}$ หรือไม่

### 5.3 Security & Access Control
- หน้าฟอร์มพนักงาน (`/`): เข้าใช้งานได้ทันที ไม่ต้องใส่รหัสผ่าน เพื่อความสะดวกรวดเร็วของคนขับ
- หน้าแดชบอร์ดผู้จัดการ (`/dashboard`): มีระบบล็อกอินด้วยรหัสผ่านผู้จัดการ (Default: `Mwater2026`) ป้องกันไม่ให้บุคคลภายนอกเข้าถึงข้อมูลพิกัดบ้านและข้อมูลส่วนบุคคลตาม พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล (PDPA)

### 5.3 User Interfaces
1. **Employee Submission Form (`/`):**
   - เรียบง่าย แสดงผลสบายตาบนหน้าจอมือถือ
   - ช่องกรอก: รหัสพนักงาน, ชื่อ-นามสกุล, เบอร์รถ
   - Dropdown: เลือกสาขาที่สังกัด (ค้นหาได้)
   - ช่องวางลิงก์ Google Maps พร้อมคำแนะนำวิธีแชร์ลิงก์จากแอป
   - ปักหมุดพิกัดอัตโนมัติ พร้อมปุ่มกดยืนยันส่งข้อมูล
2. **Manager Dashboard (`/dashboard`):**
   - **Header Cards:** 
     - จำนวนรถทั้งหมด
     - จำนวนรถที่เกินเกณฑ์ (คัน)
     - สัดส่วนเปอร์เซ็นต์ที่เกินเกณฑ์ (%)
     - ระยะทางเฉลี่ย (กม.)
   - **Interactive Control Bar:**
     - Toggle: สลับระหว่าง "เที่ยวเดียว (One-way)" กับ "ไป-กลับ (Round-trip)"
     - Dropdown: กรองตามรายสาขา (หรือดูภาพรวมทุกสาขา)
     - Input ปรับค่า Real-time: ราคาน้ำมันดีเซล, อัตราสิ้นเปลือง (กม./ลิตร), เกณฑ์วงเงิน (บาท)
   - **Visual Map:** แผนที่ Leaflet.js ปักหมุดสาขาและที่พักของพนักงาน (สีหมุดแยกตามสถานะ: ปกติ / เกินเกณฑ์)
   - **Data Table:** ตารางรายชื่อ, เบอร์รถ, สาขา, ระยะทาง, ค่าน้ำมัน, และสถานะ พร้อมปุ่ม "Export Excel"

---

## 6. What's Left to the Builder (สิ่งที่ให้ผู้พัฒนาตัดสินใจ)
- การเลือกใช้ CSS Framework (แนะนำ Tailwind CSS แบบ CDN เพื่อความทันสมัย โหลดเร็ว ไม่ต้อง build ซับซ้อน)
- การใช้ Leaflet.js / OpenStreetMap เพื่อให้แผนที่ทำงานได้โดยไม่ต้องเสียค่าบริการ Google Maps API Key
- กลไกการ Resolve Google Maps Short URL ใน Python ด้วย `httpx` หรือ `requests` เพื่อดึงค่า Location Redirect
