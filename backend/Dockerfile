# Use official Node.js LTS image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files first (for Docker layer caching)
COPY package*.json ./

# Install production dependencies only
RUN npm install --omit=dev

# Copy all source files
COPY . .

# Cloud Run uses port 8080 by default
EXPOSE 8080

# Start the app
CMD ["node", "src/app.js"]
