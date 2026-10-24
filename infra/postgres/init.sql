-- Runtime roles. uni_owner (superuser in dev) owns schema and runs migrations.
-- uni_app: request traffic, always subject to RLS.
-- uni_system: background jobs / platform admin ops, BYPASSRLS, used explicitly only.
CREATE ROLE uni_app LOGIN PASSWORD 'uni_app_dev' NOBYPASSRLS;
CREATE ROLE uni_system LOGIN PASSWORD 'uni_system_dev' BYPASSRLS;
GRANT CONNECT ON DATABASE uni TO uni_app, uni_system;
CREATE DATABASE uni_test OWNER uni_owner;
GRANT CONNECT ON DATABASE uni_test TO uni_app, uni_system;
