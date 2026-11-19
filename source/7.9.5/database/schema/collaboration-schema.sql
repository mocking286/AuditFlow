-- JEAuditFlow 7.4.0 collaboration and ASPICE evidence schema.
-- Idempotent: safe to run during every container start.

create table if not exists auditflow_accounts (
  user_id varchar(191) primary key,
  email varchar(320) not null unique,
  display_name varchar(160) not null,
  password_hash varchar(255) not null,
  password_salt varchar(64) not null,
  disabled tinyint(1) not null default 0,
  created_at datetime(3) not null default current_timestamp(3),
  updated_at datetime(3) not null default current_timestamp(3) on update current_timestamp(3)
) engine=InnoDB default charset=utf8mb4;

create table if not exists auditflow_sessions (
  token_hash char(64) primary key,
  user_id varchar(191) not null,
  expires_at datetime(3) not null,
  created_at datetime(3) not null default current_timestamp(3),
  last_seen datetime(3) not null default current_timestamp(3),
  user_agent varchar(500) not null default '',
  index auditflow_sessions_user_idx (user_id),
  index auditflow_sessions_expiry_idx (expires_at)
) engine=InnoDB default charset=utf8mb4;

create table if not exists auditflow_users (
  user_id varchar(191) primary key,
  display_name varchar(160) not null default '',
  data_dir varchar(512) not null,
  created_at datetime(3) not null default current_timestamp(3),
  updated_at datetime(3) not null default current_timestamp(3) on update current_timestamp(3)
) engine=InnoDB default charset=utf8mb4;

create table if not exists auditflow_projects (
  id varchar(191) primary key,
  workspace_id varchar(191) not null,
  snapshot_json longtext not null,
  revision bigint not null default 0,
  owner_id varchar(191) not null,
  updated_by varchar(191) not null,
  updated_by_name varchar(160) not null default '',
  updated_at datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
  index auditflow_projects_workspace_idx (workspace_id),
  index auditflow_projects_owner_idx (owner_id)
) engine=InnoDB default charset=utf8mb4;

create table if not exists auditflow_project_members (
  project_id varchar(191) not null,
  user_id varchar(191) not null,
  user_name varchar(160) not null default '',
  role varchar(80) not null default 'Viewer',
  process_scopes_json text not null,
  avatar_data longtext not null,
  permissions_json text null,
  permission_version smallint unsigned not null default 1,
  created_at datetime(3) not null default current_timestamp(3),
  updated_at datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
  primary key (project_id, user_id),
  index auditflow_members_user_idx (user_id),
  index auditflow_members_role_idx (project_id, role)
) engine=InnoDB default charset=utf8mb4;

create table if not exists auditflow_project_locks (
  id varchar(96) primary key,
  project_id varchar(191) not null,
  resource_id varchar(300) not null,
  kind varchar(80) not null,
  label varchar(240) not null,
  process varchar(40) not null default '',
  affected_processes_json text not null,
  user_id varchar(191) not null,
  user_name varchar(160) not null default '',
  acquired_at datetime(3) not null,
  expires_at datetime(3) not null,
  index auditflow_locks_project_expiry_idx (project_id, expires_at),
  index auditflow_locks_project_resource_idx (project_id, resource_id)
) engine=InnoDB default charset=utf8mb4;

create table if not exists auditflow_project_presence (
  project_id varchar(191) not null,
  user_id varchar(191) not null,
  user_name varchar(160) not null default '',
  project_name varchar(240) not null default '',
  phase varchar(80) not null default 'overview',
  status varchar(40) not null default 'editing',
  last_seen datetime(3) not null,
  expires_at datetime(3) not null,
  primary key (project_id, user_id),
  index auditflow_presence_expiry_idx (project_id, expires_at)
) engine=InnoDB default charset=utf8mb4;

create table if not exists auditflow_project_events (
  id bigint unsigned not null auto_increment primary key,
  project_id varchar(191) not null,
  revision bigint not null,
  user_id varchar(191) not null,
  user_name varchar(160) not null default '',
  change_summary varchar(500) not null default '',
  processes_json text not null,
  change_json longtext not null,
  created_at datetime(3) not null default current_timestamp(3),
  index auditflow_events_cursor_idx (project_id, revision)
) engine=InnoDB default charset=utf8mb4;

create table if not exists auditflow_evidence_items (
  project_id varchar(191) not null,
  evidence_id varchar(191) not null,
  item_id varchar(191) not null,
  process_code varchar(80) not null default '',
  evidence_role varchar(40) not null default 'direct',
  item_json longtext not null,
  updated_at datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
  primary key (project_id, evidence_id, item_id),
  index auditflow_evidence_items_process_idx (project_id, process_code)
) engine=InnoDB default charset=utf8mb4;

create table if not exists auditflow_assessor_records (
  project_id varchar(191) not null,
  record_id varchar(191) not null,
  record_type varchar(40) not null default 'comment',
  indicators_json text not null,
  evidence_ids_json text not null,
  evidence_references text not null,
  record_json longtext not null,
  updated_at datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
  primary key (project_id, record_id),
  index auditflow_records_type_idx (project_id, record_type)
) engine=InnoDB default charset=utf8mb4;

create table if not exists auditflow_feedback (
  id varchar(96) primary key,
  user_id varchar(191) not null,
  user_name varchar(160) not null default '',
  feature varchar(240) not null,
  content text not null,
  attachment_name varchar(255) not null default '',
  attachment_type varchar(160) not null default '',
  attachment_size bigint not null default 0,
  attachment_data longtext not null,
  created_at datetime(3) not null default current_timestamp(3),
  index auditflow_feedback_user_idx (user_id),
  index auditflow_feedback_created_idx (created_at)
) engine=InnoDB default charset=utf8mb4;
