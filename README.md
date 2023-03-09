# DRPC sidecar

Sidecar for DRPC proxy, that makes DRPC look like simple JSON RPC provider

# Requests

DRPC sidecar looks and works like any other JSON RPC provider. Its responsibility to provide compatibility with software
that doesn't support DRPC natively, however want to use all the good stuff.

Request config should be passed as query params.
Configurable settings are described in [DRPC SDK documentation](https://p2p-org.github.io/drpc-client/modules.html#ProviderSettings)

## Example

```
POST http://0.0.0.0:3000/?provider_ids[]=test&dkey=dkey HTTP/1.1
content-type: application/json

[{
  "method": "eth_blockNumber",
  "params": [],
  "id": "100",
  "jsonrpc":"2.0"
},{
  "method": "eth_blockNumber",
  "params": [],
  "id": "101",
  "jsonrpc":"2.0"
}]
```

## Prerequisites

Node 16+ and npm

You should install node modules
`npm i`

## Run app

To start with docker
`make docker-run`

## Server config

Config enabled through env vars:

`DRPC_SIDECAR_HOST` — server host, default: localhost

`DRPC_SIDECAR_PORT` — server port, default: 8999

`DRPC_SIDECAR_RPC_PROVIDER` — url to RPC-provider for test mode

`DRPC_SIDECAR_URL` — url to DRPC-proxy, default is https://main.drpc.org
