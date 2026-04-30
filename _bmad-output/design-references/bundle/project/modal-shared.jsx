// Modal chrome + onboarding chrome + faded dashboard backdrops

function Modal({ width = 520, children, onClose }) {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: 'rgba(10, 18, 48, 0.5)',
      backdropFilter: 'blur(6px)',
      display: 'grid', placeItems: 'center',
      zIndex: 50, padding: 24,
    }}>
      <div style={{
        width, maxWidth: '100%',
        background: 'var(--mp-surface)',
        borderRadius: 'var(--mp-radius-lg)',
        boxShadow: '0 30px 60px rgba(10, 18, 48, 0.32), 0 8px 24px rgba(10, 18, 48, 0.18)',
        position: 'relative',
        animation: 'fadeUp 0.3s cubic-bezier(0.2, 0.7, 0.3, 1)',
      }}>
        {onClose && (
          <button onClick={onClose} style={{
            position: 'absolute', top: 14, right: 14, zIndex: 1,
            width: 32, height: 32,
            display: 'grid', placeItems: 'center',
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--mp-ink-3)', borderRadius: 8,
            transition: 'background 0.15s, color 0.15s',
          }}
          onMouseOver={(e) => { e.currentTarget.style.background = 'var(--mp-bg)'; e.currentTarget.style.color = 'var(--mp-ink)'; }}
          onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--mp-ink-3)'; }}
          >
            <Icon name="close" style={{ fontSize: 20 }} />
          </button>
        )}
        {children}
      </div>
    </div>
  );
}

function ModalBody({ children, style }) {
  return <div style={{ padding: '32px 32px 28px', ...style }}>{children}</div>;
}

function ModalFooter({ children, style }) {
  return (
    <div style={{
      padding: '20px 32px 28px',
      borderTop: '1px solid var(--mp-line-soft)',
      display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'flex-end',
      flexWrap: 'wrap',
      ...style,
    }}>{children}</div>
  );
}

function PrimaryButton({ children, style, ...rest }) {
  return (
    <button {...rest} style={{
      padding: '12px 22px',
      background: 'linear-gradient(135deg, var(--mp-primary), var(--mp-primary-2))',
      color: '#fff', border: 'none',
      borderRadius: 'var(--mp-radius-sm)', cursor: 'pointer',
      fontSize: 14, fontWeight: 700,
      fontFamily: 'var(--mp-font-display)', letterSpacing: '-0.01em',
      display: 'inline-flex', alignItems: 'center', gap: 8,
      boxShadow: '0 8px 18px color-mix(in oklch, var(--mp-primary) 22%, transparent)',
      ...style,
    }}>{children}</button>
  );
}

function SecondaryButton({ children, style, ...rest }) {
  return (
    <button {...rest} style={{
      padding: '12px 18px',
      background: 'var(--mp-surface)', color: 'var(--mp-ink-2)',
      border: '1px solid var(--mp-line)',
      borderRadius: 'var(--mp-radius-sm)', cursor: 'pointer',
      fontSize: 13, fontWeight: 600,
      fontFamily: 'var(--mp-font-body)',
      ...style,
    }}>{children}</button>
  );
}

// Onboarding header — same logo, no nav, no PT/ES toggle, with progress steps
function OnboardingChrome({ currentStep }) {
  const steps = [
    { id: 'key',    label: 'Chave' },
    { id: 'scan',   label: 'Análise' },
    { id: 'margin', label: 'Margem' },
    { id: 'live',   label: 'Live' },
  ];
  const currentIdx = steps.findIndex(s => s.id === currentStep);
  return (
    <header style={{
      background: 'var(--mp-surface)',
      borderBottom: '1px solid var(--mp-line-soft)',
    }}>
      <div style={{
        maxWidth: 1400, margin: '0 auto',
        padding: '18px 32px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 24,
      }}>
        <Logo />
        <nav style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
          {steps.map((s, i) => {
            const done = i < currentIdx;
            const cur = i === currentIdx;
            const future = i > currentIdx;
            return (
              <React.Fragment key={s.id}>
                {i > 0 && (
                  <span style={{
                    width: 36, height: 1,
                    background: i <= currentIdx ? 'var(--mp-primary)' : 'var(--mp-line)',
                    margin: '0 4px',
                  }} />
                )}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 12px',
                  borderRadius: 999,
                  background: cur ? 'var(--mp-primary)' : 'transparent',
                }}>
                  <span style={{
                    width: 22, height: 22, borderRadius: '50%',
                    display: 'grid', placeItems: 'center',
                    background: done ? 'var(--mp-win)'
                              : cur  ? 'rgba(255,255,255,0.2)'
                              :        'var(--mp-bg)',
                    color: done ? '#fff' : cur ? '#fff' : 'var(--mp-ink-3)',
                    border: future ? '1px solid var(--mp-line)' : 'none',
                    fontSize: 11, fontWeight: 800,
                    fontFamily: 'var(--mp-font-display)',
                  }}>
                    {done ? <Icon name="check" style={{ fontSize: 14 }} /> : (i + 1)}
                  </span>
                  <span className="font-display" style={{
                    fontSize: 12, fontWeight: 700,
                    color: cur ? '#fff'
                         : done ? 'var(--mp-ink)'
                         :        'var(--mp-ink-3)',
                    letterSpacing: '-0.01em',
                  }}>{s.label}</span>
                </div>
              </React.Fragment>
            );
          })}
        </nav>
        <div style={{ width: 80 }} />
      </div>
    </header>
  );
}

function OnboardingFrame({ currentStep, children, maxWidth = 720 }) {
  return (
    <div style={{ minHeight: '100%', background: 'var(--mp-bg)' }}>
      <OnboardingChrome currentStep={currentStep} />
      <main style={{
        maxWidth, margin: '0 auto',
        padding: '56px 32px 64px',
        display: 'flex', flexDirection: 'column', gap: 28,
      }}>{children}</main>
    </div>
  );
}

// Faded dashboard backdrop helper for modals — just renders a dashboard
// composer with reduced contrast / blur via wrapper
function ModalBackdrop({ children }) {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      filter: 'blur(2px) saturate(0.85)',
      pointerEvents: 'none',
      transform: 'scale(1.005)',
    }}>{children}</div>
  );
}

// Trust block — prominent variant matched to MarketPilot.html lines 569-602
function TrustBlockProminent({ icon = 'lock', body, linkText, linkHref = '#' }) {
  return (
    <div style={{
      marginTop: 4,
      padding: '16px 18px',
      background: 'var(--mp-win-soft)',
      border: '1px solid color-mix(in oklch, var(--mp-win) 25%, transparent)',
      borderRadius: 'var(--mp-radius-sm)',
      display: 'flex', gap: 14, alignItems: 'flex-start',
    }}>
      <Icon name={icon} fill style={{
        color: 'var(--mp-win)', fontSize: 20,
        marginTop: 1, flexShrink: 0,
      }} />
      <div>
        <p style={{
          margin: 0, fontSize: 13, fontWeight: 500,
          color: 'var(--mp-ink)', lineHeight: 1.55,
        }}>{body}</p>
        {linkText && (
          <a href={linkHref} style={{
            display: 'inline-block', marginTop: 8,
            fontSize: 12, fontWeight: 700,
            color: 'var(--mp-primary)',
            textDecoration: 'none', letterSpacing: '0.01em',
          }}>{linkText}</a>
        )}
      </div>
    </div>
  );
}

Object.assign(window, {
  Modal, ModalBody, ModalFooter, PrimaryButton, SecondaryButton,
  OnboardingChrome, OnboardingFrame, ModalBackdrop, TrustBlockProminent,
});
