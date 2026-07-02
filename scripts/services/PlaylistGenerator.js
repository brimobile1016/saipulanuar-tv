import { FileHandler } from '../utils/FileHandler.js';

export class PlaylistGenerator {
  constructor(publicDir) {
    this.publicDir = publicDir;
  }
  flushRealtimePlaylists(currentResults) {
    const liveChannels = currentResults.filter(r => r.scan.status === 'LIVE');
    this._buildPlaylistOutputs(`${this.publicDir}/live`, liveChannels);
    
    const playlistGroups = this._groupBy(liveChannels, 'sourcePlaylist');
    Object.keys(playlistGroups).forEach(name => {
      this._buildPlaylistOutputs(`${this.publicDir}/playlist/${name}`, playlistGroups[name]);
    });
    
    const categoryGroups = this._groupBy(liveChannels, 'groupTitle');
    Object.keys(categoryGroups).forEach(group => {
      const sanitized = group.replace(/[^a-zA-Z0-9-_]/g, '_');
      this._buildPlaylistOutputs(`${this.publicDir}/group/${sanitized}`, categoryGroups[group]);
    });
    
    FileHandler.writeJson(`${this.publicDir}/json/channels.json`, liveChannels);
  }
  _buildPlaylistOutputs(basePath, channels) {
    let content = '#EXTM3U\n';
    channels.forEach(ch => {
      content += `#EXTINF:-1 tvg-id="${ch.tvgId}" tvg-name="${ch.tvgName}" tvg-logo="${ch.tvgLogo}" tvg-country="${ch.tvgCountry}" tvg-language="${ch.tvgLanguage}" group-title="${ch.groupTitle}",${ch.name}\n`;
      content += `${ch.url}\n`;
    });
    FileHandler.writeText(`${basePath}.m3u`, content);
    FileHandler.writeText(`${basePath}.m3u8`, content);
  }
  _groupBy(array, key) {
    return array.reduce((storage, item) => {
      const groupValue = item[key] || 'Uncategorized';
      if (!storage[groupValue]) storage[groupValue] = [];
      storage[groupValue].push(item);
      return storage;
    }, {});
  }
}