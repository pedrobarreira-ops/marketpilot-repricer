-- Story 9.0 / AC#1 — audit_log_priority enum + audit_log_event_types lookup table + 26-row seed
-- F5 amendment: filename uses 'a' suffix to ensure this migration runs BEFORE
-- 202604301208_create_audit_log_partitioned.sql (Story 9.1).
-- Supabase CLI applies migrations in lexicographic filename order.
--
-- AD20 taxonomy: three priority levels, no diacritics for SQL safety.
-- 7 Atenção + 8 Notável + 11 Rotina = 26 base rows.
-- FKs flow INWARD: audit_log.event_type → audit_log_event_types.event_type (added in Story 9.1).
-- No outbound FKs from this table.

-- ---------------------------------------------------------------------------
-- 1. audit_log_priority enum
-- ---------------------------------------------------------------------------

CREATE TYPE audit_log_priority AS ENUM ('atencao', 'notavel', 'rotina');

-- ---------------------------------------------------------------------------
-- 2. audit_log_event_types lookup table
-- ---------------------------------------------------------------------------

CREATE TABLE audit_log_event_types (
  event_type  TEXT                 PRIMARY KEY,
  priority    audit_log_priority   NOT NULL,
  description TEXT                 NOT NULL
);

-- ---------------------------------------------------------------------------
-- 3. 26-row seed — AD20 taxonomy
-- ---------------------------------------------------------------------------

-- 7 Atenção rows
INSERT INTO audit_log_event_types (event_type, priority, description) VALUES
  ('anomaly-freeze',                'atencao', 'Mudança externa de preço >40% — congelado para revisão'),
  ('circuit-breaker-trip',          'atencao', 'Disjuntor ativado — mais de 20% do catálogo impactado num ciclo'),
  ('circuit-breaker-per-sku-trip',  'atencao', 'Disjuntor por SKU ativado — 15 falhas num ciclo'),
  ('key-validation-fail',           'atencao', 'Chave da API Worten inválida ou revogada'),
  ('pri01-fail-persistent',         'atencao', 'Falha persistente na submissão de preços PRI01'),
  ('payment-failure-pause',         'atencao', 'Pagamento falhou — motor pausado aguardando regularização'),
  ('shop-name-collision-detected',  'atencao', 'Colisão de nome de loja detetada no P11 — SKU ignorado no ciclo');

-- 8 Notável rows
INSERT INTO audit_log_event_types (event_type, priority, description) VALUES
  ('external-change-absorbed',          'notavel', 'Alteração externa de preço absorvida dentro da tolerância'),
  ('position-won',                      'notavel', 'Posição 1 conquistada neste ciclo'),
  ('position-lost',                     'notavel', 'Posição 1 perdida neste ciclo'),
  ('new-competitor-entered',            'notavel', 'Novo concorrente entrou no mercado para este SKU'),
  ('large-price-move-within-tolerance', 'notavel', 'Movimento de preço significativo mas dentro da banda de tolerância'),
  ('customer-paused',                   'notavel', 'Motor pausado pelo cliente'),
  ('customer-resumed',                  'notavel', 'Motor retomado pelo cliente'),
  ('scan-complete-with-issues',         'notavel', 'Scan completo mas com SKUs problemáticos');

-- 11 Rotina rows
INSERT INTO audit_log_event_types (event_type, priority, description) VALUES
  ('undercut-decision',       'rotina', 'Decisão de undercut aplicada neste ciclo'),
  ('ceiling-raise-decision',  'rotina', 'Decisão de aumento até ao teto aplicada neste ciclo'),
  ('hold-floor-bound',        'rotina', 'Preço mantido — limite de floor atingido'),
  ('hold-ceiling-bound',      'rotina', 'Preço mantido — limite de ceiling atingido'),
  ('hold-already-in-1st',     'rotina', 'Preço mantido — já em 1.ª posição'),
  ('cycle-start',             'rotina', 'Ciclo iniciado para este cliente/marketplace'),
  ('cycle-end',               'rotina', 'Ciclo concluído'),
  ('pri01-submit',            'rotina', 'Lote PRI01 submetido'),
  ('pri02-complete',          'rotina', 'Importação PRI01 confirmada como completa'),
  ('pri02-failed-transient',  'rotina', 'Importação PRI01 falhou transientemente — será resubmetida'),
  ('tier-transition',         'rotina', 'SKU transitou de tier neste ciclo');
