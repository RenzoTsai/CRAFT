//frontend/src/app/components/Notification.tsx
'use client';

import React, { useState, useEffect } from 'react';

interface SuggestionNotificationProps {
  suggestion: {
    message: string;
    timestamp: number;
  } | null;
  isVisible: boolean;
}

const SuggestionNotification: React.FC<SuggestionNotificationProps> = ({
  suggestion: initialSuggestion,
  isVisible,
}) => {
  const [suggestion, setSuggestion] = useState(initialSuggestion);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [isShown, setIsShown] = useState(false);

  useEffect(() => {
    if (initialSuggestion && initialSuggestion.message && isVisible) {
      setSuggestion(initialSuggestion);
      setIsFadingOut(false);
      setIsShown(false); // Reset states for new suggestion

      // Trigger fade-in after a short delay
      const showTimer = setTimeout(() => {
        setIsShown(true);
      }, 100);

      // Start fading out after 15 seconds
      const fadeOutTimer = setTimeout(() => {
        setIsFadingOut(true);
      }, 15000);

      // Remove the component after 30 seconds
      const removeTimer = setTimeout(() => {
        setSuggestion(null);
      }, 30000);

      return () => {
        clearTimeout(showTimer);
        clearTimeout(fadeOutTimer);
        clearTimeout(removeTimer);
      };
    }
  }, [initialSuggestion, isVisible]);

  if (!suggestion || !suggestion.message || !isVisible) {
    return null;
  }

  const durationClass = isFadingOut ? 'duration-[15000ms]' : 'duration-3000';
  const opacityClass = isShown && !isFadingOut ? 'opacity-100' : 'opacity-0';

  return (
    <div
      className={`min-w-0 break-words
                 bg-blue-900 bg-opacity-80 text-white 
                 p-4 rounded-lg shadow-lg max-w-sm
                 transition-opacity ${durationClass} ease-in-out
                 ${opacityClass}`}
    >
      <div className="flex items-center">
        <span className="text-xl mr-3 shrink-0">💡</span>
        <span>{suggestion.message}</span>
      </div>
    </div>
  );
};

export default SuggestionNotification;
