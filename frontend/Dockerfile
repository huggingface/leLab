# Vite 8 requires Node ^20.19.0 or >=22.12.0.
FROM node:22-alpine

# Use the existing node user (usually UID 1000)
# Set up environment variables for the node user
ENV HOME=/home/node \
    PATH=/home/node/.local/bin:$PATH

# Create and set up app directory owned by node user
# Go to user's home directory first to ensure it exists
WORKDIR $HOME
RUN mkdir -p $HOME/app && \
    chown -R node:node $HOME/app && \
    chmod -R 755 $HOME/app # Set initial permissions
WORKDIR $HOME/app

# Switch to the node user
USER node

# Copy package files (owned by node)
COPY --chown=node:node package*.json ./

# Install dependencies straight from the committed lockfile. `npm ci` honours
# the `resolved` URLs in package-lock.json and ignores the builder's configured
# registry, so the install can't be derailed by a slow/incomplete npm mirror.
RUN npm ci

# Copy the entire viewer directory (owned by node)
COPY --chown=node:node . .

# Build the application
RUN npm run build

# Expose port
EXPOSE 7860

# Start the application
CMD ["npm", "run", "preview", "--", "--port", "7860", "--host"]
