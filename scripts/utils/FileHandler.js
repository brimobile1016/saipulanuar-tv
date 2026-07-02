import fs from 'fs';
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
      fs.appendFileSync(filePath, content + '\n', 'utf-8');
    } else {
      fs.writeFileSync(filePath, content, 'utf-8');
    }
  }
}