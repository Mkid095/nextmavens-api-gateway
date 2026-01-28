FROM node:18-alpine

WORKDIR /app

# Install build dependencies and pnpm
RUN apk add --no-cache python3 make g++ && \
    npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

EXPOSE 8080

CMD ["pnpm", "start"]
