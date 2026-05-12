---
description: แผนการย้ายระบบ Oil Price ไปใช้ Google Sheets + Apps Script
---

# แผนการย้ายระบบ Oil Price → Google Sheets + Apps Script

## สรุปปัญหา
- API ของ EPPO ไม่เสถียร / มี CORS ปัญหา
- PTTOR ไม่มี API เปิดให้ใช้งาน
- ต้องการควบคุมข้อมูลเอง อัปเดต manual ได้

## แนวทางใหม่
**Google Sheets เป็นฐานข้อมูลหลัก** → **Apps Script เป็น API** → **Dashboard ดึงผ่าน JSON API**

---

## ขั้นตอนที่ 1: สร้าง Google Sheets

### 1.1 สร้าง Sheet ใหม่
- ไปที่ https://sheets.new
- ตั้งชื่อ: `DailyExpress_OilPrice`
- ตั้งค่าแชร์: `Anyone with the link` → `Viewer`

### 1.2 โครงสร้าง Sheet (Tab: `Prices`)

| A | B | C | D |
|---|---|---|---|
| date | diesel_b7 | source | note |
| 2026-01-07 | 29.94 | PTTOR | ม.ค. 2569 |
| 2026-01-21 | 29.94 | PTTOR | ม.ค. 2569 |
| 2026-02-05 | 29.94 | PTTOR | ก.พ. 2569 |
| ... | ... | ... | ... |
| 2026-06-01 | 40.80 | PTTOR | มิ.ย. 2569 |

> **หมายเหตุ:** คุณอัปเดตข้อมูลเองทุกครั้งที่ PTTOR เปลี่ยนราคา

---

## ขั้นตอนที่ 2: สร้าง Google Apps Script

### 2.1 เปิด Apps Script
- ใน Google Sheets → `Extensions` → `Apps Script`

### 2.2 วางโค้ดนี้ (File: `Code.gs`)

```javascript
function doGet(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Prices');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const rows = [];

  for (let i = 1; i < data.length; i++) {
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = data[i][j];
    }
    rows.push(row);
  }

  // เรียงตามวันที่ล่าสุดก่อน
  rows.sort((a, b) => new Date(b.date) - new Date(a.date));

  const result = {
    source: 'PTTOR via Google Sheets',
    product: 'ดีเซล B7',
    unit: 'บาท/ลิตร',
    lastUpdated: new Date().toISOString(),
    prices: rows
  };

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}
```

### 2.3 Deploy เป็น Web App
1. กด `Deploy` → `New deployment`
2. เลือก type: `Web app`
3. Execute as: `Me`
4. Who has access: `Anyone`
5. กด `Deploy` → อนุญาต (Authorize)
6. ได้ URL มา เช่น:
   `https://script.google.com/macros/s/ABC123/exec`

> **บันทึก URL นี้ไว้** จะใช้ใน Dashboard

---

## ขั้นตอนที่ 3: แก้ไข Dashboard (ไฟล์ในโปรเจกต์)

### 3.1 แก้ `oil-price-data.js`
- ลบข้อมูล hardcoded ทั้งหมด
- เปลี่ยนเป็นตัวแปร placeholder ที่จะถูกเติมจาก Apps Script

```javascript
const OIL_PRICE_DATA = {
  source: 'PTTOR via Google Sheets',
  product: 'ดีเซล B7',
  unit: 'บาท/ลิตร',
  lastFetch: null,
  prices: []  // จะถูกเติมจาก fetch
};
```

### 3.2 แก้ `app.js` → `opFetchEppo()`
- เปลี่ยน endpoint จาก EPPO → Google Apps Script

```javascript
const GAS_URL = 'https://script.google.com/macros/s/YOUR_ID/exec';

window.opFetchEppo = async function () {
  const btn = document.getElementById('op_fetch_btn');
  const status = document.getElementById('op_fetch_status');
  
  try {
    btn.disabled = true;
    status.textContent = 'กำลังโหลดจาก Google Sheets...';
    
    const res = await fetch(GAS_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    
    const data = await res.json();
    
    // อัปเดต OIL_PRICE_DATA
    OIL_PRICE_DATA.prices = data.prices.map(p => ({
      period_no: p.date.replace(/-/g, ''),
      period_name: p.date,
      year_en: new Date(p.date).getFullYear(),
      update_date: p.date + 'T00:00:00.000Z',
      price: Number(p.diesel_b7)
    }));
    OIL_PRICE_DATA.lastFetch = data.lastUpdated;
    
    status.textContent = 'อัปเดตสำเร็จ: ' + new Date().toLocaleString('th-TH');
    
    // Re-render หน้า
    showPage(2);
    
  } catch (err) {
    status.textContent = 'ผิดพลาด: ' + err.message;
  } finally {
    btn.disabled = false;
  }
};
```

### 3.3 เพิ่ม CORS proxy (ถ้าจำเป็น)
ถ้า Apps Script มี CORS ปัญหา ให้เพิ่มใน `Code.gs`:

```javascript
function doGet(e) {
  // ... โค้ดเดิม ...
  
  const output = ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
  
  // อาจต้องใช้ workaround สำหรับ CORS
  return output;
}
```

หรือใช้ JSONP (แต่ fetch ปกติควรใช้ได้)

---

## ขั้นตอนที่ 4: แก้ไข `update-eppo.js` (Node.js script)

### 4.1 เปลี่ยนเป็น `update-google-sheets.js`
- แทนที่จะดึง EPPO → ดึงจาก Apps Script แล้ว cache เป็น `oil-price-data.js`

```javascript
const https = require('https');
const fs = require('fs');

const GAS_URL = 'https://script.google.com/macros/s/YOUR_ID/exec';

// ดึงจาก Google Apps Script
https.get(GAS_URL, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const json = JSON.parse(data);
    generateCacheFile(json);
  });
}).on('error', (err) => {
  console.error('Error:', err.message);
});

function generateCacheFile(data) {
  const prices = data.prices.map(p => ({
    period_no: p.date.replace(/-/g, ''),
    period_name: p.date,
    year_en: new Date(p.date).getFullYear(),
    update_date: p.date + 'T00:00:00.000Z',
    price: Number(p.diesel_b7)
  }));

  const content = `const OIL_PRICE_DATA = {
  source: 'PTTOR via Google Sheets',
  product: 'ดีเซล B7',
  productLabel: 'ดีเซล B7 (ราคาขายปลีกหน้าปั๊ม PTT)',
  unit: 'บาท/ลิตร',
  lastFetch: '${data.lastUpdated}',
  apiEndpoint: '${GAS_URL}',
  note: 'ข้อมูลจาก PTTOR ผ่าน Google Sheets / Apps Script',
  prices: ${JSON.stringify(prices, null, 2)}
};

if (typeof module !== 'undefined') module.exports = { OIL_PRICE_DATA };
`;

  fs.writeFileSync('oil-price-data.js', content);
  console.log('Updated oil-price-data.js with', prices.length, 'records');
}
```

---

## ขั้นตอนที่ 5: กระบวนการทำงานประจำวัน

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  คุณเช็คราคา   │     │  อัปเดต Google │     │  Dashboard      │
│  ที่ PTTOR      │────▶│  Sheets ด้วย   │────▶│  โหลดผ่าน      │
│  (ตามภาพ)       │     │  มือ            │     │  Apps Script    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

### ขั้นตอนประจำวัน (เมื่อ PTTOR เปลี่ยนราคา):
1. เปิด https://www.pttor.com/news/oil-price
2. เปิด Google Sheets `DailyExpress_OilPrice`
3. เพิ่มแถวใหม่: `date | diesel_b7 | PTTOR | หมายเหตุ`
4. Dashboard จะดึงข้อมูลใหม่อัตโนมัติ (หรือกด "อัปเดตราคาล่าสุด")

---

## สรุปไฟล์ที่ต้องแก้ไข

| ไฟล์ | การเปลี่ยนแปลง |
|------|----------------|
| `oil-price-data.js` | ลบ hardcoded data → ใส่ placeholder |
| `app.js` | เปลี่ยน `opFetchEppo()` URL เป็น Apps Script |
| `update-eppo.js` | เปลี่ยนเป็น `update-google-sheets.js` |
| สร้างใหม่ | Google Sheets + Apps Script (บน Google Drive) |

---

## หมายเหตุสำคัญ
- **API Key ไม่จำเป็น** — Apps Script เปิด `Anyone` ได้
- **CORS ปกติไม่มีปัญหา** — Apps Script รองรับ cross-origin
- **Backup ข้อมูล** — Google Sheets มี version history อัตโนมัติ
- **Mobile friendly** — อัปเดต Sheets บนมือถือได้
