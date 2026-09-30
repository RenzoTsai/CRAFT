'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { useWhisperTranscriber } from '../hooks/useWhisperTranscriber';
import DirectionalButtons from "@/app/components/DirectionalButtons";
import Notification from "@/app/components/Notification";
import NotificationStack from "@/app/components/NotificationStack";
import MomentsModal from "@/app/components/MomentsModal";
import FullWritingModal from "@/app/components/FullWritingModal";
import PhotoCard from "@/app/components/PhotoCard";
import ProcessingIndicator from "@/app/components/ProcessingIndicator";
import QuestionCard from "@/app/components/QuestionCard";
import VoiceListeningCard from "@/app/components/VoiceListeningCard";
import GeneratedImageCard from "@/app/components/GeneratedImageCard";
import PlotIdeationCard from "@/app/components/PlotIdeationCard";
import PlotDemonstration from '@/components/ui/PlotDemonstration';
import { Box } from '@mui/material';
import SuggestionNotification from "@/app/components/SuggestionNotification";
import EditingInterface from "@/app/components/EditingInterface";
import RolePlayCard from "@/app/components/RolePlayCard";

type AuthoringPhase =
  | 'none'
  | 'photo'
  | 'submitted'
  | 'question'
  | 'voice'
  | 'selection'
  | 'full'
  | 'generating-image'
  | 'showing-image'
  | 'plot-ideation'
  | 'plot-demonstration'
  | 'editing'
  | 'role-play'
  | 'starting-role-play'
  | 'role-play-listening'
  | 'role-play-waiting';

let audioContext: AudioContext | null = null;
const getAudioContext = () => {
  if (typeof window !== 'undefined') {
    if (!audioContext) {
      audioContext = new AudioContext({ sampleRate: 16000 });
    }
    return audioContext;
  }
  return null;
};

const convertBlobToAudioBuffer = async (blob: Blob): Promise<AudioBuffer> => {
  const ctx = getAudioContext();
  if (!ctx) {
    throw new Error('AudioContext not supported');
  }
  const arrayBuffer = await blob.arrayBuffer();
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  if (audioBuffer.sampleRate !== 16000) {
    const offline = new OfflineAudioContext(1, Math.floor(audioBuffer.duration * 16000), 16000);
    const src = offline.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(offline.destination);
    src.start();
    return await offline.startRendering();
  }
  return audioBuffer;
};


export default function Home() {
  // Toggle directional buttons
  const [buttonsVisible, setButtonsVisible] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  // Audio and text display states
  const [isMuted, setIsMuted] = useState(false);
  const [isTextHidden, setIsTextHidden] = useState(false);
  // Track if we're in moment list view
  const [inMomentList, setInMomentList] = useState(false);

  // Notification state
  const [notification, setNotification] = useState<{ type: string; message: string } | null>(null);

  // Authoring related states
  const [authoringPhase, setAuthoringPhase] = useState<AuthoringPhase>('none');
  const isRolePlayView = ['role-play', 'starting-role-play', 'role-play-listening', 'role-play-waiting'].includes(authoringPhase);
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoTranscription, setPhotoTranscription] = useState('');
  const [photoCardOpacity, setPhotoCardOpacity] = useState(1); // Changed from 0 to always be visible

  const [questionText, setQuestionText] = useState('');
  const [questionCardOpacity, setQuestionCardOpacity] = useState(0.7); // Set to visible by default

  // Transformative data states
  const [transformativeScene, setTransformativeScene] = useState('');
  const [plot, setPlot] = useState('');
  const [transformativeCharacters, setTransformativeCharacters] = useState<(string | { name: string; description_in_scene: string; status: string })[]>([]);
  const [answer, setAnswer] = useState<string | undefined>(undefined);

  // Plot ideation states
  const [pilotSummary, setPilotSummary] = useState('');
  const [elicitationQuestions, setElicitationQuestions] = useState('');

  // Role-play states - consolidated into a single state object
  const [rolePlayState, setRolePlayState] = useState<{
    userRole: string;
    aiRole: string;
    aiDialogue: string;
    aiImage: string | null;
  } | null>(null);


  // Image generation states
  const [generatedImageCardOpacity, setGeneratedImageCardOpacity] = useState(1);
  const [questionSpeechComplete, setQuestionSpeechComplete] = useState(false);

  // Voice state
  const [voiceTranscription, setVoiceTranscription] = useState('');
  const [isRecordingQuestion, setIsRecordingQuestion] = useState(false);

  const [momentList, setMomentList] = useState<string[]>([]);
  const [fullWriting, setFullWriting] = useState<string[]>([]);

  // Speech recognition collections
  const [photoSpeeches, setPhotoSpeeches] = useState<string[]>([]);
  const [questionSpeeches, setQuestionSpeeches] = useState<string[]>([]);
  const [questionTranscription, setQuestionTranscription] = useState(''); // Add real-time transcription for question
  const [voiceSpeeches, setVoiceSpeeches] = useState<string[]>([]);

  const transcriber = useWhisperTranscriber();
  const [isRefining, setIsRefining] = useState(false);
  const refinementContextRef = useRef<{
    endpoint: string;
    data: any;
    originalTranscription: string;
    transcriptionField: string;
  } | null>(null);

  // Refs for recognition instances
  const photoRecognitionRef = useRef<any>(null);
  const questionRecognitionRef = useRef<any>(null);
  const voiceRecognitionRef = useRef<any>(null);
  const submissionLock = useRef(false);

  // New refs for audio recording
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Ref to track the timestamp of the last processed LLM response to prevent duplicates
  const lastProcessedTimestamp = useRef<number | null>(null);

  // WebSocket states and methods
  const {
    sendMessage,
    llmResponse,
    generatedImageBase64,
    isProcessing,
    systemNotification,
    generateImage,
    clearGeneratedImage,
    plotData,
    showPlotDemonstration,
    suggestionMessage,
    setSuggestionMessage,
    setInteractionIdle,
    aiGeneratedContent,
    savedContent,
    setSavedContent,
    currentPid,
    currentResponseLanguage,
    currentWritingStyle,
    currentProactiveSuggestionPriority
  } = useWebSocket();
  const [showLanguagePanel, setShowLanguagePanel] = useState(false);

  // Cursor tracking and editing interface states
  const [showEditButton, setShowEditButton] = useState(false);
  const [showEditingInterface, setShowEditingInterface] = useState(false);
  const [isGeneratingContent, setIsGeneratingContent] = useState(false);

  // Audio device selection
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioDevice, setSelectedAudioDevice] = useState<string>('');

  // Handler for speech completion
  const handleSpeechEnd = () => {
    console.log("Speech completed");
    setQuestionSpeechComplete(true);
  };

  // Hide the generated image and clear image state
  const hideGeneratedImage = () => {
    clearGeneratedImage();
    setAuthoringPhase('none');
  };

  // Trigger image generation using the current photo and transformative data
  const triggerImageGeneration = ({ transformativeScene, transformativeCharacters, userInput }: { transformativeScene: string; transformativeCharacters: (string | { name: string; description_in_scene: string; status: string })[]; userInput: string }) => {
    if (photo && transformativeScene) {
      const authoringData = {
        "transformative_scene": transformativeScene,
        "transformative_characters": transformativeCharacters,
        "user_input": userInput,
      };
      generateImage(photo, authoringData);
      setAuthoringPhase('generating-image');
      setGeneratedImageCardOpacity(1)
    } else {
      console.error('Cannot generate image: missing photo or transformative scene');
    }
  };

  // When generated image is available, show it and start speech
  useEffect(() => {
    if (generatedImageBase64 && (authoringPhase === 'generating-image' || authoringPhase === 'submitted')) {
      setAuthoringPhase('showing-image');
    }
  }, [generatedImageBase64, authoringPhase]);

  // Toggle directional buttons on screen click
  const handleScreenClick = () => {
    console.log('authoringPhase:', authoringPhase);
    console.log('buttonsVisible:', buttonsVisible);
    console.log('inMomentList:', inMomentList);
    console.log('full writing:', fullWriting);
    console.log('isMuted:', isMuted);
    console.log('isTextHidden:', isTextHidden);
    setButtonsVisible((prev) => !prev);
    
    // Close language panel if it's open
    if (showLanguagePanel) {
      setShowLanguagePanel(false);
    }
  };

  const startRolePlay = () => {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    window.dispatchEvent(new CustomEvent('stopAllAudio'));
    stopCurrentSpeech();
    setNotification(null);
    setRolePlayState(null);
    setAuthoringPhase('starting-role-play');
    if (!sendMessage('user speaking', { transcription: 'Start role-playing' })) {
      setAuthoringPhase(questionText ? 'question' : 'none');
      setNotification({ type: 'error', message: 'Could not start role-play. Please check the connection and try again.' });
    }
  };

  // Handle directional button clicks
  const handleButtonClick = (direction: string) => {
    let command = '';
    console.log('Direction:', direction);
    console.log('Authoring phase:', authoringPhase);

    if (direction === 'exit-role-play') {
      resetEverything();
      return;
    }
    if (direction === 'left') {
      resetEverything();
      return; // Stop further processing for the left button
    }

    if (isRefining || authoringPhase === 'starting-role-play' || authoringPhase === 'role-play-waiting') return;

    // Set to submitted phase immediately for commands that need server processing
    const setToSubmittedPhase = () => {
      setAuthoringPhase('submitted');
    };

    if (authoringPhase === 'plot-ideation') {
      switch (direction) {
        case 'top':
          setIsMuted((prev) => !prev);
          break;
        case 'bottom':
          setIsTextHidden((prev) => !prev);
          break;
        case 'right':
          // Submit response and go to voice mode
          setAuthoringPhase('voice');
          startVoiceSpeechDetection();
          break;
        default:
          command = '';
      }
    } else if (authoringPhase === 'selection' || authoringPhase === 'full') {
      switch (direction) {
        case 'top':
          setIsMuted((prev) => !prev);
          break;
        case 'bottom':
          setIsTextHidden((prev) => !prev);
          break;
        case 'right':
          setAuthoringPhase('voice');
          startVoiceSpeechDetection();
          break;
        default:
          command = '';
      }
    } else if (authoringPhase === 'showing-image' || authoringPhase === 'question') {
      switch (direction) {
        case 'top':
          startRolePlay();
          break;
        case 'bottom':
          setIsTextHidden((prev) => !prev);
          break;
        case 'right':
          if (isRecordingQuestion) {
            // Prevent duplicate submissions
            if (submissionLock.current) {
              break;
            }
            submissionLock.current = true;
            // If already recording, stop recording and submit
            if (questionRecognitionRef.current) {
              questionRecognitionRef.current.stop();
            }
            // Use the current displayed transcription which includes both final and interim results
            const transcriptionToSend = questionTranscription.trim() || questionSpeeches.join(' ').trim();
            
            // Show immediate feedback to user
            setToSubmittedPhase(); // Show processing indicator immediately
            setQuestionSpeeches([]);
            setQuestionTranscription('');
            
            // Process audio in background and send with transcription
            stopRecordingAndRefine('authoring_answer', {}, transcriptionToSend, 'answer');

            removeQuestionCard();
            hideGeneratedImage();
            setIsRecordingQuestion(false);
          } else {
            // If not recording, stop any playing audio and start recording
            if (window.speechSynthesis) window.speechSynthesis.cancel();
            window.dispatchEvent(new CustomEvent('stopAllAudio'));
            stopCurrentSpeech(); // Stop any current speech playback
            startQuestionSpeechDetection();
            setIsRecordingQuestion(true);
          }
          break;
        default:
          command = '';
      }
    } else if (authoringPhase === 'photo') {
      switch (direction) {
        case 'right':
          // Submit photo and collected transcriptions when right button is pressed
          if (!submissionLock.current && photo) {
            submissionLock.current = true; // Lock to prevent multiple submissions

            if (photoRecognitionRef.current) {
              photoRecognitionRef.current.stop(); // Stop recognition immediately
            }

            // Use the current displayed transcription which includes both final and interim results
            const transcriptionToSend = photoTranscription.trim() || photoSpeeches.join(' ').trim();
            
            // Show immediate feedback to user
            setToSubmittedPhase(); // Show processing indicator immediately
            setPhotoSpeeches([]);
            
            // Process audio in background and send with transcription
            stopRecordingAndRefine('authoring_submit', { photo }, transcriptionToSend, 'transcription');
          }
          break;
        default:
          command = '';
      }
    } else if (authoringPhase === 'voice' || authoringPhase === 'role-play-listening') {
      switch (direction) {
        case 'right':
          // Stop recording and submit collected voice transcriptions when right button is pressed
          // Prevent duplicate submissions
          if (submissionLock.current) {
            break;
          }
          submissionLock.current = true;
          if (voiceRecognitionRef.current) {
            voiceRecognitionRef.current.stop();
          }
          
          // Use the current displayed transcription which includes both final and interim results
          const transcriptionToSend = voiceTranscription.trim() || voiceSpeeches.join(' ').trim();
          
          // Show immediate feedback to user
          if (authoringPhase === 'role-play-listening') {
            setAuthoringPhase('role-play-waiting');
          } else {
            setToSubmittedPhase();
            removeVoiceCard();
          }
          setVoiceSpeeches([]);
          
          // Process audio in background and send with transcription
          stopRecordingAndRefine('user speaking', {}, transcriptionToSend, 'transcription');
          break;
        default:
          command = '';
      }
    } else if (authoringPhase === 'role-play') {
        switch (direction) {
            case 'right':
                // In role-play, right button triggers voice recognition for the user's dialogue
                // Stop any current speech playback before starting recording
                if (window.speechSynthesis) window.speechSynthesis.cancel();
                window.dispatchEvent(new CustomEvent('stopAllAudio'));
                stopCurrentSpeech();
                setVoiceTranscription('');
                setVoiceSpeeches([]);
                setIsTextHidden(false);
                setAuthoringPhase('role-play-listening');
                startVoiceSpeechDetection();
                break;
            default:
                command = '';
        }
    } else if (authoringPhase === 'generating-image') {
        switch (direction) {
            case 'right':
                // Allow interrupting image generation to start voice recording
                if (window.speechSynthesis) window.speechSynthesis.cancel();
                window.dispatchEvent(new CustomEvent('stopAllAudio'));
                stopCurrentSpeech(); // Stop any current speech playback
                setNotification({
                  type: 'info',
                  message: 'Interrupting image generation, starting voice recording...'
                });
                setAuthoringPhase('voice');
                startVoiceSpeechDetection();
                break;
            case 'top':
                startRolePlay();
                break;
            default:
                // Ignore other buttons during image generation
                break;
        }
    } else {
      switch (direction) {
        case 'top':
          command = 'select_moments';
          setToSubmittedPhase(); // Show processing indicator
          break;
        case 'bottom':
          command = 'photo';
          fetch('/backend/image')
            .then((response) => response.blob())
            .then((blob) => {
              const reader = new FileReader();
              reader.onloadend = () => {
                const base64data = reader.result as string;
                setPhoto(base64data);
                setAuthoringPhase('photo');
                setPhotoCardOpacity(1);
                startPhotoSpeechDetection();
              };
              reader.readAsDataURL(blob);
            })
            .catch((error) => console.error('Error fetching image:', error));
          break;
        case 'right':
          setAuthoringPhase('voice');
          startVoiceSpeechDetection();
          break;
        case 'center':  // Adding a center button action
          command = 'plot_ideation';
          setToSubmittedPhase(); // Show processing indicator
          break;
        default:
          command = '';
      }
    }

    if (command) {
      sendMessage(command, {});
    }
  };

  // Start speech detection for photo phase using Web Speech API (continuous mode)
  const startPhotoSpeechDetection = async () => {
    // Start audio recording
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { deviceId: selectedAudioDevice ? { exact: selectedAudioDevice } : undefined } 
      });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };

      mediaRecorderRef.current.start();
      console.log("Audio recording for photo description started.");

    } catch (error) {
      console.error("Error starting audio recording for photo description:", error);
    }
    
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('Web Speech API not supported.');
      return;
    }
    const recognition = new SpeechRecognition();
    photoRecognitionRef.current = recognition;
    recognition.continuous = true; // Enable continuous recognition
    recognition.interimResults = true; // Enable interim results for real-time display
    recognition.lang = languageMap[responseLanguage] || 'en-US';

    recognition.onstart = () => {
      console.log('Photo speech recognition started.');
      setPhotoSpeeches([]); // Clear previous speeches
      setPhotoTranscription(''); // Clear displayed transcription
    };

    recognition.onresult = (event: any) => {
      // Process both interim and final results
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript + ' ';
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      // Update the stored speeches with finalized results
      if (finalTranscript) {
        setPhotoSpeeches(prev => {
          const updatedSpeeches = [...prev];
          const lastIndex = updatedSpeeches.length - 1;

          // If we have interim results that were finalized, replace them
          if (lastIndex >= 0 && !event.results[event.results.length - 1].isFinal) {
            updatedSpeeches[lastIndex] = finalTranscript;
          } else {
            updatedSpeeches.push(finalTranscript);
          }

          return updatedSpeeches;
        });
      }

      // Display the current transcription (both final and interim)
      const currentDisplay = finalTranscript + interimTranscript;
      setPhotoTranscription(currentDisplay);
    };

    recognition.onerror = (event: any) => {
      console.error('Photo speech recognition error:', event.error);
    };

    recognition.onend = () => {
      console.log('Photo speech recognition ended.');
      // Do not automatically submit - will be submitted when user presses right button
    };

    recognition.start();
  };

  // Monitor llmResponse from backend for authoring response
  useEffect(() => {
    if (llmResponse) {
      submissionLock.current = false; // Unlock submission on receiving a response
      console.log('authoringPhase:', authoringPhase);
      console.log('buttonsVisible:', buttonsVisible);
      console.log('inMomentList:\n', inMomentList);
      console.log('full writing:\n', fullWriting);
      console.log('isMuted:', isMuted);
      console.log('isTextHidden:', isTextHidden);
      console.log('llmResponse:\n', llmResponse);

      try {
        const parsed = JSON.parse(llmResponse);

        // Prevent re-processing the same message on re-renders
        if (parsed.timestamp && parsed.timestamp === lastProcessedTimestamp.current) {
          console.log('Skipping already processed LLM response.');
          return;
        }

        if (parsed.mode === 'plot_ideation' && parsed.response) {
          console.log('Plot ideation mode detected');
          const pilotSummary = parsed.response['pilot summary'] ?? parsed.response['pilot_summary'];
          if (pilotSummary) {
            setPilotSummary(pilotSummary);
          }
          const elicitationQuestions = parsed.response['elicitation questions'] ?? parsed.response['elicitation_questions'];
          if (elicitationQuestions) {
            setElicitationQuestions(elicitationQuestions);
          }

          setAuthoringPhase('plot-ideation');
          setButtonsVisible(true);
          setIsTextHidden(false);

        } else if (parsed.mode === 'authoring' && parsed.response) {
                      // Handle answer if present
            if (parsed.response['answer']) {
              setAnswer(parsed.response['answer']);
            } else {
              setAnswer(undefined);
            }
          
          if (parsed.response['transformative_scene']) {
            setTransformativeScene(parsed.response['transformative_scene']);
          }
          if (parsed.response['plot']) {
            setPlot(parsed.response['plot']);
          }
          if (parsed.response['transformative_characters']) {
            setTransformativeCharacters(parsed.response['transformative_characters']);
          }
          if (parsed.response['user_input']) {
          }
          if (parsed.response['response_to_users']) {
            const question = parsed.response['response_to_users'];
            setQuestionText(question);
            setAuthoringPhase('question');
            setQuestionCardOpacity(0.7);

            // Use the latest values from parsed.response
            triggerImageGeneration({
              transformativeScene: parsed.response['transformative_scene'],
              transformativeCharacters: parsed.response['transformative_characters'],
              userInput: parsed.user_input,
            });

            setQuestionSpeeches([]);
          }
        }
        else if (parsed.mode === 'role_play' && parsed.response) {
          const response = parsed.response;
          const hasDialogue = typeof response.ai_dialogue === 'string';
          setNotification(null);
          setRolePlayState(previous => ({
            userRole: response.user_role ?? previous?.userRole ?? 'Curious Traveler',
            aiRole: response.ai_role ?? previous?.aiRole ?? 'Wise Guide',
            aiDialogue: response.ai_dialogue ?? previous?.aiDialogue ?? '',
            aiImage: response.ai_image_base64 ?? previous?.aiImage ?? null,
          }));
          // Portrait-only updates must not end recording or replay old dialogue.
          if (hasDialogue) {
            setAuthoringPhase(previous => previous === 'role-play-listening' ? previous : 'role-play');
            setButtonsVisible(true);
            setIsTextHidden(false);
            if (authoringPhase !== 'role-play-listening') playSpeech(response.ai_dialogue);
          }
        }

        else if (parsed.response && Array.isArray(parsed.response.moments) && parsed.response.moments.length > 0) {
          setAuthoringPhase('selection');
          setButtonsVisible(true);
          setIsTextHidden(false);
          setMomentList(parsed.response.moments);
          setInMomentList(true);
        }
        else if (parsed.mode === 'full' && parsed.response && parsed.response['full writing']) {
          setButtonsVisible(true);
          setInMomentList(true);
          setIsTextHidden(false);
          setFullWriting(parsed.response['full writing']);
          setAuthoringPhase('full');
        }

        else if (parsed.mode === 'new_content_generated' && parsed.response) {
          // Handle new content generation response
    setIsGeneratingContent(false);
        }
        else if (parsed.mode === 'context_updated' && parsed.response) {
          // Handle context update response
          setNotification({
            type: 'success',
            message: 'Context updated successfully!'
          });
          // Optionally update any UI state needed
        }

        // Mark this response as processed by updating the ref
        if (parsed.timestamp) {
          lastProcessedTimestamp.current = parsed.timestamp;
        }
      } catch (error) {
        console.error('Failed to parse llmResponse:', error);
      }
    }
  }, [llmResponse, photo]);

  useEffect(() => {
    if (!transcriber.output || transcriber.output.isBusy) return;
    const ctx = refinementContextRef.current;
    if (!ctx) return;

    const refinedTranscription = transcriber.output.text?.trim();
    console.log('Whisper refined transcription:', refinedTranscription);

    const finalTranscription = refinedTranscription || ctx.originalTranscription;

    const payload = {
      ...ctx.data,
      [ctx.transcriptionField]: finalTranscription,
    };

    sendMessage(ctx.endpoint, payload);
    refinementContextRef.current = null;
    setIsRefining(false);

    // Update UI with refined text
    const refinedTextForUI = `${finalTranscription} ✨`;

    switch (ctx.transcriptionField) {
      case 'transcription': // Used for photo and voice
        if (authoringPhase === 'photo' || authoringPhase === 'submitted' && photo) {
          setPhotoTranscription(refinedTextForUI);
        } else {
          setVoiceTranscription(refinedTextForUI);
        }
        break;
      case 'answer': // Used for question
        setQuestionTranscription(refinedTextForUI);
        break;
    }
  }, [transcriber.output, sendMessage]);

  useEffect(() => {
    if (systemNotification) {
      if (authoringPhase === 'starting-role-play') setAuthoringPhase(questionText ? 'question' : 'none');
      if (authoringPhase === 'role-play-waiting') {
        submissionLock.current = false;
        setAuthoringPhase('role-play');
      }
      setNotification({
        type: "reminder",
        message: typeof systemNotification === 'string' ? systemNotification : (systemNotification as any).description || '',
      });
    }
    // The `else` block that cleared the notification has been removed.
    // The Notification component will now be responsible for its own dismissal.
  }, [systemNotification]);

  // When image is ready and speech has completed, update state but don't auto-record
  useEffect(() => {
    if (generatedImageBase64 && questionSpeechComplete && authoringPhase === 'showing-image') {
      // Now we just acknowledge speech is done, user will press right to record.
      console.log("Question TTS finished. Ready for user to start recording.");
    }
  }, [generatedImageBase64, questionSpeechComplete, authoringPhase]);

  // Cursor tracking effect
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      
      // Check if cursor is in bottom left corner (100px from left and bottom)
      const stage = document.querySelector<HTMLElement>('.craft-stage');
      const bounds = stage?.getBoundingClientRect();
      const scale = stage && bounds ? bounds.width / stage.offsetWidth : 1;
      const isInBottomLeft = e.clientX <= (bounds?.left ?? 0) + 100 * scale
        && e.clientY >= (bounds?.bottom ?? window.innerHeight) - 100 * scale;
      setShowEditButton(isInBottomLeft);
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Load saved content when editing interface opens
  useEffect(() => {
    if (showEditingInterface) {
      // Fetch the latest saved content from backend
      const fetchLatestSavedContent = async () => {
        try {
          const response = await fetch('/backend/api/get-latest-saved-content');
          if (response.ok) {
            const data = await response.json();
            if (data.content) {
              console.log('Loaded saved content from backend:', data.timestamp);
              // Update the savedContent state with the fetched content
              setSavedContent(data.content);
            } else {
              // Fallback to fullWriting if no saved content
              console.log('No saved content found, using fullWriting as fallback');
              if (fullWriting && fullWriting.length > 0) {
                setSavedContent(fullWriting.join('\n'));
              } else {
                setSavedContent('');
              }
            }
          } else {
            console.error('Failed to fetch saved content');
            // Fallback to fullWriting
            console.log('Using fullWriting as fallback');
            if (fullWriting && fullWriting.length > 0) {
              setSavedContent(fullWriting.join('\n'));
            } else {
              setSavedContent('');
            }
          }
        } catch (error) {
          console.error('Error fetching saved content:', error);
          // Fallback to fullWriting
          console.log('Using fullWriting as fallback due to error');
          if (fullWriting && fullWriting.length > 0) {
            setSavedContent(fullWriting.join('\n'));
          } else {
            setSavedContent('');
          }
        }
      };

      fetchLatestSavedContent();
    }
  }, [showEditingInterface, fullWriting]);

  const removeQuestionCard = () => {
    setQuestionText('');
    setQuestionCardOpacity(0);
    setQuestionSpeechComplete(false);
    setQuestionTranscription('');
  };


const startQuestionSpeechDetection = async () => {
  console.log("Starting question speech detection");

  // Start audio recording
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ 
      audio: { deviceId: selectedAudioDevice ? { exact: selectedAudioDevice } : undefined } 
    });
    mediaRecorderRef.current = new MediaRecorder(stream);
    audioChunksRef.current = [];

    mediaRecorderRef.current.ondataavailable = (event) => {
      audioChunksRef.current.push(event.data);
    };
    
    mediaRecorderRef.current.start();
    console.log("Audio recording for question started.");

  } catch (error) {
    console.error("Error starting audio recording for question:", error);
  }

  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn('Web Speech API not supported.');
    return;
  }

  const recognition = new SpeechRecognition();
  questionRecognitionRef.current = recognition;
  recognition.continuous = true; // Enable continuous recognition
  recognition.interimResults = true; // Enable interim results for real-time display
  recognition.lang = languageMap[responseLanguage] || 'en-US';

  let lastFinalResult = '';

  recognition.onstart = () => {
    console.log('Question speech recognition started.');
    setQuestionSpeeches([]); // Clear previous speeches
    setQuestionTranscription(''); // Clear real-time transcription
    lastFinalResult = '';
  };

  recognition.onresult = (event: any) => {
    let currentInterimTranscript = '';
    let currentFinalTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;

      if (event.results[i].isFinal) {
        if (transcript.trim() !== lastFinalResult.trim()) {
          currentFinalTranscript += transcript + ' ';
          lastFinalResult = transcript;
        }
      } else {
        currentInterimTranscript += transcript;
      }
    }

    if (currentFinalTranscript) {
      setQuestionSpeeches(prev => [...prev, currentFinalTranscript.trim()]);
    }

    // Display the current transcription (both final and interim) for real-time display
    const currentDisplay = currentFinalTranscript + currentInterimTranscript;
    setQuestionTranscription(currentDisplay);
  };

  recognition.onerror = (event: any) => {
    console.error('Question speech recognition error:', event.error);
  };

  recognition.onend = () => {
    console.log('Question speech recognition ended.');
    // Do not automatically submit - will be submitted when user presses right button
  };

  recognition.start();
};

  // Start speech detection for voice phase (continuous mode)
  const startVoiceSpeechDetection = async () => {
    // Stop any current speech playback before starting recording
    stopCurrentSpeech();
    
    // Start audio recording
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { deviceId: selectedAudioDevice ? { exact: selectedAudioDevice } : undefined } 
      });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };
      
      mediaRecorderRef.current.start();
      console.log("Audio recording started.");

    } catch (error) {
      console.error("Error starting audio recording:", error);
      setNotification({ type: 'error', message: 'Microphone unavailable. Check its permission and try again.' });
      setAuthoringPhase(previous => previous === 'role-play-listening' ? 'role-play' : previous);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('Web Speech API not supported.');
      return;
    }

    const recognition = new SpeechRecognition();
    voiceRecognitionRef.current = recognition;
    recognition.continuous = true; // Enable continuous recognition
    recognition.interimResults = true; // Enable interim results for real-time display
    recognition.lang = languageMap[responseLanguage] || 'en-US';

    recognition.onstart = () => {
      console.log('Voice speech recognition started.');
      setVoiceSpeeches([]); // Clear previous speeches
      setVoiceTranscription(''); // Clear displayed transcription
    };

    recognition.onresult = (event: any) => {
      // Process both interim and final results
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript + ' ';
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      // Update the stored speeches with finalized results
      if (finalTranscript) {
        setVoiceSpeeches(prev => {
          const updatedSpeeches = [...prev];
          const lastIndex = updatedSpeeches.length - 1;

          // If we have interim results that were finalized, replace them
          if (lastIndex >= 0 && !event.results[event.results.length - 1].isFinal) {
            updatedSpeeches[lastIndex] = finalTranscript;
          } else {
            updatedSpeeches.push(finalTranscript);
          }

          return updatedSpeeches;
        });
      }

      // Display the current transcription (both final and interim)
      const currentDisplay = finalTranscript + interimTranscript;
      setVoiceTranscription(currentDisplay);
    };

    recognition.onerror = (event: any) => {
      console.error('Voice speech recognition error:', event.error);
    };

    recognition.onend = () => {
      console.log('Voice speech recognition ended.');
      // Do not automatically submit - will be submitted when user presses right button
    };

    recognition.start();
  };

  // Stop voice recording, refine with Whisper, and send to backend
  const stopRecordingAndRefine = (endpoint: string, data: any, originalTranscription: string, transcriptionField: string = 'transcription') => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      setIsRefining(true);
      mediaRecorderRef.current.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        audioChunksRef.current = [];

        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          const base64Audio = (reader.result as string).split(',')[1] || '';
          console.log(`Audio blob size: ${audioBlob.size} bytes, Base64 length: ${base64Audio.length}`);
          const contextData = { ...data, audio_base64: base64Audio };

          if (audioBlob.size < 2000) {
            console.warn('Audio blob too small for refinement, sending original transcription with audio.');
            sendMessage(endpoint, { ...contextData, [transcriptionField]: originalTranscription });
            setIsRefining(false);
            return;
          }

          const ctx = { endpoint, data: contextData, originalTranscription, transcriptionField };
          refinementContextRef.current = ctx;
          
          try {
            const audioBuffer = await convertBlobToAudioBuffer(audioBlob);
            const whisperLang = whisperLanguageMap[responseLanguage] || 'english';
            transcriber.start(audioBuffer, whisperLang);
          } catch (e) {
            console.error("Error during whisper processing, sending original transcription with audio:", e);
            sendMessage(endpoint, { ...contextData, [transcriptionField]: originalTranscription });
            setIsRefining(false);
          }
        };
      };
      mediaRecorderRef.current.stop();
    } else {
      // No recording available, just send with original transcription
      console.log('No active media recorder, sending transcription only.');
      sendMessage(endpoint, { ...data, [transcriptionField]: originalTranscription, audio_base64: '' });
    }
  };

  const removeVoiceCard = () => {
    setAuthoringPhase('none');
    setVoiceTranscription('');
  };

  // Editing interface handlers
  const handleEditButtonClick = () => {
    setShowEditingInterface(true);
    setAuthoringPhase('editing');
  };

  const handleCloseEditingInterface = () => {
    setShowEditingInterface(false);
    setAuthoringPhase('none');
  };

  const handleGenerateNewContent = async () => {
    setIsGeneratingContent(true);
    try {
      // Send message to backend to generate new content based on recent interactions
      sendMessage('generate_new_content', {});
    } catch (error) {
      console.error('Error generating new content:', error);
    }
  };

  const handleSaveAndUpdateContext = async (content: string) => {
    try {
      // Send message to backend to save and update context
      sendMessage('save_and_update_context', { content });
      setNotification({
        type: 'success',
        message: 'Content saved and context updated successfully!'
      });
    } catch (error) {
      console.error('Error saving content:', error);
      setNotification({
        type: 'error',
        message: 'Failed to save content. Please try again.'
      });
    }
  };

  const handleRegenerateWithFeedback = async (originalContent: string, feedback: string) => {
    setIsGeneratingContent(true);
    try {
      // Send message to backend to regenerate content based on feedback
      sendMessage('regenerate_with_feedback', { 
        original_content: originalContent, 
        feedback: feedback 
      });
      setNotification({
        type: 'info',
        message: 'Regenerating content based on your feedback...'
      });
    } catch (error) {
      console.error('Error regenerating content with feedback:', error);
      setNotification({
        type: 'error',
        message: 'Failed to regenerate content. Please try again.'
      });
      setIsGeneratingContent(false);
    }
  };

  const handleShowPlot = () => {
    // Close the editing interface
    setShowEditingInterface(false);
    setAuthoringPhase('none');
    
    // Trigger plot demonstration by sending a voice command
    sendMessage('user speaking', { transcription: 'show plot' });
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (photoRecognitionRef.current) photoRecognitionRef.current.stop();
      if (questionRecognitionRef.current) questionRecognitionRef.current.stop();
      if (voiceRecognitionRef.current) voiceRecognitionRef.current.stop();
      // Stop media recorder if it's running
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

// Function to reset all UI, states, and audio by reloading the page
const resetEverything = () => {
  setIsResetting(true);
  setButtonsVisible(false);
  window.speechSynthesis?.cancel();
  window.dispatchEvent(new CustomEvent('stopAllAudio'));
  for (const recognition of [photoRecognitionRef.current, questionRecognitionRef.current, voiceRecognitionRef.current]) {
    try { recognition?.stop(); } catch { /* Recognition may already be stopped. */ }
  }
  const recorder = mediaRecorderRef.current;
  if (recorder) {
    recorder.onstop = null;
    if (recorder.state === 'recording') recorder.stop();
    recorder.stream.getTracks().forEach(track => track.stop());
  }
  console.log("Performing complete system reset via page reload");
  
  // Stop any current speech playback
  stopCurrentSpeech();
  
  // Send reset commands to backend
  sendMessage('reset_session', {});
  sendMessage('reset_system', {});

  // Give the messages a moment to be sent before reloading
  setTimeout(() => {
    window.location.reload();
  }, 100); // 100ms delay should be enough
};

  const [pid, setPid] = useState(() => typeof window !== 'undefined' ? localStorage.getItem('pid') || 'my-story' : 'my-story');
  const [responseLanguage, setResponseLanguage] = useState(() => typeof window !== 'undefined' ? localStorage.getItem('responseLanguage') || 'English' : 'English');
  const [writingStyle, setWritingStyle] = useState('Concise but touched language');
  const [proactiveSuggestionPriority, setProactiveSuggestionPriority] = useState('Any');

  // Add state for PID search
  const [pidSearchLoading, setPidSearchLoading] = useState(false);
  const [pidSearchError, setPidSearchError] = useState('');

  const handleSaveSettings = () => {
    localStorage.setItem('pid', pid);
    localStorage.setItem('responseLanguage', responseLanguage);
    localStorage.setItem('writingStyle', writingStyle);
    sendMessage('update_settings', { pid, response_language: responseLanguage, writing_style: writingStyle, proactive_suggestion_priority: proactiveSuggestionPriority });
    setShowLanguagePanel(false);
  };

  // PID search handler
  const handlePidSearch = () => {
    if (!pid.trim()) return;
    setPidSearchLoading(true);
    setPidSearchError('');
    // Send get_settings with the searched PID
    sendMessage('get_settings', { pid: pid.trim() });
    // Wait for settings to arrive (useEffect will update states)
    setTimeout(() => setPidSearchLoading(false), 1000); // fallback timeout
  };

  // Get and set audio devices
  const getAudioDevices = async () => {
    try {
      const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      permissionStream.getTracks().forEach(track => track.stop());
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputDevices = devices.filter(device => device.kind === 'audioinput');
      setAudioDevices(audioInputDevices);
      const savedDeviceId = localStorage.getItem('selectedAudioDevice');
      if (savedDeviceId && audioInputDevices.some(d => d.deviceId === savedDeviceId)) {
        setSelectedAudioDevice(savedDeviceId);
      } else if (audioInputDevices.length > 0) {
        setSelectedAudioDevice(audioInputDevices[0].deviceId);
      }
    } catch (error) {
      console.error("Error getting audio devices:", error);
    }
  };

  // When opening the settings panel, fetch current PID and response language from backend
  const handleOpenSettingsPanel = () => {
    setShowLanguagePanel(true);
    sendMessage('get_settings', {});
    getAudioDevices();
  };

  // Sync PID, responseLanguage, and writingStyle with backend when settings message is received
  useEffect(() => {
    if (currentPid && pid !== currentPid) {
      setPid(currentPid);
    }
    if (currentResponseLanguage && responseLanguage !== currentResponseLanguage) {
      setResponseLanguage(currentResponseLanguage);
    }
    if (currentWritingStyle && writingStyle !== currentWritingStyle) {
      setWritingStyle(currentWritingStyle);
    }
    if (currentProactiveSuggestionPriority && proactiveSuggestionPriority !== currentProactiveSuggestionPriority) {
      setProactiveSuggestionPriority(currentProactiveSuggestionPriority);
    }
  }, [currentPid, currentResponseLanguage, currentWritingStyle, currentProactiveSuggestionPriority]);

  // Keyboard handling is centralized in DirectionalButtons to avoid duplicate triggers

  const languageMap: { [key: string]: string } = {
    English: 'en-US',
    Chinese: 'zh-CN',
    Japanese: 'ja-JP',
  };

  const whisperLanguageMap: { [key: string]: string } = {
    English: 'english',
    Chinese: 'chinese',
    Japanese: 'japanese',
  };

  const speechAbortRef = useRef<AbortController | null>(null);
  const [currentSpeech, setCurrentSpeech] = useState<HTMLAudioElement | null>(null);
  const [isGeneratingSpeech, setIsGeneratingSpeech] = useState<boolean>(false);

  const playSpeech = async (text: string) => {
    if (!text || isGeneratingSpeech) return;
    
    speechAbortRef.current?.abort();
    const controller = new AbortController();
    speechAbortRef.current = controller;
    setIsGeneratingSpeech(true);
    if (currentSpeech) {
      currentSpeech.pause();
      currentSpeech.currentTime = 0;
    }

    try {
      const response = await fetch('/api/generate-speech', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate speech');
      }

      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      
      setCurrentSpeech(audio);
      
      audio.play();
      audio.onended = () => {
        setIsGeneratingSpeech(false);
      };
    } catch (error) {
      if (!controller.signal.aborted) console.error('Error playing speech:', error);
      setIsGeneratingSpeech(false);
    }
  };

  // Function to stop current speech playback
  const stopCurrentSpeech = () => {
    speechAbortRef.current?.abort();
    speechAbortRef.current = null;
    if (currentSpeech) {
      currentSpeech.pause();
      currentSpeech.currentTime = 0;
      setCurrentSpeech(null);
    }
    setIsGeneratingSpeech(false);
    console.log('Speech playback stopped');
  };

  const proactiveIdle = !isResetting && authoringPhase === 'none'
    && !isProcessing && !isRefining && !isGeneratingSpeech
    && !showEditingInterface && !showPlotDemonstration && !showLanguagePanel
    && !inMomentList && !photo && !questionText && !generatedImageBase64;

  useEffect(() => {
    setInteractionIdle(proactiveIdle);
  }, [proactiveIdle, setInteractionIdle]);

  useEffect(() => {
    if (!proactiveIdle && suggestionMessage) setSuggestionMessage(null);
  }, [proactiveIdle, suggestionMessage, setSuggestionMessage]);

  if (isResetting) return <div className="min-h-screen bg-black" />;

  if (authoringPhase === 'starting-role-play') {
    return (
      <div className="relative min-h-screen bg-black text-white">
        <DirectionalButtons buttonsVisible={false} isProcessing onButtonClick={handleButtonClick}
          isMuted={isMuted} isTextHidden={isTextHidden} authoringPhase={authoringPhase} />
        <ProcessingIndicator visible />
      </div>
    );
  }

  return (
        <div className="relative min-h-screen bg-black text-white" onClick={handleScreenClick}>
          {/* DirectionalButtons will handle its own positioning and z-index */}
          {authoringPhase != 'editing' && (
            <DirectionalButtons
              buttonsVisible={buttonsVisible}
              isProcessing={isProcessing || isRefining || authoringPhase === 'role-play-waiting'}
              onButtonClick={handleButtonClick}
              isMuted={isMuted}
              isTextHidden={isTextHidden}
              authoringPhase={authoringPhase}
            />
          )}

          {/* Circle Edit Button */}
          {showEditButton && authoringPhase !== 'editing' && (
            <div 
              className="fixed bottom-4 left-4 z-40 w-12 h-12 bg-green-600 hover:bg-green-700 rounded-full flex items-center justify-center cursor-pointer transition-all duration-200 border-2 border-green-400"
              onClick={(e) => {
                e.stopPropagation();
                handleEditButtonClick();
              }}
            >
              <span className="text-white font-bold text-lg">e</span>
            </div>
          )}

          {/* Editing Interface */}
          <EditingInterface
            isVisible={showEditingInterface}
            onClose={handleCloseEditingInterface}
            aiGeneratedContent={aiGeneratedContent}
            savedContent={savedContent}
            onGenerateNew={handleGenerateNewContent}
            onSaveAndUpdate={handleSaveAndUpdateContext}
            onRegenerateWithFeedback={handleRegenerateWithFeedback}
            onShowPlot={handleShowPlot}
            isGenerating={isGeneratingContent}
          />

          <div className="craft-workspace" data-authoring={Boolean(generatedImageBase64 || questionText) || undefined}>
            <NotificationStack hasAuthoringContent={!isRolePlayView && Boolean(generatedImageBase64 || questionText)}>
              <Notification notification={notification} />
              <SuggestionNotification
                suggestion={suggestionMessage}
                isVisible={proactiveIdle && Boolean(suggestionMessage)}
              />
            </NotificationStack>
            <ProcessingIndicator visible={isProcessing || isRefining || authoringPhase === 'role-play-waiting'} />
            {/* Generated Image & Question Card */}
            {!isRolePlayView && (generatedImageBase64 || questionText) && (
              <div className="craft-authoring-layout">
                <div className="craft-transformation-panel">
                  <GeneratedImageCard
                    imageBase64={generatedImageBase64}
                    transformativeScene={transformativeScene}
                    plot={plot}
                    transformativeCharacters={transformativeCharacters}
                    cardOpacity={generatedImageCardOpacity}
                  />
              {/* Mode indicator and role-play prompt */}
              {(authoringPhase === 'showing-image' || authoringPhase === 'question') && (
                <div
                  className="craft-mode-hint"
                  style={{
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    color: 'white',
                    padding: '10px 20px',
                    borderRadius: '24px',
                    fontSize: '14px',
                    border: '1px solid rgba(255, 255, 255, 0.3)',
                  }}
                >
                  Current Mode: {authoringPhase === 'showing-image' ? 'Viewing Generated Content' : 'Answering Question'} | Press ↑ to switch to Role-Play
                </div>
              )}
                </div>
                {questionText && (
                  <QuestionCard
                    questionText={questionText}
                    transformativeScene={transformativeScene}
                    plot={plot}
                    transformativeCharacters={transformativeCharacters}
                    answer={answer}
                    questionCardOpacity={questionCardOpacity}
                    onSpeechEnd={handleSpeechEnd}
                    isMuted={isMuted}
                  
                    onSpeechProgress={(current, total) => console.log(`Speech progress: ${current}/${total}`)}
                    currentTranscription={questionTranscription} // Pass real-time transcription
                    isRecording={isRecordingQuestion}
                  />
                )}
              </div>
            )}
          </div>

          {showPlotDemonstration && (
        <Box sx={{ width: '100%', height: 'var(--craft-stage-height, 100vh)', p: 2 }}>
          
          {plotData && <PlotDemonstration data={plotData} />}
        </Box>
            )}

          {/* Moments Modal */}
          {authoringPhase === 'selection' && (
            <MomentsModal
              momentList={momentList}
              isMuted={isMuted}
              isTextHidden={isTextHidden}
              onClose={() => {
                setMomentList([]);
                setInMomentList(false);
              }}
            />
          )}

          {/* Full Writing Modal */}
          {authoringPhase === 'full' && (
            <FullWritingModal
              fullWriting={fullWriting}
              isMuted={isMuted}
              isTextHidden={isTextHidden}
              onClose={() => {
                setFullWriting([]);
                setInMomentList(false);
                setAuthoringPhase('none');
              }}
            />
          )}

          {/* Photo Card */}
          {authoringPhase === 'photo' && (
            <PhotoCard
              photo={photo}
              photoTranscription={photoTranscription}
              photoCardOpacity={photoCardOpacity}
            />
          )}

          {/* Plot Ideation Card */}
          {authoringPhase === 'plot-ideation' && (
            <PlotIdeationCard
              pilotSummary={pilotSummary}
              elicitationQuestions={elicitationQuestions}
              
              
              isMuted={isMuted}
              onSpeechStart={() => console.log("Plot ideation speech started")}
              onSpeechProgress={(current, total) => console.log(`Plot speech progress: ${current}/${total}`)}
            />
          )}

          {/* Voice Listening Card */}
          <VoiceListeningCard
            visible={authoringPhase === 'voice'}
            currentTranscription={voiceTranscription} // Pass the current voice transcription
          />

          {/* Role-play stays mounted while recording and waiting for a reply. */}
          {isRolePlayView && rolePlayState && (
            <div className="craft-roleplay-layout">
              <RolePlayCard
                userRole={rolePlayState.userRole}
                aiRole={rolePlayState.aiRole}
                aiDialogue={rolePlayState.aiDialogue}
                aiImage={rolePlayState.aiImage}
                opacity={1}
                isListening={authoringPhase === 'role-play-listening'}
              />
              <VoiceListeningCard
                visible={authoringPhase === 'role-play-listening'}
                currentTranscription={voiceTranscription}
                docked
              />
            </div>
          )}

          {/* Language Settings Icon */}
          <div className="fixed bottom-4 right-4 z-50">
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleOpenSettingsPanel();
              }}
              className="w-8 h-8 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded-full flex items-center justify-center text-gray-400 hover:text-white transition-colors"
            >
              <span className="text-xs font-bold">i</span>
            </button>
          </div>

          {/* Language Selection Panel */}
          {showLanguagePanel && (
            <div className="fixed bottom-16 right-4 z-50 bg-black border border-green-500 rounded-lg p-4 w-64 shadow-xl" onClick={e => e.stopPropagation()}>
              <div className="text-green-500 font-semibold mb-3">Settings</div>
              <div className="mb-2 flex items-center gap-2">
                <div className="flex-1">
                  <label className="block text-green-400 text-sm mb-1">Project ID</label>
                  <input
                    className="w-full bg-gray-800 text-white rounded px-2 py-1"
                    value={pid}
                    onChange={e => setPid(e.target.value)}
                  />
                </div>
                <button
                  className="ml-2 px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 border border-green-400"
                  style={{ height: '32px', marginTop: '20px' }}
                  onClick={() => {
                    handlePidSearch();
                  }}
                  disabled={pidSearchLoading}
                  title="Search PID"
                >
                  {pidSearchLoading ? '...' : '🔍'}
                </button>
              </div>
              {pidSearchError && <div className="text-red-400 text-xs mb-2">{pidSearchError}</div>}
              <div className="mb-2">
                <label className="block text-green-400 text-sm mb-1">Response Language</label>
                <select
                  className="w-full bg-gray-800 text-white rounded px-2 py-1"
                  value={responseLanguage}
                  onChange={e => setResponseLanguage(e.target.value)}
                >
                  <option value="English">English</option>
                  <option value="Chinese">Chinese</option>
                  <option value="Japanese">Japanese</option>
                </select>
              </div>
              <div className="mb-2">
                <label className="block text-green-400 text-sm mb-1">Writing Style</label>
                <input
                  className="w-full bg-gray-800 text-white rounded px-2 py-1"
                  value={writingStyle}
                  onChange={e => setWritingStyle(e.target.value)}
                  placeholder="Enter writing style..."
                />
              </div>
              <div className="mb-2">
                <label className="block text-green-400 text-sm mb-1">Proactive Suggestion Priority</label>
                <input
                  className="w-full bg-gray-800 text-white rounded px-2 py-1"
                  value={proactiveSuggestionPriority}
                  onChange={e => setProactiveSuggestionPriority(e.target.value)}
                />
              </div>
              <div className="mb-2">
                <label className="block text-green-400 text-sm mb-1">Microphone</label>
                <select
                  className="w-full bg-gray-800 text-white rounded px-2 py-1"
                  value={selectedAudioDevice}
                  onChange={e => {
                    setSelectedAudioDevice(e.target.value);
                    localStorage.setItem('selectedAudioDevice', e.target.value);
                  }}
                  disabled={audioDevices.length === 0}
                >
                  {audioDevices.length > 0 ? (
                    audioDevices.map(device => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label || `Microphone ${audioDevices.indexOf(device) + 1}`}
                      </option>
                    ))
                  ) : (
                    <option>No microphones found</option>
                  )}
                </select>
              </div>
              <button
                className="w-full bg-green-500 text-black rounded py-2 font-bold mt-2"
                onClick={handleSaveSettings}
              >
                Save
              </button>
            </div>
          )}
        </div>
      );
}
