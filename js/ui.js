import { AppState } from './state.js';
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
    document.getElementById('txtLastScan').textContent = `Last Scan Sync: ${new Date(lastScan).toLocaleTimeString()}`;
  }
  renderFilters(m) {
    if (!m) return;
    const currentPlaylists = Array.from(this.playSel.options).map(o => o.value);
    const currentGroups = Array.from(this.groupSel.options).map(o => o.value);

    Object.keys(m.playlistStatistics || {}).forEach(p => {
      if (!currentPlaylists.includes(p)) this.playSel.innerHTML += `<option value="${p}">${p}</option>`;
    });
    Object.keys(m.channelStatistics || {}).forEach(g => {
      if (!currentGroups.includes(g)) this.groupSel.innerHTML += `<option value="${g}">${g}</option>`;
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
      li.innerHTML = `<div class="channel-info"><h4>${ch.name}</h4><p>${ch.groupTitle}</p></div><span class="badge success">${fmt}</span>`;
      li.addEventListener('click', () => this.player.loadStream(ch.url, ch.name, fmt));
      this.list.appendChild(li);
    });
  }
  renderHistory(hist) {
    const tbody = document.getElementById('historyTableBody');
    if (!hist || hist.length === 0) return;
    tbody.innerHTML = '';
    [...hist].reverse().slice(0, 10).forEach(h => {
      tbody.innerHTML += `<tr><td>${new Date(h.timestamp).toLocaleDateString()}</td><td>${h.totalChannel}</td><td>${h.totalLive}</td><td>${h.totalDead}</td><td>${h.uptime}</td></tr>`;
    });
  }
}