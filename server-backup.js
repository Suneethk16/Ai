import express from 'express';
import cors from 'cors';
import pg from 'pg';

const { Pool } = pg;
const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:@localhost:5432/ai_study_companion',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

let memoryData = { users: {}, quizSessions: [], activities: [] };
let usePostgres = false;

// Initialize database
const initDB = async () => {
  try {
    await pool.query('SELECT NOW()');
    usePostgres = true;
    console.log('PostgreSQL connected');
  } catch (err) {
    console.log('Using memory storage');
    usePostgres = false;
  }
};

initDB();

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

// Main app route
app.get('*', (req, res) => {
  res.send(`<!DOCTYPE html>
<html><head><title>AI Study Companion</title></head>
<body><h1>AI Study Companion</h1><p>Server is running!</p></body></html>`);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});