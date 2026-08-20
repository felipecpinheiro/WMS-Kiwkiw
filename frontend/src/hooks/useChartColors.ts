import { useEffect, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';

/**
 * Cores literais pros gráficos do recharts. O recharts escreve as props como
 * atributo SVG (stroke/fill/color), que não resolve var(--x) — por isso lemos
 * o valor computado do token aqui e recalculamos sempre que o tema muda.
 */
interface ChartColors {
  grid: string;
  axisText: string;
  legendText: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  brand: string;
  bad: string;
  neutral: string;
}

function readToken(name: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return raw ? `rgb(${raw})` : '#000000';
}

function computeChartColors(): ChartColors {
  return {
    grid: readToken('--line'),
    axisText: readToken('--t4'),
    legendText: readToken('--t3'),
    tooltipBg: readToken('--surface'),
    tooltipBorder: readToken('--line'),
    tooltipText: readToken('--t1'),
    brand: readToken('--brand'),
    bad: readToken('--bad'),
    neutral: readToken('--line-strong'),
  };
}

export function useChartColors(): ChartColors {
  const { theme } = useTheme();
  const [colors, setColors] = useState<ChartColors>(computeChartColors);

  useEffect(() => {
    setColors(computeChartColors());
  }, [theme]);

  return colors;
}
