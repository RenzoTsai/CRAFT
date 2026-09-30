'use client';

import React, { useState, useEffect, useRef } from 'react';

interface FullWritingModalProps {
  fullWriting: string[] | string | null;
  onClose: () => void;
  isMuted?: boolean;
  isTextHidden?: boolean;
}

export default function FullWritingModal({
  fullWriting,
  onClose,
  isMuted = false,
  isTextHidden = false,
}: FullWritingModalProps) {
  // Holds the generated audio URL
  const [audioUrl, setAudioUrl] = useState<string>('');
  // Whether we're currently playing audio
  const [isPlaying, setIsPlaying] = useState(false);
  // Whether we're waiting for TTS generation
  const [isGenerating, setIsGenerating] = useState(false);

  // A ref to cache the full text that was used for generation
  const cachedTextRef = useRef<string>('');

  // Reference to our <audio> element
  const audioRef = useRef<HTMLAudioElement>(new Audio());

  // Effect: generate TTS audio (or reuse cached) when fullWriting changes
  useEffect(() => {
    // Stop current audio
    audioRef.current.pause();
    setIsPlaying(false);

    // Make audio reference globally accessible for reset function
  (window as any).fullWritingAudio = audioRef.current;

  // Add listener for global audio stop event
  const stopAudio = () => {
    console.log("FullWritingModal received stop audio event - forcing stop");
    
    // Force stop audio playback
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
    audioRef.current.src = '';
    audioRef.current.load(); // Force reload to clear any buffered audio
    
    // Remove event listeners to prevent further callbacks
    audioRef.current.onended = null;
    audioRef.current.onerror = null;
    
    setIsPlaying(false);

    // Revoke any existing audio URLs to clean up memory
    if (audioUrl) {
      try {
        URL.revokeObjectURL(audioUrl);
        setAudioUrl('');
      } catch (e) {
        console.warn("Error revoking URL:", e);
      }
    }
    
    console.log("FullWritingModal audio forcefully stopped and cleaned up");
  };

  window.addEventListener('stopAllAudio', stopAudio);

    // Combine text if needed
    const text =
      fullWriting && typeof fullWriting === 'string'
        ? fullWriting
        : fullWriting && Array.isArray(fullWriting)
        ? fullWriting.join(' ')
        : '';

    // If there's no text or it's empty, do nothing.
    if (!text.trim()) return;

    // If muted, don't auto-play (but keep cached audio).
    if (isMuted) return;

    // If the text is the same as what was previously generated and we have an audioUrl,
    // then simply auto-play the cached audio.
    if (cachedTextRef.current === text && audioUrl) {
      audioRef.current.src = audioUrl;
      audioRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch((err) => console.error('Auto-play error:', err));
      return;
    }

    // Otherwise, this is new text—so update the cache and generate new audio.
    // If there is a previous audioUrl, revoke it.
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl('');
    }
    cachedTextRef.current = text;

    setIsGenerating(true);
    fetch('/api/generate-speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        voice: 'nova', // adjust as needed
        model: 'gpt-4o-mini-tts',
        instructions: 'You are telling a story.',
      }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`TTS request failed: ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        audioRef.current.src = url;
        return audioRef.current.play();
      })
      .then(() => {
        setIsPlaying(true);
      })
      .catch((err) => {
        console.error('TTS error:', err);
      })
      .finally(() => {
        setIsGenerating(false);
      });

    // Cleanup on unmount or re-run
    return () => {
      audioRef.current.pause();
    };
  }, [fullWriting, isMuted, audioUrl]);

  // When the audio ends, mark as not playing
  useEffect(() => {
    const handleEnded = () => setIsPlaying(false);
    audioRef.current.addEventListener('ended', handleEnded);
    return () => {
      audioRef.current.removeEventListener('ended', handleEnded);
    };
  }, []);

  // Optional: Play/Stop button in case the user wants manual control
  const handlePlayStop = () => {
    if (!audioUrl) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.src = audioUrl;
      audioRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch((err) => console.error('Playback error:', err));
    }
  };

  // Close button handler
  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    audioRef.current.pause();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    onClose();
  };

  // Hide modal if there's no text
  if (
    !fullWriting ||
    (typeof fullWriting === 'string' && !fullWriting.trim()) ||
    (Array.isArray(fullWriting) && fullWriting.length === 0)
  )
    return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-black border-2 border-green-500 rounded-lg p-6 w-2/3 h-2/3 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-green-500 font-semibold text-xl">Full Writing</h3>
          <div className="flex items-center space-x-4">
            {audioUrl && (
              <button
                className={
                  isPlaying ? 'text-yellow-400 hover:text-yellow-300' : 'text-blue-400 hover:text-blue-300'
                }
                onClick={handlePlayStop}
              >
                {isPlaying ? 'Stop' : 'Play'}
              </button>
            )}
            <button className="text-white hover:text-gray-300" onClick={handleClose}>
              Close
            </button>
          </div>
        </div>

        {isGenerating && <div className="mb-4 text-gray-400">Generating audio...</div>}

        {!isTextHidden && (
          <div className="overflow-y-auto flex-1 pr-2 scrollbar-thin">
            <style jsx>{`
              div::-webkit-scrollbar {
                width: 8px;
              }
              div::-webkit-scrollbar-track {
                background: transparent;
              }
              div::-webkit-scrollbar-thumb {
                background-color: #10b981;
                border-radius: 20px;
              }
            `}</style>
            <ol className="list-decimal list-inside space-y-4 text-green-500 text-xl leading-relaxed">
              {Array.isArray(fullWriting)
                ? fullWriting.map((item, index) => (
                    <li key={index} className="break-words">
                      {item}
                    </li>
                  ))
                : <li className="break-words">{fullWriting}</li>}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
