DOCKER_NAME = drpc-sidecar

clean:
	rm -rf ./build

build: clean
	npx tsc -p ./tsconfig.json

docker-build: build
	docker build -t $(DOCKER_NAME) ./

docker-run: docker-build
	docker run -it --rm -p 3000:80 -e DRPC_SIDECAR_URL="http://host.docker.internal:8090/rpc" $(DOCKER_NAME) /home/node/app/index.js