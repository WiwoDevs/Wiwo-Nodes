BEGIN;

-- Usuarios y roles. user_access guarda el rol asignado por un admin y el último ingreso de
-- cada persona: role NULL = solo ha ingresado y su rol sale de la regla del servidor;
-- 'none' = un admin le quitó el acceso; otro valor = id de un rol de access_roles o de base.
CREATE TABLE user_access (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(email) AND position('@' IN email) > 1),
  display_name text,
  role text CHECK (role IS NULL OR length(role) BETWEEN 1 AND 80),
  assigned_by text,
  assigned_at timestamptz,
  last_sign_in_at timestamptz,
  -- Ajustes personales sobre los permisos del rol (claves de permiso agregadas y quitadas).
  permissions_add jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(permissions_add) = 'array'),
  permissions_remove jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(permissions_remove) = 'array'),
  permissions_updated_by text,
  permissions_updated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, email)
);

-- Ajustes de los roles de base (viewer, agent, supervisor) y roles propios. Admin no se
-- guarda: siempre tiene todos los permisos.
CREATE TABLE access_roles (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role_id text NOT NULL CHECK (length(role_id) BETWEEN 1 AND 80 AND role_id NOT IN ('admin', 'none')),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  base_role text NOT NULL CHECK (base_role IN ('viewer', 'agent', 'supervisor')),
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(permissions) = 'array'),
  built_in boolean NOT NULL DEFAULT false,
  updated_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, role_id)
);

ALTER TABLE user_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_access_tenant_isolation ON user_access
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

CREATE POLICY access_roles_tenant_isolation ON access_roles
  USING (organization_id = current_organization_id())
  WITH CHECK (organization_id = current_organization_id());

COMMIT;
