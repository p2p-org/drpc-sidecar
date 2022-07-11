import http from 'http';
import https from 'https';
import { ProviderSettings, JSONRpc, HTTPApi } from 'drpc-sdk';
import qs from 'qs';

const HOST = process.env.DRPC_SIDECAR_HOST || 'localhost';
const PORT = process.env.DRPC_SIDECAR_PORT
  ? parseInt(process.env.DRPC_SIDECAR_PORT)
  : 8999;
const RPC_PROVIDER = process.env.DRPC_SIDECAR_RPC_PROVIDER || '';

const DRPC_URL = process.env.DRPC_SIDECAR_URL || 'https://main.drpc.org';

function urlParamsToSettings(query: string): ProviderSettings {
  const parsed = qs.parse(query.replace(/\?/gi, ''));
  let apiKey: string;
  if (typeof parsed.api_key === 'string') {
    apiKey = parsed.api_key;
  } else {
    throw new Error("Can't read api_key");
  }

  let providerIds: string[];
  if (parsed.provider_ids instanceof Array) {
    providerIds = parsed.provider_ids.map((el) => el.toString());
    if (providerIds.length === 0) {
      throw new Error('Provider ids should not empty');
    }
  } else {
    throw new Error('Provider ids should be an array');
  }

  return {
    api_key: apiKey,
    provider_ids: providerIds,
    url: DRPC_URL,
    network: typeof parsed.network === 'string' ? parsed.network : undefined,
    timeout:
      typeof parsed.timeout === 'string' && parseInt(parsed.timeout)
        ? parseInt(parsed.timeout)
        : 15000,
    provider_num:
      typeof parsed.provider_num === 'string' && parseInt(parsed.provider_num)
        ? parseInt(parsed.provider_num)
        : undefined,
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
