// KPI cards + dashboard sub-components

const KPI_DATA = {
  pt: {
    winning: 4821, winningValue: 248500,
    losing: 1340, losingValue: 184200,
    exclusive: 756, exclusiveValue: 41300,
    todayAdjustments: 384, todayHolds: 22, todayAbsorbed: 12,
    posDelta: 12,
  },
  es: {
    winning: 3108, winningValue: 192400,
    losing: 2104, losingValue: 263100,
    exclusive: 412, exclusiveValue: 28700,
    todayAdjustments: 251, todayHolds: 18, todayAbsorbed: 7,
    posDelta: -3,
  },
};

function KpiCard({ label, value, valueLine, subtitle, icon, tone, dimmed, stale }) {
  const toneMap = {
    win:  { bg: 'var(--mp-win-soft)',  fg: 'var(--mp-win)',  border: 'color-mix(in oklch, var(--mp-win) 22%, transparent)' },
    loss: { bg: 'var(--mp-loss-soft)', fg: 'var(--mp-loss)', border: 'color-mix(in oklch, var(--mp-loss) 22%, transparent)' },
    info: { bg: 'var(--mp-info-soft)', fg: 'var(--mp-info)', border: 'color-mix(in oklch, var(--mp-info) 22%, transparent)' },
  };
  const t = toneMap[tone];
  return (
    <div style={{
      background: 'var(--mp-surface)',
      border: '1px solid var(--mp-line-soft)',
      borderRadius: 'var(--mp-radius-lg)',
      padding: 24,
      position: 'relative', overflow: 'hidden',
      opacity: dimmed ? 0.6 : 1,
      filter: stale ? 'grayscale(0.4)' : 'none',
      transition: 'opacity 0.2s, filter 0.2s',
    }}>
      <div style={{
        position: 'absolute', top: 18, right: 18,
        width: 32, height: 32, borderRadius: 8,
        background: t.bg, color: t.fg, border: `1px solid ${t.border}`,
        display: 'grid', placeItems: 'center',
      }}>
        <Icon name={icon} fill style={{ fontSize: 18 }} />
      </div>
      <p style={{
        margin: '0 0 10px', fontSize: 10, fontWeight: 700,
        letterSpacing: '0.12em', textTransform: 'uppercase',
        color: 'var(--mp-ink-3)',
      }}>{label}</p>
      <div className="tabular font-display" style={{
        fontSize: 44, fontWeight: 800, color: 'var(--mp-primary)',
        lineHeight: 1, letterSpacing: '-0.03em', margin: '0 0 4px',
      }}>{fmtNum(value)}</div>
      <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--mp-ink-2)', fontWeight: 500 }}>{subtitle}</p>
      {valueLine && (
        <div style={{
          paddingTop: 10, marginTop: 4,
          borderTop: '1px solid var(--mp-line-soft)',
        }}>
          <div className="tabular" style={{
            fontSize: 14, fontWeight: 700, color: 'var(--mp-ink-2)',
            letterSpacing: '-0.01em',
          }}>{valueLine.value}</div>
          <div style={{
            fontSize: 10, fontWeight: 600,
            letterSpacing: '0.08em', textTransform: 'uppercase',
            color: 'var(--mp-ink-3)', marginTop: 2,
          }}>{valueLine.label}</div>
        </div>
      )}
      {stale && (
        <span style={{
          position: 'absolute', bottom: 12, right: 16,
          fontSize: 10, color: 'var(--mp-ink-3)', fontWeight: 600,
          letterSpacing: '0.04em',
        }}>último OK · 13:42</span>
      )}
    </div>
  );
}

function KpiSkeleton() {
  return (
    <div style={{
      background: 'var(--mp-surface)',
      border: '1px solid var(--mp-line-soft)',
      borderRadius: 'var(--mp-radius-lg)',
      padding: 24,
    }}>
      <div className="skel" style={{ width: 32, height: 32, borderRadius: 8, marginLeft: 'auto' }} />
      <div className="skel" style={{ width: 100, height: 10, marginTop: 14, marginBottom: 18 }} />
      <div className="skel" style={{ width: 140, height: 38, marginBottom: 10 }} />
      <div className="skel" style={{ width: 180, height: 12, marginBottom: 18 }} />
      <div style={{ borderTop: '1px solid var(--mp-line-soft)', paddingTop: 12 }}>
        <div className="skel" style={{ width: 90, height: 14, marginBottom: 6 }} />
        <div className="skel" style={{ width: 110, height: 10 }} />
      </div>
    </div>
  );
}

function KpiRow({ data, dimmed, stale, simulated }) {
  return (
    <section style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
      gap: 16,
      position: 'relative',
    }}>
      {simulated && (
        <span style={{
          position: 'absolute', top: -10, right: 0,
          padding: '4px 10px',
          background: 'var(--mp-info)', color: '#fff',
          borderRadius: 999, fontSize: 10, fontWeight: 800,
          letterSpacing: '0.12em', textTransform: 'uppercase',
          fontFamily: 'var(--mp-font-display)',
          boxShadow: '0 4px 10px color-mix(in oklch, var(--mp-info) 25%, transparent)',
        }}>Modo simulação</span>
      )}
      <KpiCard label="Em 1.º lugar" value={data.winning} icon="trending_up" tone="win"
        subtitle="SKUs onde dominas a Buy Box"
        valueLine={{ value: fmtCurrency(data.winningValue), label: 'Catálogo a vencer' }}
        dimmed={dimmed} stale={stale} />
      <KpiCard label="A perder posição" value={data.losing} icon="trending_down" tone="loss"
        subtitle="Produtos ultrapassados hoje"
        valueLine={{ value: fmtCurrency(data.losingValue), label: 'Catálogo exposto' }}
        dimmed={dimmed} stale={stale} />
      <KpiCard label="Sem concorrência" value={data.exclusive} icon="verified" tone="info"
        subtitle="Itens exclusivos no teu catálogo"
        valueLine={{ value: fmtCurrency(data.exclusiveValue), label: 'Catálogo exclusivo' }}
        dimmed={dimmed} stale={stale} />
    </section>
  );
}

// "Hoje" condensed audit log preview
function HojeStrip({ data }) {
  const items = [
    { icon: 'sync_alt', value: data.todayAdjustments, label: 'ajustes' },
    { icon: 'pause', value: data.todayHolds, label: 'holds' },
    { icon: 'merge', value: data.todayAbsorbed, label: 'absorções ERP' },
  ];
  return (
    <section style={{
      background: 'var(--mp-surface)',
      border: '1px solid var(--mp-line-soft)',
      borderRadius: 'var(--mp-radius-lg)',
      padding: '20px 24px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 24, flexWrap: 'wrap',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
        <div>
          <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--mp-ink-3)' }}>Hoje · até 14:22</p>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--mp-primary)' }}>
            Posição: <span className="tabular">{fmtNum(data.winning)}</span> SKUs em 1.º{' '}
            <span style={{ color: data.posDelta >= 0 ? 'var(--mp-win)' : 'var(--mp-loss)', fontWeight: 700 }}>
              {data.posDelta >= 0 ? '+' : ''}{data.posDelta} vs ontem
            </span>
          </p>
        </div>
        <div style={{ width: 1, height: 32, background: 'var(--mp-line)' }} />
        <div style={{ display: 'flex', gap: 24 }}>
          {items.map((it, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name={it.icon} style={{ fontSize: 18, color: 'var(--mp-ink-3)' }} />
              <span className="tabular font-display" style={{ fontSize: 18, fontWeight: 800, color: 'var(--mp-primary)' }}>{fmtNum(it.value)}</span>
              <span style={{ fontSize: 12, color: 'var(--mp-ink-2)' }}>{it.label}</span>
            </div>
          ))}
        </div>
      </div>
      <a href="#" style={{
        display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 12, fontWeight: 700, color: 'var(--mp-primary)',
        textDecoration: 'none',
      }}>
        Ver audit log completo
        <Icon name="arrow_forward" style={{ fontSize: 16 }} />
      </a>
    </section>
  );
}

// Atenção empty / nothing-to-review row on dashboard
function AtencaoEmpty() {
  return (
    <div style={{
      background: 'color-mix(in oklch, var(--mp-win) 6%, var(--mp-surface))',
      border: '1px solid color-mix(in oklch, var(--mp-win) 25%, transparent)',
      borderRadius: 'var(--mp-radius)',
      padding: '14px 18px',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <Icon name="check_circle" fill style={{ fontSize: 20, color: 'var(--mp-win)' }} />
      <span style={{ fontSize: 13, color: 'var(--mp-ink-2)', fontWeight: 500 }}>
        Nada que precise da tua atenção.
      </span>
    </div>
  );
}

// Margin editor (collapsed + expanded)
function MarginEditor({ expanded, setExpanded }) {
  const [maxDiscount, setMaxDiscount] = useState(1.5);
  const [maxIncrease, setMaxIncrease] = useState(5.0);
  const sku = { name: 'Sony Bravia XR-55A80L OLED 55"', price: 799.00 };
  const minAllowed = sku.price * (1 - maxDiscount / 100);
  const impact = sku.price - minAllowed;
  const remainingMargin = sku.price * 0.05 - impact; // assume 5% margin floor
  const remainingPct = (remainingMargin / sku.price) * 100;

  return (
    <section style={{
      background: 'var(--mp-surface)',
      border: '1px solid var(--mp-line-soft)',
      borderRadius: 'var(--mp-radius-lg)',
      overflow: 'hidden',
    }}>
      {/* Collapsed header / always visible */}
      <button onClick={() => setExpanded(!expanded)} style={{
        width: '100%', padding: '18px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 16, background: 'transparent', border: 'none', cursor: 'pointer',
        textAlign: 'left',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8,
            background: 'var(--mp-info-soft)',
            color: 'var(--mp-info)',
            display: 'grid', placeItems: 'center',
          }}>
            <Icon name="tune" fill style={{ fontSize: 20 }} />
          </div>
          <div>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--mp-primary)', fontFamily: 'var(--mp-font-display)', letterSpacing: '-0.01em' }}>
              Margem de tolerância
            </p>
            <p className="tabular" style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--mp-ink-3)' }}>
              Reduzir até <strong style={{ color: 'var(--mp-ink-2)' }}>{maxDiscount.toFixed(1)}%</strong>
              {' · '}Aumentar até <strong style={{ color: 'var(--mp-ink-2)' }}>{maxIncrease.toFixed(1)}%</strong>
            </p>
          </div>
        </div>
        <Icon name={expanded ? 'expand_less' : 'expand_more'} style={{ fontSize: 22, color: 'var(--mp-ink-3)' }} />
      </button>

      {expanded && (
        <div style={{ padding: '0 24px 24px', borderTop: '1px solid var(--mp-line-soft)' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16,
            paddingTop: 20, paddingBottom: 20,
          }}>
            {[
              { label: 'Reduzir até', val: maxDiscount, set: setMaxDiscount, sign: '-' },
              { label: 'Aumentar até', val: maxIncrease, set: setMaxIncrease, sign: '+' },
            ].map((f, i) => (
              <div key={i}>
                <label style={{
                  display: 'block', fontSize: 10, fontWeight: 700,
                  letterSpacing: '0.12em', textTransform: 'uppercase',
                  color: 'var(--mp-ink-3)', marginBottom: 8,
                }}>{f.label}</label>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: 'var(--mp-bg)',
                  border: '1px solid var(--mp-line)',
                  borderRadius: 'var(--mp-radius-sm)',
                  padding: '10px 14px',
                }}>
                  <span style={{ fontSize: 16, color: 'var(--mp-ink-3)', fontWeight: 600 }}>{f.sign}</span>
                  <input
                    className="tabular"
                    type="number" step="0.1" min="0" max="50"
                    value={f.val}
                    onChange={(e) => f.set(parseFloat(e.target.value) || 0)}
                    style={{
                      flex: 1, fontSize: 18, fontWeight: 700,
                      color: 'var(--mp-primary)', border: 'none',
                      background: 'transparent', fontFamily: 'var(--mp-font-display)',
                      letterSpacing: '-0.01em', minWidth: 0,
                    }}
                  />
                  <span style={{ fontSize: 14, color: 'var(--mp-ink-3)', fontWeight: 600 }}>%</span>
                </div>
              </div>
            ))}
          </div>

          {/* Worked example */}
          <div style={{
            background: 'var(--mp-bg)',
            border: '1px solid var(--mp-line-soft)',
            borderRadius: 'var(--mp-radius)',
            padding: '18px 20px', marginBottom: 16,
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', marginBottom: 14,
            }}>
              <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--mp-primary)' }}>
                Exemplo com a tua margem
              </p>
              <button style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', background: 'var(--mp-surface)',
                border: '1px solid var(--mp-line)',
                borderRadius: 6, cursor: 'pointer',
                fontSize: 11, fontWeight: 600, color: 'var(--mp-ink-2)',
              }}>
                <Icon name="refresh" style={{ fontSize: 14 }} />
                Ver outro
              </button>
            </div>
            <p style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 600, color: 'var(--mp-primary)' }}>
              {sku.name}
            </p>
            <div style={{ display: 'grid', gap: 8 }}>
              {[
                { k: 'Preço actual', v: fmtEur(sku.price), c: 'var(--mp-ink-2)' },
                { k: 'Preço mínimo permitido', v: `${fmtEur(minAllowed)}  (-${fmtEur(impact)})`, c: 'var(--mp-loss)' },
                { k: 'Impacto na margem', v: `-${fmtEur(impact)} / -${maxDiscount.toFixed(1)}%`, c: 'var(--mp-loss)' },
                { k: 'Margem restante', v: `~${fmtEur(Math.max(0, remainingMargin))}  (~${remainingPct.toFixed(1)}%)`, c: 'var(--mp-win)' },
              ].map((row, i) => (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between',
                  padding: '6px 0',
                  borderTop: i > 0 ? '1px dashed var(--mp-line-soft)' : 'none',
                }}>
                  <span style={{ fontSize: 13, color: 'var(--mp-ink-2)' }}>{row.k}</span>
                  <span className="tabular" style={{ fontSize: 13, color: row.c, fontWeight: 700 }}>{row.v}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Caveat — §9.11 verbatim */}
          <p style={{
            margin: '0 0 18px', fontSize: 12, color: 'var(--mp-ink-3)',
            lineHeight: 1.55, fontStyle: 'italic',
          }}>
            Estimativa baseada na margem 5% indicada no onboarding. Se a margem real for superior, o impacto será menor. O exemplo mostra um SKU representativo do teu catálogo — clica em <strong style={{ color: 'var(--mp-ink-2)', fontStyle: 'normal' }}>Ver outro</strong> para trocar.
          </p>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button style={{
              padding: '10px 18px',
              background: 'linear-gradient(135deg, var(--mp-primary), var(--mp-primary-2))',
              color: '#fff', border: 'none',
              borderRadius: 'var(--mp-radius-sm)',
              cursor: 'pointer', fontSize: 13, fontWeight: 700,
              fontFamily: 'var(--mp-font-display)', letterSpacing: '-0.01em',
              display: 'flex', alignItems: 'center', gap: 8,
              boxShadow: '0 6px 14px color-mix(in oklch, var(--mp-primary) 22%, transparent)',
            }}>
              Guardar alterações
              <Icon name="check" style={{ fontSize: 16 }} />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// Go-Live CTA panel (dry-run only)
function GoLiveCta({ data }) {
  return (
    <section style={{
      position: 'relative', overflow: 'hidden',
      background: 'linear-gradient(135deg, var(--mp-primary), var(--mp-primary-2))',
      borderRadius: 'var(--mp-radius-lg)',
      padding: '28px 32px',
    }}>
      <div style={{
        position: 'absolute', right: -100, top: -100,
        width: 320, height: 320, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(255,255,255,0.08), transparent 70%)',
      }} />
      <div style={{
        position: 'relative', zIndex: 1,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        gap: 24, flexWrap: 'wrap',
      }}>
        <div style={{ maxWidth: 580 }}>
          <p style={{
            margin: '0 0 8px', fontSize: 10, fontWeight: 700,
            letterSpacing: '0.15em', textTransform: 'uppercase',
            color: 'var(--mp-primary-tint)',
          }}>Pronto para ir live?</p>
          <h3 className="font-display" style={{
            margin: '0 0 8px', fontSize: 24, fontWeight: 800,
            color: '#fff', letterSpacing: '-0.02em', lineHeight: 1.15,
          }}>{fmtNum(data.winning + data.losing)} produtos prontos para repricing automático</h3>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--mp-primary-tint)', lineHeight: 1.55 }}>
            Margens configuradas. Tu confirmas, nós executamos. Podes parar a qualquer momento.
          </p>
        </div>
        <button style={{
          padding: '14px 22px', background: '#fff',
          color: 'var(--mp-primary)', border: 'none',
          borderRadius: 'var(--mp-radius-sm)', cursor: 'pointer',
          fontSize: 14, fontWeight: 700,
          fontFamily: 'var(--mp-font-display)',
          letterSpacing: '-0.01em',
          display: 'flex', alignItems: 'center', gap: 8,
          boxShadow: '0 12px 24px rgba(0,0,0,0.18)',
        }}>
          Ir live (€50/mês)
          <Icon name="arrow_forward" style={{ fontSize: 18 }} />
        </button>
      </div>
    </section>
  );
}

Object.assign(window, { KPI_DATA, KpiCard, KpiSkeleton, KpiRow, HojeStrip, AtencaoEmpty, MarginEditor, GoLiveCta });
