FROM node:22.19.0-bookworm-slim
WORKDIR /app
COPY server.mjs ./server.mjs
USER node
EXPOSE 8787
CMD ["node", "server.mjs"]
