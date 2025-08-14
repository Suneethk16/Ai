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
      
      const [topic, setTopic] = useState('');
      const [content, setContent] = useState(null);
      const [loading, setLoading] = useState(false);
      const [studyError, setStudyError] = useState('');
      const [activeTab, setActiveTab] = useState('quiz');
      const [selectedAnswers, setSelectedAnswers] = useState({});
      const [flippedCards, setFlippedCards] = useState({});
      const [expandedConcepts, setExpandedConcepts] = useState({});
      
      const generateContent = async () => {
        if (!topic.trim()) {
          setStudyError('Please enter a topic to get started.');
          return;
        }
        setLoading(true);
        setStudyError('');
        setContent(null);
        
        try {
          const apiKey = 'AIzaSyCSyd7_6ZAJwSHaN12Ik1Ld-JMD4boKvzE';
          const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;
          
          let prompt = '';
          let responseSchema = {};
          
          if (activeTab === 'quiz') {
            prompt = `Generate a JSON object for a multiple-choice quiz about "${topic}". The JSON should be an array of objects. Each object should have a 'question' (string), an 'options' array of strings, and an 'answer' (string).`;
            responseSchema = {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  question: { type: 'STRING' },
                  options: { type: 'ARRAY', items: { type: 'STRING' } },
                  answer: { type: 'STRING' }
                }
              }
            };
          } else if (activeTab === 'flashcards') {
            prompt = `Generate a JSON object for flashcards about "${topic}". The JSON should be an array of objects. Each object should have a 'term' (string) and a 'definition' (string).`;
            responseSchema = {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  term: { type: 'STRING' },
                  definition: { type: 'STRING' }
                }
              }
            };
          } else if (activeTab === 'mindmap') {
            prompt = `Generate a JSON object for mind map concepts about "${topic}". The JSON should be an array of objects. Each object should have a 'concept' (string) and a 'related_concepts' array of strings.`;
            responseSchema = {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  concept: { type: 'STRING' },
                  related_concepts: { type: 'ARRAY', items: { type: 'STRING' } }
                }
              }
            };
          }
          
          const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              generationConfig: {
                responseMimeType: 'application/json',
                responseSchema: responseSchema
              }
            })
          });
          
          const result = await response.json();
          if (result.candidates && result.candidates[0] && result.candidates[0].content) {
            const jsonResponse = result.candidates[0].content.parts[0].text;
            const parsedContent = JSON.parse(jsonResponse);
            setContent(parsedContent);
            
            // Log activity
            await fetch('/api/activity', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userId: user.id,
                action: 'generate_content',
                data: { type: activeTab, topic: topic }
              })
            });
          } else {
            throw new Error('Invalid API response');
          }
        } catch (err) {
          console.error(err);
          setStudyError('Failed to generate content. Please try again.');
        } finally {
          setLoading(false);
        }
      };
      
      const handleOptionClick = (questionIndex, selectedOption) => {
        setSelectedAnswers(prev => ({ ...prev, [questionIndex]: selectedOption }));
      };
      
      const handleCardFlip = (index) => {
        setFlippedCards(prev => ({ ...prev, [index]: !prev[index] }));
      };
      
      const toggleConcept = (index) => {
        setExpandedConcepts(prev => ({ ...prev, [index]: !prev[index] }));
      };
      
      const renderContent = () => {
        if (loading) {
          return React.createElement('div', { className: 'flex justify-center items-center h-64' },
            React.createElement('div', { className: 'text-center' },
              React.createElement('div', { className: 'animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500 mx-auto mb-4' }),
              React.createElement('span', { className: 'text-lg text-gray-600' }, 'Generating content...')
            )
          );
        }
        if (studyError) {
          return React.createElement('div', { className: 'flex justify-center items-center h-64' },
            React.createElement('p', { className: 'text-red-500 text-lg' }, studyError)
          );
        }
        if (content) {
          if (activeTab === 'quiz') {
            return React.createElement('div', { className: 'space-y-6' },
              content.map((q, index) => 
                React.createElement('div', { key: index, className: 'bg-white p-6 rounded-2xl shadow-lg border-l-4 border-purple-500' },
                  React.createElement('p', { className: 'font-semibold text-lg mb-4 text-gray-800' }, q.question),
                  React.createElement('ul', { className: 'space-y-2' },
                    q.options.map((option, oIndex) => {
                      const selectedOption = selectedAnswers[index];
                      let className = 'p-3 rounded-lg cursor-pointer transition-colors ';
                      if (!selectedOption) {
                        className += 'bg-gray-100 hover:bg-gray-200';
                      } else if (option === q.answer) {
                        className += 'bg-green-500 text-white';
                      } else if (option === selectedOption && option !== q.answer) {
                        className += 'bg-red-500 text-white';
                      } else {
                        className += 'bg-gray-100';
                      }
                      return React.createElement('li', {
                        key: oIndex,
                        className: className,
                        onClick: () => handleOptionClick(index, option)
                      }, option);
                    })
                  )
                )
              )
            );
          } else if (activeTab === 'flashcards') {
            return React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6' },
              content.map((card, index) =>
                React.createElement('div', {
                  key: index,
                  className: 'bg-white rounded-2xl shadow-lg p-6 h-48 flex flex-col justify-between transform transition-all duration-300 hover:scale-105 cursor-pointer',
                  onClick: () => handleCardFlip(index)
                },
                  React.createElement('div', { className: 'flex-1 flex items-center justify-center text-center' },
                    flippedCards[index] ?
                      React.createElement('p', { className: 'text-gray-600 text-lg' }, card.definition) :
                      React.createElement('p', { className: 'text-xl font-bold text-gray-800' }, card.term)
                  ),
                  React.createElement('div', { className: 'flex justify-between items-center mt-4' },
                    React.createElement('span', { className: 'text-sm text-gray-400' }, `Card ${index + 1}`),
                    React.createElement('span', { className: 'text-xs text-purple-500' },
                      `${flippedCards[index] ? 'Definition' : 'Term'} • Click to flip`
                    )
                  )
                )
              )
            );
          } else if (activeTab === 'mindmap') {
            const mainTopic = content.length > 0 ? content[0].concept : 'Main Topic';
            return React.createElement('div', { className: 'flex flex-col items-center' },
              React.createElement('div', { className: 'relative p-6 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-full shadow-2xl mb-12' },
                React.createElement('p', { className: 'text-2xl font-bold' }, mainTopic)
              ),
              React.createElement('div', { className: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8' },
                content.map((concept, index) =>
                  React.createElement('div', { key: index, className: 'relative' },
                    React.createElement('div', {
                      className: 'bg-white p-6 rounded-2xl shadow-lg border-l-4 border-purple-400 cursor-pointer transform transition-all duration-300 hover:scale-105',
                      onClick: () => toggleConcept(index)
                    },
                      React.createElement('div', { className: 'flex justify-between items-center' },
                        React.createElement('p', { className: 'font-bold text-lg text-purple-700' }, concept.concept),
                        React.createElement('span', { className: 'text-purple-500 text-xl' },
                          expandedConcepts[index] ? '−' : '+'
                        )
                      ),
                      expandedConcepts[index] && React.createElement('div', { className: 'mt-4 space-y-2' },
                        concept.related_concepts.map((related, rIndex) =>
                          React.createElement('div', {
                            key: rIndex,
                            className: 'bg-purple-50 p-3 rounded-lg text-gray-700 border-l-2 border-purple-300'
                          }, related)
                        )
                      )
                    )
                  )
                )
              ),
              React.createElement('div', { className: 'mt-8 text-center text-sm text-gray-500' },
                'Click on concepts to expand related topics'
              )
            );
          }
        }
        return React.createElement('div', { className: 'flex flex-col items-center justify-center h-64 text-center text-gray-500' },
          React.createElement('div', { className: 'text-6xl mb-4' }, '✨'),
          React.createElement('p', { className: 'text-xl font-medium' }, 'Enter a topic and generate your study materials!')
        );
      };
      
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
            // Generator Form
            React.createElement('div', { className: 'flex flex-col md:flex-row items-center space-y-4 md:space-y-0 md:space-x-4 mb-8' },
              React.createElement('div', { className: 'relative flex-grow w-full' },
                React.createElement('input', {
                  type: 'text',
                  className: 'w-full p-4 pl-12 rounded-full border-2 border-purple-200 focus:outline-none focus:ring-4 focus:ring-purple-300 transition-all duration-300 text-lg',
                  placeholder: 'E.g., The circulatory system',
                  value: topic,
                  onChange: (e) => setTopic(e.target.value),
                  onKeyDown: (e) => e.key === 'Enter' && generateContent()
                }),
                React.createElement('div', { className: 'absolute left-4 top-1/2 transform -translate-y-1/2 text-purple-400 text-2xl' }, '📚')
              ),
              React.createElement('button', {
                onClick: generateContent,
                disabled: loading,
                className: `w-full md:w-auto px-8 py-4 rounded-full text-white font-bold text-lg transition-all duration-300 ease-in-out transform shadow-lg ${
                  loading ? 'bg-purple-300 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-700 active:scale-95'
                }`
              }, loading ? 'Generating...' : 'Generate')
            ),
            // Tab Navigation
            React.createElement('div', { className: 'flex justify-center mb-12' },
              React.createElement('div', { className: 'flex bg-gray-100 rounded-full p-1 shadow-inner' },
                ['quiz', 'flashcards', 'mindmap'].map(tab =>
                  React.createElement('button', {
                    key: tab,
                    onClick: () => setActiveTab(tab),
                    className: `flex-1 flex items-center justify-center py-2 px-6 rounded-full font-medium transition-all duration-300 ${
                      activeTab === tab ? 'bg-purple-500 text-white shadow-md' : 'text-gray-600 hover:bg-gray-200'
                    }`
                  },
                    React.createElement('span', { className: 'mr-2' }, 
                      tab === 'quiz' ? '💡' : tab === 'flashcards' ? '📚' : '🧠'
                    ),
                    tab.charAt(0).toUpperCase() + tab.slice(1)
                  )
                )
              )
            ),
            // Content Area
            renderContent()
          ),
          React.createElement('footer', { className: 'mt-8 text-center text-sm text-gray-500' },
            React.createElement('p', null, 'Developed by suneethk176 | © 2025 All rights reserved')
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