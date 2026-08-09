FROM node:20-alpine

WORKDIR /app

# Install deps first so layer caching works across code edits.
COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- http://localhost:4000/health || exit 1

CMD ["node", "src/server.js"]
