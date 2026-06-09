const OFFSET_FILE = path.join(__dirname, "lastOffset.json");
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
let lastOffset = loadOffset();

2. Mevcut let lastOffset = 0; satırını sil

3. pollTelegram içinde lastOffset = update.update_id; satırının hemen altına ekle:

saveOffset(lastOffset);

4. main() fonksiyonuna, pollTelegram() çağrısından önce şunu ekle:

// Başlangıçta bekleyen eski mesajları atla
const pending = await getUpdates();
if (pending.length > 0) {
  lastOffset = pending[pending.length - 1].update_id;
  saveOffset(lastOffset);
  console.log(`Başlangıçta ${pending.length} eski update atlandı.`);
}
