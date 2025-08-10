import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

// Serve static files from dist directory
app.use(express.static(path.join(__dirname, 'dist')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// In-memory storage for simplicity
let data = { users: {}, activities: [] };

const readData = () => data;
const writeData = (newData) => { data = newData; };

// API Routes
app.post('/api/register', (req, res) => {
  const { username, email, password } = req.body;
  const data = readData();
  
  const existingUser = Object.values(data.users).find(u => u.username === username);
  if (existingUser) {
    return res.status(400).json({ success: false, error: 'Username already exists' });
  }
  
  const userId = Date.now().toString();
  data.users[userId] = {
    id: userId,
    username,
    email,
    password,
    created_at: new Date().toISOString(),
    last_login: null
  };
  
  writeData(data);
  res.json({ success: true, user: data.users[userId] });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const data = readData();
  
  const user = Object.values(data.users).find(u => u.username === username && u.password === password);
  if (user) {
    user.last_login = new Date().toISOString();
    writeData(data);
    res.json({ success: true, user });
  } else {
    res.status(401).json({ success: false, error: 'Invalid credentials' });
  }
});

app.post('/api/activity', (req, res) => {
  const { userId, action, data: activityData } = req.body;
  const data = readData();
  
  data.activities.push({
    id: Date.now().toString(),
    user_id: userId,
    action,
    data: activityData,
    timestamp: new Date().toISOString()
  });
  
  writeData(data);
  res.json({ success: true });
});

app.get('/api/users', (req, res) => {
  const data = readData();
  res.json({ success: true, users: Object.values(data.users) });
});

app.get('/api/activities', (req, res) => {
  const data = readData();
  res.json({ success: true, activities: data.activities });
});

// Serve React app for all other routes
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'dist', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    // Complete React app as fallback
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Study Companion</title>
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body>
  <div id="root"></div>
  <script>
    const { useState } = React;
    
    function App() {
      const [isLoggedIn, setIsLoggedIn] = useState(false);
      const [user, setUser] = useState(null);
      const [mode, setMode] = useState('login');
      const [formData, setFormData] = useState({ username: '', email: '', password: '', confirmPassword: '' });
      const [error, setError] = useState('');
      const [success, setSuccess] = useState('');
      
      const handleLogin = (userData) => {
        setUser(userData);
        setIsLoggedIn(true);
      };
      
      const handleLogout = () => {
        setIsLoggedIn(false);
        setUser(null);
      };
      
      const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSuccess('');
        
        if (mode === 'login') {
          if (!formData.username || !formData.password) {
            setError('Please fill in all fields');
            return;
          }
          try {
            const response = await fetch('/api/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ username: formData.username, password: formData.password })
            });
            const result = await response.json();
            if (result.success) {
              handleLogin(result.user);
            } else {
              setError('Invalid username or password');
            }
          } catch (err) {
            setError('Login failed');
          }
        } else if (mode === 'signup') {
          if (!formData.username || !formData.email || !formData.password || !formData.confirmPassword) {
            setError('Please fill in all fields');
            return;
          }
          if (formData.password !== formData.confirmPassword) {
            setError('Passwords do not match');
            return;
          }
          if (formData.username.length >= 3 && formData.password.length >= 6) {
            try {
              const response = await fetch('/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: formData.username, email: formData.email, password: formData.password })
              });
              const result = await response.json();
              if (result.success) {
                setSuccess('Account created successfully! You can now login.');
                setTimeout(() => setMode('login'), 2000);
              } else {
                setError(result.error || 'Registration failed');
              }
            } catch (err) {
              setError('Registration failed');
            }
          } else {
            setError('Username must be 3+ chars, password 6+ chars');
          }
        }
      };
      
      if (!isLoggedIn) {
        return React.createElement('div', { className: 'min-h-screen bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center p-6' },
          React.createElement('div', { className: 'bg-white rounded-3xl shadow-2xl p-8 w-full max-w-md' },
            React.createElement('div', { className: 'text-center mb-8' },
              React.createElement('h1', { className: 'text-3xl font-bold text-gray-800 mb-2' }, 
                mode === 'login' ? 'Welcome Back' : 'Create Account'
              ),
              React.createElement('p', { className: 'text-gray-600' }, 
                mode === 'login' ? 'Sign in to AI Study Companion' : 'Join AI Study Companion'
              )
            ),
            React.createElement('form', { onSubmit: handleSubmit, className: 'space-y-6' },
              React.createElement('input', {
                type: 'text',
                placeholder: 'Username',
                className: 'w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent',
                value: formData.username,
                onChange: (e) => setFormData({...formData, username: e.target.value})
              }),
              mode === 'signup' && React.createElement('input', {
                type: 'email',
                placeholder: 'Email',
                className: 'w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent',
                value: formData.email,
                onChange: (e) => setFormData({...formData, email: e.target.value})
              }),
              React.createElement('input', {
                type: 'password',
                placeholder: 'Password',
                className: 'w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent',
                value: formData.password,
                onChange: (e) => setFormData({...formData, password: e.target.value})
              }),
              mode === 'signup' && React.createElement('input', {
                type: 'password',
                placeholder: 'Confirm Password',
                className: 'w-full p-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent',
                value: formData.confirmPassword,
                onChange: (e) => setFormData({...formData, confirmPassword: e.target.value})
              }),
              error && React.createElement('p', { className: 'text-red-500 text-sm text-center' }, error),
              success && React.createElement('p', { className: 'text-green-500 text-sm text-center' }, success),
              React.createElement('button', {
                type: 'submit',
                className: 'w-full bg-gradient-to-r from-purple-600 to-blue-600 text-white py-3 rounded-xl font-semibold hover:from-purple-700 hover:to-blue-700 transition-all'
              }, mode === 'login' ? 'Sign In' : 'Create Account'),
              mode === 'login' && React.createElement('div', { className: 'mt-6 text-center' },
                React.createElement('p', { className: 'text-gray-500 text-sm' },
                  "Don't have an account? ",
                  React.createElement('button', {
                    onClick: () => setMode('signup'),
                    className: 'text-purple-600 hover:text-purple-800 font-semibold'
                  }, 'Sign Up')
                )
              )
            )
          )
        );
      }
      
      return React.createElement('div', { className: 'min-h-screen bg-gray-50 font-sans p-6 md:p-12 text-gray-900 flex justify-center' },
        React.createElement('div', { className: 'w-full max-w-5xl' },
          React.createElement('header', { className: 'mb-12 text-center relative' },
            React.createElement('button', {
              onClick: handleLogout,
              className: 'absolute top-0 right-0 flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors'
            }, 'Logout'),
            React.createElement('h1', { className: 'text-5xl font-extrabold text-purple-800 tracking-tight' }, 'AI Study Companion'),
            React.createElement('p', { className: 'mt-2 text-sm text-gray-500' }, 'Welcome back, ' + user.username + '!'),
            React.createElement('p', { className: 'mt-2 text-lg text-gray-600 max-w-2xl mx-auto' }, 'Generate custom quizzes, flashcards, and mind map concepts for any topic.')
          ),
          React.createElement('main', { className: 'bg-white p-6 md:p-10 rounded-3xl shadow-2xl' },
            React.createElement('div', { className: 'text-center' },
              React.createElement('h2', { className: 'text-2xl font-bold mb-4' }, 'AI Study Tools Coming Soon!'),
              React.createElement('p', { className: 'text-gray-600' }, 'Quiz, Flashcards, and Mind Map features will be available shortly.')
            )
          ),
          React.createElement('footer', { className: 'mt-8 text-center text-sm text-gray-500' },
            React.createElement('p', null, 'Developed by suneethk176 | © 2024 All rights reserved')
          )
        )
      );
    }
    
    ReactDOM.render(React.createElement(App), document.getElementById('root'));
  </script>
</body>
</html>
    `);
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Environment:', process.env.NODE_ENV);
  console.log('Dist exists:', fs.existsSync(path.join(__dirname, 'dist')));
});