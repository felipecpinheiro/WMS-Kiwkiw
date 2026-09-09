import { useEffect, useRef, useState } from 'react';

/**
 * Só vira `true` depois de `delayMs` de carregamento contínuo (evita "flash"
 * em consultas rápidas). Volta a `false` na hora, assim que `isLoading` cair.
 */
export function useDelayedLoading(isLoading: boolean, delayMs = 150): boolean {
  const [show, setShow] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isLoading) {
      timerRef.current = setTimeout(() => setShow(true), delayMs);
    } else {
      if (timerRef.current) clearTimeout(timerRef.current);
      setShow(false);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isLoading, delayMs]);

  return show;
}
