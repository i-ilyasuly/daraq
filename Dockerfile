# 1-саты: Құрастыру (Build environment)
FROM node:22-alpine AS builder

WORKDIR /app

# Тек тәуелділіктерге қатысты файлдарды көшіріп, орнату
COPY package.json package-lock.json ./
RUN npm ci

# Барлық жобаны көшіріп, компиляциялау
COPY . .
RUN npm run build

# 2-саты: Өндірістік (Production environment)
FROM node:22-alpine AS runner

WORKDIR /app

# Тек қажетті файлдарды ғана builder-ден көшіріп алу
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./
COPY --from=builder /app/dist ./dist

# Тек production тәуелділіктерін ғана орнату
RUN npm ci --omit=dev

# Портты көрсету
EXPOSE 8080

# Контейнер іске қосылғанда орындалатын команда
CMD ["npm", "start"]
