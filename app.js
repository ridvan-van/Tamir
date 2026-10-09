/* Tamir Asistanı — telefon sürümü (PWA)
 * Telefonun kamerası TEPE KAMERASI olarak kullanılır; mikroskop yoktur.
 * Yapay zeka çağrıları doğrudan telefondan yapılır: Gemini → Groq → (isteğe bağlı) Claude.
 * Anahtarlar yalnızca bu telefonun tarayıcısında saklanır; başka hiçbir sunucuya gitmez.
 */
"use strict";
const SURUM = "tel-1.2";
const $ = (s, k = document) => k.querySelector(s);
const $$ = (s, k = document) => [...k.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const simdi = () => new Date().toISOString();
const saat = iso => { try { return new Date(iso).toLocaleTimeString("tr-TR", {hour: "2-digit", minute: "2-digit"}); } catch { return ""; } };
const tarihSaat = iso => { try { return new Date(iso).toLocaleString("tr-TR"); } catch { return iso || ""; } };
const bekle = ms => new Promise(r => setTimeout(r, ms));
const HITAP = "abi";

/* ---------- Kalıcı ayarlar (localStorage, hatasız) ---------- */
function lsOku(k, v) { try { const x = localStorage.getItem(k); return x == null ? v : JSON.parse(x); } catch { return v; } }
function lsYaz(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }
const VARSAYILAN_AYAR = {
  gemini: "", groq: "", claude: "", teknisyen: "", ses: true, teyit: true, fazUyari: true,
  ellerSerbest: false, yontem: "kamera", kamera: "environment", gizlilik: false,
};
let AYAR = Object.assign({}, VARSAYILAN_AYAR, lsOku("ayar", {}));
function ayarKaydet() { lsYaz("ayar", AYAR); }

/* ---------- IndexedDB: oturumlar (fotoğraflar büyük olduğu için) ---------- */
const DB = {
  _db: null,
  ac() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((ok, red) => {
      const r = indexedDB.open("tamir_asistani", 1);
      r.onupgradeneeded = () => { r.result.createObjectStore("oturum", {keyPath: "id"}); };
      r.onsuccess = () => { this._db = r.result; ok(this._db); };
      r.onerror = () => red(r.error);
    });
  },
  async islem(mod, fn) {
    const db = await this.ac();
    return new Promise((ok, red) => {
      const t = db.transaction("oturum", mod); const s = t.objectStore("oturum");
      const r = fn(s); t.oncomplete = () => ok(r && r.result); t.onerror = () => red(t.error);
    });
  },
  yaz(o) { return this.islem("readwrite", s => s.put(o)); },
  oku(id) { return this.islem("readonly", s => s.get(id)); },
  sil(id) { return this.islem("readwrite", s => s.delete(id)); },
  hepsi() { return this.islem("readonly", s => s.getAll()); },
};

/* ---------- Sabitler (masaüstü sürümle aynı) ---------- */
const FAZLAR = ["gorsel", "enerjisiz", "ilk_enerji", "enerjili", "dogrulama"];
const FAZ_ADI = {gorsel: "Görsel kontrol", enerjisiz: "Enerjisiz ölçümler", ilk_enerji: "Akım sınırlı ilk enerji",
  enerjili: "Enerjili ölçümler", dogrulama: "İşlevsel doğrulama"};
const FAZ_GUVENLIK = {
  enerjisiz: "Enerjiyi kesin, büyük kondansatörleri deşarj edip ölçerek doğrulayın.",
  ilk_enerji: "İlk enerjiyi akım sınırlı verin (lab kaynağı limiti veya seri lamba), çıkışa sahte yük bağlayın, kartın yanında durun.",
  enerjili: "Kart enerjili. Tek elle ölçün; primer/şebeke tarafında izolasyon trafosu kullanın, osiloskop toprağını primere bağlamayın.",
  dogrulama: "Yük altında çalıştırırken ısınmayı izleyin; röntgen/lazer gibi tehlikeli çıkışlarda cihazın güvenlik kilitlerini devre dışı bırakmayın.",
};
const KONTROL_LISTESI = [
  ["yanik", "Yanık izi / koku / renk değişimi"], ["kondansator", "Şişmiş, akmış veya çatlak kondansatör"],
  ["korozyon", "Korozyon / sıvı kalıntısı"], ["lehim", "Soğuk lehim / çatlak lehim / köprü"],
  ["konnektor", "Konnektör / klemens / kablo hasarı"], ["eksik", "Eksik, kırık veya sonradan değiştirilmiş parça"],
  ["sigorta", "Sigorta açık (gözle veya süreklilikle)"],
];
const MODLAR = {DCV: "DC gerilim", ACV: "AC gerilim", OHM: "Direnç", DIYOT: "Diyot testi", SUREKLILIK: "Süreklilik",
  KAPASITE: "Kapasite", AKIM: "Akım", FREKANS: "Frekans", DALGA: "Osiloskop dalga şekli"};
const SONUC_ADI = {giderildi: "Arıza giderildi", kismen: "Kısmen giderildi", giderilmedi: "Giderilmedi", ekonomik_degil: "Onarım ekonomik değil"};

/* ---------- Oturum durumu ---------- */
function bosOturum() {
  return {
    id: "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), surum: SURUM,
    olusturma: simdi(), teknisyen: AYAR.teknisyen || "", kart: {cihaz: "", kart: "", parca_no: "", rev: "", seri: "", belirti: ""},
    faz: "gorsel", referans: false, kontrol: null, bulgular: [], olcumler: [], hipotezler: [], elenen: [],
    mesajlar: [], adim: {tur: "bilgi"}, guvenlikVerildi: [], ilkFoto: null, sonModel: "", kapanis: null, kilitli: false,
  };
}
let S = bosOturum();
let _kayitZamanlayici = null;
function kaydet(hemen) {
  clearTimeout(_kayitZamanlayici);
  const f = () => DB.yaz(S).catch(e => bildir("Kayıt yazılamadı: " + e.message, "hata"));
  if (hemen) return f();
  _kayitZamanlayici = setTimeout(f, 400);
}
/* ---------- Birimler (büyük/küçük harf önemli: mΩ ≠ MΩ) ---------- */
const ONEK = {p: 1e-12, n: 1e-9, u: 1e-6, "µ": 1e-6, "μ": 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9};
const TEMEL_BIRIM = {V: "V", A: "A", "Ω": "Ω", ohm: "Ω", Ohm: "Ω", OHM: "Ω", R: "Ω", F: "F", Hz: "Hz", HZ: "Hz", hz: "Hz", W: "W"};
function birimCoz(birim) {
  // "mΩ" → {carpan: 1e-3, temel: "Ω"};   "MΩ" → 1e6;  "V" → 1
  birim = String(birim || "").trim().replace(/\s+/g, "");
  if (!birim) return null;
  if (TEMEL_BIRIM[birim]) return {carpan: 1, temel: TEMEL_BIRIM[birim]};
  const on = birim[0], kalan = birim.slice(1);
  if (ONEK[on] && TEMEL_BIRIM[kalan]) return {carpan: ONEK[on], temel: TEMEL_BIRIM[kalan]};
  return null;
}
function modNormalle(m) {
  m = String(m || "").toUpperCase().replace(/İ/g, "I").replace(/[^A-Z]/g, "");
  if (!m) return "";
  if (MODLAR[m]) return m;
  if (/^(VDC|DC|DCV|V)$/.test(m)) return "DCV";
  if (/^(VAC|AC|ACV)$/.test(m)) return "ACV";
  if (/OHM|DIREN|RES/.test(m)) return "OHM";
  if (/DIY|DIOD/.test(m)) return "DIYOT";
  if (/SUREK|CONT|BUZ|BIP/.test(m)) return "SUREKLILIK";
  if (/KAP|CAP/.test(m)) return "KAPASITE";
  if (/AKIM|AMP|CUR/.test(m)) return "AKIM";
  if (/FREK|HZ|FREQ/.test(m)) return "FREKANS";
  if (/DALGA|OSIL|SCOPE|WAVE/.test(m)) return "DALGA";
  return "";
}
/** Ölçümü birime uygun moda zorlar ve SI tabanında değeri hesaplar. */
function olcumNormalle(sayi, birim, mod, hamMetin) {
  mod = modNormalle(mod);
  const b = birimCoz(birim);
  let taban = (typeof sayi === "number" && isFinite(sayi) && b) ? sayi * b.carpan : null;
  if (b) {
    const t = b.temel;
    if (t === "Ω" && !["OHM", "SUREKLILIK"].includes(mod)) mod = "OHM";
    else if (t === "V" && !["DCV", "ACV", "DIYOT", "DALGA"].includes(mod))
      mod = /AC|~|VAC/i.test(hamMetin || "") ? "ACV" : "DCV";
    else if (t === "A") mod = "AKIM";
    else if (t === "F") mod = "KAPASITE";
    else if (t === "Hz" && mod !== "DALGA") mod = "FREKANS";
  }
  return {sayi: (typeof sayi === "number" && isFinite(sayi)) ? sayi : null, birim: birim || "", mod, taban};
}
/** Elle yazılan değeri ayrıştırır: "5,02 V", "220 mΩ", "0.6", "4,7k" … */
function degerAyristir(metin, varsayilanMod) {
  const t = String(metin || "").replace(/−/g, "-").replace(/volt\b/gi, "V").replace(/amper\b/gi, "A")
    .replace(/\b(mili|milli)\s*(V|A)\b/gi, "m$2").replace(/(\d\s*[pnuµμmkKMG]?)v\b/g, "$1V").replace(/\bhertz\b/gi, "Hz").trim();
  const r = /([-+]?\d+(?:[.,]\d+)?)\s*(p|n|u|µ|μ|m|k|K|M|G)?\s*(V|A|Ω|[Oo]hm|OHM|F|Hz|HZ|hz|R)?(?![a-zçğıöşü])/;
  const x = t.match(r);
  if (!x) return null;
  const sayi = parseFloat(x[1].replace(",", "."));
  let birim = (x[2] || "") + (x[3] || "");
  if (!x[3]) {   // birimsiz: önek tek başına ise (4,7k) moda göre tamamla
    const md = modNormalle(varsayilanMod);
    const tb = {DCV: "V", ACV: "V", DIYOT: "V", OHM: "Ω", SUREKLILIK: "Ω", KAPASITE: "F", AKIM: "A", FREKANS: "Hz"}[md];
    birim = tb ? (x[2] || "") + tb : "";
  }
  if (/ohm/i.test(birim)) birim = birim.replace(/[Oo]hm|OHM/, "Ω");
  if (/R$/.test(birim)) birim = birim.replace(/R$/, "Ω");
  const n = olcumNormalle(sayi, birim, varsayilanMod, t);
  return Object.assign(n, {ham: t});
}
function degerYaz(o) { return o.sayi == null ? (o.ham || "?") : `${String(o.sayi).replace(".", ",")} ${o.birim || ""}`.trim(); }

/* ---------- Referans (sağlam kart) değerleri ---------- */
const trKucuk = s => String(s || "").toLocaleLowerCase("tr-TR").replace(/ı/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g")
  .replace(/ü/g, "u").replace(/ö/g, "o").replace(/ç/g, "c");
function kartAnahtari(k = S.kart) {
  const pn = trKucuk(k.parca_no).replace(/[^a-z0-9]/g, "");
  if (pn) return `pn:${pn}|rev:${trKucuk(k.rev).replace(/[^a-z0-9]/g, "")}`;
  const ad = trKucuk(`${k.cihaz} ${k.kart}`).replace(/[^a-z0-9]+/g, " ").trim();
  return ad ? "ad:" + ad : "";
}
function noktaAnahtari(n) {
  return trKucuk(n).replace(/\b(gnd|sase|toprak|ground|0v)\b/g, "gnd").replace(/\bbacak\b/g, "pin").replace(/[^a-z0-9+]/g, "");
}
const TOLERANS = {DCV: .05, ACV: .08, OHM: .10, DIYOT: .08, SUREKLILIK: .5, KAPASITE: .20, AKIM: .15, FREKANS: .05, DALGA: .15};
const TABAN_ESIK = {DCV: .1, ACV: .5, OHM: 1, DIYOT: .05, SUREKLILIK: 5, KAPASITE: 1e-9, AKIM: .01, FREKANS: 1, DALGA: .1};
function refTumu() { return lsOku("referanslar", {}); }
function refKarti() { return refTumu()[kartAnahtari()] || {}; }
function medyan(a) { const s = [...a].sort((x, y) => x - y); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; }
function refKarsilastir(o) {
  if (o.taban == null || !o.nokta) return null;
  const v = refKarti()[noktaAnahtari(o.nokta) + "|" + o.mod];
  if (!v || !v.degerler || !v.degerler.length) return null;
  const med = medyan(v.degerler);
  const sapma = Math.abs(o.taban - med) / Math.max(Math.abs(med), TABAN_ESIK[o.mod] || 1e-3);
  return {referans: med, birim: v.birim, ornek: v.degerler.length, sapma, uygun: sapma <= (TOLERANS[o.mod] || .15)};
}
function refOgren() {
  if (!S.referans) return 0;
  const k = kartAnahtari(); if (!k) return 0;
  const tum = refTumu(); const kart = tum[k] || {}; let n = 0;
  for (const o of S.olcumler) {
    if (o.durum !== "onayli" || o.taban == null || !o.nokta || !o.mod) continue;
    const a = noktaAnahtari(o.nokta) + "|" + o.mod;
    kart[a] = kart[a] || {nokta: o.nokta, mod: o.mod, birim: birimCoz(o.birim)?.temel || o.birim, degerler: []};
    kart[a].degerler.push(o.taban); kart[a].degerler = kart[a].degerler.slice(-15); n++;
  }
  tum[k] = kart; lsYaz("referanslar", tum); return n;
}
function tabanYaz(v, birim) {
  if (v == null) return "?";
  const a = Math.abs(v);
  const [c, on] = a >= 1e6 ? [1e6, "M"] : a >= 1e3 ? [1e3, "k"] : a >= 1 || a === 0 ? [1, ""] : a >= 1e-3 ? [1e-3, "m"] : a >= 1e-6 ? [1e-6, "µ"] : [1e-9, "n"];
  return `${(+(v / c).toPrecision(4)).toString().replace(".", ",")} ${on}${birim || ""}`;
}

/* ---------- Yapay zekaya giden bağlam ---------- */
function olcumSatiri(o) {
  const ref = o.ref ? ` | referans ${tabanYaz(o.ref.referans, o.ref.birim)} (${o.ref.uygun ? "uyumlu" : "%" + Math.round(o.ref.sapma * 100) + " SAPMA"})` : "";
  return `- [${FAZ_ADI[o.faz] || o.faz}] ${o.nokta || "?"} | ${o.mod || "?"} | ${degerYaz(o)} | ${o.kaynak}${ref}`;
}
function kartMetni() {
  const k = S.kart;
  return [`Cihaz: ${k.cihaz || "bilinmiyor"}`, `Kart: ${k.kart || "bilinmiyor"}`, k.parca_no && `Parça no: ${k.parca_no}`,
    k.rev && `Revizyon: ${k.rev}`, `Arıza belirtisi: ${k.belirti || "belirtilmedi"}`].filter(Boolean).join("\n");
}
function baglam(kor = false) {
  const p = [];
  p.push("KART BİLGİSİ:\n" + kartMetni());
  p.push(S.referans ? "MOD: Bu SAĞLAM REFERANS karttır. Amaç arıza aramak değil, karşılaştırma için doğru referans değerleri toplamaktır."
    : "MOD: Arızalı kart.");
  p.push("FAZ: " + FAZ_ADI[S.faz]);
  if (S.kontrol) {
    const var_ = KONTROL_LISTESI.filter(([k]) => S.kontrol[k] === "var").map(x => x[1]);
    const yok = KONTROL_LISTESI.filter(([k]) => S.kontrol[k] === "yok").map(x => x[1]);
    p.push(`GÖRSEL KONTROL: VAR: ${var_.join("; ") || "-"} | YOK: ${yok.join("; ") || "-"}${S.kontrol.not ? " | Not: " + S.kontrol.not : ""}`);
  }
  if (S.bulgular.length) p.push("BULGULAR:\n" + S.bulgular.slice(-15).map(b => "- " + b).join("\n"));
  const onayli = S.olcumler.filter(o => o.durum === "onayli");
  if (onayli.length) p.push("ÖLÇÜMLER (onaylı, en yeni en sonda):\n" + onayli.slice(-25).map(olcumSatiri).join("\n"));
  const red = S.olcumler.filter(o => o.durum === "reddedildi");
  if (red.length) p.push("KULLANICININ REDDETTİĞİ OKUMALAR (yok say): " + red.slice(-5).map(o => `${o.nokta}=${degerYaz(o)}`).join(", "));
  const refs = Object.values(refKarti());
  if (refs.length) p.push("BU KART İÇİN REFERANS (SAĞLAM KART) DEĞERLERİ:\n" + refs.slice(0, 40).map(r => `- ${r.nokta} | ${r.mod} | ${tabanYaz(medyan(r.degerler), r.birim)} (${r.degerler.length} ölçüm)`).join("\n"));
  if (!kor) {
    if (S.hipotezler.length) p.push("GÜNCEL HİPOTEZLER:\n" + S.hipotezler.map(h => `- ${h.ad} (%${h.olasilik}): ${h.gerekce}`).join("\n"));
    if (S.elenen.length) p.push("ELENEN HİPOTEZLER: " + S.elenen.join("; "));
    if (S.adim.talimat) p.push(`SON TALİMAT: ${S.adim.talimat}\nBEKLENEN ÖLÇÜM NOKTASI: ${S.adim.nokta || "?"} | MODU: ${S.adim.mod || "?"}`);
  }
  return p.join("\n\n");
}
/* ---------- Yapay zeka katmanı: Gemini → Groq → Claude ---------- */
const AI_ZAMAN_ASIMI = 45000, AI_TOPLAM_SURE = 120000;
const VARSAYILAN_MODELLER = {
  flash: ["gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-flash-latest"],
  pro: ["gemini-3.1-pro", "gemini-3.1-pro-preview", "gemini-pro-latest"],
  groq: ["meta-llama/llama-4-scout-17b-16e-instruct", "meta-llama/llama-4-maverick-17b-128e-instruct"],
  claude: ["claude-sonnet-4-5", "claude-haiku-4-5"],
};
let MODELLER = Object.assign({}, VARSAYILAN_MODELLER, lsOku("modeller", {}).liste || {});
const devre = {};            // anahtar → {kadar: ms, neden}
let iptalDenetleyici = null; // şu anki istek (İptal düğmesi)
let iptalEdildi = false;

class AIHata extends Error { constructor(tur, mesaj, durum) { super(mesaj); this.tur = tur; this.durum = durum; } }

function pasifikGeceYarisinaMs() {
  const p = new Intl.DateTimeFormat("en-US", {timeZone: "America/Los_Angeles", hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit"})
    .formatToParts(new Date()).reduce((a, x) => (a[x.type] = +x.value, a), {});
  const gecen = ((p.hour % 24) * 3600 + p.minute * 60 + p.second) * 1000;
  return 86400000 - gecen + 60000;
}
function hataSiniflandir(durum, govde, saglayici) {
  const g = String(govde || "").slice(0, 600);
  if (durum === 401 || (durum === 403 && /api.?key|API_KEY|permission|unauthori/i.test(g)) || (durum === 400 && /API key not valid|API_KEY_INVALID/i.test(g)))
    return new AIHata("anahtar", `${saglayici} anahtarı geçersiz veya yetkisiz`, durum);
  if (durum === 403) return new AIHata("erisim", "Bu modele erişim yok", durum);
  if (durum === 429) return /per.?day|PerDay|daily|günlük/i.test(g) ? new AIHata("kota_gunluk", "Günlük kota doldu", durum) : new AIHata("kota", "Dakikalık sınır doldu", durum);
  if (durum === 404) return new AIHata("model_yok", "Model bulunamadı", durum);
  if (durum >= 500) return new AIHata("sunucu", "Sunucu hatası " + durum, durum);
  return new AIHata("istek", `İstek hatası ${durum}: ${g.slice(0, 160)}`, durum);
}
function devreAc(aday, h) {
  const now = Date.now();
  if (h.tur === "anahtar") devre["s:" + aday.s] = {kadar: now + 6 * 3600e3, neden: h.message};
  else if (h.tur === "ag") devre["s:" + aday.s] = {kadar: now + 15000, neden: h.message};
  else if (h.tur === "kota_gunluk") devre[aday.s + ":" + aday.m] = {kadar: now + pasifikGeceYarisinaMs(), neden: h.message};
  else if (h.tur === "kota") devre[aday.s + ":" + aday.m] = {kadar: now + 60000, neden: h.message};
  else if (h.tur === "model_yok" || h.tur === "erisim") devre[aday.s + ":" + aday.m] = {kadar: now + 24 * 3600e3, neden: h.message};
  else if (h.tur === "zaman" || h.tur === "sunucu") devre[aday.s + ":" + aday.m] = {kadar: now + 30000, neden: h.message};
}
function acikMi(aday) {
  const now = Date.now();
  for (const k of ["s:" + aday.s, aday.s + ":" + aday.m]) if (devre[k] && devre[k].kadar > now) return false;
  return true;
}
function devreSifirla() { for (const k in devre) delete devre[k]; }

function _modelSira(m) {
  const v = parseFloat((m.match(/gemini-(\d+(?:\.\d+)?)/) || [0, 0])[1]) || 0;
  return [/preview|exp/.test(m) ? 1 : 0, -v, /lite/.test(m) ? 1 : 0, m];
}
function _sirala(a) { return a.sort((x, y) => { const p = _modelSira(x), q = _modelSira(y); for (let i = 0; i < 4; i++) { if (p[i] < q[i]) return -1; if (p[i] > q[i]) return 1; } return 0; }); }
/** Günde en fazla bir kez, arka planda: hesabın gerçekten erişebildiği modelleri öğren. */
async function modelListesiniYenile(zorla) {
  const kayit = lsOku("modeller", {});
  if (!zorla && kayit.zaman && kayit.surum === SURUM && Date.now() - kayit.zaman < 86400e3) return;
  const yeni = Object.assign({}, VARSAYILAN_MODELLER);
  try {
    if (AYAR.gemini) {
      const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {headers: {"x-goog-api-key": AYAR.gemini}});
      if (r.ok) {
        const j = await r.json();
        const adlar = (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes("generateContent"))
          .map(m => m.name.replace(/^models\//, "")).filter(n => /^gemini-/.test(n) && !/tts|image|live|audio|embed|learnlm|robotics|computer|native|thinking/.test(n));
        const flash = _sirala(adlar.filter(n => /flash/.test(n))).slice(0, 4), pro = _sirala(adlar.filter(n => /pro/.test(n))).slice(0, 3);
        if (flash.length) yeni.flash = flash; if (pro.length) yeni.pro = pro;
      }
    }
    if (AYAR.groq) {
      const r = await fetch("https://api.groq.com/openai/v1/models", {headers: {Authorization: "Bearer " + AYAR.groq}});
      if (r.ok) { const j = await r.json(); const g = (j.data || []).map(m => m.id).filter(n => /llama-4|vision/.test(n)); if (g.length) yeni.groq = g.sort().reverse().slice(0, 2); }
    }
  } catch (e) { console.warn("Model listesi alınamadı", e); return; }
  MODELLER = yeni; lsYaz("modeller", {zaman: Date.now(), surum: SURUM, liste: yeni});
}

function adaylar(tur = "ana", haric = []) {
  const a = [];
  const g = AYAR.gemini, q = AYAR.groq, c = AYAR.claude;
  const ekle = (s, liste) => liste.forEach(m => a.push({s, m}));
  if (tur === "ana") { if (g) ekle("gemini", MODELLER.flash); if (q) ekle("groq", MODELLER.groq); if (c) ekle("claude", MODELLER.claude.slice(-1)); }
  else { if (g) ekle("gemini", MODELLER.pro); if (c) ekle("claude", MODELLER.claude.slice(0, 1)); if (q) ekle("groq", MODELLER.groq); if (g) ekle("gemini", MODELLER.flash); }
  const h = new Set(haric.filter(Boolean));
  return a.filter(x => !h.has(x.s + ":" + x.m));
}

async function _istek(url, govde, basliklar, sinyal, saglayici) {
  let r;
  try { r = await fetch(url, {method: "POST", headers: Object.assign({"Content-Type": "application/json"}, basliklar), body: JSON.stringify(govde), signal: sinyal}); }
  catch (e) {
    if (e.name === "AbortError") throw new AIHata(iptalEdildi ? "iptal" : "zaman", iptalEdildi ? "İptal edildi" : "Zaman aşımı");
    throw new AIHata("ag", navigator.onLine === false ? "İnternet bağlantısı yok" : `${saglayici} sunucusuna ulaşılamadı`);
  }
  const metin = await r.text();
  if (!r.ok) throw hataSiniflandir(r.status, metin, saglayici);
  try { return JSON.parse(metin); } catch { throw new AIHata("bicim", "Sunucu yanıtı okunamadı"); }
}
const _b64 = d => String(d).split(",")[1];

async function geminiCagir(m, sistem, istem, resimler, sinyal) {
  const parts = [{text: istem}];
  for (const r of resimler) parts.push({inline_data: {mime_type: "image/jpeg", data: _b64(r)}});
  const j = await _istek(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`,
    {systemInstruction: {parts: [{text: sistem}]}, contents: [{role: "user", parts}],
      generationConfig: {temperature: 0.1, responseMimeType: "application/json", maxOutputTokens: 4096}},
    {"x-goog-api-key": AYAR.gemini}, sinyal, "Gemini");
  const c = (j.candidates || [])[0];
  const t = c && c.content && (c.content.parts || []).map(p => p.text || "").join("");
  if (!t) throw new AIHata("bos", "Boş yanıt" + (c && c.finishReason ? " (" + c.finishReason + ")" : ""));
  return t;
}
async function groqCagir(m, sistem, istem, resimler, sinyal) {
  const content = [{type: "text", text: istem}];
  for (const r of resimler.slice(0, 3)) content.push({type: "image_url", image_url: {url: r}});
  const j = await _istek("https://api.groq.com/openai/v1/chat/completions",
    {model: m, temperature: 0.1, max_tokens: 3000, response_format: {type: "json_object"},
      messages: [{role: "system", content: sistem}, {role: "user", content: resimler.length ? content : istem}]},
    {Authorization: "Bearer " + AYAR.groq}, sinyal, "Groq");
  const t = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  if (!t) throw new AIHata("bos", "Boş yanıt");
  return t;
}
async function claudeCagir(m, sistem, istem, resimler, sinyal) {
  const content = resimler.map(r => ({type: "image", source: {type: "base64", media_type: "image/jpeg", data: _b64(r)}}));
  content.push({type: "text", text: istem + "\n\nYalnızca geçerli JSON döndür."});
  const j = await _istek("https://api.anthropic.com/v1/messages",
    {model: m, max_tokens: 3000, temperature: 0.1, system: sistem, messages: [{role: "user", content}]},
    {"x-api-key": AYAR.claude, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true"}, sinyal, "Claude");
  const t = (j.content || []).filter(x => x.type === "text").map(x => x.text).join("");
  if (!t) throw new AIHata("bos", "Boş yanıt");
  return t;
}
const CAGIRICI = {gemini: geminiCagir, groq: groqCagir, claude: claudeCagir};
const MODEL_ADI = a => ({gemini: "Gemini", groq: "Groq", claude: "Claude"}[a.s]) + " " + a.m.replace(/^meta-llama\//, "");

function jsonAyikla(t) {
  t = String(t || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try { return JSON.parse(t); } catch {}
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
  return null;
}

/**
 * Sıradaki uygun modelle sorar. Biçim hatasında aynı modele bir kez onarım ister, sonra sıradaki modele geçer.
 * Döner: {veri, etiket, aday} ya da null (iptal/hepsi başarısız). Son hata `sonAIHatasi` içinde.
 */
let sonAIHatasi = null;
async function aiSor({sistem, istem, resimler = [], dogrula, tur = "ana", haric = [], durumMetni = "Yapay zeka düşünüyor…"}) {
  const liste = adaylar(tur, haric);
  sonAIHatasi = null; iptalEdildi = false;
  if (!liste.length) { sonAIHatasi = new AIHata("anahtar_yok", "Yapay zeka anahtarı girilmemiş. Menü → Ayarlar'dan Gemini anahtarını girin."); return null; }
  const bitis = Date.now() + AI_TOPLAM_SURE;
  mesgul(true, durumMetni);
  try {
   for (let tur_no = 0; tur_no < 3; tur_no++) {
    if (tur_no > 0) {
      // Geçici hata (sunucu yoğun / dakikalık kota / zaman aşımı): bekleyip kısa süreli engelleri kaldırarak yeniden dene
      const h = sonAIHatasi;
      if (!h || !["sunucu", "kota", "zaman", "bekle", "ag"].includes(h.tur)) break;
      const sure = tur_no === 1 ? 6 : 15;
      if (bitis - Date.now() < (sure + 15) * 1000) break;
      for (let k = sure; k > 0; k--) {
        if (iptalEdildi) return null;
        adimAlt(`Yapay zeka sunucusu yoğun; ${k} sn sonra kendim yeniden deniyorum… (İptal edebilirsiniz)`);
        await bekle(1000);
      }
      const sinir = Date.now() + 70000;
      for (const k in devre) if (devre[k].kadar < sinir) delete devre[k];
    }
    for (const aday of liste) {
      if (iptalEdildi) return null;
      if (!acikMi(aday)) {
        const d = devre["s:" + aday.s] || devre[aday.s + ":" + aday.m];
        if (!sonAIHatasi && d) sonAIHatasi = new AIHata(/Günlük/.test(d.neden) ? "kota_gunluk" : /anahtar/.test(d.neden) ? "anahtar" : "bekle",
          d.neden + " — kısa süre beklemede");
        continue;
      }
      let istemSimdi = istem;
      for (let deneme = 0; deneme < 2; deneme++) {
        const kalan = bitis - Date.now();
        if (kalan < 3000) { sonAIHatasi = new AIHata("zaman", "Toplam süre doldu"); return null; }
        iptalDenetleyici = new AbortController();
        const zm = setTimeout(() => iptalDenetleyici.abort(), Math.min(AI_ZAMAN_ASIMI, kalan));
        try {
          adimAlt(`${MODEL_ADI(aday)} soruluyor…`);
          const metin = await CAGIRICI[aday.s](aday.m, sistem, istemSimdi, resimler, iptalDenetleyici.signal);
          const ham = jsonAyikla(metin);
          const veri = ham && dogrula(ham);
          if (veri) { S.sonModel = aday.s + ":" + aday.m; return {veri, etiket: MODEL_ADI(aday), aday}; }
          console.warn("Biçim hatası", aday, metin.slice(0, 300));
          sonAIHatasi = new AIHata("bicim", "Yanıt beklenen biçimde değil");
          istemSimdi = istem + "\n\nÖNCEKİ YANITIN GEÇERSİZ JSON İDİ. Yalnızca istenen alanlarla geçerli tek bir JSON nesnesi döndür.";
        } catch (e) {
          const h = e instanceof AIHata ? e : new AIHata("bilinmiyor", e.message);
          if (h.tur === "iptal") return null;
          sonAIHatasi = h;
          console.warn("AI hatası", MODEL_ADI(aday), h.tur, h.message);
          if (h.tur === "sunucu" && deneme === 0 && bitis - Date.now() > 10000) {   // 503 "aşırı yoğun": aynı modeli 2 sn sonra bir kez daha dene
            adimAlt(`${MODEL_ADI(aday)} yoğun, 2 sn sonra yeniden deneniyor…`);
            await bekle(2000);
            continue;
          }
          devreAc(aday, h);
          break;
        } finally { clearTimeout(zm); }
      }
    }
   }
    return null;
  } finally { iptalDenetleyici = null; mesgul(false); }
}
function aiHataMesaji(ek = "") {
  if (iptalEdildi) return;
  const h = sonAIHatasi;
  let m = "Yapay zekadan yanıt alınamadı.";
  if (h) {
    if (h.tur === "anahtar_yok") m = h.message;
    else if (h.tur === "anahtar") m = h.message + ". Menü → Ayarlar'dan kontrol edin.";
    else if (h.tur === "ag") m = h.message + ".";
    else if (h.tur === "kota_gunluk") m = "Ücretsiz günlük kota doldu" + (AYAR.groq ? " ve yedek modeller de yanıt vermedi." : ". Ayarlar'a ücretsiz Groq anahtarı eklerseniz yedek olarak kullanılır.");
    else if (h.tur === "kota") m = "Dakikalık sınıra takıldı; 1 dakika sonra yeniden deneyin.";
    else if (h.tur === "sunucu" || h.tur === "zaman")
      m = "Google'ın yapay zeka sunucuları şu an aşırı yoğun (" + h.message.replace(/^Sunucu hatası /, "hata ") + "); birkaç kez denedim, olmadı. " +
          (AYAR.groq ? "Bir dakika sonra yeniden deneyin." : "Bir dakika sonra yeniden deneyin. Ayarlar'a ücretsiz Groq anahtarı eklerseniz bu durumda otomatik ona geçer.");
    else m = `Yapay zekadan yanıt alınamadı (${h.message}).`;
  }
  bildir(m + ek, "hata");
}
/* ---------- Bildirim, mesajlar, adım şeridi ---------- */
function bildir(metin, tur = "bilgi") {
  const b = $("#bildirim"); b.className = tur; $("span", b).textContent = metin; b.hidden = !metin;
  if (tur === "hata" || tur === "uyari") sesliOku(metin);
}
$("#bildirimKapat").onclick = () => { $("#bildirim").hidden = true; };

function mesajEkle(rol, metin, ek = {}) {
  S.mesajlar.push(Object.assign({rol, metin, zaman: simdi()}, ek));
  if (S.mesajlar.length > 400) S.mesajlar.splice(0, S.mesajlar.length - 400);
  mesajlariCiz(true); kaydet();
}
function mesajlariCiz(zorla) {
  const k = $("#mesajlar"); const altta = zorla || k.scrollHeight - k.scrollTop - k.clientHeight < 80;
  k.innerHTML = S.mesajlar.slice(-200).map(m => {
    if (m.rol === "olcum") {
      const o = S.olcumler.find(x => x.id === m.olcumId); if (!o) return "";
      const ref = o.ref ? `<br><span class="${o.ref.uygun ? "iyi" : "kotu"}">Referans ${esc(tabanYaz(o.ref.referans, o.ref.birim))} ${o.ref.uygun ? "✔ uyumlu" : "⚠ %" + Math.round(o.ref.sapma * 100) + " sapma"}</span>` : "";
      const d = {onayli: "✔ onaylı", reddedildi: "✖ reddedildi", bekliyor: "… teyit bekliyor"}[o.durum] || "";
      return `<div class="m olcum ${o.durum === "reddedildi" ? "red" : ""}">${o.thumb ? `<img src="${o.thumb}" alt="">` : ""}<div>
        <div class="deger">${esc(degerYaz(o))}</div><div>${esc(o.nokta || "?")} · ${esc(MODLAR[o.mod] || o.mod || "?")}</div>
        <small>${esc(o.kaynak)} · ${d} · ${saat(o.zaman)}</small>${ref}</div></div>`;
    }
    const foto = m.foto ? `<img class="foto" src="${m.foto}" alt="">` : "";
    const etiket = m.model ? ` · ${esc(m.model)}` : "";
    return `<div class="m ${esc(m.rol)}">${foto}${esc(m.metin)}<small>${saat(m.zaman)}${etiket}</small></div>`;
  }).join("");
  if (altta) { k.scrollTop = k.scrollHeight; requestAnimationFrame(() => k.scrollTop = k.scrollHeight); }
}
function rozetleriGuncelle() {
  $("#fazRozet").textContent = FAZ_ADI[S.faz];
  $("#refRozet").hidden = !S.referans;
  $("#baslik").textContent = S.kart.kart || S.kart.cihaz || "Tamir Asistanı";
  $("#iptalBtn").hidden = !_mesgul;
}

let _mesgul = false;
function mesgul(d, metin) {
  _mesgul = d;
  $("#iptalBtn").hidden = !d;
  $$("#kontrol button:not(#iptalBtn):not(#sesBtn):not(#konusBtn)").forEach(b => b.disabled = d);
  if (d) adimAlt(metin || "Yapay zeka düşünüyor…"); else adimCiz();
}
function adimAlt(t) { const s = $("#adim small"); if (s) s.textContent = t; }

/** Şu anki adıma göre şerit metni ve çipler. */
function adimCiz() {
  const a = S.adim, c = $("#cipler"); const cip = [];
  let ust = "", alt = `Faz: ${FAZ_ADI[S.faz]}`;
  if (S.kilitli) { ust = "Bu tamir kapatıldı."; cip.push(["📄 Raporu paylaş", raporPaylas], ["＋ Yeni tamir", yeniTamir]); }
  else if (a.tur === "bilgi") { ust = "Önce cihaz ve kart bilgisini girin."; cip.push(["✎ Cihaz bilgisi", cihazFormu]); }
  else if (a.tur === "tarama") { ust = "Kartın TAMAMINI tepeden, iyi ışıkta çekin ve 'Tamam' deyin."; cip.push(["⏭ Fotoğrafsız devam", () => kontrolListesi()]); }
  else if (a.tur === "kontrol") { ust = "Kartı gözle inceleyin ve kontrol listesini doldurun."; cip.push(["📋 Kontrol listesi", kontrolListesi]); }
  else if (a.tur === "teyit") {
    const o = S.olcumler.find(x => x.id === a.olcumId);
    ust = `Okunan: ${o ? degerYaz(o) : "?"} — ${o?.nokta || "?"} (${o?.mod || "?"}) doğru mu?`;
    cip.push(["✔ Doğru", teyitOnayla], ["✖ Yanlış", () => teyitReddet()], ["✍ Doğrusunu yaz", () => degerFormu(true)]);
  } else if (a.tur === "olcum") {
    ust = a.talimat || "Sıradaki ölçümü yapın.";
    alt = [a.nokta && `Nokta: ${a.nokta}`, a.mod && `Mod: ${MODLAR[a.mod] || a.mod}`, a.beklenen && `Beklenen: ${a.beklenen}`].filter(Boolean).join(" · ") || alt;
    if (a.faz && a.faz !== S.faz) cip.push([`⇄ ${FAZ_ADI[a.faz]} fazına geç`, () => fazDegistir(a.faz)]);
    cip.push(["🧩 Hipotezler", hipotezPaneli], ["🧠 İkinci görüş", ikinciGorus]);
  } else { ust = "Hazır."; }
  $("#adim").innerHTML = `${esc(ust)}<small>${esc(alt)}</small>`;
  c.innerHTML = ""; for (const [ad, fn] of cip) { const b = document.createElement("button"); b.textContent = ad; b.onclick = fn; c.appendChild(b); }
  $("#tamamBtn").textContent = AYAR.yontem === "elle" && a.tur === "olcum" ? "✍ Değeri gir" : "📷 Tamam / çek";
  $("#tamamBtn").disabled = _mesgul || S.kilitli || !["tarama", "olcum"].includes(a.tur);
  $("#degerBtn").disabled = _mesgul || S.kilitli || !["olcum", "teyit"].includes(a.tur);
  rozetleriGuncelle();
}

/* ---------- Genel pencere ---------- */
let _modalKapat = null;
function modal(html, baglan) {
  const m = $("#modal"), k = $("#modalKutu"); k.innerHTML = html; m.hidden = false;
  return new Promise(ok => {
    _modalKapat = v => { m.hidden = true; k.innerHTML = ""; _modalKapat = null; ok(v); };
    baglan && baglan(k, _modalKapat);
    const ilk = $("input:not([type=checkbox]):not([type=radio]),textarea", k); if (ilk && !("ontouchstart" in window)) ilk.focus();
  });
}
$("#modal").addEventListener("click", e => { if (e.target.id === "modal" && _modalKapat) _modalKapat(null); });
function onayIste(baslik, metin, evet = "Tamam", hayir = "Vazgeç") {
  return modal(`<h3>${esc(baslik)}</h3><p>${esc(metin)}</p><div class="dugmeler"><button data-v="0">${esc(hayir)}</button><button class="ana" data-v="1">${esc(evet)}</button></div>`,
    (k, kapat) => $$("button[data-v]", k).forEach(b => b.onclick = () => kapat(b.dataset.v === "1")));
}

/* ---------- Ses: okuma ve dinleme ---------- */
let _trSes = null;
function _sesSec() { const v = speechSynthesis.getVoices(); _trSes = v.find(x => /^tr/i.test(x.lang)) || null; }
if ("speechSynthesis" in window) { _sesSec(); speechSynthesis.onvoiceschanged = _sesSec; }
let _konusuyor = false;
function sesliOku(metin) {
  if (!AYAR.ses || !("speechSynthesis" in window) || !metin) return;
  try {
    const u = new SpeechSynthesisUtterance(String(metin).slice(0, 600)); u.lang = "tr-TR"; if (_trSes) u.voice = _trSes; u.rate = 1.05;
    u.onstart = () => { _konusuyor = true; dinlemeDuraklat(); };
    u.onend = u.onerror = () => { _konusuyor = false; dinlemeSurdur(); };
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch {}
}
$("#sesBtn").onclick = () => { AYAR.ses = !AYAR.ses; ayarKaydet(); sesBtnCiz(); if (!AYAR.ses) speechSynthesis?.cancel(); };
function sesBtnCiz() { $("#sesBtn").textContent = AYAR.ses ? "🔊" : "🔇"; }

const Tanima = window.SpeechRecognition || window.webkitSpeechRecognition;
let tanima = null, _dinliyor = false, _surekliIstek = false;
function tanimaKur() {
  if (!Tanima) return null;
  const t = new Tanima(); t.lang = "tr-TR"; t.interimResults = false; t.continuous = false; t.maxAlternatives = 1;
  t.onresult = e => { const s = e.results[0][0].transcript.trim(); if (s) girdi(s, "ses"); };
  t.onend = () => { _dinliyor = false; konusBtnCiz(); if (_surekliIstek && !_konusuyor && !document.hidden) setTimeout(dinlemeSurdur, 300); };
  t.onerror = e => { if (e.error === "not-allowed") { _surekliIstek = false; bildir("Mikrofon izni verilmedi.", "uyari"); } };
  return t;
}
function dinle() { if (!tanima) tanima = tanimaKur(); if (!tanima || _dinliyor) return; try { tanima.start(); _dinliyor = true; konusBtnCiz(); } catch {} }
function dinlemeDuraklat() { if (tanima && _dinliyor) try { tanima.abort(); } catch {} }
function dinlemeSurdur() { if (_surekliIstek && !_konusuyor) dinle(); }
function konusBtnCiz() { $("#konusBtn").classList.toggle("dinliyor", _dinliyor); }
$("#konusBtn").onclick = () => {
  if (!Tanima) { bildir("Bu tarayıcı sesli komutu desteklemiyor; Android'de Chrome kullanın.", "uyari"); return; }
  if (_dinliyor) { _surekliIstek = false; dinlemeDuraklat(); return; }
  _surekliIstek = AYAR.ellerSerbest; dinle();
};

/* ---------- Kamera (yalnızca tepe kamerası) ---------- */
const video = $("#video");
let akis = null, izParca = null, fener = false;
async function kameraAc() {
  kameraKapat();
  if (!window.isSecureContext) { kamYok("Kamera için sayfa HTTPS üzerinden açılmalı (kurulum notuna bakın)."); return; }
  if (!navigator.mediaDevices?.getUserMedia) { kamYok("Bu tarayıcı kamerayı desteklemiyor."); return; }
  try {
    akis = await navigator.mediaDevices.getUserMedia({audio: false,
      video: {facingMode: {ideal: AYAR.kamera}, width: {ideal: 1920}, height: {ideal: 1080}}});
  } catch (e) {
    kamYok(e.name === "NotAllowedError" ? "Kamera izni verilmedi. Adres çubuğundaki kilit simgesinden kameraya izin verin." :
      e.name === "NotFoundError" ? "Kamera bulunamadı." : "Kamera açılamadı: " + e.message); return;
  }
  video.srcObject = akis; $("#kamYok").hidden = true;
  izParca = akis.getVideoTracks()[0];
  try { await video.play(); } catch {}
  const yet = izParca.getCapabilities ? izParca.getCapabilities() : {};
  $("#fenerBtn").hidden = !yet.torch; fener = false; $("#fenerBtn").classList.remove("aktif");
  if (yet.zoom && yet.zoom.max > yet.zoom.min) {
    const z = $("#zoom"); z.min = yet.zoom.min; z.max = Math.min(yet.zoom.max, 10); z.step = yet.zoom.step || .1;
    z.value = izParca.getSettings().zoom || yet.zoom.min; $("#zoomDeger").textContent = (+z.value).toFixed(1) + "×"; $("#zoomKutu").hidden = false;
  } else $("#zoomKutu").hidden = true;
  if (yet.focusMode && yet.focusMode.includes("continuous")) izParca.applyConstraints({advanced: [{focusMode: "continuous"}]}).catch(() => {});
  ekranAcikTut();
}
function kameraKapat() { if (akis) akis.getTracks().forEach(t => t.stop()); akis = null; izParca = null; }
function kamYok(m) { kameraKapat(); $("#kamYok").hidden = false; $("#kamYok div").textContent = m; }
$("#kamAcBtn").onclick = kameraAc;
$("#cevirBtn").onclick = () => { AYAR.kamera = AYAR.kamera === "environment" ? "user" : "environment"; ayarKaydet(); kameraAc(); };
$("#fenerBtn").onclick = async () => {
  if (!izParca) return; fener = !fener;
  try { await izParca.applyConstraints({advanced: [{torch: fener}]}); $("#fenerBtn").classList.toggle("aktif", fener); } catch { fener = false; }
};
$("#zoom").oninput = e => { const v = +e.target.value; $("#zoomDeger").textContent = v.toFixed(1) + "×"; izParca?.applyConstraints({advanced: [{zoom: v}]}).catch(() => {}); };
$("#buyutBtn").onclick = () => $("#kamAlan").classList.toggle("buyuk");

let _kilit = null;
async function ekranAcikTut() { try { if ("wakeLock" in navigator && !_kilit) { _kilit = await navigator.wakeLock.request("screen"); _kilit.onrelease = () => _kilit = null; } } catch {} }
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { dinlemeDuraklat(); return; }
  if (akis) ekranAcikTut(); else if (AYAR.gizlilik) kameraAc();
  dinlemeSurdur();
});

/* Netlik: merkez bölgede Laplasyen varyansı; son 30 sn'nin en iyisine göre göreli. */
const _nc = document.createElement("canvas"); _nc.width = 160; _nc.height = 120;
const _nctx = _nc.getContext("2d", {willReadFrequently: true});
let netlikGecmisi = [];
function netlikOlc(kaynak, gen, yuk) {
  const w = gen * .6, h = yuk * .6;
  _nctx.drawImage(kaynak, gen * .2, yuk * .2, w, h, 0, 0, 160, 120);
  const d = _nctx.getImageData(0, 0, 160, 120).data, g = new Float32Array(160 * 120);
  for (let i = 0; i < g.length; i++) g[i] = d[i * 4] * .299 + d[i * 4 + 1] * .587 + d[i * 4 + 2] * .114;
  let t = 0, t2 = 0, n = 0;
  for (let y = 1; y < 119; y++) for (let x = 1; x < 159; x++) {
    const i = y * 160 + x, l = g[i - 1] + g[i + 1] + g[i - 160] + g[i + 160] - 4 * g[i];
    t += l; t2 += l * l; n++;
  }
  return t2 / n - (t / n) ** 2;
}
setInterval(() => {
  if (document.hidden || !akis || !video.videoWidth) return;
  const v = netlikOlc(video, video.videoWidth, video.videoHeight), now = Date.now();
  netlikGecmisi.push([now, v]); netlikGecmisi = netlikGecmisi.filter(x => now - x[0] < 30000);
  const en = Math.max(...netlikGecmisi.map(x => x[1]));
  const n = $("#netlik"); n.hidden = false; const oran = en ? v / en : 1;
  n.textContent = oran < .4 ? "◌ bulanık" : "● net"; n.style.color = oran < .4 ? "#fca5a5" : "#86efac";
}, 700);

/** Kare yakalar (en uzun kenar 1600 px). Bulanıksa kullanıcıya sorar. Döner: {foto, thumb} ya da null. */
async function kareAl() {
  if (!akis || !video.videoWidth) {
    const f = await dosyadanFoto(); return f;
  }
  const W = video.videoWidth, H = video.videoHeight, o = Math.min(1, 1600 / Math.max(W, H));
  const c = document.createElement("canvas"); c.width = Math.round(W * o); c.height = Math.round(H * o);
  c.getContext("2d").drawImage(video, 0, 0, c.width, c.height);
  const v = netlikOlc(c, c.width, c.height); const en = Math.max(0, ...netlikGecmisi.map(x => x[1]));
  if (en && v < en * .4) {
    if (!await onayIste("Görüntü bulanık görünüyor", "Odak oturmamış olabilir. Ekrana dokunup odaklayın veya telefonu biraz uzaklaştırın.", "Yine de gönder", "Yeniden çek")) return null;
  }
  return kareHazirla(c);
}
function kareHazirla(c) {
  const foto = c.toDataURL("image/jpeg", .85);
  const t = document.createElement("canvas"), o = 200 / Math.max(c.width, c.height);
  t.width = Math.round(c.width * o); t.height = Math.round(c.height * o); t.getContext("2d").drawImage(c, 0, 0, t.width, t.height);
  const d = $("#donmus"); d.src = foto; d.hidden = false; setTimeout(() => d.hidden = true, 1800);
  return {foto, thumb: t.toDataURL("image/jpeg", .7)};
}
function dosyadanFoto() {
  return new Promise(ok => {
    const g = $("#dosya"); g.value = "";
    g.onchange = () => {
      const f = g.files[0]; if (!f) return ok(null);
      const img = new Image(); img.onload = () => {
        const o = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement("canvas");
        c.width = Math.round(img.width * o); c.height = Math.round(img.height * o); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src); ok(kareHazirla(c));
      }; img.onerror = () => ok(null); img.src = URL.createObjectURL(f);
    };
    g.click();
  });
}
function kucukFoto(dataUrl, boy = 1024) {
  return new Promise(ok => { const i = new Image(); i.onload = () => { const o = Math.min(1, boy / Math.max(i.width, i.height)), c = document.createElement("canvas");
    c.width = Math.round(i.width * o); c.height = Math.round(i.height * o); c.getContext("2d").drawImage(i, 0, 0, c.width, c.height); ok(c.toDataURL("image/jpeg", .8)); }; i.onerror = () => ok(null); i.src = dataUrl; });
}
/* ---------- Teşhis ---------- */
const SISTEM_TESHIS = `Sen tıbbi cihaz ve elektronik kart tamirinde uzman, kıdemli bir servis mühendisisin. Teknisyene adım adım ölçüm yaptırarak arızalı bloğu ve parçayı buldurursun. Ona gerektiğinde '${HITAP}' diye hitap edebilirsin. Teknisyen telefon kamerasını kartın veya ölçü aletinin üstünden tutuyor; mikroskop yok.
YÖNTEM:
- Fazlar sırayla ilerler: görsel kontrol → ENERJİSİZ ölçümler (süreklilik, direnç, diyot, rayların toprağa direnci/kısa devre taraması) → AKIM SINIRLI İLK ENERJİ (lab kaynağı akım limiti veya seri lamba, çıkışta sahte yük) → ENERJİLİ ölçümler (ray gerilimleri, dalga şekli) → İŞLEVSEL DOĞRULAMA. Mevcut fazın dışına çıkan ölçüm isteme; faz değişmesi gerekiyorsa faz_onerisi alanını doldur, geçişi kullanıcı onaylar.
- İlk ölçümü kart tipine ve belirtiye göre seç.
- Kartı bloklara ayır (giriş/koruma, besleme-SMPS, regülatör, saat-reset, MCU-mantık, sürücü-çıkış, analog-sensör, bağlantı-lehim). En fazla 5 hipotez; her kanıttan sonra güncelle. ELENEN HİPOTEZLER'i yeni kanıt olmadan geri getirme.
- Sıradaki ölçümü, hipotezleri en iyi AYIRAN, en güvenli ve en kolay olan olarak seç; sonraki.nokta ve sonraki.mod alanlarını MUTLAKA doldur; nedenini 1 cümleyle yaz.
- Referans değerler varsa ölçümü onlarla karşılaştır. Kullanıcının reddettiği okumaları yok say.
OKUMA KURALLARI:
- Ekrandaki değerden emin değilsen uydurma: okunan_deger "okunamadı", guven < 0.5. Ondalık noktaya, eksi işaretine, m/k/M öneklerine, AC/DC simgesine, HOLD/REL göstergesine dikkat et.
- Birimde büyük/küçük harf önemlidir: mΩ (miliohm) ≠ MΩ (megaohm), mV ≠ MV.
- Ölçüm noktasını kameradan tahmin etme: BEKLENEN ÖLÇÜM NOKTASI'nı kullan; ekranda farklı bir mod görüyorsan söyle.
- Görselde NET okuyamadığın parça etiketlerini, türünü veya değerini ASLA uydurma.
- Arıza belirtisi bilinmiyorsa ve henüz ölçüm/bulgu yoksa hipotezler alanını boş bırak ve eksik bilgiyi iste.
- Görüntü bulanık/karanlık/parlamalıysa söyle, guven < 0.5, yeniden çekim iste.
GÜVENLİK: Güvenlik uyarısını yalnızca risk değiştiğinde ver (enerji verilecekken, primer/şebeke tarafı, 60 V DC üstü, büyük kondansatör, röntgen/lazer/defibrilatör katları). Her adımda tekrar etme.
ÜSLUP: mesaj ve sonraki.talimat en fazla 2'şer kısa cümle; teknisyen ellerini kullanırken dinliyor.
YANIT: Yalnızca şu alanlara sahip TEK bir JSON nesnesi döndür:
{"mesaj": "teknisyene söylenecek kısa metin",
 "okunan_deger": "ekrandaki ham değer, ör. '5.02 V DC' | 'okunamadı' | ölçüm görevi değilse ''",
 "sayi": sayı veya null, "birim": "V, mV, A, mA, Ω, mΩ, kΩ, MΩ, µF, nF, Hz, kHz … ya da ''", "mod": "DCV|ACV|OHM|DIYOT|SUREKLILIK|KAPASITE|AKIM|FREKANS|DALGA|''",
 "guven": 0-1 arası sayı, "normal_mi": "normal|anormal|belirsiz",
 "bulgular": ["görselden çıkan somut bulgu"], "parca_kodu": "görselde NET okunan entegre kodu ya da ''",
 "hipotezler": [{"ad": "", "olasilik": 0-100, "gerekce": ""}], "elenen": ["bu kanıtla elenen hipotez adı"],
 "sonraki": {"talimat": "", "nokta": "", "mod": "DCV|ACV|OHM|DIYOT|SUREKLILIK|KAPASITE|AKIM|FREKANS|DALGA", "beklenen": "", "neden": ""},
 "faz_onerisi": "gorsel|enerjisiz|ilk_enerji|enerjili|dogrulama|''"}`;

const _str = v => (v == null ? "" : String(v)).trim();
const _sayi = v => { if (typeof v === "number" && isFinite(v)) return v; const x = parseFloat(String(v ?? "").replace(",", ".")); return isFinite(x) ? x : null; };
function teshisDogrula(j) {
  if (!j || typeof j !== "object") return null;
  const mesaj = _str(j.mesaj || j.sesli_yanit || j.yanit);
  const s = j.sonraki && typeof j.sonraki === "object" ? j.sonraki : {};
  const v = {
    mesaj, okunan_deger: _str(j.okunan_deger), sayi: _sayi(j.sayi), birim: _str(j.birim), mod: modNormalle(j.mod),
    guven: Math.max(0, Math.min(1, _sayi(j.guven) ?? .5)), normal_mi: _str(j.normal_mi) || "belirsiz",
    bulgular: (Array.isArray(j.bulgular) ? j.bulgular : []).map(_str).filter(Boolean).slice(0, 8),
    parca_kodu: _str(j.parca_kodu),
    hipotezler: (Array.isArray(j.hipotezler) ? j.hipotezler : []).filter(h => h && typeof h === "object" && _str(h.ad)).slice(0, 5)
      .map(h => ({ad: _str(h.ad), olasilik: Math.max(0, Math.min(100, Math.round(_sayi(h.olasilik) ?? 0))), gerekce: _str(h.gerekce)})),
    elenen: (Array.isArray(j.elenen) ? j.elenen : []).map(_str).filter(Boolean),
    sonraki: {talimat: _str(s.talimat), nokta: _str(s.nokta), mod: modNormalle(s.mod), beklenen: _str(s.beklenen), neden: _str(s.neden)},
    faz_onerisi: FAZLAR.includes(_str(j.faz_onerisi)) ? _str(j.faz_onerisi) : "",
  };
  if (!v.mesaj && !v.sonraki.talimat && !v.okunan_deger) return null;
  return v;
}
function hipotezleriGuncelle(v) {
  if (!v.hipotezler.length && !v.elenen.length) return;
  const yeniAdlar = new Set(v.hipotezler.map(h => trKucuk(h.ad)));
  for (const h of S.hipotezler) if (!yeniAdlar.has(trKucuk(h.ad)) && !S.elenen.includes(h.ad) && v.hipotezler.length) S.elenen.push(h.ad);
  for (const e of v.elenen) if (!S.elenen.includes(e)) S.elenen.push(e);
  if (v.hipotezler.length) S.hipotezler = v.hipotezler.sort((a, b) => b.olasilik - a.olasilik);
  S.elenen = S.elenen.filter(e => !S.hipotezler.some(h => trKucuk(h.ad) === trKucuk(e))).slice(-20);
}
/** Yapay zeka yanıtını uygular: hipotezler, bulgular, sonraki adım, faz önerisi. */
function yanitiUygula(v, etiket, onEk = "") {
  hipotezleriGuncelle(v);
  for (const b of v.bulgular) if (!S.bulgular.includes(b)) S.bulgular.push(b);
  if (v.parca_kodu) mesajEkle("sistem", "Okunan parça kodu: " + v.parca_kodu);
  let konus = onEk + (v.mesaj || "");
  if (v.sonraki.talimat) {
    S.adim = {tur: "olcum", talimat: v.sonraki.talimat, nokta: v.sonraki.nokta, mod: v.sonraki.mod, beklenen: v.sonraki.beklenen,
      neden: v.sonraki.neden, faz: v.faz_onerisi && v.faz_onerisi !== S.faz ? v.faz_onerisi : ""};
    mesajEkle("asistan", [v.mesaj, v.sonraki.talimat + (v.sonraki.neden ? "\nNeden: " + v.sonraki.neden : ""), v.sonraki.beklenen && "Beklenen: " + v.sonraki.beklenen]
      .filter(Boolean).join("\n"), {model: etiket});
    konus += " " + v.sonraki.talimat + " Ölçünce 'Tamam' deyin.";
  } else {
    if (v.mesaj) mesajEkle("asistan", v.mesaj, {model: etiket});
    if (S.adim.tur === "teyit") S.adim = {tur: "olcum", talimat: S.adim.talimat, nokta: S.adim.nokta, mod: S.adim.mod};
  }
  if (v.faz_onerisi && v.faz_onerisi !== S.faz) { mesajEkle("sistem", `Önerilen faz geçişi: ${FAZ_ADI[v.faz_onerisi]} (onayınızla)`); if (S.adim.tur === "olcum") S.adim.faz = v.faz_onerisi; }
  sesliOku(konus.trim()); adimCiz(); kaydet();
}

async function teshis(gorev, {foto = null, tur = "plan"} = {}) {
  const istem = `${baglam()}\n\nGÖREV: ${gorev}`;
  const r = await aiSor({sistem: SISTEM_TESHIS, istem, resimler: foto ? [foto] : [], dogrula: teshisDogrula,
    durumMetni: tur === "olcum" ? "Ekran okunuyor…" : "Yapay zeka düşünüyor…"});
  if (!r) { aiHataMesaji(tur === "elle" ? " Girdiğiniz değer kaydedildi." : " Hazır olunca yeniden deneyin."); return null; }
  $("#bildirim").hidden = true;
  return r;
}

/* Kart taraması (görsel faz) */
async function taramaYap(kare) {
  if (!S.ilkFoto) S.ilkFoto = await kucukFoto(kare.foto, 1024);
  mesajEkle("kullanici", "Kart fotoğrafı", {foto: kare.thumb});
  const r = await teshis("Bu kartın tepeden fotoğrafı. Kartı bloklara ayır, gözle görülen hasarları 'bulgular'a yaz, okunabilen entegre kodlarını belirt. "
    + "Henüz ölçüm isteme (sonraki boş kalsın); belirti ve görsele göre ilk hipotezleri ver.", {foto: kare.foto, tur: "tarama"});
  if (!r) return;
  if (r.veri.guven < .5) { mesajEkle("asistan", r.veri.mesaj || "Görüntüden güvenilir bilgi çıkaramadım.", {model: r.etiket}); sesliOku((r.veri.mesaj || "") + " Işığı ve odağı düzeltip yeniden çekin ya da fotoğrafsız devam edin."); return; }
  r.veri.sonraki.talimat = ""; S.adim = {tur: "kontrol"};
  yanitiUygula(r.veri, r.etiket);
  setTimeout(kontrolListesi, 600);
}

/* Ölçüm: kamera ile ekran okuma */
async function olcumCek(kare) {
  const a = S.adim;
  const r = await teshis(`Bu, ölçü aletinin ekranı (ve muhtemelen probların yeri). Ekrandaki değeri oku. Ölçüm noktası: ${a.nokta || "?"}, mod: ${a.mod || "?"}. `
    + "Değeri değerlendir, hipotezleri güncelle ve sıradaki ölçümü ver.", {foto: kare.foto, tur: "olcum"});
  if (!r) return;
  const v = r.veri;
  if (v.guven < .5 || !v.okunan_deger || /^okunamad/i.test(v.okunan_deger) || v.sayi == null) {
    mesajEkle("asistan", (v.mesaj ? v.mesaj + "\n" : "") + "Değer net okunamadı.", {model: r.etiket, foto: kare.thumb});
    sesliOku((v.mesaj ? v.mesaj + " " : "") + "Değer net okunamadı. Telefonu yaklaştırın, parlamayı azaltın ve yeniden 'Tamam' deyin ya da değeri yazın.");
    return;
  }
  const n = olcumNormalle(v.sayi, v.birim, v.mod || a.mod, v.okunan_deger);
  const o = Object.assign({id: "o" + Date.now(), zaman: simdi(), faz: S.faz, nokta: a.nokta || "", kaynak: "kamera", ham: v.okunan_deger,
    durum: AYAR.teyit ? "bekliyor" : "onayli", thumb: kare.thumb, model: r.etiket}, n);
  o.ref = refKarsilastir(o);
  S.olcumler.push(o); mesajEkle("olcum", "", {olcumId: o.id});
  if (AYAR.teyit) {
    S.adim = Object.assign({}, a, {tur: "teyit", olcumId: o.id, bekleyen: {veri: v, etiket: r.etiket}});
    adimCiz(); kaydet();
    sesliOku(`${degerYaz(o)} okudum. Doğru mu?`);
  } else olcumSonrasi(o, v, r.etiket);
}
function refUyarisi(o) {
  if (!o.ref || o.ref.uygun) return "";
  const m = `Dikkat ${HITAP}: ${o.nokta} referans karttan %${Math.round(o.ref.sapma * 100)} sapıyor (referans ${tabanYaz(o.ref.referans, o.ref.birim)}). `;
  mesajEkle("guvenlik", m.trim()); return m;
}
function olcumSonrasi(o, v, etiket) { const on = refUyarisi(o); yanitiUygula(v, etiket, on); }
function teyitOnayla() {
  const a = S.adim; const o = S.olcumler.find(x => x.id === a.olcumId); if (!o) return;
  o.durum = "onayli"; mesajlariCiz();
  olcumSonrasi(o, a.bekleyen.veri, a.bekleyen.etiket);
}
function teyitReddet(dogruDeger) {
  const a = S.adim; const o = S.olcumler.find(x => x.id === a.olcumId); if (!o) return;
  o.durum = "reddedildi";
  S.adim = {tur: "olcum", talimat: a.talimat, nokta: a.nokta, mod: a.mod, beklenen: a.beklenen, faz: a.faz};
  mesajlariCiz(); adimCiz(); kaydet();
  if (dogruDeger) elleOlcum(dogruDeger);
  else sesliOku("Tamam, okuma yok sayıldı. Yeniden 'Tamam' deyin ya da değeri yazın.");
}

/* Elle girilen ölçüm */
async function elleOlcum({nokta, metin, mod}) {
  const a = S.adim;
  const n = degerAyristir(metin, mod || a.mod);
  if (!n) { bildir("Değer anlaşılamadı. Örnek: 5,02 V · 220 mΩ · 0,6", "uyari"); return; }
  const o = Object.assign({id: "o" + Date.now(), zaman: simdi(), faz: S.faz, nokta: nokta || a.nokta || "", kaynak: "elle", durum: "onayli"}, n);
  o.ref = refKarsilastir(o);
  S.olcumler.push(o); mesajEkle("olcum", "", {olcumId: o.id});
  const on = refUyarisi(o);
  if (on) sesliOku(on);
  S.adim = {tur: "olcum", talimat: a.talimat, nokta: a.nokta, mod: a.mod, beklenen: a.beklenen};
  adimCiz();
  const r = await teshis(`Kullanıcı ölçümü ELLE girdi (kesin kabul et): ${o.nokta || "?"} = ${o.ham} (mod: ${o.mod || "?"}). Değerlendir, hipotezleri güncelle, sıradaki ölçümü ver.`, {tur: "elle"});
  if (r) yanitiUygula(r.veri, r.etiket, on ? "" : "");
}
function degerFormu(dogrusu = false) {
  const a = S.adim;
  return modal(`<h3>${dogrusu ? "Doğru değeri yazın" : "Ölçüm değerini yazın"}</h3>
    <label class="alan">Ölçüm noktası<input id="fNokta" value="${esc(a.nokta || "")}" placeholder="ör. U2 pin 2 - GND"></label>
    <label class="alan">Değer<input id="fDeger" inputmode="text" placeholder="ör. 5,02 V · 220 mΩ · 0,58" autocomplete="off"></label>
    <label class="alan">Mod<select id="fMod"><option value="">— otomatik (birimden) —</option>${Object.entries(MODLAR).map(([k, ad]) => `<option value="${k}" ${k === a.mod ? "selected" : ""}>${ad}</option>`).join("")}</select></label>
    <p>Büyük/küçük harf önemli: <b>m</b>Ω miliohm, <b>M</b>Ω megaohm.</p>
    <div class="dugmeler"><button data-v="0">Vazgeç</button><button class="ana" data-v="1">Kaydet</button></div>`,
    (k, kapat) => {
      $$("button[data-v]", k).forEach(b => b.onclick = () => kapat(b.dataset.v === "1" ? {nokta: $("#fNokta").value.trim(), metin: $("#fDeger").value.trim(), mod: $("#fMod").value} : null));
      $("#fDeger", k).addEventListener("keydown", e => { if (e.key === "Enter") $("button[data-v='1']", k).click(); });
    }).then(d => {
      if (!d || !d.metin) return;
      if (dogrusu && S.adim.tur === "teyit") teyitReddet(d); else elleOlcum(d);
    });
}

/* ---------- Usta'ya sor ---------- */
const SISTEM_USTA = `Sen tıbbi cihaz ve elektronik kart tamirinde 30 yıllık deneyimli bir ustasın. Teknisyenin sorusunu, verilen tamir bağlamına göre kısa ve uygulanabilir yanıtla; ona '${HITAP}' diye hitap edebilirsin. Emin olmadığın parça kodunu, değeri veya pin numarasını uydurma; "datasheet'ten doğrulayın" de.
Teknisyenin MESAJINDA açıkça söylediği yeni bilgileri (ör. "C12 şişmiş", "sigorta atmış") 'bulgular'a yaz; her bulgunun 'alinti' alanına mesajdan birebir kısa alıntı koy. Mesajda olmayan bulgu ekleme.
YANIT: Yalnızca {"cevap": "en fazla 5 kısa cümle", "bulgular": [{"metin": "", "alinti": ""}], "kaynak": "genel bilgi|bağlam"} JSON'u döndür.`;
function ustaDogrula(j, soru) {
  const cevap = _str(j && (j.cevap || j.yanit || j.mesaj)); if (!cevap) return null;
  const sk = trKucuk(soru);
  const bulgular = (Array.isArray(j.bulgular) ? j.bulgular : []).filter(b => b && _str(b.metin) && _str(b.alinti) && sk.includes(trKucuk(_str(b.alinti)))).map(b => _str(b.metin));
  return {cevap, bulgular};
}
async function ustayaSor(soru, kare) {
  mesajEkle("kullanici", soru, kare ? {foto: kare.thumb} : {});
  const r = await aiSor({sistem: SISTEM_USTA, istem: `${baglam()}\n\nTEKNİSYENİN SORUSU: ${soru}`, resimler: kare ? [kare.foto] : [],
    dogrula: j => ustaDogrula(j, soru), durumMetni: "Usta düşünüyor…"});
  if (!r) { aiHataMesaji(); return; }
  for (const b of r.veri.bulgular) if (!S.bulgular.includes(b)) S.bulgular.push(b);
  if (r.veri.bulgular.length) mesajEkle("sistem", "Bulgu olarak eklendi: " + r.veri.bulgular.join("; "));
  mesajEkle("asistan", r.veri.cevap, {model: r.etiket}); sesliOku(r.veri.cevap); kaydet();
}
function ustaFormu() {
  modal(`<h3>❓ Usta'ya sor</h3>
    <label class="alan">Sorunuz<textarea id="uSoru" placeholder="ör. Bu kartta LM2575'in 4. bacağında kaç volt olmalı?"></textarea></label>
    <label class="tik"><input type="checkbox" id="uFoto" ${akis ? "checked" : ""}> Kameradaki görüntüyü de gönder</label>
    <div class="dugmeler"><button data-v="0">Vazgeç</button><button class="ana" data-v="1">Sor</button></div>`,
    (k, kapat) => $$("button[data-v]", k).forEach(b => b.onclick = () => kapat(b.dataset.v === "1" ? {soru: $("#uSoru").value.trim(), foto: $("#uFoto").checked} : null))
  ).then(async d => { if (!d || !d.soru) return; const kare = d.foto ? await kareAl() : null; if (d.foto && !kare) return; ustayaSor(d.soru, kare); });
}

/* ---------- Görsel kontrol listesi ---------- */
function kontrolListesi() {
  const mevcut = S.kontrol || {};
  return modal(`<h3>📋 Görsel kontrol listesi</h3><p>Kartı enerjisiz ve iyi ışıkta inceleyin. Bulunanlar teşhise bulgu olarak girer.</p>
    <div class="kl">${KONTROL_LISTESI.map(([k, ad]) => `<div class="satir"><div>${esc(ad)}</div><div class="secim" data-k="${k}">
      ${[["yok", "Yok"], ["var", "VAR"], ["bakilmadi", "Bakılmadı"]].map(([d, e]) => `<button data-d="${d}" class="${d === "var" ? "var " : ""}${(mevcut[k] || "bakilmadi") === d ? "sec" : ""}">${e}</button>`).join("")}
    </div></div>`).join("")}</div>
    <label class="alan">Not (isteğe bağlı)<input id="klNot" value="${esc(mevcut.not || "")}" placeholder="ör. C12 şişkin"></label>
    <div class="dugmeler"><button data-v="0">Vazgeç</button><button data-v="temiz">✔ Hepsi temiz</button><button class="ana" data-v="1">Kaydet ve devam</button></div>`,
    (k, kapat) => {
      $$(".secim button", k).forEach(b => b.onclick = () => { $$("button", b.parentNode).forEach(x => x.classList.remove("sec")); b.classList.add("sec"); });
      $$("button[data-v]", k).forEach(b => b.onclick = () => {
        if (b.dataset.v === "0") return kapat(null);
        const s = {not: $("#klNot").value.trim()};
        for (const [kk] of KONTROL_LISTESI) s[kk] = b.dataset.v === "temiz" ? "yok" : ($(`.secim[data-k=${kk}] .sec`, k)?.dataset.d || "bakilmadi");
        kapat(s);
      });
    }).then(async s => {
      if (!s) return;
      S.kontrol = s;
      const var_ = KONTROL_LISTESI.filter(([k]) => s[k] === "var").map(x => x[1]);
      mesajEkle("kullanici", "Görsel kontrol: " + (var_.length ? "VAR → " + var_.join(", ") : "belirgin hasar yok") + (s.not ? "\nNot: " + s.not : ""));
      kaydet();
      if (S.faz === "gorsel") await fazDegistir("enerjisiz", true); else planla();
    });
}

/* ---------- Faz ---------- */
async function fazDegistir(yeni, sessiz) {
  if (!yeni) {
    yeni = await modal(`<h3>⇄ Faz değiştir</h3><div class="kl">${FAZLAR.map(f => `<button data-f="${f}" class="${f === S.faz ? "aktif" : ""}">${FAZ_ADI[f]}</button>`).join("")}</div>
      <div class="dugmeler"><button data-f="">Vazgeç</button></div>`, (k, kapat) => $$("button[data-f]", k).forEach(b => b.onclick = () => kapat(b.dataset.f)));
    if (!yeni || yeni === S.faz) return;
  }
  if (AYAR.fazUyari && FAZ_GUVENLIK[yeni] && !S.guvenlikVerildi.includes(yeni) && ["ilk_enerji", "enerjili"].includes(yeni)) {
    if (!await onayIste("Güvenlik — " + FAZ_ADI[yeni], FAZ_GUVENLIK[yeni], "Hazırım, geç")) return;
  }
  const eski = S.faz; S.faz = yeni;
  mesajEkle("sistem", `Faz: ${FAZ_ADI[eski]} → ${FAZ_ADI[yeni]}`);
  if (AYAR.fazUyari && FAZ_GUVENLIK[yeni] && !S.guvenlikVerildi.includes(yeni)) { S.guvenlikVerildi.push(yeni); mesajEkle("guvenlik", "DİKKAT: " + FAZ_GUVENLIK[yeni]); }
  rozetleriGuncelle(); kaydet();
  await planla();
}
async function planla() {
  S.adim = {tur: "olcum", talimat: "", nokta: "", mod: ""}; adimCiz();
  const r = await teshis(`Faz: ${FAZ_ADI[S.faz]}. Bu fazdaki İLK ölçümünü seç (belirtiye ve bulgulara göre); hipotezleri ver.`);
  if (r) yanitiUygula(r.veri, r.etiket);
  else { S.adim.talimat = "Yapay zeka yanıt vermedi. Kendi seçtiğiniz ölçümü yapıp 'Değeri yaz' ile girebilirsiniz."; adimCiz(); }
}

/* ---------- Bağımsız (kör) ikinci görüş ---------- */
const SISTEM_IKINCI = `Sen bağımsız bir ikinci görüş veren kıdemli elektronik/tıbbi cihaz servis mühendisisin. Sana yalnızca ham veriler (kart bilgisi, görsel bulgular, ölçümler, referanslar ve varsa kart fotoğrafı) veriliyor; başka bir yapay zekanın görüşünü bilmiyorsun ve bilmemelisin.
Verilere göre en olası 3 arıza nedenini sırala, her biri için ayırt edici bir doğrulama ölçümü öner. Verilerde olmayan ölçüm sonucunu uydurma.
YANIT: Yalnızca {"ozet": "2-3 cümle", "nedenler": [{"ad": "", "olasilik": 0-100, "kanit": "", "dogrulama": ""}], "dikkat": "gözden kaçmış olabilecek nokta ya da ''"} JSON'u döndür.`;
function ikinciDogrula(j) {
  if (!j || !_str(j.ozet)) return null;
  return {ozet: _str(j.ozet), dikkat: _str(j.dikkat),
    nedenler: (Array.isArray(j.nedenler) ? j.nedenler : []).filter(n => n && _str(n.ad)).slice(0, 4)
      .map(n => ({ad: _str(n.ad), olasilik: Math.round(_sayi(n.olasilik) ?? 0), kanit: _str(n.kanit), dogrulama: _str(n.dogrulama)}))};
}
async function ikinciGorus() {
  if (!S.olcumler.some(o => o.durum === "onayli") && !S.bulgular.length && !S.ilkFoto) { bildir("İkinci görüş için önce birkaç bulgu veya ölçüm gerekli.", "uyari"); return; }
  const r = await aiSor({sistem: SISTEM_IKINCI, istem: baglam(true) + "\n\nGÖREV: Bağımsız teşhis yap.", resimler: S.ilkFoto ? [S.ilkFoto] : [],
    dogrula: ikinciDogrula, tur: "ikinci", haric: [S.sonModel], durumMetni: "Bağımsız ikinci görüş alınıyor…"});
  if (!r) { aiHataMesaji(); return; }
  const v = r.veri;
  const metin = `🧠 Bağımsız ikinci görüş (${r.etiket}; asistanın hipotezlerini görmedi)\n${v.ozet}\n` +
    v.nedenler.map((n, i) => `${i + 1}. ${n.ad} (%${n.olasilik})\n   Kanıt: ${n.kanit}\n   Doğrulama: ${n.dogrulama}`).join("\n") + (v.dikkat ? `\n⚠ ${v.dikkat}` : "");
  mesajEkle("ikinci", metin); sesliOku(v.ozet); kaydet();
}

/* ---------- Hipotez paneli ---------- */
function hipotezPaneli() {
  const h = S.hipotezler.length ? S.hipotezler.map(x => `<div class="hip"><div class="hipb"><b>${esc(x.ad)}</b><span>%${x.olasilik}</span></div>
    <div class="cubuk"><div style="width:${x.olasilik}%"></div></div><small>${esc(x.gerekce)}</small></div>`).join("") : "<p>Henüz hipotez yok.</p>";
  const e = S.elenen.length ? `<p><b>Elenen:</b> ${S.elenen.map(esc).join(" · ")}</p>` : "";
  const o = S.olcumler.filter(x => x.durum === "onayli");
  const t = o.length ? `<table><tr><th>Nokta</th><th>Mod</th><th>Değer</th><th>Ref</th></tr>${o.map(x => `<tr><td>${esc(x.nokta)}</td><td>${esc(x.mod)}</td><td>${esc(degerYaz(x))}</td>
    <td class="${x.ref ? (x.ref.uygun ? "iyi" : "kotu") : ""}">${x.ref ? esc(tabanYaz(x.ref.referans, x.ref.birim)) : "-"}</td></tr>`).join("")}</table>` : "";
  const b = S.bulgular.length ? `<p><b>Bulgular:</b> ${S.bulgular.map(esc).join(" · ")}</p>` : "";
  modal(`<h3>🧩 Hipotezler ve ölçümler</h3>${h}${e}${b}${t}<div class="dugmeler"><button class="ana" data-v>Kapat</button></div>`,
    (k, kapat) => $("button[data-v]", k).onclick = () => kapat());
}
$("#hipBtn").onclick = hipotezPaneli;

/* ---------- Ana eylem: Tamam / çek ---------- */
async function tamam() {
  if (_mesgul || S.kilitli) return;
  if (S.adim.tur === "teyit") return teyitOnayla();
  if (S.adim.tur === "bilgi") return cihazFormu();
  if (S.adim.tur === "kontrol") return kontrolListesi();
  if (S.adim.tur === "olcum" && AYAR.yontem === "elle") return degerFormu();
  if (!["tarama", "olcum"].includes(S.adim.tur)) return;
  const kare = await kareAl(); if (!kare) return;
  if (S.adim.tur === "tarama") return taramaYap(kare);
  return olcumCek(kare);
}

/* ---------- Metin / ses girdisi ---------- */
const DEGER_TAM = /^\s*[-+−]?\d+(?:[.,]\d+)?\s*(?:[pnuµμmkKMG]?\s*(?:V|A|Ω|[Oo]hm|F|Hz|R|volt|amper)?)?\s*(?:dc|ac|DC|AC)?\s*$/;
function girdi(metin, kaynak = "yazi") {
  const t = metin.trim(); if (!t) return;
  const k = trKucuk(t).replace(/[.!?,]/g, "").trim(), kelime = k.split(/\s+/).length;
  if (_mesgul) { if (/^(iptal|dur|vazgec)$/.test(k)) iptal(); return; }
  if (S.adim.tur === "teyit") {
    if (/^(evet|dogru|tamam|onay(la)?)( dogru)?$/.test(k)) return teyitOnayla();
    if (/^(hayir|yanlis|degil)$/.test(k)) return teyitReddet();
    if (DEGER_TAM.test(t)) return teyitReddet({nokta: S.adim.nokta, metin: t, mod: S.adim.mod});
  }
  if (kelime <= 3 && /^(tamam|cek|olc(tum)?|hazir|tamam cek)$/.test(k)) return tamam();
  if (kelime <= 3 && /^tekrar/.test(k)) return sesliOku($("#adim").firstChild?.textContent || "");
  if (kelime <= 3 && /^(iptal|dur)$/.test(k)) return iptal();
  if (/^deger\s/.test(k) && S.adim.tur === "olcum") return elleOlcum({nokta: S.adim.nokta, metin: t.replace(/^\s*de[gğ]er\s*/i, ""), mod: S.adim.mod});
  if (DEGER_TAM.test(t) && ["olcum"].includes(S.adim.tur)) return elleOlcum({nokta: S.adim.nokta, metin: t, mod: S.adim.mod});
  if (kaynak === "ses" && _surekliIstek && !/^usta\b/.test(k)) return;   // eller serbest modda yalnızca komutlar ve "usta …"
  ustayaSor(t.replace(/^\s*usta[,:]?\s*/i, "") || t, null);
}
function iptal() { iptalEdildi = true; iptalDenetleyici?.abort(); bildir("İstek iptal edildi.", "bilgi"); }
$("#gonderBtn").onclick = () => { const m = $("#metin"); const v = m.value; m.value = ""; girdi(v); };
$("#metin").addEventListener("keydown", e => { if (e.key === "Enter") $("#gonderBtn").click(); });
$("#tamamBtn").onclick = tamam;
$("#degerBtn").onclick = () => degerFormu(S.adim.tur === "teyit");
$("#ustaBtn").onclick = ustaFormu;
$("#tekrarBtn").onclick = () => sesliOku($("#adim").firstChild?.textContent || "");
$("#iptalBtn").onclick = iptal;
/* ---------- Cihaz / kart bilgisi ---------- */
function cihazFormu() {
  const k = S.kart;
  const alan = (id, ad, ph) => `<label class="alan">${ad}<input id="${id}" value="${esc(k[id] || "")}" placeholder="${esc(ph)}"></label>`;
  return modal(`<h3>✎ Cihaz ve kart bilgisi</h3>
    ${alan("cihaz", "Cihaz", "ör. US X-Ray röntgen kolimatörü")}${alan("kart", "Kart", "ör. CC-LED 5A LED sürücü kartı")}
    <div class="iki">${alan("parca_no", "Parça no", "ör. MP11797")}${alan("rev", "Revizyon", "ör. C")}</div>
    ${alan("seri", "Seri no", "isteğe bağlı")}
    <label class="alan">Arıza belirtisi<textarea id="belirti" placeholder="ör. LED yanmıyor, sigorta atmış">${esc(k.belirti || "")}</textarea></label>
    <label class="tik"><input type="checkbox" id="ref" ${S.referans ? "checked" : ""}> Bu SAĞLAM kart (referans değer toplanacak)</label>
    <div class="dugmeler"><button data-v="0">Vazgeç</button><button class="ana" data-v="1">Kaydet</button></div>`,
    (kk, kapat) => $$("button[data-v]", kk).forEach(b => b.onclick = () => {
      if (b.dataset.v === "0") return kapat(null);
      const y = {}; for (const a of ["cihaz", "kart", "parca_no", "rev", "seri", "belirti"]) y[a] = $("#" + a, kk).value.trim();
      kapat({kart: y, ref: $("#ref", kk).checked});
    })).then(d => {
      if (!d) return;
      const ilk = S.adim.tur === "bilgi";
      S.kart = d.kart; S.referans = d.ref;
      mesajEkle("sistem", `Kart: ${[d.kart.cihaz, d.kart.kart].filter(Boolean).join(" · ") || "?"}${d.kart.belirti ? " — " + d.kart.belirti : ""}${d.ref ? " (REFERANS)" : ""}`);
      if (ilk) { S.adim = {tur: "tarama"}; sesliOku("Kartın tamamını tepeden, iyi ışıkta çekin ve 'Tamam' deyin."); }
      adimCiz(); kaydet();
    });
}

/* ---------- Yeni tamir / geçmiş ---------- */
async function yeniTamir() {
  if (!S.kilitli && S.olcumler.length && !await onayIste("Yeni tamir", "Bu tamir kapatılmadı; kayıtlı kalır, geçmişten yeniden açabilirsiniz. Yeni tamire geçilsin mi?", "Yeni tamir")) return;
  await kaydet(true);
  S = bosOturum(); lsYaz("aktif", S.id);
  $("#bildirim").hidden = true;
  mesajEkle("asistan", `Merhaba ${HITAP}. Yeni tamir başladı.`);
  adimCiz(); cihazFormu();
}
async function oturumAc(id) {
  const o = await DB.oku(id); if (!o) return;
  await kaydet(true);
  S = Object.assign(bosOturum(), o); lsYaz("aktif", S.id);
  mesajlariCiz(); adimCiz();
}
async function gecmis() {
  const liste = (await DB.hepsi()).filter(o => o.mesajlar && o.mesajlar.length).sort((a, b) => b.olusturma.localeCompare(a.olusturma)).slice(0, 100);
  modal(`<h3>🗂 Geçmiş tamirler</h3>${liste.length ? liste.map(o => `<div class="oge"><b>${esc(o.kart.kart || o.kart.cihaz || "Adsız")}</b>
    <small>${esc(tarihSaat(o.olusturma))} · ${esc(o.teknisyen || "")} · ${o.kapanis ? esc(SONUC_ADI[o.kapanis.sonuc]) : (o.id === S.id ? "şu an" : "açık")}${o.referans ? " · REFERANS" : ""}</small>
    <div class="dugmeler"><button data-sil="${o.id}" class="tehlike" ${o.id === S.id ? "disabled" : ""}>Sil</button><button data-ac="${o.id}">Aç</button></div></div>`).join("") : "<p>Kayıt yok.</p>"}
    <div class="dugmeler"><button data-v>Kapat</button></div>`,
    (k, kapat) => {
      $("button[data-v]", k).onclick = () => kapat();
      $$("button[data-ac]", k).forEach(b => b.onclick = () => { kapat(); oturumAc(b.dataset.ac); });
      $$("button[data-sil]", k).forEach(b => b.onclick = async () => { await DB.sil(b.dataset.sil); b.closest(".oge").remove(); });
    });
}

/* ---------- Kapanış ve rapor ---------- */
function kapanisFormu() {
  if (S.kilitli) { raporPaylas(); return; }
  const satir = () => `<div class="parca"><input placeholder="Referans (ör. Q1)" class="pRef"><input placeholder="Parça / değer" class="pAd"><button class="pSil" aria-label="Sil">✕</button></div>`;
  modal(`<h3>🏁 Tamiri kapat</h3>
    <label class="alan">Sonuç<select id="kSonuc">${Object.entries(SONUC_ADI).map(([k, a]) => `<option value="${k}">${a}</option>`).join("")}</select></label>
    <label class="alan">Kök neden<input id="kNeden" placeholder="ör. Q1 MOSFET kısa devre, D5 açık"></label>
    <div><b>Değişen parçalar</b><div id="kParcalar">${satir()}</div><button id="kEkle">＋ Parça ekle</button></div>
    <label class="alan">Yapılan doğrulama<input id="kDog" placeholder="ör. LED yük altında 30 dk çalıştı"></label>
    <label class="alan">Not<textarea id="kNot"></textarea></label>
    <div class="dugmeler"><button data-v="0">Vazgeç</button><button class="ana" data-v="1">Kapat ve rapor oluştur</button></div>`,
    (k, kapat) => {
      $("#kEkle", k).onclick = () => $("#kParcalar", k).insertAdjacentHTML("beforeend", satir());
      k.addEventListener("click", e => { if (e.target.classList.contains("pSil")) e.target.parentNode.remove(); });
      $$("button[data-v]", k).forEach(b => b.onclick = () => kapat(b.dataset.v === "1" ? {
        sonuc: $("#kSonuc").value, neden: $("#kNeden").value.trim(), dogrulama: $("#kDog").value.trim(), not: $("#kNot").value.trim(),
        parcalar: $$(".parca", k).map(p => ({ref: $(".pRef", p).value.trim(), ad: $(".pAd", p).value.trim()})).filter(p => p.ref || p.ad),
      } : null));
    }).then(async d => {
      if (!d) return;
      S.kapanis = Object.assign(d, {zaman: simdi(), teknisyen: AYAR.teknisyen || S.teknisyen});
      const n = refOgren();
      S.kapanis.ozet = await ozetHash(); S.kilitli = true; S.adim = {tur: "bitti"};
      mesajEkle("rapor", raporMetni());
      if (n) mesajEkle("sistem", `${n} ölçüm bu kart için referans olarak kaydedildi.`);
      sesliOku("Tamir kapatıldı, rapor hazır."); adimCiz(); kaydet(true);
    });
}
async function ozetHash() {
  const veri = JSON.stringify({kart: S.kart, olcumler: S.olcumler.map(({thumb, ...o}) => o), kapanis: {...S.kapanis, ozet: undefined}});
  try { const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(veri)); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join(""); }
  catch { return ""; }
}
function raporMetni() {
  const k = S.kart, c = S.kapanis || {};
  const sure = c.zaman ? Math.round((new Date(c.zaman) - new Date(S.olusturma)) / 60000) : null;
  const ol = S.olcumler.filter(o => o.durum === "onayli");
  return [
    "TAMİR RAPORU", "=".repeat(28),
    `Tarih: ${tarihSaat(c.zaman || simdi())}${sure != null ? ` (süre ${sure} dk)` : ""}`, `Teknisyen: ${c.teknisyen || S.teknisyen || "-"}`,
    `Cihaz: ${k.cihaz || "-"}`, `Kart: ${k.kart || "-"}${k.parca_no ? " · P/N " + k.parca_no : ""}${k.rev ? " rev " + k.rev : ""}${k.seri ? " · S/N " + k.seri : ""}`,
    `Belirti: ${k.belirti || "-"}`, S.referans ? "Tür: SAĞLAM REFERANS KART" : "",
    "", `SONUÇ: ${SONUC_ADI[c.sonuc] || "-"}`, `Kök neden: ${c.neden || "-"}`,
    `Değişen parçalar: ${(c.parcalar || []).map(p => `${p.ref} ${p.ad}`.trim()).join(", ") || "-"}`, `Doğrulama: ${c.dogrulama || "-"}`,
    c.not ? `Not: ${c.not}` : "",
    "", "GÖRSEL KONTROL: " + (S.kontrol ? KONTROL_LISTESI.filter(([x]) => S.kontrol[x] === "var").map(x => x[1]).join("; ") || "belirgin hasar yok" : "yapılmadı"),
    S.bulgular.length ? "BULGULAR: " + S.bulgular.join("; ") : "",
    "", `ÖLÇÜMLER (${ol.length}):`, ...ol.map(o => `  ${o.nokta || "?"} | ${o.mod || "?"} | ${degerYaz(o)} | ${o.kaynak}${o.ref ? ` | ref ${tabanYaz(o.ref.referans, o.ref.birim)}${o.ref.uygun ? "" : " SAPMA"}` : ""}`),
    "", "Not: Yapay zeka önerileri yönlendirme amaçlıdır; son karar teknisyenindir.",
    c.ozet ? `Kayıt özeti (SHA-256): ${c.ozet.slice(0, 32)}…` : "",
  ].filter(x => x !== "").join("\n");
}
async function raporPaylas() {
  const ad = `tamir_${(S.kart.kart || S.kart.cihaz || "rapor").replace(/[^\wçğıöşüÇĞİÖŞÜ-]+/g, "_").slice(0, 40)}_${S.olusturma.slice(0, 10)}`;
  const txt = new File([raporMetni()], ad + ".txt", {type: "text/plain"});
  const json = new File([JSON.stringify(S, null, 1)], ad + ".json", {type: "application/json"});
  try { if (navigator.canShare && navigator.canShare({files: [txt]})) { await navigator.share({files: [txt, json].filter(f => navigator.canShare({files: [f]})), title: "Tamir raporu"}); return; } }
  catch (e) { if (e.name === "AbortError") return; }
  for (const f of [txt, json]) { const a = document.createElement("a"); a.href = URL.createObjectURL(f); a.download = f.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
}

/* ---------- Ayarlar ---------- */
function ayarFormu(ilk = false) {
  const g = (id, ad, ph, tip = "password") => `<label class="alan">${ad}<input id="${id}" type="${tip}" value="${esc(AYAR[id])}" placeholder="${esc(ph)}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>`;
  return modal(`<h3>⚙ Ayarlar</h3>
    ${ilk ? `<p><b>İlk kurulum.</b> Bilgisayarda anahtarlar Windows'a gömülü; telefon onları okuyamadığı için burada bir kez girilmesi gerekir. Anahtarlar YALNIZCA bu telefonda saklanır ve sadece ilgili yapay zeka servisine gönderilir.</p>` : ""}
    ${g("gemini", "Gemini API anahtarı (ücretsiz — zorunlu)", "AIza…")}
    ${g("groq", "Groq API anahtarı (ücretsiz — yedek, isteğe bağlı)", "gsk_…")}
    ${g("claude", "Claude API anahtarı (ÜCRETLİ — isteğe bağlı)", "sk-ant-…")}
    ${g("teknisyen", "Teknisyen adı", "ör. Rıdvan Z.", "text")}
    <b>Ölçüm yöntemi</b>
    <label class="tik"><input type="radio" name="yon" value="kamera" ${AYAR.yontem === "kamera" ? "checked" : ""}> Kamera ile ekranı okut</label>
    <label class="tik"><input type="radio" name="yon" value="elle" ${AYAR.yontem === "elle" ? "checked" : ""}> Değeri elle yaz</label>
    <label class="tik" style="opacity:.5"><input type="radio" name="yon" value="cihaz" disabled> USB/Bluetooth ölçü aleti — bağlı uyumlu alet bulunamadı</label>
    <label class="tik"><input type="checkbox" id="teyit" ${AYAR.teyit ? "checked" : ""}> Kameradan okunan değeri onayıma sun</label>
    <label class="tik"><input type="checkbox" id="ses" ${AYAR.ses ? "checked" : ""}> Yanıtları sesli oku</label>
    <label class="tik"><input type="checkbox" id="ellerSerbest" ${AYAR.ellerSerbest ? "checked" : ""}> Eller serbest: 🎙'a bir kez basınca sürekli dinle ("tamam", "doğru", "değer 5 volt", "usta …")</label>
    <label class="tik"><input type="checkbox" id="fazUyari" ${AYAR.fazUyari ? "checked" : ""}> Enerjili fazlara geçerken güvenlik hatırlatması göster</label>
    <div class="dugmeler"><button id="aDene">Bağlantıyı dene</button>${ilk ? "" : '<button data-v="0">Vazgeç</button>'}<button class="ana" data-v="1">Kaydet</button></div>
    <p id="aSonuc"></p><p>Sürüm ${SURUM}</p>`,
    (k, kapat) => {
      const oku = () => { for (const a of ["gemini", "groq", "claude", "teknisyen"]) AYAR[a] = $("#" + a, k).value.trim();
        for (const a of ["teyit", "ses", "ellerSerbest", "fazUyari"]) AYAR[a] = $("#" + a, k).checked;
        AYAR.yontem = ($("input[name=yon]:checked", k) || {}).value || "kamera"; };
      $$("button[data-v]", k).forEach(b => b.onclick = () => {
        if (b.dataset.v === "1") { oku(); if (!AYAR.gemini && !AYAR.groq) { $("#aSonuc").textContent = "En az Gemini anahtarı gerekli."; return; } ayarKaydet(); devreSifirla(); modelListesiniYenile(true); }
        kapat(b.dataset.v === "1");
      });
      $("#aDene", k).onclick = async () => {
        oku(); const s = $("#aSonuc"); s.textContent = "Deneniyor…";
        const sonuc = [];
        for (const [ad, url, h] of [["Gemini", "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", {"x-goog-api-key": AYAR.gemini}],
          ["Groq", "https://api.groq.com/openai/v1/models", {Authorization: "Bearer " + AYAR.groq}]]) {
          if (!(ad === "Gemini" ? AYAR.gemini : AYAR.groq)) continue;
          try { const r = await fetch(url, {headers: h}); sonuc.push(`${ad}: ${r.ok ? "✔ çalışıyor" : r.status === 400 || r.status === 401 || r.status === 403 ? "✖ anahtar geçersiz" : "✖ hata " + r.status}`); }
          catch { sonuc.push(`${ad}: ✖ ulaşılamadı`); }
        }
        s.textContent = sonuc.join(" · ") || "Anahtar girilmedi.";
      };
    }).then(ok => { if (ok) { S.teknisyen = S.teknisyen || AYAR.teknisyen; sesBtnCiz(); adimCiz(); } });
}

/* ---------- Menü ---------- */
$("#menuBtn").onclick = e => { e.stopPropagation(); $("#menu").hidden = !$("#menu").hidden; };
document.addEventListener("click", e => { if (!e.target.closest("#menu")) $("#menu").hidden = true; });
$("#menu").addEventListener("click", e => {
  const m = e.target.dataset.m; if (!m) return; $("#menu").hidden = true;
  if (S.kilitli && !["yeni", "gecmis", "ayar", "kapanis"].includes(m)) { bildir("Bu tamir kapatıldı. Yeni tamir başlatın.", "uyari"); return; }
  ({yeni: yeniTamir, cihaz: cihazFormu, kontrol: kontrolListesi, faz: () => fazDegistir(), ikinci: ikinciGorus, kapanis: kapanisFormu, gecmis, ayar: () => ayarFormu(),
    referans: () => { S.referans = !S.referans; mesajEkle("sistem", S.referans ? "Referans (sağlam kart) modu AÇIK: onaylı ölçümler kapanışta referans olarak kaydedilir." : "Referans modu kapalı."); adimCiz(); }})[m]();
});

/* ---------- Başlangıç ---------- */
async function gizlilikOnayi() {
  await modal(`<h3>Tamir Asistanı — telefon</h3>
    <p>Kamera görüntüleri ve ölçümler, teşhis için seçtiğiniz yapay zeka servisine (Google Gemini; yedek olarak Groq/Claude) gönderilir. Hasta bilgisi içeren etiket veya ekranları kadraja almayın.</p>
    <p>Yapay zeka önerileri yönlendirme amaçlıdır; son karar teknisyenindir.</p>
    <div class="dugmeler"><button class="ana" data-v>Anladım</button></div>`, (k, kapat) => $("button[data-v]", k).onclick = () => kapat());
  AYAR.gizlilik = true; ayarKaydet();
}
async function baslat() {
  sesBtnCiz();
  const aktif = lsOku("aktif", null);
  const o = aktif ? await DB.oku(aktif).catch(() => null) : null;
  if (o) S = Object.assign(bosOturum(), o);
  else { S = bosOturum(); lsYaz("aktif", S.id); mesajEkle("asistan", `Merhaba ${HITAP}. Telefonu kartın üstünden tutun; ben ölçümlerde yol göstereyim.`); }
  mesajlariCiz(); adimCiz();
  if (!AYAR.gizlilik) await gizlilikOnayi();
  if (!AYAR.gemini && !AYAR.groq) await ayarFormu(true);
  kameraAc();
  modelListesiniYenile();
  if (S.adim.tur === "bilgi" && !S.kart.cihaz && !S.kart.kart) cihazFormu();
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
}
window.addEventListener("online", () => { devreSifirla(); $("#bildirim").hidden = true; });
window.addEventListener("offline", () => bildir("İnternet bağlantısı yok; yapay zeka çalışmaz. Değerleri yazmaya devam edebilirsiniz.", "uyari"));
baslat();
