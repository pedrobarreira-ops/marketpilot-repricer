// Shared primitives for dashboard-and-audit.html
const { useState, useEffect, useRef, useMemo } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "screen": "dash-dryrun",
  "channel": "pt"
}/*EDITMODE-END*/;

const SCREENS = [
  { id: 'dash-loading',    group: 'Dashboard', label: 'Loading' },
  { id: 'dash-dryrun',     group: 'Dashboard', label: 'Dry-run' },
  { id: 'dash-live',       group: 'Dashboard', label: 'Live' },
  { id: 'dash-paused-cust',group: 'Dashboard', label: 'Pausa (cliente)' },
  { id: 'dash-paused-pay', group: 'Dashboard', label: 'Pausa (pagamento)' },
  { id: 'audit',           group: 'Audit',     label: 'Audit log' },
  { id: 'margin-editor',   group: 'Margin',    label: 'Margin editor' },
];

function Icon({ name, fill, style, className = '' }) {
  return (
    <span
      className={`material-symbols-outlined${fill ? ' msym-fill' : ''} ${className}`}
      style={style}
    >{name}</span>
  );
}

function Logo({ size = 'md' }) {
  const sizes = { sm: 18, md: 22, lg: 28 };
  const px = sizes[size];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{
        width: px + 6, height: px + 6,
        background: 'var(--mp-primary)',
        borderRadius: 'calc(var(--mp-radius-sm) - 2px)',
        display: 'grid', placeItems: 'center',
        position: 'relative',
      }}>
        <div style={{
          width: Math.round((px+6)*0.42), height: Math.round((px+6)*0.42),
          background: '#fff', clipPath: 'polygon(50% 0, 100% 100%, 0 100%)',
          transform: 'rotate(15deg)',
        }} />
      </div>
      <span className="font-display" style={{
        fontWeight: 800, fontSize: px, color: 'var(--mp-primary)',
        letterSpacing: '-0.03em',
      }}>MarketPilot</span>
    </div>
  );
}

const fmtEur = (n) => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 }).format(n);
const fmtCurrency = (n) => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
const fmtNum = (n) => new Intl.NumberFormat('pt-PT').format(n);

// ============ DASHBOARD CHROME ============
function DashHeader({ channel, setChannel, paused, screen, onTogglePause }) {
  const showPause = screen === 'dash-live';
  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 40,
      background: 'rgba(245, 247, 250, 0.92)',
      backdropFilter: 'blur(12px)',
      borderBottom: '1px solid var(--mp-line-soft)',
    }}>
      <div style={{
        maxWidth: 1400, margin: '0 auto',
        padding: '14px 32px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <Logo />
          <nav style={{ display: 'flex', gap: 20 }}>
            <a href="#" style={{ fontSize: 13, fontWeight: 600, color: 'var(--mp-primary)', textDecoration: 'none' }}>Dashboard</a>
            <a href="#" style={{ fontSize: 13, fontWeight: 500, color: 'var(--mp-ink-3)', textDecoration: 'none' }}>Audit log</a>
            <a href="#" style={{ fontSize: 13, fontWeight: 500, color: 'var(--mp-ink-3)', textDecoration: 'none' }}>Definições</a>
          </nav>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {/* Channel toggle */}
          <div style={{
            display: 'flex', background: 'var(--mp-surface)',
            border: '1px solid var(--mp-line)',
            borderRadius: 'var(--mp-radius-sm)', padding: 3,
          }}>
            {[
              { id: 'pt', label: 'Portugal' },
              { id: 'es', label: 'Espanha' },
            ].map(t => (
              <button key={t.id} onClick={() => setChannel(t.id)} style={{
                padding: '6px 14px', border: 'none', cursor: 'pointer',
                background: channel === t.id ? 'var(--mp-primary)' : 'transparent',
                color: channel === t.id ? '#fff' : 'var(--mp-ink-2)',
                fontWeight: 600, fontSize: 12,
                borderRadius: 'calc(var(--mp-radius-sm) - 2px)',
                fontFamily: 'var(--mp-font-display)',
                letterSpacing: '-0.01em',
              }}>{t.label}</button>
            ))}
          </div>
          {showPause && (
            <button onClick={onTogglePause} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 12px', background: 'var(--mp-surface)',
              border: '1px solid var(--mp-line)',
              borderRadius: 'var(--mp-radius-sm)', cursor: 'pointer',
              fontSize: 12, fontWeight: 600, color: 'var(--mp-ink-2)',
            }}>
              <Icon name="pause_circle" fill style={{ fontSize: 16, color: 'var(--mp-ink-2)' }} />
              Pausar repricing
            </button>
          )}
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: 'var(--mp-primary)', color: '#fff',
            display: 'grid', placeItems: 'center',
            fontSize: 12, fontWeight: 700,
          }}>TC</div>
        </div>
      </div>
    </header>
  );
}

// Banner — variants per §9.4–§9.9
function Banner({ kind, children, action }) {
  const palettes = {
    dryrun:   { bg: 'var(--mp-info-soft)', fg: 'var(--mp-info)',  border: 'color-mix(in oklch, var(--mp-info) 30%, transparent)',  icon: 'science' },
    paused:   { bg: '#eef0f4',             fg: 'var(--mp-ink-2)', border: 'var(--mp-line)',                                        icon: 'pause_circle' },
    payment:  { bg: 'var(--mp-loss-soft)', fg: 'var(--mp-loss)',  border: 'color-mix(in oklch, var(--mp-loss) 35%, transparent)',  icon: 'warning' },
    anomaly:  { bg: 'var(--mp-warn-soft)', fg: 'var(--mp-warn)',  border: 'color-mix(in oklch, var(--mp-warn) 40%, transparent)',  icon: 'error' },
    breaker:  { bg: 'var(--mp-loss-soft)', fg: 'var(--mp-loss)',  border: 'color-mix(in oklch, var(--mp-loss) 35%, transparent)',  icon: 'gpp_maybe' },
    transient:{ bg: '#eef0f4',             fg: 'var(--mp-ink-2)', border: 'var(--mp-line)',                                        icon: 'schedule' },
  };
  const p = palettes[kind];
  return (
    <div style={{
      background: p.bg, border: `1px solid ${p.border}`,
      borderRadius: 'var(--mp-radius)', padding: '14px 18px',
      display: 'flex', alignItems: 'center', gap: 14,
      animation: 'fadeUp 0.4s ease-out',
    }}>
      <Icon name={p.icon} fill style={{ fontSize: 22, color: p.fg, flexShrink: 0 }} />
      <div style={{ flex: 1, fontSize: 13, color: 'var(--mp-ink)', lineHeight: 1.5 }}>{children}</div>
      {action && (
        <button style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '8px 14px', background: p.fg, color: '#fff',
          border: 'none', borderRadius: 'var(--mp-radius-sm)',
          cursor: 'pointer', fontSize: 12, fontWeight: 700,
          fontFamily: 'var(--mp-font-display)', letterSpacing: '-0.01em',
          flexShrink: 0,
        }}>
          {action.label}
          <Icon name="arrow_forward" style={{ fontSize: 16 }} />
        </button>
      )}
    </div>
  );
}

Object.assign(window, {
  React, useState, useEffect, useRef, useMemo,
  TWEAK_DEFAULTS, SCREENS,
  Icon, Logo, fmtEur, fmtCurrency, fmtNum,
  DashHeader, Banner,
});
