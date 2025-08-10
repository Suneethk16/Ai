import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());

let data = { users: {}, activities: [] };

app.post('/api/register', (req, res) => {
  const { username, email, password } = req.body;
  const existingUser = Object.values(data.users).find(u => u.username === username);
  if (existingUser) {
    return res.status(400).json({ success: false, error: 'Username already exists' });
  }
  const userId = Date.now().toString();
  data.users[userId] = { id: userId, username, email, password, created_at: new Date().toISOString() };
  res.json({ success: true, user: data.users[userId] });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = Object.values(data.users).find(u => u.username === username && u.password === password);
  if (user) {
    res.json({ success: true, user });
  } else {
    res.status(401).json({ success: false, error: 'Invalid credentials' });
  }
});

app.post('/api/activity', (req, res) => {
  data.activities.push({ id: Date.now().toString(), ...req.body, timestamp: new Date().toISOString() });
  res.json({ success: true });
});

app.get('*', (req, res) => {
  res.send(`<!DOCTYPE html>
<html><head><title>AI Study Companion</title><script src="https://unpkg.com/react@18/umd/react.production.min.js"></script><script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script><script src="https://cdn.tailwindcss.com"></script></head>
<body><div id="root"></div><script>
const {useState} = React;
function App() {
  const [user, setUser] = useState(null);
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({username:'',email:'',password:'',confirmPassword:''});
  const [error, setError] = useState('');
  const [topic, setTopic] = useState('');
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('quiz');
  const [selectedAnswers, setSelectedAnswers] = useState({});
  
  const handleAuth = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const url = mode === 'login' ? '/api/login' : '/api/register';
      const body = mode === 'login' ? {username: form.username, password: form.password} : form;
      const res = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
      const result = await res.json();
      if (result.success) {
        if (mode === 'login') setUser(result.user);
        else setMode('login');
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError('Request failed');
    }
  };
  
  const generate = async () => {
    if (!topic) return;
    setLoading(true);
    setSelectedAnswers({});
    try {
      const prompt = tab === 'quiz' ? 
        'Generate 10 quiz questions about "' + topic + '" as JSON array with question, options, answer' :
        tab === 'flashcards' ?
        'Generate 8 flashcards about "' + topic + '" as JSON array with term, definition' :
        'Generate mind map for "' + topic + '" as JSON array with concept, related_concepts';
      
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=AIzaSyCSyd7_6ZAJwSHaN12Ik1Ld-JMD4boKvzE', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({contents: [{role: 'user', parts: [{text: prompt}]}]})
      });
      const result = await res.json();
      const text = result.candidates[0].content.parts[0].text;
      const json = JSON.parse(text.replace(/\`\`\`json|\\n|\`\`\`/g, ''));
      setContent(json);
      setSelectedAnswers({});
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };
  
  if (!user) {
    return React.createElement('div', {className: 'min-h-screen bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center p-6'},
      React.createElement('div', {className: 'bg-white rounded-3xl shadow-2xl p-8 w-full max-w-md'},
        React.createElement('h1', {className: 'text-3xl font-bold text-center mb-8'}, mode === 'login' ? 'Welcome Back' : 'Create Account'),
        React.createElement('form', {onSubmit: handleAuth, className: 'space-y-4'},
          React.createElement('input', {type: 'text', placeholder: 'Username', className: 'w-full p-3 border rounded-xl', value: form.username, onChange: e => setForm({...form, username: e.target.value})}),
          mode === 'signup' && React.createElement('input', {type: 'email', placeholder: 'Email', className: 'w-full p-3 border rounded-xl', value: form.email, onChange: e => setForm({...form, email: e.target.value})}),
          React.createElement('input', {type: 'password', placeholder: 'Password', className: 'w-full p-3 border rounded-xl', value: form.password, onChange: e => setForm({...form, password: e.target.value})}),
          mode === 'signup' && React.createElement('input', {type: 'password', placeholder: 'Confirm Password', className: 'w-full p-3 border rounded-xl', value: form.confirmPassword, onChange: e => setForm({...form, confirmPassword: e.target.value})}),
          error && React.createElement('p', {className: 'text-red-500 text-center'}, error),
          React.createElement('button', {type: 'submit', className: 'w-full bg-purple-600 text-white py-3 rounded-xl font-semibold'}, mode === 'login' ? 'Sign In' : 'Create Account'),
          React.createElement('p', {className: 'text-center mt-4'}, 
            mode === 'login' ? "Don't have an account? " : "Already have an account? ",
            React.createElement('button', {type: 'button', onClick: () => setMode(mode === 'login' ? 'signup' : 'login'), className: 'text-purple-600 font-semibold'}, mode === 'login' ? 'Sign Up' : 'Sign In')
          )
        )
      )
    );
  }
  
  return React.createElement('div', {className: 'min-h-screen bg-gray-50 p-6'},
    React.createElement('div', {className: 'max-w-5xl mx-auto'},
      React.createElement('header', {className: 'text-center mb-8 relative'},
        React.createElement('button', {onClick: () => setUser(null), className: 'absolute top-0 right-0 bg-red-500 text-white px-4 py-2 rounded-lg'}, 'Logout'),
        React.createElement('h1', {className: 'text-5xl font-bold text-purple-800'}, 'AI Study Companion'),
        React.createElement('p', {className: 'text-gray-600 mt-2'}, 'Welcome back, ' + user.username + '!')
      ),
      React.createElement('main', {className: 'bg-white p-8 rounded-3xl shadow-xl'},
        React.createElement('div', {className: 'flex gap-4 mb-8'},
          React.createElement('input', {type: 'text', placeholder: 'Enter topic...', className: 'flex-1 p-4 border-2 border-purple-200 rounded-full text-lg', value: topic, onChange: e => setTopic(e.target.value)}),
          React.createElement('button', {onClick: generate, disabled: loading, className: 'px-8 py-4 bg-purple-600 text-white rounded-full font-bold'}, loading ? 'Generating...' : 'Generate')
        ),
        React.createElement('div', {className: 'flex justify-center mb-8'},
          React.createElement('div', {className: 'flex bg-gray-100 rounded-full p-1'},
            ['quiz', 'flashcards', 'mindmap'].map(t => 
              React.createElement('button', {key: t, onClick: () => setTab(t), className: 'px-6 py-2 rounded-full ' + (tab === t ? 'bg-purple-500 text-white' : 'text-gray-600')}, t.charAt(0).toUpperCase() + t.slice(1))
            )
          )
        ),
        content && React.createElement('div', {className: 'space-y-4'},
          tab === 'quiz' && (() => {
            const totalQuestions = content.length;
            const answeredQuestions = Object.keys(selectedAnswers).length;
            const correctAnswers = Object.keys(selectedAnswers).filter(i => selectedAnswers[i] === content[i].answer).length;
            const score = totalQuestions > 0 ? Math.round((correctAnswers / totalQuestions) * 100) : 0;
            
            return [
              React.createElement('div', {key: 'score', className: 'bg-gradient-to-r from-purple-600 to-blue-600 text-white p-6 rounded-xl mb-6 text-center'},
                React.createElement('h3', {className: 'text-2xl font-bold mb-2'}, 'Quiz Score'),
                React.createElement('div', {className: 'flex justify-center space-x-8 text-lg'},
                  React.createElement('div', null, 'Score: ' + correctAnswers + '/' + totalQuestions + ' (' + score + '%)'),
                  React.createElement('div', null, 'Answered: ' + answeredQuestions + '/' + totalQuestions)
                )
              ),
              ...content.map((item, i) => 
                React.createElement('div', {key: i, className: 'bg-gray-50 p-6 rounded-xl'},
                  React.createElement('p', {className: 'font-bold mb-4 text-lg'}, 'Q' + (i + 1) + '. ' + item.question),
                  React.createElement('ul', {className: 'space-y-2'}, item.options?.map((opt, j) => {
                    const selectedOption = selectedAnswers[i];
                    let className = 'p-3 rounded-lg cursor-pointer transition-colors ';
                    if (!selectedOption) {
                      className += 'bg-white hover:bg-purple-100';
                    } else if (opt === item.answer) {
                      className += 'bg-green-500 text-white';
                    } else if (opt === selectedOption && opt !== item.answer) {
                      className += 'bg-red-500 text-white';
                    } else {
                      className += 'bg-white';
                    }
                    return React.createElement('li', {
                      key: j, 
                      className: className,
                      onClick: () => setSelectedAnswers(prev => ({...prev, [i]: opt}))
                    }, opt);
                  }))
                )
              )
            ];
          })(),
          tab === 'flashcards' && content.map((item, i) => 
            React.createElement('div', {key: i, className: 'bg-gray-50 p-6 rounded-xl'},
              React.createElement('p', {className: 'font-bold'}, item.term),
              React.createElement('p', {className: 'text-gray-600'}, item.definition)
            )
          ),
          tab === 'mindmap' && content.map((item, i) => 
            React.createElement('div', {key: i, className: 'bg-gray-50 p-6 rounded-xl'},
              React.createElement('p', {className: 'font-bold'}, item.concept),
              React.createElement('ul', {className: 'mt-2 space-y-1'}, item.related_concepts?.map((rel, j) => React.createElement('li', {key: j, className: 'text-sm text-gray-600'}, '• ' + rel)))
            )
          )
        )
      )
    )
  );
}
ReactDOM.render(React.createElement(App), document.getElementById('root'));
</script></body></html>`);
});

app.listen(PORT, () => console.log('Server running on port ' + PORT));