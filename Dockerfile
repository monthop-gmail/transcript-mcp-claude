# Stage 1: Build TypeScript
FROM node:22-slim AS builder

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./
RUN npm install --ignore-scripts

COPY src ./src
RUN npm run build

# Stage 2: Production runtime
FROM python:3.12-slim

WORKDIR /app

# Install Node.js 22, ffmpeg, curl, and yt-dlp dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    ca-certificates \
    gnupg \
    unzip \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# Install Deno (needed by yt-dlp for JS challenges)
RUN curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh

# Install faster-whisper
RUN pip install --no-cache-dir --break-system-packages \
    faster-whisper==1.1.0 requests

# Pre-download the tiny model
RUN python3 -c "\
from faster_whisper import WhisperModel; \
model = WhisperModel('tiny', device='cpu', compute_type='int8'); \
print('Whisper tiny model downloaded successfully')"

# Copy package files and install production Node dependencies
COPY package*.json ./
RUN npm install --production --ignore-scripts

# Copy compiled JS from builder stage
COPY --from=builder /app/dist ./dist

# Copy Python worker
COPY python ./python
RUN chmod +x python/whisper_worker.py

# Create temp directory
RUN mkdir -p /tmp/transcript-mcp

EXPOSE 3013

# Environment defaults
ENV PORT=3013
ENV HOST=0.0.0.0
ENV DEFAULT_LANG=th
ENV WHISPER_MODEL=tiny
ENV WHISPER_COMPUTE_TYPE=int8
ENV OMP_NUM_THREADS=2

CMD ["node", "dist/server-sse.js"]
