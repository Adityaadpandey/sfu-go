# Use lightweight Node.js Alpine image
FROM node:22-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install dependencies (only production)
RUN npm ci --only=production

# Copy source code
COPY . .

# Build Next.js app with standalone output
RUN npm run build

# Final stage: Minimal runtime image
FROM node:22-alpine AS runtime

# Set working directory
WORKDIR /app

# Copy only necessary build artifacts from builder stage
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./public

# Use non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

# Expose port
EXPOSE 3000

# Start the app using standalone server.js
CMD ["node", "server.js"]
