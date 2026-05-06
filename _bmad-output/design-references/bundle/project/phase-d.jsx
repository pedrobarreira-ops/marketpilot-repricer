// Phase D — Admin status + interception screens

// ============ ARTBOARD 13 — /admin/status (FOUNDER VIEW) ============
// Deliberately different visual register: mono-dominant, slate, terminal-ish.

const ADMIN_BG = '#0f172a';
const ADMIN_SURFACE = '#1e293b';
const ADMIN_LINE = '#334155';
const ADMIN_INK = '#e2e8f0';
const ADMIN_INK_2 = '#94a3b8';
const ADMIN_INK_3 = '#64748b';
const ADMIN_OK = '#4ade80';
const ADMIN_WARN = '#fbbf24';
const ADMIN_LOSS = '#f87171';
const ADMIN_BADGE = '#fb7185';

const MONO = "'JetBrains Mono', 'SF Mono', Menlo, monospace";

function AdminRule() {
  return <div style={{ height: 1, background: ADMIN_LINE, margin: '4px 0' }} />;
}

function AdminSectionHead({ label, right }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 14, marginBottom: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
        <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: ADMIN_INK_3, letterSpacing: '0.08em' }}>─</span>
        <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: ADMIN_INK, letterSpacing: '0.14em', textTransform: 'uppercase' }}>{label}</span>
        <span style={{ flex: 1, height: 1, background: ADMIN_LINE }} />
      </div>
      {right && <span style={{ fontFamily: MONO, fontSize: 11, color: ADMIN_INK_3 }}>{right}</span>}
    </div>
  );
}

function HealthRow({ label, value, status }) {
  const colour = status === 'ok' ? ADMIN_OK : status === 'warn' ? ADMIN_WARN : status === 'loss' ? ADMIN_LOSS : ADMIN_INK;
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '220px 1fr',
      padding: '6px 0', alignItems: 'baseline',
      fontFamily: MONO, fontSize: 13,
    }}>
      <span style={{ color: ADMIN_INK_3 }}>{label}</span>
      <span style={{ color: colour, fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function CustomerRow({ status, email, company, mode, detail, subRow }) {
  const colour = status === 'ok' ? ADMIN_OK : status === 'warn' ? ADMIN_WARN : ADMIN_INK_3;
  const glyph  = status === 'ok' ? '✓' : status === 'warn' ? '⚠' : '▢';
  return (
    <div style={{
      borderLeft: `3px solid ${colour}`,
      background: 'rgba(255,255,255,0.02)',
      padding: '12px 16px',
      cursor: 'pointer',
      transition: 'background 0.12s',
    }}
    onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
    onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
    >
      <div style={{
        display: 'grid', gridTemplateColumns: '20px 1fr',
        gap: 12, alignItems: 'baseline',
        fontFamily: MONO, fontSize: 13,
      }}>
        <span style={{ color: colour, fontWeight: 700 }}>{glyph}</span>
        <div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0 14px', alignItems: 'baseline' }}>
            <span style={{ color: ADMIN_INK }}>{email}</span>
            <span style={{ color: ADMIN_INK_3 }}>·</span>
            <span style={{ color: ADMIN_INK_2, fontWeight: 600 }}>{company}</span>
            <span style={{ color: ADMIN_INK_3 }}>·</span>
            <span style={{ color: status === 'ok' ? ADMIN_OK : status === 'warn' ? ADMIN_WARN : ADMIN_INK_2 }}>{mode}</span>
            <span style={{ color: ADMIN_INK_3 }}>·</span>
            <span style={{ color: ADMIN_INK_2 }}>{detail}</span>
          </div>
          {subRow && (
            <div style={{ marginTop: 6, color: ADMIN_INK_3, fontSize: 12 }}>
              <span style={{ marginRight: 8 }}>↳</span>{subRow}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CritEventRow({ t, customer, kind, detail, sev }) {
  const sevColour = sev === 'loss' ? ADMIN_LOSS : sev === 'warn' ? ADMIN_WARN : ADMIN_INK_2;
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '70px 110px 200px 1fr',
      gap: 14, padding: '6px 0',
      fontFamily: MONO, fontSize: 12,
      borderBottom: `1px solid ${ADMIN_LINE}`,
    }}>
      <span style={{ color: ADMIN_INK_3 }}>{t}</span>
      <span style={{ color: ADMIN_INK_2 }}>{customer}</span>
      <span style={{ color: sevColour, fontWeight: 500 }}>{kind}</span>
      <span style={{ color: ADMIN_INK_3 }}>{detail}</span>
    </div>
  );
}

function ScreenAdminStatus() {
  return (
    <div style={{
      minHeight: '100%',
      background: ADMIN_BG,
      color: ADMIN_INK,
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      {/* Header */}
      <header style={{
        borderBottom: `1px solid ${ADMIN_LINE}`,
        padding: '14px 32px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, fontFamily: MONO }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: ADMIN_INK }}>MarketPilot</span>
          <span style={{ fontSize: 13, color: ADMIN_INK_3 }}>·</span>
          <span style={{ fontSize: 13, color: ADMIN_INK_2 }}>Founder Status</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontFamily: MONO, fontSize: 12, color: ADMIN_INK_3 }}>pedro.b@marketpilot.pt</span>
          <span style={{
            fontFamily: MONO, fontSize: 10, fontWeight: 700,
            color: ADMIN_BADGE,
            border: `1px solid ${ADMIN_BADGE}`,
            background: 'rgba(251, 113, 133, 0.08)',
            padding: '3px 8px', borderRadius: 3,
            letterSpacing: '0.12em',
          }}>[ADMIN]</span>
        </div>
      </header>

      <main style={{ maxWidth: 960, margin: '0 auto', padding: '32px 32px 56px', display: 'flex', flexDirection: 'column', gap: 36 }}>

        {/* Section 1 · Sistema */}
        <section>
          <AdminSectionHead label="Sistema" right="last refresh: 22:43:12 UTC" />
          <HealthRow label="/health" value="✓ online · 99.4% (30d)" status="ok" />
          <HealthRow label="P11 latency p95" value="287ms (last 1h)" />
          <HealthRow label="PRI01 stuck" value="0" status="ok" />
          <HealthRow label="Mirakl API quota" value="2.847 / 10.000 (28%)" />
          <HealthRow label="Stripe webhooks" value="✓ all delivered (24h)" status="ok" />
          <HealthRow label="Last deploy" value="22h ago · v0.4.2 · pedro.b" />
        </section>

        {/* Section 2 · Customers */}
        <section>
          <AdminSectionHead label="Customers (3)" right="order: name ▾" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <CustomerRow
              status="ok"
              email="tony.cardosa@youget.pt"
              company="You Get"
              mode="Live"
              detail="Tier 1 cycle 18m ago · 0 atenção · 4.823/8.432 1.º"
            />
            <CustomerRow
              status="warn"
              email="ricardom@wdmi.pt"
              company="WDMI"
              mode="Live"
              detail="2 anomalias a rever · 1 ciclo congelado"
              subRow="Última acção: 03:14 — circuit breaker tripped"
            />
            <CustomerRow
              status="dry"
              email="ventura.rui@servelec.pt"
              company="Servelec"
              mode="Dry-run"
              detail="scan 31% · 4 dias desde signup"
            />
          </div>
        </section>

        {/* Section 3 · Recent critical events */}
        <section>
          <AdminSectionHead label="Recent critical events" right="last 24h · 12 total" />
          <div style={{
            display: 'grid', gridTemplateColumns: '70px 110px 200px 1fr',
            gap: 14, padding: '0 0 6px',
            fontFamily: MONO, fontSize: 10, fontWeight: 700,
            color: ADMIN_INK_3, letterSpacing: '0.12em', textTransform: 'uppercase',
            borderBottom: `1px solid ${ADMIN_LINE}`,
          }}>
            <span>time</span><span>customer</span><span>event</span><span>detail</span>
          </div>
          <CritEventRow t="22:42" customer="WDMI"    kind="circuit-breaker-trip"   detail="18% catalog · cycle 4892" sev="loss" />
          <CritEventRow t="18:11" customer="WDMI"    kind="anomaly-freeze"         detail="SKU 8421 · -47,8%"        sev="warn" />
          <CritEventRow t="09:33" customer="You Get" kind="pri01-fail-persist"     detail="SKU 4820 · 3 retries"     sev="warn" />
          <CritEventRow t="08:14" customer="WDMI"    kind="key-validation-fail"    detail="HTTP 401 · 1 retry ok"    sev="warn" />
          <CritEventRow t="03:14" customer="WDMI"    kind="circuit-breaker-trip"   detail="22% catalog · cycle 4787" sev="loss" />
          <CritEventRow t="00:02" customer="You Get" kind="anomaly-freeze"         detail="SKU 1129 · -52,1%"        sev="warn" />
        </section>
      </main>
    </div>
  );
}

// ============ ARTBOARD 14 — /key-revoked interception ============
function ScreenKeyRevoked() {
  return (
    <div style={{
      minHeight: '100%',
      background: 'var(--mp-bg)',
      display: 'grid', placeItems: 'center',
      padding: '40px 24px',
    }}>
      <div style={{
        width: '100%', maxWidth: 560,
        background: 'var(--mp-surface)',
        border: '1px solid var(--mp-line-soft)',
        borderRadius: 'var(--mp-radius-lg)',
        boxShadow: '0 20px 50px rgba(10, 18, 48, 0.06)',
        padding: '44px 44px 36px',
        textAlign: 'center',
      }}>
        {/* Icon badge */}
        <div style={{
          width: 80, height: 80, margin: '0 auto 24px',
          borderRadius: '50%',
          background: 'var(--mp-warn-soft)',
          border: '1px solid color-mix(in oklch, var(--mp-warn) 20%, transparent)',
          display: 'grid', placeItems: 'center',
        }}>
          <Icon name="key_off" fill style={{ fontSize: 40, color: 'var(--mp-warn)' }} />
        </div>

        <h1 className="font-display" style={{
          margin: '0 0 16px', fontSize: 28, fontWeight: 800,
          color: 'var(--mp-primary)', letterSpacing: '-0.02em', lineHeight: 1.2,
        }}>A tua chave Worten precisa de renovação</h1>

        <p style={{
          margin: '0 0 14px', fontSize: 14, color: 'var(--mp-ink-2)',
          lineHeight: 1.6, textAlign: 'left',
        }}>
          A chave que tinhas configurada deixou de ser válida — o Worten pode tê-la revogado, ou foi rotacionada manualmente. O motor está em pausa: nada está a ser repricado neste momento.
        </p>

        <p style={{
          margin: '0 0 28px', fontSize: 14, color: 'var(--mp-ink-2)',
          lineHeight: 1.6, textAlign: 'left',
        }}>
          Os teus dados, audit log e margens{' '}
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '2px 9px',
            background: 'var(--mp-win-soft)',
            color: 'var(--mp-win)',
            border: '1px solid color-mix(in oklch, var(--mp-win) 24%, transparent)',
            borderRadius: 999,
            fontSize: 12, fontWeight: 700,
            fontFamily: 'var(--mp-font-display)', letterSpacing: '-0.005em',
          }}>
            <Icon name="check_circle" fill style={{ fontSize: 14 }} />
            ficam todos intactos
          </span>
          . Cola a nova chave para retomar.
        </p>

        <button style={{
          width: '100%', padding: '14px 22px',
          background: 'linear-gradient(135deg, var(--mp-primary), var(--mp-primary-2))',
          color: '#fff', border: 'none',
          borderRadius: 'var(--mp-radius-sm)', cursor: 'pointer',
          fontSize: 14, fontWeight: 700,
          fontFamily: 'var(--mp-font-display)', letterSpacing: '-0.01em',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          boxShadow: '0 8px 18px color-mix(in oklch, var(--mp-primary) 22%, transparent)',
        }}>
          Configurar nova chave
          <Icon name="arrow_forward" style={{ fontSize: 18 }} />
        </button>

        <a href="#" style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          marginTop: 18, fontSize: 12, fontWeight: 500,
          color: 'var(--mp-ink-3)', textDecoration: 'none',
        }}>
          <Icon name="help" style={{ fontSize: 14 }} />
          Como gerar uma chave Worten?
        </a>
      </div>

      {/* Footer breadcrumb */}
      <p style={{
        position: 'absolute', bottom: 24, left: 0, right: 0,
        textAlign: 'center', margin: 0,
        fontSize: 11, color: 'var(--mp-ink-3)',
      }}>
        MarketPilot · marketpilot.pt/key-revoked
      </p>
    </div>
  );
}

// ============ ARTBOARD 15 — /payment-failed first-login interception ============
function ScreenPaymentFailed() {
  return (
    <div style={{
      minHeight: '100%',
      background: 'var(--mp-bg)',
      display: 'grid', placeItems: 'center',
      padding: '40px 24px',
    }}>
      <div style={{
        width: '100%', maxWidth: 560,
        background: 'var(--mp-surface)',
        border: '1px solid var(--mp-line-soft)',
        borderRadius: 'var(--mp-radius-lg)',
        boxShadow: '0 20px 50px rgba(10, 18, 48, 0.06)',
        padding: '44px 44px 36px',
        textAlign: 'center',
      }}>
        {/* Icon badge — loss-red for billing emergency */}
        <div style={{
          width: 80, height: 80, margin: '0 auto 24px',
          borderRadius: '50%',
          background: 'var(--mp-loss-soft)',
          border: '1px solid color-mix(in oklch, var(--mp-loss) 22%, transparent)',
          display: 'grid', placeItems: 'center',
        }}>
          <Icon name="credit_card_off" fill style={{ fontSize: 40, color: 'var(--mp-loss)' }} />
        </div>

        <h1 className="font-display" style={{
          margin: '0 0 16px', fontSize: 28, fontWeight: 800,
          color: 'var(--mp-primary)', letterSpacing: '-0.02em', lineHeight: 1.2,
        }}>Repricing pausado — pagamento falhou</h1>

        <p style={{
          margin: '0 0 14px', fontSize: 14, color: 'var(--mp-ink-2)',
          lineHeight: 1.6, textAlign: 'left',
        }}>
          O Stripe tentou cobrar em <span className="tabular" style={{ fontWeight: 600, color: 'var(--mp-ink)' }}>{'{DD/MM}'}</span> mas não conseguiu processar o pagamento. O repricing foi pausado automaticamente para proteger a tua conta no Worten.
        </p>

        <p style={{
          margin: '0 0 28px', fontSize: 14, color: 'var(--mp-ink-2)',
          lineHeight: 1.6, textAlign: 'left',
        }}>
          Os teus dados, margens e audit log{' '}
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            padding: '2px 9px',
            background: 'var(--mp-win-soft)',
            color: 'var(--mp-win)',
            border: '1px solid color-mix(in oklch, var(--mp-win) 24%, transparent)',
            borderRadius: 999,
            fontSize: 12, fontWeight: 700,
            fontFamily: 'var(--mp-font-display)', letterSpacing: '-0.005em',
          }}>
            <Icon name="check_circle" fill style={{ fontSize: 14 }} />
            ficam intactos
          </span>
          . Actualiza o método de pagamento para retomar.
        </p>

        <button style={{
          width: '100%', padding: '14px 22px',
          background: 'var(--mp-loss)',
          color: '#fff', border: 'none',
          borderRadius: 'var(--mp-radius-sm)', cursor: 'pointer',
          fontSize: 14, fontWeight: 700,
          fontFamily: 'var(--mp-font-display)', letterSpacing: '-0.01em',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          boxShadow: '0 8px 18px color-mix(in oklch, var(--mp-loss) 22%, transparent)',
        }}>
          Atualizar pagamento
          <Icon name="arrow_forward" style={{ fontSize: 18 }} />
        </button>

        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 18, marginTop: 18, flexWrap: 'wrap',
        }}>
          <a href="#" style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 12, fontWeight: 600,
            color: 'var(--mp-primary)', textDecoration: 'none',
          }}>
            Ver audit log
            <Icon name="arrow_forward" style={{ fontSize: 14 }} />
          </a>
          <span style={{ width: 1, height: 12, background: 'var(--mp-line)' }} />
          <a href="mailto:hello@marketpilot.pt" style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 12, fontWeight: 500,
            color: 'var(--mp-ink-3)', textDecoration: 'none',
          }}>
            <Icon name="mail" style={{ fontSize: 14 }} />
            Fala connosco
          </a>
        </div>
      </div>

      <p style={{
        position: 'absolute', bottom: 24, left: 0, right: 0,
        textAlign: 'center', margin: 0,
        fontSize: 11, color: 'var(--mp-ink-3)',
      }}>
        MarketPilot · marketpilot.pt/payment-failed
      </p>
    </div>
  );
}

Object.assign(window, { ScreenAdminStatus, ScreenKeyRevoked, ScreenPaymentFailed });
