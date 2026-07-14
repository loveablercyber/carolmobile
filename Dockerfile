FROM node:22-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/api ./api
COPY --from=build /app/server ./server
COPY --from=build /app/server.mjs ./server.mjs
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/database ./database
COPY --from=build /app/migration-data ./migration-data
COPY --from=build /app/supabase ./supabase

EXPOSE 3000

CMD ["npm", "start"]
