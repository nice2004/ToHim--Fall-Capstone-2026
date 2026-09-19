#!/bin/bash

echo "🚀 Starting ngrok tunnel for Tabbe backend"
echo ""
echo "Make sure your backend server is running on port 3000!"
echo "Press Ctrl+C to stop ngrok"
echo ""

# Check if ngrok is installed
if ! command -v ngrok &> /dev/null; then
    echo "❌ ngrok is not installed!"
    echo ""
    echo "Install it with:"
    echo "  brew install ngrok"
    echo ""
    echo "Or download from: https://ngrok.com/download"
    echo ""
    echo "After installing, sign up at https://dashboard.ngrok.com/ and run:"
    echo "  ngrok config add-authtoken YOUR_TOKEN"
    exit 1
fi

# Start ngrok with request header to skip browser warning
echo "Starting ngrok tunnel..."
echo "Copy the 'Forwarding' URL (https://...) and update mobile/services/api.js"
echo ""
echo "Note: Using --request-header-add to skip browser warning for React Native"
echo ""
ngrok http 3000 --request-header-add "ngrok-skip-browser-warning: true"

