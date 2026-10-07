FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY backend ./backend
COPY frontend ./frontend
COPY db ./db
COPY scripts ./scripts

RUN mkdir -p /app/.data && chown -R node:node /app/.data

USER node

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=58973

EXPOSE 58973

CMD ["sh", "-c", "npm run db:migrate && exec npm start"]
