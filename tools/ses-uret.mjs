#!/usr/bin/env node
/* Google Cloud Text-to-Speech ile oyunun bütün Almanca seslerini üretir ve tek HTML dosyasına gömer.

   Kullanım:   GOOGLE_TTS_API_KEY=... node tools/ses-uret.mjs [lektion-19]

   - Seslendirilecek metinler <ders>/src/*.html içindeki <script id="daten"> bölümünün clipTexts()
     işlevinden okunur; oyuna yeni kelime/cümle eklenince liste kendiliğinden güncellenir.
   - Her ses <ders>/ses/ altında saklanır. Metin ve ses ayarı değişmedikçe yeniden üretilmez,
     bu yüzden yalnızca HTML'i yeniden kurmak için API anahtarı gerekmez.
   - ffmpeg gerekir: baştaki/sondaki sessizliği kırpar, ses seviyelerini eşitler, MP3'e çevirir.
   - Çıktı: <ders>/<kaynak adı>.html yerine CONFIG.out (internetsiz çalışan tek dosya). */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { execFileSync, spawnSync } from 'node:child_process';

// Node'un fetch'i vekil sunucuyu (HTTPS_PROXY) ancak NODE_USE_ENV_PROXY=1 ile kullanır.
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, process.argv.slice(1), { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } });
  process.exit(r.status ?? 1);
}

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const LESSON = path.resolve(ROOT, process.argv[2] || 'lektion-19');
const CONFIG = {
  src: path.join(LESSON, 'src', 'umzugstag.html'),
  out: path.join(LESSON, 'Umzugstag_Lektion_19.html'),
  dir: path.join(LESSON, 'ses'),
};
/* L: öğretmen sesi, S: aynı ses yavaş (dinleme oyunu), N: Nokta */
const VOICES = {
  L: { name: 'de-DE-Chirp3-HD-Kore', rate: 0.9 },
  S: { name: 'de-DE-Chirp3-HD-Kore', rate: 0.7 },
  N: { name: 'de-DE-Chirp3-HD-Puck', rate: 1.0 },
};
// ses işleme adımları değişirse bu etiketi değiştirin: bütün sesler yeniden üretilir
const PIPE = 'v2|trim-48dB|mean-20dB|peak-1.5dB|mp3-40k-24k';
const KEY = process.env.GOOGLE_TTS_API_KEY;

const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
const slug = (s) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function clipList() {
  const html = fs.readFileSync(CONFIG.src, 'utf8');
  const m = html.match(/<script id="daten">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('<script id="daten"> bulunamadı: ' + CONFIG.src);
  const { clipTexts } = vm.runInNewContext(m[1] + '\n;({ clipTexts })', {});
  return { html, list: clipTexts() };
}

async function synth(text, voice) {
  if (!KEY) throw new Error('GOOGLE_TTS_API_KEY tanımlı değil (yeni ses üretmek için gerekli).');
  const body = {
    input: { text },
    voice: { languageCode: 'de-DE', name: voice.name },
    audioConfig: { audioEncoding: 'LINEAR16', sampleRateHertz: 24000, speakingRate: voice.rate },
  };
  for (let attempt = 0; ; attempt++) {
    const res = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY }, body: JSON.stringify(body),
    });
    if (res.ok) return Buffer.from((await res.json()).audioContent, 'base64');
    const msg = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt < 4) { await sleep(2000 * 2 ** attempt); continue; }
    throw new Error(`TTS ${res.status}: ${msg.slice(0, 300)}`);
  }
}

const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
/* ortalama/tepe seviye ve en uzun iç sessizlik (sn) */
function analyse(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-i', file, '-af', 'silencedetect=noise=-40dB:d=0.2,volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  const num = (re) => { const m = r.stderr.match(re); return m ? +m[1] : -99; };
  const gaps = [...r.stderr.matchAll(/silence_duration: ([\d.]+)/g)].map((m) => +m[1]);
  return { mean: num(/mean_volume: (-?[\d.]+)/), max: num(/max_volume: (-?[\d.]+)/), gap: Math.max(0, ...gaps) };
}
function duration(file) {
  return +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim() || 0;
}
/* sessizliği kırp, seviyeyi eşitle (ortalama -20 dB, tepe en çok -1.5 dB), 40 kbps mono MP3 */
function processWav(wav, out) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ses-'));
  const a = path.join(tmp, 'a.wav'), b = path.join(tmp, 'b.wav');
  try {
    fs.writeFileSync(a, wav);
    const trim = 'silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.03,areverse,' +
                 'silenceremove=start_periods=1:start_threshold=-48dB:start_silence=0.09,areverse';
    ff(['-i', a, '-af', trim, b]);
    const info = { ...analyse(b), speech: duration(b) };
    if (info.speech > 0.05 && info.mean > -90) {
      const gain = Math.min(-20 - info.mean, -1.5 - info.max);
      ff(['-i', b, '-af', `volume=${gain.toFixed(2)}dB,afade=t=in:d=0.008,apad=pad_dur=0.05`, '-ar', '24000', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '40k', out]);
    }
    return info;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
/* Chirp 3 HD her seferinde biraz farklı okur; ara sıra sessiz, kesik ya da aşırı yavaş bir ses döner.
   Metnin harf sayısına göre makul olmayan sesi reddedip yeniden isteriz. */
function problem(e, x) {
  const letters = e.text.replace(/[^A-Za-zÄÖÜäöüß]/g, '').length, slow = e.who === 'S', perLetter = x.speech / letters;
  if (x.speech < 0.3 || x.mean < -35) return 'sessiz';
  const twoSentences = /[.?!–]\s+\S/.test(e.text.trim()); // "Klappt alles? – Ja, …": cümle arası duraklama doğal
  if (x.gap > (twoSentences ? 1.2 : 0.75) * (slow ? 1.2 : 1)) return `uzun duraklama ${x.gap.toFixed(2)} sn`;
  if (letters >= 5 ? perLetter > (slow ? 0.24 : 0.2) : x.speech > 1.2) return `fazla uzun ${x.speech.toFixed(2)} sn`;
  if (letters >= 10 && perLetter < (slow ? 0.06 : 0.045)) return `fazla kısa ${x.speech.toFixed(2)} sn`;
  return null;
}
async function makeClip(e, final) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const tmp = final + '.tmp.mp3';
    const info = processWav(await synth(e.text, VOICES[e.who]), tmp);
    const why = problem(e, info);
    if (!why) { fs.renameSync(tmp, final); return attempt; }
    fs.rmSync(tmp, { force: true });
    console.log(`  yeniden (${why}): ${e.key}`);
  }
  throw new Error('6 denemede uygun ses alınamadı');
}

async function main() {
  const { html, list } = clipList();
  fs.mkdirSync(CONFIG.dir, { recursive: true });
  const entries = list.map(({ who, text }) => {
    const voice = VOICES[who]; if (!voice) throw new Error('Bilinmeyen ses: ' + who);
    const file = `${who}-${slug(text)}-${sha([PIPE, voice.name, voice.rate, text].join('|'))}.mp3`;
    return { key: `${who}|${text}`, who, text, voice: voice.name, rate: voice.rate, file };
  });
  const todo = entries.filter((e) => !fs.existsSync(path.join(CONFIG.dir, e.file)));
  console.log(`${entries.length} ses: ${entries.length - todo.length} hazır, ${todo.length} üretilecek.`);
  let done = 0, failed = 0;
  const queue = todo.slice();
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let e; (e = queue.shift());) {
      try {
        await makeClip(e, path.join(CONFIG.dir, e.file));
        done++; if (done % 20 === 0) console.log(`  … ${done}/${todo.length}`);
      } catch (err) { failed++; console.error(`HATA ${e.key}: ${err.message}`); }
    }
  }));
  if (failed) { console.error(`${failed} ses üretilemedi; HTML yazılmadı.`); process.exit(1); }

  // kullanılmayan eski sesleri sil
  const keep = new Set(entries.map((e) => e.file));
  for (const f of fs.readdirSync(CONFIG.dir)) if (f.endsWith('.mp3') && !keep.has(f)) fs.rmSync(path.join(CONFIG.dir, f));

  const clips = {};
  let total = 0, bytes = 0;
  for (const e of entries) {
    const f = path.join(CONFIG.dir, e.file), buf = fs.readFileSync(f);
    e.dur = +duration(f).toFixed(2); total += e.dur; bytes += buf.length;
    clips[e.key] = 'data:audio/mpeg;base64,' + buf.toString('base64');
  }
  fs.writeFileSync(path.join(CONFIG.dir, 'manifest.json'),
    JSON.stringify(entries.map(({ key, voice, rate, file, dur }) => ({ key, voice, rate, file, dur })), null, 1) + '\n');

  if (!html.includes('{/*SESLER*/}')) throw new Error('Kaynakta window.CLIPS = {/*SESLER*/} işareti yok.');
  const out = html.replace('{/*SESLER*/}', () => JSON.stringify(clips));
  fs.writeFileSync(CONFIG.out, out);
  console.log(`${entries.length} ses, toplam ${total.toFixed(1)} sn, ${(bytes / 1024).toFixed(0)} KB MP3.`);
  console.log(`Yazıldı: ${path.relative(ROOT, CONFIG.out)} (${(out.length / 1024 / 1024).toFixed(2)} MB)`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
