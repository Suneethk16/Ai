import express from 'express';
import cors from 'cors';
import pg from 'pg';

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

// Send OTP via Resend (server-friendly email service)
const sendOTP = async (email, otp) => {
  try {
    console.log('Attempting to send email via Resend...');
    console.log('Target email:', email);
    console.log('OTP:', otp);
    
    const emailData = {
      from: 'AI Study Companion <noreply@suneethk176.site>',
      to: [email],
      subject: 'Email Verification - AI Study Companion',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1 style="color: #667eea; text-align: center;">AI Study Companion</h1>
          <h2>Email Verification</h2>
          <p>Your verification code is:</p>
          <div style="background: #f0f0f0; padding: 20px; text-align: center; font-size: 24px; font-weight: bold; margin: 20px 0;">
            ${otp}
          </div>
          <p>This code will expire in 10 minutes.</p>
          <p>If you didn't request this, please ignore this email.</p>
        </div>
      `
    };
    
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
    console.log('Resend response:', responseData);
    
    if (response.ok) {
      console.log(`📧 OTP sent successfully to ${email}: ${otp}`);
      return true;
    } else {
      throw new Error(`Resend failed: ${response.status} - ${JSON.stringify(responseData)}`);
    }
  } catch (error) {
    console.error('Email sending failed:', error.message);
    console.log('='.repeat(50));
    console.log(`📧 FALLBACK - OTP for ${email}: ${otp}`);
    console.log('='.repeat(50));
    return false;
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
    res.json({ 
      success: true, 
      message: emailSent ? 'OTP sent to your email!' : 'Email failed. Check popup for OTP.',
      emailSent: emailSent,
      debugOtp: emailSent ? undefined : otp
    });
  } catch (err) {
    console.error('Send OTP error:', err);
    const otp = generateOTP();
    console.log(`📧 FALLBACK OTP for ${req.body.email}: ${otp}`);
    res.json({ success: true, message: 'OTP generated (check server logs)', devOtp: otp });
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
<html>
<head>
  <title>AI Study Companion</title>
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body>
  <div id="root"></div>
  <script>
    const {useState} = React;
    
    function App() {
      const [user, setUser] = useState(null);
      const [generationCount, setGenerationCount] = useState(0);
      const [showSubscription, setShowSubscription] = useState(false);
      const [topic, setTopic] = useState('');
      const [content, setContent] = useState(null);
      const [loading, setLoading] = useState(false);
      const [tab, setTab] = useState('quiz');
      
      const generate = async () => {
        if (!topic) {
          alert('Please enter a topic!');
          return;
        }
        
        if (generationCount >= 10) {
          setShowSubscription(true);
          return;
        }
        
        setLoading(true);
        try {
          const prompt = tab === 'quiz' ? 
            'Generate 5 quiz questions about "' + topic + '" as JSON array with question, options, answer' :
            'Generate 5 flashcards about "' + topic + '" as JSON array with term, definition';
          
          const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=AIzaSyCSyd7_6ZAJwSHaN12Ik1Ld-JMD4boKvzE', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({contents: [{role: 'user', parts: [{text: prompt}]}]})
          });
          
          const result = await res.json();
          const text = result.candidates[0].content.parts[0].text;
          const json = JSON.parse(text.replace(/\`\`\`json|\`\`\`/g, ''));
          setContent(json);
          setGenerationCount(prev => prev + 1);
        } catch (err) {
          alert('Generation failed. Please try again.');
        }
        setLoading(false);
      };
      
      if (!user) {
        return React.createElement('div', {className: 'min-h-screen bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center p-6'},
          React.createElement('div', {className: 'bg-white rounded-3xl shadow-2xl p-8 w-full max-w-md text-center'},
            React.createElement('h1', {className: 'text-3xl font-bold mb-8'}, 'AI Study Companion'),
            React.createElement('button', {
              onClick: () => setUser({id: 1, username: 'Demo User'}),
              className: 'w-full bg-purple-600 text-white py-3 rounded-xl font-semibold'
            }, 'Start Demo')
          )
        );
      }
      
      return React.createElement('div', {className: 'min-h-screen bg-gray-50 p-6'},
        React.createElement('div', {className: 'max-w-4xl mx-auto'},
          React.createElement('header', {className: 'text-center mb-8'},
            React.createElement('h1', {className: 'text-4xl font-bold text-purple-800'}, 'AI Study Companion'),
            React.createElement('p', {className: 'text-gray-600'}, 'Welcome, ' + user.username + '!')
          ),
          React.createElement('main', {className: 'bg-white p-8 rounded-3xl shadow-xl'},
            React.createElement('div', {className: 'flex gap-4 mb-8'},
              React.createElement('input', {
                type: 'text',
                placeholder: 'Enter topic...',
                className: 'flex-1 p-4 border-2 border-purple-200 rounded-full text-lg',
                value: topic,
                onChange: e => setTopic(e.target.value)
              }),
              React.createElement('button', {
                onClick: generate,
                disabled: loading,
                className: 'px-8 py-4 bg-purple-600 text-white rounded-full font-bold'
              }, loading ? 'Generating...' : 'Generate'),
              React.createElement('div', {className: 'text-sm text-gray-500 flex items-center'}, 'Free: ' + generationCount + '/10')
            ),
            React.createElement('div', {className: 'flex justify-center mb-8'},
              React.createElement('div', {className: 'flex bg-gray-100 rounded-full p-1'},
                ['quiz', 'flashcards'].map(t => 
                  React.createElement('button', {
                    key: t,
                    onClick: () => setTab(t),
                    className: 'px-6 py-2 rounded-full ' + (tab === t ? 'bg-purple-500 text-white' : 'text-gray-600')
                  }, t.charAt(0).toUpperCase() + t.slice(1))
                )
              )
            ),
            content && React.createElement('div', {className: 'space-y-4'},
              content.map((item, i) => 
                React.createElement('div', {key: i, className: 'bg-gray-50 p-6 rounded-xl'},
                  tab === 'quiz' ? [
                    React.createElement('p', {key: 'q', className: 'font-bold mb-4'}, 'Q' + (i + 1) + '. ' + item.question),
                    React.createElement('ul', {key: 'opts', className: 'space-y-2'}, 
                      item.options?.map((opt, j) => 
                        React.createElement('li', {key: j, className: 'p-3 bg-white rounded-lg'}, opt)
                      )
                    ),
                    React.createElement('p', {key: 'ans', className: 'mt-4 text-green-600 font-semibold'}, 'Answer: ' + item.answer)
                  ] : [
                    React.createElement('p', {key: 'term', className: 'font-bold'}, item.term),
                    React.createElement('p', {key: 'def', className: 'text-gray-600'}, item.definition)
                  ]
                )
              )
            )
          ),
          showSubscription && React.createElement('div', {className: 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50'},
            React.createElement('div', {className: 'bg-white p-8 rounded-3xl shadow-2xl max-w-md mx-4'},
              React.createElement('h2', {className: 'text-2xl font-bold text-center mb-4'}, 'Upgrade to Premium'),
              React.createElement('p', {className: 'text-gray-600 text-center mb-6'}, 'You have used all 10 free generations! Subscribe for unlimited access.'),
              React.createElement('div', {className: 'bg-gradient-to-r from-purple-600 to-blue-600 text-white p-4 rounded-xl text-center mb-6'},
                React.createElement('h3', {className: 'font-bold text-lg'}, 'Premium Plan'),
                React.createElement('p', {className: 'text-sm opacity-90'}, 'Unlimited generations'),
                React.createElement('p', {className: 'text-2xl font-bold mt-2'}, '$9.99/month')
              ),
              React.createElement('div', {className: 'flex gap-3'},
                React.createElement('button', {
                  onClick: () => setShowSubscription(false),
                  className: 'flex-1 px-4 py-2 border border-gray-300 rounded-lg'
                }, 'Maybe Later'),
                React.createElement('button', {
                  onClick: () => alert('Subscription coming soon!'),
                  className: 'flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg font-semibold'
                }, 'Subscribe Now')
              )
            )
          )
        )
      );
    }
    
    ReactDOM.render(React.createElement(App), document.getElementById('root'));
  </script>
</body>
</html>`);
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