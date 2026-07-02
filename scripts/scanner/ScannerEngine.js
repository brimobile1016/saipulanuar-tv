import { performance } from 'perf_hooks';
import readline from 'readline';

export class ScannerEngine {
  constructor(options = {}, onProgressCallback) {
    this.concurrency = options.concurrency || 50;
    this.timeout = options.timeout || 12000;
    this.retryMax = options.retryMax || 3;
    this.onProgress = onProgressCallback || (() => {});
  }

  async scanAll(channels) {
    const results = [];
    const queue = [...channels];
    const total = channels.length;
    let processed = 0;
    const workers = [];

    console.log(`[Deep Scanner] Memulai inspeksi payload mendalam terhadap ${total} channel...\n`);
    this._printProgress(0, total);

    for (let i = 0; i < Math.min(this.concurrency, queue.length); i++) {
      workers.push(this._worker(queue, results, total, () => {
        processed++;
        this._printProgress(processed, total);
      }));
    }
    await Promise.all(workers);
    console.log('\n\n✔️ Verifikasi Validitas Konten Selesai Dinilai.');
    return results;
  }

  async _worker(queue, results, total, incrementProgress) {
    while (queue.length > 0) {
      const channel = queue.shift();
      if (!channel) break;
      
      const scanResult = await this._scanChannelWithRetry(channel.url);
      const fullyScannedChannel = { ...channel, scan: scanResult };
      
      results.push(fullyScannedChannel);
      incrementProgress();
      await this.onProgress(fullyScannedChannel, results, total);
    }
  }

  async _scanChannelWithRetry(url) {
    let attempts = 0;
    let lastResult = null;
    while (attempts < this.retryMax) {
      attempts++;
      lastResult = await this._deepInspectStream(url);
      if (lastResult.status === 'LIVE') return lastResult;
    }
    return lastResult;
  }

  async _deepInspectStream(url) {
    if (url.startsWith('rtmp://') || url.startsWith('rtsp://')) {
      return this._buildScanObject('LIVE', 200, 40, 'Protokol Khusus Stream (RTMP/RTSP)', url);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    const startTime = performance.now();

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        redirect: 'manual',
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': '*/*'
        }
      });

      const latency = performance.now() - startTime;

      if (!response.ok || response.status < 200 || response.status >= 300) {
        clearTimeout(timeoutId);
        return this._buildScanObject('DEAD', response.status, latency, `HTTP ${response.status} Error`, url);
      }

      const finalUrl = response.url.toLowerCase();
      if (finalUrl.includes('/login') || finalUrl.includes('/expired') || finalUrl.includes('/block') || finalUrl.includes('/portal')) {
        clearTimeout(timeoutId);
        return this._buildScanObject('DEAD', response.status, latency, 'DEAD: Terdeteksi Pengalihan Login/Portal', url);
      }

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      const contentLength = Number(response.headers.get('content-length')||0);
      if (contentLength===0 && response.headers.has('content-length')) {
        clearTimeout(timeoutId);
        return this._buildScanObject('DEAD', response.status, latency, 'DEAD: Empty Content-Length', url);
      }

      if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml')) {
        clearTimeout(timeoutId);
        return this._buildScanObject('DEAD', response.status, latency, 'DEAD: Konten Berupa HTML Web Page', url);
      }

      const reader = response.body.getReader();
      const { value: chunk } = await reader.read();
      reader.cancel();
      clearTimeout(timeoutId);

      if (!chunk || chunk.length === 0) {
        return this._buildScanObject('DEAD', response.status, latency, 'DEAD: Respon Kosong (No Payload)', url);
      }

      const srcLower = url.toLowerCase();
      
      // A. VALIDASI PLAYLIST M3U / M3U8 & HLS STREAM
      if (srcLower.includes('.m3u8') || contentType.includes('mpegurl') || contentType.includes('vnd.apple.mpegurl')) {
        const text = new TextDecoder('utf-8').decode(chunk);
        if (!text.includes('#EXTM3U')) {
          return this._buildScanObject('DEAD', response.status, latency, 'DEAD: Berkas M3U8 Rusak / Tanpa #EXTM3U Tag', url);
        }
        if (!text.includes('#EXT-X-STREAM-INF') && !text.includes('#EXTINF') && !text.includes('.ts') && !text.includes('.m3u8')) {
          return this._buildScanObject('DEAD', response.status, latency, 'DEAD: HLS M3U8 Tidak Memiliki Segmen/Stream Valid', url);
        }
        return this._buildScanObject('LIVE', response.status, latency, 'HLS (.m3u8)', url);
      }

      // B. VALIDASI MANIFEST MPEG-DASH (.mpd)
      if (srcLower.includes('.mpd') || contentType.includes('dash+xml')) {
        const text = new TextDecoder('utf-8').decode(chunk);
        if (!text.includes('<MPD') && !text.includes('urn:mpeg:dash:schema')) {
          return this._buildScanObject('DEAD', response.status, latency, 'DEAD: Manifest DASH (.mpd) Rusak / Bukan XML MPD', url);
        }
        return this._buildScanObject('LIVE', response.status, latency, 'MPEG-DASH (.mpd)', url);
      }

      // C. VALIDASI FILE PLAYLIST M3U UTAMA
      if (srcLower.includes('.m3u') && !srcLower.includes('.m3u8')) {
        const text = new TextDecoder('utf-8').decode(chunk);
        if (!text.includes('#EXTM3U')) {
          return this._buildScanObject('DEAD', response.status, latency, 'DEAD: File M3U Master Tidak Valid', url);
        }
        return this._buildScanObject('LIVE', response.status, latency, 'M3U Playlist Master', url);
      }

      // D. VALIDASI BINARY SIGNATURE UNTUK KONTEN MEDIA (.mp4, .ts, .flv, .webm)
      if (srcLower.includes('.ts') || contentType.includes('video/mp2t')) {
        if (chunk[0] !== 0x47) return this._buildScanObject('DEAD', response.status, latency, 'DEAD: Invalid TS Pattern', url);
        return this._buildScanObject('LIVE', response.status, latency, 'MPEG-TS (.ts)', url);
      }

      if (srcLower.includes('.flv') || contentType.includes('video/x-flv')) {
        if (chunk[0] !== 0x46 || chunk[1] !== 0x4C || chunk[2] !== 0x56) return this._buildScanObject('DEAD', response.status, latency, 'DEAD: Invalid FLV Pattern', url);
        return this._buildScanObject('LIVE', response.status, latency, 'FLV Video', url);
      }

      if (srcLower.includes('.mp4') || contentType.includes('video/mp4')) {
        const hex = Buffer.from(chunk.slice(4, 12)).toString('utf-8');
        if (!hex.includes('ftyp')) return this._buildScanObject('DEAD', response.status, latency, 'DEAD: Invalid MP4 Atom', url);
        return this._buildScanObject('LIVE', response.status, latency, 'MP4 Video', url);
      }

      if (srcLower.includes('.webm') || contentType.includes('video/webm')) {
        if (chunk[0] !== 0x1A || chunk[1] !== 0x45 || chunk[2] !== 0xDF || chunk[3] !== 0xA3) return this._buildScanObject('DEAD', response.status, latency, 'DEAD: Invalid WebM Pattern', url);
        return this._buildScanObject('LIVE', response.status, latency, 'WebM Video', url);
      }

      if (srcLower.includes('.mp3') || contentType.includes('audio/mpeg') || srcLower.includes('.aac') || contentType.includes('audio/aac')) {
        return this._buildScanObject('LIVE', response.status, latency, 'Audio Stream/Radio', url);
      }

      return this._buildScanObject('DEAD', response.status, latency, 'DEAD: Format Tidak Dikenali / Stream Tanpa Video', url);

    } catch (error) {
      clearTimeout(timeoutId);
      const latency = startTime ? performance.now() - startTime : 0;
      let errorMsg = 'DEAD: DNS ERROR / CONNECTION REFUSED';
      let errCode = 0;
      if (error.name === 'AbortError') {
        errorMsg = 'DEAD: OPERATION TIMEOUT';
        errCode = 408;
      }
      return this._buildScanObject('DEAD', errCode, latency, errorMsg, url);
    }
  }

  _buildScanObject(status, statusCode, latency, contentType, finalUrl) {
    const cleanStatus = (status === 'LIVE') ? 'LIVE' : 'DEAD';
    return {
      status: cleanStatus,
      httpStatusCode: statusCode,
      responseTime: Math.round(latency),
      latency: Math.round(latency),
      redirectCount: 0,
      finalUrl: finalUrl,
      contentType: contentType,
      scanTimestamp: new Date().toISOString()
    };
  }

  _printProgress(current, total) {
    readline.cursorTo(process.stdout, 0);
    const percentage = ((current / total) * 100).toFixed(1);
    process.stdout.write(`⏳ Deep-Scanner Payload Progress: ${current}/${total} Channel (${percentage}%) `);
  }
}