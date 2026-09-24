const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const userRepo = require('../postgres');
const { JWT_SECRET, authenticateToken } = require('../middleware/auth');

const VERIFICATION_CODE_TTL_MINUTES = 15;
const RESET_CODE_TTL_MINUTES = 15;
const MIN_PASSWORD_LENGTH = 8;
const rateLimitStore = new Map();

function normalizedIp(req) {
  return (req.ip || req.connection?.remoteAddress || 'unknown').toString();
}

function applyRateLimit(req, key, maxAttempts, windowMs) {
  const now = Date.now();
  const bucketKey = `${key}:${normalizedIp(req)}`;
  const existing = rateLimitStore.get(bucketKey);
  if (!existing || existing.expiresAt <= now) {
    rateLimitStore.set(bucketKey, { count: 1, expiresAt: now + windowMs });
    return false;
  }
  existing.count += 1;
  rateLimitStore.set(bucketKey, existing);
  return existing.count > maxAttempts;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function generateNumericCode(length = 6) {
  const max = 10 ** length;
  const min = 10 ** (length - 1);
  return String(Math.floor(Math.random() * (max - min) + min));
}

function hashCode(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

async function sendEmail({
  to,
  subject,
  text,
}) {
  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  const replyToEmail = process.env.RESEND_REPLY_TO_EMAIL;

  // Keep a dev fallback if Resend isn't configured yet.
  if (!resendApiKey || !fromEmail) {
    console.log('[Auth][Email dev fallback] RESEND_API_KEY/RESEND_FROM_EMAIL missing.');
    console.log('[Auth][Email dev fallback] To:', to);
    console.log('[Auth][Email dev fallback] Subject:', subject);
    console.log('[Auth][Email dev fallback] Body:', text);
    return;
  }

  const payload = {
    from: fromEmail,
    to: [to],
    subject,
    text,
  };
  if (replyToEmail) {
    payload.reply_to = [replyToEmail];
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend API error (${response.status}): ${body}`);
  }
}

async function createAndSendVerificationCode(user) {
  const code = generateNumericCode();
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + VERIFICATION_CODE_TTL_MINUTES * 60 * 1000);
  await userRepo.pool.query(
    `
    INSERT INTO email_verification_codes (user_id, code_hash, expires_at)
    VALUES ($1, $2, $3)
    `,
    [user.id, codeHash, expiresAt]
  );
  await sendEmail({
    to: user.email,
    subject: 'Your Tabbe verification code',
    text: `Your Tabbe verification code is ${code}. It expires in ${VERIFICATION_CODE_TTL_MINUTES} minutes.`,
  });
}

async function createAndSendPasswordResetCode(user) {
  const code = generateNumericCode();
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + RESET_CODE_TTL_MINUTES * 60 * 1000);
  await userRepo.pool.query(
    `
    INSERT INTO password_reset_codes (user_id, code_hash, expires_at)
    VALUES ($1, $2, $3)
    `,
    [user.id, codeHash, expiresAt]
  );
  await sendEmail({
    to: user.email,
    subject: 'Your Tabbe password reset code',
    text: `Your Tabbe password reset code is ${code}. It expires in ${RESET_CODE_TTL_MINUTES} minutes.`,
  });
}

// Register new user
router.post('/register', async (req, res) => {
  try {
    if (applyRateLimit(req, 'register', 10, 15 * 60 * 1000)) {
      return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    }
    await userRepo.ensureAuthSchema();
    const { username, email, password, privacyConsentAccepted } = req.body;

    // Validate input
    if (!username || !email || !password) {
      return res.status(400).json({ 
        error: 'Username, email, and password are required' 
      });
    }

    if (username.length < 3) {
      return res.status(400).json({ 
        error: 'Username must be at least 3 characters long' 
      });
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ 
        error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long`
      });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({
        error: 'Please enter a valid email address',
      });
    }
    if (privacyConsentAccepted !== true) {
      return res.status(400).json({
        error: 'You must agree to the privacy policy to create an account',
      });
    }

    // Check if username/email already exists
    const existingUser = await userRepo.getUserByUsername(username);
    if (existingUser) {
      return res.status(409).json({ 
        error: 'Username already exists' 
      });
    }
    const existingEmail = await userRepo.getUserByEmail(email);
    if (existingEmail) {
      return res.status(409).json({
        error: 'Email already exists',
      });
    }

    // Hash password
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // Create user in unverified state
    const user = await userRepo.createUser(username, passwordHash, email.trim(), null, true);
    await createAndSendVerificationCode(user);

    res.status(201).json({
      message: 'Verification code sent to email',
      verificationRequired: true,
      email: user.email,
    });
  } catch (error) {
    console.error('[Auth] Error registering user:', error);
    res.status(500).json({ 
      error: 'Failed to register user',
      details: error.message 
    });
  }
});

router.post('/register/verify-code', async (req, res) => {
  try {
    if (applyRateLimit(req, 'verify-code', 12, 15 * 60 * 1000)) {
      return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    }
    await userRepo.ensureAuthSchema();
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({ error: 'Email and verification code are required' });
    }
    const user = await userRepo.getUserByEmail(email.trim());
    if (!user) return res.status(400).json({ error: 'Invalid verification request' });
    if (user.email_verified) return res.status(400).json({ error: 'Email is already verified' });

    const result = await userRepo.pool.query(
      `
      SELECT id, code_hash, expires_at, used_at
      FROM email_verification_codes
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [user.id]
    );
    const row = result.rows[0];
    if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: 'Verification code is invalid or expired' });
    }
    if (hashCode(code.trim()) !== row.code_hash) {
      return res.status(400).json({ error: 'Verification code is invalid or expired' });
    }

    await userRepo.pool.query(
      `UPDATE email_verification_codes SET used_at = NOW() WHERE id = $1`,
      [row.id]
    );
    await userRepo.markUserEmailVerified(user.id);

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({
      message: 'Email verified successfully',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        onboarding_completed: user.onboarding_completed,
        privacy_consent_given: user.privacy_consent_given === true,
        name: user.name,
      },
      token,
      needsProfileSetup: !user.name,
    });
  } catch (error) {
    console.error('[Auth] Error verifying email code:', error);
    res.status(500).json({ error: 'Failed to verify email code', details: error.message });
  }
});

router.post('/register/resend-code', async (req, res) => {
  try {
    if (applyRateLimit(req, 'resend-code', 8, 15 * 60 * 1000)) {
      return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    }
    await userRepo.ensureAuthSchema();
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });
    const user = await userRepo.getUserByEmail(email.trim());
    if (!user) {
      return res.json({ message: 'If an account exists, a code was sent' });
    }
    if (user.email_verified) {
      return res.status(400).json({ error: 'Email is already verified' });
    }
    await createAndSendVerificationCode(user);
    res.json({ message: 'Verification code resent' });
  } catch (error) {
    console.error('[Auth] Error resending verification code:', error);
    res.status(500).json({ error: 'Failed to resend code', details: error.message });
  }
});

// Login user
router.post('/login', async (req, res) => {
  try {
    if (applyRateLimit(req, 'login', 20, 15 * 60 * 1000)) {
      return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    }
    await userRepo.ensureAuthSchema();
    const { username, password } = req.body;
    const identifier = String(username || '').trim();
    console.log('[Auth] Login attempt received');

    // Validate input
    if (!identifier || !password) {
      console.log('[Auth] Login failed: Missing username or password');
      return res.status(400).json({ 
        error: 'Username and password are required' 
      });
    }

    // Find user
    const user = await userRepo.getUserByUsernameOrEmail(identifier);
    if (!user) {
      console.log('[Auth] Login failed: User not found', {
        identifier,
        host: req.get('host'),
      });
      return res.status(401).json({ 
        error: 'Invalid username or password' 
      });
    }
    const emailVerificationPending = Boolean(user.email && !user.email_verified);

    // Verify password
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      console.log('[Auth] Login failed: Password mismatch', {
        userId: user.id,
        identifier,
        host: req.get('host'),
      });
      return res.status(401).json({ 
        error: 'Invalid username or password' 
      });
    }

    console.log('[Auth] Login successful for user:', user.id);

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const responsePayload = {
      message: 'Login successful',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        needs_email_setup: !user.email,
        email_verification_pending: emailVerificationPending,
        onboarding_completed: user.onboarding_completed,
        privacy_consent_given: user.privacy_consent_given === true,
        name: user.name
      },
      token
    };
    if (emailVerificationPending) {
      responsePayload.email_notice =
        'Email is not verified yet. Login is allowed; verification is optional but recommended for account recovery.';
    }
    res.json(responsePayload);
  } catch (error) {
    console.error('[Auth] Error logging in user:', error);
    res.status(500).json({ 
      error: 'Failed to login',
      details: error.message 
    });
  }
});

router.post('/password-reset/request', async (req, res) => {
  try {
    if (applyRateLimit(req, 'password-reset-request', 8, 15 * 60 * 1000)) {
      return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    }
    await userRepo.ensureAuthSchema();
    const { identifier } = req.body;
    if (!identifier) {
      return res.status(400).json({ error: 'Username or email is required' });
    }
    const user = await userRepo.getUserByUsernameOrEmail(identifier.trim());
    if (user && user.email) {
      await createAndSendPasswordResetCode(user);
    }
    res.json({ message: 'If the account exists, a reset code has been sent to the email on file' });
  } catch (error) {
    console.error('[Auth] Error requesting password reset:', error);
    res.status(500).json({ error: 'Failed to request password reset', details: error.message });
  }
});

router.post('/password-reset/confirm', async (req, res) => {
  try {
    if (applyRateLimit(req, 'password-reset-confirm', 12, 15 * 60 * 1000)) {
      return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    }
    await userRepo.ensureAuthSchema();
    const { identifier, code, newPassword } = req.body;
    if (!identifier || !code || !newPassword) {
      return res.status(400).json({ error: 'Identifier, code, and new password are required' });
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long` });
    }
    const user = await userRepo.getUserByUsernameOrEmail(identifier.trim());
    if (!user) {
      return res.status(400).json({ error: 'Invalid reset request' });
    }

    const result = await userRepo.pool.query(
      `
      SELECT id, code_hash, expires_at, used_at
      FROM password_reset_codes
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [user.id]
    );
    const row = result.rows[0];
    if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: 'Reset code is invalid or expired' });
    }
    if (hashCode(code.trim()) !== row.code_hash) {
      return res.status(400).json({ error: 'Reset code is invalid or expired' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await userRepo.updateUserPassword(user.id, newHash);
    await userRepo.pool.query(
      `UPDATE password_reset_codes SET used_at = NOW() WHERE id = $1`,
      [row.id]
    );
    res.json({ message: 'Password reset successful' });
  } catch (error) {
    console.error('[Auth] Error confirming password reset:', error);
    res.status(500).json({ error: 'Failed to reset password', details: error.message });
  }
});

router.post('/email-upgrade/request-code', authenticateToken, async (req, res) => {
  try {
    if (applyRateLimit(req, 'email-upgrade-request', 8, 15 * 60 * 1000)) {
      return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    }
    await userRepo.ensureAuthSchema();
    const { email } = req.body;
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ error: 'A valid email is required' });
    }

    const currentUser = await userRepo.getUserById(req.user.id);
    if (!currentUser) {
      return res.status(401).json({ error: 'User not found' });
    }
    if (currentUser.email) {
      return res.status(400).json({ error: 'This account already has an email.' });
    }

    const existingEmail = await userRepo.getUserByEmail(email.trim());
    if (existingEmail) {
      return res.status(409).json({ error: 'Email already exists' });
    }

    const updatedUser = await userRepo.updateUserEmail(req.user.id, email.trim());
    await createAndSendVerificationCode(updatedUser);
    res.json({ message: 'Verification code sent to email' });
  } catch (error) {
    console.error('[Auth] Error requesting email upgrade code:', error);
    res.status(500).json({ error: 'Failed to send verification code', details: error.message });
  }
});

router.post('/email-upgrade/verify-code', authenticateToken, async (req, res) => {
  try {
    if (applyRateLimit(req, 'email-upgrade-verify', 12, 15 * 60 * 1000)) {
      return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    }
    await userRepo.ensureAuthSchema();
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Verification code is required' });

    const user = await userRepo.getUserById(req.user.id);
    if (!user || !user.email) {
      return res.status(400).json({ error: 'No email found for this account' });
    }
    if (user.email_verified) {
      return res.json({ success: true, user });
    }

    const result = await userRepo.pool.query(
      `
      SELECT id, code_hash, expires_at, used_at
      FROM email_verification_codes
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [user.id]
    );
    const row = result.rows[0];
    if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: 'Verification code is invalid or expired' });
    }
    if (hashCode(code.trim()) !== row.code_hash) {
      return res.status(400).json({ error: 'Verification code is invalid or expired' });
    }

    await userRepo.pool.query(
      `UPDATE email_verification_codes SET used_at = NOW() WHERE id = $1`,
      [row.id]
    );
    await userRepo.markUserEmailVerified(user.id);
    const refreshed = await userRepo.getUserById(user.id);
    res.json({ success: true, user: refreshed });
  } catch (error) {
    console.error('[Auth] Error verifying email upgrade code:', error);
    res.status(500).json({ error: 'Failed to verify code', details: error.message });
  }
});

router.post('/onboarding/complete', authenticateToken, async (req, res) => {
  try {
    await userRepo.ensureAuthSchema();
    await userRepo.markOnboardingCompleted(req.user.id);
    res.json({ success: true });
  } catch (error) {
    console.error('[Auth] Error marking onboarding complete:', error);
    res.status(500).json({ error: 'Failed to update onboarding status', details: error.message });
  }
});

router.post('/privacy-consent', authenticateToken, async (req, res) => {
  try {
    await userRepo.ensureAuthSchema();
    const user = await userRepo.markPrivacyConsentGiven(req.user.id);
    return res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        onboarding_completed: user.onboarding_completed,
        privacy_consent_given: user.privacy_consent_given === true,
        name: user.name,
      },
    });
  } catch (error) {
    console.error('[Auth] Error recording privacy consent:', error);
    return res.status(500).json({
      error: 'Failed to record privacy consent',
      details: error.message,
    });
  }
});

// Verify token (optional endpoint to check if token is valid)
router.get('/verify', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Token required' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await userRepo.getUserById(decoded.userId);

    if (!user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    res.json({
      valid: true,
      user: {
        id: user.id,
        username: user.username,
        onboarding_completed: user.onboarding_completed,
        privacy_consent_given: user.privacy_consent_given === true,
        name: user.name
      }
    });
  } catch (error) {
    res.status(401).json({ 
      valid: false,
      error: 'Invalid or expired token' 
    });
  }
});

module.exports = router;
