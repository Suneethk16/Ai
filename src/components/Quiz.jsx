import React, { useState } from 'react';
import db from '../services/database';

const Quiz = ({ data, user }) => {
  const [selectedAnswers, setSelectedAnswers] = useState({});

  const handleOptionClick = (questionIndex, selectedOption) => {
    setSelectedAnswers(prev => ({
      ...prev,
      [questionIndex]: selectedOption
    }));
    
    // Log quiz interaction
    if (user) {
      const isCorrect = selectedOption === data[questionIndex].answer;
      db.logActivity(user.id, 'quiz_answer', {
        questionIndex,
        selectedOption,
        correctAnswer: data[questionIndex].answer,
        isCorrect,
        timestamp: new Date().toISOString()
      });
    }
  };

  const getOptionStyle = (questionIndex, option, correctAnswer) => {
    const selectedOption = selectedAnswers[questionIndex];
    if (!selectedOption) return "bg-gray-100 hover:bg-gray-200 cursor-pointer";
    
    if (option === correctAnswer) return "bg-green-500 text-white";
    if (option === selectedOption && option !== correctAnswer) return "bg-red-500 text-white";
    return "bg-gray-100";
  };

  return (
    <div className="space-y-6">
      {data.map((q, index) => (
        <div key={index} className="bg-white p-6 rounded-2xl shadow-lg border-l-4 border-purple-500">
          <p className="font-semibold text-lg mb-4 text-gray-800">{q.question}</p>
          <ul className="space-y-2">
            {q.options.map((option, oIndex) => (
              <li 
                key={oIndex} 
                className={`p-3 rounded-lg text-gray-700 transition-colors ${getOptionStyle(index, option, q.answer)}`}
                onClick={() => handleOptionClick(index, option)}
              >
                {option}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
};

export default Quiz;
