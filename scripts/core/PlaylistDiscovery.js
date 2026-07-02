import fs from 'fs';
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
      console.error(`[Discovery Error] Gagal membaca direktori: ${error.message}`);
      return [];
    }
  }
}