const jwt = require('jsonwebtoken');
const userRepo = require('../postgres');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Middleware to verify JWT token
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Verify user still exists (in Postgres)
    const user = await userRepo.getUserById(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: 'Invalid token - user not found' });
    }

    // Attach user info to request
    req.user = {
      id: user.id,
      username: user.username,
      name: user.name,
      privacyConsentGiven: user.privacy_consent_given === true,
    };

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    console.error('[Auth] Error authenticating token:', error);
    return res.status(500).json({ error: 'Authentication error' });
  }
};

const requirePrivacyConsent = (req, res, next) => {
  if (req.user?.privacyConsentGiven === true) {
    return next();
  }
  return res.status(403).json({
    error: 'Privacy policy consent required',
    details: 'You must agree to Tabbe privacy policy before using this feature.',
    code: 'PRIVACY_CONSENT_REQUIRED',
  });
};

module.exports = { authenticateToken, requirePrivacyConsent, JWT_SECRET };
