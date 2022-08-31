import { collectDefaultMetrics, Registry } from 'prom-client';
import http from 'http';

const register = new Registry();
collectDefaultMetrics({ register });

export const metricServer = http.createServer(async (request, response) => {
  if (request.url === '/metrics') {
    response.setHeader('Content-Type', register.contentType);
    response.end(await register.metrics());
  } else {
    response.statusCode = 404;
    response.end();
  }
});
