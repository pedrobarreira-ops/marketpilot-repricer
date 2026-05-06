// Phase E — Mobile artboards (UX26 critical-alert flow)
// 375 × 812, iPhone 14. Reuses customer-facing visual DNA.

// Shared mobile chrome
function MobileHeader({ back }) {
  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 10,
      height: 56,
      background: 'var(--mp-surface)',
      borderBottom: '1px solid var(--mp-line-soft)',
      display: 'flex', alignItems: 'center',
      padding: '0 16px',
      gap: 12,
    }}>
      {back && (
        <button style={{
          width: 36, height: 36, borderRadius: 8,
          border: 'none', background: 'transparent',
          display: 'grid', placeItems: 'center', cursor: 'pointer',
          marginLeft: -8,
        }}>
          <Icon name="arrow_back" style={{ fontSize: 22, color: 'var(--mp-ink)' }} />
        </button>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 26, height: 26, borderRadius: 7,
          background: 'linear-gradient(135deg, var(--mp-primary), var(--mp-primary-2))',
          display: 'grid', placeItems: 'center',
          color: '#fff',
          fontFamily: 'var(--mp-font-display)',
          fontWeight: 800, fontSize: 13,
          letterSpacing: '-0.04em',
        }}>M</div>
        <span className="font-display" style={{
          fontSize: 16, fontWeight: 800, color: 'var(--mp-primary)',
          letterSpacing: '-0.015em',
        }}>MarketPilot</span>
      </div>
    </header>
  );
}

function MobileBottomBar() {
  return (
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0,
      background: 'var(--mp-surface)',
      boxShadow: '0 -6px 18px rgba(10, 18, 48, 0.06)',
      borderTop: '1px solid var(--mp-line-soft)',
      padding: '12px 16px 28px',
      display: 'grid', gridTemplateColumns: '1fr 1fr',
      gap: 10,
    }}>
      <button style={{
        height: 48, borderRadius: 'var(--mp-radius-sm)',
        background: 'transparent',
        border: '1px solid var(--mp-line)',
        color: 'var(--mp-loss)',
        fontFamily: 'var(--mp-font-display)',
        fontWeight: 700, fontSize: 13,
        cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      }}>
        <Icon name="pause_circle" style={{ fontSize: 18 }} />
        Pausar
      </button>
      <button style={{
        height: 48, borderRadius: 'var(--mp-radius-sm)',
        background: 'var(--mp-warn)',
        border: 'none',
        color: '#fff',
        fontFamily: 'var(--mp-font-display)',
        fontWeight: 700, fontSize: 13,
        cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        boxShadow: '0 6px 14px color-mix(in oklch, var(--mp-warn) 28%, transparent)',
      }}>
        <Icon name="warning" fill style={{ fontSize: 18 }} />
        Ver alertas
        <span style={{
          background: 'rgba(255,255,255,0.25)',
          padding: '1px 7px', borderRadius: 999,
          fontSize: 11, fontWeight: 800,
          fontFamily: 'var(--mp-font-mono)',
        }}>2</span>
      </button>
    </div>
  );
}

// =================== MOBILE A — Critical-alert glance ===================
function ScreenMobileAlert() {
  return (
    <div style={{
      width: 375, height: 812, margin: '0 auto',
      background: 'var(--mp-bg)',
      position: 'relative',
      overflow: 'hidden',
      fontFamily: 'var(--mp-font-body)',
      boxShadow: '0 30px 60px rgba(10,18,48,0.10)',
      border: '1px solid var(--mp-line-soft)',
      borderRadius: 28,
    }}>
      <MobileHeader />

      <div style={{
        height: 'calc(100% - 56px)',
        overflowY: 'auto',
        padding: '16px 16px 132px',
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        {/* Status banner */}
        <div style={{
          background: 'var(--mp-warn-soft)',
          borderLeft: '3px solid var(--mp-warn)',
          borderRadius: 'var(--mp-radius)',
          padding: '14px 16px',
          display: 'flex', gap: 12,
        }}>
          <Icon name="warning" fill style={{ fontSize: 22, color: 'var(--mp-warn)', flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1 }}>
            <p className="font-display" style={{
              margin: '0 0 4px', fontSize: 15, fontWeight: 800,
              color: 'var(--mp-primary)', letterSpacing: '-0.01em',
              lineHeight: 1.3,
            }}>2 eventos a precisar da tua atenção</p>
            <p style={{
              margin: 0, fontSize: 13, color: 'var(--mp-ink-2)',
              lineHeight: 1.45,
            }}>Repricing congelado nos SKUs afectados até reveres.</p>
          </div>
        </div>

        {/* Event preview card */}
        <article style={{
          background: 'var(--mp-surface)',
          border: '1px solid var(--mp-line-soft)',
          borderRadius: 'var(--mp-radius)',
          padding: '16px',
          display: 'flex', flexDirection: 'column', gap: 14,
        }}>
          {/* Chip */}
          <div style={{
            display: 'inline-flex', alignSelf: 'flex-start',
            alignItems: 'center', gap: 5,
            padding: '3px 9px',
            background: 'var(--mp-warn-soft)',
            color: 'var(--mp-warn)',
            border: '1px solid color-mix(in oklch, var(--mp-warn) 22%, transparent)',
            borderRadius: 999,
            fontSize: 11, fontWeight: 700,
            fontFamily: 'var(--mp-font-display)',
            letterSpacing: '-0.005em',
          }}>
            <Icon name="warning" fill style={{ fontSize: 12 }} />
            anomalia · acima do limiar de −25%
          </div>

          {/* SKU */}
          <div>
            <p className="tabular" style={{ margin: '0 0 3px', fontSize: 11, color: 'var(--mp-ink-3)', fontWeight: 600 }}>
              SON-XR55A80L · TVs
            </p>
            <p className="font-display" style={{
              margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--mp-primary)',
              letterSpacing: '-0.01em', lineHeight: 1.3,
            }}>Sony OLED 55" XR-A80L</p>
          </div>

          {/* Price comparison */}
          <div style={{
            background: 'var(--mp-surface-2)',
            borderRadius: 'var(--mp-radius-sm)',
            padding: '12px 14px',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: 12, color: 'var(--mp-ink-3)' }}>Preço atual</span>
              <span className="tabular" style={{ fontSize: 14, fontWeight: 600, color: 'var(--mp-ink)' }}>1.149 €</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: 12, color: 'var(--mp-ink-3)' }}>Proposto pelo motor</span>
              <span className="tabular" style={{ fontSize: 14, fontWeight: 700, color: 'var(--mp-loss)' }}>799 €</span>
            </div>
            <div style={{ height: 1, background: 'var(--mp-line-soft)', margin: '2px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--mp-ink-2)' }}>Variação</span>
              <span className="tabular font-display" style={{ fontSize: 16, fontWeight: 800, color: 'var(--mp-loss)', letterSpacing: '-0.01em' }}>−30,5%</span>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button style={{
              height: 46, borderRadius: 'var(--mp-radius-sm)',
              background: 'linear-gradient(135deg, var(--mp-primary), var(--mp-primary-2))',
              border: 'none', color: '#fff',
              fontFamily: 'var(--mp-font-display)',
              fontWeight: 700, fontSize: 14,
              cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              boxShadow: '0 6px 14px color-mix(in oklch, var(--mp-primary) 22%, transparent)',
            }}>
              <Icon name="check" style={{ fontSize: 18 }} />
              Aceitar ajuste
            </button>
            <button style={{
              height: 46, borderRadius: 'var(--mp-radius-sm)',
              background: 'var(--mp-surface)',
              border: '1px solid var(--mp-line)',
              color: 'var(--mp-ink)',
              fontFamily: 'var(--mp-font-display)',
              fontWeight: 600, fontSize: 14,
              cursor: 'pointer',
            }}>
              Rejeitar e manter 1.149 €
            </button>
          </div>

          <a href="#" style={{
            alignSelf: 'center',
            fontSize: 13, fontWeight: 600,
            color: 'var(--mp-primary)', textDecoration: 'none',
            display: 'inline-flex', alignItems: 'center', gap: 4,
          }}>
            Ver todos os eventos
            <Icon name="arrow_forward" style={{ fontSize: 16 }} />
          </a>
        </article>

        {/* Eyebrow context */}
        <p className="tabular" style={{
          textAlign: 'center', fontSize: 11, color: 'var(--mp-ink-3)',
          margin: '4px 0 0',
        }}>
          Repricing pausado nestes SKUs · 22:47
        </p>
      </div>

      <MobileBottomBar />
    </div>
  );
}

// =================== MOBILE B — Atenção entry detail ===================
function ScreenMobileDetail() {
  return (
    <div style={{
      width: 375, height: 812, margin: '0 auto',
      background: 'var(--mp-bg)',
      position: 'relative',
      overflow: 'hidden',
      fontFamily: 'var(--mp-font-body)',
      boxShadow: '0 30px 60px rgba(10,18,48,0.10)',
      border: '1px solid var(--mp-line-soft)',
      borderRadius: 28,
    }}>
      <MobileHeader back />

      <div style={{
        height: 'calc(100% - 56px)',
        overflowY: 'auto',
        padding: '16px 16px 132px',
        display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        {/* Event header card */}
        <article style={{
          background: 'var(--mp-surface)',
          border: '1px solid var(--mp-line-soft)',
          borderRadius: 'var(--mp-radius)',
          padding: '16px',
          display: 'flex', flexDirection: 'column', gap: 12,
        }}>
          <div style={{
            display: 'inline-flex', alignSelf: 'flex-start',
            alignItems: 'center', gap: 5,
            padding: '3px 9px',
            background: 'var(--mp-warn-soft)',
            color: 'var(--mp-warn)',
            border: '1px solid color-mix(in oklch, var(--mp-warn) 22%, transparent)',
            borderRadius: 999,
            fontSize: 11, fontWeight: 700,
            fontFamily: 'var(--mp-font-display)',
          }}>
            <Icon name="warning" fill style={{ fontSize: 12 }} />
            anomalia · acima do limiar
          </div>
          <div>
            <p className="tabular" style={{ margin: '0 0 4px', fontSize: 11, color: 'var(--mp-ink-3)', fontWeight: 600 }}>
              SON-XR55A80L
            </p>
            <p className="font-display" style={{
              margin: 0, fontSize: 18, fontWeight: 800, color: 'var(--mp-primary)',
              letterSpacing: '-0.015em', lineHeight: 1.25,
            }}>Sony OLED 55" XR-A80L</p>
          </div>
          <p className="tabular" style={{
            margin: 0, fontSize: 11, color: 'var(--mp-ink-3)',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <Icon name="schedule" style={{ fontSize: 13 }} />
            2026-05-06 · 22:42
          </p>
        </article>

        {/* Price comparison block */}
        <section style={{
          background: 'var(--mp-surface)',
          border: '1px solid var(--mp-line-soft)',
          borderRadius: 'var(--mp-radius)',
          padding: '14px 16px',
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 13, color: 'var(--mp-ink-2)' }}>Preço atual no Worten</span>
            <span className="tabular" style={{ fontSize: 15, fontWeight: 600, color: 'var(--mp-ink)' }}>1.149 €</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 13, color: 'var(--mp-ink-2)' }}>Proposto pelo motor</span>
            <span className="tabular" style={{ fontSize: 15, fontWeight: 700, color: 'var(--mp-loss)' }}>799 €</span>
          </div>
          <div style={{ height: 1, background: 'var(--mp-line-soft)' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--mp-ink)' }}>Variação</span>
            <span className="tabular font-display" style={{ fontSize: 18, fontWeight: 800, color: 'var(--mp-loss)', letterSpacing: '-0.01em' }}>−30,5%</span>
          </div>
        </section>

        {/* Callout */}
        <div style={{
          background: 'var(--mp-warn-soft)',
          borderLeft: '3px solid var(--mp-warn)',
          borderRadius: 'var(--mp-radius-sm)',
          padding: '12px 14px',
          display: 'flex', gap: 10,
        }}>
          <Icon name="info" fill style={{ fontSize: 18, color: 'var(--mp-warn)', flexShrink: 0, marginTop: 1 }} />
          <p style={{
            margin: 0, fontSize: 13, color: 'var(--mp-ink-2)',
            lineHeight: 1.5,
          }}>
            <strong style={{ fontWeight: 700, color: 'var(--mp-primary)' }}>Acima do limiar de −25%.</strong>{' '}
            O motor não ajustou automaticamente — aguarda a tua revisão.
          </p>
        </div>

        {/* Worked-profit panel */}
        <section style={{
          background: 'var(--mp-surface)',
          border: '1px solid var(--mp-line-soft)',
          borderRadius: 'var(--mp-radius)',
          padding: '14px',
        }}>
          <p className="font-display" style={{
            margin: '0 0 10px', fontSize: 11, fontWeight: 700,
            color: 'var(--mp-ink-3)',
            letterSpacing: '0.10em', textTransform: 'uppercase',
          }}>Margem em ambos os preços</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div style={{
              padding: '12px',
              background: 'var(--mp-loss-soft)',
              border: '1px solid color-mix(in oklch, var(--mp-loss) 18%, transparent)',
              borderRadius: 'var(--mp-radius-sm)',
            }}>
              <p style={{ margin: '0 0 4px', fontSize: 11, color: 'var(--mp-ink-3)', fontWeight: 600 }}>A 799 €</p>
              <p className="tabular font-display" style={{
                margin: '0 0 2px', fontSize: 18, fontWeight: 800,
                color: 'var(--mp-loss)', letterSpacing: '-0.01em',
              }}>3,2%</p>
              <p style={{ margin: 0, fontSize: 10, color: 'var(--mp-loss)', fontWeight: 600 }}>abaixo do floor</p>
            </div>
            <div style={{
              padding: '12px',
              background: 'var(--mp-win-soft)',
              border: '1px solid color-mix(in oklch, var(--mp-win) 18%, transparent)',
              borderRadius: 'var(--mp-radius-sm)',
            }}>
              <p style={{ margin: '0 0 4px', fontSize: 11, color: 'var(--mp-ink-3)', fontWeight: 600 }}>A 1.149 €</p>
              <p className="tabular font-display" style={{
                margin: '0 0 2px', fontSize: 18, fontWeight: 800,
                color: 'var(--mp-win)', letterSpacing: '-0.01em',
              }}>18,7%</p>
              <p style={{ margin: 0, fontSize: 10, color: 'var(--mp-win)', fontWeight: 600 }}>acima do floor</p>
            </div>
          </div>
        </section>

        {/* Actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          <button style={{
            height: 50, borderRadius: 'var(--mp-radius-sm)',
            background: 'linear-gradient(135deg, var(--mp-primary), var(--mp-primary-2))',
            border: 'none', color: '#fff',
            fontFamily: 'var(--mp-font-display)',
            fontWeight: 700, fontSize: 14,
            cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            boxShadow: '0 6px 14px color-mix(in oklch, var(--mp-primary) 22%, transparent)',
          }}>
            <Icon name="check" style={{ fontSize: 18 }} />
            Aceitar ajuste → 799 €
          </button>
          <button style={{
            height: 50, borderRadius: 'var(--mp-radius-sm)',
            background: 'var(--mp-surface)',
            border: '1px solid var(--mp-line)',
            color: 'var(--mp-ink)',
            fontFamily: 'var(--mp-font-display)',
            fontWeight: 600, fontSize: 14,
            cursor: 'pointer',
          }}>
            Rejeitar — manter 1.149 €
          </button>
          <button style={{
            height: 50, borderRadius: 'var(--mp-radius-sm)',
            background: 'transparent',
            border: 'none',
            color: 'var(--mp-loss)',
            fontFamily: 'var(--mp-font-display)',
            fontWeight: 600, fontSize: 13,
            cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <Icon name="pause_circle" style={{ fontSize: 18 }} />
            Pausar repricing enquanto analiso
          </button>
        </div>
      </div>

      <MobileBottomBar />
    </div>
  );
}

// Wrap each in a centred frame so it sits nicely inside the canvas artboard
function MobileFrame({ children }) {
  return (
    <div style={{
      minHeight: '100%',
      background: 'linear-gradient(180deg, #e9edf3 0%, #dde2eb 100%)',
      display: 'grid', placeItems: 'center',
      padding: '40px 20px',
    }}>
      {children}
    </div>
  );
}

function ScreenMobileAlertFramed() { return <MobileFrame><ScreenMobileAlert /></MobileFrame>; }
function ScreenMobileDetailFramed() { return <MobileFrame><ScreenMobileDetail /></MobileFrame>; }

Object.assign(window, { ScreenMobileAlertFramed, ScreenMobileDetailFramed });
