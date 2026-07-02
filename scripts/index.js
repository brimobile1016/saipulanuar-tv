import { performance } from 'perf_hooks';
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
main().catch(console.error);