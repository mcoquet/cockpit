import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

export default function Terminal() {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#e0e0e0',
        cursor: '#e0e0e0',
        cursorAccent: '#1e1e1e',
        selectionBackground: '#3a3a3a',
        black: '#000000',
        red: '#ff5f56',
        green: '#27c93f',
        yellow: '#ffbd2e',
        blue: '#0a84ff',
        magenta: '#af52de',
        cyan: '#5ac8fa',
        white: '#e0e0e0',
        brightBlack: '#666666',
        brightRed: '#ff6961',
        brightGreen: '#30d158',
        brightYellow: '#ffd60a',
        brightBlue: '#64d2ff',
        brightMagenta: '#bf5af2',
        brightCyan: '#6ac4dc',
        brightWhite: '#ffffff',
      },
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);

    terminal.open(containerRef.current);
    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Send input to PTY
    terminal.onData((data) => {
      window.terminal.sendInput(data);
    });

    // Receive output from PTY
    window.terminal.onOutput((data) => {
      terminal.write(data);
    });

    // Handle window resize
    const handleResize = () => {
      if (fitAddonRef.current && terminalRef.current) {
        fitAddonRef.current.fit();
        const { cols, rows } = terminalRef.current;
        window.terminal.resize(cols, rows);
      }
    };

    window.addEventListener('resize', handleResize);

    // Initial resize notification
    setTimeout(() => {
      handleResize();
    }, 100);

    return () => {
      window.removeEventListener('resize', handleResize);
      terminal.dispose();
    };
  }, []);

  return <div ref={containerRef} className="terminal-container" />;
}
