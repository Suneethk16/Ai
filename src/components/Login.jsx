import React, { useState } from 'react';
import { User, Lock, Eye, EyeOff, Mail, ArrowLeft } from 'lucide-react';
import db from '../services/database';

const Login = ({ onLogin }) => {
  const [mode, setMode] = useState('login'); // 'login', 'signup', 'forgot'
  const [formData, setFormData] = useState({ username: '', email: '', password: '', confirmPassword: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

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
        const user = await db.loginUser(formData.username, formData.password);
        if (user) {
          onLogin(user);
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
          await db.createUser(formData.username, formData.email, formData.password);
          setSuccess('Account created successfully! You can now login.');
          setTimeout(() => setMode('login'), 2000);
        } catch (err) {
          setError(err.message || 'Registration failed');
        }
      } else {
        setError('Username must be 3+ chars, password 6+ chars');
      }
    } else if (mode === 'forgot') {
      if (!formData.email) {
        setError('Please enter your email');
        return;
      }
      setSuccess('Password reset link sent to your email!');
      setTimeout(() => setMode('login'), 2000);
    }
  };

  const resetForm = () => {
    setFormData({ username: '', email: '', password: '', confirmPassword: '' });
    setError('');
    setSuccess('');
  };

  const switchMode = (newMode) => {
    setMode(newMode);
    resetForm();
  };

  const getTitle = () => {
    switch (mode) {
      case 'login': return 'Welcome Back';
      case 'signup': return 'Create Account';
      case 'forgot': return 'Reset Password';
      default: return 'Welcome';
    }
  };

  const getSubtitle = () => {
    switch (mode) {
      case 'login': return 'Sign in to AI Study Companion';
      case 'signup': return 'Join AI Study Companion';
      case 'forgot': return 'Enter your email to reset password';
      default: return '';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl shadow-2xl p-8 w-full max-w-md">
        {mode !== 'login' && (
          <button
            onClick={() => switchMode('login')}
            className="flex items-center gap-2 text-gray-600 hover:text-gray-800 mb-4"
          >
            <ArrowLeft size={16} /> Back to Login
          </button>
        )}
        
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">{getTitle()}</h1>
          <p className="text-gray-600">{getSubtitle()}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {(mode === 'login' || mode === 'signup') && (
            <div className="relative">
              <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
              <input
                type="text"
                placeholder="Username"
                className="w-full pl-12 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                value={formData.username}
                onChange={(e) => setFormData({...formData, username: e.target.value})}
              />
            </div>
          )}

          {(mode === 'signup' || mode === 'forgot') && (
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
              <input
                type="email"
                placeholder="Email"
                className="w-full pl-12 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
              />
            </div>
          )}

          {(mode === 'login' || mode === 'signup') && (
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Password"
                className="w-full pl-12 pr-12 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                value={formData.password}
                onChange={(e) => setFormData({...formData, password: e.target.value})}
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          )}

          {mode === 'signup' && (
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
              <input
                type="password"
                placeholder="Confirm Password"
                className="w-full pl-12 pr-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                value={formData.confirmPassword}
                onChange={(e) => setFormData({...formData, confirmPassword: e.target.value})}
              />
            </div>
          )}

          {error && (
            <p className="text-red-500 text-sm text-center">{error}</p>
          )}
          
          {success && (
            <p className="text-green-500 text-sm text-center">{success}</p>
          )}

          <button
            type="submit"
            className="w-full bg-gradient-to-r from-purple-600 to-blue-600 text-white py-3 rounded-xl font-semibold hover:from-purple-700 hover:to-blue-700 transition-all"
          >
            {mode === 'login' ? 'Sign In' : mode === 'signup' ? 'Create Account' : 'Send Reset Link'}
          </button>
        </form>

        {mode === 'login' && (
          <div className="mt-6 text-center space-y-2">
            <button
              onClick={() => switchMode('forgot')}
              className="text-purple-600 hover:text-purple-800 text-sm"
            >
              Forgot Password?
            </button>
            <p className="text-gray-500 text-sm">
              Don't have an account?{' '}
              <button
                onClick={() => switchMode('signup')}
                className="text-purple-600 hover:text-purple-800 font-semibold"
              >
                Sign Up
              </button>
            </p>
          </div>
        )}

        <div className="mt-8 text-center text-sm text-gray-500">
          <p>Demo: Any username (3+ chars) & password (6+ chars)</p>
        </div>
      </div>
    </div>
  );
};

export default Login;