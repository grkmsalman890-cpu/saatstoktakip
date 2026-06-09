const axios = require("axios");

const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const TELEGRAM_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || "").trim();
const CHECK_INTERVAL_MS = parseInt(process.env.CHECK_INTERVAL_MINUTES || "5") * 60 * 1000;

const DEFAULT_URL =
  "https://saatcitevfik.com/unisex-retro-kol-saati-a168wa-1wdf-2-yil-turkiye-distributoru-ersa-saat-garantilidir-";

function parseProductUrls() {
  const raw = (process.env.PRODUCT_URLS || "").trim();
  if (!raw) return [DEFAULT_URL];
  const urls = raw
    .split(",")
    .map((u) => u.trim())
    .filter((u) => u.length > 0)
    .slice(0, 100);
  return urls.length > 0 ? urls : [DEFAULT_URL];
}

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error("HATA: TELEGRAM_BOT_TOKEN ve TELEGRAM_CHAT_ID environment variable olarak ayarlanmalı.");
  process.exit(1);
}

const productStates = {};

async function checkProduct(url) {
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
    if (!jsonLdMatches) return;

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

    if (!productData) return;

    const offer = Array.isArray(productData.offers) ? productData.offers[0] : productData.offers;
    const availability = offer.availability || "";
    const price = offer.price || "?";
    const currency = offer.priceCurrency || "TRY";
    const productName = productData.name || url;

    const inStock =
      availability.toLowerCase().includes("instock") ||
      availability.toLowerCase().includes("limitedavailability");

    const state = productStates[url] || { notificationSent: false };
    const statusText = inStock ? "STOKTA VAR ✅" : "STOKTA YOK ❌";
    console.log(`[${new Date().toISOString()}] ${statusText} | ${price} ${currency} | ${productName.substring(0, 60)}`);

    if (inStock && !state.notificationSent) {
      await sendTelegramMessage(productName, price, currency, url);
      state.notificationSent = true;
    } else if (!inStock) {
      if (state.notificationSent) {
        console.log(`[${new Date().toISOString()}] Stok tükendi, bir sonraki gelişte tekrar bildirim gönderilecek.`);
      }
      state.notificationSent = false;
    }

    productStates[url] = state;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Kontrol hatası (${url.substring(0, 50)}...):`, error.message);
  }
}

async function sendTelegramMessage(productName, price, currency, url) {
  const message =
    `🟢 *STOKTA VAR!*\n\n` +
    `⌚ *${productName}*\n\n` +
    `💰 Fiyat: *${price} ${currency}*\n\n` +
    `🔗 [Ürüne Git](${url})\n\n` +
    `⏰ ${new Date().toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}`;

  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: "Markdown",
      disable_web_page_preview: false,
    });
    console.log(`[${new Date().toISOString()}] ✅ Telegram bildirimi gönderildi: ${productName.substring(0, 40)}`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Telegram gönderim hatası:`, error.message);
  }
}

async function checkAllProducts() {
  const urls = parseProductUrls();
  for (const url of urls) {
    await checkProduct(url);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function sendStartupMessage(urls) {
  const urlList = urls.map((u, i) => `${i + 1}. ${u}`).join("\n");
  const message =
    `🤖 *Stok Takip Botu Başlatıldı*\n\n` +
    `📦 Takip edilen ürün sayısı: *${urls.length}*\n\n` +
    `${urlList.substring(0, 3000)}\n\n` +
    `🔄 Kontrol aralığı: Her ${CHECK_INTERVAL_MS / 60000} dakikada bir`;

  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Başlangıç mesajı gönderilemedi:`, error.message);
  }
}

async function main() {
  const urls = parseProductUrls();
  console.log(`Stok takip botu başlatıldı.`);
  console.log(`Takip edilen ürün sayısı: ${urls.length}`);
  console.log(`Kontrol aralığı: ${CHECK_INTERVAL_MS / 60000} dakika`);
  urls.forEach((u, i) => console.log(`  ${i + 1}. ${u}`));

  await sendStartupMessage(urls);
  await checkAllProducts();

  setInterval(checkAllProducts, CHECK_INTERVAL_MS);
}

main();
