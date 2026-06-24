create sequence if not exists public.cloudinary_upload_rotation_seq
  as bigint
  increment by 1
  minvalue 1
  start with 1
  cache 1;
