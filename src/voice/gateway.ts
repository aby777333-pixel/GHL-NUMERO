// VOICE / LANGUAGE PROVIDER GATEWAY (spec 1608-1615).
// Provider-agnostic: NUMERO is not hard-wired to any one speech vendor.
// Voice is an INPUT method only. It can navigate, query and prepare drafts;
// it can never approve, post or release money on its own.

export interface ListenHandlers {
  onInterim(text: string): void
  onFinal(text: string, confidence: number): void
  onError(message: string): void
  onEnd(): void
}

export interface VoiceProvider {
  id: string
  name: string
  /** null when usable; otherwise the plain reason it is not */
  unavailableReason(): string | null
  listen(lang: string, h: ListenHandlers): void
  stop(): void
  speak(text: string, lang: string): void
  cancelSpeech(): void
}

export const VOICE_LANGUAGES = [
  { code: 'en-IN', label: 'English (India)' },
  { code: 'hi-IN', label: 'हिन्दी — Hindi' },
  { code: 'ta-IN', label: 'தமிழ் — Tamil' },
  { code: 'ml-IN', label: 'മലയാളം — Malayalam' },
  { code: 'te-IN', label: 'తెలుగు — Telugu' },
  { code: 'kn-IN', label: 'ಕನ್ನಡ — Kannada' },
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-GB', label: 'English (UK)' },
]

/* eslint-disable @typescript-eslint/no-explicit-any */
class BrowserSpeechProvider implements VoiceProvider {
  id = 'browser'
  name = 'Browser speech engine'
  private rec: any = null

  private ctor(): any {
    const w = window as any
    return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
  }
  unavailableReason() {
    if (!this.ctor()) return 'This browser has no speech recognition. Use Chrome or Edge on desktop or Android.'
    if (!window.isSecureContext) return 'Voice needs a secure (https) connection.'
    return null
  }
  listen(lang: string, h: ListenHandlers) {
    const C = this.ctor()
    if (!C) return h.onError(this.unavailableReason() ?? 'Speech recognition unavailable.')
    this.stop()
    const rec = new C()
    this.rec = rec
    rec.lang = lang
    rec.interimResults = true
    rec.continuous = false
    rec.maxAlternatives = 1
    rec.onresult = (e: any) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) h.onFinal(String(r[0].transcript).trim(), Number(r[0].confidence ?? 0))
        else interim += r[0].transcript
      }
      if (interim) h.onInterim(interim.trim())
    }
    rec.onerror = (e: any) => {
      const map: Record<string, string> = {
        'not-allowed': 'Microphone access was not allowed. Enable it for this site in the browser address bar.',
        'service-not-allowed': 'Speech recognition is blocked by the browser or device policy.',
        'no-speech': 'I did not hear anything. Try again.',
        'audio-capture': 'No microphone was found.',
        network: 'The speech service could not be reached. Check the connection.',
        aborted: '',
      }
      const m = map[e.error] ?? `Speech recognition error: ${e.error}`
      if (m) h.onError(m)
    }
    rec.onend = () => { if (this.rec === rec) this.rec = null; h.onEnd() }
    try { rec.start() } catch (err) { h.onError(err instanceof Error ? err.message : 'Could not start listening.') }
  }
  stop() {
    try { this.rec?.abort() } catch { /* already stopped */ }
    this.rec = null
  }
  speak(text: string, lang: string) {
    if (!('speechSynthesis' in window)) return
    this.cancelSpeech()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = lang
    u.rate = 1.02
    u.pitch = 1
    const v = window.speechSynthesis.getVoices().find((x) => x.lang === lang) ?? window.speechSynthesis.getVoices().find((x) => x.lang.startsWith(lang.slice(0, 2)))
    if (v) u.voice = v
    window.speechSynthesis.speak(u)
  }
  cancelSpeech() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
  }
}

/**
 * Sarvam AI adapter. Indian-language speech needs a Sarvam API key, which must live
 * as a server-side secret behind an authenticated function — never in the browser.
 * That function is not deployed yet, so this provider reports itself unavailable and
 * the gateway falls back. Tracked in the requirement ledger (1609).
 */
class SarvamProvider implements VoiceProvider {
  id = 'sarvam'
  name = 'Sarvam AI (Indian languages)'
  unavailableReason() { return 'Not connected. Sarvam needs an API key stored as a server-side secret; ask your administrator to configure it.' }
  listen(_lang: string, h: ListenHandlers) { h.onError(this.unavailableReason()); h.onEnd() }
  stop() { /* nothing to stop */ }
  speak() { /* not connected */ }
  cancelSpeech() { /* not connected */ }
}

export const PROVIDERS: VoiceProvider[] = [new BrowserSpeechProvider(), new SarvamProvider()]

/** Preferred provider if usable, otherwise the first usable fallback. */
export function resolveProvider(preferred = 'browser'): { provider: VoiceProvider | null; fellBack: boolean; reason: string | null } {
  const want = PROVIDERS.find((p) => p.id === preferred) ?? PROVIDERS[0]
  if (!want.unavailableReason()) return { provider: want, fellBack: false, reason: null }
  const alt = PROVIDERS.find((p) => !p.unavailableReason())
  return { provider: alt ?? null, fellBack: Boolean(alt), reason: want.unavailableReason() }
}
