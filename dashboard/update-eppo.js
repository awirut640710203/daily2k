/* ─── EPPO Oil Price Updater ────────────────────────────────────────
   สคริปต์ Node.js สำหรับดึงข้อมูลราคาน้ำมันดีเซลจาก EPPO API
   และอัปเดตไฟล์ oil-price-data.js อัตโนมัติ

   วิธีใช้:
   1. ติดตั้ง Node.js (ถ้ายังไม่มี)
   2. เปิด Terminal/PowerShell ในโฟลเดอร์ dashboard
   3. รัน: node update-eppo.js
   ──────────────────────────────────────────────────────────────── */

const https = require('https');
const fs = require('fs');
const path = require('path');

const API_URL = 'api.eppo.go.th';
const API_PATH = '/v1/openAPI/petro-prices/petro-prices-thailand/current';
const OUTPUT_FILE = path.join(__dirname, 'oil-price-data.js');

// Helper: HTTP POST request
function fetchEppoData() {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ date: new Date().toISOString() });
    const options = {
      hostname: API_URL,
      port: 443,
      path: API_PATH,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          reject(new Error('Invalid JSON response: ' + e.message));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// Helper: convert EPPO response to our format
function parseEppoPrices(data) {
  if (!Array.isArray(data)) {
    throw new Error('Expected array response from EPPO');
  }

  // Filter for entries with HSD B7 diesel price
  const entries = data
    .filter(r => r['HSD (B7)'] != null || r['DIESEL HSD (B7)'] != null)
    .map(r => ({
      period_no: String(r.period_no || ''),
      period_name: r.period_name || '',
      year_en: r.year_en || new Date().getFullYear(),
      update_date: r.update_date || new Date().toISOString(),
      price: r['HSD (B7)'] ?? r['DIESEL HSD (B7)'] ?? 0
    }))
    .filter(r => r.period_no && r.price > 0);

  // Sort ascending by period_no
  entries.sort((a, b) => String(a.period_no).localeCompare(String(b.period_no)));

  return entries;
}

// Helper: generate the JS file content
function generateJsFile(prices) {
  const now = new Date().toISOString();
  const nextFetch = new Date();
  nextFetch.setDate(nextFetch.getDate() + 7); // suggest weekly updates

  const pricesJson = JSON.stringify(prices, null, 2);

  return `/* ─── EPPO Diesel Price Cache ───────────────────────────────────────
   แหล่งที่มา: EPPO (สำนักงานนโยบายและแผนพลังงาน)
   ผลิตภัณฑ์: ดีเซล HSD B7 (High Speed Diesel B7)
   หน่วย: บาท/ลิตร
   อัปเดตล่าสุด: ${now}
   ──────────────────────────────────────────────────────────────── */
const OIL_PRICE_DATA = {
  source: 'EPPO - สำนักงานนโยบายและแผนพลังงาน',
  sourceUrl: 'https://www.eppo.go.th/index.php/th/petroleum/price/oil-price',
  product: 'ดีเซล HSD B7',
  productLabel: 'ดีเซล HSD B7 (หน้าปั๊มอ้างอิง)',
  unit: 'บาท/ลิตร',
  lastFetch: '${now}',
  nextFetch: '${nextFetch.toISOString()}',
  apiEndpoint: 'https://api.eppo.go.th/v1/openAPI/petro-prices/petro-prices-thailand/current',
  retailEndpoint: 'https://api.eppo.go.th/v1/openAPI/petro-prices/petro-prices-retail/current',
  note: 'ราคาอ้างอิงจากกระทรวงพลังงาน (EPPO) แบ่งเป็นงวดครึ่งเดือน (JAN-1, JAN-2, ...)',
  prices: ${pricesJson}
};

// Helper to convert EPPO period to actual date range
function eppoPeriodToDateRange(period_no) {
  if (!period_no || String(period_no).length < 8) return { from: '', to: '' };
  const s = String(period_no);
  const year = parseInt(s.slice(0, 4), 10);
  const month = parseInt(s.slice(4, 6), 10);
  const half = parseInt(s.slice(6, 8), 10);
  const daysInMonth = new Date(year, month, 0).getDate();
  const fromDay = half === 1 ? 1 : 16;
  const toDay = half === 1 ? 15 : daysInMonth;
  const pad = n => String(n).padStart(2, '0');
  return {
    from: \`\${year}-\${pad(month)}-\${pad(fromDay)}\`,
    to: \`\${year}-\${pad(month)}-\${pad(toDay)}\`,
    fromTh: \`\${pad(fromDay)}/\${pad(month)}/\${year + 543}\`,
    toTh: \`\${pad(toDay)}/\${pad(month)}/\${year + 543}\`
  };
}

// Helper to get latest price entry
function getLatestOilPrice() {
  if (!OIL_PRICE_DATA || !OIL_PRICE_DATA.prices || !OIL_PRICE_DATA.prices.length) return null;
  const sorted = [...OIL_PRICE_DATA.prices].sort((a, b) => String(b.period_no).localeCompare(String(a.period_no)));
  return sorted[0];
}

// Helper to get price trend (last 6 periods)
function getOilPriceTrend(count = 6) {
  if (!OIL_PRICE_DATA || !OIL_PRICE_DATA.prices) return [];
  const sorted = [...OIL_PRICE_DATA.prices].sort((a, b) => String(a.period_no).localeCompare(String(b.period_no)));
  return sorted.slice(-count);
}
`;
}

// Main
async function main() {
  console.log('🛢️  EPPO Diesel Price Updater');
  console.log('─────────────────────────────────');

  try {
    console.log('⏳ Fetching data from EPPO API...');
    const raw = await fetchEppoData();
    console.log(`✅ Received ${raw.length} records from EPPO`);

    const prices = parseEppoPrices(raw);
    console.log(`📊 Found ${prices.length} diesel (HSD B7) price entries`);

    if (prices.length === 0) {
      console.warn('⚠️  No diesel data found. Keeping existing file.');
      return;
    }

    const latest = prices[prices.length - 1];
    console.log(`💰 Latest price: ${latest.price} THB/L (${latest.period_name} ${latest.year_en})`);

    const jsContent = generateJsFile(prices);
    fs.writeFileSync(OUTPUT_FILE, jsContent, 'utf8');

    console.log(`💾 Updated: ${OUTPUT_FILE}`);
    console.log(`📅 Next suggested update: ${new Date().toISOString()}`);
    console.log('✅ Done!');

  } catch (err) {
    console.error('❌ Error:', err.message);
    console.error('\n💡 Tips:');
    console.error('   - Check your internet connection');
    console.error('   - EPPO API may be temporarily unavailable');
    console.error('   - Try running this script again later');
    process.exit(1);
  }
}

main();
