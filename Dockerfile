# Use official Node.js runtime as base image
FROM node:24-alpine

# Set working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install project dependencies
RUN npm ci --only=production

# Copy project files
COPY . .

# Expose port (default 3000, can be overridden by environment variable)
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production

# Start application
CMD ["node", "server.js"]
