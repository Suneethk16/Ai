import express from 'express';
import cors from 'cors';
import pg from 'pg';
import crypto from 'crypto';

const { Pool } = pg;
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// PostgreSQL connection with better error handling
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:@localhost:5432/ai_study_companion',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// For local development, ensure database exists
if (!process.env.DATABASE_URL) {
  console.log('Using local PostgreSQL: postgresql://postgres:@localhost:5432/ai_study_companion');
  console.log('Make sure to create database: CREATE DATABASE ai_study_companion;');
}

// Test connection
pool.on('connect', () => {
  console.log('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('PostgreSQL connection error:', err);
  if (err.code === 'EPIPE') {
    console.log('Connection pipe broken, will reconnect automatically');
  }
});

process.on('SIGINT', () => {
  pool.end();
  process.exit(0);
});

process.on('SIGTERM', () => {
  pool.end();
  process.exit(0);
});

// In-memory fallback storage
let memoryData = { users: {}, quizSessions: [], activities: [] };
let usePostgres = false;

// Initialize database tables
const initDB = async () => {
  try {
    // Test connection first
    await pool.query('SELECT NOW()');
    console.log('PostgreSQL connection successful');
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        email_verified BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP
      )
    `);
    
    // Add email_verified column if it doesn't exist
    try {
      await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE');
    } catch (err) {
      console.log('Column email_verified already exists or error:', err.message);
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS email_otps (
        id SERIAL PRIMARY KEY,
        email VARCHAR(100) NOT NULL,
        otp VARCHAR(6) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS quiz_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        topic VARCHAR(255) NOT NULL,
        total_questions INTEGER NOT NULL,
        correct_answers INTEGER NOT NULL,
        score_percentage INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS activities (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        action VARCHAR(50) NOT NULL,
        data JSONB,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        payment_id VARCHAR(255) NOT NULL,
        order_id VARCHAR(255) NOT NULL,
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Add is_premium column to users table
    try {
      await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS is_premium BOOLEAN DEFAULT FALSE');
    } catch (err) {
      console.log('Column is_premium already exists or error:', err.message);
    }

    usePostgres = true;
    console.log('PostgreSQL database initialized successfully');
  } catch (err) {
    console.error('Database initialization error:', err);
    console.log('Using in-memory storage as fallback');
    usePostgres = false;
  }
};

// Initialize database on startup
initDB();

// API Routes
// Generate OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Send OTP via Gmail SMTP (primary) with Resend fallback
const sendOTP = async (email, otp) => {
  // Try Gmail SMTP first
  try {
    console.log('Attempting to send email via Gmail SMTP...');
    console.log('Target email:', email);
    console.log('OTP:', otp);
    
    if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
      throw new Error('Gmail credentials not configured, trying Resend...');
    }
    
    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.default.createTransporter({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS
      }
    });
    
    const mailOptions = {
      from: `"AI Study Companion" <${process.env.GMAIL_USER}>`,
      to: email,
      subject: 'Email Verification - AI Study Companion',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1 style="color: #667eea; text-align: center;">🎓 AI Study Companion</h1>
          <h2 style="color: #333;">Email Verification Required</h2>
          <p style="font-size: 16px; color: #555;">Please use this verification code to complete your registration:</p>
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; font-size: 28px; font-weight: bold; margin: 20px 0; border-radius: 10px; letter-spacing: 3px;">
            ${otp}
          </div>
          <p style="color: #666; font-size: 14px;">⏰ This code expires in 10 minutes</p>
          <p style="color: #666; font-size: 14px;">If you didn't request this verification, please ignore this email.</p>
          <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;">
          <p style="font-size: 12px; color: #999; text-align: center;">Developed by suneethk176 | AI Study Companion</p>
        </div>
      `
    };
    
    await transporter.sendMail(mailOptions);
    console.log(`✅ OTP sent via Gmail to ${email}: ${otp}`);
    return true;
    
  } catch (gmailError) {
    console.error('❌ Gmail failed:', gmailError.message);
    
    // Try Resend as fallback
    try {
      console.log('Trying Resend as fallback...');
      
      if (!process.env.RESEND_API_KEY) {
        throw new Error('RESEND_API_KEY not configured');
      }
    
    const emailData = {
      from: 'AI Study Companion <noreply@suneethk176.site>',
      to: [email],
      subject: 'Email Verification - AI Study Companion',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1 style="color: #667eea; text-align: center;">🎓 AI Study Companion</h1>
          <h2 style="color: #333;">Email Verification Required</h2>
          <p style="font-size: 16px; color: #555;">Please use this verification code to complete your registration:</p>
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; text-align: center; font-size: 28px; font-weight: bold; margin: 20px 0; border-radius: 10px; letter-spacing: 3px;">
            ${otp}
          </div>
          <p style="color: #666; font-size: 14px;">⏰ This code expires in 10 minutes</p>
          <p style="color: #666; font-size: 14px;">If you didn't request this verification, please ignore this email.</p>
          <hr style="margin: 20px 0; border: none; border-top: 1px solid #eee;">
          <p style="font-size: 12px; color: #999; text-align: center;">Developed by suneethk176 | AI Study Companion</p>
        </div>
      `
    };
    
    console.log('Sending email with data:', JSON.stringify(emailData, null, 2));
    
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(emailData)
    });
    
    const responseData = await response.json();
    console.log('Resend response status:', response.status);
    console.log('Resend response:', JSON.stringify(responseData, null, 2));
    
    if (response.ok) {
      console.log(`✅ OTP sent successfully to ${email}: ${otp}`);
      console.log('Email ID:', responseData.id);
      return true;
    } else {
      console.error(`❌ Resend API failed: ${response.status}`);
      console.error('Error details:', responseData);
      
      // Check for specific error types
      if (responseData.message && responseData.message.includes('blocked')) {
        console.error('Email blocked - possible spam filter or invalid email');
      }
      if (responseData.message && responseData.message.includes('bounce')) {
        console.error('Email bounced - invalid or non-existent email address');
      }
      
      throw new Error(`Resend failed: ${response.status} - ${JSON.stringify(responseData)}`);
    }
    } catch (resendError) {
      console.error('❌ Resend fallback failed:', resendError.message);
      console.log('='.repeat(50));
      console.log(`📧 FALLBACK - OTP for ${email}: ${otp}`);
      console.log('='.repeat(50));
      return false;
    }
  }
};

app.post('/api/send-otp', async (req, res) => {
  try {
    const { email } = req.body;
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    
    console.log(`Generating OTP for ${email}: ${otp}`);
    
    if (usePostgres) {
      // Clean up expired OTPs first
      await pool.query('DELETE FROM email_otps WHERE expires_at < NOW()');
      // Delete old OTPs for this email
      await pool.query('DELETE FROM email_otps WHERE email = $1', [email]);
      // Insert new OTP
      await pool.query(
        'INSERT INTO email_otps (email, otp, expires_at) VALUES ($1, $2, $3)',
        [email, otp, expiresAt]
      );
      console.log(`OTP stored in PostgreSQL for ${email}`);
    } else {
      // Memory storage
      if (!memoryData.emailOtps) memoryData.emailOtps = [];
      // Clean up expired OTPs
      const now = new Date();
      memoryData.emailOtps = memoryData.emailOtps.filter(o => new Date(o.expires_at) > now);
      // Remove old OTPs for this email
      memoryData.emailOtps = memoryData.emailOtps.filter(o => o.email !== email);
      // Add new OTP
      memoryData.emailOtps.push({
        id: Date.now().toString(),
        email,
        otp,
        expires_at: expiresAt.toISOString(),
        created_at: new Date().toISOString()
      });
      console.log(`OTP stored in memory for ${email}`);
    }
    
    const emailSent = await sendOTP(email, otp);
    
    if (emailSent) {
      res.json({ 
        success: true, 
        message: 'OTP sent to your email! Check your inbox and spam folder.',
        emailSent: true
      });
    } else {
      res.json({ 
        success: true, 
        message: 'Email service temporarily unavailable. Your OTP is: ' + otp,
        emailSent: false,
        otp: otp
      });
    }
  } catch (err) {
    console.error('Send OTP error:', err);
    const otp = generateOTP();
    console.log(`📧 FALLBACK OTP for ${req.body.email}: ${otp}`);
    res.json({ success: true, message: 'Email service error. Your OTP is: ' + otp, otp: otp });
  }
});

app.post('/api/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    
    console.log(`Verifying OTP for ${email}: ${otp}`);
    
    if (!email || !otp) {
      return res.status(400).json({ success: false, error: 'Email and OTP are required' });
    }
    
    if (otp.length !== 6) {
      return res.status(400).json({ success: false, error: 'OTP must be 6 digits' });
    }
    
    if (usePostgres) {
      // First check if there's a valid OTP
      const result = await pool.query(
        'SELECT id FROM email_otps WHERE email = $1 AND otp = $2 AND expires_at > NOW()',
        [email, otp]
      );
      
      console.log(`PostgreSQL OTP check: found ${result.rows.length} matching records`);
      
      if (result.rows.length === 0) {
        // Check if there's any OTP for this email (expired or wrong)
        const anyOtp = await pool.query('SELECT otp, expires_at FROM email_otps WHERE email = $1 ORDER BY created_at DESC LIMIT 1', [email]);
        console.log(`Found ${anyOtp.rows.length} OTP records for ${email}`);
        
        if (anyOtp.rows.length === 0) {
          return res.status(400).json({ success: false, error: 'No OTP found. Please request a new one.' });
        } else {
          const otpRecord = anyOtp.rows[0];
          if (new Date(otpRecord.expires_at) <= new Date()) {
            return res.status(400).json({ success: false, error: 'OTP expired. Please request a new one.' });
          } else {
            return res.status(400).json({ success: false, error: 'Wrong OTP. Please check and try again.' });
          }
        }
      }
      
      // Delete only the specific OTP that was verified
      const otpId = result.rows[0].id;
      await pool.query('DELETE FROM email_otps WHERE id = $1', [otpId]);
      console.log(`OTP verified and deleted for ${email} (ID: ${otpId})`);
    } else {
      // Memory storage
      console.log('Checking memory storage for OTP...');
      console.log('Available OTPs:', memoryData.emailOtps);
      
      const otpRecord = memoryData.emailOtps?.find(o => 
        o.email === email && o.otp === otp && new Date(o.expires_at) > new Date()
      );
      
      if (!otpRecord) {
        // Check if there's any OTP for this email
        const anyOtp = memoryData.emailOtps?.find(o => o.email === email);
        if (!anyOtp) {
          return res.status(400).json({ success: false, error: 'No OTP found. Please request a new one.' });
        } else if (new Date(anyOtp.expires_at) <= new Date()) {
          return res.status(400).json({ success: false, error: 'OTP expired. Please request a new one.' });
        } else {
          return res.status(400).json({ success: false, error: 'Wrong OTP. Please check and try again.' });
        }
      }
      
      // Remove only the specific OTP that was verified
      memoryData.emailOtps = memoryData.emailOtps.filter(o => o.id !== otpRecord.id);
      console.log(`OTP verified and removed for ${email} (ID: ${otpRecord.id})`);
    }
    
    res.json({ success: true, message: 'Email verified successfully' });
  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ success: false, error: 'Failed to verify OTP' });
  }
});

app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password, emailVerified } = req.body;
    console.log('Registration attempt:', { username, email, emailVerified, usePostgres });
    
    // Basic validation
    if (!username || !email || !password) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }
    
    if (username.length < 3) {
      return res.status(400).json({ success: false, error: 'Username must be at least 3 characters' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    }
    
    if (usePostgres) {
      // Check if user already exists
      const existingUser = await pool.query('SELECT id FROM users WHERE username = $1 OR email = $2', [username, email]);
      if (existingUser.rows.length > 0) {
        return res.status(400).json({ success: false, error: 'Username or email already exists' });
      }
      
      const result = await pool.query(
        'INSERT INTO users (username, email, password, email_verified) VALUES ($1, $2, $3, $4) RETURNING id, username, email, email_verified, created_at',
        [username, email, password, emailVerified || false]
      );
      console.log('User registered in PostgreSQL:', result.rows[0]);
      res.json({ success: true, user: result.rows[0], message: 'Registration successful!' });
    } else {
      // Fallback to memory
      const existingUser = Object.values(memoryData.users).find(u => u.username === username || u.email === email);
      if (existingUser) {
        return res.status(400).json({ success: false, error: 'Username or email already exists' });
      }
      const userId = Date.now().toString();
      const user = {
        id: userId,
        username,
        email,
        password,
        email_verified: emailVerified || false,
        created_at: new Date().toISOString()
      };
      memoryData.users[userId] = user;
      if (!memoryData.emailOtps) memoryData.emailOtps = [];
      console.log('User registered in memory:', user);
      res.json({ success: true, user, message: 'Registration successful!' });
    }
  } catch (err) {
    console.error('Registration error:', err);
    console.error('Error details:', err.message);
    console.error('Error stack:', err.stack);
    res.status(500).json({ success: false, error: err.message || 'Registration failed. Please try again.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    console.log('Login attempt:', { username, usePostgres });
    
    if (usePostgres) {
      const result = await pool.query('SELECT * FROM users WHERE username = $1 AND password = $2', [username, password]);
      if (result.rows.length > 0) {
        const user = result.rows[0];
        await pool.query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);
        console.log('User logged in via PostgreSQL:', user.username);
        res.json({ success: true, user: { id: user.id, username: user.username, email: user.email } });
      } else {
        res.status(401).json({ success: false, error: 'Invalid credentials' });
      }
    } else {
      // Fallback to memory
      const user = Object.values(memoryData.users).find(u => u.username === username && u.password === password);
      if (user) {
        console.log('User logged in via memory:', user.username);
        res.json({ success: true, user: { id: user.id, username: user.username, email: user.email } });
      } else {
        res.status(401).json({ success: false, error: 'Invalid credentials' });
      }
    }
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, error: 'Login failed' });
  }
});

app.post('/api/quiz-result', async (req, res) => {
  try {
    const { userId, topic, totalQuestions, correctAnswers, scorePercentage } = req.body;
    console.log('Saving quiz result:', { userId, topic, totalQuestions, correctAnswers, scorePercentage, usePostgres });
    
    if (usePostgres) {
      await pool.query(
        'INSERT INTO quiz_sessions (user_id, topic, total_questions, correct_answers, score_percentage) VALUES ($1, $2, $3, $4, $5)',
        [userId, topic, totalQuestions, correctAnswers, scorePercentage]
      );
      console.log('Quiz result saved to PostgreSQL');
    } else {
      // Fallback to memory
      memoryData.quizSessions.push({
        id: Date.now().toString(),
        user_id: userId,
        topic,
        total_questions: totalQuestions,
        correct_answers: correctAnswers,
        score_percentage: scorePercentage,
        created_at: new Date().toISOString()
      });
      console.log('Quiz result saved to memory');
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Quiz result save error:', err);
    res.status(500).json({ success: false, error: 'Failed to save quiz result' });
  }
});

app.get('/api/quiz-history/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await pool.query(
      'SELECT * FROM quiz_sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10',
      [userId]
    );
    res.json({ success: true, quizzes: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to get quiz history' });
  }
});

app.post('/api/activity', async (req, res) => {
  try {
    const { userId, action, data } = req.body;
    await pool.query(
      'INSERT INTO activities (user_id, action, data) VALUES ($1, $2, $3)',
      [userId, action, JSON.stringify(data)]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to log activity' });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    if (usePostgres) {
      const result = await pool.query('SELECT id, username, email, created_at, last_login FROM users');
      res.json({ success: true, users: result.rows, storage: 'postgresql' });
    } else {
      res.json({ success: true, users: Object.values(memoryData.users), storage: 'memory' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to get users' });
  }
});

// Debug endpoint to check OTP status
app.get('/api/debug-otp/:email', async (req, res) => {
  try {
    const { email } = req.params;
    
    if (usePostgres) {
      const result = await pool.query('SELECT otp, expires_at, created_at FROM email_otps WHERE email = $1 ORDER BY created_at DESC', [email]);
      res.json({ 
        success: true, 
        email: email,
        otps: result.rows,
        storage: 'postgresql'
      });
    } else {
      const otps = memoryData.emailOtps?.filter(o => o.email === email) || [];
      res.json({ 
        success: true, 
        email: email,
        otps: otps,
        storage: 'memory'
      });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Debug endpoint to check all data
app.get('/api/debug', async (req, res) => {
  try {
    if (usePostgres) {
      const users = await pool.query('SELECT id, username, email, created_at, last_login FROM users');
      const quizzes = await pool.query('SELECT q.*, u.username FROM quiz_sessions q LEFT JOIN users u ON q.user_id = u.id ORDER BY q.created_at DESC');
      const activities = await pool.query('SELECT a.*, u.username FROM activities a LEFT JOIN users u ON a.user_id = u.id ORDER BY a.timestamp DESC');
      
      res.json({
        success: true,
        storage: 'postgresql',
        data: {
          users: users.rows,
          quizzes: quizzes.rows,
          activities: activities.rows
        },
        counts: {
          users: users.rows.length,
          quizzes: quizzes.rows.length,
          activities: activities.rows.length
        }
      });
    } else {
      res.json({
        success: true,
        storage: 'memory',
        data: memoryData,
        counts: {
          users: Object.keys(memoryData.users).length,
          quizzes: memoryData.quizSessions.length,
          activities: memoryData.activities.length
        }
      });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete endpoints
app.delete('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (usePostgres) {
      await pool.query('DELETE FROM activities WHERE user_id = $1', [id]);
      await pool.query('DELETE FROM quiz_sessions WHERE user_id = $1', [id]);
      await pool.query('DELETE FROM users WHERE id = $1', [id]);
    } else {
      delete memoryData.users[id];
      memoryData.activities = memoryData.activities.filter(a => a.user_id !== id);
      memoryData.quizSessions = memoryData.quizSessions.filter(q => q.user_id !== id);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to delete user' });
  }
});

app.delete('/api/quiz-sessions/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (usePostgres) {
      await pool.query('DELETE FROM quiz_sessions WHERE id = $1', [id]);
    } else {
      memoryData.quizSessions = memoryData.quizSessions.filter(q => q.id !== id);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to delete quiz session' });
  }
});

app.delete('/api/activities/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (usePostgres) {
      await pool.query('DELETE FROM activities WHERE id = $1', [id]);
    } else {
      memoryData.activities = memoryData.activities.filter(a => a.id !== id);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to delete activity' });
  }
});

app.delete('/api/clear-all', async (req, res) => {
  try {
    if (usePostgres) {
      await pool.query('DELETE FROM activities');
      await pool.query('DELETE FROM quiz_sessions');
      await pool.query('DELETE FROM users');
    } else {
      memoryData = { users: {}, quizSessions: [], activities: [] };
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to clear all data' });
  }
});

// Admin page route
app.get('/admin', (req, res) => {
  res.send(`<!DOCTYPE html>
<html><head><title>Database Admin</title><script src="https://unpkg.com/react@18/umd/react.production.min.js"></script><script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script><script src="https://cdn.tailwindcss.com"></script></head>
<body><div id="root"></div><script>
const {useState, useEffect} = React;

function AdminPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('users');
  
  const loadData = async () => {
    try {
      const res = await fetch('/api/debug');
      const result = await res.json();
      setData(result);
    } catch (err) {
      console.error('Failed to load data:', err);
    }
    setLoading(false);
  };
  
  const deleteItem = async (type, id) => {
    if (!confirm('Are you sure you want to delete this item?')) return;
    try {
      await fetch('/api/' + type + '/' + id, { method: 'DELETE' });
      loadData();
    } catch (err) {
      alert('Failed to delete item');
    }
  };
  
  const clearAll = async () => {
    if (!confirm('Are you sure you want to delete ALL data? This cannot be undone!')) return;
    try {
      await fetch('/api/clear-all', { method: 'DELETE' });
      loadData();
    } catch (err) {
      alert('Failed to clear data');
    }
  };
  
  useEffect(() => {
    loadData();
  }, []);
  
  if (loading) {
    return React.createElement('div', {className: 'min-h-screen bg-gray-100 flex items-center justify-center'},
      React.createElement('div', {className: 'text-center'},
        React.createElement('div', {className: 'animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500 mx-auto mb-4'}),
        React.createElement('p', {className: 'text-gray-600'}, 'Loading database data...')
      )
    );
  }
  
  return React.createElement('div', {className: 'min-h-screen bg-gray-100 p-6'},
    React.createElement('div', {className: 'max-w-7xl mx-auto'},
      React.createElement('header', {className: 'mb-8'},
        React.createElement('h1', {className: 'text-4xl font-bold text-gray-800 mb-2'}, 'Database Admin Panel'),
        React.createElement('div', {className: 'flex justify-between items-center'},
          React.createElement('p', {className: 'text-gray-600'}, 'Storage: ' + (data?.storage || 'unknown')),
          React.createElement('div', {className: 'space-x-4'},
            React.createElement('button', {onClick: loadData, className: 'px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600'}, 'Refresh'),
            React.createElement('button', {onClick: clearAll, className: 'px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600'}, 'Clear All Data'),
            React.createElement('a', {href: '/', className: 'px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600'}, 'Back to App')
          )
        )
      ),
      
      // Stats
      React.createElement('div', {className: 'grid grid-cols-3 gap-6 mb-8'},
        React.createElement('div', {className: 'bg-white p-6 rounded-lg shadow'},
          React.createElement('h3', {className: 'text-lg font-semibold text-gray-700'}, 'Users'),
          React.createElement('p', {className: 'text-3xl font-bold text-blue-600'}, data?.counts?.users || 0)
        ),
        React.createElement('div', {className: 'bg-white p-6 rounded-lg shadow'},
          React.createElement('h3', {className: 'text-lg font-semibold text-gray-700'}, 'Quiz Sessions'),
          React.createElement('p', {className: 'text-3xl font-bold text-green-600'}, data?.counts?.quizzes || 0)
        ),
        React.createElement('div', {className: 'bg-white p-6 rounded-lg shadow'},
          React.createElement('h3', {className: 'text-lg font-semibold text-gray-700'}, 'Activities'),
          React.createElement('p', {className: 'text-3xl font-bold text-purple-600'}, data?.counts?.activities || 0)
        )
      ),
      
      // Tabs
      React.createElement('div', {className: 'mb-6'},
        React.createElement('div', {className: 'flex space-x-1 bg-white rounded-lg p-1 shadow'},
          ['users', 'quiz-sessions', 'activities'].map(tab =>
            React.createElement('button', {
              key: tab,
              onClick: () => setActiveTab(tab),
              className: 'px-6 py-2 rounded-md font-medium ' + (activeTab === tab ? 'bg-purple-500 text-white' : 'text-gray-600 hover:bg-gray-100')
            }, tab.charAt(0).toUpperCase() + tab.slice(1).replace('-', ' '))
          )
        )
      ),
      
      // Content
      React.createElement('div', {className: 'bg-white rounded-lg shadow overflow-hidden'},
        activeTab === 'users' && React.createElement('div', null,
          React.createElement('div', {className: 'px-6 py-4 border-b'},
            React.createElement('h2', {className: 'text-xl font-semibold'}, 'Users (' + (data?.data?.users?.length || 0) + ')')
          ),
          React.createElement('div', {className: 'overflow-x-auto'},
            React.createElement('table', {className: 'w-full'},
              React.createElement('thead', {className: 'bg-gray-50'},
                React.createElement('tr', null,
                  React.createElement('th', {className: 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'}, 'ID'),
                  React.createElement('th', {className: 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'}, 'Username'),
                  React.createElement('th', {className: 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'}, 'Email'),
                  React.createElement('th', {className: 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'}, 'Created'),
                  React.createElement('th', {className: 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'}, 'Actions')
                )
              ),
              React.createElement('tbody', {className: 'divide-y divide-gray-200'},
                data?.data?.users?.map(user =>
                  React.createElement('tr', {key: user.id},
                    React.createElement('td', {className: 'px-6 py-4 text-sm text-gray-900'}, user.id),
                    React.createElement('td', {className: 'px-6 py-4 text-sm font-medium text-gray-900'}, user.username),
                    React.createElement('td', {className: 'px-6 py-4 text-sm text-gray-900'}, user.email),
                    React.createElement('td', {className: 'px-6 py-4 text-sm text-gray-900'}, new Date(user.created_at).toLocaleDateString()),
                    React.createElement('td', {className: 'px-6 py-4 text-sm'},
                      React.createElement('button', {
                        onClick: () => deleteItem('users', user.id),
                        className: 'text-red-600 hover:text-red-900'
                      }, 'Delete')
                    )
                  )
                )
              )
            )
          )
        ),
        
        activeTab === 'quiz-sessions' && React.createElement('div', null,
          React.createElement('div', {className: 'px-6 py-4 border-b'},
            React.createElement('h2', {className: 'text-xl font-semibold'}, 'Quiz Sessions (' + (data?.data?.quizzes?.length || 0) + ')')
          ),
          React.createElement('div', {className: 'overflow-x-auto'},
            React.createElement('table', {className: 'w-full'},
              React.createElement('thead', {className: 'bg-gray-50'},
                React.createElement('tr', null,
                  React.createElement('th', {className: 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'}, 'ID'),
                  React.createElement('th', {className: 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'}, 'User'),
                  React.createElement('th', {className: 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'}, 'Topic'),
                  React.createElement('th', {className: 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'}, 'Score'),
                  React.createElement('th', {className: 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'}, 'Date'),
                  React.createElement('th', {className: 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'}, 'Actions')
                )
              ),
              React.createElement('tbody', {className: 'divide-y divide-gray-200'},
                data?.data?.quizzes?.map(quiz =>
                  React.createElement('tr', {key: quiz.id},
                    React.createElement('td', {className: 'px-6 py-4 text-sm text-gray-900'}, quiz.id),
                    React.createElement('td', {className: 'px-6 py-4 text-sm text-gray-900'}, quiz.username || 'Unknown'),
                    React.createElement('td', {className: 'px-6 py-4 text-sm text-gray-900'}, quiz.topic),
                    React.createElement('td', {className: 'px-6 py-4 text-sm text-gray-900'}, quiz.correct_answers + '/' + quiz.total_questions + ' (' + quiz.score_percentage + '%)'),
                    React.createElement('td', {className: 'px-6 py-4 text-sm text-gray-900'}, new Date(quiz.created_at).toLocaleDateString()),
                    React.createElement('td', {className: 'px-6 py-4 text-sm'},
                      React.createElement('button', {
                        onClick: () => deleteItem('quiz-sessions', quiz.id),
                        className: 'text-red-600 hover:text-red-900'
                      }, 'Delete')
                    )
                  )
                )
              )
            )
          )
        ),
        
        activeTab === 'activities' && React.createElement('div', null,
          React.createElement('div', {className: 'px-6 py-4 border-b'},
            React.createElement('h2', {className: 'text-xl font-semibold'}, 'Activities (' + (data?.data?.activities?.length || 0) + ')')
          ),
          React.createElement('div', {className: 'overflow-x-auto'},
            React.createElement('table', {className: 'w-full'},
              React.createElement('thead', {className: 'bg-gray-50'},
                React.createElement('tr', null,
                  React.createElement('th', {className: 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'}, 'ID'),
                  React.createElement('th', {className: 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'}, 'User'),
                  React.createElement('th', {className: 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'}, 'Action'),
                  React.createElement('th', {className: 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'}, 'Data'),
                  React.createElement('th', {className: 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'}, 'Time'),
                  React.createElement('th', {className: 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase'}, 'Actions')
                )
              ),
              React.createElement('tbody', {className: 'divide-y divide-gray-200'},
                data?.data?.activities?.map(activity =>
                  React.createElement('tr', {key: activity.id},
                    React.createElement('td', {className: 'px-6 py-4 text-sm text-gray-900'}, activity.id),
                    React.createElement('td', {className: 'px-6 py-4 text-sm text-gray-900'}, activity.username || 'Unknown'),
                    React.createElement('td', {className: 'px-6 py-4 text-sm text-gray-900'}, activity.action),
                    React.createElement('td', {className: 'px-6 py-4 text-sm text-gray-900 max-w-xs truncate'}, JSON.stringify(activity.data)),
                    React.createElement('td', {className: 'px-6 py-4 text-sm text-gray-900'}, new Date(activity.timestamp).toLocaleString()),
                    React.createElement('td', {className: 'px-6 py-4 text-sm'},
                      React.createElement('button', {
                        onClick: () => deleteItem('activities', activity.id),
                        className: 'text-red-600 hover:text-red-900'
                      }, 'Delete')
                    )
                  )
                )
              )
            )
          )
        )
      )
    )
  );
}

ReactDOM.render(React.createElement(AdminPanel), document.getElementById('root'));
</script></body></html>`);
});

app.get('*', (req, res) => {
  res.send(`<!DOCTYPE html>
<html><head><title>AI Study Companion</title><script src="https://unpkg.com/react@18/umd/react.production.min.js"></script><script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script><script src="https://cdn.tailwindcss.com"></script><script src="https://checkout.razorpay.com/v1/checkout.js"></script><script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script></head>
<body><div id="root"></div><canvas id="bg-canvas" style="position: fixed; top: 0; left: 0; z-index: -1; width: 100%; height: 100%;"></canvas><script>
const {useState, useEffect} = React;

// Futuristic 3D Environment
let scene, camera, renderer, neuralNet, holoCubes, dataStream;
let mouse = { x: 0, y: 0 };
let time = 0;

function initThreeJS() {
  const canvas = document.getElementById('bg-canvas');
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0a0a2e, 1, 2000);
  
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
  renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  
  createNeuralNetwork();
  createHolographicCubes();
  createDataStream();
  
  const light1 = new THREE.PointLight(0x00ffff, 1, 1000);
  light1.position.set(200, 200, 200);
  scene.add(light1);
  
  const light2 = new THREE.PointLight(0xff00ff, 1, 1000);
  light2.position.set(-200, -200, 200);
  scene.add(light2);
  
  camera.position.z = 800;
  
  document.addEventListener('mousemove', (e) => {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  });
  
  animate();
}

function createNeuralNetwork() {
  const group = new THREE.Group();
  
  for (let i = 0; i < 100; i++) {
    const geometry = new THREE.SphereGeometry(3, 8, 8);
    const material = new THREE.MeshPhongMaterial({ 
      color: 0x00ffff, 
      transparent: true, 
      opacity: 0.7,
      emissive: 0x004444
    });
    
    const sphere = new THREE.Mesh(geometry, material);
    sphere.position.set(
      (Math.random() - 0.5) * 1000,
      (Math.random() - 0.5) * 600,
      (Math.random() - 0.5) * 400
    );
    group.add(sphere);
  }
  
  neuralNet = group;
  scene.add(neuralNet);
}

function createHolographicCubes() {
  const group = new THREE.Group();
  
  for (let i = 0; i < 20; i++) {
    const geometry = new THREE.BoxGeometry(30, 30, 30);
    const material = new THREE.MeshPhongMaterial({
      color: 0xff00ff,
      transparent: true,
      opacity: 0.3,
      wireframe: true
    });
    
    const cube = new THREE.Mesh(geometry, material);
    cube.position.set(
      (Math.random() - 0.5) * 1200,
      (Math.random() - 0.5) * 800,
      (Math.random() - 0.5) * 600
    );
    group.add(cube);
  }
  
  holoCubes = group;
  scene.add(holoCubes);
}

function createDataStream() {
  const geometry = new THREE.BufferGeometry();
  const positions = [];
  const colors = [];
  
  for (let i = 0; i < 3000; i++) {
    positions.push((Math.random() - 0.5) * 2000);
    positions.push((Math.random() - 0.5) * 1000);
    positions.push((Math.random() - 0.5) * 1000);
    
    colors.push(0, 1, 1);
  }
  
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  
  const material = new THREE.PointsMaterial({ 
    size: 2, 
    vertexColors: true, 
    transparent: true, 
    opacity: 0.8,
    blending: THREE.AdditiveBlending
  });
  
  dataStream = new THREE.Points(geometry, material);
  scene.add(dataStream);
}

function animate() {
  requestAnimationFrame(animate);
  time += 0.01;
  
  if (neuralNet) {
    neuralNet.rotation.y += 0.003;
    neuralNet.children.forEach((node, i) => {
      node.material.emissiveIntensity = 0.3 + Math.sin(time * 3 + i) * 0.2;
    });
  }
  
  if (holoCubes) {
    holoCubes.children.forEach((cube, i) => {
      cube.rotation.x += 0.02;
      cube.rotation.y += 0.015;
      cube.position.y += Math.sin(time + i) * 0.8;
    });
  }
  
  if (dataStream) {
    dataStream.rotation.y += 0.002;
    const positions = dataStream.geometry.attributes.position.array;
    for (let i = 1; i < positions.length; i += 3) {
      positions[i] += Math.sin(time + i) * 0.5;
    }
    dataStream.geometry.attributes.position.needsUpdate = true;
  }
  
  camera.position.x += (mouse.x * 200 - camera.position.x) * 0.05;
  camera.position.y += (-mouse.y * 200 - camera.position.y) * 0.05;
  camera.lookAt(scene.position);
  
  renderer.render(scene, camera);
}

function handleResize() {
  if (camera && renderer) {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
}

window.addEventListener('resize', handleResize);

// Initialize Three.js when page loads
setTimeout(initThreeJS, 100);
function App() {
  const [user, setUser] = useState(null);
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({username:'',email:'',password:'',confirmPassword:'',otp:''});
  const [error, setError] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [topic, setTopic] = useState('');
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('quiz');
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [quizCompleted, setQuizCompleted] = useState(false);
  const [generationCount, setGenerationCount] = useState(0);
  const [showSubscription, setShowSubscription] = useState(false);
  const [usedTopics, setUsedTopics] = useState([]);
  const [currentTopicQuestions, setCurrentTopicQuestions] = useState(0);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [showAccountSettings, setShowAccountSettings] = useState(false);
  
  const sendOTP = async () => {
    if (!form.email) {
      setError('Please enter email address');
      return;
    }
    try {
      const res = await fetch('/api/send-otp', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({email: form.email})
      });
      
      if (!res.ok) {
        throw new Error('Server error: ' + res.status);
      }
      
      const result = await res.json();
      if (result.success) {
        setOtpSent(true);
        setError('');
        if (result.debugOtp) {
          console.log('DEBUG OTP:', result.debugOtp);
          if (!result.emailSent) {
            alert('Email failed. OTP: ' + result.debugOtp);
          }
        }
      } else {
        setError(result.error);
      }
    } catch (err) {
      console.error('Send OTP error:', err);
      setError('Server error. Please try again.');
    }
  };
  
  const verifyOTP = async () => {
    if (!form.otp) {
      setError('Please enter OTP');
      return;
    }
    if (form.otp.length !== 6) {
      setError('OTP must be 6 digits');
      return;
    }
    try {
      const res = await fetch('/api/verify-otp', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({email: form.email, otp: form.otp})
      });
      
      if (!res.ok) {
        throw new Error('Server error');
      }
      
      const result = await res.json();
      if (result.success) {
        setEmailVerified(true);
        setError('');
      } else {
        setError(result.error || 'Invalid OTP');
      }
    } catch (err) {
      console.error('Verify OTP error:', err);
      setError('Failed to verify OTP. Please try again.');
    }
  };
  
  const handleAuth = async (e) => {
    e.preventDefault();
    setError('');
    
    if (mode === 'signup') {
      if (!form.username || !form.email || !form.password || !form.confirmPassword) {
        setError('Please fill in all fields');
        return;
      }
      if (form.password !== form.confirmPassword) {
        setError('Passwords do not match');
        return;
      }
      if (form.username.length < 3) {
        setError('Username must be at least 3 characters');
        return;
      }
      if (form.password.length < 6) {
        setError('Password must be at least 6 characters');
        return;
      }
    }
    
    try {
      const url = mode === 'login' ? '/api/login' : '/api/register';
      const body = mode === 'login' ? 
        {username: form.username, password: form.password} : 
        {username: form.username, email: form.email, password: form.password, emailVerified: emailVerified};
      const res = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
      const result = await res.json();
      if (result.success) {
        if (mode === 'login') {
          setUser(result.user);
        } else {
          setError('');
          setForm({username:'',email:'',password:'',confirmPassword:'',otp:''});
          setOtpSent(false);
          setEmailVerified(false);
          setMode('login');
        }
      } else {
        setError(result.error);
      }
    } catch (err) {
      console.error('Auth error:', err);
      setError('Connection failed. Please try again.');
    }
  };
  
  const saveQuizResult = async (totalQuestions, correctAnswers, scorePercentage) => {
    try {
      await fetch('/api/quiz-result', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          userId: user.id,
          topic: topic,
          totalQuestions: totalQuestions,
          correctAnswers: correctAnswers,
          scorePercentage: scorePercentage
        })
      });
    } catch (err) {
      console.error('Failed to save quiz result:', err);
    }
  };
  
  const generate = async () => {
    if (!topic) {
      alert('Please enter a topic first!');
      return;
    }
    
    const topicLower = topic.toLowerCase().trim();
    const isNewTopic = !usedTopics.includes(topicLower);
    
    // Check if user has already used one topic and is trying a new one
    if (usedTopics.length >= 1 && isNewTopic) {
      setShowSubscription(true);
      return;
    }
    
    // Check if current topic has reached 10 questions
    if (!isNewTopic && currentTopicQuestions >= 10) {
      setShowSubscription(true);
      return;
    }
    
    setLoading(true);
    setSelectedAnswers({});
    setError('');
    try {
      const prompt = tab === 'quiz' ? 
        'Generate 10 quiz questions about "' + topic + '" as JSON array with question, options, answer' :
        tab === 'flashcards' ?
        'Generate 8 flashcards about "' + topic + '" as JSON array with term, definition' :
        'Generate mind map for "' + topic + '" as JSON array with concept, related_concepts';
      
      let json;
      try {
        const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=AIzaSyCSyd7_6ZAJwSHaN12Ik1Ld-JMD4boKvzE', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({contents: [{role: 'user', parts: [{text: prompt}]}]})
        });
        
        if (!res.ok) {
          throw new Error('API_ERROR');
        }
        
        const result = await res.json();
        
        if (!result.candidates || !result.candidates[0] || !result.candidates[0].content) {
          throw new Error('API_ERROR');
        }
        
        const text = result.candidates[0].content.parts[0].text;
        const cleanText = text.replace(/\`\`\`json|\`\`\`/g, '').trim();
        json = JSON.parse(cleanText);
        
        if (!Array.isArray(json) || json.length === 0) {
          throw new Error('API_ERROR');
        }
      } catch (apiError) {
        console.log('API failed, using fallback content');
        // Fallback content with better options
        if (tab === 'quiz') {
          const topicLower = topic.toLowerCase();
          if (topicLower.includes('data science') || topicLower.includes('machine learning') || topicLower.includes('ai')) {
            json = [
              {question: 'What is the primary goal of data science?', options: ['Extract insights from data', 'Create websites', 'Design graphics', 'Write documentation'], answer: 'Extract insights from data'},
              {question: 'Which programming language is most popular in data science?', options: ['Python', 'HTML', 'CSS', 'Assembly'], answer: 'Python'},
              {question: 'What does ML stand for in data science?', options: ['Machine Learning', 'Multiple Languages', 'Main Logic', 'Memory Location'], answer: 'Machine Learning'},
              {question: 'Which library is commonly used for data manipulation in Python?', options: ['Pandas', 'jQuery', 'Bootstrap', 'Angular'], answer: 'Pandas'},
              {question: 'What is supervised learning?', options: ['Learning with labeled data', 'Learning without data', 'Learning with supervision', 'Learning algorithms'], answer: 'Learning with labeled data'},
              {question: 'What does CSV stand for?', options: ['Comma Separated Values', 'Computer System Values', 'Central Server Values', 'Code Structure Values'], answer: 'Comma Separated Values'},
              {question: 'Which visualization library is popular in Python?', options: ['Matplotlib', 'React', 'Vue', 'Express'], answer: 'Matplotlib'},
              {question: 'What is the purpose of data cleaning?', options: ['Remove errors and inconsistencies', 'Add more data', 'Encrypt data', 'Compress data'], answer: 'Remove errors and inconsistencies'},
              {question: 'What is a neural network inspired by?', options: ['Human brain', 'Computer hardware', 'Internet protocols', 'Database systems'], answer: 'Human brain'},
              {question: 'What does API stand for?', options: ['Application Programming Interface', 'Advanced Programming Interface', 'Automated Program Integration', 'Application Process Integration'], answer: 'Application Programming Interface'}
            ];
          } else if (topicLower.includes('javascript') || topicLower.includes('programming') || topicLower.includes('coding')) {
            json = [
              {question: 'What does JavaScript primarily run on?', options: ['Web browsers', 'Only servers', 'Mobile apps only', 'Desktop only'], answer: 'Web browsers'},
              {question: 'Which symbol is used for comments in JavaScript?', options: ['//', '##', '<!--', '**'], answer: '//'},
              {question: 'What is a variable in programming?', options: ['Storage for data', 'A function', 'A loop', 'An error'], answer: 'Storage for data'},
              {question: 'Which method adds an element to an array?', options: ['push()', 'add()', 'insert()', 'append()'], answer: 'push()'},
              {question: 'What does HTML stand for?', options: ['HyperText Markup Language', 'High Tech Modern Language', 'Home Tool Markup Language', 'Hyperlink Text Management Language'], answer: 'HyperText Markup Language'},
              {question: 'Which operator is used for equality in JavaScript?', options: ['===', '=', '==', '!='], answer: '==='},
              {question: 'What is a function in programming?', options: ['Reusable block of code', 'A variable', 'An error', 'A comment'], answer: 'Reusable block of code'},
              {question: 'Which method converts string to number?', options: ['parseInt()', 'toString()', 'valueOf()', 'stringify()'], answer: 'parseInt()'},
              {question: 'What does CSS stand for?', options: ['Cascading Style Sheets', 'Computer Style Sheets', 'Creative Style Sheets', 'Colorful Style Sheets'], answer: 'Cascading Style Sheets'},
              {question: 'Which keyword declares a variable in JavaScript?', options: ['let', 'variable', 'declare', 'make'], answer: 'let'}
            ];
          } else {
            json = [
              {question: 'What is the main focus of ' + topic + '?', options: ['Understanding core concepts', 'Memorizing facts only', 'Avoiding practice', 'Ignoring fundamentals'], answer: 'Understanding core concepts'},
              {question: 'Which approach is best for learning ' + topic + '?', options: ['Practice and theory combined', 'Theory only', 'Practice only', 'Neither theory nor practice'], answer: 'Practice and theory combined'},
              {question: 'What is important when studying ' + topic + '?', options: ['Consistent practice', 'Cramming before tests', 'Avoiding difficult topics', 'Memorizing without understanding'], answer: 'Consistent practice'},
              {question: 'How should you approach complex topics in ' + topic + '?', options: ['Break into smaller parts', 'Avoid them completely', 'Memorize everything', 'Skip to advanced topics'], answer: 'Break into smaller parts'},
              {question: 'What helps in mastering ' + topic + '?', options: ['Regular review and practice', 'One-time study', 'Avoiding questions', 'Passive reading only'], answer: 'Regular review and practice'},
              {question: 'Which resource is most valuable for ' + topic + '?', options: ['Quality educational content', 'Random internet articles', 'Outdated materials', 'Unverified sources'], answer: 'Quality educational content'},
              {question: 'What should you do when stuck on a ' + topic + ' problem?', options: ['Seek help and research', 'Give up immediately', 'Guess randomly', 'Avoid the problem'], answer: 'Seek help and research'},
              {question: 'How important are fundamentals in ' + topic + '?', options: ['Very important', 'Not important', 'Somewhat important', 'Completely irrelevant'], answer: 'Very important'},
              {question: 'What is the best way to retain ' + topic + ' knowledge?', options: ['Apply what you learn', 'Just read about it', 'Memorize definitions', 'Avoid practical application'], answer: 'Apply what you learn'},
              {question: 'Which mindset helps in learning ' + topic + '?', options: ['Growth mindset', 'Fixed mindset', 'Negative mindset', 'Indifferent mindset'], answer: 'Growth mindset'}
            ];
          }
        } else if (tab === 'flashcards') {
          json = [
            {term: topic + ' Overview', definition: 'Comprehensive introduction to the fundamental concepts and principles of ' + topic},
            {term: 'Core Principles', definition: 'Essential principles that form the foundation of ' + topic + ' understanding'},
            {term: 'Key Applications', definition: 'Real-world applications and use cases where ' + topic + ' is commonly applied'},
            {term: 'Main Benefits', definition: 'Primary advantages and positive outcomes of implementing ' + topic + ' concepts'},
            {term: 'Common Challenges', definition: 'Typical obstacles and difficulties encountered when working with ' + topic},
            {term: 'Best Practices', definition: 'Proven methods and recommended approaches for effective ' + topic + ' implementation'},
            {term: 'Tools & Resources', definition: 'Essential tools, software, and resources commonly used in ' + topic},
            {term: 'Future Outlook', definition: 'Emerging trends and future developments expected in the field of ' + topic}
          ];
        } else {
          json = [
            {concept: topic, related_concepts: ['Fundamentals', 'Core Principles', 'Key Applications']},
            {concept: 'Learning Path', related_concepts: ['Beginner Level', 'Intermediate Skills', 'Advanced Topics']},
            {concept: 'Practical Skills', related_concepts: ['Hands-on Practice', 'Real Projects', 'Problem Solving']},
            {concept: 'Tools & Methods', related_concepts: ['Essential Tools', 'Best Practices', 'Modern Techniques']},
            {concept: 'Career Growth', related_concepts: ['Job Opportunities', 'Skill Development', 'Professional Network']}
          ];
        }
      }
      
      setContent(json);
      setSelectedAnswers({});
      setCurrentQuestion(0);
      setQuizCompleted(false);
      setGenerationCount(prev => prev + 1);
      
      // Track topic usage
      if (isNewTopic) {
        setUsedTopics(prev => [...prev, topicLower]);
        setCurrentTopicQuestions(1);
      } else {
        setCurrentTopicQuestions(prev => prev + 1);
      }
      
      await fetch('/api/activity', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          userId: user.id,
          action: 'generate_content',
          data: {type: tab, topic: topic}
        })
      });
    } catch (err) {
      console.error('Generation error:', err);
      setError('Content generation failed. Please try again.');
    }
    setLoading(false);
  };
  
  if (!user) {
    return React.createElement('div', {className: 'min-h-screen flex items-center justify-center p-6', style: {background: 'radial-gradient(circle at 50% 50%, rgba(0,255,255,0.1) 0%, rgba(255,0,255,0.1) 50%, rgba(0,0,0,0.9) 100%)'}},
      React.createElement('div', {className: 'relative overflow-hidden', style: {background: 'linear-gradient(135deg, rgba(0,255,255,0.1) 0%, rgba(255,0,255,0.1) 100%)', backdropFilter: 'blur(20px)', border: '1px solid rgba(0,255,255,0.3)', borderRadius: '20px', padding: '40px', maxWidth: '400px', width: '100%', boxShadow: '0 25px 50px rgba(0,255,255,0.2)'}},
        React.createElement('h1', {className: 'text-3xl font-bold text-center mb-8', style: {color: '#00ffff', textShadow: '0 0 20px rgba(0,255,255,0.8)', fontFamily: 'monospace'}}, mode === 'login' ? '◉ NEURAL LOGIN' : '◉ NEURAL REGISTER'),
        React.createElement('form', {onSubmit: handleAuth, className: 'space-y-4'},
          React.createElement('input', {type: 'text', placeholder: '▶ Neural ID', className: 'w-full p-4 rounded-xl transition-all duration-300', style: {background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(0,255,255,0.5)', color: '#00ffff', fontSize: '16px', fontFamily: 'monospace'}, value: form.username, onChange: e => setForm({...form, username: e.target.value}), onFocus: e => e.target.style.boxShadow = '0 0 20px rgba(0,255,255,0.5)', onBlur: e => e.target.style.boxShadow = 'none'}),
          mode === 'signup' && React.createElement('div', {className: 'space-y-2'},
            React.createElement('div', {className: 'flex gap-2'},
              React.createElement('input', {type: 'email', placeholder: 'Email', className: 'flex-1 p-3 border rounded-xl', value: form.email, onChange: e => setForm({...form, email: e.target.value})}),
              React.createElement('button', {type: 'button', onClick: sendOTP, disabled: otpSent, className: 'px-4 py-3 bg-blue-500 text-white rounded-xl text-sm ' + (otpSent ? 'opacity-50' : 'hover:bg-blue-600')}, otpSent ? 'Sent' : 'Send OTP')
            ),
            otpSent && React.createElement('div', {className: 'flex gap-2'},
              React.createElement('input', {type: 'text', placeholder: 'Enter OTP', className: 'flex-1 p-3 border rounded-xl', value: form.otp, onChange: e => setForm({...form, otp: e.target.value})}),
              React.createElement('button', {type: 'button', onClick: verifyOTP, disabled: emailVerified, className: 'px-4 py-3 bg-green-500 text-white rounded-xl text-sm ' + (emailVerified ? 'opacity-50' : 'hover:bg-green-600')}, emailVerified ? 'Verified' : 'Verify')
            ),
            emailVerified && React.createElement('p', {className: 'text-green-500 text-sm'}, '✓ Email verified successfully')
          ),
          React.createElement('input', {type: 'password', placeholder: 'Password', className: 'w-full p-3 border rounded-xl', value: form.password, onChange: e => setForm({...form, password: e.target.value})}),
          mode === 'signup' && React.createElement('input', {type: 'password', placeholder: 'Confirm Password', className: 'w-full p-3 border rounded-xl', value: form.confirmPassword, onChange: e => setForm({...form, confirmPassword: e.target.value})}),
          error && React.createElement('p', {className: 'text-red-500 text-center'}, error),
          React.createElement('button', {type: 'submit', className: 'w-full bg-purple-600 text-white py-3 rounded-xl font-semibold'}, mode === 'login' ? 'Sign In' : 'Create Account'),
          React.createElement('p', {className: 'text-center mt-4'}, 
            mode === 'login' ? "Don't have an account? " : "Already have an account? ",
            React.createElement('button', {type: 'button', onClick: () => setMode(mode === 'login' ? 'signup' : 'login'), className: 'text-purple-600 font-semibold'}, mode === 'login' ? 'Sign Up' : 'Sign In')
          )
        ),
        React.createElement('div', {className: 'mt-8 text-center text-xs text-gray-400 space-y-1'},
          React.createElement('p', null, 'Developed by: suneethk176'),
          React.createElement('p', null, 
            'GitHub: ',
            React.createElement('a', {href: 'https://github.com/suneethk176', target: '_blank', rel: 'noopener noreferrer', className: 'text-purple-500 hover:text-purple-700'}, 'github.com/suneethk176')
          ),
          React.createElement('p', null, 
            'Support: ',
            React.createElement('a', {href: 'mailto:suneethk176@gmail.com', className: 'text-purple-500 hover:text-purple-700'}, 'suneethk176@gmail.com')
          ),
          React.createElement('p', null, '© 2024 All rights reserved')
        )
      )
    );
  }
  
  return React.createElement('div', {className: 'min-h-screen p-6', style: {background: 'radial-gradient(circle at 20% 80%, rgba(0,255,255,0.15) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(255,0,255,0.15) 0%, transparent 50%), radial-gradient(circle at 40% 40%, rgba(0,100,255,0.1) 0%, transparent 50%)'}},
    React.createElement('div', {className: 'max-w-5xl mx-auto'},
      React.createElement('header', {className: 'text-center mb-8 relative'},
        React.createElement('div', {className: 'absolute top-0 left-0'},
          React.createElement('button', {
            onClick: () => setShowSubscription(true),
            className: 'bg-gradient-to-r from-purple-600 to-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:shadow-lg transition-all'
          }, '⭐ Subscribe')
        ),
        React.createElement('div', {className: 'absolute top-0 right-0'},
          React.createElement('div', {className: 'relative'},
            React.createElement('button', {
              onClick: () => setShowAccountMenu(!showAccountMenu),
              className: 'flex items-center space-x-2 bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded-lg transition-colors'
            },
              React.createElement('span', {className: 'text-gray-700'}, user.username),
              React.createElement('span', {className: 'text-gray-500'}, '▼')
            ),
            showAccountMenu && React.createElement('div', {className: 'absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border z-50'},
              React.createElement('div', {className: 'py-1'},
                React.createElement('button', {
                  onClick: () => {
                    setShowAccountSettings(true);
                    setShowAccountMenu(false);
                  },
                  className: 'block w-full text-left px-4 py-2 text-gray-700 hover:bg-gray-100'
                }, '⚙️ Account Settings'),
                React.createElement('button', {
                  onClick: () => setUser(null),
                  className: 'block w-full text-left px-4 py-2 text-red-600 hover:bg-gray-100'
                }, '🚪 Logout')
              )
            )
          )
        ),
        React.createElement('h1', {className: 'text-6xl font-bold text-center mb-4', style: {background: 'linear-gradient(45deg, #00ffff, #ff00ff, #00ffff)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', textShadow: '0 0 30px rgba(0,255,255,0.5)', fontFamily: 'monospace', letterSpacing: '3px'}}, '◉ NEURAL STUDY ◉'),
        React.createElement('p', {className: 'text-gray-600 mt-2'}, 'Welcome back, ' + user.username + '!')
      ),
      React.createElement('main', {className: 'p-8 rounded-3xl relative overflow-hidden', style: {background: 'linear-gradient(135deg, rgba(0,20,40,0.9) 0%, rgba(20,0,40,0.9) 100%)', backdropFilter: 'blur(20px)', border: '2px solid rgba(0,255,255,0.3)', boxShadow: '0 25px 50px rgba(0,255,255,0.2), inset 0 1px 0 rgba(255,255,255,0.1)'}},
        React.createElement('div', {className: 'flex gap-4 mb-8'},
          React.createElement('input', {type: 'text', placeholder: '▶ Initialize Neural Topic...', className: 'flex-1 p-4 rounded-full text-lg transition-all duration-300', style: {background: 'rgba(0,0,0,0.8)', border: '2px solid rgba(0,255,255,0.5)', color: '#00ffff', fontFamily: 'monospace', fontSize: '18px'}, value: topic, onChange: e => setTopic(e.target.value), onFocus: e => e.target.style.boxShadow = '0 0 30px rgba(0,255,255,0.6)', onBlur: e => e.target.style.boxShadow = 'none'}),
          React.createElement('button', {onClick: generate, disabled: loading, className: 'px-8 py-4 rounded-full font-bold transition-all duration-300 transform hover:scale-105', style: {background: loading ? 'rgba(100,100,100,0.5)' : 'linear-gradient(45deg, #00ffff, #ff00ff)', color: '#000', fontFamily: 'monospace', fontSize: '16px', border: '2px solid rgba(0,255,255,0.8)', boxShadow: '0 0 20px rgba(0,255,255,0.5)'}}, loading ? '◉ PROCESSING...' : '▶ GENERATE'),
          React.createElement('div', {className: 'text-sm text-gray-500 flex items-center'}, 'Topics: ' + usedTopics.length + '/1 free')
        ),
        React.createElement('div', {className: 'flex justify-center mb-8'},
          React.createElement('div', {className: 'flex bg-gray-100 rounded-full p-1'},
            ['quiz', 'flashcards', 'mindmap'].map(t => 
              React.createElement('button', {key: t, onClick: () => setTab(t), className: 'px-6 py-2 rounded-full ' + (tab === t ? 'bg-purple-500 text-white' : 'text-gray-600')}, t.charAt(0).toUpperCase() + t.slice(1))
            )
          )
        ),
        error && React.createElement('div', {className: 'bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4'}, error),
        content && React.createElement('div', {className: 'space-y-4'},
          tab === 'quiz' && (() => {
            const maxFreeQuestions = 10;
            const limitedContent = content.slice(0, maxFreeQuestions);
            
            const handleOptionClick = (selectedOption) => {
              setSelectedAnswers(prev => ({
                ...prev,
                [currentQuestion]: selectedOption
              }));
            };
            
            const handleNext = () => {
              if (currentQuestion < limitedContent.length - 1) {
                setCurrentQuestion(currentQuestion + 1);
              } else if (currentQuestion === limitedContent.length - 1) {
                // Always show subscription after completing 10 questions
                setShowSubscription(true);
              }
            };
            
            const handlePrevious = () => {
              if (currentQuestion > 0) {
                setCurrentQuestion(currentQuestion - 1);
              }
            };
            
            const getOptionStyle = (option, correctAnswer) => {
              const selectedOption = selectedAnswers[currentQuestion];
              if (!selectedOption) return {background: 'rgba(0,20,40,0.8)', border: '1px solid rgba(0,255,255,0.3)', color: '#00ffff'};
              
              if (option === correctAnswer) return {background: 'linear-gradient(45deg, #00ff00, #00ffaa)', color: '#000', boxShadow: '0 0 20px rgba(0,255,0,0.6)'};
              if (option === selectedOption && option !== correctAnswer) return {background: 'linear-gradient(45deg, #ff0040, #ff4080)', color: '#fff', boxShadow: '0 0 20px rgba(255,0,64,0.6)'};
              return {background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(100,100,100,0.3)', color: '#888'};
            };
            
            if (quizCompleted) {
              const totalQuestions = limitedContent.length;
              const correctAnswers = Object.keys(selectedAnswers).filter(i => selectedAnswers[i] === limitedContent[i].answer).length;
              const score = Math.round((correctAnswers / totalQuestions) * 100);
              
              return React.createElement('div', {className: 'bg-gradient-to-r from-purple-600 to-blue-600 text-white p-8 rounded-xl text-center'},
                React.createElement('h3', {className: 'text-3xl font-bold mb-4'}, '🎉 Quiz Completed!'),
                React.createElement('div', {className: 'text-xl mb-6'},
                  React.createElement('p', null, 'Final Score: ' + correctAnswers + '/' + totalQuestions + ' (' + score + '%)'),
                  React.createElement('p', {className: 'text-sm opacity-90 mt-2'}, score >= 80 ? 'Excellent work!' : score >= 60 ? 'Good job!' : 'Keep practicing!')
                ),
                React.createElement('button', {
                  onClick: () => {
                    setCurrentQuestion(0);
                    setQuizCompleted(false);
                    setSelectedAnswers({});
                    setContent(null);
                  },
                  className: 'bg-white text-purple-600 px-6 py-3 rounded-full font-semibold hover:bg-gray-100'
                }, 'Start New Quiz')
              );
            }
            
            const currentQ = limitedContent[currentQuestion];
            const progress = ((currentQuestion + 1) / limitedContent.length) * 100;
            
            return React.createElement('div', {className: 'space-y-6'},
              React.createElement('div', {className: 'bg-gray-200 rounded-full h-2 mb-4'},
                React.createElement('div', {className: 'bg-purple-600 h-2 rounded-full transition-all', style: {width: progress + '%'}})
              ),
              
              React.createElement('div', {className: 'p-6 rounded-xl relative overflow-hidden transform transition-all duration-500 hover:scale-105', style: {background: 'linear-gradient(135deg, rgba(0,40,80,0.9) 0%, rgba(40,0,80,0.9) 100%)', backdropFilter: 'blur(15px)', border: '1px solid rgba(0,255,255,0.4)', boxShadow: '0 15px 35px rgba(0,255,255,0.2), inset 0 1px 0 rgba(255,255,255,0.1)'}},
                React.createElement('div', {className: 'flex justify-between items-center mb-4'},
                  React.createElement('span', {className: 'text-sm text-gray-500'}, 'Question ' + (currentQuestion + 1) + ' of ' + limitedContent.length),
                  content.length > maxFreeQuestions && React.createElement('span', {className: 'text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded'}, 'Free: ' + maxFreeQuestions + ' questions')
                ),
                
                React.createElement('p', {className: 'font-bold text-xl mb-6', style: {color: '#00ffff', textShadow: '0 0 10px rgba(0,255,255,0.8)', fontFamily: 'monospace', lineHeight: '1.6'}}, '▶ ' + currentQ.question),
                React.createElement('ul', {className: 'space-y-4 mb-6'}, currentQ.options?.map((option, oIndex) => 
                  React.createElement('li', {
                    key: oIndex,
                    className: 'p-4 rounded-xl transition-all duration-300 transform hover:scale-105 cursor-pointer font-mono',
                    onClick: () => handleOptionClick(option),
                    style: {...getOptionStyle(option, currentQ.answer), fontSize: '16px', fontWeight: 'bold'}
                  }, '◆ ' + option)
                )),
                
                React.createElement('div', {className: 'flex justify-between'},
                  React.createElement('button', {
                    onClick: handlePrevious,
                    disabled: currentQuestion === 0,
                    className: 'px-4 py-2 bg-gray-300 text-gray-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-400 transition-colors'
                  }, 'Previous'),
                  
                  React.createElement('button', {
                    onClick: handleNext,
                    disabled: !selectedAnswers[currentQuestion],
                    className: 'px-4 py-2 bg-purple-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-purple-700 transition-colors'
                  }, currentQuestion === limitedContent.length - 1 ? 'Upgrade for More' : 'Next')
                )
              )
            );
          })(),
          tab === 'flashcards' && content.map((item, i) => 
            React.createElement('div', {key: i, className: 'bg-white/60 backdrop-blur-sm p-6 rounded-xl border border-white/30 shadow-lg transform hover:scale-105 transition-all duration-300'},
              React.createElement('p', {className: 'font-bold'}, item.term),
              React.createElement('p', {className: 'text-gray-600'}, item.definition)
            )
          ),
          tab === 'mindmap' && content.map((item, i) => 
            React.createElement('div', {key: i, className: 'bg-white/60 backdrop-blur-sm p-6 rounded-xl border border-white/30 shadow-lg transform hover:scale-105 transition-all duration-300'},
              React.createElement('p', {className: 'font-bold'}, item.concept),
              React.createElement('ul', {className: 'mt-2 space-y-1'}, item.related_concepts?.map((rel, j) => React.createElement('li', {key: j, className: 'text-sm text-gray-600'}, '• ' + rel)))
            )
          )
        ),
        showAccountSettings && React.createElement('div', {className: 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50'},
          React.createElement('div', {className: 'bg-white p-8 rounded-3xl shadow-2xl max-w-md mx-4'},
            React.createElement('h2', {className: 'text-2xl font-bold text-center mb-6'}, 'Account Settings'),
            React.createElement('div', {className: 'space-y-4'},
              React.createElement('div', null,
                React.createElement('label', {className: 'block text-sm font-medium text-gray-700 mb-1'}, 'Username'),
                React.createElement('input', {type: 'text', value: user.username, disabled: true, className: 'w-full p-3 border rounded-lg bg-gray-50'})
              ),
              React.createElement('div', null,
                React.createElement('label', {className: 'block text-sm font-medium text-gray-700 mb-1'}, 'Email'),
                React.createElement('input', {type: 'email', value: user.email || 'Not provided', disabled: true, className: 'w-full p-3 border rounded-lg bg-gray-50'})
              ),
              React.createElement('div', {className: 'flex gap-3 mt-6'},
                React.createElement('button', {onClick: () => setShowAccountSettings(false), className: 'flex-1 px-4 py-2 border border-gray-300 rounded-lg'}, 'Close')
              )
            )
          )
        ),
        showSubscription && React.createElement('div', {className: 'fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50'},
          React.createElement('div', {className: 'bg-white/90 backdrop-blur-md p-8 rounded-3xl shadow-2xl border border-white/20 max-w-md mx-4 transform scale-100 animate-pulse'},
            React.createElement('h2', {className: 'text-2xl font-bold text-center mb-4'}, 'Upgrade to Premium'),
            React.createElement('p', {className: 'text-gray-600 text-center mb-6'}, usedTopics.length >= 1 && topic && !usedTopics.includes(topic.toLowerCase().trim()) ? 'Subscribe to unlock quizzes on additional topics!' : 'Subscribe to unlock more questions on this topic!'),
            React.createElement('div', {className: 'space-y-4'},
              React.createElement('div', {className: 'bg-gradient-to-r from-purple-600 to-blue-600 text-white p-4 rounded-xl text-center'},
                React.createElement('h3', {className: 'font-bold text-lg'}, 'Premium Plan'),
                React.createElement('p', {className: 'text-sm opacity-90'}, 'Unlimited topics & questions'),
                React.createElement('p', {className: 'text-sm opacity-90'}, 'Advanced flashcards & mind maps'),
                React.createElement('p', {className: 'text-2xl font-bold mt-2'}, '₹10/month')
              ),
              React.createElement('div', {className: 'flex gap-3'},
                React.createElement('button', {onClick: () => setShowSubscription(false), className: 'flex-1 px-4 py-2 border border-gray-300 rounded-lg'}, 'Maybe Later'),
                React.createElement('button', {
                  onClick: async () => {
                    try {
                      console.log('Starting payment process...');
                      
                      // Create Razorpay order
                      const orderRes = await fetch('/api/create-order', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({amount: 10, currency: 'INR'})
                      });
                      
                      console.log('Order response status:', orderRes.status);
                      const orderData = await orderRes.json();
                      console.log('Order data:', orderData);
                      
                      if (!orderData.success) {
                        console.error('Order creation failed:', orderData.error);
                        alert('Failed to create order: ' + (orderData.error || 'Unknown error'));
                        return;
                      }
                      
                      // Initialize Razorpay
                      const options = {
                        key: 'rzp_test_R4xyFG58bENLu6',
                        amount: orderData.order.amount,
                        currency: orderData.order.currency,
                        name: 'AI Study Companion',
                        description: 'Premium Subscription',
                        order_id: orderData.order.id,
                        handler: async function(response) {
                          console.log('Payment response:', response);
                          try {
                            // Verify payment
                            const verifyRes = await fetch('/api/verify-payment', {
                              method: 'POST',
                              headers: {'Content-Type': 'application/json'},
                              body: JSON.stringify({
                                razorpay_order_id: response.razorpay_order_id,
                                razorpay_payment_id: response.razorpay_payment_id,
                                razorpay_signature: response.razorpay_signature,
                                userId: user.id
                              })
                            });
                            const verifyData = await verifyRes.json();
                            console.log('Verification response:', verifyData);
                            
                            if (verifyData.success) {
                              alert('Payment successful! Premium features unlocked.');
                              setShowSubscription(false);
                            } else {
                              alert('Payment verification failed: ' + (verifyData.error || 'Unknown error'));
                            }
                          } catch (err) {
                            console.error('Verification error:', err);
                            alert('Payment verification failed: ' + err.message);
                          }
                        },
                        modal: {
                          ondismiss: function() {
                            console.log('Payment modal dismissed');
                          }
                        },
                        prefill: {
                          name: user.username,
                          email: user.email
                        },
                        theme: {
                          color: '#667eea'
                        }
                      };
                      
                      console.log('Razorpay options:', options);
                      
                      if (window.Razorpay) {
                        console.log('Opening Razorpay checkout...');
                        const rzp = new window.Razorpay(options);
                        rzp.on('payment.failed', function (response) {
                          console.error('Payment failed:', response.error);
                          alert('Payment failed: ' + response.error.description);
                        });
                        rzp.open();
                      } else {
                        console.error('Razorpay not loaded');
                        alert('Razorpay not loaded. Please refresh the page.');
                      }
                    } catch (err) {
                      console.error('Payment error:', err);
                      alert('Payment setup failed: ' + err.message);
                    }
                  },
                  className: 'flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg font-semibold'
                }, 'Pay ₹10')
              )
            )
          )
        ),
        React.createElement('footer', {className: 'mt-8 text-center text-sm text-gray-500 space-y-2'},
          React.createElement('p', null, 'Developed by: suneethk176'),
          React.createElement('p', null, 
            'GitHub: ',
            React.createElement('a', {href: 'https://github.com/suneethk176', target: '_blank', rel: 'noopener noreferrer', className: 'text-purple-600 hover:text-purple-800'}, 'github.com/suneethk176')
          ),
          React.createElement('p', null, 
            'For issues and support: ',
            React.createElement('a', {href: 'mailto:suneethk176@gmail.com', className: 'text-purple-600 hover:text-purple-800'}, 'suneethk176@gmail.com')
          ),
          React.createElement('p', null, '© 2024 AI Study Companion. All rights reserved.')
        )
      )
    )
  );
}
ReactDOM.render(React.createElement(App), document.getElementById('root'));
</script></body></html>`);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString(), port: PORT });
});

// Generate content endpoint
app.post('/api/generate', async (req, res) => {
  try {
    const { topic, type } = req.body;
    
    const prompt = type === 'quiz' ? 
      `Generate 10 quiz questions about "${topic}" as JSON array with question, options, answer` :
      type === 'flashcards' ?
      `Generate 8 flashcards about "${topic}" as JSON array with term, definition` :
      `Generate mind map for "${topic}" as JSON array with concept, related_concepts`;
    
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=AIzaSyCSyd7_6ZAJwSHaN12Ik1Ld-JMD4boKvzE', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({contents: [{role: 'user', parts: [{text: prompt}]}]})
    });
    
    if (!response.ok) {
      throw new Error(`API failed: ${response.status}`);
    }
    
    const result = await response.json();
    const text = result.candidates[0].content.parts[0].text;
    const cleanText = text.replace(/```json|```/g, '').trim();
    const json = JSON.parse(cleanText);
    
    res.json({ success: true, content: json });
  } catch (err) {
    console.error('Generate error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Razorpay payment integration
app.post('/api/create-order', async (req, res) => {
  try {
    console.log('Create order request:', req.body);
    const { amount, currency = 'INR' } = req.body;
    
    console.log('Environment check:', {
      hasKeyId: !!process.env.RAZORPAY_KEY_ID,
      hasKeySecret: !!process.env.RAZORPAY_KEY_SECRET
    });
    
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      console.error('Razorpay credentials missing');
      return res.status(500).json({ success: false, error: 'Razorpay credentials not configured' });
    }
    
    const orderData = {
      amount: amount * 100, // Convert to paise
      currency: currency,
      receipt: 'receipt_' + Date.now(),
      notes: {
        subscription: 'AI Study Companion Premium'
      }
    };
    
    console.log('Creating order with data:', orderData);
    
    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(process.env.RAZORPAY_KEY_ID + ':' + process.env.RAZORPAY_KEY_SECRET).toString('base64'),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(orderData)
    });
    
    console.log('Razorpay API response status:', response.status);
    const order = await response.json();
    console.log('Razorpay API response:', order);
    
    if (response.ok) {
      res.json({ success: true, order });
    } else {
      console.error('Razorpay order creation failed:', order);
      res.status(400).json({ success: false, error: order.error || order });
    }
  } catch (err) {
    console.error('Create order error:', err);
    res.status(500).json({ success: false, error: 'Failed to create order' });
  }
});

app.post('/api/verify-payment', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, userId } = req.body;
    
    console.log('Payment verification request:', { razorpay_order_id, razorpay_payment_id, razorpay_signature, userId });
    
    if (!process.env.RAZORPAY_KEY_SECRET) {
      console.error('RAZORPAY_KEY_SECRET not configured');
      return res.status(500).json({ success: false, error: 'Payment verification not configured' });
    }
    
    const expectedSignature = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(razorpay_order_id + '|' + razorpay_payment_id)
      .digest('hex');
    
    console.log('Expected signature:', expectedSignature);
    console.log('Received signature:', razorpay_signature);
    
    if (expectedSignature === razorpay_signature) {
      // Payment verified successfully
      if (usePostgres) {
        await pool.query(
          'INSERT INTO subscriptions (user_id, payment_id, order_id, status, created_at) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)',
          [userId, razorpay_payment_id, razorpay_order_id, 'active']
        );
        await pool.query('UPDATE users SET is_premium = TRUE WHERE id = $1', [userId]);
      } else {
        // Memory storage
        if (!memoryData.subscriptions) memoryData.subscriptions = [];
        memoryData.subscriptions.push({
          id: Date.now().toString(),
          user_id: userId,
          payment_id: razorpay_payment_id,
          order_id: razorpay_order_id,
          status: 'active',
          created_at: new Date().toISOString()
        });
        if (memoryData.users[userId]) {
          memoryData.users[userId].is_premium = true;
        }
      }
      
      res.json({ success: true, message: 'Payment verified and subscription activated' });
    } else {
      res.status(400).json({ success: false, error: 'Invalid payment signature' });
    }
  } catch (err) {
    console.error('Verify payment error:', err);
    res.status(500).json({ success: false, error: 'Payment verification failed' });
  }
});

// Simple test endpoint
app.get('/api/test', (req, res) => {
  res.json({ success: true, message: 'Server is working', storage: usePostgres ? 'postgresql' : 'memory' });
});

// Clean up expired OTPs endpoint
app.post('/api/cleanup-otps', async (req, res) => {
  try {
    if (usePostgres) {
      const result = await pool.query('DELETE FROM email_otps WHERE expires_at < NOW() RETURNING *');
      res.json({ success: true, message: `Cleaned up ${result.rows.length} expired OTPs`, storage: 'postgresql' });
    } else {
      const before = memoryData.emailOtps?.length || 0;
      const now = new Date();
      memoryData.emailOtps = memoryData.emailOtps?.filter(o => new Date(o.expires_at) > now) || [];
      const after = memoryData.emailOtps.length;
      res.json({ success: true, message: `Cleaned up ${before - after} expired OTPs`, storage: 'memory' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log('PostgreSQL server running on port ' + PORT);
  console.log('Health check: /health');
  console.log('Test endpoint: /api/test');
});