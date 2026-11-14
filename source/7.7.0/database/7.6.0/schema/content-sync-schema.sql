-- Shared release content and offline-first synchronization metadata.

create table if not exists content_objects (
  object_id varchar(191) primary key,
  object_kind varchar(80) not null,
  object_key varchar(255) not null,
  locale varchar(16) not null default 'en',
  mime_type varchar(160) not null default 'application/json',
  content_hash char(64) null,
  content_json longtext null,
  content_data longblob null,
  source_version varchar(40) not null default '7.4.0',
  is_static tinyint(1) not null default 1,
  created_at datetime(3) not null default current_timestamp(3),
  updated_at datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
  unique key content_objects_key_locale (object_kind, object_key, locale),
  key content_objects_version_idx (source_version, object_kind)
) engine=InnoDB default charset=utf8mb4;

create table if not exists content_revisions (
  object_id varchar(191) not null,
  revision bigint not null,
  content_hash char(64) null,
  changed_by varchar(191) not null default '',
  change_json longtext not null,
  created_at datetime(3) not null default current_timestamp(3),
  primary key (object_id, revision),
  key content_revisions_time_idx (created_at)
) engine=InnoDB default charset=utf8mb4;

create table if not exists release_content (
  release_version varchar(40) not null,
  object_id varchar(191) not null,
  required tinyint(1) not null default 0,
  position int not null default 0,
  created_at datetime(3) not null default current_timestamp(3),
  primary key (release_version, object_id),
  key release_content_position_idx (release_version, position)
) engine=InnoDB default charset=utf8mb4;

create table if not exists sync_outbox (
  event_id char(36) primary key,
  user_id varchar(191) not null,
  workspace_id varchar(191) not null default '',
  entity_type varchar(80) not null,
  entity_id varchar(191) not null,
  operation varchar(32) not null,
  payload_json longtext not null,
  base_revision bigint not null default 0,
  attempt_count int unsigned not null default 0,
  status enum('pending','sending','sent','failed','conflict') not null default 'pending',
  next_attempt_at datetime(3) not null default current_timestamp(3),
  last_error text null,
  created_at datetime(3) not null default current_timestamp(3),
  updated_at datetime(3) not null default current_timestamp(3) on update current_timestamp(3),
  key sync_outbox_pending_idx (status, next_attempt_at),
  key sync_outbox_entity_idx (entity_type, entity_id)
) engine=InnoDB default charset=utf8mb4;

create table if not exists sync_conflicts (
  conflict_id char(36) primary key,
  event_id char(36) null,
  entity_type varchar(80) not null,
  entity_id varchar(191) not null,
  local_revision bigint not null default 0,
  remote_revision bigint not null default 0,
  local_payload_json longtext not null,
  remote_payload_json longtext not null,
  resolution enum('unresolved','local','remote','merged') not null default 'unresolved',
  resolved_by varchar(191) null,
  resolved_at datetime(3) null,
  created_at datetime(3) not null default current_timestamp(3),
  key sync_conflicts_entity_idx (entity_type, entity_id, resolution)
) engine=InnoDB default charset=utf8mb4;
