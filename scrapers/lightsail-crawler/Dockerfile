FROM apify/actor-node:20

# Copy package definition files
COPY package*.json ./

# Install production dependencies
RUN npm --quiet set progress=false \
    && npm install --omit=dev --omit=optional \
    && echo "Installed dependencies"

# Copy source code and configuration
COPY . ./

# Run the actor
CMD ["npm", "start"]
