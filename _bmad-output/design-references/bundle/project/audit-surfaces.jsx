// Audit log — 5-surface IA per §4.1
// Surface 1: Daily summary card
// Surface 2: Atenção feed (action-required)
// Surface 3: Notável feed (browsable, capped 30)
// Surface 4: SKU/EAN search (sticky, prominent)
// Surface 5: Firehose (cycle-aggregated, behind link)

// ------------ Sample fixtures ------------

const ATENCAO_ITEMS = [
  {
    kind: 'anomaly_freeze',
    sku: 'SON-XR55A80L',
    ean: '4548736143005',
    name: 'Sony Bravia XR-55A80L OLED 55"',
    priceBefore: 799.00,
    priceAfter: 398.00,
    deltaPct: -50.2,
    detectedAt: '03:14',
    note: 'Variação superior a 30% · congelada para revisão',
  },
  {
    kind: 'pri01_fail_persistent',
    sku: 'BOS-QC45-BLK',
    ean: '017817832687',
    name: 'Bose QuietComfort 45 Black',
    attempts: 4,
    lastError: '422 offer_inactive_or_unknown',
    detectedAt: '14:18',
  },
];

const NOTAVEL_ITEMS = [
  { t: '14:22', kind: 'pos_won',     name: 'Samsung QE55Q70C QLED 55"',         channel: 'pt', expanded: false },
  { t: '14:18', kind: 'absorbed',    name: 'LG OLED55C3',                        channel: 'pt', expanded: false },
  { t: '14:11', kind: 'pos_won',     name: 'Bose QuietComfort 45',               channel: 'es', expanded: false },
  { t: '14:04', kind: 'pos_lost',    name: 'Sony WH-1000XM5',                    channel: 'pt', expanded: false },
  { t: '13:51', kind: 'big_move',    name: 'Dyson V15 Detect Absolute',          channel: 'pt', expanded: true,
    detail: { from: 749.00, to: 729.00, deltaPct: -2.67, floor: 711.00, ceiling: 830.00,
              cycle: 'Tier 1 cycle 13:51', pri01: '#4821', pri02: 'COMPLETE 13:53',
              competitor: 'HogarShop ES · €732,40 (13:49)' } },
  { t: '13:42', kind: 'new_comp',    name: 'Apple AirPods Pro 2',                channel: 'pt', expanded: false },
  { t: '13:30', kind: 'manual_pause',name: 'Pausa pelo cliente · global',        channel: 'pt', expanded: false },
];

const NOTAVEL_KIND_META = {
  pos_won:      { icon: 'arrow_outward', color: 'var(--mp-win)',  label: 'Posição ganha' },
  pos_lost:     { icon: 'south_east',    color: 'var(--mp-loss)', label: 'Posição perdida' },
  absorbed:     { icon: 'merge',         color: 'var(--mp-ink-3)',label: 'Absorção ERP' },
  big_move:     { icon: 'swap_vert',     color: 'var(--mp-info)', label: 'Movimento grande dentro de tolerância' },
  new_comp:     { icon: 'group_add',     color: 'var(--mp-warn)', label: 'Novo concorrente' },
  manual_pause: { icon: 'pause_circle',  color: 'var(--mp-ink-3)',label: 'Pausa pelo cliente' },
};

const FIREHOSE_CYCLES = [
  { t: '03:14', tiers: 'Tier 1 + Tier 2a', actions: 47, expanded: true,
    summary: { undercuts: 43, undercutsAvg: -2.14, raises: 4, raisesAvg: 1.87,
               holds: 12, holdsBelowFloor: 3, holdsAlready1st: 9 },
    skuRows: [
      { t: '03:14:08', sku: 'SAM-QE55Q70CATXXC', name: 'Samsung QE55Q70C QLED 55"',
        from: 749.00, to: 738.50, deltaPct: -1.40, signal: 'TechHouse PT · €740,00',
        decision: 'Undercut · regra UC-01', mirakl: 'OK · ack #87231 · 1,2 s', expanded: true },
      { t: '03:14:11', sku: 'BOS-QC45-BLK', name: 'Bose QuietComfort 45 Black',
        from: 269.00, to: 265.99, deltaPct: -1.12, signal: 'AudioPlanet · €266,99',
        decision: 'Recupera 1.º lugar', mirakl: 'OK · ack #87232 · 0,9 s', expanded: false },
      { t: '03:14:15', sku: 'DYS-V15-DETECT', name: 'Dyson V15 Detect Absolute',
        from: 749.00, to: 729.00, deltaPct: -2.67, signal: 'HogarShop ES · €732,40',
        decision: 'Concorrente novo entrou no top', mirakl: 'OK · ack #87233 · 1,1 s', expanded: false },
      { t: '03:14:18', sku: 'NIN-OLED-WHT', name: 'Nintendo Switch OLED White',
        from: 339.00, to: 335.00, deltaPct: -1.18, signal: 'GameStation PT · €336,50',
        decision: 'Undercut · regra UC-01', mirakl: 'OK · ack #87234 · 0,8 s', expanded: false },
    ] },
  { t: '03:00', tiers: 'Tier 1', actions: 32, expanded: false },
  { t: '02:45', tiers: 'Tier 1', actions: 28, expanded: false },
  { t: '02:30', tiers: 'Tier 1', actions: 31, expanded: false },
  { t: '02:15', tiers: 'Tier 1', actions: 24, expanded: false },
  { t: '02:00', tiers: 'Tier 1 + Tier 2b', actions: 51, expanded: false },
];

// ------------ Surface 4: Search bar (sticky, prominent) ------------
function AuditSearch() {
  return (
    <div style={{
      background: 'var(--mp-surface)',
      border: '1px solid var(--mp-line)',
      borderRadius: 'var(--mp-radius-lg)',
      padding: '6px 6px 6px 18px',
      display: 'flex', alignItems: 'center', gap: 12,
      boxShadow: '0 2px 6px rgba(15,22,40,0.04)',
    }}>
      <Icon name="search" style={{ fontSize: 22, color: 'var(--mp-ink-3)' }} />
      <input
        placeholder="Procurar por SKU, EAN ou nome do produto…"
        style={{
          flex: 1, background: 'transparent', border: 'none',
          fontSize: 15, fontWeight: 500, color: 'var(--mp-primary)',
          padding: '12px 0', outline: 'none', minWidth: 0,
          fontFamily: 'var(--mp-font-body)',
        }}
      />
      <span className="tabular" style={{
        padding: '4px 8px', background: 'var(--mp-bg)',
        border: '1px solid var(--mp-line)', borderRadius: 4,
        fontSize: 10, color: 'var(--mp-ink-3)', fontWeight: 600,
      }}>⌘K</span>
      <button style={{
        padding: '10px 18px',
        background: 'var(--mp-primary)', color: '#fff',
        border: 'none', borderRadius: 'var(--mp-radius-sm)',
        cursor: 'pointer', fontSize: 13, fontWeight: 700,
        fontFamily: 'var(--mp-font-display)', letterSpacing: '-0.01em',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        Investigar
      </button>
    </div>
  );
}

// ------------ Surface 1: Daily summary card ------------
function DailySummary({ data, onShowFirehose }) {
  const counts = [
    { v: data.todayAdjustments, l: 'ajustes',       k: 'adjusted' },
    { v: data.todayHolds,        l: 'holds',         k: 'hold' },
    { v: data.todayAbsorbed,     l: 'absorções ERP', k: 'absorbed' },
    { v: 1,                      l: 'anomalia a rever', k: 'anomaly', alert: true },
  ];
  return (
    <section style={{
      background: 'var(--mp-surface)',
      border: '1px solid var(--mp-line-soft)',
      borderRadius: 'var(--mp-radius-lg)',
      overflow: 'hidden',
    }}>
      <div style={{ padding: '20px 24px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, marginBottom: 14 }}>
          <p style={{
            margin: 0, fontSize: 11, fontWeight: 700,
            letterSpacing: '0.14em', textTransform: 'uppercase',
            color: 'var(--mp-ink-3)',
          }}>Hoje · até 14:22</p>
          <span className="tabular" style={{ fontSize: 11, color: 'var(--mp-ink-3)' }}>
            actualiza a cada 5 min
          </span>
        </div>
        <div style={{
          display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap',
          marginBottom: 14,
        }}>
          {counts.map((c, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span style={{ color: 'var(--mp-line)', fontSize: 18, padding: '0 6px' }}>·</span>}
              <button style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                padding: 0, display: 'inline-flex', alignItems: 'baseline', gap: 6,
                color: c.alert ? 'var(--mp-warn)' : 'var(--mp-primary)',
              }}>
                <span className="tabular font-display" style={{
                  fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em',
                }}>{fmtNum(c.v)}</span>
                <span style={{ fontSize: 14, fontWeight: 500, color: c.alert ? 'var(--mp-warn)' : 'var(--mp-ink-2)' }}>
                  {c.l}
                </span>
                {c.alert && <Icon name="arrow_forward" style={{ fontSize: 16, color: 'var(--mp-warn)' }} />}
              </button>
            </React.Fragment>
          ))}
        </div>
        <p className="tabular" style={{ margin: 0, fontSize: 13, color: 'var(--mp-ink-2)' }}>
          <span style={{ color: 'var(--mp-ink-3)' }}>Posição:</span>{' '}
          <strong style={{ color: 'var(--mp-primary)', fontWeight: 700 }}>{fmtNum(data.winning)} SKUs em 1.º</strong>{' '}
          <span style={{ color: 'var(--mp-win)', fontWeight: 700 }}>+{data.posDelta} vs ontem</span>
        </p>
      </div>
      <button onClick={onShowFirehose} style={{
        width: '100%', padding: '12px 24px',
        background: 'var(--mp-bg)',
        border: 'none', borderTop: '1px solid var(--mp-line-soft)',
        cursor: 'pointer', textAlign: 'left',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        fontSize: 12, fontWeight: 600, color: 'var(--mp-ink-2)',
      }}>
        <span>Mostrar todos os ajustes (agregado por ciclo)</span>
        <Icon name="arrow_forward" style={{ fontSize: 16, color: 'var(--mp-ink-3)' }} />
      </button>
    </section>
  );
}

// ------------ Surface 2: Atenção feed ------------
function AtencaoItem({ item }) {
  const isAnomaly = item.kind === 'anomaly_freeze';
  const tone = isAnomaly
    ? { bg: 'var(--mp-warn-soft)', fg: 'var(--mp-warn)', border: 'color-mix(in oklch, var(--mp-warn) 30%, transparent)', icon: 'ac_unit', label: 'Anomalia · congelada' }
    : { bg: 'var(--mp-loss-soft)', fg: 'var(--mp-loss)', border: 'color-mix(in oklch, var(--mp-loss) 28%, transparent)', icon: 'sync_problem', label: 'PRI01 falhou repetidamente' };

  return (
    <div style={{
      background: 'var(--mp-surface)',
      border: `1px solid ${tone.border}`,
      borderLeft: `4px solid ${tone.fg}`,
      borderRadius: 'var(--mp-radius)',
      padding: '18px 20px',
      display: 'grid', gridTemplateColumns: '32px 1fr auto', gap: 16,
      alignItems: 'start',
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 8,
        background: tone.bg, color: tone.fg,
        display: 'grid', placeItems: 'center', flexShrink: 0,
      }}>
        <Icon name={tone.icon} fill style={{ fontSize: 18 }} />
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
          <span style={{
            padding: '3px 9px', fontSize: 10, fontWeight: 700,
            letterSpacing: '0.08em', textTransform: 'uppercase',
            borderRadius: 4, background: tone.bg, color: tone.fg,
            fontFamily: 'var(--mp-font-display)',
          }}>{tone.label}</span>
          <span className="tabular" style={{ fontSize: 11, color: 'var(--mp-ink-3)' }}>
            detectada às {item.detectedAt}
          </span>
        </div>

        <p style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700, color: 'var(--mp-primary)', letterSpacing: '-0.01em' }}>
          {item.name}
        </p>
        <p className="tabular" style={{ margin: '0 0 12px', fontSize: 11, color: 'var(--mp-ink-3)' }}>
          SKU: {item.sku} · EAN: {item.ean}
        </p>

        {isAnomaly ? (
          <div style={{
            display: 'inline-flex', alignItems: 'baseline', gap: 12,
            padding: '10px 14px', background: 'var(--mp-bg)',
            borderRadius: 'var(--mp-radius-sm)',
            border: '1px solid var(--mp-line-soft)',
          }}>
            <div>
              <p style={{ margin: 0, fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--mp-ink-3)' }}>Antes</p>
              <p className="tabular" style={{ margin: '2px 0 0', fontSize: 16, fontWeight: 700, color: 'var(--mp-ink-2)' }}>{fmtEur(item.priceBefore)}</p>
            </div>
            <Icon name="arrow_forward" style={{ fontSize: 16, color: 'var(--mp-ink-3)', alignSelf: 'center' }} />
            <div>
              <p style={{ margin: 0, fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--mp-ink-3)' }}>Sinal recebido</p>
              <p className="tabular" style={{ margin: '2px 0 0', fontSize: 16, fontWeight: 700, color: 'var(--mp-warn)' }}>
                {fmtEur(item.priceAfter)} <span style={{ fontSize: 12 }}>({item.deltaPct.toFixed(1).replace('.', ',')}%)</span>
              </p>
            </div>
          </div>
        ) : (
          <div style={{
            padding: '10px 14px', background: 'var(--mp-bg)',
            borderRadius: 'var(--mp-radius-sm)',
            border: '1px solid var(--mp-line-soft)',
          }}>
            <p className="tabular" style={{ margin: 0, fontSize: 12, color: 'var(--mp-ink-2)', lineHeight: 1.55 }}>
              PRI01 falhou nas últimas <strong style={{ color: 'var(--mp-loss)' }}>{item.attempts}</strong> tentativas
              <br/>
              <span style={{ color: 'var(--mp-ink-3)' }}>último erro:</span>{' '}
              <code style={{ color: 'var(--mp-loss)', fontWeight: 600 }}>{item.lastError}</code>
            </p>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
        {isAnomaly ? (
          <>
            <button style={{
              padding: '9px 14px',
              background: 'var(--mp-primary)', color: '#fff',
              border: 'none', borderRadius: 'var(--mp-radius-sm)',
              cursor: 'pointer', fontSize: 12, fontWeight: 700,
              fontFamily: 'var(--mp-font-display)', letterSpacing: '-0.01em',
              whiteSpace: 'nowrap',
            }}>Confirmar novo list_price</button>
            <button style={{
              padding: '9px 14px', background: 'var(--mp-surface)',
              color: 'var(--mp-ink-2)', border: '1px solid var(--mp-line)',
              borderRadius: 'var(--mp-radius-sm)',
              cursor: 'pointer', fontSize: 12, fontWeight: 600,
            }}>Rejeitar</button>
          </>
        ) : (
          <button style={{
            padding: '9px 14px',
            background: 'var(--mp-loss)', color: '#fff',
            border: 'none', borderRadius: 'var(--mp-radius-sm)',
            cursor: 'pointer', fontSize: 12, fontWeight: 700,
            fontFamily: 'var(--mp-font-display)', letterSpacing: '-0.01em',
            display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap',
          }}>
            Investigar
            <Icon name="arrow_forward" style={{ fontSize: 14 }} />
          </button>
        )}
      </div>
    </div>
  );
}

function AtencaoFeed({ items }) {
  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 className="font-display" style={{
          margin: 0, fontSize: 13, fontWeight: 700,
          color: 'var(--mp-primary)', letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}>
          Atenção
          {items.length > 0 && (
            <span className="tabular" style={{
              marginLeft: 10, padding: '2px 8px', fontSize: 11,
              background: 'var(--mp-warn)', color: '#fff',
              borderRadius: 999, fontWeight: 700,
            }}>{items.length}</span>
          )}
        </h3>
        <p style={{ margin: 0, fontSize: 11, color: 'var(--mp-ink-3)', fontWeight: 500 }}>
          Eventos onde tens de decidir
        </p>
      </div>
      {items.length === 0 ? (
        <AtencaoEmpty />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map((item, i) => <AtencaoItem key={i} item={item} />)}
        </div>
      )}
    </section>
  );
}

// ------------ Surface 3: Notável feed ------------
function NotavelRow({ item, channelFilter }) {
  if (channelFilter !== 'both' && item.channel !== channelFilter) return null;
  const meta = NOTAVEL_KIND_META[item.kind];
  const [open, setOpen] = useState(item.expanded);

  return (
    <div style={{ borderBottom: '1px solid var(--mp-line-soft)' }}>
      <button onClick={() => setOpen(!open)} style={{
        width: '100%', padding: '12px 18px',
        display: 'grid', gridTemplateColumns: '60px 24px 1fr auto auto 20px',
        gap: 14, alignItems: 'center',
        background: open ? 'var(--mp-bg)' : 'transparent',
        border: 'none', cursor: 'pointer', textAlign: 'left',
        transition: 'background 0.15s',
      }}>
        <span className="tabular" style={{ fontSize: 12, color: 'var(--mp-ink-3)', fontWeight: 600 }}>{item.t}</span>
        <Icon name={meta.icon} style={{ fontSize: 16, color: meta.color }} />
        <span style={{ fontSize: 13, color: 'var(--mp-primary)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {item.name}
        </span>
        <span style={{
          padding: '2px 8px', fontSize: 10, fontWeight: 700,
          letterSpacing: '0.06em',
          borderRadius: 4,
          background: `color-mix(in oklch, ${meta.color} 12%, transparent)`,
          color: meta.color,
          fontFamily: 'var(--mp-font-display)',
          whiteSpace: 'nowrap',
        }}>{meta.label}</span>
        <span className="tabular" style={{
          fontSize: 10, fontWeight: 700, color: 'var(--mp-ink-3)',
          padding: '2px 7px', background: 'var(--mp-bg)',
          borderRadius: 4, border: '1px solid var(--mp-line-soft)',
          textTransform: 'uppercase',
        }}>{item.channel.toUpperCase()}</span>
        <Icon name={open ? 'expand_less' : 'expand_more'} style={{ fontSize: 18, color: 'var(--mp-ink-3)' }} />
      </button>
      {open && item.detail && (
        <div style={{
          padding: '6px 18px 18px 96px',
          background: 'var(--mp-bg)',
          animation: 'fadeUp 0.25s ease-out',
        }}>
          <div className="tabular" style={{
            display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 14,
            padding: '10px 14px', background: 'var(--mp-surface)',
            border: '1px solid var(--mp-line-soft)', borderRadius: 'var(--mp-radius-sm)',
          }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--mp-ink-2)' }}>
              {fmtEur(item.detail.from)} → <span style={{ color: 'var(--mp-loss)' }}>{fmtEur(item.detail.to)}</span>
              {' '}<span style={{ color: 'var(--mp-loss)', fontWeight: 600 }}>({item.detail.deltaPct.toFixed(2).replace('.', ',')}%)</span>
            </span>
            <span style={{ color: 'var(--mp-line)' }}>·</span>
            <span style={{ fontSize: 12, color: 'var(--mp-ink-3)' }}>floor <strong style={{ color: 'var(--mp-ink-2)' }}>{fmtEur(item.detail.floor)}</strong></span>
            <span style={{ color: 'var(--mp-line)' }}>·</span>
            <span style={{ fontSize: 12, color: 'var(--mp-ink-3)' }}>ceiling <strong style={{ color: 'var(--mp-ink-2)' }}>{fmtEur(item.detail.ceiling)}</strong></span>
            <span style={{ color: 'var(--mp-line)' }}>·</span>
            <span style={{ fontSize: 12, color: 'var(--mp-ink-3)' }}>{item.detail.cycle}</span>
            <span style={{ color: 'var(--mp-line)' }}>·</span>
            <span style={{ fontSize: 12, color: 'var(--mp-ink-3)' }}>PRI01 <strong style={{ color: 'var(--mp-ink-2)' }}>{item.detail.pri01}</strong> · PRI02 <strong style={{ color: 'var(--mp-win)' }}>{item.detail.pri02}</strong></span>
          </div>

          {/* 3-column row drawer · sinal · decisão · confirmação */}
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 16, marginBottom: 14,
          }}>
            {[
              { h: 'Sinal observado',     b: item.detail.competitor, sub: 'detectado às 13:49' },
              { h: 'Decisão',             b: `Ajuste para ${fmtEur(item.detail.to)}`, sub: 'Margem aplicada: -1,5% / +5,0%' },
              { h: 'Confirmação Mirakl',  b: 'OK · ack #87233', sub: 'latência 1,1 s' },
            ].map((c, i) => (
              <div key={i} style={{
                padding: '12px 14px', background: 'var(--mp-surface)',
                border: '1px solid var(--mp-line-soft)',
                borderRadius: 'var(--mp-radius-sm)',
              }}>
                <p style={{ margin: '0 0 6px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--mp-ink-3)' }}>{c.h}</p>
                <p className="tabular" style={{ margin: 0, fontSize: 12, color: 'var(--mp-ink-2)', fontWeight: 600 }}>{c.b}</p>
                <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--mp-ink-3)' }}>{c.sub}</p>
              </div>
            ))}
          </div>

          <a href="#" style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 12, fontWeight: 700, color: 'var(--mp-primary)',
            textDecoration: 'none',
          }}>
            Ver decisão completa
            <Icon name="arrow_forward" style={{ fontSize: 14 }} />
          </a>
        </div>
      )}
    </div>
  );
}

function NotavelFeed({ items }) {
  const [channel, setChannel] = useState('both');
  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
        <h3 className="font-display" style={{
          margin: 0, fontSize: 13, fontWeight: 700,
          color: 'var(--mp-primary)', letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}>
          Notável <span style={{ color: 'var(--mp-ink-3)', fontWeight: 500 }}>· últimas 30</span>
        </h3>
        <div style={{
          display: 'flex', background: 'var(--mp-bg)',
          border: '1px solid var(--mp-line)',
          borderRadius: 'var(--mp-radius-sm)', padding: 3,
        }}>
          {[{id:'both',l:'Ambos'},{id:'pt',l:'PT'},{id:'es',l:'ES'}].map(t => (
            <button key={t.id} onClick={() => setChannel(t.id)} style={{
              padding: '4px 12px', border: 'none', cursor: 'pointer',
              background: channel === t.id ? 'var(--mp-primary)' : 'transparent',
              color: channel === t.id ? '#fff' : 'var(--mp-ink-2)',
              fontWeight: 700, fontSize: 11,
              borderRadius: 6, fontFamily: 'var(--mp-font-display)',
              letterSpacing: '-0.01em',
            }}>{t.l}</button>
          ))}
        </div>
      </div>

      <div style={{
        background: 'var(--mp-surface)',
        border: '1px solid var(--mp-line-soft)',
        borderRadius: 'var(--mp-radius-lg)',
        overflow: 'hidden',
      }}>
        {items.map((it, i) => <NotavelRow key={i} item={it} channelFilter={channel} />)}
        <a href="#" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 6, padding: '14px 16px',
          background: 'var(--mp-bg)',
          fontSize: 12, fontWeight: 700, color: 'var(--mp-primary)',
          textDecoration: 'none',
          borderTop: '1px solid var(--mp-line-soft)',
        }}>
          Ver todos os eventos notáveis (firehose)
          <Icon name="arrow_forward" style={{ fontSize: 14 }} />
        </a>
      </div>
    </section>
  );
}

// ------------ Surface 5: Firehose ------------
function FirehoseSkuRow({ row }) {
  const [open, setOpen] = useState(row.expanded);
  return (
    <div style={{ borderBottom: '1px solid var(--mp-line-soft)' }}>
      <button onClick={() => setOpen(!open)} style={{
        width: '100%', padding: '10px 16px 10px 36px',
        display: 'grid', gridTemplateColumns: '70px 1fr auto auto 20px',
        gap: 14, alignItems: 'center',
        background: open ? 'var(--mp-bg)' : 'transparent',
        border: 'none', cursor: 'pointer', textAlign: 'left',
      }}>
        <span className="tabular" style={{ fontSize: 11, color: 'var(--mp-ink-3)' }}>{row.t}</span>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: 'var(--mp-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {row.name}
          </p>
          <p className="tabular" style={{ margin: '1px 0 0', fontSize: 10, color: 'var(--mp-ink-3)' }}>{row.sku}</p>
        </div>
        <span className="tabular" style={{ fontSize: 12, fontWeight: 600, color: 'var(--mp-ink-2)' }}>
          {fmtEur(row.from)} → <span style={{ color: 'var(--mp-loss)' }}>{fmtEur(row.to)}</span>
        </span>
        <span className="tabular" style={{ fontSize: 11, color: 'var(--mp-loss)', fontWeight: 700, minWidth: 50, textAlign: 'right' }}>
          {row.deltaPct.toFixed(2).replace('.', ',')}%
        </span>
        <Icon name={open ? 'expand_less' : 'expand_more'} style={{ fontSize: 16, color: 'var(--mp-ink-3)' }} />
      </button>
      {open && (
        <div style={{
          padding: '4px 16px 14px 106px',
          background: 'var(--mp-bg)',
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12,
        }}>
          {[
            { h: 'Sinal',         b: row.signal },
            { h: 'Decisão',       b: row.decision },
            { h: 'Mirakl',        b: row.mirakl },
          ].map((c, i) => (
            <div key={i} style={{
              padding: '10px 12px', background: 'var(--mp-surface)',
              border: '1px solid var(--mp-line-soft)',
              borderRadius: 'var(--mp-radius-sm)',
            }}>
              <p style={{ margin: '0 0 4px', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--mp-ink-3)' }}>{c.h}</p>
              <p className="tabular" style={{ margin: 0, fontSize: 11, color: 'var(--mp-ink-2)', fontWeight: 600 }}>{c.b}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FirehoseCycle({ cycle }) {
  const [open, setOpen] = useState(cycle.expanded);
  return (
    <div style={{ borderBottom: '1px solid var(--mp-line)' }}>
      <button onClick={() => setOpen(!open)} style={{
        width: '100%', padding: '14px 20px',
        display: 'grid', gridTemplateColumns: '70px 1fr auto 20px',
        gap: 14, alignItems: 'center',
        background: open ? 'var(--mp-bg)' : 'var(--mp-surface)',
        border: 'none', cursor: 'pointer', textAlign: 'left',
      }}>
        <span className="tabular font-display" style={{ fontSize: 14, fontWeight: 800, color: 'var(--mp-primary)' }}>{cycle.t}</span>
        <span style={{ fontSize: 13, color: 'var(--mp-ink-2)', fontWeight: 500 }}>
          ciclo · <span style={{ color: 'var(--mp-ink-3)' }}>{cycle.tiers}</span>
        </span>
        <span className="tabular" style={{ fontSize: 12, fontWeight: 700, color: 'var(--mp-primary)' }}>
          {fmtNum(cycle.actions)} acções
        </span>
        <Icon name={open ? 'expand_less' : 'expand_more'} style={{ fontSize: 18, color: 'var(--mp-ink-3)' }} />
      </button>
      {open && cycle.summary && (
        <div style={{ background: 'var(--mp-bg)', padding: '6px 0 12px' }}>
          {/* aggregate summary */}
          <div style={{
            margin: '8px 20px 14px',
            padding: '14px 16px',
            background: 'var(--mp-surface)',
            border: '1px solid var(--mp-line-soft)',
            borderRadius: 'var(--mp-radius-sm)',
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18,
          }}>
            <div>
              <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--mp-loss)' }}>
                <Icon name="arrow_downward" style={{ fontSize: 12, verticalAlign: 'middle', marginRight: 4 }} />
                {cycle.summary.undercuts} undercuts
              </p>
              <p className="tabular" style={{ margin: 0, fontSize: 12, color: 'var(--mp-ink-2)' }}>
                preço médio: <strong style={{ color: 'var(--mp-loss)' }}>−{fmtEur(Math.abs(cycle.summary.undercutsAvg))}</strong>
              </p>
            </div>
            <div>
              <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--mp-win)' }}>
                <Icon name="arrow_upward" style={{ fontSize: 12, verticalAlign: 'middle', marginRight: 4 }} />
                {cycle.summary.raises} aumentos
              </p>
              <p className="tabular" style={{ margin: 0, fontSize: 12, color: 'var(--mp-ink-2)' }}>
                preço médio: <strong style={{ color: 'var(--mp-win)' }}>+{fmtEur(cycle.summary.raisesAvg)}</strong>
              </p>
            </div>
            <div>
              <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--mp-ink-3)' }}>
                <Icon name="pause" style={{ fontSize: 12, verticalAlign: 'middle', marginRight: 4 }} />
                {cycle.summary.holds} holds
              </p>
              <p className="tabular" style={{ margin: 0, fontSize: 12, color: 'var(--mp-ink-2)' }}>
                {cycle.summary.holdsBelowFloor} abaixo do floor · {cycle.summary.holdsAlready1st} já em 1.º
              </p>
            </div>
          </div>

          {/* SKU rows */}
          {cycle.skuRows && (
            <div style={{ margin: '0 20px 8px', background: 'var(--mp-surface)', borderRadius: 'var(--mp-radius-sm)', border: '1px solid var(--mp-line-soft)', overflow: 'hidden' }}>
              <div style={{
                padding: '8px 16px 8px 36px', display: 'grid',
                gridTemplateColumns: '70px 1fr auto auto 20px', gap: 14,
                background: 'var(--mp-bg)',
                borderBottom: '1px solid var(--mp-line-soft)',
              }}>
                {['Hora', 'SKU', 'Variação', 'Δ%', ''].map((h, i) => (
                  <span key={i} style={{
                    fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
                    textTransform: 'uppercase', color: 'var(--mp-ink-3)',
                    textAlign: i === 3 ? 'right' : 'left',
                  }}>{h}</span>
                ))}
              </div>
              {cycle.skuRows.map((row, i) => <FirehoseSkuRow key={i} row={row} />)}
              <a href="#" style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: 6, padding: '10px 16px', background: 'var(--mp-bg)',
                fontSize: 11, fontWeight: 700, color: 'var(--mp-primary)',
                textDecoration: 'none',
              }}>
                Expandir todos os {cycle.actions} SKUs
                <Icon name="arrow_forward" style={{ fontSize: 12 }} />
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FirehoseView({ cycles }) {
  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <h3 className="font-display" style={{
            margin: 0, fontSize: 13, fontWeight: 700,
            color: 'var(--mp-primary)', letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}>
            Histórico completo <span style={{ color: 'var(--mp-ink-3)', fontWeight: 500 }}>· agregado por ciclo</span>
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--mp-ink-3)' }}>
            Verificação de confiança. Não é para uso diário.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {['Ajustes','Holds','Absorvidos','Manuais'].map((l, i) => (
            <button key={i} style={{
              padding: '5px 10px', background: 'var(--mp-surface)',
              border: '1px solid var(--mp-line)',
              borderRadius: 6, fontSize: 11, fontWeight: 600,
              color: 'var(--mp-ink-2)', cursor: 'pointer',
            }}>{l}</button>
          ))}
        </div>
      </div>
      <div style={{
        background: 'var(--mp-surface)',
        border: '1px solid var(--mp-line-soft)',
        borderRadius: 'var(--mp-radius-lg)',
        overflow: 'hidden',
      }}>
        {cycles.map((c, i) => <FirehoseCycle key={i} cycle={c} />)}
      </div>
    </section>
  );
}

Object.assign(window, {
  ATENCAO_ITEMS, NOTAVEL_ITEMS, FIREHOSE_CYCLES,
  AuditSearch, DailySummary, AtencaoFeed, NotavelFeed, FirehoseView,
});
