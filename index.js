const axios = require("axios");

const PRODUCT_URL =
  "https://saatcitevfik.com/unisex-retro-kol-saati-a168wa-1wdf-2-yil-turkiye-distributoru-ersa-saat-garantilidir-";
const PRODUCT_NAME = "Casio A168WA-1WDF Unisex Retro Kol Saati";

const TELEGRAM_BOT_TOKEN = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
const TELEGRAM_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || "").trim();
const CHECK_INTERVAL_MS = parseInt(process.env.CHECK_INTERVAL_MINUTES || "5") * 60 * 1000;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error("HATA: TELEGRAM_BOT_TOKEN ve TELEGRAM_CHAT_ID environment variable olarak ayarlanmalı.");
  process.exit(1);
}

let lastStatus = null;
let notificationSent = false;

async function checkStock() {
  try {
    const response = await axios.get(PRODUCT_URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "tr-TR,tr;q=0.9",
      },
      timeout: 15000,
    });

    const html = response.data;

    const jsonLdMatches = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
    if (!jsonLdMatches) {
      console.log(`[${new Date().toISOString()}] JSON-LD verisi bulunamadı.`);
      return;
    }

    let productData = null;
    for (const match of jsonLdMatches) {
      const jsonStr = match.replace(/<script type="application\/ld\+json">/, "").replace(/<\/script>/, "");
      try {
        const parsed = JSON.parse(jsonStr);
        if (parsed["@type"] === "Product" && parsed.offers) {
          productData = parsed;
          break;
        }
      } catch (_) {}
    }

    if (!productData) {
      console.log(`[${new Date().toISOString()}] Ürün verisi JSON-LD içinde bulunamadı.`);
      return;
    }

    const offer = Array.isArray(productData.offers) ? productData.offers[0] : productData.offers;
    const availability = offer.availability || "";
    const price = offer.price || "?";
    const currency = offer.priceCurrency || "TRY";

    const inStock =
      availability.toLowerCase().includes("instock") || availability.toLowerCase().includes("limitedavailability");

    const statusText = inStock ? "STOKTA VAR" : "STOKTA YOK";
    console.log(`[${new Date().toISOString()}] Durum: ${statusText} | Fiyat: ${price} ${currency}`);

    if (inStock && !notificationSent) {
      await sendTelegramMessage(price, currency);
      notificationSent = true;
    } else if (!inStock) {
      if (notificationSent) {
        console.log(`[${new Date().toISOString()}] Stok tükendi, bir sonraki gelişte tekrar bildirim gönderilecek.`);
      }
      notificationSent = false;
    }

    lastStatus = inStock;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Kontrol hatası:`, error.message);
  }
}

async function sendTelegramMessage(price, currency) {
  const message =
    `🟢 *STOKTA VAR!*\n\n` +
    `⌚ *${PRODUCT_NAME}*\n\n` +
    `💰 Fiyat: *${price} ${currency}*\n\n` +
    `🔗 [Ürüne Git](${PRODUCT_URL})\n\n` +
    `⏰ ${new Date().toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}`;

  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: "Markdown",
      disable_web_page_preview: false,
    });
    console.log(`[${new Date().toISOString()}] Telegram bildirimi gönderildi!`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Telegram gönderim hatası:`, error.message);
  }
}

async function sendStartupMessage() {
  const message =
    `🤖 *Stok Takip Botu Başlatıldı*\n\n` +
    `⌚ Takip edilen ürün:\n${PRODUCT_NAME}\n\n` +
    `🔄 Kontrol aralığı: Her ${CHECK_INTERVAL_MS / 60000} dakikada bir\n\n` +
    `📡 İlk kontrol yapılıyor...`;

  try {
    await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: "Markdown",
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Başlangıç mesajı gönderilemedi:`, error.message);
  }
}

async function main() {
  console.log(`Stok takip botu başlatıldı.`);
  console.log(`Ürün: ${PRODUCT_URL}`);
  console.log(`Kontrol aralığı: ${CHECK_INTERVAL_MS / 60000} dakika`);

  await sendStartupMessage();
  await checkStock();

  setInterval(checkStock, CHECK_INTERVAL_MS);
}

main();
