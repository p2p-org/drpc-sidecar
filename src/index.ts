import http from 'http';
import https from 'https';
import { ProviderSettings, JSONRpc, HTTPApi } from '@drpcorg/drpc-sdk';
import { Fallback } from '@drpcorg/drpc-proxy';
import qs from 'qs';
import { metricServer } from './metrics.js';
import { logger } from './logger.js';

const HOST = process.env.DRPC_SIDECAR_HOST || 'localhost';
const PORT = process.env.DRPC_SIDECAR_PORT
  ? parseInt(process.env.DRPC_SIDECAR_PORT)
  : 8999;
const RPC_PROVIDER = process.env.DRPC_SIDECAR_RPC_PROVIDER || '';

const DRPC_URL = process.env.DRPC_SIDECAR_URL || 'https://main.drpc.org';

const METRICS_HOST = process.env.DRPC_METRICS_HOST || '';
const METRICS_PORT = process.env.DRPC_METRICS_PORT
  ? parseInt(process.env.DRPC_METRICS_PORT)
  : 9090;

// Checking signatures is really CPU expensive, so if you don't care — you can switch it off
const SKIP_SIG_CHECK = !!process.env.DRPC_SKIP_SIG_CHECK;

// DRPC checks response to be valid, but if we want to spare some CPU we assume it is valid
const SKIP_RESPONSE_CHECK = !!process.env.DRPC_SKIP_RESPONSE_CHECK;

function urlParamsToSettings(query: string): ProviderSettings {
  const parsed = qs.parse(query.replace(/\?/gi, ''));
  let dkey: string;
  if (typeof parsed.dkey === 'string') {
    dkey = parsed.dkey;
  } else {
    throw new Error("Can't read dkey");
  }

  let providerIds: string[] | undefined = undefined;
  if (parsed.provider_ids instanceof Array) {
    providerIds = parsed.provider_ids.map((el) => el.toString());
  }

  // Quorum params
  let quorum_from: number | undefined;
  if (typeof parsed.quorum_from === 'string') {
    quorum_from = parseInt(parsed.quorum_from);

    if (isNaN(quorum_from)) {
      throw new Error('quorum_from should be a number');
    }
  }

  let quorum_of: number | undefined;
  if (typeof parsed.quorum_of === 'string') {
    quorum_of = parseInt(parsed.quorum_of);

    if (isNaN(quorum_of)) {
      throw new Error('quorum_to should be a number');
    }
  }

  // Fallback params
  let fallbackObject: Fallback | undefined;
  if (
    typeof parsed.fallback === 'string' &&
    (parsed.fallback.toLowerCase() === 'true' ||
      parsed.fallback.toLowerCase() === 'false')
  ) {
    let enabled = parsed.fallback.toLowerCase() === 'true' ? true : false;
    fallbackObject = {
      enabled,
    };

    // Fallback provider ids
    if (parsed.fallback_provider_ids instanceof Array) {
      let fallback_provider_ids = parsed.fallback_provider_ids.map((el) =>
        el.toString()
      );
      fallbackObject.provider_ids = fallback_provider_ids;
    }
  }

  // Client type
  let client_type: string | undefined;
  if (typeof parsed.client_type === 'string') {
    client_type = parsed.client_type;
  }

  return {
    dkey,
    skipSignatureCheck: SKIP_SIG_CHECK,
    skipResponseDeepCheck: SKIP_RESPONSE_CHECK,
    provider_ids: providerIds,
    url: DRPC_URL,
    network: typeof parsed.network === 'string' ? parsed.network : undefined,
    timeout:
      typeof parsed.timeout === 'string' && parseInt(parsed.timeout)
        ? parseInt(parsed.timeout)
        : 15000,
    quorum_from,
    quorum_of,
    fallback: fallbackObject,
    client_type,
  };
}
function renderError(message: string) {
  return JSON.stringify({ jsonrpc: '2.0', error: message });
}
async function sendError(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  message: string
) {
  console.log(`Sending error: ${message}, body:`, await getBody(request));
  response.statusCode = 500;
  response.end(renderError(message));
}

let bodymap = new WeakMap();

function getBody(request: http.IncomingMessage) {
  if (bodymap.has(request)) {
    return Promise.resolve(bodymap.get(request));
  }
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (data) => {
      body += data.toString();
    });
    request.on('end', () => {
      try {
        let json = JSON.parse(body);
        bodymap.set(request, json);
        resolve(json);
      } catch (e) {
        logger.error(`Unable to parse request body: ${body}`);
        reject(new Error('Unable to parse request body'));
      }
    });
  });
}

function parseBody(body: any): JSONRpc[] {
  let rpcs: JSONRpc[];
  if (!(body instanceof Array)) {
    rpcs = [body];
  } else {
    rpcs = body;
  }

  return rpcs.map((el) => {
    if (!el.method) {
      throw new Error('No method specified');
    }
    if (!el.id) {
      throw new Error('No id specified');
    }
    if (!el.params) {
      el.params = [];
    }
    return el;
  });
}

function getUrl(request: http.IncomingMessage): URL | null {
  const qurl = `http://${HOST}:${PORT}${request.url}`;
  try {
    return new URL(qurl);
  } catch (e) {
    console.warn(e);
    return null;
  }
}

const requester = async function (request: http.IncomingMessage, rpcurl: URL) {
  const settings = urlParamsToSettings(rpcurl.search);
  const api = new HTTPApi(settings);

  let body = await getBody(request);
  let result: any;
  if (body instanceof Array) {
    result = await api.callMulti(parseBody(body));
  } else {
    result = await api.call(parseBody(body)[0]);
  }
  return result;
};

const server = http.createServer(async (request, response) => {
  if (request.method !== 'POST') {
    response.statusCode = 204;
    response.end();
    return;
  }

  const rpcurl = getUrl(request);
  if (!rpcurl) {
    sendError(request, response, 'Internal server error');
    return;
  }
  if (rpcurl.pathname === '/') {
    try {
      let result = await requester(request, rpcurl);
      response.statusCode = 200;
      response.end(JSON.stringify(result));
    } catch (e) {
      if (e instanceof Error) {
        sendError(request, response, e.message);
      } else {
        sendError(request, response, 'Internal server error');
      }
    }
  } else if (rpcurl.pathname === '/test') {
    requester(request, rpcurl).catch(async (e) => {
      console.log(await getBody(request));
      console.log(e);
    });
    let url = new URL(RPC_PROVIDER);
    let proxy = https.request(
      {
        protocol: url.protocol,
        host: url.host,
        path: url.pathname,
        method: request.method,
        headers: Object.entries(request.headers)
          .filter(([name]) => {
            return !['host'].includes(name.toLowerCase());
          })
          .reduce((acc, [name, val]) => {
            acc[name] = val;
            return acc;
          }, {} as any),
      },
      (res) => {
        if (res.statusCode !== 200) {
          console.log(`Proxy response error: ${res.statusCode}`, res.headers);
        }
        res.pipe(response);
      }
    );
    proxy.on('error', (error) => {
      console.log(`Proxy error:`, error);
    });
    request.pipe(proxy);
  } else {
    response.statusCode = 404;
    response.end('');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Server is running on http://${HOST}:${PORT}`);
});

if (METRICS_HOST) {
  metricServer.listen(METRICS_PORT, METRICS_HOST, () => {
    console.log(
      `Metric server is running on http://${METRICS_HOST}:${METRICS_PORT}`
    );
  });
}
