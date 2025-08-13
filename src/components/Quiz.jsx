import React, { useState } from 'react';
import db from '../services/database';

const Quiz = ({ data, user, onSubscribe }) => {
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [showSubscription, setShowSubscription] = useState(false);
  
  const maxFreeQuestions = 10;
  const limitedData = data.slice(0, maxFreeQuestions);

  const handleOptionClick = (selectedOption) => {
    setSelectedAnswers(prev => ({
      ...prev,
      [currentQuestion]: selectedOption
    }));
    
    // Log quiz interaction
    if (user) {
      const isCorrect = selectedOption === limitedData[currentQuestion].answer;
      db.logActivity(user.id, 'quiz_answer', {
        questionIndex: currentQuestion,
        selectedOption,
        correctAnswer: limitedData[currentQuestion].answer,
        isCorrect,
        timestamp: new Date().toISOString()
      });
    }
  };

  const handleNext = () => {
    if (currentQuestion < limitedData.length - 1) {
      setCurrentQuestion(currentQuestion + 1);
    } else if (currentQuestion === limitedData.length - 1 && data.length > maxFreeQuestions) {
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
    if (!selectedOption) return "bg-gray-100 hover:bg-gray-200 cursor-pointer";
    
    if (option === correctAnswer) return "bg-green-500 text-white";
    if (option === selectedOption && option !== correctAnswer) return "bg-red-500 text-white";
    return "bg-gray-100";
  };

  if (showSubscription) {
    return (
      <div className="bg-white p-8 rounded-2xl shadow-lg text-center">
        <h3 className="text-2xl font-bold text-gray-800 mb-4">🎓 Upgrade to Premium</h3>
        <p className="text-gray-600 mb-6">You've completed your 10 free quiz questions! Upgrade to access unlimited questions and more features.</p>
        <button 
          onClick={onSubscribe}
          className="bg-gradient-to-r from-purple-600 to-blue-600 text-white px-8 py-3 rounded-full font-semibold hover:shadow-lg transition-all"
        >
          Subscribe for $9.99/month
        </button>
      </div>
    );
  }

  const currentQ = limitedData[currentQuestion];
  const progress = ((currentQuestion + 1) / limitedData.length) * 100;

  return (
    <div className="space-y-6">
      <div className="bg-gray-200 rounded-full h-2 mb-4">
        <div className="bg-purple-600 h-2 rounded-full transition-all" style={{width: `${progress}%`}}></div>
      </div>
      
      <div className="bg-white p-6 rounded-2xl shadow-lg border-l-4 border-purple-500">
        <div className="flex justify-between items-center mb-4">
          <span className="text-sm text-gray-500">Question {currentQuestion + 1} of {limitedData.length}</span>
          {data.length > maxFreeQuestions && (
            <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded">Free: {maxFreeQuestions} questions</span>
          )}
        </div>
        
        <p className="font-semibold text-lg mb-4 text-gray-800">{currentQ.question}</p>
        <ul className="space-y-2 mb-6">
          {currentQ.options.map((option, oIndex) => (
            <li 
              key={oIndex} 
              className={`p-3 rounded-lg text-gray-700 transition-colors ${getOptionStyle(option, currentQ.answer)}`}
              onClick={() => handleOptionClick(option)}
            >
              {option}
            </li>
          ))}
        </ul>
        
        <div className="flex justify-between">
          <button 
            onClick={handlePrevious}
            disabled={currentQuestion === 0}
            className="px-4 py-2 bg-gray-300 text-gray-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-400 transition-colors"
          >
            Previous
          </button>
          
          <button 
            onClick={handleNext}
            disabled={!selectedAnswers[currentQuestion]}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-purple-700 transition-colors"
          >
            {currentQuestion === limitedData.length - 1 && data.length > maxFreeQuestions ? 'Upgrade for More' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Quiz;
