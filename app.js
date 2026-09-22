// ============================================================
//  Smart Bag Tracker — ไฟล์เดียวจบ (Node.js + Express)
//  - รับ Heartbeat จาก ESP32 (บอกว่าอุปกรณ์ออนไลน์/พร้อมใช้งาน)
//  - รับ Alert ตอนกดปุ่มบนจอ Nextion (ตำแหน่ง GPS + เวลา)
//  - หน้าเว็บแสดงสถานะอุปกรณ์ + การ์ดแจ้งเตือนแบบเรียลไทม์
//
//  วิธีรัน:
//    1) npm install express cors
//    2) node app.js
//    3) เปิดเบราว์เซอร์ไปที่ http://localhost:3000
// ============================================================

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// ------------------------------------------------------------
// รหัสลับอุปกรณ์ — เปลี่ยนเป็นของคุณเอง แล้วใส่ค่าเดียวกันในโค้ด ESP32
// ------------------------------------------------------------
const DEVICE_KEY = process.env.DEVICE_KEY || "change-this-secret-key-123";

// ถ้าไม่มี heartbeat เข้ามาภายในกี่วินาที ถือว่า "ออฟไลน์"
// (ESP32 ส่ง heartbeat ทุก 10 วิ ในโค้ดตัวอย่าง เผื่อไว้ 25 วิ กันแค่ delay เล็กน้อยแล้วโดนตัดสถานะ)
const ONLINE_TIMEOUT_MS = 25 * 1000;

const DATA_FILE = path.join(__dirname, "alerts.json");

function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, "[]", "utf8");
}
ensureDataFile();

function readAlerts() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (err) {
    console.error("อ่านไฟล์ข้อมูลผิดพลาด:", err);
    return [];
  }
}

function writeAlerts(alerts) {
  const trimmed = alerts.slice(-200); // เก็บแค่ 200 รายการล่าสุด
  fs.writeFileSync(DATA_FILE, JSON.stringify(trimmed, null, 2), "utf8");
}

// เก็บเวลา heartbeat ล่าสุดไว้ใน memory (ไม่ต้องเขียนไฟล์ทุกครั้ง เพราะถี่)
let lastHeartbeatAt = null;

app.use(cors());
app.use(express.json());

// ============================================================
//  API ENDPOINTS
// ============================================================

// ESP32 ยิงมาทุก 10 วิ เพื่อบอกว่า "ฉันยังออนไลน์อยู่"
app.post("/api/heartbeat", (req, res) => {
  const deviceKey = req.header("X-Device-Key");
  if (deviceKey !== DEVICE_KEY) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  lastHeartbeatAt = Date.now();
  res.json({ ok: true });
});

// ดึงสถานะอุปกรณ์ปัจจุบัน (หน้าเว็บโพลบ่อยๆ)
app.get("/api/status", (req, res) => {
  const online = lastHeartbeatAt !== null && (Date.now() - lastHeartbeatAt) < ONLINE_TIMEOUT_MS;
  res.json({
    ok: true,
    online,
    lastSeen: lastHeartbeatAt ? new Date(lastHeartbeatAt).toISOString() : null,
  });
});

// ESP32 ยิงมาตอนกดปุ่มบนจอ Nextion
// body: { "lat": 13.7563, "lng": 100.5018, "timestamp": "2026-09-21T10:30:00Z" }
app.post("/api/location", (req, res) => {
  const deviceKey = req.header("X-Device-Key");
  if (deviceKey !== DEVICE_KEY) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const { lat, lng, timestamp } = req.body;
  if (typeof lat !== "number" || typeof lng !== "number") {
    return res.status(400).json({ ok: false, error: "lat และ lng ต้องเป็นตัวเลข" });
  }

  const record = {
    id: Date.now() + "-" + Math.floor(Math.random() * 1000), // id ไม่ซ้ำ ใช้แยกการ์ดฝั่งเว็บ
    lat,
    lng,
    timestamp: timestamp || new Date().toISOString(),
    receivedAt: new Date().toISOString(),
  };

  const alerts = readAlerts();
  alerts.push(record);
  writeAlerts(alerts);

  lastHeartbeatAt = Date.now(); // การส่ง alert ก็นับเป็น heartbeat ด้วย

  console.log("🔔 แจ้งเตือนใหม่:", record);
  res.json({ ok: true, message: "บันทึกแจ้งเตือนสำเร็จ", data: record });
});

// ดึงรายการแจ้งเตือนทั้งหมด (ใหม่สุดอยู่ท้าย array)
app.get("/api/alerts", (req, res) => {
  res.json({ ok: true, data: readAlerts() });
});

// ============================================================
//  หน้าเว็บ (ฝัง HTML/CSS/JS ไว้ในไฟล์นี้)
// ============================================================
const HTML_PAGE = `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Smart Bag Tracker</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css" />
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #e2e8f0; }
  header { padding: 20px; background: #1e293b; border-bottom: 1px solid #334155; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }
  header h1 { margin: 0; font-size: 20px; }
  header p { margin: 4px 0 0; color: #94a3b8; font-size: 13px; }

  .status-pill { display: flex; align-items: center; gap: 8px; padding: 8px 16px; border-radius: 999px; font-size: 14px; font-weight: 600; }
  .status-pill.online { background: rgba(74, 222, 128, 0.15); color: #4ade80; }
  .status-pill.offline { background: rgba(248, 113, 113, 0.15); color: #f87171; }
  .dot { width: 10px; height: 10px; border-radius: 50%; }
  .dot.online { background: #4ade80; box-shadow: 0 0 8px #4ade80; animation: pulse 1.5s infinite; }
  .dot.offline { background: #f87171; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }

  #map { height: 40vh; width: 100%; }

  .section-title { padding: 20px 20px 0; font-size: 15px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }

  .alerts-grid { padding: 12px 20px 20px; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }

  .alert-card {
    background: #1e293b; border: 1px solid #334155; border-radius: 14px; padding: 16px;
    aspect-ratio: 1 / 1; display: flex; flex-direction: column; justify-content: space-between;
  }
  .alert-card.new { border-color: #4ade80; animation: flashIn 1.2s ease-out; }
  @keyframes flashIn {
    0% { box-shadow: 0 0 0 4px rgba(74,222,128,0.5); transform: scale(1.03); }
    100% { box-shadow: 0 0 0 0 rgba(74,222,128,0); transform: scale(1); }
  }
  .alert-card .icon { font-size: 26px; }
  .alert-card .elapsed { font-size: 13px; color: #fbbf24; font-weight: 600; }
  .alert-card .coords { font-size: 13px; color: #e2e8f0; font-family: monospace; }
  .alert-card .time { font-size: 12px; color: #64748b; }

  .empty-state { padding: 40px 20px; text-align: center; color: #64748b; }
</style>
</head>
<body>

<header>
  <div>
    <h1>🎒 Smart Bag Tracker</h1>
    <p>สถานะอุปกรณ์และการแจ้งเตือนแบบเรียลไทม์</p>
  </div>
  <div class="status-pill offline" id="statusPill">
    <span class="dot offline" id="statusDot"></span>
    <span id="statusLabel">กำลังตรวจสอบ...</span>
  </div>
</header>

<div id="map"></div>

<div class="section-title">🔔 การแจ้งเตือนล่าสุด</div>
<div class="alerts-grid" id="alertsGrid">
  <div class="empty-state">ยังไม่มีการแจ้งเตือน</div>
</div>

<script>
let map, marker;
let knownAlertIds = new Set();

function initMap(lat, lng) {
  map = L.map("map").setView([lat, lng], 15);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
  marker = L.marker([lat, lng]).addTo(map);
}
function updateMap(lat, lng) {
  if (!map) initMap(lat, lng);
  else { marker.setLatLng([lat, lng]); map.panTo([lat, lng]); }
}

function formatElapsed(ms) {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return sec + " วิที่แล้ว";
  const min = Math.floor(sec / 60);
  if (min < 60) return min + " นาทีที่แล้ว";
  const hr = Math.floor(min / 60);
  return hr + " ชม. " + (min % 60) + " นาทีที่แล้ว";
}

// ----- สถานะอุปกรณ์ -----
async function fetchStatus() {
  try {
    const res = await fetch("/api/status");
    const json = await res.json();
    const pill = document.getElementById("statusPill");
    const dot = document.getElementById("statusDot");
    const label = document.getElementById("statusLabel");

    if (json.online) {
      pill.className = "status-pill online";
      dot.className = "dot online";
      label.textContent = "✅ พร้อมใช้งาน";
    } else {
      pill.className = "status-pill offline";
      dot.className = "dot offline";
      label.textContent = json.lastSeen
        ? "⚫ ออฟไลน์ (พบล่าสุด " + formatElapsed(Date.now() - new Date(json.lastSeen).getTime()) + ")"
        : "⚫ ยังไม่เคยเชื่อมต่อ";
    }
  } catch (err) {
    console.error(err);
  }
}

// ----- การ์ดแจ้งเตือน -----
function renderAlertCard(alert, isNew) {
  const div = document.createElement("div");
  div.className = "alert-card" + (isNew ? " new" : "");
  div.dataset.id = alert.id;
  div.dataset.receivedAt = alert.receivedAt;
  div.innerHTML = \`
    <div class="icon">📍</div>
    <div>
      <div class="elapsed" data-elapsed>-</div>
      <div class="coords">\${alert.lat.toFixed(5)}, \${alert.lng.toFixed(5)}</div>
      <div class="time">\${new Date(alert.timestamp).toLocaleString("th-TH")}</div>
    </div>
  \`;
  return div;
}

async function fetchAlerts() {
  try {
    const res = await fetch("/api/alerts");
    const json = await res.json();
    const grid = document.getElementById("alertsGrid");
    const alerts = json.data.slice().reverse(); // ใหม่สุดขึ้นก่อน

    if (alerts.length === 0) {
      grid.innerHTML = '<div class="empty-state">ยังไม่มีการแจ้งเตือน</div>';
      return;
    }

    // ครั้งแรก render ทั้งหมดโดยไม่ flash, ครั้งต่อไปเช็คว่าอันไหนใหม่
    const isFirstLoad = knownAlertIds.size === 0;
    grid.innerHTML = "";
    alerts.forEach((alert) => {
      const isNew = !isFirstLoad && !knownAlertIds.has(alert.id);
      grid.appendChild(renderAlertCard(alert, isNew));
      knownAlertIds.add(alert.id);
    });

    // อัปเดตแผนที่ไปตำแหน่งล่าสุด
    updateMap(alerts[0].lat, alerts[0].lng);
  } catch (err) {
    console.error(err);
  }
}

// อัปเดตตัวเลข "ผ่านไปแล้ว" ในทุกการ์ด ทุกวินาที (ไม่ต้อง fetch ใหม่)
function tickElapsedAll() {
  document.querySelectorAll(".alert-card").forEach((card) => {
    const el = card.querySelector("[data-elapsed]");
    const receivedAt = new Date(card.dataset.receivedAt).getTime();
    el.textContent = formatElapsed(Date.now() - receivedAt);
  });
}

fetchStatus();
fetchAlerts();
setInterval(fetchStatus, 5000);
setInterval(fetchAlerts, 4000);
setInterval(tickElapsedAll, 1000);
</script>
</body>
</html>`;

app.get("/", (req, res) => {
  res.send(HTML_PAGE);
});

app.listen(PORT, () => {
  console.log(`✅ Smart Bag server กำลังทำงานที่ http://localhost:${PORT}`);
  console.log(`🔑 Device Key ปัจจุบัน: ${DEVICE_KEY}`);
});