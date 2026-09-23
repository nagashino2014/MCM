-- R0B1 runtime database roles and least-privilege grants.
-- Passwords and Secrets Manager values are provisioned by the approved operator
-- after this migration. Reapplying this file never clears or replaces a password.

BEGIN;

-- Role catalog tuples can raise "tuple concurrently updated" when two
-- operators apply this migration at once. Serialize the complete transaction;
-- a terminated waiter can safely retry the whole file because no partial role
-- or grant state is committed.
SELECT pg_catalog.pg_advisory_xact_lock(607003, 265);

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'mcm_owner') THEN
    CREATE ROLE mcm_owner NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'mcm_app') THEN
    CREATE ROLE mcm_app LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'mcm_worker') THEN
    CREATE ROLE mcm_worker LOGIN;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'mcm_collector') THEN
    RAISE EXCEPTION 'mcm_collector must not exist before the collector is separated from Next'
      USING ERRCODE = '55000';
  END IF;
END
$roles$;

-- PostgreSQL 16+ permits only a real superuser to change SUPERUSER,
-- REPLICATION, or BYPASSRLS even when setting them false. The approved Aurora
-- migration role is not a real superuser. Fresh roles start with all three
-- attributes disabled, and the installation assertion below continues to
-- fail closed if a pre-existing role has any of them enabled.
ALTER ROLE mcm_owner NOLOGIN NOCREATEDB NOCREATEROLE NOINHERIT;
ALTER ROLE mcm_app LOGIN NOCREATEDB NOCREATEROLE NOINHERIT CONNECTION LIMIT 50;
ALTER ROLE mcm_worker LOGIN NOCREATEDB NOCREATEROLE NOINHERIT CONNECTION LIMIT 8;

-- Leave pg_catalog implicit so it precedes public in current_schemas(true),
-- as required by the installed finance definition assertions. Runtime roles
-- cannot create temporary objects (database TEMP is revoked below).
ALTER ROLE mcm_app SET search_path = public;
ALTER ROLE mcm_worker SET search_path = public;

-- Runtime roles must never inherit owner, deployer, monitoring, or another
-- runtime role. Normalize any earlier experimental membership before granting
-- object privileges.
DO $memberships$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT granted.rolname AS granted_role, member.rolname AS member_role
    FROM pg_catalog.pg_auth_members membership
    JOIN pg_catalog.pg_roles granted ON granted.oid = membership.roleid
    JOIN pg_catalog.pg_roles member ON member.oid = membership.member
    WHERE member.rolname IN ('mcm_owner', 'mcm_app', 'mcm_worker')
  LOOP
    EXECUTE pg_catalog.format('REVOKE %I FROM %I', item.granted_role, item.member_role);
  END LOOP;
END
$memberships$;

DO $database_privileges$
BEGIN
  EXECUTE pg_catalog.format('REVOKE ALL PRIVILEGES ON DATABASE %I FROM PUBLIC', pg_catalog.current_database());
  EXECUTE pg_catalog.format('REVOKE ALL PRIVILEGES ON DATABASE %I FROM mcm_app, mcm_worker', pg_catalog.current_database());
  EXECUTE pg_catalog.format('GRANT CONNECT ON DATABASE %I TO mcm_app, mcm_worker', pg_catalog.current_database());
END
$database_privileges$;

REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC, mcm_app, mcm_worker;
GRANT USAGE ON SCHEMA public TO mcm_app, mcm_worker;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM mcm_app, mcm_worker;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM mcm_app, mcm_worker;
-- Aurora installs vector extension routines in public as rdsadmin. The
-- migration principal cannot revoke their PUBLIC privileges or grant them
-- directly to mcm_app. Normalize only routines owned by this installer;
-- the assertion below admits the narrowly identified extension exception.
DO $routine_privileges$
DECLARE
  routine pg_catalog.regprocedure;
BEGIN
  FOR routine IN
    SELECT p.oid::pg_catalog.regprocedure
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proowner = current_user::pg_catalog.regrole::oid
  LOOP
    EXECUTE pg_catalog.format('REVOKE EXECUTE ON ROUTINE %s FROM PUBLIC, mcm_app, mcm_worker', routine);
    EXECUTE pg_catalog.format('GRANT EXECUTE ON ROUTINE %s TO mcm_app', routine);
  END LOOP;
END
$routine_privileges$;

-- Next is the monolithic application runtime in R0B1. It may use existing
-- application data and approved routines, but it receives no schema, trigger,
-- truncate, role, replication, or database TEMP capability.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mcm_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mcm_app;

-- The managed worker's only direct PostgreSQL job is facility-enrich. collect
-- and parse use a local sql.js file plus backend HTTP and receive no DB grant.
GRANT SELECT ON TABLE public.facilities, public.facility_history_events TO mcm_worker;
GRANT SELECT, UPDATE ON TABLE public.facility_quality_runs, public.facility_quality_items TO mcm_worker;
GRANT SELECT, INSERT ON TABLE public.facility_enrichment_candidates TO mcm_worker;
GRANT SELECT, INSERT, UPDATE ON TABLE public.facility_quality_source_requests, public.facility_quality_profile_cache TO mcm_worker;
GRANT EXECUTE ON FUNCTION public.facility_quality_snapshot(public.facilities) TO mcm_worker;

-- Objects created later by the current migration principal remain usable by
-- Next without reopening DDL. Worker privileges stay explicit by design.
DO $defaults$
DECLARE
  installer text := current_user;
BEGIN
  EXECUTE pg_catalog.format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC',
    installer
  );
  EXECUTE pg_catalog.format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mcm_app',
    installer
  );
  EXECUTE pg_catalog.format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO mcm_app',
    installer
  );
  EXECUTE pg_catalog.format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO mcm_app',
    installer
  );
END
$defaults$;

CREATE OR REPLACE FUNCTION public.mcm_assert_runtime_privileges()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public, pg_catalog, pg_temp
AS $assert$
DECLARE
  failure text;
BEGIN
  SELECT pg_catalog.format('%s attributes', role_name)
  INTO failure
  FROM (
    VALUES
      ('mcm_owner', false, -1),
      ('mcm_app', true, 50),
      ('mcm_worker', true, 8)
  ) expected(role_name, can_login, connection_limit)
  LEFT JOIN pg_catalog.pg_roles actual ON actual.rolname = expected.role_name
  WHERE actual.oid IS NULL
     OR actual.rolcanlogin IS DISTINCT FROM expected.can_login
     OR actual.rolsuper OR actual.rolcreatedb OR actual.rolcreaterole
     OR actual.rolinherit OR actual.rolreplication OR actual.rolbypassrls
     OR actual.rolconnlimit IS DISTINCT FROM expected.connection_limit
  LIMIT 1;
  IF failure IS NOT NULL THEN
    RAISE EXCEPTION 'runtime database privilege mismatch: %', failure USING ERRCODE = '55000';
  END IF;

  SELECT actual.rolname || ' search_path'
  INTO failure
  FROM pg_catalog.pg_roles actual
  WHERE actual.rolname IN ('mcm_app', 'mcm_worker')
    AND NOT COALESCE('search_path=public' = ANY(actual.rolconfig), false)
  LIMIT 1;
  IF failure IS NOT NULL THEN
    RAISE EXCEPTION 'runtime database privilege mismatch: %', failure USING ERRCODE = '55000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_default_acl defaults
    JOIN pg_catalog.pg_proc assertion ON assertion.proowner = defaults.defaclrole
    WHERE assertion.oid = 'public.mcm_assert_runtime_privileges()'::pg_catalog.regprocedure
      AND defaults.defaclnamespace = 0
      AND defaults.defaclobjtype = 'f'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(defaults.defaclacl) privilege
        WHERE privilege.grantee = 0 AND privilege.privilege_type = 'EXECUTE'
      )
  ) THEN
    RAISE EXCEPTION 'runtime database privilege mismatch: PUBLIC function default' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'mcm_collector') THEN
    RAISE EXCEPTION 'runtime database privilege mismatch: premature mcm_collector role' USING ERRCODE = '55000';
  END IF;

  SELECT pg_catalog.format('%s inherits %s', member.rolname, granted.rolname)
  INTO failure
  FROM pg_catalog.pg_auth_members membership
  JOIN pg_catalog.pg_roles granted ON granted.oid = membership.roleid
  JOIN pg_catalog.pg_roles member ON member.oid = membership.member
  WHERE member.rolname IN ('mcm_owner', 'mcm_app', 'mcm_worker')
  LIMIT 1;
  IF failure IS NOT NULL THEN
    RAISE EXCEPTION 'runtime database privilege mismatch: %', failure USING ERRCODE = '55000';
  END IF;

  IF pg_catalog.has_schema_privilege('mcm_app', 'public', 'CREATE')
     OR pg_catalog.has_schema_privilege('mcm_worker', 'public', 'CREATE')
     OR NOT pg_catalog.has_schema_privilege('mcm_app', 'public', 'USAGE')
     OR NOT pg_catalog.has_schema_privilege('mcm_worker', 'public', 'USAGE') THEN
    RAISE EXCEPTION 'runtime database privilege mismatch: public schema boundary' USING ERRCODE = '55000';
  END IF;

  IF NOT pg_catalog.has_database_privilege('mcm_app', pg_catalog.current_database(), 'CONNECT')
     OR NOT pg_catalog.has_database_privilege('mcm_worker', pg_catalog.current_database(), 'CONNECT')
     OR pg_catalog.has_database_privilege('mcm_app', pg_catalog.current_database(), 'TEMP')
     OR pg_catalog.has_database_privilege('mcm_worker', pg_catalog.current_database(), 'TEMP') THEN
    RAISE EXCEPTION 'runtime database privilege mismatch: database connect/temp boundary' USING ERRCODE = '55000';
  END IF;

  SELECT c.relname || ':' || privilege
  INTO failure
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS privileges(privilege)
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND NOT pg_catalog.has_table_privilege('mcm_app', c.oid, privilege)
  LIMIT 1;
  IF failure IS NOT NULL THEN
    RAISE EXCEPTION 'runtime database privilege mismatch: mcm_app missing %', failure USING ERRCODE = '55000';
  END IF;

  SELECT c.relname || ':' || privilege
  INTO failure
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN unnest(ARRAY['TRUNCATE', 'REFERENCES', 'TRIGGER']) AS privileges(privilege)
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND pg_catalog.has_table_privilege('mcm_app', c.oid, privilege)
  LIMIT 1;
  IF failure IS NOT NULL THEN
    RAISE EXCEPTION 'runtime database privilege mismatch: mcm_app excess %', failure USING ERRCODE = '55000';
  END IF;

  SELECT c.relname
  INTO failure
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'S'
    AND (
      NOT pg_catalog.has_sequence_privilege('mcm_app', c.oid, 'USAGE')
      OR NOT pg_catalog.has_sequence_privilege('mcm_app', c.oid, 'SELECT')
      OR pg_catalog.has_sequence_privilege('mcm_app', c.oid, 'UPDATE')
    )
  LIMIT 1;
  IF failure IS NOT NULL THEN
    RAISE EXCEPTION 'runtime database privilege mismatch: mcm_app sequence %', failure USING ERRCODE = '55000';
  END IF;

  SELECT p.oid::pg_catalog.regprocedure::text
  INTO failure
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND NOT pg_catalog.has_function_privilege('mcm_app', p.oid, 'EXECUTE')
  LIMIT 1;
  IF failure IS NOT NULL THEN
    RAISE EXCEPTION 'runtime database privilege mismatch: mcm_app routine %', failure USING ERRCODE = '55000';
  END IF;

  WITH expected(relation_name, privilege) AS (
    VALUES
      ('facilities', 'SELECT'),
      ('facility_history_events', 'SELECT'),
      ('facility_quality_runs', 'SELECT'),
      ('facility_quality_runs', 'UPDATE'),
      ('facility_quality_items', 'SELECT'),
      ('facility_quality_items', 'UPDATE'),
      ('facility_enrichment_candidates', 'SELECT'),
      ('facility_enrichment_candidates', 'INSERT'),
      ('facility_quality_source_requests', 'SELECT'),
      ('facility_quality_source_requests', 'INSERT'),
      ('facility_quality_source_requests', 'UPDATE'),
      ('facility_quality_profile_cache', 'SELECT'),
      ('facility_quality_profile_cache', 'INSERT'),
      ('facility_quality_profile_cache', 'UPDATE')
  ), actual AS (
    SELECT c.relname AS relation_name, privilege
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS privileges(privilege)
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND pg_catalog.has_table_privilege('mcm_worker', c.oid, privilege)
  ), difference AS (
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
    UNION ALL
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  )
  SELECT relation_name || ':' || privilege INTO failure FROM difference LIMIT 1;
  IF failure IS NOT NULL THEN
    RAISE EXCEPTION 'runtime database privilege mismatch: mcm_worker table %', failure USING ERRCODE = '55000';
  END IF;

  SELECT c.relname
  INTO failure
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'S'
    AND (
      pg_catalog.has_sequence_privilege('mcm_worker', c.oid, 'USAGE')
      OR pg_catalog.has_sequence_privilege('mcm_worker', c.oid, 'SELECT')
      OR pg_catalog.has_sequence_privilege('mcm_worker', c.oid, 'UPDATE')
    )
  LIMIT 1;
  IF failure IS NOT NULL THEN
    RAISE EXCEPTION 'runtime database privilege mismatch: mcm_worker sequence %', failure USING ERRCODE = '55000';
  END IF;

  SELECT p.oid::pg_catalog.regprocedure::text
  INTO failure
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND pg_catalog.has_function_privilege('mcm_worker', p.oid, 'EXECUTE')
    AND p.oid <> pg_catalog.to_regprocedure('public.facility_quality_snapshot(public.facilities)')
    AND NOT (
      pg_catalog.pg_get_userbyid(p.proowner) = 'rdsadmin'
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.pg_depend dependency
        JOIN pg_catalog.pg_extension extension ON extension.oid = dependency.refobjid
        WHERE dependency.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
          AND dependency.objid = p.oid
          AND dependency.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
          AND dependency.deptype = 'e'
          AND extension.extname = 'vector'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.aclexplode(p.proacl) privilege
        WHERE privilege.grantee = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'mcm_worker')
          AND privilege.privilege_type = 'EXECUTE'
      )
    )
  LIMIT 1;
  IF failure IS NOT NULL
     OR NOT pg_catalog.has_function_privilege(
       'mcm_worker',
       pg_catalog.to_regprocedure('public.facility_quality_snapshot(public.facilities)'),
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'runtime database privilege mismatch: mcm_worker routine %', COALESCE(failure, 'facility_quality_snapshot') USING ERRCODE = '55000';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'version', 'r0b-runtime-roles-v2',
    'database', pg_catalog.current_database(),
    'appRole', 'mcm_app',
    'workerRole', 'mcm_worker',
    'collectorCreated', false
  );
END
$assert$;

COMMENT ON FUNCTION public.mcm_assert_runtime_privileges() IS
  'R0B1 exact runtime role and privilege boundary assertion (r0b-runtime-roles-v2).';

-- The assertion function was created after the first routine grant pass.
REVOKE EXECUTE ON FUNCTION public.mcm_assert_runtime_privileges() FROM PUBLIC, mcm_worker;
GRANT EXECUTE ON FUNCTION public.mcm_assert_runtime_privileges() TO mcm_app;

SELECT public.mcm_assert_runtime_privileges();

COMMIT;
