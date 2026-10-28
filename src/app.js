const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
dotenv.config();
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

app.use((req, res, next) => {
  req.url = req.url.replace(/^\/{2,}(?=api\/)/, '/');
  next();
});
app.use(helmet());
app.use(cors({
  origin: process.env.CLIENT_URL
    ? process.env.CLIENT_URL.split(',').map(url => url.trim())
    : true,
  credentials: true,
}));

app.use(express.json({ limit: '1mb' }));

if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev', {
    skip: (req) => req.path.startsWith('/api/location'),
  }));
}
// brute-force protection on login/register
app.use('/api/auth', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({
    success: false,
    message: 'Too many requests. Please try again later.',
  }),
}));

app.use('/api/location', rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({
    success: false,
    message: 'Too many location requests. Please try again later.',
  }),
}));

app.get('/api/health', (req, res) => res.json({ success: true, message: 'Project Service API running' }));
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/location', require('./routes/locationRoutes'));
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/services', require('./routes/serviceRoutes'));
app.use('/api/providers', require('./routes/providerRoutes'));
const workerRegistrationRoutes = require('./routes/workerRegistrationRoutes');
app.use('/api/worker_registration', workerRegistrationRoutes);
// app.use('/api/wroker_registration', workerRegistrationRoutes);
app.use('/api/bookings', require('./routes/bookingRoutes'));
app.use('/api/payments', require('./routes/paymentRoutes'));
app.use('/api/reviews', require('./routes/reviewRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
