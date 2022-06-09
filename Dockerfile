FROM node:lts-alpine3.15
COPY ./build /home/node/app
COPY ./package* /home/node/app
ENV DRPC_SIDECAR_HOST=0.0.0.0
ENV DRPC_SIDECAR_PORT=80
WORKDIR /home/node/app
RUN npm i
EXPOSE 8999
