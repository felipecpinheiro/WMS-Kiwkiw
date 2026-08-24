/**
 * WMS Kiwkiw - Marca
 *
 * Ponto único da logo. Todas as telas passam por aqui — trocar a arte é
 * trocar os PNGs em public/marca/, sem mexer em tela nenhuma.
 *
 * A arte muda com o tema porque a versão colorida tem a lupa em #232323:
 * no fundo escuro ela some. No escuro entra a versão branca.
 *
 * O símbolo NÃO é quadrado (~1,27:1). Por isso a altura sai da proporção e
 * não do tamanho — usar uma caixa quadrada (w-10 h-10) esticaria o desenho.
 */
import type { CSSProperties } from 'react';
import { useTheme } from '../contexts/ThemeContext';

// As duas artes têm proporção levemente diferente (1,265 e 1,275); o
// object-contain absorve a sobra em vez de distorcer.
const PROPORCAO = 1.27;

interface LogoProps {
  /** Largura em px. 32 = Bipagem/Portal, 40 = Sidebar, 80 = Login. */
  size?: number;
  className?: string;
  style?: CSSProperties;
}

export default function Logo({ size = 40, className = '', style }: LogoProps) {
  const { theme } = useTheme();
  const src = theme === 'dark'
    ? '/marca/simbolo-tema-escuro.png'
    : '/marca/simbolo-tema-claro.png';

  return (
    <img
      src={src}
      alt="Kiwkiw"
      width={size}
      height={Math.round(size / PROPORCAO)}
      className={`flex-shrink-0 object-contain ${className}`}
      style={style}
    />
  );
}
