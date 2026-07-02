import fs from 'fs';
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
      uptime: `${uptime}%`,
      scanDuration: `${(durationMs / 1000).toFixed(1)}s`,
      lastScan: new Date().toISOString(),
      playlistStatistics: this._calculateStats(currentResults, 'sourcePlaylist'),
      channelStatistics: this._calculateStats(currentResults, 'groupTitle')
    };

    FileHandler.writeJson(`${this.reportsDir}/report.json`, reportData);
    FileHandler.writeJson(`${this.reportsDir}/last-check.json`, { lastScan: reportData.lastScan, uptime: reportData.uptime });
    
    FileHandler.writeText(`${this.reportsDir}/live.txt`, liveChannels.map(c => c.url).join('\n'));
    FileHandler.writeText(`${this.reportsDir}/dead.txt`, deadChannels.map(c => `[${c.scan.contentType}] ${c.url}`).join('\n'));
    return reportData;
  }
  appendFinalHistory(finalReport) {
    const historyPath = `${this.reportsDir}/history.json`;
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
}