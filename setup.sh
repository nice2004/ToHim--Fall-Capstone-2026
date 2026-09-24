#!/bin/bash

echo "🚀 Setting up ToHim - Prayer Tracker"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed!"
    echo ""
    echo "Please install Node.js first. You have several options:"
    echo ""
    echo "Option 1 (Recommended - You have mise installed):"
    echo "  mise install node@lts"
    echo "  mise trust"
    echo ""
    echo "Option 2 (Using Homebrew):"
    echo "  brew install node"
    echo ""
    echo "Option 3 (Official installer):"
    echo "  Visit https://nodejs.org/ and download the LTS version"
    echo ""
    echo "See INSTALL_NODE.md for detailed instructions."
    echo ""
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed!"
    echo "npm should come with Node.js. Please reinstall Node.js."
    exit 1
fi

echo "✅ Node.js $(node --version) found"
echo "✅ npm $(npm --version) found"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    echo "OPENAI_API_KEY=your_openai_api_key_here" > .env
    echo "PORT=3000" >> .env
    echo "✅ .env file created. Please add your OpenAI API key!"
else
    echo "✅ .env file already exists"
fi

# Install backend dependencies
echo ""
echo "📦 Installing backend dependencies..."
if npm install; then
    echo "✅ Backend dependencies installed"
else
    echo "❌ Failed to install backend dependencies"
    exit 1
fi

# Install mobile dependencies
echo ""
echo "📦 Installing mobile app dependencies..."
cd mobile
if npm install; then
    echo "✅ Mobile app dependencies installed"
    cd ..
else
    echo "❌ Failed to install mobile app dependencies"
    cd ..
    exit 1
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Add your OpenAI API key to the .env file"
echo "2. Start the backend server: npm start"
echo "3. In another terminal, start the mobile app: cd mobile && npm start"
echo ""
echo "For physical device testing, update mobile/services/api.js with your computer's IP address"

