/**
 * UI utilities for beautiful console output
 */
import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import cliProgress from 'cli-progress';
import figures from 'figures';

// ═══════════════════════════════════════════════════════════════════════════
// THEME
// ═══════════════════════════════════════════════════════════════════════════

export const theme = {
  // Status colors
  success: chalk.green,
  error: chalk.red,
  warning: chalk.yellow,

  // Text styling
  bold: chalk.bold,
  dim: chalk.dim,

  // Symbols (cross-platform via figures)
  check: chalk.green(figures.tick),
  cross: chalk.red(figures.cross),
  warn: chalk.yellow(figures.warning),
  bullet: chalk.dim(figures.bullet),
  pointer: chalk.yellow(figures.pointer),

  // Formatting helpers
  separator: chalk.dim(' · '),
  divider: (label: string, width = 60) => {
    const prefix = `━━━ ${label} `;
    const remaining = Math.max(0, width - prefix.length);
    return chalk.cyan.dim(prefix + '━'.repeat(remaining));
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// SPINNER MANAGER
// ═══════════════════════════════════════════════════════════════════════════

let activeSpinner: Ora | null = null;

export const spinner = {
  /**
   * Start a spinner with the given text
   */
  start(text: string): Ora {
    if (activeSpinner) {
      activeSpinner.stop();
    }
    activeSpinner = ora({
      text,
      spinner: 'dots',
      indent: 4,
    }).start();
    return activeSpinner;
  },

  /**
   * Stop the current spinner with success
   */
  succeed(text?: string): void {
    if (activeSpinner) {
      activeSpinner.succeed(text);
      activeSpinner = null;
    }
  },

  /**
   * Stop the current spinner with failure
   */
  fail(text?: string): void {
    if (activeSpinner) {
      activeSpinner.fail(text);
      activeSpinner = null;
    }
  },

  /**
   * Stop the current spinner (no status indicator)
   */
  stop(): void {
    if (activeSpinner) {
      activeSpinner.stop();
      activeSpinner = null;
    }
  },

  /**
   * Clear the spinner line without stopping
   */
  clear(): void {
    if (activeSpinner) {
      activeSpinner.clear();
    }
  },

  /**
   * Check if a spinner is currently active
   */
  isActive(): boolean {
    return activeSpinner !== null;
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// PROGRESS BAR
// ═══════════════════════════════════════════════════════════════════════════

export interface ProgressTracker {
  start(total: number): void;
  update(current: number): void;
  stop(): void;
}

export function createProgressTracker(label: string): ProgressTracker {
  let bar: cliProgress.SingleBar | null = null;
  let startTime = 0;
  let lastUpdate = 0;
  const MIN_UPDATE_INTERVAL = 100; // ms

  return {
    start(total: number) {
      // Stop any active spinner before starting progress
      spinner.stop();

      startTime = Date.now();
      bar = new cliProgress.SingleBar({
        format: `    {bar} {percentage}%  {value}/{total} ${label}  {duration_formatted}`,
        barCompleteChar: '█',
        barIncompleteChar: '░',
        barsize: 20,
        hideCursor: true,
        clearOnComplete: false,
        stopOnComplete: false,
        forceRedraw: true,
        fps: 10,
      });
      bar.start(total, 0, { duration_formatted: '0s' });
    },

    update(current: number) {
      const now = Date.now();
      // Throttle updates to prevent flickering
      if (now - lastUpdate < MIN_UPDATE_INTERVAL && bar) {
        const total = bar.getTotal();
        if (current < total) {
          return;
        }
      }
      lastUpdate = now;

      if (bar) {
        const elapsed = Math.round((now - startTime) / 1000);
        bar.update(current, { duration_formatted: `${elapsed}s` });
      }
    },

    stop() {
      if (bar) {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        bar.update(bar.getTotal(), { duration_formatted: `${elapsed}s` });
        bar.stop();
        bar = null;
      }
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// FORMATTERS
// ═══════════════════════════════════════════════════════════════════════════

export function formatCost(cost: number): string {
  return theme.dim(`$${cost.toFixed(4)}`);
}

export function formatCostShort(cost: number): string {
  return theme.dim(`$${cost.toFixed(2)}`);
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

export function formatPercentage(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}
