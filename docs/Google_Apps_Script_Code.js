// ==============================================================
// Google Apps Script สำหรับเชื่อมต่อ MWater Survey System
// วิธีใช้งาน: นำโค้ดนี้ไปวางใน Extensions (ส่วนขยาย) > Apps Script บน Google Sheet
// ==============================================================

function doGet(e) {
  var action = (e && e.parameter) ? e.parameter.action : '';
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  
  if (action === 'get_submissions' || !action) {
    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      return ContentService.createTextOutput(JSON.stringify({ status: 'ok', data: [] }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    var headers = data[0];
    var rows = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0] && !row[1]) continue; // ข้ามแถวว่าง
      var obj = {};
      for (var j = 0; j < headers.length; j++) {
        var key = String(headers[j]).trim();
        obj[key] = row[j];
      }
      rows.push(obj);
    }
    return ContentService.createTextOutput(JSON.stringify({ status: 'ok', data: rows }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput(JSON.stringify({ status: 'unknown_action' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(15000);
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var payload = JSON.parse(e.postData.contents);
    var action = payload.action;

    // สร้าง Header อัตโนมัติหากเป็นชีตว่าง
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        'employee_id', 'name', 'vehicle_no', 'branch_id', 'branch_name',
        'address_detail', 'subdistrict', 'district', 'province', 'postal_code', 'full_address',
        'map_url', 'home_latitude', 'home_longitude', 'distance_km',
        'distance_return_km', 'distance_round_trip_km', 'created_at', 'updated_at'
      ]);
      sheet.getRange(1, 1, 1, 19).setFontWeight('bold').setBackground('#e2e8f0');
    }

    // 1. บันทึกหรืออัปเดตข้อมูลพนักงาน
    if (action === 'upsert') {
      var data = sheet.getDataRange().getValues();
      var empId = String(payload.employee_id || '').trim();
      var foundRow = -1;

      for (var i = 1; i < data.length; i++) {
        if (String(data[i][0]).trim() === empId) {
          foundRow = i + 1; // ตำแหน่งแถวในชีต (นับเริ่มจาก 1)
          break;
        }
      }

      var rowValues = [
        payload.employee_id || '',
        payload.name || '',
        payload.vehicle_no || '',
        payload.branch_id || '',
        payload.branch_name || '',
        payload.address_detail || '',
        payload.subdistrict || '',
        payload.district || '',
        payload.province || '',
        payload.postal_code || '',
        payload.full_address || '',
        payload.map_url || '',
        payload.home_latitude || '',
        payload.home_longitude || '',
        payload.distance_km || '',
        payload.distance_return_km || '',
        payload.distance_round_trip_km || '',
        payload.created_at || new Date().toISOString(),
        new Date().toISOString()
      ];

      if (foundRow > 0) {
        sheet.getRange(foundRow, 1, 1, rowValues.length).setValues([rowValues]);
      } else {
        sheet.appendRow(rowValues);
      }

      return ContentService.createTextOutput(JSON.stringify({ status: 'ok', message: 'saved' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 2. ลบข้อมูลพนักงาน
    if (action === 'delete') {
      var data = sheet.getDataRange().getValues();
      var targetEmpId = String(payload.employee_id || '').trim();

      for (var i = 1; i < data.length; i++) {
        if (String(data[i][0]).trim() === targetEmpId) {
          sheet.deleteRow(i + 1);
          break;
        }
      }

      return ContentService.createTextOutput(JSON.stringify({ status: 'ok', message: 'deleted' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'invalid action' }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}
