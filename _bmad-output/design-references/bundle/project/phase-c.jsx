// Phase C — modals + onboarding + audit search-active

// ============ ARTBOARD 08 — Go-Live consent modal ============
function GoLiveModalContent({ checked }) {
  return (
    <>
      <ModalBody>
        <p style={{
          margin: '0 0 8px', fontSize: 11, fontWeight: 700,
          letterSpacing: '0.14em', textTransform: 'uppercase',
          color: 'var(--mp-ink-3)',
        }}>Confirmar activação</p>
        <h2 className="font-display" style={{
          margin: '0 0 18px', fontSize: 26, fontWeight: 800,
          color: 'var(--mp-primary)', letterSpacing: '-0.02em', lineHeight: 1.2,
        }}>Pronto para ir live?</h2>

        <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--mp-ink-2)', lineHeight: 1.6 }}>
          Até <strong className="tabular" style={{ color: 'var(--mp-primary)', fontWeight: 700 }}>6.161 produtos</strong>{' '}
          poderão ter preços ajustados, dentro da margem de{' '}
          <strong style={{ color: 'var(--mp-primary)', fontWeight: 700 }}>1,5%</strong> que configuraste.
          Os preços são otimizados a cada <strong>15 minutos</strong>, sempre dentro da tua tolerância — nunca abaixo do floor, nunca acima do ceiling.
        </p>

        <p style={{
          margin: '0 0 22px', fontSize: 12, color: 'var(--mp-ink-3)',
          lineHeight: 1.55, fontStyle: 'italic',
        }}>
          Tu confirmas. Nós executamos. Tu podes parar a qualquer momento.
        </p>

        <label style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 16px',
          background: 'var(--mp-bg)',
          border: '1px solid var(--mp-line)',
          borderRadius: 'var(--mp-radius-sm)',
          cursor: 'pointer',
          userSelect: 'none',
        }}>
          <span style={{
            width: 20, height: 20, borderRadius: 5,
            display: 'grid', placeItems: 'center',
            background: checked ? 'var(--mp-primary)' : 'var(--mp-surface)',
            border: checked ? '1.5px solid var(--mp-primary)' : '1.5px solid var(--mp-line)',
            flexShrink: 0,
            transition: 'all 0.15s',
          }}>
            {checked && <Icon name="check" style={{ fontSize: 16, color: '#fff', fontWeight: 700 }} />}
          </span>
          <span style={{ fontSize: 13, color: 'var(--mp-ink), fontWeight: 500' }}>
            Compreendo e autorizo o repricing automático.
          </span>
        </label>
      </ModalBody>
      <ModalFooter>
        <SecondaryButton>Manter em modo simulação</SecondaryButton>
        <PrimaryButton style={checked ? {} : { opacity: 0.4, pointerEvents: 'none' }}>
          Confirmar e ir live <span className="tabular" style={{ opacity: 0.7, fontWeight: 600 }}>(€50/mês)</span>
          <Icon name="arrow_forward" style={{ fontSize: 16 }} />
        </PrimaryButton>
      </ModalFooter>
    </>
  );
}

function ScreenGoLiveModal({ channel, setChannel }) {
  const [paused, setPaused] = useState(false);
  return (
    <div style={{ position: 'relative', height: '100%', overflow: 'hidden' }}>
      <ModalBackdrop>
        <DashFrame channel={channel} setChannel={setChannel} screen="dash-dryrun" paused={paused} setPaused={setPaused}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
            <div>
              <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--mp-ink-3)' }}>
                <span className="live-dot" style={{ marginRight: 8, verticalAlign: 'middle', background: 'var(--mp-info)' }} />
                Modo simulação · Worten {channel === 'pt' ? 'Portugal' : 'Espanha'}
              </p>
              <h1 className="font-display" style={{ margin: 0, fontSize: 28, fontWeight: 800, color: 'var(--mp-primary)', letterSpacing: '-0.02em' }}>
                Olá, Tomás
              </h1>
            </div>
          </div>
          <Banner kind="dryrun" action={{ label: 'Ir live' }}>
            <strong style={{ fontWeight: 700 }}>Modo simulação activo.</strong>{' '}
            Os números abaixo mostram o que <em>aconteceria</em> se estivesses em modo live. Nenhum preço foi alterado.
          </Banner>
          <KpiRow data={KPI_DATA[channel]} />
          <HojeStrip data={KPI_DATA[channel]} />
          <GoLiveCta data={KPI_DATA[channel]} />
        </DashFrame>
      </ModalBackdrop>
      <Modal width={520} onClose={() => {}}>
        <GoLiveModalContent checked={true} />
      </Modal>
    </div>
  );
}

// ============ ARTBOARD 09 — Anomaly review modal ============
function AnomalyModalContent() {
  return (
    <>
      <ModalBody>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span style={{
            width: 28, height: 28, borderRadius: 8,
            display: 'grid', placeItems: 'center',
            background: 'var(--mp-warn-soft)', color: 'var(--mp-warn)',
          }}>
            <Icon name="ac_unit" fill style={{ fontSize: 16 }} />
          </span>
          <p style={{
            margin: 0, fontSize: 11, fontWeight: 700,
            letterSpacing: '0.14em', textTransform: 'uppercase',
            color: 'var(--mp-warn)',
          }}>Mudança externa de preço</p>
        </div>
        <h2 className="font-display" style={{
          margin: '0 0 4px', fontSize: 22, fontWeight: 800,
          color: 'var(--mp-primary)', letterSpacing: '-0.02em', lineHeight: 1.25,
        }}>Sony Bravia XR-55A80L OLED 55&quot;</h2>
        <p className="tabular" style={{
          margin: '0 0 20px', fontSize: 11, color: 'var(--mp-ink-3)',
        }}>SKU: SON-XR55A80L · EAN: 4548736143005</p>

        <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--mp-ink-2)', lineHeight: 1.6 }}>
          Detetámos uma alteração ao preço deste produto fora dos nossos ciclos:
        </p>

        {/* Before / After comparison */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr auto 1fr',
          gap: 14, alignItems: 'center',
          padding: '18px 20px', marginBottom: 18,
          background: 'var(--mp-bg)',
          border: '1px solid var(--mp-line-soft)',
          borderRadius: 'var(--mp-radius-sm)',
        }}>
          <div>
            <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--mp-ink-3)' }}>Antes</p>
            <p className="tabular" style={{
              margin: 0, fontSize: 22, fontWeight: 700,
              color: 'var(--mp-ink-3)',
              textDecoration: 'line-through',
              textDecorationColor: 'color-mix(in oklch, var(--mp-ink-3) 60%, transparent)',
              fontFamily: 'var(--mp-font-display)', letterSpacing: '-0.01em',
            }}>{fmtEur(799.00)}</p>
          </div>
          <Icon name="arrow_forward" style={{ fontSize: 20, color: 'var(--mp-ink-3)' }} />
          <div>
            <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--mp-warn)' }}>Agora</p>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <p className="tabular font-display" style={{
                margin: 0, fontSize: 22, fontWeight: 800,
                color: 'var(--mp-loss)', letterSpacing: '-0.01em',
              }}>{fmtEur(398.00)}</p>
              <span className="tabular" style={{
                padding: '3px 8px', fontSize: 11, fontWeight: 700,
                background: 'var(--mp-warn-soft)', color: 'var(--mp-warn)',
                borderRadius: 4, fontFamily: 'var(--mp-font-display)',
                letterSpacing: '-0.01em',
              }}>−50,2%</span>
            </div>
          </div>
        </div>

        <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--mp-ink-2)', lineHeight: 1.6 }}>
          Como a mudança é maior que <strong>40%</strong>, congelámos o repricing deste produto até confirmares.
          Pode ser uma promoção intencional ou um erro do teu ERP.
        </p>

        <p style={{
          margin: '0 0 4px', fontSize: 12, color: 'var(--mp-ink-3)',
          lineHeight: 1.55, fontStyle: 'italic',
        }}>
          Nada acontece até confirmares.
        </p>
      </ModalBody>
      <ModalFooter style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <PrimaryButton style={{ flex: 1, minWidth: 200, justifyContent: 'center' }}>
            Confirmar — usar {fmtEur(398.00)}
          </PrimaryButton>
          <SecondaryButton style={{ flex: 1, minWidth: 180, justifyContent: 'center', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            Rejeitar — manter {fmtEur(799.00)}
          </SecondaryButton>
        </div>
        <a href="#" style={{
          alignSelf: 'center', padding: '4px 0',
          fontSize: 12, fontWeight: 600,
          color: 'var(--mp-ink-3)', textDecoration: 'none',
          display: 'inline-flex', alignItems: 'center', gap: 4,
        }}>
          Ver histórico no audit log
          <Icon name="arrow_forward" style={{ fontSize: 14 }} />
        </a>
      </ModalFooter>
    </>
  );
}

function ScreenAnomalyModal({ channel, setChannel }) {
  const [paused, setPaused] = useState(false);
  return (
    <div style={{ position: 'relative', height: '100%', overflow: 'hidden' }}>
      <ModalBackdrop>
        <DashFrame channel={channel} setChannel={setChannel} screen="dash-live" paused={paused} setPaused={setPaused}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16 }}>
            <div>
              <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--mp-win)' }}>
                <span className="live-dot" style={{ marginRight: 8, verticalAlign: 'middle' }} />
                Modo live · Worten {channel === 'pt' ? 'Portugal' : 'Espanha'}
              </p>
              <h1 className="font-display" style={{ margin: 0, fontSize: 28, fontWeight: 800, color: 'var(--mp-primary)', letterSpacing: '-0.02em' }}>
                Olá, Tomás
              </h1>
            </div>
          </div>
          <Banner kind="anomaly" action={{ label: 'Rever agora' }}>
            <strong style={{ fontWeight: 700 }}>1 anomalia a rever.</strong>{' '}
            Sony Bravia XR-55A80L mudou de €799 para €398 (−50,2%) fora dos nossos ciclos. Repricing congelado até confirmares.
          </Banner>
          <KpiRow data={KPI_DATA[channel]} />
          <HojeStrip data={KPI_DATA[channel]} />
        </DashFrame>
      </ModalBackdrop>
      <Modal width={560} onClose={() => {}}>
        <AnomalyModalContent />
      </Modal>
    </div>
  );
}

// ============ ARTBOARD 10 — /onboarding/scan-ready ============
function ScreenScanReady() {
  return (
    <OnboardingFrame currentStep="margin" maxWidth={720}>
      <div style={{ textAlign: 'center' }}>
        <p style={{
          margin: '0 0 10px', fontSize: 11, fontWeight: 700,
          letterSpacing: '0.16em', textTransform: 'uppercase',
          color: 'var(--mp-win)',
        }}>Análise do catálogo</p>
        <h1 className="font-display" style={{
          margin: '0 0 12px', fontSize: 32, fontWeight: 800,
          color: 'var(--mp-primary)', letterSpacing: '-0.02em', lineHeight: 1.15,
        }}>A análise do catálogo concluiu</h1>
        <p style={{
          margin: '0 auto', maxWidth: 540,
          fontSize: 15, color: 'var(--mp-ink-2)', lineHeight: 1.55,
        }}>
          Aqui está o que o motor encontrou no teu Worten — e onde vai começar a trabalhar.
        </p>
      </div>

      {/* Hero stat row */}
      <div style={{
        background: 'var(--mp-surface)',
        border: '1px solid var(--mp-line-soft)',
        borderRadius: 'var(--mp-radius-lg)',
        padding: '22px 28px',
        display: 'flex', alignItems: 'center', gap: 18,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: 'var(--mp-win-soft)',
          display: 'grid', placeItems: 'center',
          flexShrink: 0,
        }}>
          <Icon name="check_circle" fill style={{ fontSize: 22, color: 'var(--mp-win)' }} />
        </div>
        <p style={{ margin: 0, fontSize: 17, color: 'var(--mp-ink-2)' }}>
          <strong className="tabular font-display" style={{
            fontSize: 26, color: 'var(--mp-primary)',
            fontWeight: 800, letterSpacing: '-0.02em', marginRight: 4,
          }}>31.179</strong>{' '}
          produtos encontrados no Worten
        </p>
      </div>

      {/* Breakdown card */}
      <div style={{
        background: 'var(--mp-surface)',
        border: '1px solid var(--mp-line-soft)',
        borderRadius: 'var(--mp-radius-lg)',
        overflow: 'hidden',
      }}>
        {/* Headline row */}
        <div style={{
          padding: '24px 28px',
          borderLeft: '4px solid var(--mp-win)',
          background: 'color-mix(in oklch, var(--mp-win) 4%, var(--mp-surface))',
          display: 'flex', alignItems: 'baseline', gap: 18,
        }}>
          <p className="tabular font-display" style={{
            margin: 0, fontSize: 44, fontWeight: 800,
            color: 'var(--mp-win)', letterSpacing: '-0.03em',
            lineHeight: 1, minWidth: 140,
          }}>28.842</p>
          <div>
            <p style={{ margin: '0 0 3px', fontSize: 16, fontWeight: 700, color: 'var(--mp-primary)', letterSpacing: '-0.01em' }}>
              prontos para repricing
            </p>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--mp-ink-2)' }}>
              com competidores activos
            </p>
          </div>
        </div>

        <div style={{ padding: '4px 28px 18px' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '140px 1fr auto',
            gap: 18, alignItems: 'center',
            padding: '14px 0',
            borderTop: '1px solid var(--mp-line-soft)',
          }}>
            <p className="tabular font-display" style={{
              margin: 0, fontSize: 22, fontWeight: 700,
              color: 'var(--mp-ink-2)', letterSpacing: '-0.02em',
            }}>1.847</p>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--mp-ink-2)' }}>
              sem competidores <span style={{ color: 'var(--mp-ink-3)' }}>(Tier 3 — vamos monitorizar)</span>
            </p>
            <span />
          </div>
          <div style={{
            display: 'grid', gridTemplateColumns: '140px 1fr auto',
            gap: 18, alignItems: 'center',
            padding: '14px 0',
            borderTop: '1px solid var(--mp-line-soft)',
          }}>
            <p className="tabular font-display" style={{
              margin: 0, fontSize: 22, fontWeight: 700,
              color: 'var(--mp-ink-2)', letterSpacing: '-0.02em',
            }}>490</p>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--mp-ink-2)' }}>
              sem EAN no Worten — ignorados
            </p>
            <a href="#" style={{
              fontSize: 12, fontWeight: 700,
              color: 'var(--mp-primary)',
              textDecoration: 'none',
              display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>
              <Icon name="expand_less" style={{ fontSize: 16 }} />
              porquê?
            </a>
          </div>

          {/* Disclosure expanded */}
          <div style={{
            marginTop: 6,
            padding: '14px 16px',
            background: 'var(--mp-bg)',
            border: '1px solid var(--mp-line-soft)',
            borderRadius: 'var(--mp-radius-sm)',
            animation: 'fadeUp 0.25s ease-out',
          }}>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--mp-ink-2)', lineHeight: 1.6 }}>
              Produtos refurbished e listings privados não têm EAN partilhado no Worten — não conseguimos ver competidores no mesmo produto. Ficam fora do scope do repricing automático. Isto é estrutural ao Worten, não uma limitação da MarketPilot.
            </p>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <p style={{
          margin: 0, fontSize: 15, fontWeight: 600,
          color: 'var(--mp-primary)', letterSpacing: '-0.01em',
          fontFamily: 'var(--mp-font-display)',
        }}>Pronto para configurar a margem?</p>
        <PrimaryButton style={{ padding: '14px 24px', fontSize: 14 }}>
          Continuar
          <Icon name="arrow_forward" style={{ fontSize: 18 }} />
        </PrimaryButton>
      </div>
    </OnboardingFrame>
  );
}

// ============ ARTBOARD 11 — /onboarding/key with trust block ============
function ScreenOnboardingKey() {
  return (
    <OnboardingFrame currentStep="key" maxWidth={560}>
      <div>
        <p style={{
          margin: '0 0 10px', fontSize: 11, fontWeight: 700,
          letterSpacing: '0.16em', textTransform: 'uppercase',
          color: 'var(--mp-ink-3)',
        }}>Passo 1 de 4</p>
        <h1 className="font-display" style={{
          margin: '0 0 12px', fontSize: 30, fontWeight: 800,
          color: 'var(--mp-primary)', letterSpacing: '-0.02em', lineHeight: 1.15,
        }}>Cola a tua chave Worten</h1>
        <p style={{
          margin: 0, fontSize: 15, color: 'var(--mp-ink-2)', lineHeight: 1.55,
        }}>
          Vamos validá-la em 5 segundos com uma chamada à API do Worten. Se for válida, começamos a análise do teu catálogo de imediato.
        </p>
      </div>

      {/* Form */}
      <div>
        <label style={{
          display: 'block', fontSize: 10, fontWeight: 700,
          letterSpacing: '0.14em', textTransform: 'uppercase',
          color: 'var(--mp-ink-3)', marginBottom: 8,
        }}>Chave API do Worten</label>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'var(--mp-surface)',
          border: '1.5px solid var(--mp-primary)',
          borderRadius: 'var(--mp-radius)',
          padding: '4px 4px 4px 16px',
          boxShadow: '0 0 0 4px color-mix(in oklch, var(--mp-primary) 12%, transparent)',
        }}>
          <Icon name="vpn_key" style={{ fontSize: 18, color: 'var(--mp-ink-3)' }} />
          <input
            className="tabular"
            type="password"
            defaultValue="wk_live_8a3f2d9c47b1e6f0a8c9d2f1e5b4a7"
            style={{
              flex: 1, fontSize: 14, fontWeight: 600,
              color: 'var(--mp-primary)',
              border: 'none', background: 'transparent',
              padding: '12px 0', outline: 'none', minWidth: 0,
              letterSpacing: '0.04em',
            }}
          />
          <button title="Mostrar chave" style={{
            width: 36, height: 36, display: 'grid', placeItems: 'center',
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--mp-ink-3)', borderRadius: 6,
          }}>
            <Icon name="visibility" style={{ fontSize: 18 }} />
          </button>
        </div>
        <a href="#" style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          marginTop: 10, fontSize: 12, fontWeight: 600,
          color: 'var(--mp-primary)', textDecoration: 'none',
        }}>
          <Icon name="help" style={{ fontSize: 16 }} />
          Como gerar a chave Worten?
          <Icon name="arrow_forward" style={{ fontSize: 14 }} />
        </a>
      </div>

      {/* PRIMARY TRUST BLOCK — matches MarketPilot.html prominent variant */}
      <TrustBlockProminent
        body={<>A tua chave fica <strong>encriptada em repouso</strong>. Apenas o motor de repricing a usa para falar com o Worten — <strong>nem o nosso fundador a vê em texto puro</strong>.</>}
        linkText="Ver as nossas garantias →"
      />

      {/* CTA */}
      <PrimaryButton style={{
        width: '100%', padding: '16px 22px', fontSize: 15,
        justifyContent: 'center',
      }}>
        Validar e analisar catálogo
        <Icon name="arrow_forward" style={{ fontSize: 18 }} />
      </PrimaryButton>
    </OnboardingFrame>
  );
}

// ============ ARTBOARD 12 — Audit log search-active (Bose PRI01) ============

const BOSE_EVENTS = [
  { t: '14:18', kind: 'attention',   label: 'PRI01 falhou repetidamente — atenção marcada',  detail: 'persistent_failure' },
  { t: '14:18', kind: 'cycle',       label: 'Tier 1 ciclo · undercut decision',
    from: 269.00, to: 265.99 },
  { t: '14:18', kind: 'fail',        label: 'PRI01 #4892 → PRI02 FAILED',
    error: '422 offer_inactive_or_unknown', expanded: true,
    competitor: 'AudioPlanet · €265,99 (14:17)',
    decision: 'Undercut · regra UC-01',
    mirakl: 'FAILED · 422 offer_inactive_or_unknown · import #4892' },
  { t: '14:03', kind: 'cycle',       label: 'Tier 1 ciclo · undercut decision',
    from: 269.00, to: 266.49 },
  { t: '14:03', kind: 'fail',        label: 'PRI01 #4856 → PRI02 FAILED',
    error: '422 offer_inactive_or_unknown' },
  { t: '13:48', kind: 'cycle',       label: 'Tier 1 ciclo · undercut decision',
    from: 269.00, to: 266.99 },
  { t: '13:48', kind: 'fail',        label: 'PRI01 #4821 → PRI02 FAILED',
    error: '422 offer_inactive_or_unknown' },
  { t: '13:33', kind: 'cycle',       label: 'Tier 1 ciclo · undercut decision',
    from: 269.00, to: 267.49 },
  { t: '13:33', kind: 'fail-first',  label: 'PRI01 #4787 → PRI02 FAILED',
    error: '422 offer_inactive_or_unknown', firstFailure: true },
  { t: '13:18', kind: 'cycle',       label: 'Tier 1 ciclo · undercut decision',
    from: 269.00, to: 267.99 },
  { t: '13:18', kind: 'success-last',label: 'PRI01 #4753 → PRI02 COMPLETE',
    lastSuccess: true },
  { t: '13:03', kind: 'pos_won',     label: 'Posição ganha' },
];

function BoseEventRow({ ev }) {
  const [open, setOpen] = useState(ev.expanded);

  const palette = {
    attention:    { icon: 'warning',       color: 'var(--mp-loss)' },
    cycle:        { icon: 'sync',          color: 'var(--mp-info)' },
    fail:         { icon: 'sync_problem',  color: 'var(--mp-loss)' },
    'fail-first': { icon: 'sync_problem',  color: 'var(--mp-loss)' },
    'success-last':{icon: 'task_alt',      color: 'var(--mp-win)' },
    pos_won:      { icon: 'arrow_outward', color: 'var(--mp-win)' },
  };
  const p = palette[ev.kind];
  const isFail = ev.kind === 'fail' || ev.kind === 'fail-first';
  const hasDetail = ev.expanded;

  return (
    <div style={{ borderBottom: '1px solid var(--mp-line-soft)' }}>
      <button onClick={() => hasDetail && setOpen(!open)} style={{
        width: '100%', padding: '12px 18px',
        display: 'grid', gridTemplateColumns: '60px 24px 1fr auto 20px',
        gap: 14, alignItems: 'center',
        background: open ? 'var(--mp-bg)'
                  : isFail ? 'color-mix(in oklch, var(--mp-loss) 3%, var(--mp-surface))'
                  : 'var(--mp-surface)',
        border: 'none', cursor: hasDetail ? 'pointer' : 'default',
        textAlign: 'left',
      }}>
        <span className="tabular" style={{ fontSize: 12, color: 'var(--mp-ink-3)', fontWeight: 600 }}>{ev.t}</span>
        <Icon name={p.icon} fill={ev.kind === 'attention'} style={{ fontSize: 16, color: p.color }} />
        <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--mp-primary)', fontWeight: ev.kind === 'attention' ? 700 : 500 }}>
            {ev.label}
          </span>
          {ev.firstFailure && (
            <span style={{
              padding: '2px 8px', fontSize: 10, fontWeight: 700,
              letterSpacing: '0.06em', textTransform: 'uppercase',
              borderRadius: 4, background: 'var(--mp-warn-soft)', color: 'var(--mp-warn)',
              fontFamily: 'var(--mp-font-display)',
            }}>← primeira falha</span>
          )}
          {ev.lastSuccess && (
            <span style={{
              padding: '2px 8px', fontSize: 10, fontWeight: 700,
              letterSpacing: '0.06em', textTransform: 'uppercase',
              borderRadius: 4, background: 'var(--mp-win-soft)', color: 'var(--mp-win)',
              fontFamily: 'var(--mp-font-display)',
            }}>← último sucesso</span>
          )}
        </div>
        <span className="tabular" style={{ fontSize: 12, color: 'var(--mp-ink-2)', fontWeight: 600 }}>
          {ev.from && (
            <>{fmtEur(ev.from)} → <span style={{ color: 'var(--mp-loss)' }}>{fmtEur(ev.to)}</span></>
          )}
          {ev.error && (
            <span style={{ color: 'var(--mp-loss)', fontFamily: 'var(--mp-font-mono)' }}>{ev.error}</span>
          )}
        </span>
        <Icon name={hasDetail ? (open ? 'expand_less' : 'expand_more') : ''} style={{ fontSize: 16, color: 'var(--mp-ink-3)' }} />
      </button>
      {open && hasDetail && (
        <div style={{
          padding: '6px 18px 18px 96px',
          background: 'var(--mp-bg)',
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12,
        }}>
          {[
            { h: 'Sinal', b: ev.competitor, sub: 'Concorrente abaixo do current €269,00' },
            { h: 'Decisão', b: ev.decision, sub: 'Margem aplicada: −1,5% / +5,0%' },
            { h: 'Mirakl', b: <span style={{ color: 'var(--mp-loss)' }}>{ev.mirakl}</span>, sub: 'Tentativa registada em pri01_failures' },
          ].map((c, i) => (
            <div key={i} style={{
              padding: '12px 14px', background: 'var(--mp-surface)',
              border: i === 2 ? '1px solid color-mix(in oklch, var(--mp-loss) 25%, transparent)' : '1px solid var(--mp-line-soft)',
              borderRadius: 'var(--mp-radius-sm)',
            }}>
              <p style={{ margin: '0 0 6px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--mp-ink-3)' }}>{c.h}</p>
              <p className="tabular" style={{ margin: 0, fontSize: 12, color: 'var(--mp-ink-2)', fontWeight: 600 }}>{c.b}</p>
              <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--mp-ink-3)' }}>{c.sub}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ScreenAuditSearch({ channel, setChannel }) {
  const [paused, setPaused] = useState(false);
  return (
    <DashFrame channel={channel} setChannel={setChannel} screen="audit-search" paused={paused} setPaused={setPaused}>
      <div>
        <a href="#" style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 12, fontWeight: 600, color: 'var(--mp-ink-3)',
          textDecoration: 'none', marginBottom: 10,
        }}>
          <Icon name="arrow_back" style={{ fontSize: 14 }} />
          Voltar ao audit log
        </a>
      </div>

      {/* Search bar — active/focused state */}
      <div style={{
        background: 'var(--mp-surface)',
        border: '1.5px solid var(--mp-primary)',
        boxShadow: '0 0 0 4px color-mix(in oklch, var(--mp-primary) 10%, transparent)',
        borderRadius: 'var(--mp-radius-lg)',
        padding: '6px 6px 6px 18px',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <Icon name="search" style={{ fontSize: 22, color: 'var(--mp-primary)' }} />
        <span className="tabular" style={{
          flex: 1, fontSize: 15, fontWeight: 600, color: 'var(--mp-primary)',
          padding: '12px 0',
        }}>Bose QuietComfort 45 Black</span>
        <button title="Limpar pesquisa" style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '6px 10px',
          background: 'var(--mp-bg)', border: '1px solid var(--mp-line)',
          borderRadius: 'var(--mp-radius-sm)', cursor: 'pointer',
          fontSize: 11, fontWeight: 600, color: 'var(--mp-ink-2)',
        }}>
          Limpar pesquisa
          <Icon name="close" style={{ fontSize: 14 }} />
        </button>
      </div>

      {/* Per-SKU header */}
      <section style={{
        background: 'var(--mp-surface)',
        border: '1px solid var(--mp-line-soft)',
        borderRadius: 'var(--mp-radius-lg)',
        padding: '24px 28px',
      }}>
        <p style={{
          margin: '0 0 8px', fontSize: 11, fontWeight: 700,
          letterSpacing: '0.14em', textTransform: 'uppercase',
          color: 'var(--mp-ink-3)',
        }}>Audit log · Busca por SKU</p>
        <h2 className="font-display" style={{
          margin: '0 0 6px', fontSize: 24, fontWeight: 800,
          color: 'var(--mp-primary)', letterSpacing: '-0.02em',
        }}>Bose QuietComfort 45 Black</h2>
        <p className="tabular" style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--mp-ink-3)' }}>
          SKU: BOS-QC45-BLK · EAN: 017817832687
        </p>
        <div className="tabular" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
          <span style={{ color: 'var(--mp-ink-2)' }}>Últimos 90 dias</span>
          <span style={{ color: 'var(--mp-line)' }}>·</span>
          <span style={{ color: 'var(--mp-ink-2)' }}><strong style={{ color: 'var(--mp-primary)', fontWeight: 700 }}>47</strong> eventos</span>
          <span style={{ color: 'var(--mp-line)' }}>·</span>
          <span style={{ color: 'var(--mp-loss)', fontWeight: 700 }}>
            <Icon name="warning" fill style={{ fontSize: 14, verticalAlign: 'middle', marginRight: 4 }} />
            4 falhas PRI01 nas últimas 4 horas
          </span>
        </div>
      </section>

      {/* Event list */}
      <section>
        <div style={{
          background: 'var(--mp-surface)',
          border: '1px solid var(--mp-line-soft)',
          borderRadius: 'var(--mp-radius-lg)',
          overflow: 'hidden',
        }}>
          <div style={{
            padding: '10px 18px',
            display: 'grid', gridTemplateColumns: '60px 24px 1fr auto 20px',
            gap: 14, background: 'var(--mp-bg)',
            borderBottom: '1px solid var(--mp-line)',
          }}>
            {['Hora', '', 'Evento', 'Detalhe', ''].map((h, i) => (
              <span key={i} style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
                textTransform: 'uppercase', color: 'var(--mp-ink-3)',
              }}>{h}</span>
            ))}
          </div>
          {BOSE_EVENTS.map((ev, i) => <BoseEventRow key={i} ev={ev} />)}
        </div>
        <p style={{ textAlign: 'center', margin: '14px 0 0', fontSize: 12, color: 'var(--mp-ink-3)' }}>
          A mostrar 12 dos 47 eventos · <a href="#" style={{ color: 'var(--mp-primary)', fontWeight: 700, textDecoration: 'none' }}>Carregar mais</a>
        </p>
      </section>
    </DashFrame>
  );
}

Object.assign(window, {
  ScreenGoLiveModal, ScreenAnomalyModal,
  ScreenScanReady, ScreenOnboardingKey,
  ScreenAuditSearch, BOSE_EVENTS,
});
