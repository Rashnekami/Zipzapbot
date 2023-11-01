FROM alpine

RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    nodejs \
    npm \
    ffmpeg

# Env var for Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install

RUN addgroup -S app && adduser -S -G app app

COPY --chown=app:app . .

# Change permissions for the whole app directory
RUN chmod -R 777 /usr/src/app

USER app

EXPOSE 8123

CMD [ "npm", "start" ]