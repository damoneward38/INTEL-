import { useCallback, useRef, useState } from 'react';

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultItem {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultItem>;
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

interface SpeechRecognitionInstance {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  start(): void;
  stop(): void;
}

interface SpeechWindow extends Window {
  SpeechRecognition?: new () => SpeechRecognitionInstance;
  webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
}

export function useVoice(
  language: 'en' | 'he',
  onFinalTranscript: (transcript: string) => void
) {
  const [listening, setListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  const SpeechConstructor =
    typeof window !== 'undefined'
      ? (window as SpeechWindow).SpeechRecognition ||
        (window as SpeechWindow).webkitSpeechRecognition
      : undefined;

  const supported = Boolean(SpeechConstructor);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const start = useCallback(() => {
    if (!SpeechConstructor) {
      setVoiceError('Web Speech API is not supported in this browser.');
      return;
    }

    setVoiceError(null);
    setInterimTranscript('');

    const recognition = new SpeechConstructor();
    recognition.lang = language === 'he' ? 'he-IL' : 'en-US';
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let combined = '';
      let isFinalResult = false;
      for (let i = 0; i < event.results.length; i++) {
        const res = event.results[i];
        if (res[0]?.transcript) {
          combined += res[0].transcript + ' ';
        }
        if (res.isFinal) {
          isFinalResult = true;
        }
      }
      const trimmed = combined.trim();
      setInterimTranscript(trimmed);
      if (isFinalResult && trimmed) {
        onFinalTranscript(trimmed);
      }
    };

    recognition.onerror = (event) => {
      setVoiceError(`Voice recognition error: ${event.error}`);
      setListening(false);
    };

    recognition.onend = () => {
      setListening(false);
    };

    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }, [SpeechConstructor, language, onFinalTranscript]);

  return {
    supported,
    listening,
    interimTranscript,
    voiceError,
    start,
    stop,
  };
}
