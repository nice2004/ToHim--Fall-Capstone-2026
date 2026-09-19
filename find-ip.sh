#!/bin/bash

echo "Finding your computer's IP address..."
echo ""

# Try different methods to find IP
if command -v ipconfig &> /dev/null; then
    # macOS
    IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
    if [ -z "$IP" ]; then
        IP=$(ifconfig | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}' | head -1)
    fi
else
    # Linux
    IP=$(hostname -I | awk '{print $1}')
fi

if [ -z "$IP" ]; then
    echo "❌ Could not automatically find IP address"
    echo ""
    echo "Please find it manually:"
    echo "  - Mac: System Settings → Network → Wi-Fi → Details"
    echo "  - Or run: ifconfig | grep 'inet ' | grep -v 127.0.0.1"
    echo ""
    echo "Then update mobile/services/api.js with:"
    echo "  'http://YOUR_IP:3000/api'"
else
    echo "✅ Found IP address: $IP"
    echo ""
    echo "Update mobile/services/api.js line 12 to:"
    echo "  ? 'http://$IP:3000/api'"
    echo ""
    echo "Then restart Expo with: cd mobile && npm start"
fi


