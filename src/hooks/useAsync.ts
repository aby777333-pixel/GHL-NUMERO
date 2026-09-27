import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from '@/store/app'

export interface AsyncState<T> { data: T | undefined; loading: boolean; error: string | null; reload: () => void }

/** Runs an async loader; re-runs when deps or the global data version change. Stale responses are discarded. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const version = useApp((s) => s.version)
  const [state, setState] = useState<{ data: T | undefined; loading: boolean; error: string | null }>({ data: undefined, loading: true, error: null })
  const [tick, setTick] = useState(0)
  const run = useRef(0)
  const f = useRef(fn)
  f.current = fn

  useEffect(() => {
    const id = ++run.current
    setState((s) => ({ ...s, loading: true, error: null }))
    f.current().then(
      (data) => { if (id === run.current) setState({ data, loading: false, error: null }) },
      (e) => { if (id === run.current) setState({ data: undefined, loading: false, error: e instanceof Error ? e.message : String(e) }) },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version, tick])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { ...state, reload }
}

/** Wraps a mutation: shows the engine's own explanation on refusal, refreshes data on success. */
export function useAction() {
  const toast = useApp((s) => s.toast)
  const touch = useApp((s) => s.touch)
  const [busy, setBusy] = useState(false)
  const act = useCallback(async <T,>(fn: () => Promise<T>, ok?: string | ((r: T) => string)): Promise<T | undefined> => {
    setBusy(true)
    try {
      const r = await fn()
      if (ok) toast('ok', typeof ok === 'function' ? ok(r) : ok)
      touch()
      return r
    } catch (e) {
      toast('error', 'Action refused', e instanceof Error ? e.message : String(e))
      return undefined
    } finally {
      setBusy(false)
    }
  }, [toast, touch])
  return { act, busy }
}
