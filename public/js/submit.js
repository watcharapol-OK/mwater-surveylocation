// Employee Submission View Logic
let miniMap = null;
let miniMarker = null;

document.addEventListener('DOMContentLoaded', () => {
    loadBranches();
    initEventListeners();
});

async function loadBranches() {
    const select = document.getElementById('branch_id');
    try {
        const res = await fetch('/api/branches');
        const branches = await res.json();

        select.innerHTML = '<option value="">-- กรุณาเลือกสาขาที่คุณวิ่งงานประจำ --</option>';

        // Group by category
        const groups = {};
        for (const b of branches) {
            const cat = b.category || 'สาขา';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(b);
        }

        for (const [category, items] of Object.entries(groups)) {
            const optgroup = document.createElement('optgroup');
            optgroup.label = `หมวด: ${category}`;
            for (const b of items) {
                const opt = document.createElement('option');
                opt.value = b.id;
                // ตัดข้อความ (คลังสินค้า) ออกไปเลย แต่วงเล็บอื่นๆ (เช่น น้ำดื่ม 18.9 ลิตร, น้ำขวด PET) ยังคงไว้เหมือนเดิม
                let displayName = b.name.replace(/\(คลังสินค้า\)/g, '').trim();
                if (b.category && b.category !== 'คลังสินค้า' && !displayName.includes(b.category)) {
                    displayName += ` (${b.category})`;
                }
                opt.textContent = displayName;
                optgroup.appendChild(opt);
            }
            select.appendChild(optgroup);
        }
    } catch (err) {
        select.innerHTML = '<option value="">เกิดข้อผิดพลาดในการโหลดรายชื่อสาขา</option>';
    }
}

function initEventListeners() {
    // Help Modal
    const helpModal = document.getElementById('helpModal');
    const btnHelp = document.getElementById('btnHelpModal');
    const btnCloseHelp = document.getElementById('btnCloseHelp');
    const btnGotIt = document.getElementById('btnGotIt');

    btnHelp.addEventListener('click', () => helpModal.classList.remove('hidden'));
    btnCloseHelp.addEventListener('click', () => helpModal.classList.add('hidden'));
    btnGotIt.addEventListener('click', () => helpModal.classList.add('hidden'));
    helpModal.addEventListener('click', (e) => {
        if (e.target === helpModal) helpModal.classList.add('hidden');
    });

    // Check link button
    const btnCheck = document.getElementById('btnCheckLink');
    btnCheck.addEventListener('click', () => checkCoordinates(false));

    // GPS Geolocation button
    const btnUseGps = document.getElementById('btnUseGps');
    btnUseGps.addEventListener('click', () => {
        if (!navigator.geolocation) {
            alert('เบราว์เซอร์ของคุณไม่รองรับการดึงพิกัด GPS');
            return;
        }

        btnUseGps.textContent = '⏳ กำลังดึงพิกัด...';
        btnUseGps.disabled = true;

        const onGpsSuccess = (pos) => {
            btnUseGps.textContent = '📍 ดึงพิกัดจาก GPS ปัจจุบัน';
            btnUseGps.disabled = false;
            const lat = pos.coords.latitude.toFixed(6);
            const lng = pos.coords.longitude.toFixed(6);
            document.getElementById('map_url').value = `${lat}, ${lng}`;
            showCoordinatesPreview(parseFloat(lat), parseFloat(lng));
        };

        const onGpsFail = (err) => {
            // ลองดึงแบบ Low accuracy สำรอง (สำหรับเครื่อง PC / WiFi ในอาคาร)
            navigator.geolocation.getCurrentPosition(
                onGpsSuccess,
                (finalErr) => {
                    btnUseGps.textContent = '📍 ดึงพิกัดจาก GPS ปัจจุบัน';
                    btnUseGps.disabled = false;

                    let msg = 'ไม่สามารถดึงพิกัดอัตโนมัติได้';
                    if (finalErr.code === 1) {
                        msg = 'เบราว์เซอร์ไม่ได้รับอนุญาตให้เข้าถึงตำแหน่ง (โปรดกดอนุญาต Location ที่ไอคอนรูปกุญแจหน้าแถบ URL)';
                    } else if (finalErr.code === 3) {
                        msg = 'หมดเวลาเชื่อมต่อ GPS (หากเปิดบนคอมพิวเตอร์ที่ไม่มีชิป GPS แนะนำให้กดปุ่ม "จิ้มเลือกบนแผนที่" หรือวางลิงก์จาก Google Maps แทนครับ)';
                    }
                    alert(msg);
                },
                { enableHighAccuracy: false, timeout: 6000, maximumAge: 60000 }
            );
        };

        navigator.geolocation.getCurrentPosition(
            onGpsSuccess,
            onGpsFail,
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 30000 }
        );
    });

    // Map Picker button
    const btnOpenMap = document.getElementById('btnOpenMapPicker');
    if (btnOpenMap) {
        btnOpenMap.addEventListener('click', () => {
            let defaultLat = 13.7563;
            let defaultLng = 100.5018;

            const currentVal = document.getElementById('map_url').value.trim();
            const match = /(-?\d{1,2}\.\d+)[,\s]+(-?\d{1,3}\.\d+)/.exec(currentVal);
            if (match) {
                defaultLat = parseFloat(match[1]);
                defaultLng = parseFloat(match[2]);
            }

            document.getElementById('map_url').value = `${defaultLat.toFixed(6)}, ${defaultLng.toFixed(6)}`;
            showCoordinatesPreview(defaultLat, defaultLng);
            alert('🗺️ คุณสามารถคลิกหรือลากหมุดบนแผนที่ด้านล่าง เพื่อเลือกตำแหน่งที่พักของคุณได้ทันทีครับ');
        });
    }

    // Form submission
    const form = document.getElementById('driverForm');
    form.addEventListener('submit', handleFormSubmit);

    initAddressLookup();
}

function initAddressLookup() {
    const inputPostal = document.getElementById('postal_code');
    const selectSubdistrict = document.getElementById('subdistrict');
    const inputDistrict = document.getElementById('district');
    const inputProvince = document.getElementById('province');
    const inputDetail = document.getElementById('address_detail');
    const previewBox = document.getElementById('fullAddressPreview');
    const previewText = document.getElementById('fullAddressText');
    const spinner = document.getElementById('postalCodeSpinner');

    if (!inputPostal || !selectSubdistrict) return;

    let currentLocations = [];

    function updateAddressPreview() {
        const detail = (inputDetail.value || '').trim();
        const sub = selectSubdistrict.value;
        const dist = inputDistrict.value;
        const prov = inputProvince.value;
        const zip = inputPostal.value.trim();

        if (!detail && !sub) {
            previewBox.classList.add('hidden');
            return;
        }

        const parts = [];
        if (detail) parts.push(detail);
        if (sub) parts.push(prov === 'กรุงเทพมหานคร' ? `แขวง${sub.replace(/^(แขวง|ต\.|ตำบล)/, '')}` : `ต.${sub.replace(/^(แขวง|ต\.|ตำบล)/, '')}`);
        if (dist) parts.push(prov === 'กรุงเทพมหานคร' ? `เขต${dist.replace(/^(เขต|อ\.|อำเภอ)/, '')}` : `อ.${dist.replace(/^(เขต|อ\.|อำเภอ)/, '')}`);
        if (prov) parts.push(prov.startsWith('จ.') || prov === 'กรุงเทพมหานคร' ? prov : `จ.${prov}`);
        if (zip) parts.push(zip);

        previewText.textContent = parts.join(' ');
        previewBox.classList.remove('hidden');
    }

    inputDetail.addEventListener('input', updateAddressPreview);

    inputPostal.addEventListener('input', async () => {
        inputPostal.value = inputPostal.value.replace(/\D/g, '');
        const zip = inputPostal.value.trim();

        if (zip.length < 5) {
            selectSubdistrict.innerHTML = '<option value="">-- กรอกรหัสไปรษณีย์ 5 หลักก่อน --</option>';
            selectSubdistrict.disabled = true;
            selectSubdistrict.className = 'w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition text-sm bg-slate-50 text-slate-500 appearance-none disabled:cursor-not-allowed';
            inputDistrict.value = '';
            inputProvince.value = '';
            updateAddressPreview();
            return;
        }

        if (zip.length === 5) {
            if (spinner) spinner.classList.remove('hidden');
            try {
                const res = await fetch(`/api/zipcode/${zip}`);
                const data = await res.json();
                if (spinner) spinner.classList.add('hidden');

                if (data.found && data.locations.length > 0) {
                    currentLocations = data.locations;
                    
                    selectSubdistrict.disabled = false;
                    selectSubdistrict.className = 'w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition text-sm bg-white text-slate-800 appearance-none';

                    if (currentLocations.length === 1) {
                        const loc = currentLocations[0];
                        selectSubdistrict.innerHTML = `<option value="${loc.s}" selected>${loc.s}</option>`;
                        inputDistrict.value = loc.d;
                        inputProvince.value = loc.p;
                    } else {
                        selectSubdistrict.innerHTML = '<option value="">-- เลือกตำบล/แขวง --</option>' + 
                            currentLocations.map((loc, idx) => `<option value="${loc.s}" data-idx="${idx}">${loc.s} (${loc.d})</option>`).join('');
                        inputDistrict.value = currentLocations[0].d;
                        inputProvince.value = currentLocations[0].p;
                    }
                    updateAddressPreview();
                } else {
                    selectSubdistrict.innerHTML = '<option value="">-- ไม่พบรหัสไปรษณีย์นี้ --</option>';
                    selectSubdistrict.disabled = true;
                    inputDistrict.value = '';
                    inputProvince.value = '';
                    updateAddressPreview();
                }
            } catch (err) {
                if (spinner) spinner.classList.add('hidden');
                console.error('Zipcode lookup error:', err);
            }
        }
    });

    selectSubdistrict.addEventListener('change', () => {
        const selectedSub = selectSubdistrict.value;
        if (!selectedSub) {
            updateAddressPreview();
            return;
        }

        const match = currentLocations.find(l => l.s === selectedSub);
        if (match) {
            inputDistrict.value = match.d;
            inputProvince.value = match.p;
        }
        updateAddressPreview();
    });
}

async function checkCoordinates(quiet = false) {
    const input = document.getElementById('map_url').value.trim();
    if (!input) {
        if (!quiet) alert('กรุณากรอกลิงก์หรือพิกัดก่อนตรวจสอบ');
        return null;
    }

    try {
        const res = await fetch('/api/resolve-link', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: input })
        });
        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error || 'ไม่สามารถแปลงพิกัดได้');
        }

        showCoordinatesPreview(data.lat, data.lng);
        return data;
    } catch (err) {
        if (!quiet) alert('เกิดข้อผิดพลาด: ' + err.message);
        return null;
    }
}

function showCoordinatesPreview(lat, lng) {
    const badge = document.getElementById('coordsBadge');
    const text = document.getElementById('coordsText');
    const container = document.getElementById('miniMapContainer');

    badge.classList.remove('hidden');
    text.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    container.classList.remove('hidden');

    if (!miniMap) {
        miniMap = L.map('miniMap').setView([lat, lng], 14);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap'
        }).addTo(miniMap);

        miniMarker = L.marker([lat, lng], { draggable: true }).addTo(miniMap);

        // Drag marker to adjust location
        miniMarker.on('dragend', (e) => {
            const pos = e.target.getLatLng();
            const latStr = pos.lat.toFixed(6);
            const lngStr = pos.lng.toFixed(6);
            document.getElementById('map_url').value = `${latStr}, ${lngStr}`;
            text.textContent = `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`;
        });

        // Click on map to place marker
        miniMap.on('click', (e) => {
            const pos = e.latlng;
            miniMarker.setLatLng(pos);
            const latStr = pos.lat.toFixed(6);
            const lngStr = pos.lng.toFixed(6);
            document.getElementById('map_url').value = `${latStr}, ${lngStr}`;
            text.textContent = `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`;
        });
    } else {
        miniMap.setView([lat, lng], 14);
        miniMarker.setLatLng([lat, lng]);
        setTimeout(() => miniMap.invalidateSize(), 200);
    }
}

async function handleFormSubmit(e) {
    e.preventDefault();

    const employee_id = document.getElementById('employee_id').value.trim();
    const name = document.getElementById('name').value.trim();
    const vehicle_no = document.getElementById('vehicle_no').value.trim();
    const branch_id = document.getElementById('branch_id').value;
    const map_url = document.getElementById('map_url').value.trim();
    const address_detail = document.getElementById('address_detail').value.trim();
    const postal_code = document.getElementById('postal_code').value.trim();
    const subdistrict = document.getElementById('subdistrict').value.trim();
    const district = document.getElementById('district').value.trim();
    const province = document.getElementById('province').value.trim();

    if (!employee_id || !name || !vehicle_no || !branch_id || !map_url || !address_detail || !postal_code || !subdistrict) {
        alert('กรุณากรอกข้อมูลให้ครบถ้วนทุกช่อง (รวมถึงรายละเอียดที่พักและรหัสไปรษณีย์)');
        return;
    }

    const btnSubmit = document.getElementById('btnSubmit');
    const btnText = document.getElementById('btnSubmitText');
    const spinner = document.getElementById('btnSpinner');

    btnSubmit.disabled = true;
    btnText.textContent = 'กำลังคำนวณและบันทึกข้อมูล...';
    spinner.classList.remove('hidden');

    try {
        const res = await fetch('/api/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                employee_id,
                name,
                vehicle_no,
                branch_id,
                map_url,
                address_detail,
                postal_code,
                subdistrict,
                district,
                province
            })
        });
        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || 'เกิดข้อผิดพลาดในการบันทึกข้อมูล');
        }

        // Show success card
        const successCard = document.getElementById('successCard');
        const successDesc = document.getElementById('successDesc');
        const resBranch = document.getElementById('resBranch');
        const resDistance = document.getElementById('resDistance');

        const inKm = data.data.distance_inbound !== undefined ? data.data.distance_inbound : data.data.distance_km;
        const outKm = data.data.distance_outbound !== undefined ? data.data.distance_outbound : (data.data.distance_return_km || inKm);
        const rtKm = data.data.distance_round_trip !== undefined ? data.data.distance_round_trip : (data.data.distance_round_trip_km || parseFloat((inKm + outKm).toFixed(2)));

        successDesc.textContent = `รหัส: ${data.data.employee_id} (${data.data.name}) - เบอร์รถ: ${data.data.vehicle_no} | สาขา: ${data.data.branch_name}`;
        document.getElementById('resDistanceInbound').textContent = `${inKm} กม.`;
        document.getElementById('resDistanceOutbound').textContent = `${outKm} กม.`;
        document.getElementById('resDistanceRoundTrip').textContent = `${rtKm} กม.`;

        successCard.classList.remove('hidden');
        successCard.scrollIntoView({ behavior: 'smooth' });

        // Lock form
        btnText.textContent = '✓ บันทึกข้อมูลสำเร็จแล้ว';
        spinner.classList.add('hidden');
    } catch (err) {
        alert('เกิดข้อผิดพลาด: ' + err.message);
        btnSubmit.disabled = false;
        btnText.textContent = 'บันทึกข้อมูลที่พัก';
        spinner.classList.add('hidden');
    }
}
