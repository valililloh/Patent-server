// Patent ilova — server + bot + statistika (Railway uchun), kutubxonasiz (Node 18+)
//
// Vazifalari:
//   1) Ilovadan kelgan (niqoblangan) ma'lumotni adminlarga (botga) yuboradi
//   2) Har yangi foydalanuvchini faylga saqlaydi (uid bo'yicha takrorlanmaydi)
//   3) Bot buyruqlari:
//        /start  — istalgan odamga ID sini qaytaradi
//        /kun    — bugun qo'shilganlar (faqat admin)
//        /oy     — shu oyda qo'shilganlar (faqat admin)
//        /barcha — umumiy foydalanuvchilar soni (faqat admin)
//
// Railway → Variables:
//   BOT_TOKEN  — bot tokeni (@BotFather)
//   CHAT_IDS   — adminlar ID lari, vergul bilan: 123456789,987654321
//   DATA_DIR   — doimiy disk yo'li (Railway Volume). Masalan: /data
//                (bo'sh bo'lsa vaqtinchalik saqlaydi — redeploy'da yo'qoladi)

const http = require("http");
const fs = require("fs");
const path = require("path");

const BOT_TOKEN = process.env.BOT_TOKEN || "";
const CHAT_IDS = (process.env.CHAT_IDS || process.env.CHAT_ID || "")
  .split(",").map((s) => s.trim()).filter(Boolean);
const DATA_DIR = process.env.DATA_DIR || ".";
const DATA_FILE = path.join(DATA_DIR, "users.json");
const TZ = process.env.TZ_NAME || "Europe/Moscow";

// ====== Saqlash ======
let users = [];        // [{uid, mamlakat, ts}]
let seen = new Set();  // uid lar
try {
  if (fs.existsSync(DATA_FILE)) {
    users = JSON.parse(fs.readFileSync(DATA_FILE, "utf8") || "[]");
    users.forEach((u) => seen.add(u.uid));
  }
} catch (e) { users = []; seen = new Set(); }

function save() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(users)); } catch (e) {}
}

// Sana yordamchilari (Moscow vaqti bo'yicha)
function ymd(ts) { return new Date(ts).toLocaleDateString("en-CA", { timeZone: TZ }); } // YYYY-MM-DD
function ym(ts)  { return ymd(ts).slice(0, 7); } // YYYY-MM

// ====== Telegram ======
async function tg(method, payload) {
  try {
    const r = await fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/" + method, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return await r.json();
  } catch (e) { return null; }
}
async function notifyAll(text) {
  for (const id of CHAT_IDS) await tg("sendMessage", { chat_id: id, text: text });
}

// ====== 1) HTTP server — ilovadan ma'lumot ======
const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  if (req.method !== "POST") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Patent server ishlayapti ✅ | Foydalanuvchilar: " + users.length);
    return;
  }

  let body = "";
  req.on("data", (c) => { body += c; if (body.length > 100000) req.destroy(); });
  req.on("end", async () => {
    let d = {};
    try { d = JSON.parse(body || "{}"); } catch (e) {}
    const uid = d.uid || ("anon" + Date.now());
    const raqam = d.raqam || "—", mamlakat = d.mamlakat || "—", til = d.til || "—";

    // Takrorlanmasin — faqat yangi uid
    if (!seen.has(uid)) {
      seen.add(uid);
      users.push({ uid: uid, mamlakat: mamlakat, ts: Date.now() });
      save();
      await notifyAll(
        "🆕 Yangi foydalanuvchi qo'shildi\n" +
        "📞 " + raqam + "\n" +
        "🌍 " + mamlakat + "\n" +
        "🗣 " + til + "\n" +
        "👥 Umumiy: " + users.length
      );
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Patent server ishga tushdi, port: " + PORT));

// ====== 2) Bot buyruqlari ======
function isAdmin(id) { return CHAT_IDS.indexOf(String(id)) >= 0; }

let offset = 0;
async function poll() {
  const r = await tg("getUpdates", { offset: offset, timeout: 50 });
  if (r && r.ok && Array.isArray(r.result)) {
    for (const u of r.result) {
      offset = u.update_id + 1;
      const m = u.message;
      if (!m || !m.text) continue;
      const txt = m.text.trim();
      const chatId = m.chat.id;

      if (txt.startsWith("/start")) {
        await tg("sendMessage", { chat_id: chatId, text:
          "Assalomu alaykum! 👋\nBu — Patent ilova xabarnoma boti.\n\n" +
          "Sizning ID: " + chatId + "\n\nBu ID ni administratorga bering." });
        continue;
      }

      // Statistika — faqat admin
      if (txt.startsWith("/kun") || txt.startsWith("/oy") || txt.startsWith("/barcha")) {
        if (!isAdmin(chatId)) {
          await tg("sendMessage", { chat_id: chatId, text: "Bu buyruq faqat administrator uchun." });
          continue;
        }
        const now = Date.now();
        if (txt.startsWith("/kun")) {
          const today = ymd(now);
          const n = users.filter((x) => ymd(x.ts) === today).length;
          await tg("sendMessage", { chat_id: chatId, text: "📅 Bugun qo'shilganlar: " + n });
        } else if (txt.startsWith("/oy")) {
          const mon = ym(now);
          const n = users.filter((x) => ym(x.ts) === mon).length;
          await tg("sendMessage", { chat_id: chatId, text: "🗓 Bu oyda qo'shilganlar: " + n });
        } else {
          await tg("sendMessage", { chat_id: chatId, text: "👥 Umumiy foydalanuvchilar: " + users.length });
        }
      }
    }
  }
  setTimeout(poll, 1000);
}
if (BOT_TOKEN) poll();
