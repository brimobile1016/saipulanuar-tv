const fs = require('fs');
const path = require('path');

const files = {
  "package.json": `{
  "name": "iptv-player-automation",
  "version": "1.2.0",
  "description": "Enterprise Multi-Engine IPTV Control Center - DASH Fixed",
  "type": "module",
  "main": "scripts/index.js",
  "scripts": {
    "start": "node scripts/index.js",
    "scan": "node scripts/index.js",
    "serve": "sirv . --port 3000 --cors --dev"
  },
  "dependencies": {
    "sirv-cli": "^3.0.0"
  }
}`,

  "scripts/core/PlaylistDiscovery.js": `import fs from 'fs';
import path from 'path';

export class PlaylistDiscovery {
  constructor(databasePath) {
    this.databasePath = databasePath;
  }
  discover() {
    try {
      if (!fs.existsSync(this.databasePath)) {
        fs.mkdirSync(this.databasePath, { recursive: true });
        return [];
      }
      return fs.readdirSync(this.databasePath)
        .filter(file => {
          const ext = path.extname(file).toLowerCase();
          return ext === '.m3u' || ext === '.m3u8';
        })
        .map(file => path.join(this.databasePath, file));
    } catch (error) {
      console.error(\`[Discovery Error] Gagal membaca direktori: \${error.message}\`);
      return [];
    }
  }
}`,

  "scripts/core/M3uParser.js": `import fs from 'fs';
import path from 'path';

export class M3uParser {
  parse(filePath) {
    const channels = [];
    const playlistName = path.basename(filePath, path.extname(filePath));
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split(/\\r?\\n/);
      let currentTrack = null;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXTINF:')) {
          currentTrack = this._parseExtInf(line);
          currentTrack.sourcePlaylist = playlistName;
        } else if (line && !line.startsWith('#')) {
          if (currentTrack) {
            currentTrack.url = line;
            channels.push(currentTrack);
            currentTrack = null;
          }
        }
      }
    } catch (error) {
      console.error(\`[Parser Error] Gagal memproses file \${filePath}: \${error.message}\`);
    }
    return channels;
  }
  _parseExtInf(line) {
    const nameMatch = line.match(/,(.*)$/);
    const channelName = nameMatch ? nameMatch[1].trim() : 'Unknown Channel';
    return {
      name: channelName,
      tvgId: this._getAttribute(line, 'tvg-id'),
      tvgName: this._getAttribute(line, 'tvg-name'),
      tvgLogo: this._getAttribute(line, 'tvg-logo'),
      tvgCountry: this._getAttribute(line, 'tvg-country'),
      tvgLanguage: this._getAttribute(line, 'tvg-language'),
      groupTitle: this._getAttribute(line, 'group-title') || 'Uncategorized',
      url: ''
    };
  }
  _getAttribute(line, attrName) {
    const regex = new RegExp(\`\${attrName}="([^"]*)"\`, 'i');
    const match = line.match(regex);
    return match ? match[1].trim() : '';
  }
}`,

  "scripts/utils/FileHandler.js": `import fs from 'fs';
import path from 'path';

export class FileHandler {
  static ensureDirectories(directories) {
    directories.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }
  static writeJson(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }
  static writeText(filePath, content, append = false) {
    if (append) {
      fs.appendFileSync(filePath, content + '\\n', 'utf-8');
    } else {
      fs.writeFileSync(filePath, content, 'utf-8');
    }
  }
}`,

  "scripts/scanner/ScannerEngine.js": `import { performance } from 'perf_hooks';
import readline from 'readline';

export class ScannerEngine {
  constructor(options = {}, onProgressCallback) {
    this.concurrency = options.concurrency || 30;
    this.timeout = options.timeout || 12000;
    this.retryMax = options.retryMax || 1;
    this.onProgress = onProgressCallback || (() => {});
  }

  async scanAll(channels) {
    const results = [];
    const queue = [...channels];
    const total = channels.length;
    let processed = 0;
    const workers = [];

    console.log(\`[Deep Scanner] Memulai inspeksi payload mendalam terhadap \${total} channel...\\n\`);
    this._printProgress(0, total);

    for (let i = 0; i < Math.min(this.concurrency, queue.length); i++) {
      workers.push(this._worker(queue, results, total, () => {
        processed++;
        this._printProgress(processed, total);
      }));
    }
    await Promise.all(workers);
    console.log('\\n\\n✔️ Verifikasi Validitas Konten Selesai Dinilai.');
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
        redirect: 'follow',
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': '*/*'
        }
      });

      const latency = performance.now() - startTime;

      if (!response.ok || response.status < 200 || response.status >= 300) {
        clearTimeout(timeoutId);
        return this._buildScanObject('DEAD', response.status, latency, \`HTTP \${response.status} Error\`, url);
      }

      const finalUrl = response.url.toLowerCase();
      if (finalUrl.includes('/login') || finalUrl.includes('/expired') || finalUrl.includes('/block') || finalUrl.includes('/portal')) {
        clearTimeout(timeoutId);
        return this._buildScanObject('DEAD', response.status, latency, 'DEAD: Terdeteksi Pengalihan Login/Portal', url);
      }

      const contentType = (response.headers.get('content-type') || '').toLowerCase();

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
    process.stdout.write(\`⏳ Deep-Scanner Payload Progress: \${current}/\${total} Channel (\${percentage}%) \`);
  }
}`,

  "scripts/services/ReportSystem.js": `import fs from 'fs';
import { FileHandler } from '../utils/FileHandler.js';

export class ReportSystem {
  constructor(reportsDir) {
    this.reportsDir = reportsDir;
  }
  flushRealtimeReport(currentResults, totalPlaylists, durationMs) {
    const totalChannels = currentResults.length;
    const liveChannels = currentResults.filter(r => r.scan.status === 'LIVE');
    const deadChannels = currentResults.filter(r => r.scan.status === 'DEAD');
    const uptime = totalChannels > 0 ? ((liveChannels.length / totalChannels) * 100).toFixed(2) : "0.00";
    
    const reportData = {
      totalPlaylist: totalPlaylists,
      totalChannel: totalChannels,
      totalLive: liveChannels.length,
      totalDead: deadChannels.length,
      uptime: \`\${uptime}%\`,
      scanDuration: \`\${(durationMs / 1000).toFixed(1)}s\`,
      lastScan: new Date().toISOString(),
      playlistStatistics: this._calculateStats(currentResults, 'sourcePlaylist'),
      channelStatistics: this._calculateStats(currentResults, 'groupTitle')
    };

    FileHandler.writeJson(\`\${this.reportsDir}/report.json\`, reportData);
    FileHandler.writeJson(\`\${this.reportsDir}/last-check.json\`, { lastScan: reportData.lastScan, uptime: reportData.uptime });
    
    FileHandler.writeText(\`\${this.reportsDir}/live.txt\`, liveChannels.map(c => c.url).join('\\n'));
    FileHandler.writeText(\`\${this.reportsDir}/dead.txt\`, deadChannels.map(c => \`[\${c.scan.contentType}] \${c.url}\`).join('\\n'));
    return reportData;
  }
  appendFinalHistory(finalReport) {
    const historyPath = \`\${this.reportsDir}/history.json\`;
    let history = [];
    if (fs.existsSync(historyPath)) {
      try { history = JSON.parse(fs.readFileSync(historyPath, 'utf-8')); } catch (e) {}
    }
    history.push({
      timestamp: finalReport.lastScan,
      totalChannel: finalReport.totalChannel,
      totalLive: finalReport.totalLive,
      totalDead: finalReport.totalDead,
      uptime: finalReport.uptime
    });
    FileHandler.writeJson(historyPath, history);
  }
  _calculateStats(results, key) {
    const stats = {};
    results.forEach(item => {
      const group = item[key] || 'Uncategorized';
      if (!stats[group]) stats[group] = { total: 0, live: 0, dead: 0 };
      stats[group].total++;
      if (item.scan.status === 'LIVE') stats[group].live++;
      else stats[group].dead++;
    });
    return stats;
  }
}`,

  "scripts/services/PlaylistGenerator.js": `import { FileHandler } from '../utils/FileHandler.js';

export class PlaylistGenerator {
  constructor(publicDir) {
    this.publicDir = publicDir;
  }
  flushRealtimePlaylists(currentResults) {
    const liveChannels = currentResults.filter(r => r.scan.status === 'LIVE');
    this._buildPlaylistOutputs(\`\${this.publicDir}/live\`, liveChannels);
    
    const playlistGroups = this._groupBy(liveChannels, 'sourcePlaylist');
    Object.keys(playlistGroups).forEach(name => {
      this._buildPlaylistOutputs(\`\${this.publicDir}/playlist/\${name}\`, playlistGroups[name]);
    });
    
    const categoryGroups = this._groupBy(liveChannels, 'groupTitle');
    Object.keys(categoryGroups).forEach(group => {
      const sanitized = group.replace(/[^a-zA-Z0-9-_]/g, '_');
      this._buildPlaylistOutputs(\`\${this.publicDir}/group/\${sanitized}\`, categoryGroups[group]);
    });
    
    FileHandler.writeJson(\`\${this.publicDir}/json/channels.json\`, liveChannels);
  }
  _buildPlaylistOutputs(basePath, channels) {
    let content = '#EXTM3U\\n';
    channels.forEach(ch => {
      content += \`#EXTINF:-1 tvg-id="\${ch.tvgId}" tvg-name="\${ch.tvgName}" tvg-logo="\${ch.tvgLogo}" tvg-country="\${ch.tvgCountry}" tvg-language="\${ch.tvgLanguage}" group-title="\${ch.groupTitle}",\${ch.name}\\n\`;
      content += \`\${ch.url}\\n\`;
    });
    FileHandler.writeText(\`\${basePath}.m3u\`, content);
    FileHandler.writeText(\`\${basePath}.m3u8\`, content);
  }
  _groupBy(array, key) {
    return array.reduce((storage, item) => {
      const groupValue = item[key] || 'Uncategorized';
      if (!storage[groupValue]) storage[groupValue] = [];
      storage[groupValue].push(item);
      return storage;
    }, {});
  }
}`,

  "scripts/index.js": `import { performance } from 'perf_hooks';
import path from 'path';
import { PlaylistDiscovery } from './core/PlaylistDiscovery.js';
import { M3uParser } from './core/M3uParser.js';
import { ScannerEngine } from './scanner/ScannerEngine.js';
import { ReportSystem } from './services/ReportSystem.js';
import { PlaylistGenerator } from './services/PlaylistGenerator.js';
import { FileHandler } from './utils/FileHandler.js';

async function main() {
  const startTime = performance.now();
  const databaseDir = path.resolve('database');
  const reportsDir = path.resolve('reports');
  const publicDir = path.resolve('public');

  FileHandler.ensureDirectories([
    databaseDir, reportsDir, publicDir,
    path.join(publicDir, 'playlist'),
    path.join(publicDir, 'group'),
    path.join(publicDir, 'json')
  ]);

  const discovery = new PlaylistDiscovery(databaseDir);
  const m3uFiles = discovery.discover();

  if (m3uFiles.length === 0) {
    console.warn('[Warning] Taruh berkas berekstensi .m3u / .m3u8 pada folder database/.');
    new ReportSystem(reportsDir).flushRealtimeReport([], 0, 0);
    return;
  }

  const parser = new M3uParser();
  let allChannels = [];
  m3uFiles.forEach(file => {
    allChannels = allChannels.concat(parser.parse(file));
  });

  const reporter = new ReportSystem(reportsDir);
  const generator = new PlaylistGenerator(publicDir);

  const scanner = new ScannerEngine(
    { concurrency: 30, timeout: 12000, retryMax: 1 },
    async (justScanned, currentResultsArray, totalChannelsCount) => {
      const elapsed = performance.now() - startTime;
      reporter.flushRealtimeReport(currentResultsArray, m3uFiles.length, elapsed);
      generator.flushRealtimePlaylists(currentResultsArray);
    }
  );

  const finalResults = await scanner.scanAll(allChannels);
  const totalDuration = performance.now() - startTime;
  
  const finalReport = reporter.flushRealtimeReport(finalResults, m3uFiles.length, totalDuration);
  reporter.appendFinalHistory(finalReport);

  console.log('✔ Prosedur Deep Inspection Selesai Sempurna.');
}
main().catch(console.error);`,

  "index.html": `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Enterprise Multi-Engine IPTV Control Center</title>
  <link rel="stylesheet" href="assets/css/style.css">
  
  <link href="https://vjs.zencdn.net/8.10.0/video-js.css" rel="stylesheet" />
  
  <script src="https://vjs.zencdn.net/8.10.0/video.min.js"></script>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/dashjs/4.7.4/dash.all.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/videojs-contrib-dash@5.1.1/dist/videojs-contrib-dash.min.js"></script>

  <script src="https://cdn.jsdelivr.net/npm/mpegts.js@1.7.3/dist/mpegts.min.js"></script>
</head>
<body>
  <header class="app-header">
    <div class="header-container">
      <h1>IPTV <span>Control Center Realtime</span></h1>
      <div class="theme-toggle">
        <label class="switch"><input type="checkbox" id="darkModeCheckbox" checked><span class="slider round"></span></label>
        <span class="theme-label">Dark Mode</span>
      </div>
    </div>
  </header>
  <main class="app-container">
    <section class="metrics-grid">
      <div class="card metric-card"><h3>Total Playlists</h3><p id="txtTotalPlaylist">-</p></div>
      <div class="card metric-card"><h3>Processed Channels</h3><p id="txtTotalChannel">-</p></div>
      <div class="card metric-card live"><h3>Live Channels</h3><p id="txtTotalLive">-</p></div>
      <div class="card metric-card dead"><h3>Dead Channels</h3><p id="txtTotalDead">-</p></div>
      <div class="card metric-card highlight"><h3>Uptime Rate</h3><p id="txtUptime">-</p></div>
    </section>
    <section class="workspace-grid">
      <div class="card player-wrapper">
        <div class="card-header"><h2>Multi-Engine Engine Router</h2><span class="badge" id="playerChannelStatus">No Feed</span></div>
        <div class="video-container">
          <video id="universalIptvVideo" class="video-js vjs-default-skin vjs-big-play-centered" controls preload="auto" width="640" height="360"></video>
        </div>
        <div class="player-meta"><h4 id="currentPlayerTitle">Select a channel</h4><p id="currentPlayerUrl">-</p></div>
      </div>
      <div class="card controls-wrapper">
        <div class="card-header"><h2>Channel Navigation <button id="btnRefresh" style="float:right; padding:2px 8px; cursor:pointer; font-size:11px;">🔄 Refresh Stream Data</button></h2></div>
        <div class="filter-group">
          <input type="text" id="inputSearch" placeholder="Search...">
          <select id="selectPlaylist"><option value="">All Playlists</option></select>
          <select id="selectGroup"><option value="">All Groups</option></select>
        </div>
        <div class="channel-list-container">
          <div id="loadingState" class="loading-state">Loading data...</div>
          <ul id="channelListRender" class="channel-list"></ul>
        </div>
      </div>
    </section>
    <section class="card history-wrapper">
      <div class="card-header"><h2>Scanner Integrity History</h2><span id="txtLastScan">Last Scan: -</span></div>
      <div class="table-responsive">
        <table class="data-table">
          <thead><tr><th>Timestamp</th><th>Monitored</th><th>Live</th><th>Dead</th><th>Uptime</th></tr></thead>
          <tbody id="historyTableBody"><tr><td colspan="5" style="text-align:center;">No records</td></tr></tbody>
        </table>
      </div>
    </section>
  </main>
  <script type="module" src="js/app.js"></script>
</body>
</html>`,

  "assets/css/style.css": `:root {
  --bg-primary: #f4f6f9; --bg-secondary: #ffffff; --text-main: #212529; --text-muted: #6c757d;
  --border-color: #dee2e6; --accent-color: #0d6efd; --success-color: #198754; --danger-color: #dc3545;
  --font-stack: -apple-system, BlinkMacSystemFont, sans-serif;
}
[data-theme="dark"] {
  --bg-primary: #0f172a; --bg-secondary: #1e293b; --text-main: #f8fafc; --text-muted: #94a3b8; --border-color: #334155; --accent-color: #38bdf8;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--font-stack); background-color: var(--bg-primary); color: var(--text-main); padding: 0; }
.app-header { background: var(--bg-secondary); border-bottom: 1px solid var(--border-color); padding: 1rem 2rem; }
.header-container { display: flex; justify-content: space-between; max-width: 1400px; margin: 0 auto; align-items: center; }
.app-container { max-width: 1400px; margin: 2rem auto; padding: 0 1rem; display: flex; flex-direction: column; gap: 2rem; }
.metrics-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem; }
.card { background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 12px; padding: 1.5rem; }
.metric-card h3 { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.5rem; }
.metric-card p { font-size: 1.75rem; font-weight: 700; }
.metric-card.live p { color: var(--success-color); }
.metric-card.dead p { color: var(--danger-color); }
.metric-card.highlight { background: var(--accent-color); color: #fff; }
.workspace-grid { display: grid; grid-template-columns: 1.6fr 1.4fr; gap: 2rem; }
@media(max-width: 992px){.workspace-grid{grid-template-columns: 1fr;}}
.card-header { display: flex; justify-content: space-between; border-bottom: 1px solid var(--border-color); padding-bottom: 0.5rem; margin-bottom: 1rem; }
.video-container { background: #000; aspect-ratio: 16/9; border-radius: 8px; overflow: hidden; }
.video-js { width: 100% !important; height: 100% !important; }
.filter-group { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 1rem; }
.filter-group input, .filter-group select { padding: 0.5rem; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-main); border-radius: 6px; }
.channel-list-container { max-height: 350px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 6px; }
.channel-item { display: flex; justify-content: space-between; padding: 0.75rem; border-bottom: 1px solid var(--border-color); cursor: pointer; }
.channel-item:hover { background: var(--bg-primary); }
.badge { padding: 0.25rem 0.5rem; font-size: 0.75rem; border-radius: 4px; background: #eee; color: #333; }
.badge.success { background: var(--success-color); color: #fff; }
.table-responsive { overflow-x: auto; }
.data-table { width: 100%; border-collapse: collapse; text-align: left; }
.data-table th, .data-table td { padding: 0.75rem; border-bottom: 1px solid var(--border-color); }
.switch { position: relative; display: inline-block; width: 40px; height: 20px; }
.switch input { opacity: 0; width: 0; height: 0; }
.slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background: #ccc; border-radius: 20px; }
.slider:before { position: absolute; content: ""; height: 14px; width: 14px; left: 3px; bottom: 3px; background: #fff; border-radius: 50%; transition: 0.4s; }
input:checked + .slider { background: var(--accent-color); }
input:checked + .slider:before { transform: translateX(20px); }
.theme-toggle { display: flex; align-items: center; gap: 0.5rem; }`,

  "js/api.js": `export class ApiService {
  static async fetchReport() {
    try { const r = await fetch('reports/report.json?t=' + Date.now()); return r.ok ? await r.json() : null; } catch { return null; }
  }
  static async fetchHistory() {
    try { const r = await fetch('reports/history.json?t=' + Date.now()); return r.ok ? await r.json() : []; } catch { return []; }
  }
  static async fetchChannels() {
    try { const r = await fetch('public/json/channels.json?t=' + Date.now()); return r.ok ? await r.json() : []; } catch { return []; }
  }
}`,

  "js/state.js": `export const AppState = {
  rawChannels: [], filteredChannels: [], filters: { search: '', playlist: '', group: '' },
  setChannels(data) { this.rawChannels = data; this.applyFilters(); },
  setFilters(newFilters) { this.filters = { ...this.filters, ...newFilters }; this.applyFilters(); },
  applyFilters() {
    const { search, playlist, group } = this.filters;
    const sLower = search.toLowerCase();
    this.filteredChannels = this.rawChannels.filter(ch => {
      const mSearch = !search || ch.name.toLowerCase().includes(sLower) || ch.groupTitle.toLowerCase().includes(sLower);
      const mPlay = !playlist || ch.sourcePlaylist === playlist;
      const mGroup = !group || ch.groupTitle === group;
      return mSearch && mPlay && mGroup;
    });
    document.dispatchEvent(new CustomEvent('state:changed'));
  }
};`,

  "js/player.js": `export class IptvPlayer {
  constructor(elId) { 
    this.vjsElementId = elId;
    
    // Perbaikan Berkas Utama: Inisialisasi Player VideoJS khusus penanganan DASH secara paksa
    this.player = videojs(elId, {
      fluid: true,
      autoplay: true,
      muted: true,
      controls: true,
      crossOrigin: 'anonymous', // Mengatasi masalah pembatasan CORS pada segmentasi media stream
      html5: {
        vhs: { overrideNative: true },
        nativeAudioTracks: false,
        nativeVideoTracks: false
      }
    });
    
    this.activeMpegtsInstance = null;
  }

  cleanUpActiveEngines() {
    // Reset status error bawaan Video.js terdahulu agar tampilan tidak membeku
    this.player.error(null);
    
    if (this.activeMpegtsInstance) {
      this.activeMpegtsInstance.unload();
      this.activeMpegtsInstance.detachMediaElement();
      this.activeMpegtsInstance.destroy();
      this.activeMpegtsInstance = null;
    }
  }

  loadStream(url, name, formatLabel = '') {
    document.getElementById('currentPlayerTitle').textContent = name;
    document.getElementById('currentPlayerUrl').textContent = url;
    const status = document.getElementById('playerChannelStatus');
    status.textContent = "ROUTING ENGINE..."; status.className = "badge";

    this.cleanUpActiveEngines();
    const srcLower = url.toLowerCase();
    const rawVideoElement = document.getElementById(this.vjsElementId + '_html5_api');

    // 1. ENGINE MPEGTS.JS (.ts / .flv)
    if (srcLower.includes('.ts') || srcLower.includes('.flv') || formatLabel.includes('.ts') || formatLabel.includes('flv')) {
      try {
        this.player.src([]);
        if (mpegts.getFeatureList().mseLivePlayback) {
          this.activeMpegtsInstance = mpegts.createPlayer({
            type: srcLower.includes('.flv') ? 'flv' : 'mse',
            url: url,
            isLive: true,
            cors: true
          });
          this.activeMpegtsInstance.attachMediaElement(rawVideoElement);
          this.activeMpegtsInstance.load();
          this.activeMpegtsInstance.play();
          status.textContent = srcLower.includes('.flv') ? "ENGINE: MPEGTS.JS (FLV)" : "ENGINE: MPEGTS.JS (TS)";
          status.className = "badge success";
        } else {
          status.textContent = "MSE UNSUPPORTED";
        }
      } catch (e) {
        status.textContent = "MPEGTS.JS ERROR";
      }
      return;
    }

    // 2. ENGINE ROUTER UNTUK MANIFEST DASH & HLS
    let mimeType = 'application/x-mpegURL';
    let selectedEngineText = "ENGINE: VIDEO.JS VHS (HLS)";

    if (srcLower.includes('.mpd') || formatLabel.includes('dash') || formatLabel.includes('.mpd')) {
      // Menggunakan tipe MIME resmi yang dikenali plugin videojs-contrib-dash & dash.js
      mimeType = 'application/dash+xml';
      selectedEngineText = "ENGINE: DASH.JS (MPEG-DASH)";
    } 
    else if (srcLower.includes('.mp4')) { mimeType = 'video/mp4'; selectedEngineText = "ENGINE: NATIVE HTML5 (MP4)"; }
    else if (srcLower.includes('.webm')) { mimeType = 'video/webm'; selectedEngineText = "ENGINE: NATIVE HTML5 (WEBM)"; }
    else if (srcLower.includes('.mp3')) { mimeType = 'audio/mpeg'; selectedEngineText = "ENGINE: AUDIO HTML5 (MP3)"; }
    else if (srcLower.includes('.aac')) { mimeType = 'audio/aac'; selectedEngineText = "ENGINE: AUDIO HTML5 (AAC)"; }

    try {
      // Injeksi parameter src & penanganan pembatasan CORS segment header stream
      this.player.src({ 
        src: url, 
        type: mimeType,
        withCredentials: false
      });
      
      this.player.play()
        .then(() => {
          status.textContent = selectedEngineText;
          status.className = "badge success";
        })
        .catch((err) => {
          status.textContent = "CORS BLOCK / STREAM REFUSED";
          console.warn("[Player Warning] Gagal memutar berkas stream, periksa kecocokan kebijakan CORS.", err);
        });
    } catch (e) {
      status.textContent = "ROUTER EXCEPTION ERROR";
    }
  }
}`,

  "js/ui.js": `import { AppState } from './state.js';
export class UiController {
  constructor(player) { this.player = player; this._init(); }
  _init() {
    this.list = document.getElementById('channelListRender');
    this.playSel = document.getElementById('selectPlaylist');
    this.groupSel = document.getElementById('selectGroup');
  }
  renderMetrics(m, lastScan) {
    if (!m) return;
    document.getElementById('txtTotalPlaylist').textContent = m.totalPlaylist || 0;
    document.getElementById('txtTotalChannel').textContent = m.totalChannel || 0;
    document.getElementById('txtTotalLive').textContent = m.totalLive || 0;
    document.getElementById('txtTotalDead').textContent = m.totalDead || 0;
    document.getElementById('txtUptime').textContent = m.uptime || "0%";
    document.getElementById('txtLastScan').textContent = \`Last Scan Sync: \${new Date(lastScan).toLocaleTimeString()}\`;
  }
  renderFilters(m) {
    if (!m) return;
    const currentPlaylists = Array.from(this.playSel.options).map(o => o.value);
    const currentGroups = Array.from(this.groupSel.options).map(o => o.value);

    Object.keys(m.playlistStatistics || {}).forEach(p => {
      if (!currentPlaylists.includes(p)) this.playSel.innerHTML += \`<option value="\${p}">\${p}</option>\`;
    });
    Object.keys(m.channelStatistics || {}).forEach(g => {
      if (!currentGroups.includes(g)) this.groupSel.innerHTML += \`<option value="\${g}">\${g}</option>\`;
    });
  }
  renderChannelsList() {
    this.list.innerHTML = '';
    document.getElementById('loadingState').style.display = 'none';
    if(AppState.filteredChannels.length === 0) {
      this.list.innerHTML = '<li class="channel-item" style="color:var(--text-muted); pointer-events:none;">No channels live available...</li>';
      return;
    }
    AppState.filteredChannels.forEach(ch => {
      const li = document.createElement('li'); li.className = 'channel-item';
      const fmt = ch.scan && ch.scan.contentType ? ch.scan.contentType : 'STREAM';
      li.innerHTML = \`<div class="channel-info"><h4>\${ch.name}</h4><p>\${ch.groupTitle}</p></div><span class="badge success">\${fmt}</span>\`;
      li.addEventListener('click', () => this.player.loadStream(ch.url, ch.name, fmt));
      this.list.appendChild(li);
    });
  }
  renderHistory(hist) {
    const tbody = document.getElementById('historyTableBody');
    if (!hist || hist.length === 0) return;
    tbody.innerHTML = '';
    [...hist].reverse().slice(0, 10).forEach(h => {
      tbody.innerHTML += \`<tr><td>\${new Date(h.timestamp).toLocaleDateString()}</td><td>\${h.totalChannel}</td><td>\${h.totalLive}</td><td>\${h.totalDead}</td><td>\${h.uptime}</td></tr>\`;
    });
  }
}`,

  "js/app.js": `import { ApiService } from './api.js';
import { AppState } from './state.js';
import { IptvPlayer } from './player.js';
import { UiController } from './ui.js';

document.addEventListener('DOMContentLoaded', async () => {
  const player = new IptvPlayer('universalIptvVideo');
  const ui = new UiController(player);
  
  document.addEventListener('state:changed', () => ui.renderChannelsList());

  async function loadAndRefreshData() {
    const report = await ApiService.fetchReport();
    const history = await ApiService.fetchHistory();
    const channels = await ApiService.fetchChannels();
    if (report) { 
      ui.renderMetrics(report, report.lastScan); 
      ui.renderFilters(report); 
    }
    ui.renderHistory(history); 
    AppState.setChannels(channels);
  }

  await loadAndRefreshData();

  document.getElementById('btnRefresh').addEventListener('click', async () => {
    const btn = document.getElementById('btnRefresh');
    btn.textContent = "⏳ Loading...";
    await loadAndRefreshData();
    setTimeout(() => btn.textContent = "🔄 Refresh Stream Data", 400);
  });

  document.getElementById('inputSearch').addEventListener('input', e => AppState.setFilters({ search: e.target.value }));
  document.getElementById('selectPlaylist').addEventListener('change', e => AppState.setFilters({ playlist: e.target.value }));
  document.getElementById('selectGroup').addEventListener('change', e => AppState.setFilters({ group: e.target.value }));
  
  document.getElementById('darkModeCheckbox').addEventListener('change', e => {
    if(e.target.checked) document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
  });
  document.documentElement.setAttribute('data-theme', 'dark');

  setInterval(loadAndRefreshData, 6000);
});`
};

console.log("⚡ Memperbarui konfigurasi Core Player Engine Router...");
for (const [filePath, content] of Object.entries(files)) {
  const fullPath = path.resolve(filePath);
  const dirPath = path.dirname(fullPath);
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(fullPath, content.trim(), 'utf-8');
}
console.log("\n🚀 Registrasi Engine DASH Berhasil Diperbaiki!");