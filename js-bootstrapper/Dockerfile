FROM node:23-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm i
RUN npm run build

FROM node:23-alpine AS final
WORKDIR /app
COPY --from=builder /app/dist/bootstrapper.mjs .
COPY --from=builder /app/node_modules/ ./node_modules/

ENTRYPOINT [ "node", "bootstrapper.mjs" ]
