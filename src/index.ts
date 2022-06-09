import http from 'http';
import {
  provider,
  ProviderSettings,
  makeRequest,
  makeRequestMulti,
  JSONRpc,
} from 'drpc-sdk';
import qs from 'qs';

const HOST = process.env.DRPC_SIDECAR_HOST || 'localhost';
const PORT = process.env.DRPC_SIDECAR_PORT
  ? parseInt(process.env.DRPC_SIDECAR_PORT)
  : 8999;

const DRPC_URL = process.env.DRPC_SIDECAR_URL || 'http://localhost:8090/rpc';

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
    throw new Error('Povider ids should be an array');
  }

  return {
    api_key: apiKey,
    provider_ids: providerIds,
    url: DRPC_URL,
    network: typeof parsed.network === 'string' ? parsed.network : undefined,
    timeout:
      typeof parsed.timeout === 'string' && parseInt(parsed.timeout)
        ? parseInt(parsed.timeout)
        : undefined,
    provider_num:
      typeof parsed.provider_num === 'string' && parseInt(parsed.provider_num)
        ? parseInt(parsed.provider_num)
        : undefined,
  };
}
function renderError(message: string) {
  return JSON.stringify({ jsonrpc: '2.0', error: message });
}
function sendError(response: http.ServerResponse, message: string) {
  response.statusCode = 500;
  response.end(renderError(message));
}

function getBody(request: http.IncomingMessage) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (data) => {
      body += data.toString();
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(body));
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

const requestListener: http.RequestListener = async function (
  request,
  response
) {
  if (request.method !== 'POST') {
    response.statusCode = 204;
    response.end();
    return;
  }
  const qurl = `http://${HOST}:${PORT}${request.url}`;
  if (!qurl) {
    sendError(response, 'Internal server error');
    return;
  }
  try {
    let rpcurl = new URL(qurl);
    const settings = urlParamsToSettings(rpcurl.search);
    const state = provider(settings);

    let body = await getBody(request);
    let result: any;
    if (body instanceof Array) {
      result = await makeRequestMulti(parseBody(body), state);
    } else {
      result = await makeRequest(parseBody(body)[0], state);
    }
    response.statusCode = 200;
    response.end(JSON.stringify(result));
  } catch (e) {
    if (e instanceof Error) {
      sendError(response, e.message);
    } else {
      sendError(response, 'Internal server error');
    }
  }
};

const server = http.createServer(requestListener);
server.listen(PORT, HOST, () => {
  console.log(`Server is running on http://${HOST}:${PORT}`);
});
