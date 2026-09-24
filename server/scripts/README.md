# Database Migration Scripts

## normalize-all-dates.js

This script normalizes all relative dates in existing ToHim data to absolute dates.

### What it does:
1. **Session Notes**: Normalizes relative dates (like "tomorrow", "next week") in all session notes to absolute dates based on when each session was created
2. **Metadata**: Normalizes relative dates in person metadata to absolute dates

### How to run:

```bash
cd server
node scripts/normalize-all-dates.js
```

### What gets normalized:
- Session notes containing relative dates like:
  - "tomorrow", "yesterday", "today"
  - "next week", "last week", "this week"
  - "in 3 days", "in a few days"
  - "next month", "last month"
  - etc.

- Metadata entries with relative dates (only `date` and `date_original` keys)

### Notes:
- The script uses the session creation date as the reference point for normalization
- Already normalized dates (containing YYYY-MM-DD format) are skipped
- The script is safe to run multiple times - it only processes entries that need normalization
