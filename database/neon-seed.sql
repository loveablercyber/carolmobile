-- Usuários demonstrativos. Senhas devem ser gerenciadas por um provedor de autenticação.
insert into auth.users (id, email, phone, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000001', 'admin@carolsol.com.br', '(11) 4002-8922', now(), '{"name":"Carolina Alves"}'),
  ('00000000-0000-0000-0000-000000000002', 'juliana@carolsol.com.br', '(11) 99932-4430', now(), '{"name":"Juliana Almeida"}'),
  ('00000000-0000-0000-0000-000000000003', 'renata@carolsol.com.br', '(11) 99822-1170', now(), '{"name":"Renata Moura"}'),
  ('00000000-0000-0000-0000-000000000010', 'juliana.mendes@email.com', '(11) 99845-2201', now(), '{"name":"Juliana Mendes"}'),
  ('00000000-0000-0000-0000-000000000011', 'camila.ferreira@email.com', '(11) 99771-8802', now(), '{"name":"Camila Ferreira"}')
on conflict (id) do nothing;

insert into public.profiles (id, role, full_name, phone, birth_date) values
  ('00000000-0000-0000-0000-000000000001', 'admin', 'Carolina Alves', '(11) 4002-8922', '1988-04-12'),
  ('00000000-0000-0000-0000-000000000002', 'professional', 'Juliana Almeida', '(11) 99932-4430', '1990-08-22'),
  ('00000000-0000-0000-0000-000000000003', 'professional', 'Renata Moura', '(11) 99822-1170', '1992-02-17'),
  ('00000000-0000-0000-0000-000000000010', 'client', 'Juliana Mendes', '(11) 99845-2201', '1991-09-14'),
  ('00000000-0000-0000-0000-000000000011', 'client', 'Camila Ferreira', '(11) 99771-8802', '1994-06-03')
on conflict (id) do nothing;

insert into public.clients (id, profile_id, source, preferences, lifetime_value) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'Indicação', '{"method":"Fita Adesiva","color":"Castanho 4/6"}', 12840.00),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000011', 'Instagram', '{"method":"Microlink","color":"Morena iluminada"}', 6940.00)
on conflict (id) do nothing;

insert into public.professionals (id, profile_id, bio, specialties, commission_rate, hired_at) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', 'Especialista sênior em extensões naturais.', array['Fita Adesiva','Microlink'], 30, '2022-03-14'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', 'Colorista e especialista em extensões.', array['Queratina','Coloração'], 30, '2023-01-10')
on conflict (id) do nothing;

insert into public.admins (id, profile_id, permissions) values
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '{"all":true}')
on conflict (id) do nothing;

insert into public.salon_locations (id, name, address, phone) values
  ('40000000-0000-0000-0000-000000000001', 'Carol Sol Jardins', '{"street":"Alameda Santos","number":"1240","district":"Jardins","city":"São Paulo","state":"SP","zip":"01418-100"}', '(11) 4002-8922')
on conflict (id) do nothing;

insert into public.chairs_or_rooms (id, location_id, name, kind) values
  ('41000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'Suíte Gold', 'Sala privativa'),
  ('41000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', 'Cadeira 02', 'Atendimento')
on conflict (id) do nothing;

insert into public.service_categories (id, name, sort_order) values
  ('50000000-0000-0000-0000-000000000001', 'Aplicação', 1),
  ('50000000-0000-0000-0000-000000000002', 'Manutenção', 2),
  ('50000000-0000-0000-0000-000000000003', 'Avaliação e cuidados', 3)
on conflict (id) do nothing;

insert into public.hair_methods (id, name, description, maintenance_days) values
  ('51000000-0000-0000-0000-000000000001', 'Fita Adesiva', 'Leve, discreta e com resultado natural.', 45),
  ('51000000-0000-0000-0000-000000000002', 'Microlink', 'Aplicação sem cola e com movimento.', 60),
  ('51000000-0000-0000-0000-000000000003', 'Queratina', 'Mechas precisas para longa duração.', 90),
  ('51000000-0000-0000-0000-000000000004', 'Tic Tac', 'Transformação temporária e versátil.', 0)
on conflict (id) do nothing;

insert into public.services (id, category_id, hair_method_id, name, description, duration_minutes, base_price, deposit_amount) values
  ('52000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', 'Aplicação Fita Adesiva', 'Aplicação premium personalizada.', 210, 950, 190),
  ('52000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000002', 'Aplicação Microlink', 'Aplicação sem cola com movimento natural.', 240, 1250, 250),
  ('52000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000002', '51000000-0000-0000-0000-000000000001', 'Manutenção Fita Adesiva', 'Reposicionamento, higienização e finalização.', 150, 420, 80),
  ('52000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000003', null, 'Avaliação personalizada', 'Diagnóstico capilar com especialista.', 45, 80, 80)
on conflict (id) do nothing;

insert into public.professional_services (professional_id, service_id, commission_rate) values
  ('20000000-0000-0000-0000-000000000001', '52000000-0000-0000-0000-000000000001', 30),
  ('20000000-0000-0000-0000-000000000001', '52000000-0000-0000-0000-000000000002', 30),
  ('20000000-0000-0000-0000-000000000001', '52000000-0000-0000-0000-000000000003', 35),
  ('20000000-0000-0000-0000-000000000001', '52000000-0000-0000-0000-000000000004', 40),
  ('20000000-0000-0000-0000-000000000002', '52000000-0000-0000-0000-000000000004', 40)
on conflict (professional_id, service_id) do nothing;

insert into public.appointments (id, client_id, professional_id, service_id, location_id, chair_or_room_id, starts_at, ends_at, status, estimated_value, created_by) values
  ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '52000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000001', '2026-06-24 14:00:00-03', '2026-06-24 16:30:00-03', 'confirmed', 420, '00000000-0000-0000-0000-000000000001'),
  ('60000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '52000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', '41000000-0000-0000-0000-000000000002', '2026-06-25 10:00:00-03', '2026-06-25 14:00:00-03', 'pending_deposit', 1680, '00000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

insert into public.payments (id, appointment_id, client_id, amount, method, status, paid_at) values
  ('61000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 80, 'pix', 'paid', '2026-06-20 09:42:00-03'),
  ('61000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 250, 'pix', 'pending', null)
on conflict (id) do nothing;

insert into public.plans (id, name, price, billing_cycle, benefits) values
  ('70000000-0000-0000-0000-000000000001', 'Essencial', 349, 'monthly', '["1 manutenção","5% em produtos"]'),
  ('70000000-0000-0000-0000-000000000002', 'Completo', 599, 'monthly', '["2 manutenções","10% em produtos","Prioridade na agenda"]'),
  ('70000000-0000-0000-0000-000000000003', 'VIP', 899, 'monthly', '["3 manutenções","15% em produtos","Cashback"]'),
  ('70000000-0000-0000-0000-000000000004', 'Premium Gold', 1299, 'monthly', '["4 manutenções","20% em produtos","Concierge"]')
on conflict (id) do nothing;

insert into public.subscriptions (id, client_id, plan_id, status, starts_at, renews_at) values
  ('71000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000002', 'active', '2026-06-01', '2026-07-01')
on conflict (id) do nothing;

insert into public.loyalty_points (id, client_id, points, reason, created_at) values
  ('72000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 850, 'Saldo inicial demonstrativo', '2026-06-18 16:00:00-03'),
  ('72000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 420, 'Atendimentos e indicações', '2026-06-18 16:00:00-03')
on conflict (id) do nothing;

insert into public.coupons (id, code, description, discount_type, discount_value, starts_at, ends_at, usage_limit, target) values
  ('90000000-0000-0000-0000-000000000001', 'CAROLSOL15', '15% OFF no Kit Home Care Carol Sol', 'percentage', 15, '2026-06-01', '2026-06-30 23:59:59-03', 200, '{"level":"gold"}')
on conflict (id) do nothing;

insert into public.hair_inventory (id, code, supplier, category, color, shade, length_cm, texture, weight_grams, lot, unit_cost, suggested_price, quantity, minimum_stock) values
  ('80000000-0000-0000-0000-000000000001', 'CAB-4571', 'Brasil Hair Premium', 'Cabelo humano', 'Castanho', '4', 60, 'Liso', 100, 'CS2604', 680, 1300, 8, 5),
  ('80000000-0000-0000-0000-000000000002', 'FIT-2110', 'Carol Sol Imports', 'Fita adesiva', 'Loiro', '8.1', 55, 'Ondulado', 100, 'CS2602', 520, 1100, 3, 6),
  ('80000000-0000-0000-0000-000000000003', 'MIC-0812', 'Brasil Hair Premium', 'Microlink', 'Morena iluminada', '6/7', 65, 'Ondulado', 100, 'CS2605', 790, 1650, 12, 4)
on conflict (id) do nothing;

insert into public.products (id, sku, name, category, cost, price, stock_quantity, minimum_stock) values
  ('81000000-0000-0000-0000-000000000001', 'KIT-HC-01', 'Kit Home Care Carol Sol', 'Manutenção', 118, 349, 21, 8)
on conflict (id) do nothing;

insert into public.professional_goals (id, professional_id, period, revenue_goal, service_goal, product_goal, recurrence_goal) values
  ('82000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '[2026-06-01,2026-07-01)', 25000, 48, 3500, 72)
on conflict (id) do nothing;

insert into public.notifications (id, profile_id, kind, title, body, data, scheduled_at) values
  ('83000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'appointment_confirmed', 'Agendamento confirmado', 'Manutenção com Juliana em 24/06 às 14:00.', '{"appointment_id":"60000000-0000-0000-0000-000000000001"}', now()),
  ('83000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'low_stock', 'Estoque baixo', 'Fita adesiva invisível está abaixo do mínimo.', '{"inventory_id":"80000000-0000-0000-0000-000000000002"}', now())
on conflict (id) do nothing;
