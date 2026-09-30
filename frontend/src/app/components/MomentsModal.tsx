'use client';

import React, { useEffect } from 'react';

interface MomentsModalProps {
  momentList: string[];
  onClose: () => void;
  isMuted?: boolean;
  isTextHidden?: boolean;
}

export default function MomentsModal({
  momentList,
  onClose,
  isMuted = false,
  isTextHidden = false
}: MomentsModalProps) {
  useEffect(() => {
    // Text-to-speech for moment list when component mounts
    if (!isMuted && momentList.length > 0) {
      const speech = new SpeechSynthesisUtterance("Moments: " + momentList.join(". "));
      window.speechSynthesis.speak(speech);
    }

    // Cleanup function to cancel any speech when component unmounts
    return () => {
      window.speechSynthesis.cancel();
    };
  }, [momentList, isMuted]);

  if (momentList.length === 0) return null;

  const handleCloseClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.speechSynthesis.cancel(); // Stop speech when closing
    onClose();
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-30">
      {/* Semi-transparent overlay */}
      <div className="absolute inset-0 bg-black bg-opacity-50" onClick={onClose}></div>

      {/* Modal content */}
      <div
        className="relative bg-black border-2 border-green-500 rounded-lg p-6 w-2/3 h-2/3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center">
          <h3 className="text-green-500 font-semibold mb-4 text-xl">Moments:</h3>
          <button className="text-white" onClick={handleCloseClick}>Close</button>
        </div>
        {!isTextHidden && (
          <ol className="list-decimal list-inside text-green-500 space-y-2 overflow-y-auto max-h-[calc(100%-4rem)]">
            {momentList.map((moment, i) => (
              <li key={i} className="font-semibold text-3xl">
                {moment}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}