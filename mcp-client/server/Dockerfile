FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production
EXPOSE 4200
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://localhost:4200/health || exit 1
CMD ["node", "src/server.js"]
