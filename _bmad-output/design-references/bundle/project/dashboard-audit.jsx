// Audit log + paused-state and loading-state composers

const AUDIT_EVENTS = [
  { t: '14:22:14', type: 'price_adjusted', sku: 'SAM-QE55Q70CATXXC', name: 'Samsung QE55Q70C QLED 55"',
    from: 749.00, to: 738.50, delta: -10.50, deltaPct: -1.40, reason: 'Concorrente baixou para 740,00 €',
    competitor: 'TechHouse PT' },
  { t: '14:18:47', type: 'price_adjusted', sku: 'BOS-QC45-BLK', name: 'Bose QuietComfort 45 Black',
    from: 269.00, to: 265.99, delta: -3.01, deltaPct: -1.12, reason: 'Recupera 1.º lugar',
    competitor: 'AudioPlanet' },
  { t: '14:15:02', type: 'hold_within_tolerance', sku: 'APL-IPH15P-256', name: 'iPhone 15 Pro 256GB Natural',
    from: 1399.00, reason: 'Diferença -0,80 € · dentro da tolerância',
    competitor: 'TopMobile ES' },
  { t: '14:11:38', type: 'absorbed_erp', sku: 'LG-OLED55C3', name: 'LG OLED55C3 OLED 55"',
    from: 1149.00, to: 1129.00, reason: 'Update do ERP detectado · MarketPilot pausou ajuste' },
  { t: '14:08:21', type: 'price_adjusted', sku: 'DYS-V15-DETECT', name: 'Dyson V15 Detect Absolute',
    from: 749.00, to: 729.00, delta: -20.00, deltaPct: -2.67, reason: 'Concorrente novo entrou no top',
    competitor: 'HogarShop ES' },
  { t: '14:04:55', type: 'hold_floor', sku: 'SON-WH1000XM5', name: 'Sony WH-1000XM5 Black',
    from: 349.00, reason: 'Concorrente abaixo do teu mínimo permitido (-1,5%)',
    competitor: 'AuriCenter' },
  { t: '14:01:09', type: 'price_adjusted', sku: 'NIN-OLED-WHT', name: 'Nintendo Switch OLED White',
    from: 339.00, to: 335.00, delta: -4.00, deltaPct: -1.18, reason: 'Concorrente baixou para 336,50 €',
    competitor: 'GameStation PT' },
];

const EVENT_META = {
  price_adjusted:        { icon: 'sync_alt',     color: 'var(--mp-info)',  label: 'Ajuste' },
  hold_within_tolerance: { icon: 'pause_circle', color: 'var(--mp-ink-3)', label: 'Hold · tolerância' },
  hold_floor:            { icon: 'block',        color: 'var(--mp-warn)',  label: 'Hold · floor' },
  absorbed_erp:          { icon: 'merge',        color: 'var(--mp-ink-3)', label: 'Absorvido por ERP' },
  manual_pause:          { icon: 'front_hand',   color: 'var(--mp-ink-2)', label: 'Pausa manual' },
};

function AuditFilters({ filter, setFilter }) {
  const tabs = [
    { id: 'all', label: 'Todos', count: 384 },
    { id: 'adjusted', label: 'Ajustes', count: 251 },
    { id: 'hold', label: 'Holds', count: 87 },
    { id: 'absorbed', label: 'Absorvidos', count: 34 },
    { id: 'manual', label: 'Manuais', count: 12 },
  ];
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '12px 16px',
      background: 'var(--mp-surface)',
      border: '1px solid var(--mp-line-soft)',
      borderRadius: 'var(--mp-radius-lg)',
      flexWrap: 'wrap',
    }}>
      <div style={{ display: 'flex', gap: 4, flex: 1, flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setFilter(t.id)} style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '7px 14px', border: 'none', cursor: 'pointer',
            background: filter === t.id ? 'var(--mp-primary)' : 'transparent',
            color: filter === t.id ? '#fff' : 'var(--mp-ink-2)',
            fontWeight: 600, fontSize: 12,
            borderRadius: 'var(--mp-radius-sm)',
            fontFamily: 'var(--mp-font-display)', letterSpacing: '-0.01em',
            transition: 'background 0.15s',
          }}>
            {t.label}
            <span className="tabular" style={{
              fontSize: 10, fontWeight: 700,
              padding: '2px 6px', borderRadius: 4,
              background: filter === t.id ? 'rgba(255,255,255,0.2)' : 'var(--mp-bg)',
              color: filter === t.id ? '#fff' : 'var(--mp-ink-3)',
            }}>{fmtNum(t.count)}</span>
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '7px 12px', background: 'var(--mp-bg)',
          border: '1px solid var(--mp-line)',
          borderRadius: 'var(--mp-radius-sm)',
          fontSize: 12, color: 'var(--mp-ink-2)', fontWeight: 600,
        }}>
          <Icon name="calendar_today" style={{ fontSize: 14 }} />
          Hoje
          <Icon name="expand_more" style={{ fontSize: 14, color: 'var(--mp-ink-3)' }} />
        </div>
        <button style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '7px 12px', background: 'var(--mp-bg)',
          border: '1px solid var(--mp-line)',
          borderRadius: 'var(--mp-radius-sm)', cursor: 'pointer',
          fontSize: 12, color: 'var(--mp-ink-2)', fontWeight: 600,
        }}>
          <Icon name="download" style={{ fontSize: 14 }} />
          Exportar CSV
        </button>
      </div>
    </div>
  );
}

function AuditRow({ ev }) {
  const [open, setOpen] = useState(false);
  const meta = EVENT_META[ev.type];
  const isAdjust = ev.type === 'price_adjusted';
  return (
    <div style={{ borderBottom: '1px solid var(--mp-line-soft)' }}>
      <button onClick={() => setOpen(!open)} style={{
        width: '100%', padding: '14px 20px',
        display: 'grid', gridTemplateColumns: '80px 32px 1fr auto auto 24px',
        gap: 16, alignItems: 'center',
        background: open ? 'var(--mp-bg)' : 'transparent',
        border: 'none', cursor: 'pointer', textAlign: 'left',
        transition: 'background 0.15s',
      }}>
        <span className="tabular" style={{ fontSize: 12, color: 'var(--mp-ink-3)', fontWeight: 600 }}>{ev.t}</span>
        <Icon name={meta.icon} style={{ fontSize: 18, color: meta.color }} />
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--mp-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {ev.name}
          </p>
          <p className="tabular" style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--mp-ink-3)' }}>
            {ev.sku} · {ev.reason}
          </p>
        </div>
        <span style={{
          padding: '3px 9px', fontSize: 10, fontWeight: 700,
          letterSpacing: '0.06em', textTransform: 'uppercase',
          borderRadius: 4,
          background: `color-mix(in oklch, ${meta.color} 14%, transparent)`,
          color: meta.color,
          fontFamily: 'var(--mp-font-display)',
        }}>{meta.label}</span>
        <div className="tabular" style={{ textAlign: 'right', minWidth: 130 }}>
          {isAdjust ? (
            <>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--mp-ink-2)' }}>
                {fmtEur(ev.from)} → <span style={{ color: 'var(--mp-loss)' }}>{fmtEur(ev.to)}</span>
              </p>
              <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--mp-loss)', fontWeight: 600 }}>
                {ev.delta.toFixed(2).replace('.', ',')} € ({ev.deltaPct.toFixed(2).replace('.', ',')}%)
              </p>
            </>
          ) : (
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--mp-ink-2)' }}>
              {fmtEur(ev.from)}
            </p>
          )}
        </div>
        <Icon name={open ? 'expand_less' : 'expand_more'} style={{ fontSize: 18, color: 'var(--mp-ink-3)' }} />
      </button>
      {open && (
        <div style={{
          padding: '4px 20px 20px 76px',
          background: 'var(--mp-bg)',
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 24,
          animation: 'fadeUp 0.25s ease-out',
        }}>
          <div>
            <p style={{ margin: '0 0 6px', fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--mp-ink-3)' }}>Sinal observado</p>
            <p className="tabular" style={{ margin: 0, fontSize: 12, color: 'var(--mp-ink-2)', lineHeight: 1.55 }}>
              {ev.competitor || '—'}<br/>
              <span style={{ color: 'var(--mp-ink-3)' }}>Detectado às {ev.t}</span>
            </p>
          </div>
          <div>
            <p style={{ margin: '0 0 6px', fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--mp-ink-3)' }}>Decisão</p>
            <p className="tabular" style={{ margin: 0, fontSize: 12, color: 'var(--mp-ink-2)', lineHeight: 1.55 }}>
              {isAdjust ? `Ajuste para ${fmtEur(ev.to)}` : ev.reason}<br/>
              <span style={{ color: 'var(--mp-ink-3)' }}>Margem aplicada: -1,5% / +5,0%</span>
            </p>
          </div>
          <div>
            <p style={{ margin: '0 0 6px', fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--mp-ink-3)' }}>Confirmação Mirakl</p>
            <p className="tabular" style={{ margin: 0, fontSize: 12, color: 'var(--mp-ink-2)', lineHeight: 1.55 }}>
              {isAdjust ? 'OK · ack #87231' : '—'}<br/>
              <span style={{ color: 'var(--mp-ink-3)' }}>Latência: 1,2 s</span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function AuditTable({ filter }) {
  const filtered = AUDIT_EVENTS.filter(e => {
    if (filter === 'all') return true;
    if (filter === 'adjusted') return e.type === 'price_adjusted';
    if (filter === 'hold') return e.type.startsWith('hold');
    if (filter === 'absorbed') return e.type === 'absorbed_erp';
    return false;
  });
  return (
    <div style={{
      background: 'var(--mp-surface)',
      border: '1px solid var(--mp-line-soft)',
      borderRadius: 'var(--mp-radius-lg)',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '12px 20px', display: 'grid',
        gridTemplateColumns: '80px 32px 1fr auto auto 24px',
        gap: 16, alignItems: 'center',
        background: 'var(--mp-bg)',
        borderBottom: '1px solid var(--mp-line)',
      }}>
        {['Hora','','Produto · razão','Tipo','Variação',''].map((h,i) => (
          <span key={i} style={{
            fontSize: 10, fontWeight: 700,
            letterSpacing: '0.12em', textTransform: 'uppercase',
            color: 'var(--mp-ink-3)', textAlign: i === 4 ? 'right' : 'left',
          }}>{h}</span>
        ))}
      </div>
      {filtered.map((ev, i) => <AuditRow key={i} ev={ev} />)}
      <div style={{
        padding: '14px 20px', display: 'flex', justifyContent: 'space-between',
        alignItems: 'center', background: 'var(--mp-bg)',
        borderTop: '1px solid var(--mp-line-soft)',
      }}>
        <span className="tabular" style={{ fontSize: 12, color: 'var(--mp-ink-3)', fontWeight: 600 }}>
          A mostrar 1–{filtered.length} de {fmtNum(384)} eventos
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button style={{
            padding: '6px 10px', background: 'var(--mp-surface)',
            border: '1px solid var(--mp-line)', borderRadius: 6,
            fontSize: 12, color: 'var(--mp-ink-3)', cursor: 'pointer', fontWeight: 600,
          }}>← Anterior</button>
          <button style={{
            padding: '6px 10px', background: 'var(--mp-surface)',
            border: '1px solid var(--mp-line)', borderRadius: 6,
            fontSize: 12, color: 'var(--mp-ink-2)', cursor: 'pointer', fontWeight: 600,
          }}>Seguinte →</button>
        </div>
      </div>
    </div>
  );
}

// Search + Trust strip on audit log root
function AuditTrustStrip() {
  return (
    <div style={{
      background: 'var(--mp-primary)',
      borderRadius: 'var(--mp-radius-lg)',
      padding: '20px 24px', color: '#fff',
      display: 'flex', justifyContent: 'space-between',
      alignItems: 'center', gap: 24, flexWrap: 'wrap',
    }}>
      <div>
        <h2 className="font-display" style={{
          margin: '0 0 6px', fontSize: 22, fontWeight: 800,
          letterSpacing: '-0.02em',
        }}>Audit log</h2>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--mp-primary-tint)', maxWidth: 540, lineHeight: 1.55 }}>
          Cada decisão de preço aqui registada com sinal, regra e confirmação Mirakl. Tu tens o controlo total — nada acontece sem rasto.
        </p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'rgba(255,255,255,0.12)',
          border: '1px solid rgba(255,255,255,0.18)',
          borderRadius: 'var(--mp-radius-sm)',
          padding: '8px 14px', minWidth: 280,
        }}>
          <Icon name="search" style={{ fontSize: 18, color: 'rgba(255,255,255,0.7)' }} />
          <input placeholder="Procurar SKU, EAN ou produto…" style={{
            flex: 1, background: 'transparent', border: 'none',
            color: '#fff', fontSize: 13, fontWeight: 500,
            outline: 'none', minWidth: 0,
          }} />
        </div>
      </div>
    </div>
  );
}

// Paused-state composers
function PausedByCustomerStrip({ data }) {
  return (
    <div className="tabular" style={{
      display: 'flex', flexWrap: 'wrap', gap: 24,
      padding: '14px 20px',
      background: 'var(--mp-surface)',
      border: '1px solid var(--mp-line-soft)',
      borderRadius: 'var(--mp-radius)',
      fontSize: 12, color: 'var(--mp-ink-2)',
    }}>
      <span>
        <span style={{ color: 'var(--mp-ink-3)', fontWeight: 600 }}>Pausado por</span>{' '}
        <strong style={{ color: 'var(--mp-primary)', fontWeight: 700 }}>Tomás C.</strong>
      </span>
      <span style={{ color: 'var(--mp-line)' }}>·</span>
      <span>
        <span style={{ color: 'var(--mp-ink-3)', fontWeight: 600 }}>às</span>{' '}
        <strong style={{ color: 'var(--mp-primary)', fontWeight: 700 }}>12:08</strong>
      </span>
      <span style={{ color: 'var(--mp-line)' }}>·</span>
      <span>
        <strong style={{ color: 'var(--mp-primary)', fontWeight: 700 }}>{fmtNum(data.winning + data.losing)}</strong>{' '}
        <span style={{ color: 'var(--mp-ink-3)' }}>SKUs em estado fixo</span>
      </span>
    </div>
  );
}

Object.assign(window, { AUDIT_EVENTS, EVENT_META, AuditFilters, AuditRow, AuditTable, AuditTrustStrip, PausedByCustomerStrip });
