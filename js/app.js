import { ApiService } from './api.js';
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
});