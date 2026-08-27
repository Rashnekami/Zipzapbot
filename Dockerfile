FROM node:22-alpine AS build
RUN apk add --no-cache git
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:22-alpine
RUN apk add --no-cache ffmpeg ca-certificates
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 8123
VOLUME ["/app/data"]
CMD ["npm","start"]
