const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path} from ${req.ip || req.connection.remoteAddress}`);
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${timestamp}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
  });
  
  next();
});

// Middleware - CORS with more permissive settings for ngrok
app.use(cors({
  origin: '*', // Allow all origins (for ngrok)
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning'],
  credentials: false
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Import database first to ensure it's initialized
require('./database');

// Import routes
const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const sessionRoutes = require('./routes/sessions');
const personRoutes = require('./routes/persons');
const queryRoutes = require('./routes/queries');
const transcribeRoutes = require('./routes/transcribe');
const groupRoutes = require('./routes/groups');
const calendarRoutes = require('./routes/calendar');
const metricsRoutes = require('./routes/metrics');

// Root API endpoint
app.get('/api', (req, res) => {
  res.json({
    message: 'ToHim API',
    version: '1.0.0',
    endpoints: {
      health: 'GET /api/health',
      sessions: {
        create: 'POST /api/sessions',
        getByPerson: 'GET /api/sessions/person/:personId'
      },
          persons: {
            getAll: 'GET /api/persons',
            getById: 'GET /api/persons/:id',
            create: 'POST /api/persons',
            update: 'PUT /api/persons/:id'
          },
      queries: {
        ask: 'POST /api/queries'
      },
      auth: {
        register: 'POST /api/auth/register',
        login: 'POST /api/auth/login',
        verify: 'GET /api/auth/verify'
      }
    }
  });
});

// Routes (auth routes don't require authentication)
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/persons', personRoutes);
app.use('/api/queries', queryRoutes);
app.use('/api/transcribe', transcribeRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/metrics', metricsRoutes);

// Log route registration
console.log('Routes registered:');
console.log('  GET  /api');
console.log('  GET  /api/health');
console.log('  POST /api/sessions');
console.log('  GET  /api/sessions/person/:personId');
console.log('  GET  /api/persons');
console.log('  GET  /api/persons/:id');
console.log('  POST /api/persons');
console.log('  POST /api/queries');
console.log('  POST /api/transcribe');
console.log('  GET  /api/metrics/query-latency');

// Health check
app.get('/api/health', (req, res) => {
  const hasApiKey = process.env.OPENAI_API_KEY && 
                    process.env.OPENAI_API_KEY !== 'your_openai_api_key_here';
  res.json({ 
    status: 'ok', 
    message: 'ToHim API is running',
    hasApiKey: hasApiKey,
    timestamp: new Date().toISOString(),
    serverIP: req.socket.localAddress,
    clientIP: req.ip || req.connection.remoteAddress
  });
});

// Test endpoint to verify server is reachable
app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'Server is reachable!',
    method: req.method,
    path: req.path,
    timestamp: new Date().toISOString()
  });
});

// 404 handler for API routes (must be after all other routes)
app.use('/api/*', (req, res) => {
  console.log(`[404] Route not found: ${req.method} ${req.originalUrl}`);
  console.log(`[404] Request headers:`, req.headers);
  res.status(404).json({ 
    error: 'Route not found', 
    method: req.method,
    path: req.originalUrl,
    fullUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
    availableRoutes: [
      'GET /api/health',
      'POST /api/sessions',
      'GET /api/sessions/person/:personId',
      'GET /api/persons',
      'GET /api/persons/:id',
      'POST /api/persons',
      'PUT /api/persons/:id',
      'GET /api/persons/:id/summary',
      'POST /api/queries',
      'POST /api/transcribe',
      'GET /api/metrics/query-latency',
      'POST /api/auth/register',
      'POST /api/auth/login',
      'GET /api/auth/verify'
    ]
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ToHim server running on port ${PORT}`);
  console.log(`Server accessible at http://localhost:${PORT} and http://0.0.0.0:${PORT}`);
  console.log(`Network access: Make sure your device can reach this server on your local network`);
  console.log(`Available routes:`);
  console.log(`  GET  /api/health`);
  console.log(`  POST /api/sessions`);
  console.log(`  GET  /api/sessions/person/:personId`);
      console.log(`  GET  /api/persons`);
      console.log(`  GET  /api/persons/:id`);
      console.log(`  POST /api/persons`);
      console.log(`  PUT  /api/persons/:id`);
      console.log(`  POST /api/queries`);
      console.log(`  POST /api/transcribe`);
      console.log(`  POST /api/auth/register`);
      console.log(`  POST /api/auth/login`);
      console.log(`  GET  /api/auth/verify`);
});

