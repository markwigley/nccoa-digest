#!/usr/bin/env bash
# Build script for Render deployment

set -e

echo "Installing npm dependencies..."
npm install

echo "Installing Puppeteer Chrome browser..."
npx puppeteer browsers install chrome

echo "Build complete!"
