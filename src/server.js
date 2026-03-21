import http from 'node:http';
import { createApp } from './app.js';
import { config } from './config.js';

const app = createApp();

const server = http.createServer((req, res) => {
  app.route(req, res).catch((error) => {
    console.error(error);
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        error: 'Internal server error',
        message: error.message
      })
    );
  });
});

server.listen(config.port, () => {
  console.log(`CalorAI listening on http://localhost:${config.port}`);
});
