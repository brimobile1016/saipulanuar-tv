import fs from 'fs';
import path from 'path';

export class M3uParser {
  parse(filePath) {
    const channels = [];
    const playlistName = path.basename(filePath, path.extname(filePath));
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split(/\r?\n/);
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
      console.error(`[Parser Error] Gagal memproses file ${filePath}: ${error.message}`);
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
    const regex = new RegExp(`${attrName}="([^"]*)"`, 'i');
    const match = line.match(regex);
    return match ? match[1].trim() : '';
  }
}