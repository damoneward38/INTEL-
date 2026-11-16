export function isSpeechTalkSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof SpeechSynthesisUtterance !== 'undefined'
  );
}

export function stopSpeechTalk(): void {
  if (!isSpeechTalkSupported()) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // Ignore browser speech synthesis cancel errors
  }
}

export function speakAloud(
  text: string,
  options: {
    language: 'en' | 'he';
    rate?: number;
    onStart?: () => void;
    onEnd?: () => void;
    onError?: () => void;
  }
): boolean {
  if (!isSpeechTalkSupported() || !text.trim()) {
    options.onError?.();
    return false;
  }

  try {
    window.speechSynthesis.cancel();
    const cleaned = text
      .replace(/[#*`>_]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 2800);

    const utterance = new SpeechSynthesisUtterance(cleaned);
    utterance.lang = options.language === 'he' ? 'he-IL' : 'en-US';
    utterance.rate = options.rate ?? 1.0;

    const voices = window.speechSynthesis.getVoices();
    const langPrefix = options.language === 'he' ? 'he' : 'en';
    const preferredVoice = voices.find((v) =>
      v.lang.toLowerCase().startsWith(langPrefix)
    );
    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }

    utterance.onstart = () => options.onStart?.();
    utterance.onend = () => options.onEnd?.();
    utterance.onerror = () => options.onError?.();

    window.speechSynthesis.speak(utterance);
    return true;
  } catch {
    options.onError?.();
    return false;
  }
}
