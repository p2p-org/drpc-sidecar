FROM node:18-alpine3.15
RUN apk add --update --no-cache make
COPY ./ /home/node/app
ENV DRPC_SIDECAR_HOST=0.0.0.0
ENV DRPC_SIDECAR_PORT=80
WORKDIR /home/node/app
RUN npm i
RUN make build
EXPOSE 8999
CMD [ "node", "/home/node/app/build/index.js"]
