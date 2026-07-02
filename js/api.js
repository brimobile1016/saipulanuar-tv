export class ApiService {
  static async fetchReport() {
    try { const r = await fetch('reports/report.json?t=' + Date.now()); return r.ok ? await r.json() : null; } catch { return null; }
  }
  static async fetchHistory() {
    try { const r = await fetch('reports/history.json?t=' + Date.now()); return r.ok ? await r.json() : []; } catch { return []; }
  }
  static async fetchChannels() {
    try { const r = await fetch('public/json/channels.json?t=' + Date.now()); return r.ok ? await r.json() : []; } catch { return []; }
  }
}