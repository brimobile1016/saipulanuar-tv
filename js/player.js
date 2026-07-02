export class IptvPlayer {
  constructor(elId) { 
    this.vjsElementId = elId;
    
    // Perbaikan Berkas Utama: Inisialisasi Player VideoJS khusus penanganan DASH secara paksa
    this.player = videojs(elId, {
      fluid: true,
      autoplay: true,
      muted: true,
      controls: true,
      crossOrigin: 'anonymous',
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
}