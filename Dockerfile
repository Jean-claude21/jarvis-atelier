# Jarvis Atelier: its services behind one API and one MCP server. Keys and secrets come from the
# environment (ATELIER_KEYS, TREG_TOKEN…), never from this image.
FROM node:22-slim
ENV NODE_ENV=production PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY tsconfig.json ./
COPY src src
ARG ATELIER_RELEASE=local
ENV ATELIER_RELEASE=$ATELIER_RELEASE PORT=3000
EXPOSE 3000
RUN chown -R node:node /app
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "src/server.ts"]
