-- FileAnalyst 3.3 attachment storage for JEAuditFlow 5.4.
-- The service also runs this statement idempotently at startup.
create table if not exists auditflow_fileanalyst_attachments (
  attachment_id varchar(80) primary key,
  project_id varchar(191) not null,
  item_id varchar(80) null,
  document_id varchar(80) null,
  file_name varchar(255) not null,
  mime_type varchar(160) not null,
  file_size bigint unsigned not null default 0,
  file_data longblob not null,
  sha256 char(64) null,
  parser_version varchar(80) null,
  parse_status varchar(40) not null default 'unparsed',
  uploaded_by varchar(191) not null,
  uploaded_by_name varchar(255) not null,
  uploaded_at datetime(6) not null default current_timestamp(6),
  key idx_fileanalyst_project_item (project_id, item_id),
  key idx_fileanalyst_project_document (project_id, document_id),
  key idx_fileanalyst_project_time (project_id, uploaded_at)
) engine=InnoDB default character set=utf8mb4 collate=utf8mb4_unicode_ci;
