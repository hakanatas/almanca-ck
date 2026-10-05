# Almanca çalışma kâğıtları

## Lektion 19 · Umzugstag! (Nokta taşınıyor)

**Oyunu açmak için:** [`lektion-19/Umzugstag_Lektion_19.html`](lektion-19/Umzugstag_Lektion_19.html) dosyasını indirip tarayıcıda açın. Tek dosyadır, bütün sesler içine gömülüdür; internet gerekmez (internet yoksa yalnızca el yazısı yazı tipi yerine yedek yazı tipi görünür).

| Oyun | Ne yapılıyor |
|---|---|
| **Einrichten** | 11 eşya: kutuyu aç → kelime → artikel → odaya sürükle → *steht / liegt / hängt + im / in der* cümlesi |
| **Wortkisten** | Listedeki diğer kelimeler, iki yönlü; her doğru cevaptan sonra sesli örnek cümle |
| **Hör zu!** | Dinleme: cümleyi yalnızca duyarsın, eşyayı ve odayı bulursun; 🐢 yavaş dinleme |
| **Wortliste** | Bütün kelimeler, Türkçe anlamlar ve örnek cümleler sesli; “Yazdır” ile kâğıda basılır |

### Klasörler

- `lektion-19/src/umzugstag.html`: kaynak (sesler gömülü değil). Kelimeler ve örnek cümleler `<script id="daten">` bölümünde.
- `lektion-19/ses/`: Google Cloud Text-to-Speech (Chirp 3 HD) ile üretilmiş MP3'ler ve `manifest.json`.
- `tools/ses-uret.mjs`: sesleri üretir, denetler ve tek dosyalık HTML'i kurar.

### Sesleri yeniden üretmek

Kelime ya da cümle değiştirdikten sonra (Node 18+ ve ffmpeg gerekir):

```sh
GOOGLE_TTS_API_KEY=... node tools/ses-uret.mjs lektion-19
```

Yalnızca değişen metinler için yeni ses istenir; diğerleri `ses/` klasöründen alınır. Her ses kırpılır, seviyesi eşitlenir ve süresi metnin uzunluğuna göre denetlenir. Sessiz, kesik ya da aşırı yavaş gelen sesler kendiliğinden yeniden istenir.
