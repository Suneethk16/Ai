import React, { useState } from 'react';
import { Sparkles, Loader2, LogOut } from 'lucide-react';
import GeneratorForm from './components/GeneratorForm';
import Quiz from './components/Quiz';
import Flashcards from './components/Flashcards';
import MindMap from './components/MindMap';
import Login from './components/Login';
import db from './services/database';

// Main application component
const App = () => {
  // State management for the entire application
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState(null);
  const [topic, setTopic] = useState('');
  const [content, setContent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('quiz'); // 'quiz', 'flashcards', 'mindmap'

  const handleLogin = (userData) => {
    setUser(userData);
    setIsLoggedIn(true);
    db.logActivity(userData.id, 'login', { timestamp: new Date().toISOString() });
  };

  const handleLogout = () => {
    if (user) {
      db.logActivity(user.id, 'logout', { timestamp: new Date().toISOString() });
    }
    setIsLoggedIn(false);
    setUser(null);
    setTopic('');
    setContent(null);
  };

  // Handles the API call with exponential backoff for retries
  const callApiWithBackoff = async (payload, retries = 3, delay = 1000) => {
    try {
      const apiKey = "AIzaSyCSyd7_6ZAJwSHaN12Ik1Ld-JMD4boKvzE";
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`API call failed with status: ${response.status}`);
      }

      const result = await response.json();
      if (result.candidates && result.candidates.length > 0 && result.candidates[0].content && result.candidates[0].content.parts && result.candidates[0].content.parts.length > 0) {
        return result.candidates[0].content.parts[0].text;
      } else {
        throw new Error('API response format is unexpected or content is missing.');
      }
    } catch (err) {
      if (retries > 0) {
        console.warn(`API call failed, retrying in ${delay}ms...`);
        await new Promise(res => setTimeout(res, delay));
        return callApiWithBackoff(payload, retries - 1, delay * 2);
      } else {
        throw err;
      }
    }
  };

  // Main function to trigger content generation
  const generateContent = async () => {
    if (!topic.trim()) {
      setError('Please enter a topic to get started.');
      return;
    }
    setLoading(true);
    setError('');
    setContent(null);

    let prompt = '';
    let responseMimeType = '';
    let responseSchema = {};

    switch (activeTab) {
      case 'quiz':
        prompt = `Generate a JSON object for a multiple-choice quiz about "${topic}". The JSON should be an array of objects. Each object should have a 'question' (string), an 'options' array of strings, and an 'answer' (string).`;
        responseMimeType = 'application/json';
        responseSchema = {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              question: { type: 'STRING' },
              options: {
                type: 'ARRAY',
                items: { type: 'STRING' },
              },
              answer: { type: 'STRING' },
            },
            propertyOrdering: ['question', 'options', 'answer'],
          },
        };
        break;
      case 'flashcards':
        prompt = `Generate a JSON object for flashcards about "${topic}". The JSON should be an array of objects. Each object should have a 'term' (string) and a 'definition' (string).`;
        responseMimeType = 'application/json';
        responseSchema = {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              term: { type: 'STRING' },
              definition: { type: 'STRING' },
            },
            propertyOrdering: ['term', 'definition'],
          },
        };
        break;
      case 'mindmap':
        prompt = `Generate a JSON object for mind map concepts about "${topic}". The JSON should be an array of objects. Each object should have a 'concept' (string) and a 'related_concepts' array of strings. The root concept should be the topic itself.`;
        responseMimeType = 'application/json';
        responseSchema = {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              concept: { type: 'STRING' },
              related_concepts: {
                type: 'ARRAY',
                items: { type: 'STRING' },
              },
            },
            propertyOrdering: ['concept', 'related_concepts'],
          },
        };
        break;
      default:
        setLoading(false);
        return;
    }

    const payload = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: responseMimeType,
        responseSchema: responseSchema,
      },
    };

    try {
      const jsonResponse = await callApiWithBackoff(payload);
      const parsedContent = JSON.parse(jsonResponse);
      setContent(parsedContent);
      
      // Log activity
      if (user) {
        db.logActivity(user.id, 'generate_content', {
          type: activeTab,
          topic: topic,
          timestamp: new Date().toISOString()
        });
      }
    } catch (err) {
      console.error(err);
      setError('Failed to generate content. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Renders the main content based on the active tab, loading state, and errors
  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex justify-center items-center h-64">
          <Loader2 className="animate-spin text-purple-500" size={48} />
          <span className="ml-4 text-lg text-gray-600">Generating content...</span>
        </div>
      );
    }
    if (error) {
      return (
        <div className="flex justify-center items-center h-64">
          <p className="text-red-500 text-lg">{error}</p>
        </div>
      );
    }
    if (content) {
      switch (activeTab) {
        case 'quiz':
          return <Quiz data={content} user={user} />;
        case 'flashcards':
          return <Flashcards data={content} user={user} />;
        case 'mindmap':
          return <MindMap data={content} user={user} />;
        default:
          return null;
      }
    }
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center text-gray-500">
        <Sparkles className="text-purple-300 mb-4" size={64} />
        <p className="text-xl font-medium">Enter a topic and generate your study materials!</p>
      </div>
    );
  };

  if (!isLoggedIn) {
    return <Login onLogin={handleLogin} />;
  }

  return (
    <div className="min-h-screen bg-gray-50 font-sans p-6 md:p-12 text-gray-900 flex justify-center">
      <div className="w-full max-w-5xl">
        <header className="mb-12 text-center relative">
          <button
            onClick={handleLogout}
            className="absolute top-0 right-0 flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
          >
            <LogOut size={16} />
            Logout
          </button>
          <h1 className="text-5xl font-extrabold text-purple-800 tracking-tight">AI Study Companion</h1>
          <p className="mt-2 text-sm text-gray-500">Welcome back, {user?.username}!</p>
          <p className="mt-2 text-lg text-gray-600 max-w-2xl mx-auto">
            Generate custom quizzes, flashcards, and mind map concepts for any topic.
          </p>
        </header>
        
        <main className="bg-white p-6 md:p-10 rounded-3xl shadow-2xl">
          <GeneratorForm 
            topic={topic}
            setTopic={setTopic}
            loading={loading}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            onGenerate={generateContent}
          />
          {renderContent()}
        </main>
        
        <footer className="mt-8 text-center text-sm text-gray-500">
          <p>Developed by suneethk176 | © 2024 All rights reserved</p>
        </footer>
      </div>
    </div>
  );
};

export default App;
