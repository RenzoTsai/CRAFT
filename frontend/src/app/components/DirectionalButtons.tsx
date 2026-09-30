'use client';

import React, { useEffect } from 'react';
import { FaPencilAlt, FaCamera, FaEyeSlash, FaEye, FaMicrophone, FaVolumeMute, FaVolumeUp, FaTimes } from 'react-icons/fa';

interface DirectionalButtonsProps {
  buttonsVisible: boolean;
  isProcessing?: boolean;
  onButtonClick: (direction: string) => void;
  isMuted: boolean;
  isTextHidden: boolean;
  authoringPhase: string; // New prop to track if we're in moment list view
}

export default function DirectionalButtons({
  buttonsVisible,
  isProcessing = false,
  onButtonClick,
  isMuted = false,
  isTextHidden = false,
  authoringPhase = 'none',
}: DirectionalButtonsProps) {
  const visibilityClass = buttonsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none';

  // Check if we're in selection or full mode
  const isSelectionOrFull = authoringPhase === 'selection' || authoringPhase === 'full';

  // Role-play uses the left and right controls.
  const isRolePlay = authoringPhase.startsWith('role-play');
  const isAuthoringView = ['question', 'generating-image', 'showing-image'].includes(authoringPhase) || isRolePlay;

  // Map keypress events to button clicks
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'Escape' && isRolePlay) {
        onButtonClick('exit-role-play');
      } else if (e.key === 'ArrowLeft') {
        onButtonClick('left');
      } else if (e.key === 'ArrowUp') {
        onButtonClick('top');
      } else if (e.key === 'ArrowDown') {
        onButtonClick('bottom');
      } else if (e.key === 'ArrowRight') {
        onButtonClick('right');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onButtonClick, isRolePlay]);

  // Keep keyboard interactions available while the visual controls are hidden.
  if (isProcessing) {
    return null;
  }

  return (
    <div onClick={event => event.stopPropagation()} className={`fixed inset-0 ${visibilityClass} transition-opacity duration-300 pointer-events-none z-50`}>
      {/* Top button - changes based on mode */}
      {!isAuthoringView && <button
        className="absolute top-5 left-1/2 -translate-x-1/2 bg-transparent border-2 border-green-500 text-green-500 p-3 rounded-xl hover:bg-green-900 pointer-events-auto"
        onClick={() => onButtonClick('top')}
        title={isSelectionOrFull ? (isMuted ? "Unmute" : "Mute") : "Generate Summary"}
      >
        {isSelectionOrFull
          ? (isMuted ? <FaVolumeMute size={24} /> : <FaVolumeUp size={24} />)
          : <FaPencilAlt size={24} />
        }
      </button>}

      {/* Bottom button - changes based on mode */}
      {!isAuthoringView && <button
        className="absolute bottom-5 left-1/2 -translate-x-1/2 bg-transparent border-2 border-green-500 text-green-500 p-3 rounded-xl hover:bg-green-900 pointer-events-auto"
        onClick={() => onButtonClick('bottom')}
        title={isSelectionOrFull ? (isTextHidden ? "Show Text" : "Hide Text") : "Take Photo"}
      >
        {isSelectionOrFull
          ? (isTextHidden ? <FaEye size={24} /> : <FaEyeSlash size={24} />)
          : <FaCamera size={24} />
        }
      </button>}

      {/* Left button - changes based on mode */}
      <button
        className="absolute left-5 top-1/2 -translate-y-1/2 bg-transparent border-2 border-green-500 text-green-500 p-3 rounded-xl hover:bg-green-900 pointer-events-auto"
        onClick={() => onButtonClick('left')}
        title={isRolePlay ? "Exit role-play" : isSelectionOrFull ? "Close Interface" : "Hide Text Box"}
      >
        {isSelectionOrFull ? <FaTimes size={24} /> : <FaEyeSlash size={24} />}
      </button>

      {/* Right button - Voice Recognition (same in both modes) */}
      <button
        className="absolute right-5 top-1/2 -translate-y-1/2 bg-transparent border-2 border-green-500 text-green-500 p-3 rounded-xl hover:bg-green-900 pointer-events-auto"
        onClick={() => onButtonClick('right')}
        title="Voice Recognition"
      >
        <FaMicrophone size={24} />
      </button>
    </div>
  );
}
