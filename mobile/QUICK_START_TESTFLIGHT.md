# Quick Start: Deploy to TestFlight

## Prerequisites Checklist

- [ ] Apple Developer Account ($99/year) - https://developer.apple.com/programs/
- [ ] Expo account (free) - https://expo.dev/
- [ ] Production backend deployed with HTTPS
- [ ] App icons and splash screens created (see ASSETS_README.md)

## Step-by-Step Deployment

### 1. Install EAS CLI
```bash
npm install -g eas-cli
```

### 2. Login to Expo
```bash
cd mobile
eas login
```

### 3. Initialize EAS Project (First Time Only)
```bash
eas init
```
This will create a project ID in your `app.json`.

### 4. Update Production API URL
Edit `mobile/services/api.js`:
```javascript
const API_BASE_URL = __DEV__ 
  ? 'http://localhost:3000/api'
  : 'https://your-production-backend.com/api';  // ← Update this!
```

### 5. Create App Assets
See `ASSETS_README.md` for details. You need:
- `assets/icon.png` (1024x1024)
- `assets/splash.png` (1242x2436)

### 6. Update Bundle Identifier (Important!)
Edit `mobile/app.json` and change:
```json
"bundleIdentifier": "com.yourname.tabbe"
```
Use your own unique identifier (e.g., `com.davidoyebade.tabbe`)

### 7. Build for iOS
```bash
cd mobile
eas build --platform ios --profile production
```

Choose:
- **Build for App Store** (for TestFlight)
- **Build for Simulator** (for local testing)

### 8. Submit to App Store Connect
```bash
eas submit --platform ios
```

You'll need:
- Apple ID email
- App-specific password (create at appleid.apple.com)

### 9. Configure in App Store Connect
1. Go to https://appstoreconnect.apple.com/
2. Wait for build processing (10-30 min)
3. Go to TestFlight tab
4. Add testers (internal or external)
5. For external testing: Submit for Beta App Review

## Common Issues

### "No project ID found"
Run `eas init` first

### "Bundle identifier already in use"
Change it in `app.json` to something unique

### "Build failed"
- Check that all assets exist
- Verify app.json is valid JSON
- Check build logs: `eas build:list`

### "Can't connect to backend"
- Ensure production backend is deployed
- Update API URL in `services/api.js`
- Check CORS settings on backend

## Testing Locally First

Before deploying to TestFlight, test with:
```bash
cd mobile
npm start
# Press 'i' for iOS simulator
```

## Next Steps After TestFlight

1. Collect feedback from testers
2. Fix bugs and issues
3. Build new version: `eas build --platform ios --profile production`
4. Submit update: `eas submit --platform ios`
5. When ready: Submit for App Store review

## Useful Commands

```bash
# Check build status
eas build:list

# View specific build
eas build:view [BUILD_ID]

# Cancel a build
eas build:cancel [BUILD_ID]

# Check submission status
eas submit:list
```



