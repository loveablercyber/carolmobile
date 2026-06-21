update auth.users set email = 'admin@carolsol.com.br' where id = '00000000-0000-0000-0000-000000000001';
update auth.users set email = 'juliana@carolsol.com.br' where id = '00000000-0000-0000-0000-000000000002';
update auth.users set email = 'renata@carolsol.com.br' where id = '00000000-0000-0000-0000-000000000003';

update public.salon_locations set name = replace(name, 'Luxe Hair', 'Carol Sol') where name like '%Luxe Hair%';
update public.coupons set code = 'CAROLSOL15', description = replace(description, 'Luxe', 'Carol Sol') where code = 'LUXE15';
update public.hair_inventory set supplier = replace(supplier, 'Luxe', 'Carol Sol') where supplier like '%Luxe%';
update public.hair_inventory set lot = regexp_replace(lot, '^LX', 'CS') where lot like 'LX%';
update public.products set name = replace(name, 'Luxe', 'Carol Sol') where name like '%Luxe%';
update public.technical_records set hair_lot = regexp_replace(hair_lot, '^LX', 'CS') where hair_lot like 'LX%';
update public._luxe_migrations set description = replace(description, 'Luxe Hair', 'Carol Sol') where description like '%Luxe Hair%';
