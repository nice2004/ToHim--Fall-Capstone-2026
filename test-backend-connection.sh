#!/bin/bash

echo "Testing Backend Connection"
echo "=========================="
echo ""

# Check if backend is running
echo "1. Checking if backend is running on port 3000..."
if lsof -ti:3000 > /dev/null 2>&1; then
    echo "   ✅ Backend is running on port 3000"
    PID=$(lsof -ti:3000 | head -1)
    echo "   Process ID: $PID"
else
    echo "   ❌ Backend is NOT running on port 3000"
    echo "   Start it with: npm start"
    exit 1
fi

echo ""
echo "2. Testing localhost connection..."
if curl -s http://localhost:3000/api/health > /dev/null 2>&1; then
    echo "   ✅ Backend responds on localhost"
    curl -s http://localhost:3000/api/health | head -1
else
    echo "   ❌ Backend does NOT respond on localhost"
fi

echo ""
echo "3. Finding your IP address..."
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
if [ -z "$IP" ]; then
    IP=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1)
fi

if [ -z "$IP" ]; then
    echo "   ❌ Could not find IP address"
else
    echo "   Your IP: $IP"
    echo ""
    echo "4. Testing network connection from IP..."
    if curl -s http://$IP:3000/api/health > /dev/null 2>&1; then
        echo "   ✅ Backend responds on network IP ($IP)"
        curl -s http://$IP:3000/api/health
    else
        echo "   ❌ Backend does NOT respond on network IP ($IP)"
        echo ""
        echo "   This means the backend is only listening on localhost."
        echo "   The server needs to listen on 0.0.0.0 to accept network connections."
    fi
fi

echo ""
echo "=========================="
echo ""
echo "Next steps:"
echo "1. If backend doesn't respond on network IP, check server/index.js"
echo "2. Test from your phone browser: http://$IP:3000/api/health"
echo "3. Check firewall settings if phone can't connect"


