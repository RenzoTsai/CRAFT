//frontend/src/app/components/PlotIdeationCard.tsx
'use client';

import React, { useEffect, useRef, useState } from 'react';

interface PlotIdeationCardProps {
  pilotSummary: string;
  elicitationQuestions: string;
  onSpeechEnd?: () => void;
  onSpeechStart?: () => void;
  onSpeechProgress?: (current: number, total: number) => void;
  isMuted?: boolean;
}

export default function PlotIdeationCard({
  pilotSummary,
  elicitationQuestions,
  onSpeechEnd,
  onSpeechStart,
  onSpeechProgress,
  isMuted = false,
}: PlotIdeationCardProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlsRef = useRef<string[]>([]);
  const currentAudioIndexRef = useRef(0);
  const speechCompletedRef = useRef(false);

  // Create a stable ID for the current text content to prevent duplicate generation
  const contentIdRef = useRef("");

  // Function to generate speech using OpenAI TTS
  const generateSpeech = async (text: string): Promise<string | null> => {
    try {
      console.log(`Generating speech for: "${text}"`);

      const response = await fetch('/api/generate-speech', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text,
          voice: 'nova', // Good for both English and Chinese
          model: 'tts-1',
          instructions: 'Speak in a natural, engaging tone. Sound interested in the content.'
        })
      });

      if (!response.ok) {
        console.error(`API error: ${response.status}`);
        return null;
      }

      // Get the audio blob from the response
      const audioBlob = await response.blob();

      // Create a URL for the blob
      return URL.createObjectURL(audioBlob);
    } catch (error) {
      console.error('Speech generation error:', error);
      return null;
    }
  };

  // Function to prepare all audio content
  const prepareAudio = async () => {
    // Prevent concurrent generation
    if (isGenerating) {
      console.log("Already generating audio, skipping");
      return;
    }

    // If already completed or muted, don't generate audio
    if (speechCompletedRef.current || isMuted) {
      console.log("Speech already completed or muted, skipping generation");
      if (isMuted && onSpeechEnd && !speechCompletedRef.current) {
        speechCompletedRef.current = true;
        onSpeechEnd();
      }
      return;
    }

    // Create a content ID to check for duplicates
    const newContentId = `${pilotSummary}|${elicitationQuestions}`;
    if (contentIdRef.current === newContentId) {
      console.log("Content unchanged, using existing audio");
      if (audioUrlsRef.current.length > 0 && !isPlaying) {
        // If we have audio but it's not playing, start playback
        currentAudioIndexRef.current = 0;
        playNextAudio();
      }
      return;
    }

    // Update content ID and mark as generating
    contentIdRef.current = newContentId;
    setIsGenerating(true);

    // Clean up any previous audio URLs
    audioUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
    audioUrlsRef.current = [];
    currentAudioIndexRef.current = 0;

    console.log("Generating new audio for plot ideation content");

    // Generate audio for pilot summary if available
    if (pilotSummary) {
      const summaryAudio = await generateSpeech(`Here's a plot idea: ${pilotSummary}`);
      if (summaryAudio) audioUrlsRef.current.push(summaryAudio);
    }

    // Generate audio for elicitation questions if available
    if (elicitationQuestions) {
      const questionsAudio = await generateSpeech(`Some questions to consider: ${elicitationQuestions}`);
      if (questionsAudio) audioUrlsRef.current.push(questionsAudio);
    }

    // Mark generation as complete
    setIsGenerating(false);

    // Start playing if we have audio
    if (audioUrlsRef.current.length > 0) {
      console.log(`Starting playback of ${audioUrlsRef.current.length} audio segments`);

      // Notify parent that speech is starting
      if (onSpeechStart) {
        onSpeechStart();
      }

      playNextAudio();
    } else if (onSpeechEnd) {
      // If we couldn't generate any audio, still call onSpeechEnd
      console.log("No audio generated, calling onSpeechEnd");
      speechCompletedRef.current = true;
      onSpeechEnd();
    }
  };

  // Function to play the next audio in the sequence
  const playNextAudio = () => {
    if (!audioRef.current) return;

    if (currentAudioIndexRef.current < audioUrlsRef.current.length) {
      console.log(`Playing audio segment ${currentAudioIndexRef.current + 1}/${audioUrlsRef.current.length}`);

      // Report progress to parent component
      if (onSpeechProgress) {
        onSpeechProgress(currentAudioIndexRef.current + 1, audioUrlsRef.current.length);
      }

      // Set up the audio element
      audioRef.current.src = audioUrlsRef.current[currentAudioIndexRef.current];
      audioRef.current.onended = handleAudioEnded;
      audioRef.current.onerror = handleAudioError;

      // Play the audio with Safari-specific handling
      const playPromise = audioRef.current.play();
      
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            console.log(`Audio segment ${currentAudioIndexRef.current + 1} started successfully`);
            setIsPlaying(true);
          })
          .catch(error => {
            console.error('Audio playback error:', error);
            
            // Safari-specific retry logic
            if (typeof navigator !== 'undefined' && /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent)) {
              console.log("Safari audio failed, attempting retry with delay");
              setTimeout(() => {
                if (audioRef.current && audioRef.current.src) {
                  audioRef.current.load(); // Reload the audio element
                  audioRef.current.play()
                    .then(() => {
                      console.log("Safari retry successful");
                      setIsPlaying(true);
                    })
                    .catch(retryError => {
                      console.warn("Safari retry also failed:", retryError);
                      handleAudioEnded(); // Continue to next audio
                    });
                }
              }, 100);
            } else {
              handleAudioEnded(); // Try to continue to next audio
            }
          });
      } else {
        // Fallback for older browsers
        setIsPlaying(true);
      }
    } else {
      // We've played all audio segments
      console.log("All audio segments completed");
      setIsPlaying(false);

      if (!speechCompletedRef.current) {
        speechCompletedRef.current = true;

        // Call the callback to start fading
        if (onSpeechEnd) {
          console.log("Calling onSpeechEnd callback");
          onSpeechEnd();
        }
      }
    }
  };

  // Handle audio ended event
  const handleAudioEnded = () => {
    console.log(`Audio segment ${currentAudioIndexRef.current + 1} ended`);
    currentAudioIndexRef.current++;
    playNextAudio();
  };

  // Handle audio error event
  const handleAudioError = (e: string | Event) => {
    console.error(`Audio error in segment ${currentAudioIndexRef.current + 1}:`, e);
    handleAudioEnded(); // Try to continue to next audio
  };

  // Reset speech completed state when component unmounts or when content changes
  useEffect(() => {
    speechCompletedRef.current = false;
    currentAudioIndexRef.current = 0;
    return () => {
      speechCompletedRef.current = false;
    };
  }, [pilotSummary, elicitationQuestions]);

  // Initialize audio element and prepare audio
  useEffect(() => {
    // Create audio element if it doesn't exist
    if (!audioRef.current) {
      console.log("Creating audio element");
      audioRef.current = new Audio();
      
      // Safari-specific audio setup
      if (typeof navigator !== 'undefined' && /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent)) {
        console.log("Safari detected - setting up audio with preload");
        audioRef.current.preload = 'auto';
        audioRef.current.muted = false;
      }
    }

    // Add global event listener for stopping audio
    const stopAudio = () => {
      console.log("PlotIdeationCard received stop audio event - forcing stop");
      if (audioRef.current) {
        // Force stop audio playback
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        audioRef.current.src = '';
        audioRef.current.load(); // Force reload to clear any buffered audio
        
        // Remove event listeners to prevent further callbacks
        audioRef.current.onended = null;
        audioRef.current.onerror = null;
        
        setIsPlaying(false);

        // Clean up any audio URLs
        audioUrlsRef.current.forEach(url => {
          try {
            URL.revokeObjectURL(url);
          } catch (e) {
            console.warn("Error revoking URL:", e);
          }
        });
        audioUrlsRef.current = [];
        currentAudioIndexRef.current = 0;
        
        // Reset speech completion state
        speechCompletedRef.current = true; // Mark as completed to prevent further processing
        setIsGenerating(false);
        
        console.log("PlotIdeationCard audio forcefully stopped and cleaned up");
      }
    };

    window.addEventListener('stopAllAudio', stopAudio);

    // Only prepare audio if not muted and we have content
    if ((pilotSummary || elicitationQuestions) && !isMuted) {
      prepareAudio();
    } else if (isMuted && onSpeechEnd && !speechCompletedRef.current) {
      // If muted, still trigger the speech end callback
      console.log("Muted, directly calling onSpeechEnd");
      speechCompletedRef.current = true;
      setTimeout(() => {
        if (onSpeechEnd) onSpeechEnd();
      }, 500);
    }

    // Cleanup function
    return () => {
      window.removeEventListener('stopAllAudio', stopAudio);
      console.log("Cleaning up PlotIdeationCard audio resources");
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
    };
  }, [pilotSummary, elicitationQuestions, isMuted]);

  // Final cleanup on unmount
  useEffect(() => {
    return () => {
      console.log("Component unmounting, releasing all audio URLs");
      // Release object URLs
      audioUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
      audioUrlsRef.current = [];

      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current.onended = null;
        audioRef.current.onerror = null;
      }
    };
  }, []);

  if (!pilotSummary && !elicitationQuestions) return null;

  const containerClasses = "absolute top-30 right-30 bg-black border-2 border-blue-500 rounded-lg p-3 w-80 transition-opacity duration-200";

  return (
    <div
      className={containerClasses}
      style={{ opacity: 1 }}
    >
      <div className="flex-grow overflow-y-auto">
        {pilotSummary && (
          <>
            <div className="text-blue-500 font-semibold mb-2">Plot Idea:</div>
            <div className="text-white text-xl mb-4">{pilotSummary}</div>
          </>
        )}

        {elicitationQuestions && (
          <>
            <div className="text-blue-500 font-semibold mb-2">Questions to Consider:</div>
            <div className="text-white text-xl mb-2">{elicitationQuestions}</div>
          </>
        )}
      </div>

      <div className="text-gray-400 text-sm italic flex-shrink-0 mt-2">
        {isGenerating ? 'Preparing audio...' :
         isPlaying ? `Speaking (${currentAudioIndexRef.current + 1}/${audioUrlsRef.current.length})` :
         speechCompletedRef.current ? 'Listening for your response...' :
         'Loading...'}
      </div>
    </div>
  );
}