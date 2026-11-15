import { Mic, MicOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useVoice } from '../hooks/useVoice';

interface Props {
  language: 'en' | 'he';
  onResult: (transcript: string) => void;
}

export default function VoiceControl({ language, onResult }: Props) {
  const { t } = useTranslation();
  const { supported, listening, interimTranscript, voiceError, start, stop } =
    useVoice(language, onResult);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={listening ? stop : start}
          disabled={!supported}
          className={`flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
            listening
              ? 'border-rose-500/70 bg-rose-500/15 text-rose-300'
              : 'border-slate-700 bg-slate-900 text-slate-200 hover:border-cyan-500/50 hover:text-cyan-200 disabled:opacity-45 disabled:cursor-not-allowed'
          }`}
          title={supported ? t('command.voiceSupported') : t('command.voiceUnsupported')}
        >
          {listening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5 text-cyan-400" />}
          <span>{listening ? t('command.voiceListening') : t('command.voiceSpeak')}</span>
        </button>

        <span className="text-[11px] text-slate-400">
          {supported ? t('command.voiceSupported') : t('command.voiceUnsupported')}
        </span>
      </div>

      {interimTranscript && (
        <p className="text-xs text-cyan-300 font-mono-tabular truncate">
          “{interimTranscript}”
        </p>
      )}
      {voiceError && <p className="text-xs text-rose-400">{voiceError}</p>}
    </div>
  );
}
