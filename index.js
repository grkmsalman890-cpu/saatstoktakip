const axios = require("axios");
const fs = require("fs");
const path = require("path");
const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const TELEGRAM_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || "").trim();
const CHECK_INTERVAL_MS = parseInt(process.env.CHECK_INTERVAL_MINUTES || "5") * 60 * 1000;
const DATA_FILE = path.join(__dirname, "products.json");
const OFFSET_FILE = path.join(__dirname, "lastOffset.json");
const DEFAULT_URL =
  "https://saatcitevfik.com/unisex-retro-kol-saati-a168wa-1wdf-2-yil-turkiye-distributoru-ersa-saat-garantilidir-";
if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error("HATA: TELEGRAM_BOT_TOKEN ve TELEGRAM_CHAT_ID environment variable olarak ayarlanmalı.");
  process.exit(1);
}
function loadProducts() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      if (Array.isArray(data) && data.length > 0) return data;
    }
  } catch (_) {}
  const envUrls = (process.env.PRODUCT_URLS || "")
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean)
    .slice(0, 100);
  return envUrls.length > 0 ? envUrls : [DEFAULT_URL];
}
function saveProducts(urls) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(urls, null, 2));
}
function loadOffset() {
  try {
    if (fs.existsSync(OFFSET_FILE)) {
      return JSON.parse(fs.readFileSync(OFFSET_FILE, "utf8")).offset || 0;
    }
  } catch (_) {}
  return 0;
}
function saveOffset(offset) {
  fs.writeFileSync(OFFSET_FILE, JSON.stringify({ offset }));
}
let products = loadProducts();
const notificationSent = {};
let lastOffset = loadOffset();
async function tgSend(text, options = {}) {
  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
      ...options,
    });
  } catch (e) {
    console.error("Telegram gönderim hatası:", e.message);
  }
}
async function getUpdates() {
  try {
    const res = await axios.get(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates`, {
      params: { offset: lastOffset + 1, timeout: 5, allowed_updates: ["message"] },
      timeout: 10000,
    });
    return res.data.result || [];
  } catch (_) {
    return [];
  }
}
async function handleCommand(text) {
  const trimmed = text.trim();
  if (trimmed === "/yardim" || trimmed === "/start") {
    await tgSend(
      `🤖 *Stok Takip Botu — Komutlar*\n\n` +
      `*/ekle* URL — Ürün ekle (maks 100)\n` +
      `*/sil* N — N. ürünü sil\n` +
      `*/liste* — Takip listesini gör\n` +
      `*/durum* — Anlık stok kontrolü\n` +
      `*/test* — Örnek mesaj gör\n` +
      `*/yardim* — Bu mesajı göster`
    );
    return;
  }
  if (trimmed === "/test") {
    const exampleMessage =
      `🟢 *STOKTA VAR!*\n\n` +
      `⌚ *Unisex Retro Kol Saati A168WA-1WDF*\n\n` +
      `💰 Fiyat: *1920.00 TRY*\n\n` +
      `🔗 [Ürüne Git](https://saatcitevfik.com/unisex-retro-kol-saati-a168wa-1wdf-2-yil-turkiye-distributoru-ersa-saat-garantilidir-)\n\n` +
      `⏰ ${new Date().toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}`;
    await tgSend(exampleMessage, { disable_web_page_preview: false });
    return;
  }
  if (trimmed === "/liste") {
    if (products.length === 0) {
      await tgSend("📭 Takip listesi boş. `/ekle URL` ile ürün ekle.");
      return;
    }
    const list = products.map((u, i) => `${i + 1}. ${u}`).join("\n");
    await tgSend(`📋 *Takip Edilen Ürünler (${products.length})*\n\n${list}`);
    return;
  }
  if (trimmed === "/durum") {
    await checkAllProducts(true);
    return;
  }
  if (trimmed.startsWith("/ekle ")) {
    const url = trimmed.slice(6).trim();
    if (!url.startsWith("http")) {
      await tgSend("❌ Geçersiz URL. `http://` veya `https://` ile başlamalı.");
      return;
    }
    if (products.includes(url)) {
      await tgSend("⚠️ Bu ürün zaten listede.");
      return;
    }
    if (products.length >= 100) {
      await tgSend("❌ Maksimum 100 ürün takip edilebilir.");
      return;
    }
    products.push(url);
    saveProducts(products);
    await tgSend(`✅ Ürün eklendi! Toplam: *${products.length}* ürün\n\n${url}`);
    return;
  }
  if (trimmed.startsWith("/sil ")) {
    const n = parseInt(trimmed.slice(5).trim());
    if (isNaN(n) || n < 1 || n > products.length) {
      await tgSend(`❌ Geçersiz numara. 1 ile ${products.length} arasında bir sayı gir.`);
      return;
    }
    const removed = products.splice(n - 1, 1)[0];
    delete notificationSent[removed];
    saveProducts(products);
    await tgSend(`🗑️ Silindi: ${removed}\n\nKalan ürün sayısı: *${products.length}*`);
    return;
  }
  await tgSend("❓ Bilinmeyen komut. `/yardim` yazarak komutları görebilirsin.");
}
async function checkProduct(url, forceReport = false) {
  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "tr-TR,tr;q=0.9",
      },
      timeout: 15000,
    });
    const html = response.data;
    const jsonLdMatches = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
    if (!jsonLdMatches) return null;
    let productData = null;
    for (const match of jsonLdMatches) {
      const jsonStr = match
        .replace(/<script type="application\/ld\+json">/, "")
        .replace(/<\/script>/, "");
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed["@type"] === "Product" && parsed.offers) {
          productData = parsed;
          break;
        }
      } catch (_) {}
    }
    if (!productData) return null;
    const offer = Array.isArray(productData.offers) ? productData.offers[0] : productData.offers;
    const availability = offer.availability || "";
    const price = offer.price || "?";
    const currency = offer.priceCurrency || "TRY";
    const productName = productData.name || url;
    const inStock =
      availability.toLowerCase().includes("instock") ||
      availability.toLowerCase().includes("limitedavailability");
    console.log(
      `[${new Date().toISOString()}] ${inStock ? "✅ STOKTA VAR" : "❌ STOKTA YOK"} | ${price} ${currency} | ${productName.substring(0, 60)}`
    );
    if (forceReport) {
      return { inStock, price, currency, productName, url };
    }
    if (inStock && !notificationSent[url]) {
      const message =
        `🟢 *STOKTA VAR!*\n\n` +
        `⌚ *${productName}*\n\n` +
        `💰 Fiyat: *${price} ${currency}*\n\n` +
        `🔗 [Ürüne Git](${url})\n\n` +
        `⏰ ${new Date().toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}`;
      await tgSend(message, { disable_web_page_preview: false });
      notificationSent[url] = true;
    } else if (!inStock) {
      notificationSent[url] = false;
    }
    return { inStock, price, currency, productName, url };
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Hata (${url.substring(0, 50)}):`, error.message);
    return null;
  }
}
async function checkAllProducts(report = false) {
  const results = [];
  for (const url of [...products]) {
    const r = await checkProduct(url, report);
    if (r) results.push(r);
    await new Promise((res) => setTimeout(res, 1000));
  }
  if (report && results.length > 0) {
    const lines = results.map(
      (r, i) =>
        `${i + 1}. ${r.inStock ? "🟢 STOKTA VAR" : "🔴 STOKTA YOK"} — ${r.price} ${r.currency}\n   ${r.productName.substring(0, 50)}`
    );
    await tgSend(`📊 *Durum Raporu*\n\n${lines.join("\n\n")}`);
  }
}
async function pollTelegram() {
  const updates = await getUpdates();
  for (const update of updates) {
    lastOffset = update.update_id;
    saveOffset(lastOffset);
    const msg = update.message;
    if (!msg || !msg.text) continue;
    if (String(msg.chat.id) !== String(TELEGRAM_CHAT_ID)) continue;
    if (msg.text.startsWith("/")) {
      console.log(`[${new Date().toISOString()}] Komut alındı: ${msg.text}`);
      await handleCommand(msg.text);
    }
  }
  setTimeout(pollTelegram, 2000);
}
async function main() {
  console.log(`Stok takip botu başlatıldı.`);
  console.log(`Takip edilen ürün sayısı: ${products.length}`);
  console.log(`Kontrol aralığı: ${CHECK_INTERVAL_MS / 60000} dakika`);
  const pending = await getUpdates();
  if (pending.length > 0) {
    lastOffset = pending[pending.length - 1].update_id;
    saveOffset(lastOffset);
    console.log(`Başlangıçta ${pending.length} eski update atlandı.`);
  }
  await tgSend(
    `🤖 *Stok Takip Botu Başlatıldı*\n\n` +
    `📦 Takip edilen ürün: *${products.length}*\n` +
    `🔄 Kontrol aralığı: Her *${CHECK_INTERVAL_MS / 60000}* dakikada bir\n\n` +
    `Komutlar için */yardim* yaz.`
  );
  await checkAllProducts();
  setInterval(checkAllProducts, CHECK_INTERVAL_MS);
  pollTelegram();
}
main();
