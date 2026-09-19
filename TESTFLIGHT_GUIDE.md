# Deploying Tabbe to TestFlight

This guide will walk you through building and deploying your Tabbe app to TestFlight for beta testing.

## Prerequisites

1. **Apple Developer Account** ($99/year)
   - Sign up at https://developer.apple.com/programs/
   - You'll need this to submit apps to TestFlight

2. **Expo Account** (free)
   - Sign up at https://expo.dev/
   - Needed for EAS Build service

3. **Production Backend**
   - Your backend needs to be deployed and accessible via HTTPS
   - Options: Heroku, Railway, Render, AWS, etc.
   - Update `mobile/services/api.js` with your production URL

## Step 1: Install EAS CLI

```bash
npm install -g eas-cli
```

## Step 2: Login to Expo

```bash
cd mobile
eas login
```

## Step 3: Initialize EAS Project (First Time Only)

```bash
eas init
```

This will create a project ID in your `app.json`.

## Step 4: Update App Configuration

### Update Bundle Identifier

Edit `mobile/app.json` and change the bundle identifier to something unique:

```json
"bundleIdentifier": "com.yourname.tabbe"
```

Use your own unique identifier (e.g., `com.davidoyebade.tabbe`). This cannot be changed after first submission.

### Update Production API URL

Edit `mobile/services/api.js` and set your production backend URL:

```javascript
const API_BASE_URL = __DEV__ 
  ? 'http://localhost:3000/api'  // Development
  : 'https://your-production-backend.com/api';  // ← Update this!
```

## Step 5: Create App Assets

You need:
- **App Icon**: `mobile/assets/icon.png` (1024x1024px PNG, no transparency)
- **Splash Screen**: `mobile/assets/splash.png` (1242x2436px PNG)

See `mobile/ASSETS_README.md` for detailed instructions on creating these.

## Step 6: Build for iOS

```bash
cd mobile
eas build --platform ios --profile production
```

This will:
- Ask you to create an app in Expo (if first time)
- Build your app in the cloud (no Xcode needed!)
- Take 10-20 minutes

Choose **"Build for App Store"** when prompted (for TestFlight).

## Step 7: Submit to App Store Connect

After the build completes:

```bash
eas submit --platform ios
```

This will:
- Ask for your Apple ID and app-specific password
- Upload the build to App Store Connect
- Take 5-10 minutes

**Note**: You'll need to create an app-specific password at https://appleid.apple.com/
- Go to Sign-In and Security → App-Specific Passwords
- Generate a new password for "Expo EAS Submit"

## Step 8: Configure in App Store Connect

1. Go to https://appstoreconnect.apple.com/
2. Select your app (or create a new one if first time)
3. Go to "TestFlight" tab
4. Wait for processing (can take 10-30 minutes)
5. Add internal/external testers
6. Submit for Beta App Review (if external testing)

## Step 9: Invite Testers

### Internal Testing (up to 100 testers)
- Add team members in App Store Connect
- They'll receive an email invitation
- No review required

### External Testing (unlimited testers)
- Create a test group
- Add the build
- Submit for Beta App Review (takes 24-48 hours)
- Once approved, add testers

## Important Notes

### Backend Requirements
- Your backend MUST be accessible via HTTPS
- Update CORS settings to allow your app's bundle ID
- Consider using environment variables for API keys

### Bundle Identifier
- Must be unique (e.g., `com.yourname.tabbe`)
- Cannot be changed after first submission
- Update in `app.json` → `ios.bundleIdentifier`

### Version Numbers
- Increment version in `app.json` for each new build
- Format: `1.0.0` (major.minor.patch)
- Also increment `buildNumber` for iOS

## Troubleshooting

### Build Fails
- Check that all dependencies are compatible
- Ensure app.json is valid JSON
- Check EAS build logs: `eas build:list`

### Submission Fails
- Verify Apple Developer account is active
- Check app-specific password is correct
- Ensure bundle ID matches App Store Connect

### TestFlight Build Not Appearing
- Wait 10-30 minutes for processing
- Check email for any issues
- Verify build status in App Store Connect

## Quick Commands Reference

```bash
# Build iOS app
cd mobile
eas build --platform ios --profile production

# Submit to App Store
eas submit --platform ios

# Check build status
eas build:list

# View build logs
eas build:view [BUILD_ID]
```

## Next Steps After TestFlight

Once testing is complete:
1. Fix any issues found by testers
2. Build a new version
3. Submit to App Store for public release
4. Or continue iterating in TestFlight



