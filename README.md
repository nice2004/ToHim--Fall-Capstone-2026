# Tabbe - Relationship Tracker

A mobile application to help you keep track of your relationships and interactions with friends, family, and acquaintances.

## Project Status

This is a CS-195 capstone project. The mobile app (React Native/Expo) and backend
(Node/Express + SQLite) are both functional end-to-end: recording a session,
extracting people/details via the OpenAI API, browsing tracked people, and asking
natural-language questions about past interactions all work locally. The project
is currently in Alpha-stage development, with TestFlight distribution assets in
progress (see [TESTFLIGHT_GUIDE.md](TESTFLIGHT_GUIDE.md)). To inspect or run the
current artifact, follow the Setup instructions below to start the backend server
and the Expo mobile app together.

## Features

- **Session Recording**: Start a session and describe an interaction you just had
- **Person Management**: Automatically creates tabs for each person you mention
- **Smart Reminders**: Ask Tabbe questions about your relationships and get helpful reminders
- **Voice & Text**: Both voice input and text responses for natural interaction
- **AI-Powered**: Uses AI to understand conversations and answer queries intelligently

## Prerequisites

- **Node.js (v14 or higher)** - [Installation Guide](INSTALL_NODE.md)
- npm (comes with Node.js)
- OpenAI API key ([Get one here](https://platform.openai.com/api-keys))
- For mobile development: Expo Go app on your phone, or iOS Simulator / Android Emulator

> **Note**: If you get "npm: command not found", you need to install Node.js first. See [INSTALL_NODE.md](INSTALL_NODE.md) for detailed instructions. If you have `mise` installed, you can quickly install Node.js with: `mise install node@lts && mise activate node@lts`

## Setup

### Backend Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file in the root directory:
```env
OPENAI_API_KEY=your_openai_api_key_here
PORT=3000
```

3. Start the backend server:
```bash
npm start
# or for development with auto-reload:
npm run dev
```

The server will start on `http://localhost:3000`. Keep this running while using the mobile app.

### Mobile App Setup

1. Navigate to the mobile directory:
```bash
cd mobile
```

2. Install dependencies:
```bash
npm install
```

3. **Important**: Configure the API URL for your device:
   - Open `mobile/services/api.js`
   - For **iOS Simulator**: Use `http://localhost:3000/api` (default)
   - For **Android Emulator**: Change to `http://10.0.2.2:3000/api`
   - For **Physical Device**: Change to `http://YOUR_COMPUTER_IP:3000/api`
     - Find your IP: `ifconfig` (Mac/Linux) or `ipconfig` (Windows)
     - Example: `http://192.168.1.100:3000/api`

4. Start the Expo development server:
```bash
npm start
```

5. Scan the QR code with Expo Go app on your phone, or press:
   - `i` for iOS simulator
   - `a` for Android emulator
   - `w` for web browser

## Usage

### Recording a Session

1. Open the app and tap **"Start New Session"** on the home screen
2. Describe the interaction you just had. For example:
   > "I just got off the phone with Joel Nakazawa. He is currently in Turkey, preparing to return to Westmont for his Junior year. We spoke about how he is feeling about this upcoming track and field season, he expressed excitement about how he is going to perform. His return flight is going to be on the 9th of January."
3. Tap **"Submit"** - Tabbe will automatically:
   - Extract the person's name
   - Create a profile for them (if new)
   - Store the information
   - Generate structured notes

### Viewing People

1. Go to the **"People"** tab to see all people you've tracked
2. Tap on any person to see their details, sessions, and stored information
3. From a person's detail page, tap **"Record New Session"** to add more information about them

### Asking Questions

1. Go to the **"Remind Me"** tab
2. Ask Tabbe anything about your relationships, for example:
   - "Hey I'm going to be grabbing lunch with Joel later today, could you help remind me what we talked about on our last phonecall?"
   - "Hey could you remind me of what day Joel was scheduled to fly back to school"
   - "Who was my friend who is going to be flying in on the 9th of January?"
3. Tabbe will provide both written and spoken responses
4. If Tabbe needs more information, it will ask follow-up questions

## Technology Stack

- **Frontend**: React Native with Expo
- **Backend**: Node.js with Express
- **Database**: SQLite
- **AI**: OpenAI API for NLP processing

## Deployment

For TestFlight deployment, see:
- [TESTFLIGHT_GUIDE.md](TESTFLIGHT_GUIDE.md) - Complete guide
- [mobile/QUICK_START_TESTFLIGHT.md](mobile/QUICK_START_TESTFLIGHT.md) - Quick start

