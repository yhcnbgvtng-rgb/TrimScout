// Live crawl progress on 0.0.0.0:3001 (override with CRAWLER_PROGRESS_PORT).
// Reads data/run_progress.json — the crawler persists after every dealer so
// a refresh does not lose counters.

import http from 'node:http';
import { handleProgressRequest, PROGRESS_PORT } from './progress.js';

const HOST = process.env.CRAWLER_PROGRESS_HOST || '0.0.0.0';
const PORT = PROGRESS_PORT;

const server = http.createServer(async (req, res) => {
  try {
    const handled = await handleProgressRequest(req, res);
    if (!handled) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found. Try / or /progress.json');
    }
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Internal Server Error: ${err.message}`);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`NJ crawler progress monitor at http://${HOST}:${PORT}/  (JSON: /progress.json)`);
});
