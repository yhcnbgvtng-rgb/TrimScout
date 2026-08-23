#!/bin/bash
set -e

echo "=========================================="
echo "🚀 Publishing Porsche Tracker to AWS Lightsail..."
echo "=========================================="

HOST="3.239.46.91"
KEY="$HOME/.ssh/lightsail_key.pem"
TARGET_DIR="~/porsche-tracker"

# Test SSH connection
if ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no -i "$KEY" admin@$HOST "mkdir -p $TARGET_DIR" 2>/dev/null; then
    USER="admin"
elif ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no -i "$KEY" bitnami@$HOST "mkdir -p $TARGET_DIR" 2>/dev/null; then
    USER="bitnami"
else
    echo "⚠️ Direct SSH timed out. Make sure Port 22 is open in AWS Lightsail Networking tab."
    exit 1
fi

echo "📦 Syncing files to $USER@$HOST:$TARGET_DIR..."
rsync -avz -e "ssh -i $KEY" \
    --exclude 'node_modules' \
    --exclude 'data' \
    --exclude '.git' \
    ./ $USER@$HOST:$TARGET_DIR/

echo "🎉 Deployment successful!"
