# Official Playwright image with Node.js & Chromium pre-installed
FROM mcr.microsoft.com/playwright:v1.50.0-noble

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install Node dependencies
RUN npm ci --only=production

# Copy application source
COPY . .

# Expose Railway assigned port
ENV PORT=3001
EXPOSE 3001

# Start monitor loop
CMD ["node", "monitor.js", "--loop", "1m"]
