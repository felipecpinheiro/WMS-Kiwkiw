import { useEffect, useRef, useState } from 'react';

interface FulfillmentLoaderProps {
  /** Já deve vir passado pelo limiar de exibição (ver useDelayedLoading). */
  show: boolean;
  title?: string;
}

/**
 * Overlay temático de fulfillment: uma caixa atravessa uma esteira, passa por
 * um portal de bipagem no meio (pausa ~0,5s, acende e mostra um ✓), e sai do
 * outro lado — em loop contínuo de 1,4s enquanto `show` for true.
 *
 * Puramente orientado a CSS (sem medir DOM em runtime): a posição da caixa é
 * um `@keyframes` fixo em porcentagem, então não existe a corrida entre
 * "React montou o elemento" e "JS tentou medir a posição dele" que derrubava
 * o design anterior (4 bolinhas com getBoundingClientRect).
 *
 * Ao `show` virar false, o overlay some NA HORA (só um fade curto de 200ms) —
 * com o ciclo já rápido (1,4s), esperar a volta terminar adicionaria até
 * 1,4s de espera artificial DEPOIS dos dados já terem chegado, o que é pior
 * do que um corte suave no meio da animação.
 */
export default function FulfillmentLoader({ show, title = 'Preparando sua operação' }: FulfillmentLoaderProps) {
  const [mounted, setMounted] = useState(show);
  const [leaving, setLeaving] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (show) {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setLeaving(false);
      setMounted(true);
    } else {
      setLeaving(true);
      hideTimer.current = setTimeout(() => setMounted(false), 200);
    }
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [show]);

  if (!mounted) return null;

  return (
    <div className={`kk-fl-overlay${leaving ? ' kk-fl-leaving' : ''}`}>
      <div className="kk-fl-wrap">
        <span className="kk-fl-eyebrow">Fulfillment System</span>
        <h2 className="kk-fl-title">{title}</h2>
        <div className="kk-fl-scene">
          <div className="kk-fl-flash" />
          <div className="kk-fl-gate" />
          <div className="kk-fl-box">
            📦
            <span className="kk-fl-check">✓</span>
          </div>
          <div className="kk-fl-belt" />
          <div className="kk-fl-roller kk-fl-roller-l" />
          <div className="kk-fl-roller kk-fl-roller-r" />
        </div>
      </div>
      <style>{CSS}</style>
    </div>
  );
}

// Timing do ciclo (1400ms): 450ms viajando até o portal, 500ms parada ali
// (com o clarão e o ✓), 450ms viajando até sair. Ver a conversa de design —
// o portal cedo (450ms) foi escolhido de propósito: com os tempos reais
// medidos em produção, a maioria das telas carrega rápido demais pra chegar
// a ver o ✓ se o portal ficasse no meio de um ciclo mais longo.
const CSS = `
.kk-fl-overlay {
  position: absolute; inset: 0; z-index: 40;
  display: flex; align-items: center; justify-content: center;
  background: rgb(var(--surface-2) / 0.97);
  backdrop-filter: blur(1px);
  transition: opacity 200ms ease;
}
.kk-fl-overlay.kk-fl-leaving { opacity: 0; }

.kk-fl-wrap { display: flex; flex-direction: column; align-items: center; gap: 16px; text-align: center; }
.kk-fl-eyebrow {
  font-size: 11px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase;
  color: #7B63E8;
}
.kk-fl-title { font-size: 15px; font-weight: 800; margin: 0; color: rgb(var(--t1)); }

.kk-fl-scene { position: relative; width: 200px; height: 78px; }

.kk-fl-belt {
  position: absolute; left: 6px; right: 6px; bottom: 14px; height: 12px; border-radius: 4px;
  background: repeating-linear-gradient(-45deg, rgb(var(--line)) 0 9px, rgb(var(--surface-2)) 9px 18px);
  background-size: 180% 100%;
  animation: kk-fl-belt-run 900ms linear infinite;
  box-shadow: inset 0 0 0 1px rgb(var(--line) / 0.5);
}
@keyframes kk-fl-belt-run { from { background-position: 0 0; } to { background-position: -25px 0; } }

.kk-fl-roller {
  position: absolute; bottom: 9px; width: 8px; height: 8px; border-radius: 50%;
  background: rgb(var(--line)); border: 1px solid rgb(var(--t4) / 0.3);
}
.kk-fl-roller-l { left: 2px; }
.kk-fl-roller-r { right: 2px; }

.kk-fl-gate {
  position: absolute; top: 2px; bottom: 18px; left: 50%; width: 3px; transform: translateX(-50%);
  background: linear-gradient(180deg, #7B63E8 0%, #3DD9A4 100%); border-radius: 2px; opacity: 0.5;
}

.kk-fl-flash {
  position: absolute; top: 2px; bottom: 18px; left: 50%; width: 28px; transform: translateX(-50%);
  background: radial-gradient(circle, rgb(61 217 164 / 0.45) 0%, rgb(61 217 164 / 0) 70%);
  opacity: 0; animation: kk-fl-flash-seq 1400ms linear infinite;
}
@keyframes kk-fl-flash-seq {
  0%, 28%   { opacity: 0; }
  32%, 68%  { opacity: 1; }
  72%, 100% { opacity: 0; }
}

.kk-fl-box {
  position: absolute; bottom: 20px; left: 0; font-size: 22px;
  filter: drop-shadow(0 3px 6px rgb(0 0 0 / 0.25));
  animation: kk-fl-box-move 1400ms linear infinite;
}
/* Anima só transform/opacity (thread de composição) em vez de left (exige
   layout na thread principal a cada quadro) — com uma tela travando o JS por
   causa de uma tabela gigante (ex: movimentação desde 2025), left congelava
   no meio do trajeto; transform continua rodando suave mesmo assim. Os valores
   em px vêm da largura fixa de .kk-fl-scene (200px): -8% -16px, 50% 100px,
   108% 216px. O "- 50%" mantém a caixa centralizada no ponto, como antes. */
@keyframes kk-fl-box-move {
  0%      { transform: translateX(calc(-16px - 50%)); opacity: 0; }
  10%     { opacity: 1; }
  32.14%  { transform: translateX(calc(100px - 50%)); opacity: 1; }  /* chega no portal aos 450ms */
  67.86%  { transform: translateX(calc(100px - 50%)); opacity: 1; }  /* sai da pausa aos 950ms (500ms parada) */
  95%     { opacity: 1; }
  100%    { transform: translateX(calc(216px - 50%)); opacity: 0; }  /* sai aos 1400ms */
}

.kk-fl-check {
  position: absolute; top: -9px; left: 50%; width: 18px; height: 18px; border-radius: 50%;
  background: #3DD9A4; color: #0E2A22; font-size: 10px; font-weight: 800;
  display: flex; align-items: center; justify-content: center;
  transform: translate(-50%, 6px) scale(0.4); opacity: 0;
  animation: kk-fl-check-seq 1400ms linear infinite;
}
@keyframes kk-fl-check-seq {
  0%, 57%   { opacity: 0; transform: translate(-50%, 6px) scale(0.4); }
  61%       { opacity: 1; transform: translate(-50%, -8px) scale(1.2); }
  66%       { opacity: 1; transform: translate(-50%, -4px) scale(1); }
  75%, 100% { opacity: 0; transform: translate(-50%, -4px) scale(0.7); }
}

@media (prefers-reduced-motion: reduce) {
  .kk-fl-belt, .kk-fl-box, .kk-fl-flash, .kk-fl-check { animation: none !important; }
}
`;
