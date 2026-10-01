// Patent ilova — server + bot + statistika + admin veb-panel (Railway), kutubxonasiz (Node 18+)
//
// Vazifalari:
//   1) Ilovadan kelgan (anonim ID) ma'lumotni yig'adi va adminlarga (botga) xabar beradi
//   2) Har yangi foydalanuvchini faylga saqlaydi (uid bo'yicha takrorlanmaydi)
//   3) Bot buyruqlari: /start /kun /oy /barcha
//   4) Admin veb-panel: /admin  (parol bilan) — statistika + foydalanuvchi qidirish
//
// Railway → Variables:
//   BOT_TOKEN   — bot tokeni (@BotFather)
//   CHAT_IDS    — adminlar ID lari, vergul bilan: 123456789,987654321
//   ADMIN_PASS  — veb-panelga kirish paroli (maxfiy)
//   DATA_DIR    — doimiy disk yo'li (Railway Volume). Masalan: /data
//                 (bo'sh bo'lsa vaqtinchalik saqlaydi — redeploy'da yo'qoladi)

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const BOT_TOKEN = process.env.BOT_TOKEN || "";
const CHAT_IDS = (process.env.CHAT_IDS || process.env.CHAT_ID || "")
  .split(",").map((s) => s.trim()).filter(Boolean);
const ADMIN_PASS = process.env.ADMIN_PASS || "";
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || ".";
const DATA_FILE = path.join(DATA_DIR, "users.json");
const TZ = process.env.TZ_NAME || "Europe/Moscow";
const ADMIN_HTML = path.join(__dirname, "admin.html");

// ====== Saqlash ======
let users = [];        // [{uid, mamlakat, til, ts}]
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

// ====== Versiya sozlamasi (majburiy yangilash) ======
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
let config = { min: 1, latest: 1, url: "", msg: "" };
try {
  if (fs.existsSync(CONFIG_FILE)) config = Object.assign(config, JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8") || "{}"));
} catch (e) {}
function saveConfig() { try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(config)); } catch (e) {} }

// ====== Maxfiylik siyosati sahifasi (RuStore talab qiladi) ======
const PRIVACY_HTML = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Политика конфиденциальности — Patent imtihoni</title>
<style>body{margin:0;background:#0F1420;color:#EDF1F7;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.6}
.w{max-width:720px;margin:0 auto;padding:28px 18px 60px}h1{font-size:24px}h2{font-size:18px;margin-top:26px;color:#9FB3CC}
a{color:#3B82F6}p,li{color:#CDD6E4;font-size:15px}.muted{color:#8593A8;font-size:13px}</style></head>
<body><div class="w">
<h1>Политика конфиденциальности</h1>
<p class="muted">Приложение «Patent imtihoni» · Обновлено: 01.10.2026</p>

<p>Приложение «Patent imtihoni» помогает трудовым мигрантам готовиться к комплексному экзамену (патент) на родном языке. Мы уважаем вашу конфиденциальность и собираем минимум данных.</p>

<h2>Какие данные мы обрабатываем</h2>
<ul>
<li><b>Анонимный идентификатор.</b> При первом запуске приложение создаёт случайный код (например, «a7f3k9»), не связанный с вашей личностью. Он один раз отправляется на наш сервер только для подсчёта числа пользователей.</li>
<li><b>Язык и страна кода.</b> Вместе с идентификатором передаётся выбранный язык интерфейса — для статистики.</li>
</ul>

<h2>Какие данные мы НЕ собираем</h2>
<ul>
<li>Мы не собираем номер телефона, имя, e-mail, точное местоположение, контакты, фотографии или другие личные данные.</li>
<li>Приложение не показывает рекламу.</li>
<li>Результаты тестов и ваши ошибки хранятся только на вашем устройстве и никуда не отправляются.</li>
</ul>

<h2>Разрешения</h2>
<p>Приложению нужен доступ в Интернет только для загрузки аудиозаданий и проверки обновлений. Приложение работает и офлайн.</p>

<h2>Хранение данных</h2>
<p>Анонимный идентификатор хранится на нашем сервере исключительно для подсчёта аудитории. Он не передаётся третьим лицам.</p>

<h2>Контакты</h2>
<p>По любым вопросам: <a href="mailto:vkholmirzaev@gmail.com">vkholmirzaev@gmail.com</a><br>Разработчики: Kholmirzaev &amp; Qodirov</p>

<p class="muted">Используя приложение, вы соглашаетесь с настоящей политикой.</p>
</div></body></html>`;

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

// ====== Statistika ======
function langLabel(l) {
  return l === "uz" ? "O'zbek (lotin)" : l === "uzc" ? "O'zbek (krill)" :
         l === "tg" ? "Tojik" : l === "ky" ? "Qirg'iz" : "—";
}
function computeStats() {
  const now = Date.now(), today = ymd(now), mon = ym(now);
  let kun = 0, oy = 0;
  const byCountry = {}, byLang = {}, byDay = {};
  users.forEach((u) => {
    const d = ymd(u.ts);
    if (d === today) kun++;
    if (ym(u.ts) === mon) oy++;
    const c = u.mamlakat || "—"; byCountry[c] = (byCountry[c] || 0) + 1;
    const lb = langLabel(u.til); byLang[lb] = (byLang[lb] || 0) + 1;
    byDay[d] = (byDay[d] || 0) + 1;
  });
  // oxirgi 14 kun
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const t = now - i * 86400000, d = ymd(t);
    days.push({ day: d, count: byDay[d] || 0 });
  }
  return { total: users.length, kun, oy, byCountry, byLang, days };
}

// ====== Admin autentifikatsiya (xotirada token) ======
const tokens = {};
function makeToken() { const t = crypto.randomBytes(24).toString("hex"); tokens[t] = Date.now(); return t; }
function validToken(req, u) {
  let t = (req.headers["authorization"] || "").replace(/^Bearer\s+/i, "");
  if (!t && u) t = u.searchParams.get("token") || "";
  return t && tokens[t] ? true : false;
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = ""; req.on("data", (c) => { b += c; if (b.length > 100000) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch (e) { resolve({}); } });
  });
}
function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

let _adminCache = null;
function serveAdmin(res) {
  try {
    if (_adminCache === null) _adminCache = fs.readFileSync(ADMIN_HTML, "utf8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(_adminCache);
  } catch (e) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("admin.html topilmadi");
  }
}

// ====== HTTP server ======
const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  const u = new URL(req.url, "http://x");
  const p = u.pathname;

  // --- Admin panel sahifasi ---
  if (req.method === "GET" && (p === "/admin" || p === "/admin/")) { serveAdmin(res); return; }

  // --- Admin API ---
  if (p === "/api/login" && req.method === "POST") {
    const d = await readBody(req);
    if (!ADMIN_PASS) return json(res, 500, { ok: false, xato: "Server parol sozlanmagan (ADMIN_PASS)" });
    if (String(d.pass || "") === ADMIN_PASS) return json(res, 200, { ok: true, token: makeToken() });
    await new Promise((r) => setTimeout(r, 700)); // brute-force sekinlashtirish
    return json(res, 401, { ok: false, xato: "Parol noto'g'ri" });
  }
  if (p === "/api/stats" && req.method === "GET") {
    if (!validToken(req, u)) return json(res, 401, { ok: false });
    return json(res, 200, { ok: true, stats: computeStats() });
  }
  if (p === "/api/user" && req.method === "GET") {
    if (!validToken(req, u)) return json(res, 401, { ok: false });
    const id = String(u.searchParams.get("id") || "").trim().toLowerCase();
    const rec = users.filter((x) => String(x.uid || "").toLowerCase() === id)[0];
    if (!rec) return json(res, 200, { ok: true, topildi: false });
    return json(res, 200, { ok: true, topildi: true, user: {
      id: rec.uid, mamlakat: rec.mamlakat || "—", til: langLabel(rec.til),
      sana: ymd(rec.ts), vaqt: new Date(rec.ts).toLocaleString("ru-RU", { timeZone: TZ })
    }});
  }

  // --- Maxfiylik siyosati (RuStore uchun) ---
  if (req.method === "GET" && (p === "/privacy" || p === "/privacy/")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(PRIVACY_HTML);
    return;
  }

  // --- Ilova uchun ochiq config (versiya tekshiruvi) ---
  if (p === "/config" && req.method === "GET") { return json(res, 200, config); }

  // --- Admin: config o'qish/yozish ---
  if (p === "/api/config" && req.method === "GET") {
    if (!validToken(req, u)) return json(res, 401, { ok: false });
    return json(res, 200, { ok: true, config: config });
  }
  if (p === "/api/config" && req.method === "POST") {
    if (!validToken(req, u)) return json(res, 401, { ok: false });
    const d = await readBody(req);
    if (typeof d.min === "number" && isFinite(d.min)) config.min = Math.max(1, Math.floor(d.min));
    if (typeof d.latest === "number" && isFinite(d.latest)) config.latest = Math.max(1, Math.floor(d.latest));
    if (typeof d.url === "string") config.url = d.url.trim();
    if (typeof d.msg === "string") config.msg = d.msg;
    saveConfig();
    return json(res, 200, { ok: true, config: config });
  }

  // --- Ilovadan ma'lumot (POST /) ---
  if (req.method === "POST") {
    const d = await readBody(req);
    const uid = d.uid || ("anon" + Date.now());
    const raqam = d.raqam || d.id || "—", mamlakat = d.mamlakat || "—", til = d.til || "—";
    if (!seen.has(uid)) {
      seen.add(uid);
      users.push({ uid: uid, mamlakat: mamlakat, til: til, ts: Date.now() });
      save();
      await notifyAll(
        "🆕 Yangi foydalanuvchi qo'shildi\n" +
        "🆔 " + raqam + "\n" +
        "🌍 " + mamlakat + "\n" +
        "🗣 " + langLabel(til) + "\n" +
        "👥 Umumiy: " + users.length
      );
    }
    return json(res, 200, { ok: true });
  }

  // --- default ---
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Patent server ishlayapti ✅ | Foydalanuvchilar: " + users.length + " | Panel: /admin");
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Patent server ishga tushdi, port: " + PORT));

// ====== Bot buyruqlari ======
function isAdmin(id) { return CHAT_IDS.indexOf(String(id)) >= 0; }

let offset = 0;
async function poll() {
  const r = await tg("getUpdates", { offset: offset, timeout: 50 });
  if (r && r.ok && Array.isArray(r.result)) {
    for (const upd of r.result) {
      offset = upd.update_id + 1;
      const m = upd.message;
      if (!m || !m.text) continue;
      const txt = m.text.trim();
      const chatId = m.chat.id;

      if (txt.startsWith("/start")) {
        await tg("sendMessage", { chat_id: chatId, text:
          "Assalomu alaykum! 👋\nBu — Patent ilova xabarnoma boti.\n\n" +
          "Sizning ID: " + chatId + "\n\nBu ID ni administratorga bering." });
        continue;
      }

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
