DOCKER_NAME = drpc-sidecar

clean:
	rm -rf ./build

build: clean
	npx tsc -p ./tsconfig.json

docker-build:
	docker build -t $(DOCKER_NAME) ./

docker-run: docker-build
	docker run -it --rm -p 3000:80 -e DRPC_SIDECAR_URL="http://host.docker.internal:8090/rpc" -e DRPC_SIDECAR_RPC_PROVIDER="https://test.eth-infa.p2p.org/llgJ0oVpmmf23YTmnT7onL2YhuiwElVvLrYClWpHLkfC91q99w/mainnet" $(DOCKER_NAME)
