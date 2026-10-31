// Manager Dashboard Logic
let token = localStorage.getItem('mwater_manager_token') || null;
let currentMode = 'round-trip'; // 'one-way' or 'round-trip'
let map = null;
let markersLayer = null;
let allSubmissions = [];
let branchesList = [];
let activePolyline = null;

// Multi-select vehicle state
let selectedVehicles = new Set();
let availableVehicles = [];

document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    initMap();
    initControls();
});

function checkAuth() {
    const overlay = document.getElementById('loginOverlay');
    const loginForm = document.getElementById('loginForm');
    const loginError = document.getElementById('loginError');

    if (!token) {
        overlay.classList.remove('hidden');
    } else {
        overlay.classList.add('hidden');
        loadDashboardData();
    }

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const password = document.getElementById('managerPassword').value;
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });
            const data = await res.json();
            if (res.ok && data.token) {
                token = data.token;
                localStorage.setItem('mwater_manager_token', token);
                overlay.classList.add('hidden');
                loadDashboardData();
            } else {
                loginError.textContent = data.error || 'รหัสผ่านไม่ถูกต้อง';
                loginError.classList.remove('hidden');
            }
        } catch (err) {
            loginError.textContent = 'เกิดข้อผิดพลาดในการเชื่อมต่อ';
            loginError.classList.remove('hidden');
        }
    });

    document.getElementById('btnLogout').addEventListener('click', () => {
        localStorage.removeItem('mwater_manager_token');
        token = null;
        overlay.classList.remove('hidden');
    });
}

function initMap() {
    // Bangkok center
    map = L.map('dashboardMap').setView([13.7563, 100.5018], 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
    }).addTo(map);

    markersLayer = L.layerGroup().addTo(map);
}

function initControls() {
    const btnOneWay = document.getElementById('btnModeOneWay');
    const btnRoundTrip = document.getElementById('btnModeRoundTrip');

    btnOneWay.addEventListener('click', () => {
        currentMode = 'one-way';
        btnOneWay.className = 'px-3 py-1.5 rounded-lg bg-white text-blue-700 shadow-sm transition font-semibold';
        btnRoundTrip.className = 'px-3 py-1.5 rounded-lg transition text-slate-600';
        refreshData(false);
    });

    btnRoundTrip.addEventListener('click', () => {
        currentMode = 'round-trip';
        btnRoundTrip.className = 'px-3 py-1.5 rounded-lg bg-white text-blue-700 shadow-sm transition font-semibold';
        btnOneWay.className = 'px-3 py-1.5 rounded-lg transition text-slate-600';
        refreshData(false);
    });

    document.getElementById('filterBranch').addEventListener('change', () => {
        refreshData(true);
    });

    document.getElementById('inputDieselPrice').addEventListener('input', () => refreshData(false));
    document.getElementById('inputConsumption').addEventListener('input', () => refreshData(false));
    document.getElementById('inputThreshold').addEventListener('input', () => refreshData(false));
    document.getElementById('searchTable').addEventListener('input', filterTableOnly);

    document.getElementById('btnExportExcel').addEventListener('click', exportExcel);

    const btnDel = document.getElementById('btnConfirmDelete');
    if (btnDel) {
        btnDel.addEventListener('click', () => {
            const select = document.getElementById('selectDeleteVehicle');
            const id = select.value;
            if (!id) {
                alert('กรุณาเลือกเบอร์รถที่ต้องการลบก่อนครับ');
                return;
            }
            const label = select.options[select.selectedIndex].text;
            deleteSubmission(id, label);
        });
    }

    initVehicleMultiSelect();
    initMapFullscreen();
}

let isMapFullscreen = false;

function initMapFullscreen() {
    const btn = document.getElementById('btnToggleMapFullscreen');
    const container = document.getElementById('mapSectionContainer');
    const frame = document.getElementById('mapFrameWrapper');
    const icon = document.getElementById('iconFullscreen');
    const text = document.getElementById('textFullscreen');

    if (!btn || !container || !frame) return;

    function toggleFullscreen(forceState) {
        isMapFullscreen = forceState !== undefined ? forceState : !isMapFullscreen;

        if (isMapFullscreen) {
            container.classList.add('map-fullscreen-active');
            frame.classList.add('map-frame-fullscreen');
            
            if (icon) icon.textContent = '✖';
            if (text) text.textContent = 'ย่อขนาดเท่าเดิม (Esc)';
            btn.className = 'text-xs bg-red-600 hover:bg-red-700 text-white font-semibold px-3.5 py-1.5 rounded-xl shadow-lg transition flex items-center gap-1.5 cursor-pointer';
            document.body.style.overflow = 'hidden';
        } else {
            container.classList.remove('map-fullscreen-active');
            frame.classList.remove('map-frame-fullscreen');

            if (icon) icon.textContent = '⛶';
            if (text) text.textContent = 'ขยายเต็มจอ';
            btn.className = 'text-xs bg-slate-100 hover:bg-blue-50 hover:text-blue-600 text-slate-700 font-medium px-3 py-1.5 rounded-xl border border-slate-200 transition flex items-center gap-1.5 shadow-sm cursor-pointer';
            document.body.style.overflow = '';
        }

        setTimeout(() => {
            if (map) {
                map.invalidateSize();
            }
        }, 150);
        setTimeout(() => {
            if (map) {
                map.invalidateSize();
            }
        }, 400);
    }

    btn.addEventListener('click', () => toggleFullscreen());

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isMapFullscreen) {
            toggleFullscreen(false);
        }
    });
}

function initVehicleMultiSelect() {
    const btn = document.getElementById('btnVehicleDropdown');
    const panel = document.getElementById('vehicleDropdownPanel');
    const btnSelectAll = document.getElementById('btnSelectAllVehicles');
    const btnDeselectAll = document.getElementById('btnDeselectAllVehicles');
    const searchInput = document.getElementById('searchVehicleInDropdown');

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        panel.classList.toggle('hidden');
    });

    panel.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    document.addEventListener('click', (e) => {
        if (!panel.contains(e.target) && e.target !== btn) {
            panel.classList.add('hidden');
        }
    });

    btnSelectAll.addEventListener('click', () => {
        for (const v of availableVehicles) {
            selectedVehicles.add(v.vehicle_no);
        }
        updateCheckboxStates();
        applyVehicleFilter();
    });

    btnDeselectAll.addEventListener('click', () => {
        selectedVehicles.clear();
        updateCheckboxStates();
        applyVehicleFilter();
    });

    searchInput.addEventListener('input', () => {
        const term = searchInput.value.toLowerCase().trim();
        const items = document.querySelectorAll('.vehicle-checkbox-item');
        items.forEach(el => {
            const text = el.textContent.toLowerCase();
            el.style.display = text.includes(term) ? 'flex' : 'none';
        });
    });
}

function updateCheckboxStates() {
    const cbs = document.querySelectorAll('.vehicle-checkbox-input');
    cbs.forEach(cb => {
        cb.checked = selectedVehicles.has(cb.value);
    });
}

function renderVehicleCheckboxes() {
    const container = document.getElementById('vehicleCheckboxList');
    if (!container) return;

    if (availableVehicles.length === 0) {
        container.innerHTML = '<div class="text-center py-4 text-slate-400 text-xs">ไม่มีข้อมูลเบอร์รถในสาขานี้</div>';
        return;
    }

    container.innerHTML = availableVehicles.map(v => {
        const isChecked = selectedVehicles.has(v.vehicle_no);
        return `
            <label class="vehicle-checkbox-item flex items-center justify-between p-1.5 hover:bg-slate-50 rounded-lg cursor-pointer transition select-none">
                <div class="flex items-center gap-2 truncate">
                    <input type="checkbox" value="${v.vehicle_no}" ${isChecked ? 'checked' : ''} 
                           class="vehicle-checkbox-input w-3.5 h-3.5 text-blue-600 rounded border-slate-300 focus:ring-0 cursor-pointer">
                    <span class="font-semibold text-slate-700 text-xs">${v.vehicle_no}</span>
                </div>
                <span class="text-slate-400 text-[10px] truncate ml-1">${v.name}</span>
            </label>
        `;
    }).join('');

    container.querySelectorAll('.vehicle-checkbox-input').forEach(cb => {
        cb.addEventListener('change', (e) => {
            if (e.target.checked) {
                selectedVehicles.add(e.target.value);
            } else {
                selectedVehicles.delete(e.target.value);
            }
            applyVehicleFilter();
        });
    });
}

function applyVehicleFilter() {
    const totalAvail = availableVehicles.length;
    const count = selectedVehicles.size;
    const label = document.getElementById('vehicleDropdownLabel');

    if (totalAvail === 0) {
        label.textContent = '-- ไม่มีเบอร์รถในสาขานี้ --';
        label.className = 'truncate font-semibold text-slate-400';
    } else if (count === totalAvail) {
        label.textContent = `-- รวมทุกเบอร์รถ (${totalAvail} คัน) --`;
        label.className = 'truncate font-semibold text-slate-700';
    } else if (count === 0) {
        label.textContent = '(ตัดออกทั้งหมด / ไม่ได้เลือก)';
        label.className = 'truncate font-semibold text-red-500';
    } else {
        const excludedCount = totalAvail - count;
        label.textContent = `เลือก ${count}/${totalAvail} คัน (ตัดออก ${excludedCount} คัน)`;
        label.className = 'truncate font-semibold text-blue-600';
    }

    // Filter submissions by selected vehicles
    const displayedSubmissions = allSubmissions.filter(s => selectedVehicles.has(s.vehicle_no));

    // Dynamic stats recalculation
    const threshold = parseFloat(document.getElementById('inputThreshold').value) || 200.0;
    let overCount = 0;
    let totalDist = 0;
    displayedSubmissions.forEach(s => {
        if (s.is_over_threshold) overCount++;
        totalDist += s.active_distance;
    });

    const total = displayedSubmissions.length;
    const percentOver = total > 0 ? parseFloat(((overCount / total) * 100).toFixed(1)) : 0;
    const avgDistance = total > 0 ? parseFloat((totalDist / total).toFixed(1)) : 0;

    updateStats({
        total,
        over_threshold_count: overCount,
        over_threshold_percent: percentOver,
        avg_distance_km: avgDistance,
        mode: currentMode,
        threshold_cost: threshold
    });

    renderMap(displayedSubmissions);
    renderTable(displayedSubmissions);
}

async function loadDashboardData() {
    await loadBranches();
    await refreshData(true);
}

async function loadBranches() {
    try {
        const res = await fetch('/api/branches');
        branchesList = await res.json();
        const select = document.getElementById('filterBranch');
        select.innerHTML = '<option value="">-- แสดงภาพรวมทุกสาขา --</option>';

        for (const b of branchesList) {
            const opt = document.createElement('option');
            opt.value = b.id;
            let displayName = b.name.replace(/\(คลังสินค้า\)/g, '').trim();
            if (b.category && b.category !== 'คลังสินค้า' && !displayName.includes(b.category)) {
                displayName += ` (${b.category})`;
            }
            opt.textContent = displayName;
            select.appendChild(opt);
        }
    } catch (err) {
        console.error('Error loading branches:', err);
    }
}

async function refreshData(updateVehicleList = false) {
    if (!token) return;

    const branchId = document.getElementById('filterBranch').value;
    const dieselPrice = document.getElementById('inputDieselPrice').value;
    const consumption = document.getElementById('inputConsumption').value;
    const threshold = document.getElementById('inputThreshold').value;

    const query = new URLSearchParams({
        mode: currentMode,
        diesel_price: dieselPrice,
        fuel_consumption: consumption,
        threshold_cost: threshold
    });
    if (branchId) query.append('branch_id', branchId);

    try {
        const res = await fetch(`/api/submissions?${query.toString()}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.status === 401) {
            localStorage.removeItem('mwater_manager_token');
            token = null;
            document.getElementById('loginOverlay').classList.remove('hidden');
            return;
        }

        const data = await res.json();
        allSubmissions = data.submissions || [];

        if (updateVehicleList) {
            const seen = new Set();
            availableVehicles = [];
            for (const s of allSubmissions) {
                if (!seen.has(s.vehicle_no)) {
                    seen.add(s.vehicle_no);
                    availableVehicles.push({ vehicle_no: s.vehicle_no, name: s.name });
                }
            }
            // By default, select all vehicles
            selectedVehicles = new Set(availableVehicles.map(v => v.vehicle_no));
            renderVehicleCheckboxes();
        }

        updateDeleteDropdown();
        applyVehicleFilter();
    } catch (err) {
        console.error('Error refreshing dashboard:', err);
    }
}

function updateDeleteDropdown() {
    const select = document.getElementById('selectDeleteVehicle');
    if (!select) return;
    select.innerHTML = '<option value="">-- เลือกเบอร์รถที่ต้องการลบออกจากระบบ --</option>';
    for (const s of allSubmissions) {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = `${s.vehicle_no} - ${s.name} (${s.branch_name})`;
        select.appendChild(opt);
    }
}

async function deleteSubmission(id, vehicleLabel, name) {
    const desc = name ? `${vehicleLabel} (${name})` : vehicleLabel;
    if (!confirm(`⚠️ ยืนยันการลบข้อมูลของ:\n"${desc}"\n\nเมื่อลบแล้ว ข้อมูลระยะทางและค่าน้ำมันจะถูกถอนออกจากระบบทันที ยืนยันหรือไม่?`)) {
        return;
    }

    try {
        const res = await fetch(`/api/submissions/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (res.ok) {
            alert(`✓ ${data.message || 'ลบข้อมูลเรียบร้อยแล้ว'}`);
            refreshData(true);
        } else {
            alert(`เกิดข้อผิดพลาด: ${data.error || 'ไม่สามารถลบข้อมูลได้'}`);
        }
    } catch (err) {
        alert('เกิดข้อผิดพลาดในการเชื่อมต่อ: ' + err.message);
    }
}

function updateStats(summary) {
    if (!summary) return;

    document.getElementById('statTotal').textContent = summary.total;
    document.getElementById('statOverCount').textContent = summary.over_threshold_count;
    document.getElementById('statOverDesc').textContent = `ค่าน้ำมัน > ${summary.threshold_cost} บ./วัน (${summary.mode === 'round-trip' ? 'ไป-กลับ' : 'เที่ยวเดียว'})`;
    document.getElementById('statOverPercent').textContent = `${summary.over_threshold_percent}%`;
    document.getElementById('statProgressBar').style.width = `${summary.over_threshold_percent}%`;
    document.getElementById('statAvgDistance').textContent = summary.avg_distance_km;
}

function renderMap(submissions) {
    markersLayer.clearLayers();
    if (activePolyline) {
        map.removeLayer(activePolyline);
        activePolyline = null;
    }

    const bounds = [];

    // 1. Render branches (Blue Markers)
    const branchIcon = L.divIcon({
        className: 'custom-branch-icon',
        html: `<div style="background-color: #2563eb; color: white; border: 2px solid white; border-radius: 8px; padding: 3px 6px; font-size: 11px; font-weight: bold; box-shadow: 0 2px 4px rgba(0,0,0,0.3); white-space: nowrap; display: flex; align-items: center; gap: 4px;">🏢 <span></span></div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    });

    for (const b of branchesList) {
        const branchMarker = L.marker([b.latitude, b.longitude], { icon: branchIcon })
            .bindPopup(`<b>🏢 ${b.name}</b><br><small class="text-slate-500">${b.address || ''}</small>`);
        markersLayer.addLayer(branchMarker);
        bounds.push([b.latitude, b.longitude]);
    }

    // 2. Render Driver Submissions
    for (const s of submissions) {
        const isOver = s.is_over_threshold;
        const color = isOver ? '#ef4444' : '#10b981'; // Red vs Green
        const emoji = isOver ? '⚠️' : '🚚';

        const driverIcon = L.divIcon({
            className: 'custom-driver-icon',
            html: `<div style="background-color: ${color}; color: white; border: 2px solid white; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; font-size: 13px; box-shadow: 0 2px 6px rgba(0,0,0,0.35);">${emoji}</div>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14]
        });

        const marker = L.marker([s.home_latitude, s.home_longitude], { icon: driverIcon });
        
        const modeLabel = currentMode === 'round-trip' ? 'ไป-กลับจริง' : 'เที่ยวเดียว';
        const distDetails = currentMode === 'round-trip'
            ? `<div>ระยะทางไป-กลับจริง: <b style="color: #2563eb;">${s.distance_round_trip} กม.</b></div>
               <div style="font-size: 11px; color: #64748b;">(ขาไป ${s.distance_inbound} กม. / ขากลับ ${s.distance_outbound} กม.)</div>`
            : `<div>ระยะทางขาไป: <b style="color: #2563eb;">${s.distance_inbound} กม.</b></div>`;

        const popupContent = `
            <div style="font-family: 'Prompt', sans-serif; font-size: 12px; line-height: 1.4;">
                <b style="font-size: 13px;">${s.name}</b> (${s.employee_id})<br>
                <span>เบอร์รถ: <b>${s.vehicle_no}</b></span><br>
                <span>สาขาประจำ: <b>${s.branch_name}</b></span><br>
                ${s.full_address ? `<div style="font-size: 11px; color: #475569; margin-top: 2px;">🏠 ${s.full_address}</div>` : ''}
                <div style="margin-top: 6px; padding: 4px 6px; background-color: #f8fafc; border-radius: 6px;">
                    ${distDetails}
                    <div style="margin-top: 4px;">ค่าน้ำมัน (${modeLabel}): <b style="color: ${isOver ? '#dc2626' : '#16a34a'}; font-size: 13px;">${s.active_cost} บาท</b></div>
                    <div>สถานะ: <b>${isOver ? '⚠️ เกินเกณฑ์สวัสดิการ' : '✓ ปกติ'}</b></div>
                    <div style="margin-top: 6px; padding-top: 4px; border-top: 1px dashed #cbd5e1;">
                        <a href="https://www.google.com/maps?q=${s.home_latitude},${s.home_longitude}" target="_blank" rel="noopener noreferrer" style="color: #2563eb; text-decoration: underline; font-weight: 500;">
                            📍 เปิดจุดพิกัดใน Google Maps ↗
                        </a>
                    </div>
                </div>
            </div>
        `;
        marker.bindPopup(popupContent);

        marker.on('click', () => {
            if (activePolyline) map.removeLayer(activePolyline);
            activePolyline = L.polyline(
                [[s.home_latitude, s.home_longitude], [s.branch_latitude, s.branch_longitude]],
                { color: isOver ? '#ef4444' : '#2563eb', weight: 3, dashArray: '5, 8', opacity: 0.8 }
            ).addTo(map);
        });

        markersLayer.addLayer(marker);
        bounds.push([s.home_latitude, s.home_longitude]);
    }

    if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
    }
}

function renderTable(submissions) {
    const tbody = document.getElementById('tableBody');
    if (submissions.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-slate-400">ไม่มีข้อมูลตามเงื่อนไขที่เลือก (อาจถูกตัดออกจากการเลือกเบอร์รถ)</td></tr>`;
        return;
    }

    tbody.innerHTML = submissions.map(s => {
        const isOver = s.is_over_threshold;
        const modeLabel = currentMode === 'round-trip' ? 'ไป-กลับจริง' : 'เที่ยวเดียว';
        const distDisplay = currentMode === 'round-trip'
            ? `<div class="font-bold text-blue-600">${s.distance_round_trip}</div>
               <div class="text-[10px] text-slate-400 font-normal">ไป ${s.distance_inbound} / กลับ ${s.distance_outbound}</div>`
            : `<div class="font-bold text-blue-600">${s.distance_inbound}</div>`;

        // Direct Google Maps pin URL with exact coordinates
        const googleMapsUrl = (s.home_latitude && s.home_longitude)
            ? `https://www.google.com/maps?q=${s.home_latitude},${s.home_longitude}`
            : (s.map_url && s.map_url.startsWith('http') ? s.map_url : `https://www.google.com/maps?q=${encodeURIComponent(s.map_url || '')}`);

        return `
            <tr class="hover:bg-slate-50 transition border-b border-slate-100 ${isOver ? 'bg-red-50/20' : ''}">
                <td class="py-3 px-4 font-mono font-medium text-slate-700">${s.employee_id}</td>
                <td class="py-3 px-4 font-medium text-slate-800">
                    <div>${s.name}</div>
                    ${s.full_address ? `<div class="text-[11px] text-slate-400 font-normal truncate max-w-[220px]" title="${s.full_address}">🏠 ${s.full_address}</div>` : ''}
                </td>
                <td class="py-3 px-4 font-semibold text-slate-700">${s.vehicle_no}</td>
                <td class="py-3 px-4 text-slate-600">${s.branch_name}</td>
                <td class="py-3 px-4 text-right font-mono font-semibold">${distDisplay}</td>
                <td class="py-3 px-4 text-right font-mono font-bold ${isOver ? 'text-red-600' : 'text-emerald-600'}">
                    ${s.active_cost} <span class="text-[10px] text-slate-400 font-normal">บ. (${modeLabel})</span>
                </td>
                <td class="py-3 px-4 text-center">
                    <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${isOver ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}">
                        ${isOver ? 'เกินเกณฑ์' : 'ปกติ'}
                    </span>
                </td>
                <td class="py-3 px-4 text-center">
                    <a href="${googleMapsUrl}" target="_blank" rel="noopener noreferrer" 
                       class="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-[11px] font-medium bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-lg border border-blue-200 transition" 
                       title="เปิดดูจุดพิกัดใน Google Maps (แท็บใหม่)">
                        📍 พิกัด ↗
                    </a>
                </td>
                <td class="py-3 px-4 text-center">
                    <button type="button" onclick="deleteSubmission('${s.id}', '${s.vehicle_no}', '${s.name}')"
                            class="text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded-lg transition text-xs flex items-center justify-center mx-auto gap-0.5" title="ลบข้อมูลรถคันนี้">
                        <span>🗑️</span>
                        <span class="text-[10px]">ลบ</span>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function filterTableOnly() {
    const term = document.getElementById('searchTable').value.toLowerCase().trim();
    if (!term) {
        applyVehicleFilter();
        return;
    }
    const displayedSubmissions = allSubmissions.filter(s => selectedVehicles.has(s.vehicle_no));
    const filtered = displayedSubmissions.filter(s =>
        s.employee_id.toLowerCase().includes(term) ||
        s.name.toLowerCase().includes(term) ||
        s.vehicle_no.toLowerCase().includes(term) ||
        s.branch_name.toLowerCase().includes(term)
    );
    renderTable(filtered);
}

function exportExcel() {
    if (!token) return;

    const branchId = document.getElementById('filterBranch').value;
    const dieselPrice = document.getElementById('inputDieselPrice').value;
    const consumption = document.getElementById('inputConsumption').value;
    const threshold = document.getElementById('inputThreshold').value;

    const query = new URLSearchParams({
        token,
        mode: currentMode,
        branch_id: branchId,
        diesel_price: dieselPrice,
        fuel_consumption: consumption,
        threshold_cost: threshold
    });
    if (selectedVehicles.size > 0 && selectedVehicles.size < availableVehicles.length) {
        query.append('vehicles', Array.from(selectedVehicles).join(','));
    }

    window.location.href = `/api/export?${query.toString()}`;
}
